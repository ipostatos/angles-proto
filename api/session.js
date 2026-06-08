// GET /api/session → { username } when a valid session cookie is present, else { username: null }
import { getSessionUser } from './_lib/session.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    const username = getSessionUser(req.headers?.cookie);
    res.status(200).json({ username: username ?? null });
}
