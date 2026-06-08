// Credential check, decoupled from storage for testability.
import { verifyPassword } from './password.js';

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
    if (!username || !password) return false;
    const user = await lookupUser(username);
    if (!user) return false;
    return verifyPassword(password, user.pass_hash, user.salt);
}
