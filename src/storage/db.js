import toast from 'react-hot-toast';
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

export function saveState(next) {
    try {
        const safe = migrateAndSanitize(next);
        localStorage.setItem(LS_KEY, JSON.stringify(safe));
        touchLastModified();
        return true;
    } catch (err) {
        if (err?.name === 'QuotaExceededError' || err?.code === 22) {
            console.warn('Storage full: image not saved. Use smaller images or remove some drawings.');
            toast.error('Storage full. Remove some drawings or upload smaller images.');
        } else {
            console.warn('Save failed:', err);
            toast.error('Could not save. Changes may be lost.');
        }
        return false;
    }
}

export function serializedSizeKB(obj) {
    try {
        return new Blob([JSON.stringify(obj)]).size / 1024;
    } catch {
        return Infinity;
    }
}
