import { migrateAndSanitize } from '../domain/migration.js';

export const LS_KEY = 'angles_proto_v1';
export const LS_LAST_MODIFIED_KEY = 'angles_proto_v1_lastModified';
export const LS_CORRUPT_KEY = `${LS_KEY}_corrupt`;
export const MAX_DB_SIZE_KB = 4500;

// Set when loadState() had to recover from corrupt data; App surfaces a toast.
let didRecoverFromCorrupt = false;

export function getAndResetDidRecover() {
    const v = didRecoverFromCorrupt;
    didRecoverFromCorrupt = false;
    return v;
}

export function ensureLastModifiedExists() {
    try {
        const v = localStorage.getItem(LS_LAST_MODIFIED_KEY);
        if (!v) localStorage.setItem(LS_LAST_MODIFIED_KEY, String(Date.now()));
    } catch { }
}

export function touchLastModified() {
    try {
        localStorage.setItem(LS_LAST_MODIFIED_KEY, String(Date.now()));
    } catch { }
}

export function loadLastModified() {
    try {
        const v = localStorage.getItem(LS_LAST_MODIFIED_KEY);
        return v ? Number(v) : null;
    } catch {
        return null;
    }
}

/**
 * Phase 2B: the catalog is now read from the shared backend.
 * loadState() is async and fetches GET /api/state, returning { data, revision }.
 * It does NOT fall back to localStorage — the app is online-only (no existing
 * offline fallback strategy), so callers must handle a rejection by showing a
 * no-connection state. Server data is re-sanitized defensively on the client.
 */
export async function loadState() {
    let res;
    try {
        res = await fetch('/api/state', { headers: { accept: 'application/json' } });
    } catch (err) {
        throw new Error('Failed to reach /api/state', { cause: err });
    }
    if (!res.ok) {
        throw new Error(`/api/state responded with status ${res.status}`);
    }
    let body;
    try {
        body = await res.json();
    } catch (err) {
        throw new Error('Invalid /api/state response (not JSON)', { cause: err });
    }
    if (!body || typeof body !== 'object' || !body.data || typeof body.data !== 'object') {
        throw new Error('Invalid /api/state response shape');
    }
    const data = migrateAndSanitize(body.data);
    const revisionNum = Number(body.revision);
    return { data, revision: Number.isFinite(revisionNum) ? revisionNum : null };
}

/**
 * Phase 2D: authenticated shared-catalog save.
 * Sends the full sanitized catalog with the revision it was based on. The
 * server enforces optimistic locking and returns 409 when another user saved
 * first. Callers decide how to surface stale_revision to the user.
 */
export async function saveState(next, revision) {
    if (typeof revision !== 'number' || !Number.isFinite(revision)) {
        const err = new Error('Cannot save before a server revision is loaded');
        err.status = 400;
        err.code = 'missing_revision';
        throw err;
    }

    const safe = migrateAndSanitize(next);
    let res;
    try {
        res = await fetch('/api/state', {
            method: 'PUT',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ data: safe, revision }),
        });
    } catch (err) {
        throw new Error('Failed to reach /api/state', { cause: err });
    }

    let body = null;
    try {
        body = await res.json();
    } catch {
        body = null;
    }

    if (!res.ok) {
        const err = new Error(body?.message || `/api/state responded with status ${res.status}`);
        err.status = res.status;
        err.body = body;
        err.code = body?.error;
        err.currentRevision = Number.isFinite(Number(body?.currentRevision)) ? Number(body.currentRevision) : null;
        throw err;
    }

    if (!body || typeof body !== 'object' || !body.data || typeof body.data !== 'object') {
        throw new Error('Invalid /api/state save response shape');
    }
    const nextRevision = Number(body.revision);
    touchLastModified();
    return {
        data: migrateAndSanitize(body.data),
        revision: Number.isFinite(nextRevision) ? nextRevision : revision,
        changes: Number.isFinite(Number(body.changes)) ? Number(body.changes) : null,
    };
}

export function serializedSizeKB(obj) {
    try {
        return new Blob([JSON.stringify(obj)]).size / 1024;
    } catch {
        return Infinity;
    }
}
