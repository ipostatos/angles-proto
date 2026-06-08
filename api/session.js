// GET /api/session → { username, latestChange } for valid sessions, else { username: null }
import { getSessionUser } from './_lib/session.js';
import { neonStore } from './_lib/stateStore.js';

export async function handleSession(req, res, store) {
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    const username = getSessionUser(req.headers?.cookie);
    if (!username) {
        res.status(200).json({ username: null, latestChange: null });
        return;
    }
    try {
        const latestChange = await store.readLatestChange();
        res.status(200).json({ username, latestChange });
    } catch (err) {
        console.error('/api/session failed:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

export default async function handler(req, res) {
    return handleSession(req, res, neonStore);
}
