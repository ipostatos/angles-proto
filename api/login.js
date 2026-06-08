// POST /api/login  { username, password } → sets session cookie, returns { username }
import { getUserByUsername } from './_lib/db.js';
import { authenticateUser } from './_lib/auth.js';
import { signSession, buildSessionCookie } from './_lib/session.js';
import { readJsonBody } from './_lib/http.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    try {
        const { username, password } = await readJsonBody(req);
        const ok = await authenticateUser(username, password, getUserByUsername);
        if (!ok) {
            res.status(401).json({ error: 'Invalid credentials' });
            return;
        }
        const token = signSession(username);
        res.setHeader('Set-Cookie', buildSessionCookie(token));
        res.status(200).json({ username });
    } catch (err) {
        console.error('login failed:', err);
        res.status(500).json({ error: 'Server error' });
    }
}
