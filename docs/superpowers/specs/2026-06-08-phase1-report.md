# Phase 1 report — backend foundation (auth + schema)

**Date:** 2026-06-08
**Scope:** Vercel Functions foundation, Neon schema, three seeded users, session
+ password helpers, and `login` / `logout` / `session` endpoints. **No** state
endpoints, no history, no `diffStates` use, no frontend/localStorage changes.
Additive and reversible.

---

## 1. Where the functions live (structure decision)

This repo is a **Vite SPA** (not Next.js). On Vercel, framework-agnostic
serverless functions are auto-detected from an **`/api` directory at the repo
root**; each file is a route (`api/login.js` → `/api/login`). Shared,
non-route code goes in **`api/_lib/`** — Vercel ignores `_`-prefixed paths as
routes. No `vercel.json` change is required; the SPA build is unaffected.

```
api/
  login.js          POST /api/login
  logout.js         POST /api/logout
  session.js        GET  /api/session
  _lib/
    auth.js         authenticateUser(username, password, lookupUser)
    password.js     hashPassword / verifyPassword (scrypt, Node crypto)
    session.js      sign/verify token, cookie build, getSessionUser
    db.js           Neon client + getUserByUsername
    http.js         readJsonBody
    schema.sql      DDL (users, app_state, change_log)
scripts/
  db-setup.mjs      apply schema + seed users (idempotent)
.env.example        DATABASE_URL, SESSION_SECRET
```

## 2. What was added

- **Auth helpers** (pure, unit-tested):
  - `password.js` — scrypt hash + salt; constant-time verify (`timingSafeEqual`).
  - `session.js` — compact `base64url(payload).hmacSig` token carrying
    `{ username, expiry }`, signed with `SESSION_SECRET`; cookie builders set
    **HttpOnly · SameSite=Strict · Path=/ · Max-Age**, plus **Secure** in
    production (`NODE_ENV=production` or any `VERCEL_ENV`).
  - `auth.js` — `authenticateUser` decoupled from storage via an injected
    `lookupUser` (testable without a DB).
- **DB**: `db.js` (Neon HTTP driver, lazy from `DATABASE_URL`) + `schema.sql`.
- **Endpoints**: `POST /api/login`, `POST /api/logout`, `GET /api/session`
  (method-guarded with 405; login returns 401 on bad credentials).
- **Seed**: `scripts/db-setup.mjs` seeds `Tomek`, `Alessandro`, `Artsi`
  (password = username), hashed + salted, `ON CONFLICT DO NOTHING`.
- **Dependency**: `@neondatabase/serverless` (0 vulnerabilities). `package-lock`
  updated so CI `npm ci` stays in sync. Added `npm run db:setup`.

## 3. Schema (applied by `db:setup`)

`users(username PK, pass_hash, salt, created_at)`,
`app_state(id=1 single-row, data JSONB, revision BIGINT DEFAULT 1, updated_at)`,
`change_log(id BIGSERIAL, username, action, entity, field, old_value, new_value,
created_at)` + `change_log_created_at_idx (created_at DESC)`.

> `app_state` is created but **not** seeded in Phase 1 — the first row is written
> when `PUT /api/state` lands (Phase 2). `change_log` is unused until Phase 3.

## 4. Environment variables (server-only)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string (from the Vercel Marketplace Neon integration). |
| `SESSION_SECRET` | Long random secret for HMAC-signing session cookies. |

Neither is ever exposed to the browser (no `VITE_` prefix, used only in `/api`
and scripts). CSP is unchanged. Generate a secret with:
`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

## 5. How to run locally

The plain Vite dev server does **not** run `/api` — use the Vercel CLI.

```bash
npm i -g vercel              # one-time
vercel link                  # link this repo to a Vercel project
# Provision Neon via the Vercel dashboard (Marketplace → Neon), then:
vercel env pull .env.local   # pulls DATABASE_URL (+ add SESSION_SECRET in dashboard)

# Apply schema + seed the three users:
node --env-file=.env.local scripts/db-setup.mjs
#   (or: set DATABASE_URL in your shell, then `npm run db:setup`)

vercel dev                   # serves the SPA + /api together
```

Manual verification once running:

```bash
curl -i -X POST localhost:3000/api/login \
  -H 'content-type: application/json' -d '{"username":"Tomek","password":"Tomek"}'
# → 200, Set-Cookie: angles_session=...; HttpOnly; SameSite=Strict

curl -s localhost:3000/api/session -H 'cookie: angles_session=<token>'
# → {"username":"Tomek"}

curl -s localhost:3000/api/session           # no cookie → {"username":null}
curl -i -X POST localhost:3000/api/login \
  -H 'content-type: application/json' -d '{"username":"Tomek","password":"wrong"}'
# → 401
```

## 6. Tests

`npm test` → **548 passed (69 files)**, including **25 new** unit tests:

- `password.test.js` (6) — hash/verify, random salt, wrong password, tampered
  hash, non-string inputs.
- `session.test.js` (14) — sign/verify round-trip, **expired** rejection,
  **invalid signature** rejection, tampered payload, wrong secret, malformed
  tokens, cookie parsing, `getSessionUser` valid/missing/invalid, cookie
  attributes (HttpOnly/SameSite/Secure/Max-Age).
- `auth.test.js` (5) — login success, wrong password, unknown user, empty
  credentials, async lookup.

The endpoint route files + `db.js` are I/O wrappers, verified by `node --check`
and an import smoke test; they are exercised end-to-end via the curl steps above
(requires a live Neon DB).

## 7. Out of scope (untouched, as required)

`GET`/`PUT /api/state`, `GET /api/history`, `diffStates` usage, `App.jsx`,
`AdminPage`, `src/storage/db.js`, localStorage persistence, the startup modal,
visible UI, and CSP — all unchanged. The existing localStorage app builds and
runs exactly as before (`npm run build` ✓).

## 8. Reversibility

Delete `api/`, `scripts/db-setup.mjs`, `.env.example`, the `db:setup` script
line, and the `@neondatabase/serverless` dependency. No production code paths
reference the new modules yet.
