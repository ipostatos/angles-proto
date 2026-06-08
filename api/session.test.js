import { describe, it, expect } from 'vitest';
import { handleSession } from './session.js';
import { signSession, buildSessionCookie } from './_lib/session.js';

function mockRes() {
    return {
        statusCode: null,
        body: undefined,
        status(code) { this.statusCode = code; return this; },
        json(obj) { this.body = obj; return this; },
    };
}

const explodingStore = {
    readLatestChange() { throw new Error('store should not be touched'); },
};

describe('/api/session', () => {
    it('returns null user and does not touch the store without a session', async () => {
        const res = mockRes();
        await handleSession({ method: 'GET', headers: {} }, res, explodingStore);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ username: null, latestChange: null });
    });

    it('rejects invalid methods with 405', async () => {
        const res = mockRes();
        await handleSession({ method: 'POST', headers: {} }, res, explodingStore);
        expect(res.statusCode).toBe(405);
    });

    it('returns latestChange for a valid session', async () => {
        process.env.SESSION_SECRET = 'test-secret';
        const latestChange = { id: 12, username: 'Alessandro', createdAt: '2026-06-08T12:00:00.000Z' };
        const store = { async readLatestChange() { return latestChange; } };
        const token = signSession('Tomek', { secret: 'test-secret' });
        const cookie = buildSessionCookie(token, { secure: false });
        const res = mockRes();
        await handleSession({ method: 'GET', headers: { cookie } }, res, store);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ username: 'Tomek', latestChange });
    });
});
