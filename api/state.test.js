import { describe, it, expect } from 'vitest';
import { handleState } from './state.js';
import { buildSessionCookie, signSession } from './_lib/session.js';

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

// store that throws if touched — proves these paths short-circuit before any DB access
const explodingStore = {
    readState() { throw new Error('store should not be touched'); },
    initState() { throw new Error('store should not be touched'); },
    commitWrite() { throw new Error('store should not be touched'); },
};

describe('/api/state route guards', () => {
    it('rejects an unauthenticated PUT with 401', async () => {
        const req = { method: 'PUT', headers: {} }; // no cookie
        const res = mockRes();
        await handleState(req, res, explodingStore);
        expect(res.statusCode).toBe(401);
    });

    it('rejects an invalid method with 405', async () => {
        for (const method of ['POST', 'DELETE', 'PATCH']) {
            const res = mockRes();
            await handleState({ method, headers: {} }, res, explodingStore);
            expect(res.statusCode).toBe(405);
        }
    });

    it('rejects an oversized PUT body with 413 before storage work', async () => {
        const token = signSession('Tomek', { secret: 'state-route-test-secret' });
        process.env.SESSION_SECRET = 'state-route-test-secret';
        const res = mockRes();
        await handleState({
            method: 'PUT',
            headers: { cookie: buildSessionCookie(token, { secure: false }) },
            body: JSON.stringify({ data: { holds: [], angles: [] }, revision: 1, pad: 'x'.repeat(6 * 1024 * 1024) }),
        }, res, explodingStore);
        expect(res.statusCode).toBe(413);
        expect(res.body.error).toBe('payload_too_large');
    });
});
