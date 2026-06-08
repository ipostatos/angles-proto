#!/usr/bin/env node
// One-shot DB setup: apply schema.sql and seed the three users (idempotent).
// Usage:  DATABASE_URL=... SEED_PASSWORD_TOMEK=... node scripts/db-setup.mjs
//   (locally: `vercel env pull .env.local` then `node --env-file=.env.local scripts/db-setup.mjs`)
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../api/_lib/password.js';
import { resolveSeedUsers } from './seed-users.mjs';

async function main() {
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error('DATABASE_URL is not set.');
        process.exit(1);
    }
    const sql = neon(url);
    const here = path.dirname(fileURLToPath(import.meta.url));
    const schema = await readFile(path.join(here, '..', 'api', '_lib', 'schema.sql'), 'utf8');

    // The Neon HTTP driver runs one statement per call — split the schema file.
    const statements = schema
        .split(';')
        .map((s) => s.replace(/--.*$/gm, '').trim())
        .filter(Boolean);
    for (const stmt of statements) {
        await sql.query(stmt);
    }
    console.log(`Applied ${statements.length} schema statement(s).`);

    const seedUsers = resolveSeedUsers();
    let seeded = 0;
    for (const { username, password } of seedUsers) {
        const { hash, salt } = hashPassword(password);
        const rows = await sql`
            INSERT INTO users (username, pass_hash, salt)
            VALUES (${username}, ${hash}, ${salt})
            ON CONFLICT (username) DO NOTHING
            RETURNING username
        `;
        if (rows.length > 0) seeded += 1;
    }
    console.log(`Seeded ${seeded} new user(s); ${seedUsers.length - seeded} already existed.`);
    console.log('DB setup complete.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().catch((err) => {
        console.error('DB setup failed:', err);
        process.exit(1);
    });
}
