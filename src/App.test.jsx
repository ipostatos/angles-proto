import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';

// Map-backed localStorage stub so device-local reads/writes are deterministic.
const lsStore = new Map();
vi.stubGlobal('localStorage', {
    getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
    setItem: (k, v) => lsStore.set(k, String(v)),
    removeItem: (k) => lsStore.delete(k),
    clear: () => lsStore.clear(),
    get length() { return lsStore.size; },
    key: (i) => [...lsStore.keys()][i] ?? null,
});

import App from './App.jsx';
import { LS_WORK_PROGRESS_KEY } from './storage/workProgress.js';

const sampleBody = {
    data: {
        version: 2,
        holds: [{ id: 'h1', name: 'Austin' }],
        angles: [{ id: 'a1', holdId: 'h1', value: 30, saw: 'main' }],
    },
    revision: 2,
};

function okFetch(body) {
    return vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }));
}

/**
 * Routes the four same-origin endpoints App touches so auth + catalog can be
 * driven independently. `sessionUser` controls who /api/session reports;
 * `loginOk` controls whether /api/login succeeds (else 401).
 */
function makeApiRouter({ sessionUser = null, loginOk = true } = {}) {
    return vi.fn((url, init = {}) => {
        const method = init.method || 'GET';
        const json = (body, ok = true, status = 200) =>
            Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
        if (url === '/api/session') return json({ username: sessionUser });
        if (url === '/api/login') {
            if (!loginOk) return json({ error: 'Invalid credentials' }, false, 401);
            const { username } = JSON.parse(init.body || '{}');
            return json({ username });
        }
        if (url === '/api/logout') return json({ ok: true });
        if (url === '/api/state' && method === 'GET') return json(sampleBody);
        return Promise.reject(new Error(`unexpected fetch: ${method} ${url}`));
    });
}

// jsdom dispatches hashchange on assignment, but force it so route updates are
// deterministic regardless of timing.
function flushHash() {
    act(() => { window.dispatchEvent(new Event('hashchange')); });
}

afterEach(() => {
    cleanup();
    lsStore.clear();
    vi.restoreAllMocks();
    window.location.hash = '';
});

describe('App initial catalog load (Phase 2B read integration)', () => {
    it('shows a loading state before data arrives', () => {
        globalThis.fetch = vi.fn(() => new Promise(() => {})); // never resolves
        render(<App />);
        expect(screen.getByText(/loading/i)).toBeTruthy();
    });

    it('shows a no-connection state when the load fails', async () => {
        globalThis.fetch = vi.fn(() => Promise.reject(new Error('offline')));
        render(<App />);
        await waitFor(() => expect(screen.getByText(/нет связи/i)).toBeTruthy());
        expect(screen.getByRole('button', { name: /повторить/i })).toBeTruthy();
    });

    it('renders the main UI after a successful load', async () => {
        globalThis.fetch = okFetch(sampleBody);
        render(<App />);
        await waitFor(() => expect(screen.getAllByText('MAIN').length).toBeGreaterThan(0));
        expect(screen.getAllByText('STEFAN').length).toBeGreaterThan(0);
        expect(screen.getByText('Austin')).toBeTruthy();
    });

    it('does not send a PUT to /api/state during this phase', async () => {
        const f = okFetch(sampleBody);
        globalThis.fetch = f;
        render(<App />);
        await waitFor(() => expect(screen.getAllByText('MAIN').length).toBeGreaterThan(0));
        const putCalls = f.mock.calls.filter(([, init]) => init && init.method === 'PUT');
        expect(putCalls).toHaveLength(0);
    });

    it('keeps device-local work progress (localStorage) available after load', async () => {
        localStorage.setItem(LS_WORK_PROGRESS_KEY, JSON.stringify({
            holds: ['h1'], checked: ['a1'], mode: 'all', savedAt: Date.now(),
        }));
        globalThis.fetch = okFetch(sampleBody);
        render(<App />);
        await waitFor(() => expect(screen.getAllByText('MAIN').length).toBeGreaterThan(0));
        expect(screen.getByText(/resume/i)).toBeTruthy();
    });
});

