// Neon-backed implementation of the state store contract used by stateService.
// All writes for PUT happen in a SINGLE data-modifying-CTE statement so the
// revision compare-and-set, the app_state update, and the change_log inserts are
// atomic at the Postgres level (no partial drift) without needing an interactive
// WebSocket transaction.
import { getSql } from './db.js';

export const neonStore = {
    /** @returns {Promise<{data: object, revision: number}|null>} */
    async readState() {
        const sql = getSql();
        const rows = await sql`SELECT data, revision FROM app_state WHERE id = 1`;
        if (!rows[0]) return null;
        return { data: rows[0].data, revision: Number(rows[0].revision) };
    },

    /** Insert the initial single row (idempotent), then return it. */
    async initState(data) {
        const sql = getSql();
        await sql`
            INSERT INTO app_state (id, data, revision)
            VALUES (1, ${JSON.stringify(data)}::jsonb, 1)
            ON CONFLICT (id) DO NOTHING
        `;
        const rows = await sql`SELECT data, revision FROM app_state WHERE id = 1`;
        return { data: rows[0].data, revision: Number(rows[0].revision) };
    },

    /**
     * Atomic compare-and-set write. Updates app_state only when the stored
     * revision still equals expectedRevision; inserts change_log rows only when
     * that update succeeded. Both happen in one statement.
     * @returns {Promise<{applied: boolean, revision: number|null, inserted: number}>}
     */
    async commitWrite({ data, expectedRevision, username, events }) {
        const sql = getSql();
        const logRows = events.map((e) => ({
            action: e.action,
            entity: e.entity,
            field: e.field,
            old_value: e.oldValue,
            new_value: e.newValue,
        }));

        const rows = await sql`
            WITH upd AS (
                UPDATE app_state
                   SET data = ${JSON.stringify(data)}::jsonb,
                       revision = revision + 1,
                       updated_at = now()
                 WHERE id = 1 AND revision = ${expectedRevision}
                RETURNING revision
            ),
            ins AS (
                INSERT INTO change_log (username, action, entity, field, old_value, new_value)
                SELECT ${username}, x.action, x.entity, x.field, x.old_value, x.new_value
                  FROM jsonb_to_recordset(${JSON.stringify(logRows)}::jsonb)
                    AS x(action text, entity text, field text, old_value text, new_value text)
                 WHERE EXISTS (SELECT 1 FROM upd)
                RETURNING 1
            )
            SELECT (SELECT revision FROM upd) AS revision,
                   (SELECT count(*)::int FROM ins) AS inserted
        `;
        const row = rows[0] ?? {};
        const applied = row.revision != null;
        return {
            applied,
            revision: applied ? Number(row.revision) : null,
            inserted: row.inserted ?? 0,
        };
    },

    /** Read newest change-log rows for the admin history tab. */
    async readHistory(limit = 200) {
        const sql = getSql();
        const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 500));
        const rows = await sql`
            SELECT id, username, action, entity, field, old_value, new_value, created_at
              FROM change_log
             ORDER BY created_at DESC, id DESC
             LIMIT ${safeLimit}
        `;
        return rows.map((r) => ({
            id: Number(r.id),
            username: r.username,
            action: r.action,
            entity: r.entity,
            field: r.field,
            oldValue: r.old_value,
            newValue: r.new_value,
            createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
        }));
    },
};
