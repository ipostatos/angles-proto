// Pure seed-password resolution for db-setup. Kept in its own module (no shebang,
// no DB I/O) so it can be unit-tested without the bundler tripping over the
// db-setup.mjs shebang.
import { MAX_PASSWORD_LENGTH } from '../api/_lib/auth.js';

export const DEFAULT_SEED_USERNAMES = ['Tomek', 'Alessandro', 'Artsi'];

function passwordEnvName(username) {
    return `SEED_PASSWORD_${String(username).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

function parsePasswordMap(env) {
    if (!env.SEED_USER_PASSWORDS) return {};
    try {
        const parsed = JSON.parse(env.SEED_USER_PASSWORDS);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('SEED_USER_PASSWORDS must be a JSON object');
        }
        return parsed;
    } catch (err) {
        throw new Error(`Invalid SEED_USER_PASSWORDS: ${err.message}`);
    }
}

export function resolveSeedUsers(env = process.env, usernames = DEFAULT_SEED_USERNAMES) {
    const passwords = parsePasswordMap(env);
    const allowWeak = env.ALLOW_WEAK_SEED_PASSWORDS === 'true';
    const users = [];
    const missing = [];
    const weak = [];
    const tooLong = [];

    for (const username of usernames) {
        const envName = passwordEnvName(username);
        const rawPassword = env[envName] ?? passwords[username];
        const password = typeof rawPassword === 'string' ? rawPassword : '';
        // A whitespace-only password is treated as unset: it defeats the intent
        // of requiring a real secret and would only be loginnable by typing the
        // exact whitespace back.
        if (!password.trim()) {
            if (allowWeak) {
                users.push({ username, password: username });
                continue;
            }
            missing.push(`${username} (${envName} or SEED_USER_PASSWORDS.${username})`);
            continue;
        }
        if (password === username && !allowWeak) {
            weak.push(username);
            continue;
        }
        // `/api/login` rejects any password longer than MAX_PASSWORD_LENGTH before
        // verifying it, so seeding a longer one would create an account nobody can
        // log into. Fail loudly here instead of silently.
        if (password.length > MAX_PASSWORD_LENGTH) {
            tooLong.push(username);
            continue;
        }
        users.push({ username, password });
    }

    if (missing.length > 0) {
        throw new Error(`Missing seed password(s): ${missing.join(', ')}. Set explicit passwords or ALLOW_WEAK_SEED_PASSWORDS=true for local-only setup.`);
    }
    if (weak.length > 0) {
        throw new Error(`Weak seed password(s) equal username: ${weak.join(', ')}. Use stronger values or ALLOW_WEAK_SEED_PASSWORDS=true for local-only setup.`);
    }
    if (tooLong.length > 0) {
        throw new Error(`Seed password(s) exceed ${MAX_PASSWORD_LENGTH} characters and would be rejected at login: ${tooLong.join(', ')}.`);
    }
    return users;
}
