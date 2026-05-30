import { describe, it, expect, beforeEach } from 'vitest';
import { sha256Hex } from './auth.js';

describe('sha256Hex', () => {
    it('returns a 64-char hex string', async () => {
        const result = await sha256Hex('test');
        expect(result).toHaveLength(64);
        expect(/^[0-9a-f]+$/.test(result)).toBe(true);
    });
    it('is deterministic', async () => {
        const a = await sha256Hex('hello');
        const b = await sha256Hex('hello');
        expect(a).toBe(b);
    });
    it('different inputs produce different hashes', async () => {
        const a = await sha256Hex('hello');
        const b = await sha256Hex('world');
        expect(a).not.toBe(b);
    });
});
