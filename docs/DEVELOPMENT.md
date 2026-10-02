# Development

How to set up, run, and verify Angles locally. For the big picture see
[`ARCHITECTURE.md`](ARCHITECTURE.md).

## Prerequisites

- Node.js 20+ (CI uses Node 20).
- npm (the repo ships a `package-lock.json`; use `npm ci` for reproducible
  installs).
- For full-stack local dev: the [Vercel CLI](https://vercel.com/docs/cli) and
  access to the project's Neon database.

## Two ways to run

### UI-only (no backend)

Fastest loop for frontend work. The plain Vite server does **not** serve `/api`,
so login and shared-catalog calls won't work.

```bash
npm install
npm run dev          # usually http://localhost:5173
```

### Full local backend

Runs the Vercel Functions and talks to the real Neon database.

```bash
npm install
vercel env pull .env.local                          # pulls server-only secrets
node --env-file=.env.local scripts/db-setup.mjs     # idempotent schema + seed
vercel dev
```

## Environment variables

Server-only — never exposed to the browser, never `VITE_`-prefixed. Copy
`.env.example` to `.env.local` (gitignored) or set them in the Vercel dashboard.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string. |
| `SESSION_SECRET` | Long random value used to HMAC-sign session cookies. |
| `SEED_PASSWORD_TOMEK` / `_ALESSANDRO` / `_ARTSI` | Per-user seed passwords for `db:setup`. |
| `SEED_USER_PASSWORDS` | Alternative single JSON map of seed passwords. |
| `ALLOW_WEAK_SEED_PASSWORDS` | Local/internal only: seed `password = username`. |

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

> **Setup gotcha:** the most common local/deploy failure is the "No connection
> to the server" screen, caused by a missing `DATABASE_URL` / `SESSION_SECRET`
> or an un-run `db:setup`. Preview deploys intentionally lack `SESSION_SECRET`
> (Production-only).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server (UI only). |
| `npm run build` | Production build to `dist/`. |
| `npm run preview` | Serve the production build locally. |
| `npm test` | Run the Vitest suite once. |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run test:coverage` | Tests with V8 coverage. |
| `npm run lint` | ESLint (`src`), zero warnings allowed. |
| `npm run audit` | `npm audit --audit-level=high`. |
| `npm run db:setup` | Idempotent schema creation + user seeding. |

## Before opening a PR

Run the same gates CI enforces:

```bash
npm run lint
npm test
npm run build
npm run audit
```

All must pass. See [`../CONTRIBUTING.md`](../CONTRIBUTING.md) for branching and
review conventions.

## Garmin watch app

The watch app in `garmin/` is built separately with the Connect IQ SDK and a
local developer key (never committed). Build, install and the `/api/watch`
contract are documented in [`../garmin/README.md`](../garmin/README.md).
When changing the `/api/watch` response shape, update the watch app
(`garmin/source/AnglesApp.mc`) in the same PR and keep `t` in unix seconds.

## Tests

Tests are colocated next to the code they cover (`*.test.js` / `*.test.jsx` /
`*.test.mjs`) across `src/domain`, `src/storage`, `api/_lib`, and `scripts`.
Domain logic and API handlers are the most heavily covered. Add or update tests
alongside any behavior change.
