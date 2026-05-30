import toast from 'react-hot-toast';
import { migrateAndSanitize, DEFAULT_HOLDS, DEFAULT_ANGLES, LS_VERSION } from '../domain/migration.js';
import { migrateV1toV2, detectVersion } from '../domain/migration.js';

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

export function loadState() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) {
            const v1init = {
                version: 1,
                holds: DEFAULT_HOLDS,
                angles: DEFAULT_ANGLES,
                holdImages: {},
            };
            const init = migrateAndSanitize(migrateV1toV2(v1init));
            localStorage.setItem(LS_KEY, JSON.stringify(init));
            localStorage.setItem(LS_LAST_MODIFIED_KEY, String(Date.now()));
            return init;
        }

        const parsed = JSON.parse(raw);

        // Upgrade v1 → v2 if needed
        const upgraded = detectVersion(parsed) < 2 ? migrateV1toV2(parsed) : parsed;

        const next = migrateAndSanitize(upgraded);

        localStorage.setItem(LS_KEY, JSON.stringify(next));
        ensureLastModifiedExists();
        return next;
    } catch {
        // Data is unreadable. Preserve the original bytes for recovery instead of
        // silently overwriting them, and DON'T touch LS_KEY here so the user can
        // still export/inspect the corrupt payload. Keep only the newest copy.
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) {
                for (let i = localStorage.length - 1; i >= 0; i--) {
                    const k = localStorage.key(i);
                    if (k && k.startsWith(`${LS_CORRUPT_KEY}_`)) localStorage.removeItem(k);
                }
                localStorage.setItem(`${LS_CORRUPT_KEY}_${Date.now()}`, raw);
            }
        } catch { }
        didRecoverFromCorrupt = true;
        return migrateAndSanitize({
            version: LS_VERSION,
            holds: DEFAULT_HOLDS,
            angles: DEFAULT_ANGLES,
            holdImages: {},
        });
    }
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
