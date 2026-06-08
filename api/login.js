// POST /api/login  { username, password } → sets session cookie, returns { username }
import { getUserByUsername } from './_lib/db.js';
import { authenticateUser, normalizeLoginUsername } from './_lib/auth.js';
import { signSession, buildSessionCookie } from './_lib/session.js';
import { PayloadTooLargeError, readJsonBody } from './_lib/http.js';
import { neonRateLimitStore } from './_lib/rateLimitStore.js';
import {
    isRateLimited,
    recordFailure,
    clearFailures,
    rateLimitKey,
    LOGIN_MAX_FAILURES,
} from './_lib/rateLimit.js';

export const LOGIN_BODY_LIMIT_BYTES = 16 * 1024;
export { LOGIN_MAX_FAILURES };

function getClientIp(req) {
    const forwarded = req.headers?.['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
    return req.headers?.['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

export async function handleLogin(req, res, opts = {}) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    const lookupUser = opts.lookupUser ?? getUserByUsername;
    const rateStore = opts.rateStore ?? neonRateLimitStore;
    const now = opts.now ?? Date.now();
    try {
        const { username: rawUsername, password } = await readJsonBody(req, { maxBytes: LOGIN_BODY_LIMIT_BYTES });
        const username = normalizeLoginUsername(rawUsername);
        const key = rateLimitKey(getClientIp(req), username);
        if (await isRateLimited(rateStore, key, now)) {
            res.status(429).json({ error: 'too_many_attempts', message: 'Too many failed login attempts. Try again later.' });
            return;
        }

        const ok = await authenticateUser(username, password, lookupUser);
        if (!ok) {
            await recordFailure(rateStore, key, now);
            res.status(401).json({ error: 'Invalid credentials' });
            return;
        }
        await clearFailures(rateStore, key);
        const token = signSession(username);
        res.setHeader('Set-Cookie', buildSessionCookie(token));
        res.status(200).json({ username });
    } catch (err) {
        if (err instanceof PayloadTooLargeError) {
            res.status(413).json({ error: err.code, message: err.message });
            return;
        }
        console.error('login failed:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

export default async function handler(req, res) {
    return handleLogin(req, res);
}
