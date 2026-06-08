// GET /api/history -> authenticated newest-first change log
import { neonStore } from './_lib/stateStore.js';
import { getSessionUser } from './_lib/session.js';

function parseLimit(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 200;
    return Math.max(1, Math.min(Math.trunc(n), 500));
}

/** Testable handler: store is injected so route guards can run without a DB. */
export async function handleHistory(req, res, store) {
    try {
        if (req.method !== 'GET') {
            res.status(405).json({ error: 'Method not allowed' });
            return;
        }

        const username = getSessionUser(req.headers?.cookie);
        if (!username) {
            res.status(401).json({ error: 'unauthorized' });
            return;
        }

        const limit = parseLimit(req.query?.limit);
        const rows = await store.readHistory(limit);
        res.status(200).json({ rows });
    } catch (err) {
        console.error('/api/history failed:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

export default function handler(req, res) {
    return handleHistory(req, res, neonStore);
}
