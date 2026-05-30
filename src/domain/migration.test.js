import { describe, it, expect } from 'vitest';
import { migrateAndSanitize, unwrapImportedDb, migrateV1toV2, detectVersion } from './migration.js';

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

describe('detectVersion', () => {
    it('returns 1 for v1 data', () => expect(detectVersion({ holds: [] })).toBe(1));
    it('returns 2 for v2 data', () => expect(detectVersion({ version: 2, holds: [] })).toBe(2));
    it('returns 0 for null', () => expect(detectVersion(null)).toBe(0));
});

describe('migrateV1toV2', () => {
    it('converts holds from strings to objects', () => {
        const v1 = { holds: ['Austin'], angles: [], holdImages: {} };
        const v2 = migrateV1toV2(v1);
        expect(v2.version).toBe(2);
        expect(v2.holds[0]).toMatchObject({ name: 'Austin' });
        expect(typeof v2.holds[0].id).toBe('string');
        expect(v2.holds[0].id.startsWith('h_')).toBe(true);
    });
    it('migrates angles hold→holdId', () => {
        const v1 = {
            holds: ['Austin'],
            angles: [{ id: 'a1', hold: 'Austin', value: 28.2, saw: 'main' }],
            holdImages: {},
        };
        const v2 = migrateV1toV2(v1);
        expect(v2.angles[0].holdId).toBe(v2.holds[0].id);
        expect(v2.angles[0].hold).toBeUndefined();
    });
    it('moves holdImages into hold.coverImage', () => {
        const v1 = {
            holds: ['Austin'],
            angles: [],
            holdImages: { Austin: 'data:image/jpeg;base64,abc' },
        };
        const v2 = migrateV1toV2(v1);
        expect(v2.holds[0].coverImage).toBe('data:image/jpeg;base64,abc');
    });
    it('drops orphan angles (hold not in holds)', () => {
        const v1 = {
            holds: ['Austin'],
            angles: [{ id: 'a1', hold: 'Ghost', value: 45, saw: 'main' }],
            holdImages: {},
        };
        const v2 = migrateV1toV2(v1);
        expect(v2.angles).toHaveLength(0);
    });
    it('empty input produces valid empty v2', () => {
        const v2 = migrateV1toV2({});
        expect(v2.version).toBe(2);
        expect(v2.holds).toHaveLength(0);
        expect(v2.angles).toHaveLength(0);
    });
    it('preserves angle IDs', () => {
        const v1 = {
            holds: ['Austin'],
            angles: [{ id: 'angle-123', hold: 'Austin', value: 30, saw: 'stefan' }],
            holdImages: {},
        };
        const v2 = migrateV1toV2(v1);
        expect(v2.angles[0].id).toBe('angle-123');
    });
});
