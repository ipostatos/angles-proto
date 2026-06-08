import { describe, it, expect } from 'vitest';
import { hashPassword } from './password.js';
import { authenticateUser } from './auth.js';

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

    it('works with an async lookup function', async () => {
        const asyncLookup = async (u) => lookup(u);
        expect(await authenticateUser('Artsi', 'Artsi', asyncLookup)).toBe(true);
    });
});
