import { describe, it, expect, vi, afterEach } from 'vitest';
import { getSession, login, logout } from './auth.js';

function jsonResponse(body, { ok = true, status = 200 } = {}) {
    return Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
}

afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.fetch;
});

describe('getSession', () => {
    it('returns the username when a session is present', async () => {
        const f = vi.fn(() => jsonResponse({ username: 'Tomek' }));
        globalThis.fetch = f;
        const result = await getSession();
        expect(f).toHaveBeenCalledWith('/api/session', expect.objectContaining({ method: 'GET' }));
        expect(result.username).toBe('Tomek');
    });

    it('passes through latestChange when present', async () => {
        const latestChange = { id: 4, username: 'Artsi', createdAt: '2026-06-08T12:00:00.000Z' };
        globalThis.fetch = vi.fn(() => jsonResponse({ username: 'Tomek', latestChange }));
        const result = await getSession();
        expect(result.latestChange).toEqual(latestChange);
    });

    it('returns null username when no session is present', async () => {
        globalThis.fetch = vi.fn(() => jsonResponse({ username: null }));
        const result = await getSession();
        expect(result.username).toBeNull();
    });

    it('throws when /api/session is not ok', async () => {
        globalThis.fetch = vi.fn(() => jsonResponse({}, { ok: false, status: 500 }));
        await expect(getSession()).rejects.toThrow();
    });
});

describe('login', () => {
    it('posts credentials and returns the username on success', async () => {
        const f = vi.fn(() => jsonResponse({ username: 'Alessandro' }));
        globalThis.fetch = f;
        const result = await login('Alessandro', 'Alessandro');
        expect(f).toHaveBeenCalledWith('/api/login', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ username: 'Alessandro', password: 'Alessandro' }),
        }));
        expect(result.username).toBe('Alessandro');
    });

    it('rejects with status 401 on invalid credentials', async () => {
        globalThis.fetch = vi.fn(() => jsonResponse({ error: 'Invalid credentials' }, { ok: false, status: 401 }));
        await expect(login('Tomek', 'wrong')).rejects.toMatchObject({ status: 401 });
    });

    it('rejects on a server error', async () => {
        globalThis.fetch = vi.fn(() => jsonResponse({ error: 'Server error' }, { ok: false, status: 500 }));
        await expect(login('Tomek', 'Tomek')).rejects.toThrow();
    });

    it('does not persist the password to web storage', async () => {
        const setItem = vi.fn();
        vi.stubGlobal('localStorage', { setItem, getItem: () => null, removeItem: () => {} });
        vi.stubGlobal('sessionStorage', { setItem, getItem: () => null, removeItem: () => {} });
        globalThis.fetch = vi.fn(() => jsonResponse({ username: 'Tomek' }));
        await login('Tomek', 'Tomek');
        expect(setItem).not.toHaveBeenCalled();
    });
});

describe('logout', () => {
    it('posts to /api/logout and resolves on success', async () => {
        const f = vi.fn(() => jsonResponse({ ok: true }));
        globalThis.fetch = f;
        await expect(logout()).resolves.toBe(true);
        expect(f).toHaveBeenCalledWith('/api/logout', expect.objectContaining({ method: 'POST' }));
    });

    it('throws on a non-ok response', async () => {
        globalThis.fetch = vi.fn(() => jsonResponse({}, { ok: false, status: 500 }));
        await expect(logout()).rejects.toThrow();
    });
});
