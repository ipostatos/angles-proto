import { describe, it, expect } from 'vitest';
import { handleState } from './state.js';

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
});
