// Catalog state orchestration. Pure logic decoupled from storage: every DB
// interaction goes through an injected `store` so this is unit-testable without
// a database. Reuses the existing domain pipeline (migrateAndSanitize, diffStates).
import {
    migrateAndSanitize,
    migrateV1toV2,
    DEFAULT_HOLDS,
    DEFAULT_ANGLES,
} from '../../src/domain/migration.js';
import { diffStates } from '../../src/domain/diff.js';

/**
 * Build the initial catalog the same way the existing localStorage app does
 * (v1 defaults → migrate to v2 → sanitize), so a fresh DB matches a fresh browser.
 */
export function buildDefaultCatalog() {
    return migrateAndSanitize(
        migrateV1toV2({ version: 1, holds: DEFAULT_HOLDS, angles: DEFAULT_ANGLES, holdImages: {} }),
    );
}

function catalogsEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

export function validatePutBody(body) {
    if (!body || typeof body !== 'object') return { ok: false, message: 'body must be an object' };
    if (typeof body.revision !== 'number' || !Number.isFinite(body.revision)) {
        return { ok: false, message: 'revision must be a number' };
    }
    const d = body.data;
    if (!d || typeof d !== 'object') return { ok: false, message: 'data must be an object' };
    if (!Array.isArray(d.holds) || !Array.isArray(d.angles)) {
        return { ok: false, message: 'data.holds and data.angles must be arrays' };
    }
    return { ok: true };
}

/** Read current state, initializing the row from defaults if absent. */
async function readOrInit(store) {
    let current = await store.readState();
    if (!current) {
        current = await store.initState(buildDefaultCatalog());
    }
    return { data: migrateAndSanitize(current.data), revision: Number(current.revision) };
}

/**
 * GET handler logic. Returns { data, revision } (sanitized), initializing the
 * single app_state row from the default catalog when it does not yet exist.
 */
export async function getState(store) {
    const current = await readOrInit(store);
    return { data: current.data, revision: current.revision };
}

/**
 * PUT handler logic. Returns { status, body }.
 *   400 invalid_body · 409 stale_revision · 200 success/no-op
 * The caller is responsible for authentication (username must be present).
 */
export async function putState(store, { body, username }) {
    const valid = validatePutBody(body);
    if (!valid.ok) {
        return { status: 400, body: { error: 'invalid_body', message: valid.message } };
    }

    const sanitized = migrateAndSanitize(body.data);
    const current = await readOrInit(store);

    if (Number(body.revision) !== current.revision) {
        return {
            status: 409,
            body: {
                error: 'stale_revision',
                message: 'Catalog has changed. Reload latest state and retry.',
                currentRevision: current.revision,
            },
        };
    }

    // Truly identical payload → no-op: do not bump revision, do not log.
    if (catalogsEqual(sanitized, current.data)) {
        return { status: 200, body: { data: current.data, revision: current.revision, changes: 0 } };
    }

    // diffStates ignores image-only changes, so `events` may be empty even though
    // `sanitized` differs from current (e.g. a drawing/cover upload). Such a change
    // is still persisted (revision bumps) but produces no change_log rows.
    const events = diffStates(current.data, sanitized);

    const result = await store.commitWrite({
        data: sanitized,
        expectedRevision: current.revision,
        username,
        events,
    });

    if (!result.applied) {
        // Lost a compare-and-set race after our read — surface as stale revision.
        const latest = await store.readState();
        return {
            status: 409,
            body: {
                error: 'stale_revision',
                message: 'Catalog has changed. Reload latest state and retry.',
                currentRevision: Number(latest?.revision ?? current.revision),
            },
        };
    }

    return { status: 200, body: { data: sanitized, revision: Number(result.revision), changes: events.length } };
}
