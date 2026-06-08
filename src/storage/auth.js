/**
 * Phase 2C: frontend auth/session client.
 *
 * Talks to the same-origin Vercel Functions backend:
 *   GET  /api/session  → { username: string | null, latestChange?: ... }
 *   POST /api/login    → { username }  (401 on bad credentials)
 *   POST /api/logout   → { ok: true }
 *
 * The session itself is a server-set httpOnly cookie — it is never read,
 * written, or stored on the client. No password is persisted client-side;
 * credentials are sent once to /api/login and then discarded. Requests are
 * same-origin so the cookie is attached automatically (credentials: same-origin),
 * and the strict CSP (connect-src 'self') is not weakened.
 */

const JSON_HEADERS = { 'content-type': 'application/json', accept: 'application/json' };

/** GET /api/session — who am I (+ latest change summary, used from Phase 4). */
export async function getSession() {
    const res = await fetch('/api/session', {
        method: 'GET',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
    });
    if (!res.ok) {
        throw new Error(`/api/session responded with status ${res.status}`);
    }
    const body = await res.json();
    return {
        username: body?.username ?? null,
        latestChange: body?.latestChange ?? null,
    };
}

/**
 * POST /api/login — verify credentials server-side and set the session cookie.
 * Resolves to { username } on success. Rejects with an Error whose `.status`
 * is 401 on invalid credentials (so the UI can show a credentials error),
 * or the HTTP status for other failures.
 */
export async function login(username, password) {
    const res = await fetch('/api/login', {
        method: 'POST',
        headers: JSON_HEADERS,
        credentials: 'same-origin',
        body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
        const err = new Error(res.status === 401 ? 'Invalid credentials' : `Login failed (${res.status})`);
        err.status = res.status;
        throw err;
    }
    const body = await res.json();
    return { username: body?.username ?? username };
}

/** POST /api/logout — clear the session cookie server-side. */
export async function logout() {
    const res = await fetch('/api/logout', {
        method: 'POST',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
    });
    if (!res.ok) {
        throw new Error(`/api/logout responded with status ${res.status}`);
    }
    return true;
}
