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
function makeApiRouter({ sessionUser = null, latestChange = null, loginOk = true, saveOk = true, saveStatus = 200, saveBody = null, historyRows = [] } = {}) {
    return vi.fn((url, init = {}) => {
        const method = init.method || 'GET';
        const json = (body, ok = true, status = 200) =>
            Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
        if (url === '/api/session') return json({ username: sessionUser, latestChange });
        if (url === '/api/login') {
            if (!loginOk) return json({ error: 'Invalid credentials' }, false, 401);
            const { username } = JSON.parse(init.body || '{}');
            return json({ username });
        }
        if (url === '/api/logout') return json({ ok: true });
        if (url === '/api/state' && method === 'GET') return json(sampleBody);
        if (url === '/api/state' && method === 'PUT') {
            if (!saveOk) {
                return json(saveBody || { error: 'stale_revision', currentRevision: 3 }, false, saveStatus);
            }
            const parsed = JSON.parse(init.body || '{}');
            return json(saveBody || { data: parsed.data, revision: 3, changes: 1 });
        }
        if (String(url).startsWith('/api/history') && method === 'GET') return json({ rows: historyRows });
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
        await waitFor(() => expect(screen.getByText(/no connection/i)).toBeTruthy());
        expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
    });

    it('renders the main UI after a successful load', async () => {
        globalThis.fetch = okFetch(sampleBody);
        render(<App />);
        await waitFor(() => expect(screen.getAllByText('MAIN').length).toBeGreaterThan(0));
        expect(screen.getAllByText('STEFAN').length).toBeGreaterThan(0);
        expect(screen.getByText('Austin')).toBeTruthy();
    });

    it('does not auto-save with PUT to /api/state after the initial load', async () => {
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
        expect(screen.getByPlaceholderText('Username')).toBeTruthy();
        expect(screen.getByPlaceholderText('Password')).toBeTruthy();
        // No admin surface until credentials are accepted.
        expect(screen.queryByText('EXPORT')).toBeNull();
    });

    it('unlocks admin/editing after a valid login', async () => {
        globalThis.fetch = makeApiRouter({ sessionUser: null, loginOk: true });
        render(<App />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'ADMIN' })).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: 'ADMIN' }));
        fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'Tomek' } });
        fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'Tomek' } });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
        });
        await waitFor(() => expect(window.location.hash).toBe('#/admin'));
        flushHash();
        await waitFor(() => expect(screen.getByText('EXPORT')).toBeTruthy());
        expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    });

    it('shows an error and stays locked on invalid credentials', async () => {
        globalThis.fetch = makeApiRouter({ sessionUser: null, loginOk: false });
        render(<App />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'ADMIN' })).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: 'ADMIN' }));
        fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'Tomek' } });
        fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'wrong' } });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
        });
        await waitFor(() => expect(screen.getByText(/invalid username or password/i)).toBeTruthy());
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
            fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
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
        fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'Tomek' } });
        fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'Tomek' } });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
        });
        await waitFor(() => expect(window.location.hash).toBe('#/admin'));
        const putCalls = f.mock.calls.filter(([, init]) => init && init.method === 'PUT');
        expect(putCalls).toHaveLength(0);
        expect(f.mock.calls.some(([url]) => url === '/api/login')).toBe(true);
    });
});

