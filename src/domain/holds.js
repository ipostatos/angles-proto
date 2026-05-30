export function normalizeHoldName(s) {
    return String(s || '').trim().replace(/\s+/g, ' ');
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

export function sortHolds(holds) {
    return [...holds].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
