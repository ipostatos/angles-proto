import { describe, expect, it } from 'vitest';
import { resolveSeedUsers } from './seed-users.mjs';
import { MAX_PASSWORD_LENGTH } from '../api/_lib/auth.js';

describe('resolveSeedUsers', () => {
    it('reads per-user seed passwords from environment variables', () => {
        expect(resolveSeedUsers({
            SEED_PASSWORD_TOMEK: 'one-strong-password',
            SEED_PASSWORD_ALESSANDRO: 'two-strong-password',
            SEED_PASSWORD_ARTSI: 'three-strong-password',
        })).toEqual([
            { username: 'Tomek', password: 'one-strong-password' },
            { username: 'Alessandro', password: 'two-strong-password' },
            { username: 'Artsi', password: 'three-strong-password' },
        ]);
    });

    it('reads seed passwords from a JSON map', () => {
        expect(resolveSeedUsers({
            SEED_USER_PASSWORDS: JSON.stringify({
                Tomek: 'one-strong-password',
                Alessandro: 'two-strong-password',
                Artsi: 'three-strong-password',
            }),
        })[1]).toEqual({ username: 'Alessandro', password: 'two-strong-password' });
    });

    it('rejects missing passwords unless weak local setup is explicitly allowed', () => {
        expect(() => resolveSeedUsers({})).toThrow(/Missing seed password/);
    });

    it('rejects password=username unless weak local setup is explicitly allowed', () => {
        expect(() => resolveSeedUsers({
            SEED_PASSWORD_TOMEK: 'Tomek',
            SEED_PASSWORD_ALESSANDRO: 'two-strong-password',
            SEED_PASSWORD_ARTSI: 'three-strong-password',
        })).toThrow(/Weak seed password/);
    });

    it('allows password=username only with ALLOW_WEAK_SEED_PASSWORDS=true', () => {
        expect(resolveSeedUsers({ ALLOW_WEAK_SEED_PASSWORDS: 'true' })).toEqual([
            { username: 'Tomek', password: 'Tomek' },
            { username: 'Alessandro', password: 'Alessandro' },
            { username: 'Artsi', password: 'Artsi' },
        ]);
    });

    it('treats a whitespace-only password as unset', () => {
        expect(() => resolveSeedUsers({
            SEED_PASSWORD_TOMEK: '   ',
            SEED_PASSWORD_ALESSANDRO: 'two-strong-password',
            SEED_PASSWORD_ARTSI: 'three-strong-password',
        })).toThrow(/Missing seed password/);
    });

    it('rejects a password longer than the login limit', () => {
        expect(() => resolveSeedUsers({
            SEED_PASSWORD_TOMEK: 'x'.repeat(MAX_PASSWORD_LENGTH + 1),
            SEED_PASSWORD_ALESSANDRO: 'two-strong-password',
            SEED_PASSWORD_ARTSI: 'three-strong-password',
        })).toThrow(/exceed .* characters and would be rejected at login/);
    });
});
