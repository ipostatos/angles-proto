import { beforeEach, describe, it, expect, vi } from 'vitest';
import { hashPassword } from './_lib/password.js';
import { handleLogin, LOGIN_MAX_FAILURES } from './login.js';
import { LOGIN_RATE_LIMIT_WINDOW_MS } from './_lib/rateLimit.js';

// In-memory fake of the throttle store contract, mirroring neonRateLimitStore's
// sliding-window semantics so the route tests exercise the real policy.
function fakeRateStore() {
    const rows = new Map();
    return {
        async getFailureCount(key, now) {
            const row = rows.get(key);
            return row && row.resetAt > now ? row.count : 0;
        },
        async recordFailure(key, now, windowMs) {
            const row = rows.get(key);
            if (!row || row.resetAt <= now) {
                rows.set(key, { count: 1, resetAt: now + windowMs });
            } else {
                row.count += 1;
            }
        },
        async clearFailures(key) {
            rows.delete(key);
        },
    };
}

function mockRes() {
    return {
        statusCode: null,
        headers: {},
        body: undefined,
        status(code) { this.statusCode = code; return this; },
        setHeader(k, v) { this.headers[k] = v; },
        json(obj) { this.body = obj; return this; },
    };
}

function req(body, ip = '203.0.113.10') {
    return {
        method: 'POST',
        headers: { 'x-forwarded-for': ip },
        body: JSON.stringify(body),
    };
}

let rateStore;
beforeEach(() => {
    process.env.SESSION_SECRET = 'login-route-test-secret';
    rateStore = fakeRateStore();
});

describe('/api/login', () => {
    it('sets a session cookie for valid credentials', async () => {
        const { hash, salt } = hashPassword('Tomek');
        const lookupUser = vi.fn(async () => ({ username: 'Tomek', pass_hash: hash, salt }));
        const res = mockRes();

        await handleLogin(req({ username: ' Tomek ', password: 'Tomek' }), res, { lookupUser, rateStore });

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ username: 'Tomek' });
        expect(res.headers['Set-Cookie']).toContain('angles_session=');
        expect(lookupUser).toHaveBeenCalledWith('Tomek');
    });

    it('rejects oversized login bodies before credential lookup', async () => {
        const lookupUser = vi.fn();
        const res = mockRes();

        await handleLogin(req({ username: 'Tomek', password: 'x'.repeat(20 * 1024) }), res, { lookupUser, rateStore });

        expect(res.statusCode).toBe(413);
        expect(res.body.error).toBe('payload_too_large');
        expect(lookupUser).not.toHaveBeenCalled();
    });

    it('rate limits repeated failed attempts for the same IP and username', async () => {
        const lookupUser = vi.fn(async () => null);
        for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) {
            const res = mockRes();
            await handleLogin(req({ username: 'Tomek', password: 'wrong' }), res, { lookupUser, rateStore, now: 1000 });
            expect(res.statusCode).toBe(401);
        }

        const locked = mockRes();
        await handleLogin(req({ username: 'Tomek', password: 'wrong' }), locked, { lookupUser, rateStore, now: 1000 });

        expect(locked.statusCode).toBe(429);
        expect(locked.body.error).toBe('too_many_attempts');
        expect(lookupUser).toHaveBeenCalledTimes(LOGIN_MAX_FAILURES);
    });

    it('lets attempts through again after the window expires', async () => {
        const lookupUser = vi.fn(async () => null);
        for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) {
            await handleLogin(req({ username: 'Tomek', password: 'wrong' }), mockRes(), { lookupUser, rateStore, now: 1000 });
        }
        const lockedNow = mockRes();
        await handleLogin(req({ username: 'Tomek', password: 'wrong' }), lockedNow, { lookupUser, rateStore, now: 1000 });
        expect(lockedNow.statusCode).toBe(429);

        // Past the window, the counter resets and a new attempt is allowed.
        const afterWindow = mockRes();
        await handleLogin(
            req({ username: 'Tomek', password: 'wrong' }),
            afterWindow,
            { lookupUser, rateStore, now: 1000 + LOGIN_RATE_LIMIT_WINDOW_MS + 1 },
        );
        expect(afterWindow.statusCode).toBe(401);
    });

    it('does not lock out when the throttle store is unavailable (fail open)', async () => {
        const { hash, salt } = hashPassword('Tomek');
        const lookupUser = vi.fn(async () => ({ username: 'Tomek', pass_hash: hash, salt }));
        const brokenStore = {
            getFailureCount: async () => { throw new Error('db down'); },
            recordFailure: async () => { throw new Error('db down'); },
            clearFailures: async () => { throw new Error('db down'); },
        };
        const res = mockRes();

        await handleLogin(req({ username: 'Tomek', password: 'Tomek' }), res, { lookupUser, rateStore: brokenStore });

        expect(res.statusCode).toBe(200);
    });
});
