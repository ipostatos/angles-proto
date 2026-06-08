import { describe, it, expect } from 'vitest';
import {
    signSession,
    verifySession,
    parseCookies,
    getSessionUser,
    buildSessionCookie,
    buildClearCookie,
    COOKIE_NAME,
} from './session.js';

const SECRET = 'unit-test-secret-please-ignore';
const opts = { secret: SECRET };

describe('session sign/verify', () => {
    it('round-trips username through sign → verify', () => {
        const token = signSession('Tomek', opts);
        const session = verifySession(token, opts);
        expect(session?.username).toBe('Tomek');
    });

    it('rejects an expired token', () => {
        const token = signSession('Tomek', { ...opts, ttlMs: 1000, now: 0 });
        // verify "now" is well past expiry
        expect(verifySession(token, { ...opts, now: 10_000 })).toBeNull();
    });

    it('rejects a token with an invalid signature', () => {
        const token = signSession('Tomek', opts);
        const [payload] = token.split('.');
        const forged = `${payload}.deadbeefdeadbeef`;
        expect(verifySession(forged, opts)).toBeNull();
    });

    it('rejects a token whose payload was tampered with', () => {
        const token = signSession('Tomek', opts);
        const [, sig] = token.split('.');
        const otherPayload = signSession('Artsi', opts).split('.')[0];
        expect(verifySession(`${otherPayload}.${sig}`, opts)).toBeNull();
    });

    it('rejects a token signed with a different secret', () => {
        const token = signSession('Tomek', { secret: 'other-secret' });
        expect(verifySession(token, opts)).toBeNull();
    });

    it('rejects malformed tokens', () => {
        expect(verifySession('', opts)).toBeNull();
        expect(verifySession('no-dot', opts)).toBeNull();
        expect(verifySession(null, opts)).toBeNull();
    });
});

describe('parseCookies', () => {
    it('parses a cookie header into a map', () => {
        expect(parseCookies('a=1; b=2')).toEqual({ a: '1', b: '2' });
    });
    it('returns {} for missing header', () => {
        expect(parseCookies(undefined)).toEqual({});
    });
    it('ignores malformed percent-encoded cookie pairs', () => {
        expect(parseCookies('a=%E0%A4%A; b=2')).toEqual({ b: '2' });
    });
});

describe('getSessionUser', () => {
    it('returns the username for a valid session cookie', () => {
        const token = signSession('Alessandro', opts);
        const header = `${COOKIE_NAME}=${token}; other=x`;
        expect(getSessionUser(header, opts)).toBe('Alessandro');
    });

    it('returns null when no cookie is present', () => {
        expect(getSessionUser(undefined, opts)).toBeNull();
        expect(getSessionUser('other=x', opts)).toBeNull();
    });

    it('returns null when the session cookie is invalid', () => {
        const header = `${COOKIE_NAME}=garbage.value`;
        expect(getSessionUser(header, opts)).toBeNull();
    });

    it('returns null when the session cookie has malformed percent-encoding', () => {
        expect(getSessionUser(`${COOKIE_NAME}=%E0%A4%A`, opts)).toBeNull();
    });
});

describe('cookie builders', () => {
    it('buildSessionCookie sets HttpOnly, SameSite=Strict, Path and Max-Age', () => {
        const cookie = buildSessionCookie('tok', { ...opts, secure: false });
        expect(cookie).toContain(`${COOKIE_NAME}=tok`);
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('SameSite=Strict');
        expect(cookie).toContain('Path=/');
        expect(cookie).toMatch(/Max-Age=\d+/);
        expect(cookie).not.toContain('Secure');
    });

    it('buildSessionCookie adds Secure when requested', () => {
        expect(buildSessionCookie('tok', { secure: true })).toContain('Secure');
    });

    it('buildClearCookie expires the cookie (Max-Age=0)', () => {
        const cookie = buildClearCookie({ secure: false });
        expect(cookie).toContain(`${COOKIE_NAME}=`);
        expect(cookie).toContain('Max-Age=0');
    });
});
