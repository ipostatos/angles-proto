import { describe, it, expect } from 'vitest';
import {
    rateLimitKey,
    isRateLimited,
    recordFailure,
    clearFailures,
    LOGIN_MAX_FAILURES,
} from './rateLimit.js';

describe('rateLimitKey', () => {
    it('combines ip and lowercased username', () => {
        expect(rateLimitKey('203.0.113.5', 'Tomek')).toBe('203.0.113.5:tomek');
    });

    it('falls back to "unknown" for a missing ip', () => {
        expect(rateLimitKey('', 'Tomek')).toBe('unknown:tomek');
    });
});

describe('isRateLimited', () => {
    it('is true once the count reaches the limit', async () => {
        const store = { getFailureCount: async () => LOGIN_MAX_FAILURES };
        expect(await isRateLimited(store, 'k', 0)).toBe(true);
    });

    it('is false below the limit', async () => {
        const store = { getFailureCount: async () => LOGIN_MAX_FAILURES - 1 };
        expect(await isRateLimited(store, 'k', 0)).toBe(false);
    });

    it('fails open when the store throws', async () => {
        const store = { getFailureCount: async () => { throw new Error('down'); } };
        expect(await isRateLimited(store, 'k', 0)).toBe(false);
    });
});

describe('recordFailure / clearFailures', () => {
    it('forwards window to the store', async () => {
        let captured;
        const store = { recordFailure: async (key, now, windowMs) => { captured = { key, now, windowMs }; } };
        await recordFailure(store, 'k', 100, { windowMs: 5000 });
        expect(captured).toEqual({ key: 'k', now: 100, windowMs: 5000 });
    });

    it('swallows store errors on record', async () => {
        const store = { recordFailure: async () => { throw new Error('down'); } };
        await expect(recordFailure(store, 'k', 0)).resolves.toBeUndefined();
    });

    it('swallows store errors on clear', async () => {
        const store = { clearFailures: async () => { throw new Error('down'); } };
        await expect(clearFailures(store, 'k')).resolves.toBeUndefined();
    });
});
