# Angles

> Saw-angle reference tool for production workshops: select products, compare MAIN and STEFAN cut angles, print reference sheets, and manage a shared catalog.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-avacut.vercel.app-black?style=flat-square&logo=vercel)](https://avacut.vercel.app)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev)
[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-000?style=flat-square&logo=vercel)](https://vercel.com)

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

---

## Tech Stack

- **React 19** and **Vite 8** for the SPA
- **Vercel Functions** in `/api` for auth, catalog state, and history
- **Neon Postgres** for users, shared catalog JSON, and audit log
- **httpOnly HMAC session cookie** for admin sessions
- **localStorage** only for device-local UI state such as work progress, work theme, and last-seen change id
- **react-hot-toast** for notifications

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
- Export downloads the visible catalog/draft as JSON.
- Import validates and stages a draft; it reaches the shared database only after SAVE.
- Only raster image data URLs are accepted on import/upload; SVG is rejected.

---

## Security

Security headers are configured in [`vercel.json`](vercel.json): CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy`.

Known limitations:

- Seeded passwords must be supplied through env; `password = username` is opt-in only via `ALLOW_WEAK_SEED_PASSWORDS=true`.
- `/api/login` is rate-limited by a shared Neon-backed throttle (per IP + username, 15-min window); it fails open if the throttle store is unavailable.
- Public catalog read is intentional; admin writes and history require a valid session.
- Secrets stay server-side only (`DATABASE_URL`, `SESSION_SECRET`).

Current docs: [`THREAT_MODEL.md`](THREAT_MODEL.md), [`SECURITY_DEBT.md`](SECURITY_DEBT.md), [`SECURITY_CHECKLIST.md`](SECURITY_CHECKLIST.md).

Historical pre-backend audit: [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md).
