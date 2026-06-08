import { Readable } from 'node:stream';
import { describe, it, expect } from 'vitest';
import { PayloadTooLargeError, readJsonBody } from './http.js';

function reqFromString(value) {
    return Readable.from([value]);
}

describe('readJsonBody', () => {
    it('parses JSON string bodies', async () => {
        await expect(readJsonBody({ body: '{"ok":true}' })).resolves.toEqual({ ok: true });
    });

    it('returns {} for invalid JSON', async () => {
        await expect(readJsonBody({ body: '{bad' })).resolves.toEqual({});
    });

    it('rejects string bodies over the configured byte limit', async () => {
        await expect(readJsonBody({ body: '{"x":"12345"}' }, { maxBytes: 8 })).rejects.toBeInstanceOf(PayloadTooLargeError);
    });

    it('rejects streamed bodies over the configured byte limit', async () => {
        await expect(readJsonBody(reqFromString('{"x":"12345"}'), { maxBytes: 8 })).rejects.toBeInstanceOf(PayloadTooLargeError);
    });
});
