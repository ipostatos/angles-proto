import { describe, it, expect, beforeEach, vi } from 'vitest';

// Provide a localStorage stub before importing db.js so the module
// picks up the global when it first runs.
const store = new Map();
const localStorageMock = {
    getItem: (k) => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
};
vi.stubGlobal('localStorage', localStorageMock);

import { loadLastModified, touchLastModified, serializedSizeKB } from './db.js';

describe('loadLastModified', () => {
    beforeEach(() => store.clear());

    it('returns null when key absent', () => {
        expect(loadLastModified()).toBeNull();
    });

    it('returns number after touchLastModified', () => {
        touchLastModified();
        expect(typeof loadLastModified()).toBe('number');
    });
});

describe('serializedSizeKB', () => {
    it('returns a finite number for a plain object', () => {
        const kb = serializedSizeKB({ holds: ['Austin'], angles: [] });
        expect(Number.isFinite(kb)).toBe(true);
        expect(kb).toBeGreaterThan(0);
    });
});
