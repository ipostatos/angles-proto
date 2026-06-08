// Server-only session tokens: compact HMAC-signed value carrying username +
// expiry. No third-party auth. Never import into browser/client code.
import crypto from 'node:crypto';

export const COOKIE_NAME = 'angles_session';
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

function getSecret(opts) {
    const secret = opts?.secret ?? process.env.SESSION_SECRET;
    if (!secret) throw new Error('SESSION_SECRET is not set');
    return secret;
}

function isProd(opts) {
    return opts?.secure ?? (process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL_ENV));
}

function sign(payloadB64, secret) {
    return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

/**
 * Create a signed session token: `base64url(payload).signature`.
 * @param {string} username
 * @param {{ secret?: string, ttlMs?: number, now?: number }} [opts]
 */
export function signSession(username, opts = {}) {
    const secret = getSecret(opts);
    const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
    const expiry = (opts.now ?? Date.now()) + ttl;
    const payloadB64 = Buffer.from(JSON.stringify({ u: username, e: expiry })).toString('base64url');
    return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/**
 * Verify a session token. Returns { username, expiry } or null.
 * @param {string} token
 * @param {{ secret?: string, now?: number }} [opts]
 */
export function verifySession(token, opts = {}) {
    try {
        const secret = getSecret(opts);
        if (typeof token !== 'string') return null;
        const dot = token.indexOf('.');
        if (dot <= 0 || dot === token.length - 1) return null;
        const payloadB64 = token.slice(0, dot);
        const sig = token.slice(dot + 1);

        const expected = sign(payloadB64, secret);
        const sigBuf = Buffer.from(sig);
        const expBuf = Buffer.from(expected);
        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;

        const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
        const now = opts.now ?? Date.now();
        if (typeof payload.e !== 'number' || payload.e <= now) return null;
        if (typeof payload.u !== 'string' || !payload.u) return null;
        return { username: payload.u, expiry: payload.e };
    } catch {
        return null;
    }
}

/** Parse a Cookie request header into a plain object. */
export function parseCookies(cookieHeader) {
    const out = {};
    if (typeof cookieHeader !== 'string') return out;
    for (const part of cookieHeader.split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        const key = part.slice(0, idx).trim();
        if (!key) continue;
        try {
            out[key] = decodeURIComponent(part.slice(idx + 1).trim());
        } catch {
            // Malformed Cookie percent-encoding is attacker-controlled input.
            // Ignore that pair and let auth fail closed instead of throwing 500.
        }
    }
    return out;
}

/** Resolve the logged-in username from a Cookie header, or null. */
export function getSessionUser(cookieHeader, opts = {}) {
    const token = parseCookies(cookieHeader)[COOKIE_NAME];
    if (!token) return null;
    return verifySession(token, opts)?.username ?? null;
}

/** Build a Set-Cookie value carrying the session token. */
export function buildSessionCookie(token, opts = {}) {
    const maxAge = Math.floor((opts.ttlMs ?? DEFAULT_TTL_MS) / 1000);
    const attrs = [`${COOKIE_NAME}=${token}`, 'HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${maxAge}`];
    if (isProd(opts)) attrs.push('Secure');
    return attrs.join('; ');
}

/** Build a Set-Cookie value that clears the session. */
export function buildClearCookie(opts = {}) {
    const attrs = [`${COOKIE_NAME}=`, 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0'];
    if (isProd(opts)) attrs.push('Secure');
    return attrs.join('; ');
}
