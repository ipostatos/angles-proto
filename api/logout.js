// POST /api/logout → clears the session cookie
import { buildClearCookie } from './_lib/session.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    res.setHeader('Set-Cookie', buildClearCookie());
    res.status(200).json({ ok: true });
}
