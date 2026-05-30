import { describe, it, expect } from 'vitest';
import { migrateAndSanitize, unwrapImportedDb } from './migration.js';

describe('unwrapImportedDb', () => {
    it('unwraps { data: ... } wrapper', () => {
        const wrapped = { data: { holds: ['A'], angles: [] } };
        expect(unwrapImportedDb(wrapped)).toEqual({ holds: ['A'], angles: [] });
    });
    it('passes through plain object', () => {
        const plain = { holds: ['A'], angles: [] };
        expect(unwrapImportedDb(plain)).toEqual(plain);
    });
});

describe('migrateAndSanitize', () => {
    it('returns defaults on empty input', () => {
        const result = migrateAndSanitize({});
        expect(result.holds).toBeDefined();
        expect(result.angles).toBeDefined();
        expect(result.version).toBe(1);
    });
    it('clamps angle value to 0-90', () => {
        const input = {
            holds: ['Austin'],
            angles: [{ id: 'a1', hold: 'Austin', value: 150, saw: 'main' }],
            holdImages: {},
        };
        const result = migrateAndSanitize(input);
        expect(result.angles[0].value).toBe(90);
    });
    it('rejects SVG drawing on import', () => {
        const input = {
            holds: ['Austin'],
            angles: [{ id: 'a1', hold: 'Austin', value: 45, saw: 'main', drawing: 'data:image/svg+xml;base64,abc' }],
            holdImages: {},
        };
        const result = migrateAndSanitize(input);
        expect(result.angles[0].drawing).toBeUndefined();
    });
    it('deduplicates holds case-insensitively', () => {
        const input = {
            holds: ['Austin', 'austin', 'AUSTIN'],
            angles: [],
            holdImages: {},
        };
        const result = migrateAndSanitize(input);
        expect(result.holds).toHaveLength(1);
    });
    it('drops angles for unknown holds', () => {
        const input = {
            holds: ['Austin'],
            angles: [{ id: 'a1', hold: 'Ghost', value: 45, saw: 'main' }],
            holdImages: {},
        };
        const result = migrateAndSanitize(input);
        expect(result.angles).toHaveLength(0);
    });
});
