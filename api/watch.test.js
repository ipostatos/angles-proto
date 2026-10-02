import { describe, it, expect } from 'vitest';
import { handleWatch, toWatchCatalog } from './watch.js';

function mockRes() {
    return {
        statusCode: null,
        body: undefined,
        status(code) { this.statusCode = code; return this; },
        json(obj) { this.body = obj; return this; },
    };
}

const data = {
    version: 2,
    holds: [{ id: 'b', name: 'Base 15', coverImage: 'data:x' }, { id: 'a', name: 'Amon' }],
    angles: [
        { id: '1', holdId: 'a', value: 39.8, saw: 'main' },
        { id: '2', holdId: 'a', value: 24.7, saw: 'main' },
        { id: '3', holdId: 'a', value: 32, saw: 'stefan' },
        { id: '4', holdId: 'b', value: 15, saw: 'stefan' },
    ],
};
const stateStore = { readState: async () => ({ data, revision: 7 }), initState: async () => ({ data, revision: 7 }) };

function memoryWatchStore() {
    return {
        sel: null,
        async read() { return this.sel; },
        async write(holds) { this.sel = { holds, sentAt: 123 }; return 123; },
    };
}

describe('/api/watch', () => {
    it('compacts the catalog without images, sorted by name', () => {
        expect(toWatchCatalog(data)).toEqual([
            ['Amon', [24.7, 39.8], [32]],
            ['Base 15', [], [15]],
        ]);
    });

    it('GET returns catalog and empty selection by default', async () => {
        const res = mockRes();
        await handleWatch({ method: 'GET', headers: {} }, res, stateStore, memoryWatchStore());
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ r: 7, s: [], t: 0 });
        expect(res.body.h).toHaveLength(2);
    });

    it('POST stores only known hold names, then GET returns them', async () => {
        const ws = memoryWatchStore();
        const post = mockRes();
        await handleWatch({ method: 'POST', headers: {}, body: { holds: ['Amon', 'Nope', 'Amon', 5] } }, post, stateStore, ws);
        expect(post.statusCode).toBe(200);
        expect(post.body).toEqual({ ok: true, count: 1, t: 123 });

        const get = mockRes();
        await handleWatch({ method: 'GET', headers: {} }, get, stateStore, ws);
        expect(get.body).toMatchObject({ s: ['Amon'], t: 123 });
    });

    it('POST rejects a non-array body with 400', async () => {
        const res = mockRes();
        await handleWatch({ method: 'POST', headers: {}, body: { holds: 'Amon' } }, res, stateStore, memoryWatchStore());
        expect(res.statusCode).toBe(400);
    });

    it('rejects other methods with 405', async () => {
        const res = mockRes();
        await handleWatch({ method: 'DELETE', headers: {} }, res, stateStore, memoryWatchStore());
        expect(res.statusCode).toBe(405);
    });
});
