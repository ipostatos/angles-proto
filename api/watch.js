// GET  /api/watch → compact public catalog + last selection sent from the web,
//                   for the Garmin watch app (Connect IQ responses must stay small).
//      { r: revision, h: [[holdName, [main], [stefan]], ...], s: [holdName], t: sentAtMs }
// POST /api/watch { holds: [holdName] } → "Send to watch" button on the main page.
import { getState } from './_lib/stateService.js';
import { neonStore } from './_lib/stateStore.js';
import { getSql } from './_lib/db.js';
import { PayloadTooLargeError, readJsonBody } from './_lib/http.js';

export const MAX_SENT_HOLDS = 200;

export function toWatchCatalog(data) {
    const holds = Array.isArray(data?.holds) ? data.holds : [];
    const angles = Array.isArray(data?.angles) ? data.angles : [];
    const pick = (id, saw) => angles
        .filter(a => a.holdId === id && a.saw === saw)
        .map(a => Number(a.value))
        .sort((x, y) => x - y);
    return holds
        .map(h => [h.name, pick(h.id, 'main'), pick(h.id, 'stefan')])
        .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }));
}

/** Single-row slot for the selection, created on first use. */
export const neonWatchStore = {
    async ensure() {
        const sql = getSql();
        await sql`
            CREATE TABLE IF NOT EXISTS watch_selection (
                id      INT PRIMARY KEY DEFAULT 1,
                holds   JSONB NOT NULL,
                sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                CONSTRAINT watch_selection_single_row CHECK (id = 1)
            )
        `;
    },
    async read() {
        await this.ensure();
        const rows = await getSql()`SELECT holds, sent_at FROM watch_selection WHERE id = 1`;
        if (!rows[0]) return null;
        return { holds: rows[0].holds, sentAt: new Date(rows[0].sent_at).getTime() };
    },
    async write(holds) {
        await this.ensure();
        const rows = await getSql()`
            INSERT INTO watch_selection (id, holds, sent_at)
            VALUES (1, ${JSON.stringify(holds)}::jsonb, now())
            ON CONFLICT (id) DO UPDATE SET holds = EXCLUDED.holds, sent_at = EXCLUDED.sent_at
            RETURNING sent_at
        `;
        return new Date(rows[0].sent_at).getTime();
    },
};

/** Testable handler: stores are injected so it can run without a DB. */
export async function handleWatch(req, res, stateStore, watchStore) {
    try {
        if (req.method === 'GET') {
            const { data, revision } = await getState(stateStore);
            const sel = await watchStore.read();
            res.status(200).json({
                r: revision,
                h: toWatchCatalog(data),
                s: sel?.holds ?? [],
                t: sel?.sentAt ?? 0,
            });
            return;
        }

        if (req.method === 'POST') {
            const body = await readJsonBody(req, { maxBytes: 16 * 1024 });
            const sent = body?.holds;
            if (!Array.isArray(sent) || sent.length > MAX_SENT_HOLDS) {
                res.status(400).json({ error: 'invalid_body' });
                return;
            }
            // Keep only names that exist in the catalog.
            const { data } = await getState(stateStore);
            const known = new Set((data?.holds ?? []).map(h => h.name));
            const holds = [...new Set(sent.filter(n => typeof n === 'string' && known.has(n)))];
            const sentAt = await watchStore.write(holds);
            res.status(200).json({ ok: true, count: holds.length, t: sentAt });
            return;
        }

        res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        if (err instanceof PayloadTooLargeError) {
            res.status(413).json({ error: err.code, message: err.message });
            return;
        }
        console.error('/api/watch failed:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

export default function handler(req, res) {
    return handleWatch(req, res, neonStore, neonWatchStore);
}
