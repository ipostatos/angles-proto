// Server-only password hashing. Uses Node's built-in scrypt — no third-party deps.
// Never import this into browser/client code.
import crypto from 'node:crypto';

const KEY_LEN = 64;
const SALT_BYTES = 16;

/**
 * Hash a password with a random (or provided) salt.
 * @param {string} password
 * @param {string} [salt] hex salt; a random one is generated when omitted
 * @returns {{ hash: string, salt: string }} hex-encoded
 */
export function hashPassword(password, salt = crypto.randomBytes(SALT_BYTES).toString('hex')) {
    const hash = crypto.scryptSync(String(password), salt, KEY_LEN).toString('hex');
    return { hash, salt };
}

/**
 * Constant-time verification of a password against a stored hash + salt.
 * @returns {boolean}
 */
export function verifyPassword(password, hash, salt) {
    if (typeof hash !== 'string' || typeof salt !== 'string') return false;
    const candidate = crypto.scryptSync(String(password), salt, KEY_LEN).toString('hex');
    const a = Buffer.from(candidate, 'hex');
    const b = Buffer.from(hash, 'hex');
    if (a.length !== b.length || a.length === 0) return false;
    return crypto.timingSafeEqual(a, b);
}
