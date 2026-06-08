import { beforeEach, describe, it, expect, vi } from 'vitest';
import { hashPassword } from './_lib/password.js';
import { clearLoginRateLimitForTests, handleLogin, LOGIN_MAX_FAILURES } from './login.js';

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

beforeEach(() => {
    process.env.SESSION_SECRET = 'login-route-test-secret';
    clearLoginRateLimitForTests();
});

describe('/api/login', () => {
    it('sets a session cookie for valid credentials', async () => {
        const { hash, salt } = hashPassword('Tomek');
        const lookupUser = vi.fn(async () => ({ username: 'Tomek', pass_hash: hash, salt }));
        const res = mockRes();

        await handleLogin(req({ username: ' Tomek ', password: 'Tomek' }), res, { lookupUser });

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ username: 'Tomek' });
        expect(res.headers['Set-Cookie']).toContain('angles_session=');
        expect(lookupUser).toHaveBeenCalledWith('Tomek');
    });

    it('rejects oversized login bodies before credential lookup', async () => {
        const lookupUser = vi.fn();
        const res = mockRes();

        await handleLogin(req({ username: 'Tomek', password: 'x'.repeat(20 * 1024) }), res, { lookupUser });

        expect(res.statusCode).toBe(413);
        expect(res.body.error).toBe('payload_too_large');
        expect(lookupUser).not.toHaveBeenCalled();
    });

    it('rate limits repeated failed attempts for the same IP and username', async () => {
        const lookupUser = vi.fn(async () => null);
        for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) {
            const res = mockRes();
            await handleLogin(req({ username: 'Tomek', password: 'wrong' }), res, { lookupUser, now: 1000 });
            expect(res.statusCode).toBe(401);
        }

        const locked = mockRes();
        await handleLogin(req({ username: 'Tomek', password: 'wrong' }), locked, { lookupUser, now: 1000 });

        expect(locked.statusCode).toBe(429);
        expect(locked.body.error).toBe('too_many_attempts');
        expect(lookupUser).toHaveBeenCalledTimes(LOGIN_MAX_FAILURES);
    });
});
