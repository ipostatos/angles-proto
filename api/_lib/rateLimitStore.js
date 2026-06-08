// Neon-backed implementation of the login throttle store contract used by
// rateLimit.js. The sliding window is enforced inside single SQL statements so
// the read/increment/reset are atomic across concurrent serverless instances
// (no read-modify-write race, no interactive transaction needed).
import { getSql } from './db.js';

export const neonRateLimitStore = {
    /**
     * Current failure count for a key within its active window. A row whose
     * window has expired counts as 0 (a fresh window starts on the next failure).
     * @returns {Promise<number>}
     */
    async getFailureCount(key, now) {
        const sql = getSql();
        const nowIso = new Date(now).toISOString();
        const rows = await sql`
            SELECT fail_count
              FROM login_attempts
             WHERE key = ${key} AND reset_at > ${nowIso}
        `;
        return rows[0] ? Number(rows[0].fail_count) : 0;
    },

    /**
     * Atomically record one failure. Starts a new window when no row exists or
     * the existing window has expired; otherwise increments within the window.
     * The whole decision happens in one UPSERT so concurrent calls can't both
     * "start fresh" and lose increments.
     */
    async recordFailure(key, now, windowMs) {
        const sql = getSql();
        const nowIso = new Date(now).toISOString();
        const resetIso = new Date(now + windowMs).toISOString();
        await sql`
            INSERT INTO login_attempts (key, fail_count, reset_at)
            VALUES (${key}, 1, ${resetIso})
            ON CONFLICT (key) DO UPDATE
               SET fail_count = CASE
                       WHEN login_attempts.reset_at <= ${nowIso} THEN 1
                       ELSE login_attempts.fail_count + 1
                   END,
                   reset_at = CASE
                       WHEN login_attempts.reset_at <= ${nowIso} THEN ${resetIso}
                       ELSE login_attempts.reset_at
                   END
        `;
    },

    /** Drop the counter for a key (called after a successful login). */
    async clearFailures(key) {
        const sql = getSql();
        await sql`DELETE FROM login_attempts WHERE key = ${key}`;
    },
};
