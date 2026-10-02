# Angles

> Saw-angle reference tool for production workshops: select products, compare MAIN and STEFAN cut angles, print reference sheets, and manage a shared catalog.

[![Version](https://img.shields.io/badge/version-v1.5-brightgreen?style=flat-square)](CHANGELOG.md)
[![Live Demo](https://img.shields.io/badge/Live%20Demo-avacut.vercel.app-black?style=flat-square&logo=vercel)](https://avacut.vercel.app)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev)
[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-000?style=flat-square&logo=vercel)](https://vercel.com)
[![License](https://img.shields.io/badge/license-proprietary-lightgrey?style=flat-square)](#license)

**Current version: v1.5** — see the [changelog](CHANGELOG.md) and [release notes](docs/RELEASE_NOTES.md).

---

## What It Does

Angles is an online workshop reference app. Operators can select one or more products, view their saw angles for **MAIN** and **STEFAN**, open the cutting drawing for a row, use a phone-friendly work mode, and print A4 reference sheets.

Admins sign in as a named user and edit one shared catalog stored in Neon Postgres through same-origin Vercel Functions. Every successful catalog save is revision-locked and logged to a change history.

---

## Features

| | |
|---|---|
| **Shared catalog** | Public read from `GET /api/state`; authenticated admin save via `PUT /api/state` |
| **Dual-table view** | MAIN and STEFAN angle tables, sortable asc/desc |
| **Multi-select products** | Select any number of products; tables update instantly |
| **Drawing viewer** | Click a row to show a drawing; zoom and dedicated print are available |
| **Print mode** | ALL / MAIN / STEFAN layouts for A4 reference sheets |
| **Admin panel** | Add, rename, delete holds and angles; upload drawings and cover images |
| **Named users** | `Tomek`, `Alessandro`, and `Artsi` are seeded by `npm run db:setup` |
| **Change history** | Admin `HISTORY` view shows who changed what and when |
| **Change notification** | Logged-in users are notified when another user changed the database |
| **Work mode** | Device-local progress for checked angles and work theme |
| **Import / Export** | Export JSON backups; import stages a draft that is persisted on SAVE |
| **Garmin watch app** | Angles of selected holds on the wrist: BIG MODE, colored list, saved progress — see [`garmin/README.md`](garmin/README.md) |
| **Send to watch** | ⌚ button next to print sends the selected holds to the watch via `/api/watch` |

---

## Tech Stack

- **React 19** and **Vite 8** for the SPA
- **Vercel Functions** in `/api` for auth, catalog state, and history
- **Neon Postgres** for users, shared catalog JSON, and audit log
- **httpOnly HMAC session cookie** for admin sessions
- **localStorage** only for device-local UI state such as work progress, work theme, and last-seen change id
- **react-hot-toast** for notifications

---

## Project Structure

```text
angles-proto/
├── api/                 # Vercel Functions (auth, state, history) + _lib shared logic
│   ├── _lib/            # auth, session, db, stateService, rateLimit, schema.sql
│   ├── login.js  logout.js  session.js
│   ├── state.js         # GET/PUT shared catalog
│   ├── history.js       # GET audit log
│   └── watch.js         # GET compact catalog + selection for the watch, POST "Send to watch"
├── src/                 # React SPA
│   ├── components/      # shared UI + AdminPage.jsx (the admin surface lives here today)
│   ├── features/        # operator/ split out; admin/ is a thin re-export stub for now
│   ├── domain/          # pure logic: angles, holds, diff, validation, migration
│   ├── storage/         # client data access: auth, history, import/export, work progress
│   ├── utils/           # helpers (image handling)
│   ├── App.jsx  main.jsx
│   └── contexts/ hooks/ constants/ styles/ assets/
├── garmin/              # Connect IQ watch app (Monkey C) — see garmin/README.md
├── scripts/             # db-setup.mjs, seed-users.mjs
├── docs/                # ARCHITECTURE, DEVELOPMENT, ROADMAP, RELEASE_NOTES, OPERATIONS
├── public/              # static assets
├── vercel.json          # security headers + routing
└── vite.config.js
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how these fit together.

---

## Quick Start

For UI-only development:

```bash
npm install
npm run dev
```

Vite serves the SPA at the URL it prints, usually `http://localhost:5173`. The plain Vite server does **not** run `/api`, so shared catalog and login calls need Vercel dev.

For full local development with backend functions:

```bash
npm install
vercel env pull .env.local
node --env-file=.env.local scripts/db-setup.mjs
vercel dev
```

Required server-only environment variables:

```env
DATABASE_URL=postgresql://...
SESSION_SECRET=long-random-secret
SEED_PASSWORD_TOMEK=...
SEED_PASSWORD_ALESSANDRO=...
SEED_PASSWORD_ARTSI=...
```

Alternatively, set `SEED_USER_PASSWORDS` to a JSON object such as
`{"Tomek":"...","Alessandro":"...","Artsi":"..."}`. The legacy
`password = username` seed mode is available only with
`ALLOW_WEAK_SEED_PASSWORDS=true` and should be used for local/internal setup
only.

Build and tests:

```bash
npm run lint
npm test
npm run build
npm run audit
```

---

## Admin Panel

Open `/#/admin` or click **ADMIN** in the app.

- Login uses username + password against `/api/login`.
- Seeded users are `Tomek`, `Alessandro`, and `Artsi`; the setup script requires explicit seed passwords from env by default.
- The session is stored only as a server-set httpOnly cookie.
- Admin SAVE sends the full catalog plus server revision to `PUT /api/state`.
- If the catalog changed since the admin loaded it, the server returns `409 stale_revision`; the UI keeps the draft unsaved and asks the user to reload before retrying.
- The `HISTORY` tab reads `GET /api/history` and displays the newest audit rows.

---

## Data & Storage

- Shared catalog data lives in Neon Postgres `app_state.data` as a single JSON document.
- `app_state.revision` is the optimistic concurrency token for saves.
- `change_log` records hold/angle adds, deletes, renames, saw changes, and value changes.
- Image-only changes are persisted but not logged as audit events.
- Work-mode progress and theme are intentionally device-local in `localStorage`.
- `watch_selection` holds the last hold selection sent with **Send to watch** (single row, public write — see Security).
- Export downloads the visible catalog/draft as JSON.
- Import validates and stages a draft; it reaches the shared database only after SAVE.
- Only raster image data URLs are accepted on import/upload; SVG is rejected.

---

## Screenshots

> **Screenshots are not yet checked into the repo.** Add them under
> `docs/screenshots/` (create the folder) and reference them here. A live
> instance is available at [avacut.vercel.app](https://avacut.vercel.app).

Recommended screenshots to add:

- [ ] Operator dual-table view (MAIN + STEFAN)
- [ ] Drawing viewer with zoom
- [ ] A4 print mode
- [ ] Admin catalog editing
- [ ] Change history view
- [ ] Phone work mode with green/red row indicators

<!--
Example once added:

![Operator view](docs/screenshots/operator.png)
![Admin panel](docs/screenshots/admin.png)
-->

---

## Security

Security headers are configured in [`vercel.json`](vercel.json): CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy`.

Known limitations:

- Seeded passwords must be supplied through env; `password = username` is opt-in only via `ALLOW_WEAK_SEED_PASSWORDS=true`.
- `/api/login` is rate-limited by a shared Neon-backed throttle (per IP + username, 15-min window); it fails open if the throttle store is unavailable.
- Public catalog read is intentional; admin writes and history require a valid session.
- `POST /api/watch` (Send to watch) is public like the catalog read: it only stores hold names that exist in the catalog (max 200), but anyone with the URL can overwrite the watch selection. Acceptable while one person uses the watch; tracked as D15 in `SECURITY_DEBT.md`.
- Secrets stay server-side only (`DATABASE_URL`, `SESSION_SECRET`).

Current docs: [`THREAT_MODEL.md`](THREAT_MODEL.md), [`SECURITY_DEBT.md`](SECURITY_DEBT.md), [`SECURITY_CHECKLIST.md`](SECURITY_CHECKLIST.md).

Historical pre-backend audit: [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md).

Vulnerability reporting: see [`SECURITY.md`](SECURITY.md) — do not open public issues for security problems.

---

## Roadmap

Full detail in [`docs/ROADMAP.md`](docs/ROADMAP.md).

- **v1.5 — current stable.** Shared Neon backend, server-verified admin
  sessions, audit log, change notifications, responsive UI polish. All gates
  green.
- **v1.6 — stabilization / UX polish / bug fixes.** Smoother `409` recovery
  (auto-refresh revision), documented setup gotchas, scheduled `login_attempts`
  pruning.
- **v2.0 — architectural expansion.** Cover/drawing images to blob storage,
  self-service password rotation / external identity, real stale-save merge,
  repo branch protection.

---

## Known Limitations

General product and operational limitations. Security-specific risks and
trade-offs are covered in [Security](#security) above.

- **Online-only.** Without a reachable backend the app shows a no-connection
  retry screen; the shared catalog is never the source of truth in the browser.
- **Manual `409` recovery.** A stale-revision save keeps the draft but requires
  a manual reload before retrying (planned for v1.6).
- **Image payload size.** Cover/drawing images are base64 inside the catalog
  JSON, so runtime payload is dominated by image data (planned for v2.0).
- **Internal-network deployment.** Angles targets a trusted internal workshop
  network rather than open public exposure; see [`SECURITY_DEBT.md`](SECURITY_DEBT.md).

---

## Maintainer Notes

- **Quality gates** are `npm run lint`, `npm test`, `npm run build`,
  `npm run audit` — all enforced in CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml))
  and required before merging. See [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **Secrets are server-only** (`DATABASE_URL`, `SESSION_SECRET`, seed passwords)
  and must never use a `VITE_` prefix. Database dumps must stay out of the repo
  ([`docs/OPERATIONS.md`](docs/OPERATIONS.md)).
- **Most common real failure is operational**, not code — a missing env var or
  un-run `db:setup` surfaces as the no-connection screen. Preview deploys lack
  `SESSION_SECRET` (Production-only).
- **Mobile CSS is fragile** (`!important` media-query overrides); verify on a
  narrow viewport after layout changes.
- Backup/restore: [`docs/OPERATIONS.md`](docs/OPERATIONS.md). Architecture:
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Dev setup:
  [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

---

## License

Proprietary — all rights reserved. This is an internal workshop tool and is not
licensed for external use, redistribution, or modification without permission
from the maintainer. See [`LICENSE`](LICENSE).
