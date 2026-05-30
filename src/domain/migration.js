// Migration and sanitization logic extracted from App.jsx

function normalizeHoldName(s) {
    return String(s || '').trim().replace(/\s+/g, ' ');
}

export function sortHolds(holds) {
    return [...holds].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function sanitizeHoldList(holds) {
    const arr = Array.isArray(holds) ? holds : [];
    const cleaned = arr.map(normalizeHoldName).filter(Boolean);

    const seen = new Set();
    const unique = [];
    for (const h of cleaned) {
        const key = h.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(h);
    }
    return sortHolds(unique);
}

export function isSafeRasterDataUrl(s) {
    return typeof s === 'string' && /^data:image\/(png|jpe?g|webp|gif);/i.test(s);
}

function cryptoRandomId() {
    try {
        return globalThis.crypto?.randomUUID?.() ?? `id_${Math.random().toString(16).slice(2)}`;
    } catch {
        return `id_${Math.random().toString(16).slice(2)}`;
    }
}

export const LS_VERSION = 1;

export const DEFAULT_HOLDS = ['Anton'];

export const DEFAULT_ANGLES = [
    { id: cryptoRandomId(), hold: 'Austin', value: 28.2, saw: 'main' },
    { id: cryptoRandomId(), hold: 'Avalon Flat', value: 65.0, saw: 'main' },
    { id: cryptoRandomId(), hold: 'Austin', value: 65.3, saw: 'main' },
    { id: cryptoRandomId(), hold: 'Avalon SuperFlat', value: 30.0, saw: 'stefan' },
    { id: cryptoRandomId(), hold: 'Amon', value: 50.0, saw: 'stefan' },
];

function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
}

function sanitizeAngle(a, holdsSet) {
    const hold = normalizeHoldName(a?.hold);
    const saw = a?.saw === 'stefan' ? 'stefan' : 'main';

    const raw = a?.value;
    const num = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(',', '.'));
    const value = Number.isFinite(num) ? clamp(num, 0, 90) : 0;

    const id = typeof a?.id === 'string' && a.id.trim() ? a.id : cryptoRandomId();

    const drawing = isSafeRasterDataUrl(a?.drawing) ? a.drawing : undefined;

    if (!hold || !holdsSet.has(hold)) return null;

    return { id, hold, value, saw, ...(drawing ? { drawing } : {}) };
}

/** Accepts raw db OR wrapper: { data: { holds, angles, holdImages } } */
export function unwrapImportedDb(parsed) {
    if (!parsed || typeof parsed !== 'object') return parsed;
    if (parsed.data && typeof parsed.data === 'object') return parsed.data;
    return parsed;
}

export function migrateAndSanitize(parsed) {
    const unwrapped = unwrapImportedDb(parsed);

    const holds = sanitizeHoldList(unwrapped?.holds ?? DEFAULT_HOLDS);
    const holdsSet = new Set(holds);

    const anglesRaw = Array.isArray(unwrapped?.angles) ? unwrapped.angles : [];

    const angles = [];
    const ids = new Set();

    for (const a of anglesRaw) {
        const sa = sanitizeAngle(a, holdsSet);
        if (!sa) continue;
        if (ids.has(sa.id)) sa.id = cryptoRandomId();
        ids.add(sa.id);
        angles.push(sa);
    }

    const rawHoldImages =
        unwrapped?.holdImages && typeof unwrapped.holdImages === 'object' ? unwrapped.holdImages : {};
    const holdImages = {};
    for (const h of holds) {
        const v = rawHoldImages[h];
        if (isSafeRasterDataUrl(v)) {
            holdImages[h] = v;
        }
    }

    return { version: LS_VERSION, holds, angles, holdImages };
}
