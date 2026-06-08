import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadHistory } from './history.js';

function jsonResponse(body, { ok = true, status = 200 } = {}) {
    return Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
}

afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.fetch;
});

describe('loadHistory', () => {
    it('calls GET /api/history with same-origin credentials', async () => {
        const f = vi.fn(() => jsonResponse({ rows: [{ id: 1, username: 'Tomek', action: 'hold_added' }] }));
        globalThis.fetch = f;
        const rows = await loadHistory(50);
        expect(f).toHaveBeenCalledWith('/api/history?limit=50', expect.objectContaining({
            method: 'GET',
            credentials: 'same-origin',
        }));
        expect(rows[0]).toMatchObject({ id: 1, username: 'Tomek', action: 'hold_added' });
    });

    it('throws with status on non-ok responses', async () => {
        globalThis.fetch = vi.fn(() => jsonResponse({ error: 'unauthorized' }, { ok: false, status: 401 }));
        await expect(loadHistory()).rejects.toMatchObject({ status: 401 });
    });

    it('throws on an invalid response shape', async () => {
        globalThis.fetch = vi.fn(() => jsonResponse({ nope: true }));
        await expect(loadHistory()).rejects.toThrow(/shape/i);
    });
});
