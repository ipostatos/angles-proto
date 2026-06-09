# Architecture

A practical overview of how Angles fits together. For setup see
[`DEVELOPMENT.md`](DEVELOPMENT.md); for the threat model see
[`../THREAT_MODEL.md`](../THREAT_MODEL.md).

## Overview

Angles is a single-page React app served as static assets, backed by a small set
of same-origin serverless functions over a Neon Postgres database.

```
Browser (React 19 SPA, Vite build)
        │
        │  same-origin fetch
        ▼
Vercel Functions  /api/*        ← auth, catalog state, history
        │
        ▼
Neon Postgres   users · app_state · change_log · login_attempts
```

- **Public read, authenticated write.** Anyone can read the catalog; only a
  logged-in admin (httpOnly session cookie) can write or read history.
- **Online-only.** Without a reachable backend the app shows a no-connection
  retry screen. The shared catalog is never cached as the source of truth in the
  browser.

## Frontend (`src/`)

| Folder | Responsibility |
|---|---|
| `components/` | Shared presentational components (tables, dialogs, print sheet, icons, error boundary). |
| `features/operator/` | Operator-facing UI: hold selector, drawing viewer. |
| `features/admin/` | Admin panel surface. |
| `domain/` | Pure logic: angle computation, holds, diffing, validation, import migration. Heavily unit-tested. |
| `storage/` | Client-side data access: auth, history, import/export, work progress, db client. |
| `utils/` | Helpers (e.g. image handling). |
| `contexts/`, `hooks/`, `constants/`, `styles/`, `assets/` | React context, hooks, constants, CSS, static assets. |

`App.jsx` composes these; `main.jsx` is the entry point. Device-local state
(work-mode progress, theme, last-seen change id) lives in `localStorage` by
design and is intentionally **not** shared or backed up.

## Backend (`api/`)

Each top-level file is a serverless endpoint; `api/_lib/` holds shared logic.

| Endpoint | Purpose |
|---|---|
| `GET /api/state` | Public read of the shared catalog + current `revision`. |
| `PUT /api/state` | Authenticated catalog write; revision-checked (optimistic concurrency); logs changes. |
| `POST /api/login` | Credential check, sets httpOnly session cookie, rate-limited. |
| `POST /api/logout` | Clears the session. |
| `GET /api/session` | Returns current session status. |
| `GET /api/history` | Authenticated read of the audit log. |

`api/_lib/` modules: `auth`, `session`, `password` (scrypt), `http` helpers,
`db` (Neon client), `stateService` / `stateStore` (catalog persistence +
revision logic), `rateLimit` / `rateLimitStore` (distributed login throttle),
and `schema.sql`. Most have colocated `*.test.*` files.

## Database (`api/_lib/schema.sql`)

Idempotent schema (safe to re-run via `npm run db:setup`):

- **`users`** — username, scrypt `pass_hash` + `salt`.
- **`app_state`** — single-row catalog JSON (`data`), `revision` concurrency
  token, `updated_at`.
- **`change_log`** — append-only audit trail (username, action, entity, field,
  old/new value, timestamp).
- **`login_attempts`** — distributed throttle counter keyed by `ip:username`
  with a sliding-window `reset_at`.

## Key flows

- **Save with optimistic concurrency.** The admin sends the full catalog plus
  the `revision` it loaded. If the server `revision` advanced, the write is
  rejected with `409 stale_revision`; the UI keeps the unsaved draft and asks
  the user to reload before retrying.
- **Import/Export.** Export downloads the visible catalog as JSON. Import
  validates, unwraps the export envelope, migrates/sanitizes (raster image data
  URLs only — SVG rejected), and stages a draft that only reaches the database
  on SAVE.
- **Login throttling.** Per `ip:username`, 15-minute window, 8-failure lockout,
  atomic UPSERT, **fails open** if the store is unavailable.

## Build & deploy

- **Build:** Vite (`vite.config.js`) → static assets in `dist/`.
- **Host:** Vercel; security headers (CSP, HSTS, frame/Content-Type/Referrer/
  Permissions) configured in [`../vercel.json`](../vercel.json).
- **Data:** Neon Postgres (Vercel Marketplace integration). Backup/restore in
  [`OPERATIONS.md`](OPERATIONS.md).
