# Design: Shared backend, multi-user auth, change history

**Date:** 2026-06-08
**Status:** Approved (pending spec review)
**Topic:** Move Angles from localStorage-only to a shared, online, multi-user backend with an audit log.

---

## 1. Background & motivation

Angles is currently a **zero-backend SPA**: all data lives in each browser's
`localStorage`, and the CSP in [`vercel.json`](../../../vercel.json)
(`connect-src 'self'`) blocks all network requests by design.

The workshop now needs:

1. **Three named users** — `Tomek`, `Alessandro`, `Artsi` (password = username).
2. **One shared database** that is identical on every device.
3. **A change-history tab** in the admin panel: who changed what (hold name /
   angle), and when.
4. **A startup modal** for logged-in users when the database changed since they
   last looked: "*{username} изменил базу*" → **OK** opens the history tab.

A shared database across devices is physically impossible with `localStorage`,
so this introduces a real server-side backend. All four needs hinge on it:
"who changed it" requires users, and the history itself must be shared.

## 2. Decisions locked during brainstorming

| Question | Decision |
|---|---|
| Offline behaviour | **Online only.** Data is always live from the shared DB; no offline cache, no sync/conflict logic. |
| Access model | **Public read, gated write.** The main page (tables, print, work mode) stays open without login. Editing requires login as one of the three users. |
| User roles | All three users are equal admins (no role distinction). |
| Logged events | Angle value change; hold add / rename / delete; angle add / delete. **Image uploads are NOT logged.** |
| Backend approach | **Vercel Functions (same-origin `/api`) + Neon Postgres** (Vercel Marketplace). |
| Startup modal audience | **Logged-in users only.** Public viewers never see it (the journal is gated anyway). |

## 3. Architecture & data flow

```
Browser (React SPA, same origin)
   │  GET  /api/state      ← public, anyone can read the catalog
   │  GET  /api/session    ← who am I + latest change summary
   │  POST /api/login      ← Tomek / Alessandro / Artsi
   │  POST /api/logout
   │  PUT  /api/state      ← edits, session required (writes history)
   │  GET  /api/history    ← change journal, session required
   ▼
Vercel Functions  /api/*   (passwords + session secret live ONLY here)
   ▼
Neon Postgres  (Vercel Marketplace)
```

The catalog is stored as a **single JSON document** (same shape as today's
localStorage blob), so the existing `migrateAndSanitize` domain pipeline and its
tests are reused with minimal change. Because the API is same-origin, the strict
CSP `connect-src 'self'` is **unchanged** — Neon is reached only by server
functions, never by the browser.

## 4. Database schema (Neon Postgres)

```sql
CREATE TABLE users (
  username  TEXT PRIMARY KEY,
  pass_hash TEXT NOT NULL,
  salt      TEXT NOT NULL
);

CREATE TABLE app_state (
  id         INT PRIMARY KEY DEFAULT 1,          -- single-row table
  data       JSONB NOT NULL,                     -- { version, holds, angles }
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);

CREATE TABLE change_log (
  id         BIGSERIAL PRIMARY KEY,
  username   TEXT NOT NULL,
  action     TEXT NOT NULL,   -- see action vocabulary below
  entity     TEXT,            -- human-readable hold name
  field      TEXT,            -- e.g. 'value' | 'name' | 'saw'
  old_value  TEXT,
  new_value  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX change_log_created_at_idx ON change_log (created_at DESC);
```

**Seeding:** `users` is seeded once with the three users; `pass_hash =
hash(password + salt)` computed server-side. `app_state` is seeded with the
current default catalog (migrated to v2) on first run if empty.

**Action vocabulary** (`change_log.action`):
`hold_added`, `hold_renamed`, `hold_deleted`,
`angle_added`, `angle_changed`, `angle_deleted`.

**Retention:** all rows kept. The history tab displays the newest ~200.

## 5. API endpoints (Vercel Functions, same origin)

| Method | Path | Access | Behaviour |
|---|---|---|---|
| `GET`  | `/api/session` | public | Returns `{ username \| null, latestChange: { id, username, created_at } \| null }`. |
| `POST` | `/api/login`   | public | Verify username/password → set httpOnly, Secure, SameSite=Strict, HMAC-signed session cookie. Returns `{ username }`. |
| `POST` | `/api/logout`  | public | Clear the session cookie. |
| `GET`  | `/api/state`   | public | Return the sanitized catalog `{ version, holds, angles }`. |
| `PUT`  | `/api/state`   | session | Save the catalog **and** write history (see §7). Returns the new sanitized catalog. |
| `GET`  | `/api/history` | session | Return change-log rows, newest first (default limit 200). |

**Session token:** a compact HMAC-signed value (e.g. `username.expiry.signature`)
signed with `SESSION_SECRET`. No third-party auth dependency required. Cookie is
httpOnly + Secure + SameSite=Strict.

