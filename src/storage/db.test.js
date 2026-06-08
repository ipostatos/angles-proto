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

import { loadLastModified, touchLastModified, serializedSizeKB, loadState, saveState } from './db.js';

function fetchResolving(body, { ok = true, status = 200 } = {}) {
    return vi.fn(() => Promise.resolve({ ok, status, json: () => Promise.resolve(body) }));
}

const validBody = {
    data: {
        version: 2,
        holds: [{ id: 'h1', name: 'Austin' }],
        angles: [{ id: 'a1', holdId: 'h1', value: 30, saw: 'main' }],
    },
    revision: 5,
};

describe('loadState (async GET /api/state)', () => {
    it('calls GET /api/state', async () => {
        const f = fetchResolving(validBody);
        globalThis.fetch = f;
        await loadState();
        expect(f).toHaveBeenCalledWith('/api/state', expect.anything());
    });

    it('returns { data, revision }', async () => {
        globalThis.fetch = fetchResolving(validBody);
        const result = await loadState();
        expect(result.revision).toBe(5);
        expect(result.data.version).toBe(2);
        expect(result.data.holds).toHaveLength(1);
        expect(result.data.angles).toHaveLength(1);
    });

    it('throws on a non-200 response', async () => {
        globalThis.fetch = fetchResolving({}, { ok: false, status: 500 });
        await expect(loadState()).rejects.toThrow();
    });

    it('throws on an invalid response shape', async () => {
        globalThis.fetch = fetchResolving({ nope: true });
        await expect(loadState()).rejects.toThrow();
    });

    it('throws on a network error', async () => {
        globalThis.fetch = vi.fn(() => Promise.reject(new Error('offline')));
        await expect(loadState()).rejects.toThrow();
    });
});

describe('saveState (async PUT /api/state)', () => {
    it('sends data + revision to PUT /api/state and returns saved state', async () => {
        const f = fetchResolving({ ...validBody, revision: 6, changes: 1 });
        globalThis.fetch = f;
        const result = await saveState(validBody.data, 5);
        expect(f).toHaveBeenCalledWith('/api/state', expect.objectContaining({
            method: 'PUT',
            credentials: 'same-origin',
            body: JSON.stringify({ data: validBody.data, revision: 5 }),
        }));
        expect(result.revision).toBe(6);
        expect(result.changes).toBe(1);
        expect(result.data.holds).toHaveLength(1);
    });

    it('throws status/code details on stale revision', async () => {
        globalThis.fetch = fetchResolving(
            { error: 'stale_revision', message: 'Catalog changed', currentRevision: 6 },
            { ok: false, status: 409 },
        );
        await expect(saveState(validBody.data, 5)).rejects.toMatchObject({
            status: 409,
            code: 'stale_revision',
            currentRevision: 6,
        });
    });

    it('throws before fetch when revision is missing', async () => {
        const f = vi.fn();
        globalThis.fetch = f;
        await expect(saveState(validBody.data, null)).rejects.toMatchObject({ code: 'missing_revision' });
        expect(f).not.toHaveBeenCalled();
    });
});

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
