# Phase 2A report — shared catalog API (`/api/state`)

**Date:** 2026-06-08
**Scope:** Backend `/api/state` only — public read, authenticated write,
revision optimistic locking, sanitization, diff-on-save audit logging, atomic
writes. **No** frontend wiring, no `App.jsx`/`AdminPage`/`src/storage/db.js`
changes, no PIN replacement, no history UI, no startup modal, no localStorage
removal, no CSP change.

---

## 1. Files added / changed

```
api/state.js                 GET (public) + PUT (auth) route; handleState(req,res,store) is injectable
api/_lib/stateService.js     orchestration: getState / putState / validatePutBody / buildDefaultCatalog
api/_lib/stateStore.js       neonStore: readState / initState / commitWrite (single-statement atomic write)
api/_lib/stateService.test.js  10 unit tests (in-memory store, no DB)
api/state.test.js            2 route-guard tests (401 / 405)
docs/.../2026-06-08-phase2a-report.md
```

Schema/setup: **unchanged** — `app_state(revision DEFAULT 1)` and `change_log`
from Phase 1 already cover this phase.

## 2. How `/api/state` works

**GET (public, GET-only):** reads the single `app_state` row. If absent,
initializes it from the default catalog — built exactly like the existing app
(`migrateV1toV2(v1 defaults)` → `migrateAndSanitize`), so a fresh DB matches a
fresh browser. Returns `{ data, revision }`, always re-sanitized. No secrets.

**PUT (session cookie required, PUT-only):** body `{ data, revision }`.
1. Validate body shape → `400 invalid_body` on garbage.
2. `sanitized = migrateAndSanitize(body.data)`.
3. Read current `{ data, revision }` (init if missing).
4. `body.revision !== current.revision` → **`409 stale_revision`**, nothing written.
5. If `sanitized` deep-equals current → **no-op**: return current data + revision,
   `changes: 0`, no write, no revision bump.
6. Otherwise `events = diffStates(current.data, sanitized)` and commit
   atomically: CAS update + revision++ + one `change_log` row per event.
   Returns `{ data: sanitized, revision: newRevision, changes: events.length }`.

## 3. Revision conflict (optimistic locking)

`app_state.revision` is the concurrency token. A writer must echo the revision it
read; the server only applies the write if it still matches (compare-and-set). On
mismatch it responds:

```json
{ "error": "stale_revision",
  "message": "Catalog has changed. Reload latest state and retry.",
  "currentRevision": 123 }
```

…and writes nothing. The client must reload, re-apply, and retry. The CAS is
re-checked atomically inside the write itself, so even a race that slips past the
read-time check is caught (also returns 409).

## 4. Atomicity (no app_state ↔ change_log drift)

`commitWrite` is a **single data-modifying-CTE statement**, so Postgres runs it
as one atomic unit — no interactive/WebSocket transaction needed:

```sql
WITH upd AS (
  UPDATE app_state SET data = $data::jsonb, revision = revision + 1, updated_at = now()
   WHERE id = 1 AND revision = $expected
  RETURNING revision
),
ins AS (
  INSERT INTO change_log (username, action, entity, field, old_value, new_value)
  SELECT $username, x.action, x.entity, x.field, x.old_value, x.new_value
    FROM jsonb_to_recordset($events::jsonb)
      AS x(action text, entity text, field text, old_value text, new_value text)
   WHERE EXISTS (SELECT 1 FROM upd)        -- log only if the CAS update applied
  RETURNING 1
)
SELECT (SELECT revision FROM upd) AS revision, (SELECT count(*)::int FROM ins) AS inserted;
```

If the revision doesn't match, `upd` returns 0 rows, `ins` inserts nothing, and
`revision` comes back NULL → reported as a conflict. Either both writes happen or
neither does.

## 5. No-op vs image-only (intentional distinction)

