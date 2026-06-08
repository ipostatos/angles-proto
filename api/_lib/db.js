// Server-only Neon Postgres access. The connection string lives in
// DATABASE_URL and must never reach the browser. Imported only by /api routes
// and scripts — never by client code.
import { neon } from '@neondatabase/serverless';

let _sql;

/** Lazily create the Neon HTTP query function from DATABASE_URL. */
export function getSql() {
    if (!_sql) {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error('DATABASE_URL is not set');
        _sql = neon(url);
    }
    return _sql;
}

/**
 * Look up a user record by username.
 * @returns {Promise<{ username: string, pass_hash: string, salt: string }|null>}
 */
export async function getUserByUsername(username) {
    const sql = getSql();
    const rows = await sql`
        SELECT username, pass_hash, salt
        FROM users
        WHERE username = ${username}
        LIMIT 1
    `;
    return rows[0] ?? null;
}
