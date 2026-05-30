import { describe, it, expect } from 'vitest';
import { serializedSizeKB } from './importExport.js';

describe('serializedSizeKB', () => {
    it('returns a number for a valid object', () => {
        expect(typeof serializedSizeKB({ a: 1 })).toBe('number');
    });
    it('returns Infinity for non-serializable input', () => {
        const circular = {};
        circular.self = circular;
        expect(serializedSizeKB(circular)).toBe(Infinity);
    });
    it('larger object returns larger size', () => {
        const small = { a: 1 };
        const large = { data: 'x'.repeat(10000) };
        expect(serializedSizeKB(large)).toBeGreaterThan(serializedSizeKB(small));
    });
});
