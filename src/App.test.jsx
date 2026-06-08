import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

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