`diffStates` ignores image fields, so a drawing/cover upload yields **zero**
events. These two cases are handled differently on purpose:

- **No-op** (sanitized payload deep-equals current): skip the write entirely —
  no revision bump, no log rows.
- **Image-only change** (data differs but no loggable events): the change **is
  persisted** and revision **is** bumped, but **no** `change_log` rows are
  written (images are not audited). Otherwise image edits would be silently lost.

> If you instead want image-only saves to be true no-ops (not persisted), say so
> and I'll fold image equality into the no-op check.

## 6. Local smoke test (`vercel dev`)

Prereqs from Phase 1: `vercel dev` running, Neon provisioned, `DATABASE_URL` +
`SESSION_SECRET` set, `node --env-file=.env.local scripts/db-setup.mjs` run.

```bash
# 1) Public read — initializes app_state on first call
curl -s localhost:3000/api/state
# → {"data":{"version":2,"holds":[...],"angles":[...]},"revision":1}

# 2) Log in, capturing the session cookie
curl -s -c cookies.txt -X POST localhost:3000/api/login \
  -H 'content-type: application/json' -d '{"username":"Tomek","password":"Tomek"}'
# → {"username":"Tomek"}

# 3) Authenticated write at the current revision (use the revision from step 1)
curl -s -b cookies.txt -X PUT localhost:3000/api/state \
  -H 'content-type: application/json' \
  -d '{"revision":1,"data":{"version":2,"holds":[{"id":"h1","name":"Austin"}],"angles":[{"id":"a1","holdId":"h1","value":45,"saw":"main"}]}}'
# → {"data":{...},"revision":2,"changes":1}

# 4) Stale revision → 409 (reusing the now-stale revision 1)
curl -s -i -b cookies.txt -X PUT localhost:3000/api/state \
  -H 'content-type: application/json' \
  -d '{"revision":1,"data":{"version":2,"holds":[{"id":"h1","name":"Austin"}],"angles":[]}}'
# → HTTP/1.1 409 ... {"error":"stale_revision","message":"...","currentRevision":2}

# 5) Unauthenticated write → 401
curl -s -i -X PUT localhost:3000/api/state -H 'content-type: application/json' \
  -d '{"revision":2,"data":{"version":2,"holds":[],"angles":[]}}'
# → HTTP/1.1 401
```

## 7. Tests (all 13 required, mapped)

`npm test` → **560 passed (71 files)** (+12 new). Build ✓ (SPA bundle unchanged).

| # | Requirement | Where |
|---|---|---|
| 1 | GET returns data + revision | `getState` returns from store |
| 2 | GET initializes app_state if missing | `getState` init-from-default |
| 3 | PUT unauthenticated → 401 | `state.test.js` route guard |
| 4 | PUT invalid method → 405 | `state.test.js` route guard |
| 5 | PUT invalid body → 400 | `putState` validation |
| 6 | PUT stale revision → 409, no write | conflict test (row/log unchanged) |
| 7 | PUT matching revision accepted | success test |
| 8 | Successful PUT increments revision | success test (revision 1→2) |
| 9 | Successful PUT writes change_log from diffStates | log-row test (attributed to user) |
| 10 | Image-only change → no change_log rows | image-only test (persists, 0 logs) |
| 11 | No-op save → no increment, no logs | no-op test |
| 12 | Returned data is sanitized | clamp/orphan-drop test |
| 13 | Transaction failure → no drift | failing-commit atomicity test |

The Neon-backed `stateStore` and the thin route wrapper are verified by
`node --check` + import smoke test and exercised end-to-end via the curl steps
above (require a live DB).

## 8. Out of scope (untouched)

No frontend wiring, no async `loadState`/`saveState` migration, no
`App.jsx`/`AdminPage`/`src/storage/db.js` change, no login-form replacement, no
history tab, no startup modal, no localStorage cleanup, no CSP weakening. The
existing localStorage app builds and runs exactly as before.