describe('App auth/session integration (Phase 2C)', () => {
    it('checks the session on startup via GET /api/session', async () => {
        const f = makeApiRouter({ sessionUser: null });
        globalThis.fetch = f;
        render(<App />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'ADMIN' })).toBeTruthy());
        expect(f.mock.calls.some(([url]) => url === '/api/session')).toBe(true);
    });

    it('renders the public catalog without a login', async () => {
        globalThis.fetch = makeApiRouter({ sessionUser: null });
        render(<App />);
        await waitFor(() => expect(screen.getAllByText('MAIN').length).toBeGreaterThan(0));
        expect(screen.getByText('Austin')).toBeTruthy();
        // No admin surface for a public viewer.
        expect(screen.queryByText('EXPORT')).toBeNull();
    });

    it('shows the login form when an unauthenticated user opens admin', async () => {
        globalThis.fetch = makeApiRouter({ sessionUser: null });
        render(<App />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'ADMIN' })).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: 'ADMIN' }));
        expect(screen.getByPlaceholderText('Логин')).toBeTruthy();
        expect(screen.getByPlaceholderText('Пароль')).toBeTruthy();
        // No admin surface until credentials are accepted.
        expect(screen.queryByText('EXPORT')).toBeNull();
    });

    it('unlocks admin/editing after a valid login', async () => {
        globalThis.fetch = makeApiRouter({ sessionUser: null, loginOk: true });
        render(<App />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'ADMIN' })).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: 'ADMIN' }));
        fireEvent.change(screen.getByPlaceholderText('Логин'), { target: { value: 'Tomek' } });
        fireEvent.change(screen.getByPlaceholderText('Пароль'), { target: { value: 'Tomek' } });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
        });
        await waitFor(() => expect(window.location.hash).toBe('#/admin'));
        flushHash();
        await waitFor(() => expect(screen.getByText('EXPORT')).toBeTruthy());
        expect(screen.getByRole('button', { name: 'Выйти' })).toBeTruthy();
    });

    it('shows an error and stays locked on invalid credentials', async () => {
        globalThis.fetch = makeApiRouter({ sessionUser: null, loginOk: false });
        render(<App />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'ADMIN' })).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: 'ADMIN' }));
        fireEvent.change(screen.getByPlaceholderText('Логин'), { target: { value: 'Tomek' } });
        fireEvent.change(screen.getByPlaceholderText('Пароль'), { target: { value: 'wrong' } });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
        });
        await waitFor(() => expect(screen.getByText(/неверный логин или пароль/i)).toBeTruthy());
        expect(screen.queryByText('EXPORT')).toBeNull();
    });

    it('locks admin/editing again after logout', async () => {
        globalThis.fetch = makeApiRouter({ sessionUser: 'Tomek' });
        render(<App />);
        await waitFor(() => expect(screen.getAllByText('MAIN').length).toBeGreaterThan(0));

        // Authenticated session → opening admin renders the editor.
        act(() => { window.location.hash = '#/admin'; });
        flushHash();
        await waitFor(() => expect(screen.getByText('EXPORT')).toBeTruthy());

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
        });
        await waitFor(() => expect(window.location.hash === '#/' || window.location.hash === '').toBe(true));
        flushHash();
        await waitFor(() => expect(screen.getByRole('button', { name: 'ADMIN' })).toBeTruthy());
        expect(screen.queryByText('EXPORT')).toBeNull();
    });

    it('never sends a PUT to /api/state during the auth flow', async () => {
        const f = makeApiRouter({ sessionUser: null, loginOk: true });
        globalThis.fetch = f;
        render(<App />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'ADMIN' })).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: 'ADMIN' }));
        fireEvent.change(screen.getByPlaceholderText('Логин'), { target: { value: 'Tomek' } });
        fireEvent.change(screen.getByPlaceholderText('Пароль'), { target: { value: 'Tomek' } });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
        });
        await waitFor(() => expect(window.location.hash).toBe('#/admin'));
        const putCalls = f.mock.calls.filter(([, init]) => init && init.method === 'PUT');
        expect(putCalls).toHaveLength(0);
        expect(f.mock.calls.some(([url]) => url === '/api/login')).toBe(true);
    });
});