**Password hashing:** server-side, salted (PBKDF2 via Node `crypto`, or salted
SHA-256 to match the app's existing hashing style). Plaintext passwords never
leave the server and are never stored.

## 6. Frontend changes

- **`src/storage/db.js`** — `loadState` / `saveState` become **async** and call
  `/api/state` (GET / PUT). The domain sanitization import stays. The whole
  `data` object keeps its current shape, so React state code changes little.
- **`src/App.jsx`** — initial catalog load moves from a synchronous
  `useState(() => loadState())` to an effect-driven fetch with **loading** and
  **no-connection** states (online-only).
- **Login** — the 4-digit PIN modal is replaced by a **username + password**
  form posting to `/api/login`. Login state is derived from the session cookie
  via `/api/session`. The public main page renders without login.
- **AdminPage** — new **"История изменений"** tab rendering a table:
  `дата · пользователь · действие · изделие · было → стало`, fed by `/api/history`.
- **EXPORT** is kept (download a JSON backup of the current catalog).
  **IMPORT** now writes to the server via `PUT /api/state` (and therefore also
  appears in the history).
- **Work-mode progress** (`src/storage/workProgress.js`) stays **device-local**
  in localStorage — it is per-operator UI state (selected holds, checked
  angles), not shared catalog data.
- The localStorage `app_state` persistence and the 5-snapshot backup ring
  (`src/storage/backups.js`) are superseded by the server for the shared
  catalog. EXPORT remains as the manual backup path. (Backup-ring cleanup is a
  minor follow-up, not core scope.)

## 7. Change history via diff-on-save (key mechanism)

The client keeps doing the simple thing: it `PUT`s the **entire** `data` object.
The server determines **what** changed, so the client cannot bypass or forget to
log an edit.

A pure domain function `diffStates(oldDb, newDb)` (in `src/domain/`, fully
unit-tested) returns an ordered list of change events:

- **Holds** (matched by stable `id`):
  - id in new but not old → `hold_added` (entity = new name)
  - id in old but not new → `hold_deleted` (entity = old name)
  - id in both, `name` differs → `hold_renamed` (old → new name)
- **Angles** (matched by stable `id`; entity = owning hold's name):
  - id in new but not old → `angle_added` (new value, saw)
  - id in old but not new → `angle_deleted` (old value)
  - id in both, `value` differs → `angle_changed`, field `value` (old → new)
  - id in both, `saw` differs → `angle_changed`, field `saw` (old → new)

`PUT /api/state` runs in a single transaction:
1. Sanitize the incoming state with `migrateAndSanitize`.
2. Load the current `app_state.data`.
3. `events = diffStates(current, sanitized)`.
4. Write `app_state.data = sanitized`, then insert one `change_log` row per
   event with `username` from the session and `created_at = now()`.

Because diff + write are atomic, the journal can never drift from the catalog.

## 8. Startup "database changed" modal

- The device stores `lastSeenChangeId` in localStorage.
- On load, for a logged-in user, `GET /api/session` returns `latestChange`.
- Show the modal when `latestChange.id > lastSeenChangeId` **and**
  `latestChange.username !== currentUser` → "**{username} изменил базу**" with an
  **OK** button. (A user's own edits update `lastSeenChangeId` silently, no modal.)
- **OK** sets `lastSeenChangeId = latestChange.id` and opens the
  "История изменений" tab.
- Manually opening the history tab also advances `lastSeenChangeId` to the newest
  row.

## 9. Security

- ⚠️ **Password = username** is trivially guessable. Accepted for an internal
  workshop tool; recorded as known debt in `SECURITY_DEBT.md`. Mitigations still
  apply: hashing + session secret are server-side; cookie is
  httpOnly/Secure/SameSite=Strict.
- CSP is **not** weakened — `connect-src 'self'` stays; Neon is server-only.
- Optional, out of core scope: a simple rate-limit on `/api/login`.

## 10. Testing & local development

- **Unit tests (vitest):** `diffStates`, catalog sanitization (existing),
  history row formatting, and the session-token sign/verify helper.
- **Local dev:** `/api` functions require the **Vercel CLI** (`vercel dev`),
  which is not currently installed — installation is part of the plan. Required
  env: `DATABASE_URL` (Neon), `SESSION_SECRET`.

## 11. Implementation phases (for the plan)

1. **Backend foundation** — Neon provisioning, schema + seed, session helper,
   `login` / `logout` / `session` endpoints, password hashing.
2. **Shared catalog** — `GET` / `PUT /api/state`, async `db.js`, App.jsx
   loading/error states, replace PIN login with user/password login.
3. **History** — `diffStates`, transactional logging in `PUT /api/state`,
   `GET /api/history`, the admin "История изменений" tab.
4. **Startup modal** — `latestChange` in `/api/session`, `lastSeenChangeId`
   tracking, the modal + OK → history flow.

## 12. Out of scope (YAGNI)

- Offline support / sync / conflict resolution.
- User roles / permissions beyond "logged-in can edit".
- Self-service password change / reset UI.
- Moving images to dedicated blob storage.
- Real-time push of changes (the startup modal covers the need).
