// Credential check, decoupled from storage for testability.
import { verifyPassword } from './password.js';

export const MAX_USERNAME_LENGTH = 80;
export const MAX_PASSWORD_LENGTH = 256;

export function normalizeLoginUsername(username) {
    return typeof username === 'string' ? username.trim() : '';
}

export function hasAcceptableCredentialShape(username, password) {
    return (
        typeof username === 'string'
        && typeof password === 'string'
        && username.length > 0
        && password.length > 0
        && username.length <= MAX_USERNAME_LENGTH
        && password.length <= MAX_PASSWORD_LENGTH
    );
}

/**
 * Authenticate a username/password pair against a user record produced by
 * `lookupUser` (sync or async). Returns true only on a verified match.
 *
 * @param {string} username
 * @param {string} password
 * @param {(username: string) => ({ pass_hash: string, salt: string }|null|undefined)
 *         | Promise<{ pass_hash: string, salt: string }|null|undefined>} lookupUser
 * @returns {Promise<boolean>}
 */
export async function authenticateUser(username, password, lookupUser) {
    const normalizedUsername = normalizeLoginUsername(username);
    if (!hasAcceptableCredentialShape(normalizedUsername, password)) return false;
    const user = await lookupUser(normalizedUsername);
    if (!user) return false;
    return verifyPassword(password, user.pass_hash, user.salt);
}
