import { describe, it, expect } from 'vitest';
import { MAX_HOLDS, MAX_IMAGE_DATA_URL_BYTES, getState, putState } from './stateService.js';
import { migrateAndSanitize } from '../../src/domain/migration.js';

// ---- in-memory store implementing the same contract as the Neon store ----
function makeMemoryStore(initial = null) {
    let row = initial ? { data: initial.data, revision: initial.revision } : null;
    const log = [];
    return {
        row: () => row,
        log: () => log,
        async readState() {
            return row ? { data: row.data, revision: row.revision } : null;
        },
        async initState(data) {
            if (!row) row = { data, revision: 1 };
            return { data: row.data, revision: row.revision };
        },
        async commitWrite({ data, expectedRevision, username, events }) {
            // atomic compare-and-set, mirroring the SQL CTE
            if (!row || row.revision !== expectedRevision) {
                return { applied: false, revision: row?.revision ?? null, inserted: 0 };
            }
            row = { data, revision: row.revision + 1 };
            for (const e of events) {
                log.push({ username, action: e.action, entity: e.entity, field: e.field, old_value: e.oldValue, new_value: e.newValue });
            }
            return { applied: true, revision: row.revision, inserted: events.length };
        },
    };
}

const cat = (holds, angles) => migrateAndSanitize({ version: 2, holds, angles });
const seeded = (holds, angles, revision = 1) => makeMemoryStore({ data: cat(holds, angles), revision });

describe('getState', () => {
    it('returns data + revision from the store', async () => {
        const store = seeded([{ id: 'h1', name: 'Austin' }], [{ id: 'a1', holdId: 'h1', value: 30, saw: 'main' }], 4);
        const result = await getState(store);
        expect(result.revision).toBe(4);
        expect(result.data.version).toBe(2);
        expect(result.data.holds).toHaveLength(1);
        expect(result.data.angles).toHaveLength(1);
    });

    it('initializes app_state from the default catalog when missing', async () => {
        const store = makeMemoryStore(null);
        const result = await getState(store);
        expect(result.revision).toBe(1);
        expect(result.data.version).toBe(2);
        expect(Array.isArray(result.data.holds)).toBe(true);
        // the row now exists in the store
        expect(store.row()).not.toBeNull();
        expect(store.row().revision).toBe(1);
    });
});

describe('putState — validation & auth-shape', () => {
    it('rejects an invalid body with 400', async () => {
        const store = seeded([{ id: 'h1', name: 'Austin' }], [], 1);
        expect((await putState(store, { body: null, username: 'Tomek' })).status).toBe(400);
        expect((await putState(store, { body: { data: {}, revision: 1 }, username: 'Tomek' })).status).toBe(400);
        expect((await putState(store, { body: { data: { holds: [], angles: [] } }, username: 'Tomek' })).status).toBe(400);
        // store untouched
        expect(store.row().revision).toBe(1);
        expect(store.log()).toHaveLength(0);
    });

    it('rejects catalogs that exceed server-side entity limits', async () => {
        const store = seeded([{ id: 'h1', name: 'Austin' }], [], 1);
        const holds = Array.from({ length: MAX_HOLDS + 1 }, (_, i) => ({ id: `h${i}`, name: `Hold ${i}` }));
        const result = await putState(store, {
            body: { data: { version: 2, holds, angles: [] }, revision: 1 },
            username: 'Tomek',
        });
        expect(result.status).toBe(413);
        expect(result.body.error).toBe('payload_too_large');
        expect(store.row().revision).toBe(1);
    });

    it('rejects oversized inline images before writing', async () => {
        const store = seeded([{ id: 'h1', name: 'Austin' }], [], 1);
        const coverImage = `data:image/png;base64,${'a'.repeat(MAX_IMAGE_DATA_URL_BYTES)}`;
        const result = await putState(store, {
            body: { data: { version: 2, holds: [{ id: 'h1', name: 'Austin', coverImage }], angles: [] }, revision: 1 },
            username: 'Tomek',
        });
        expect(result.status).toBe(413);
        expect(result.body.error).toBe('payload_too_large');
        expect(store.row().revision).toBe(1);
    });
});

describe('putState — revision conflict', () => {
    it('returns 409 stale_revision and writes nothing when revisions differ', async () => {
        const store = seeded([{ id: 'h1', name: 'Austin' }], [{ id: 'a1', holdId: 'h1', value: 30, saw: 'main' }], 7);
        const result = await putState(store, {
            body: { data: cat([{ id: 'h1', name: 'Austin' }], [{ id: 'a1', holdId: 'h1', value: 45, saw: 'main' }]), revision: 3 },
            username: 'Tomek',
        });
        expect(result.status).toBe(409);
        expect(result.body.error).toBe('stale_revision');
        expect(result.body.currentRevision).toBe(7);
        // no write happened
        expect(store.row().revision).toBe(7);
        expect(store.log()).toHaveLength(0);
    });
});

