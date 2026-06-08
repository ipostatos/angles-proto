import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password helper', () => {
    it('hashPassword returns hex hash + salt', () => {
        const { hash, salt } = hashPassword('Tomek');
        expect(typeof hash).toBe('string');
        expect(typeof salt).toBe('string');
        expect(hash).toMatch(/^[0-9a-f]+$/);
        expect(salt).toMatch(/^[0-9a-f]+$/);
    });

    it('uses a random salt each call (different hashes for same password)', () => {
        const a = hashPassword('Tomek');
        const b = hashPassword('Tomek');
        expect(a.salt).not.toBe(b.salt);
        expect(a.hash).not.toBe(b.hash);
    });

    it('verifyPassword returns true for the correct password', () => {
        const { hash, salt } = hashPassword('Alessandro');
        expect(verifyPassword('Alessandro', hash, salt)).toBe(true);
    });

    it('verifyPassword returns false for a wrong password', () => {
        const { hash, salt } = hashPassword('Alessandro');
        expect(verifyPassword('wrong', hash, salt)).toBe(false);
    });

    it('verifyPassword returns false for a tampered hash', () => {
        const { hash, salt } = hashPassword('Artsi');
        const tampered = (hash[0] === 'a' ? 'b' : 'a') + hash.slice(1);
        expect(verifyPassword('Artsi', tampered, salt)).toBe(false);
    });

    it('verifyPassword returns false for non-string hash/salt', () => {
        expect(verifyPassword('x', undefined, undefined)).toBe(false);
        expect(verifyPassword('x', null, null)).toBe(false);
    });
});
