import { describe, it, expect, vi } from 'vitest';
import { hashPassword } from './password.js';
import { MAX_PASSWORD_LENGTH, MAX_USERNAME_LENGTH, authenticateUser } from './auth.js';

// In-memory user store seeded with real (hashed + salted) credentials — no mocks.
function makeLookup(users) {
    const byName = new Map();
    for (const username of users) {
        const { hash, salt } = hashPassword(username); // password === username
        byName.set(username, { username, pass_hash: hash, salt });
    }
    return (username) => byName.get(username) ?? null;
}

const lookup = makeLookup(['Tomek', 'Alessandro', 'Artsi']);

describe('authenticateUser', () => {
    it('returns true on correct username + password', async () => {
        expect(await authenticateUser('Tomek', 'Tomek', lookup)).toBe(true);
    });

    it('returns false on wrong password', async () => {
        expect(await authenticateUser('Tomek', 'nope', lookup)).toBe(false);
    });

    it('returns false for an unknown user', async () => {
        expect(await authenticateUser('Ghost', 'Ghost', lookup)).toBe(false);
    });

    it('returns false for empty credentials', async () => {
        expect(await authenticateUser('', '', lookup)).toBe(false);
        expect(await authenticateUser('Tomek', '', lookup)).toBe(false);
    });

    it('rejects oversized credentials before lookup/hash work', async () => {
        const spy = vi.fn(lookup);
        expect(await authenticateUser('x'.repeat(MAX_USERNAME_LENGTH + 1), 'x', spy)).toBe(false);
        expect(await authenticateUser('Tomek', 'x'.repeat(MAX_PASSWORD_LENGTH + 1), spy)).toBe(false);
        expect(spy).not.toHaveBeenCalled();
    });

    it('works with an async lookup function', async () => {
        const asyncLookup = async (u) => lookup(u);
        expect(await authenticateUser('Artsi', 'Artsi', asyncLookup)).toBe(true);
    });
});