describe('putState — successful write', () => {
    it('accepts a matching revision and increments it', async () => {
        const store = seeded([{ id: 'h1', name: 'Austin' }], [{ id: 'a1', holdId: 'h1', value: 30, saw: 'main' }], 1);
        const result = await putState(store, {
            body: { data: cat([{ id: 'h1', name: 'Austin' }], [{ id: 'a1', holdId: 'h1', value: 45, saw: 'main' }]), revision: 1 },
            username: 'Tomek',
        });
        expect(result.status).toBe(200);
        expect(result.body.revision).toBe(2);
        expect(store.row().revision).toBe(2);
    });

    it('writes one change_log row per diffStates event, attributed to the user', async () => {
        const store = seeded([{ id: 'h1', name: 'Austin' }], [{ id: 'a1', holdId: 'h1', value: 30, saw: 'main' }], 1);
        const result = await putState(store, {
            body: { data: cat([{ id: 'h1', name: 'Austin' }], [{ id: 'a1', holdId: 'h1', value: 45, saw: 'main' }]), revision: 1 },
            username: 'Alessandro',
        });
        expect(result.body.changes).toBe(1);
        const log = store.log();
        expect(log).toHaveLength(1);
        expect(log[0]).toMatchObject({
            username: 'Alessandro',
            action: 'angle_changed',
            entity: 'Austin',
            field: 'value',
            old_value: '30',
            new_value: '45',
        });
    });

    it('returns sanitized data (clamps values, drops orphan angles)', async () => {
        const store = seeded([{ id: 'h1', name: 'Austin' }], [], 1);
        const result = await putState(store, {
            body: {
                data: {
                    version: 2,
                    holds: [{ id: 'h1', name: 'Austin' }],
                    angles: [
                        { id: 'a1', holdId: 'h1', value: 150, saw: 'main' },   // clamp → 90
                        { id: 'a2', holdId: 'ghost', value: 30, saw: 'main' },  // orphan → dropped
                    ],
                },
                revision: 1,
            },
            username: 'Tomek',
        });
        expect(result.status).toBe(200);
        expect(result.body.data.angles).toHaveLength(1);
        expect(result.body.data.angles[0].value).toBe(90);
    });
});

describe('putState — image-only vs no-op', () => {
    it('persists an image-only change and bumps revision but writes no change_log rows', async () => {
        const store = seeded([{ id: 'h1', name: 'Austin' }], [{ id: 'a1', holdId: 'h1', value: 30, saw: 'main' }], 1);
        const withDrawing = cat(
            [{ id: 'h1', name: 'Austin' }],
            [{ id: 'a1', holdId: 'h1', value: 30, saw: 'main', drawing: 'data:image/png;base64,iVBORw0KGgo=' }],
        );
        const result = await putState(store, { body: { data: withDrawing, revision: 1 }, username: 'Tomek' });
        expect(result.status).toBe(200);
        expect(result.body.changes).toBe(0);
        expect(result.body.revision).toBe(2);          // image change is persisted
        expect(store.row().revision).toBe(2);
        expect(store.log()).toHaveLength(0);            // but not audited
        expect(store.row().data.angles[0].drawing).toBeDefined();
    });

    it('treats an identical payload as a no-op: no revision bump, no log rows', async () => {
        const data = cat([{ id: 'h1', name: 'Austin' }], [{ id: 'a1', holdId: 'h1', value: 30, saw: 'main' }]);
        const store = makeMemoryStore({ data, revision: 5 });
        const result = await putState(store, { body: { data, revision: 5 }, username: 'Tomek' });
        expect(result.status).toBe(200);
        expect(result.body.revision).toBe(5);
        expect(result.body.changes).toBe(0);
        expect(store.row().revision).toBe(5);
        expect(store.log()).toHaveLength(0);
    });
});

describe('putState — transaction atomicity', () => {
    it('a failing commit leaves app_state and change_log unchanged', async () => {
        const store = seeded([{ id: 'h1', name: 'Austin' }], [{ id: 'a1', holdId: 'h1', value: 30, saw: 'main' }], 1);
        store.commitWrite = async () => { throw new Error('db down mid-write'); };
        await expect(putState(store, {
            body: { data: cat([{ id: 'h1', name: 'Austin' }], [{ id: 'a1', holdId: 'h1', value: 99, saw: 'main' }]), revision: 1 },
            username: 'Tomek',
        })).rejects.toThrow(/db down/);
        // nothing drifted
        expect(store.row().revision).toBe(1);
        expect(store.log()).toHaveLength(0);
    });
});
