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

export const MAX_CATALOG_SIZE_KB = 4500;
export const MAX_HOLDS = 500;
export const MAX_ANGLES = 5000;
export const MAX_IMAGE_DATA_URL_BYTES = 2 * 1024 * 1024;

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

function serializedSizeKB(obj) {
    try {
        return Buffer.byteLength(JSON.stringify(obj), 'utf8') / 1024;
    } catch {
        return Infinity;
    }
}

function dataUrlByteLength(value) {
    return typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0;
}

export function validateCatalogLimits(data) {
    if (!data || typeof data !== 'object') return { ok: false, status: 400, message: 'data must be an object' };
    if (!Array.isArray(data.holds) || !Array.isArray(data.angles)) {
        return { ok: false, status: 400, message: 'data.holds and data.angles must be arrays' };
    }
    if (data.holds.length > MAX_HOLDS) {
        return { ok: false, status: 413, message: `too many holds (max ${MAX_HOLDS})` };
    }
    if (data.angles.length > MAX_ANGLES) {
        return { ok: false, status: 413, message: `too many angles (max ${MAX_ANGLES})` };
    }
    for (const hold of data.holds) {
        if (dataUrlByteLength(hold?.coverImage) > MAX_IMAGE_DATA_URL_BYTES) {
            return { ok: false, status: 413, message: 'hold cover image is too large' };
        }
    }
    for (const angle of data.angles) {
        if (dataUrlByteLength(angle?.drawing) > MAX_IMAGE_DATA_URL_BYTES) {
            return { ok: false, status: 413, message: 'angle drawing image is too large' };
        }
    }
    if (serializedSizeKB(data) > MAX_CATALOG_SIZE_KB) {
        return { ok: false, status: 413, message: `catalog is too large (max ${MAX_CATALOG_SIZE_KB}KB)` };
    }
    return { ok: true };
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
    const sizeValid = validateCatalogLimits(sanitized);
    if (!sizeValid.ok) {
        return {
            status: sizeValid.status,
            body: { error: sizeValid.status === 413 ? 'payload_too_large' : 'invalid_body', message: sizeValid.message },
        };
    }
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
