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

export function generateHoldId() {
    try {
        return `h_${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2)}`;
    } catch {
        return `h_${Math.random().toString(16).slice(2)}`;
    }
}

/**
 * Migrate v1 data (holds as strings, holdImages separate) to v2
 * (holds as objects with id/name/coverImage, angles use holdId).
 * Pure function — does not touch localStorage.
 */
export function migrateV1toV2(v1) {
    // 1. Build holds array with stable IDs
    const holdObjects = (v1.holds || []).map(name => ({
        id: generateHoldId(),
        name: String(name),
        ...(v1.holdImages?.[name] ? { coverImage: v1.holdImages[name] } : {}),
    }));

    // 2. Build name → id map for angle migration
    const nameToId = Object.fromEntries(holdObjects.map(h => [h.name, h.id]));

    // 3. Migrate angles: replace hold (name) with holdId
    const angles = (v1.angles || []).map(a => {
        const holdId = nameToId[a.hold];
        if (!holdId) return null; // orphan angle — drop
        const { hold, ...rest } = a;
        return { ...rest, holdId };
    }).filter(Boolean);

    return {
        version: 2,
        holds: holdObjects,
        angles,
    };
}

/**
 * Detect data version.
 */
export function detectVersion(data) {
    if (!data || typeof data !== 'object') return 0;
    if (data.version === 2) return 2;
    return 1; // v1 has no version or version:1
}

function sanitizeV2(data) {
    const holds = Array.isArray(data.holds)
        ? data.holds
            .filter(h => h && typeof h.id === 'string' && typeof h.name === 'string')
            .map(h => ({
                id: h.id,
                name: normalizeHoldName(h.name),
                ...(isSafeRasterDataUrl(h.coverImage) ? { coverImage: h.coverImage } : {}),
            }))
        : [];

    const holdIds = new Set(holds.map(h => h.id));

    const angles = Array.isArray(data.angles)
        ? data.angles
            .filter(a => a && typeof a.id === 'string' && holdIds.has(a.holdId))
            .map(a => ({
                id: a.id,
                holdId: a.holdId,
                value: clamp(Number(a.value) || 0, 0, 90),
                saw: a.saw === 'stefan' ? 'stefan' : 'main',
                ...(isSafeRasterDataUrl(a.drawing) ? { drawing: a.drawing } : {}),
            }))
        : [];

    return { version: 2, holds, angles };
}

/** Accepts raw db OR wrapper: { data: { holds, angles, holdImages } } */
export function unwrapImportedDb(parsed) {
    if (!parsed || typeof parsed !== 'object') return parsed;
    if (parsed.data && typeof parsed.data === 'object') return parsed.data;
    return parsed;
}

export function migrateAndSanitize(parsed) {
    // If already v2, validate and return as-is (with basic sanitization)
    if (detectVersion(parsed) === 2) {
        return sanitizeV2(parsed);
    }

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

/**
 * Find hold by ID in a v2 holds array.
 * Returns undefined if not found.
 */
export function findHoldById(holds, holdId) {
    return holds.find(h => h.id === holdId);
}

/**
 * Find hold by name in a v2 holds array (case-insensitive).
 */
export function findHoldByName(holds, name) {
    const lower = String(name).toLowerCase();
    return holds.find(h => h.name.toLowerCase() === lower);
}

/**
 * Get sorted hold names for display (v2).
 */
export function getSortedHoldNames(holds) {
    return [...holds].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );
}

/**
 * Filter angles by holdId (v2).
 */
export function getAnglesForHold(angles, holdId) {
    return angles.filter(a => a.holdId === holdId);
}

/**
 * Filter angles by saw type (v2).
 */
export function getAnglesBySaw(angles, saw) {
    return angles.filter(a => a.saw === saw);
}