describe('App shared save integration (Phase 2D)', () => {
    it('saves admin edits with PUT /api/state using the loaded revision', async () => {
        const f = makeApiRouter({ sessionUser: 'Tomek' });
        globalThis.fetch = f;
        render(<App />);
        await waitFor(() => expect(screen.getAllByText('MAIN').length).toBeGreaterThan(0));

        act(() => { window.location.hash = '#/admin'; });
        flushHash();
        await waitFor(() => expect(screen.getByText('EXPORT')).toBeTruthy());

        fireEvent.change(screen.getByPlaceholderText('NEW'), { target: { value: 'Blade X' } });
        fireEvent.click(screen.getByRole('button', { name: '+' }));
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /save/i }));
        });

        await waitFor(() => {
            const putCalls = f.mock.calls.filter(([url, init]) => url === '/api/state' && init?.method === 'PUT');
            expect(putCalls).toHaveLength(1);
            const body = JSON.parse(putCalls[0][1].body);
            expect(body.revision).toBe(2);
            expect(body.data.holds.some((h) => h.name === 'Blade X')).toBe(true);
        });
        await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeTruthy());
    });

    it('keeps admin edits unsaved when the server reports a stale revision', async () => {
        const f = makeApiRouter({
            sessionUser: 'Tomek',
            saveOk: false,
            saveStatus: 409,
            saveBody: { error: 'stale_revision', message: 'Catalog changed', currentRevision: 3 },
        });
        globalThis.fetch = f;
        render(<App />);
        await waitFor(() => expect(screen.getAllByText('MAIN').length).toBeGreaterThan(0));

        act(() => { window.location.hash = '#/admin'; });
        flushHash();
        await waitFor(() => expect(screen.getByText('EXPORT')).toBeTruthy());

        fireEvent.change(screen.getByPlaceholderText('NEW'), { target: { value: 'Blade Y' } });
        fireEvent.click(screen.getByRole('button', { name: '+' }));
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /save/i }));
        });

        await waitFor(() => expect(screen.getByRole('button', { name: /save \*/i })).toBeTruthy());
        expect(screen.getByText('Blade Y')).toBeTruthy();
    });
});

describe('App history integration (Phase 3)', () => {
    it('loads and renders the authenticated admin history tab', async () => {
        const f = makeApiRouter({
            sessionUser: 'Tomek',
            historyRows: [
                {
                    id: 7,
                    username: 'Alessandro',
                    action: 'angle_changed',
                    entity: 'Austin',
                    field: 'value',
                    oldValue: '30',
                    newValue: '45',
                    createdAt: '2026-06-08T12:00:00.000Z',
                },
            ],
        });
        globalThis.fetch = f;
        render(<App />);
        await waitFor(() => expect(screen.getAllByText('MAIN').length).toBeGreaterThan(0));

        act(() => { window.location.hash = '#/admin'; });
        flushHash();
        await waitFor(() => expect(screen.getByText('EXPORT')).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: 'HISTORY' }));
        await waitFor(() => expect(screen.getByText('Alessandro')).toBeTruthy());
        expect(screen.getByText('Angle changed')).toBeTruthy();
        expect(screen.getAllByText('Austin').length).toBeGreaterThan(0);
        expect(screen.getByText('30 → 45')).toBeTruthy();
        expect(f.mock.calls.some(([url]) => String(url).startsWith('/api/history'))).toBe(true);
    });
});

describe('App latest-change startup modal (Phase 4)', () => {
    it('shows a changed-database modal for another user and OK opens history', async () => {
        const f = makeApiRouter({
            sessionUser: 'Tomek',
            latestChange: { id: 8, username: 'Alessandro', createdAt: '2026-06-08T12:00:00.000Z' },
            historyRows: [{ id: 8, username: 'Alessandro', action: 'hold_added', entity: 'Austin', createdAt: '2026-06-08T12:00:00.000Z' }],
        });
        globalThis.fetch = f;
        render(<App />);
        await waitFor(() => expect(screen.getByText('Alessandro changed the catalog')).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: 'OK' }));
        await waitFor(() => expect(window.location.hash).toBe('#/admin'));
        flushHash();
        await waitFor(() => expect(screen.getByText('Hold added')).toBeTruthy());
        expect(localStorage.getItem('angles_proto_v1_last_seen_change_id')).toBe('8');
    });

    it('does not show the changed-database modal for the current user own latest change', async () => {
        globalThis.fetch = makeApiRouter({
            sessionUser: 'Tomek',
            latestChange: { id: 9, username: 'Tomek', createdAt: '2026-06-08T12:00:00.000Z' },
        });
        render(<App />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'ADMIN' })).toBeTruthy());
        expect(screen.queryByText(/changed the catalog/i)).toBeNull();
        expect(localStorage.getItem('angles_proto_v1_last_seen_change_id')).toBe('9');
    });

    it('does not show the changed-database modal for already seen changes', async () => {
        localStorage.setItem('angles_proto_v1_last_seen_change_id', '12');
        globalThis.fetch = makeApiRouter({
            sessionUser: 'Tomek',
            latestChange: { id: 12, username: 'Artsi', createdAt: '2026-06-08T12:00:00.000Z' },
        });
        render(<App />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'ADMIN' })).toBeTruthy());
        expect(screen.queryByText(/changed the catalog/i)).toBeNull();
    });
});
