# Phase 3 report - change history API and admin tab

**Date:** 2026-06-08
**Scope:** Add authenticated history reads and expose the newest change-log rows
in the admin UI. **No** startup modal / `lastSeenChangeId` flow yet.

---

## 1. Files changed

```
api/history.js              GET /api/history route, session required
api/history.test.js         route guard + happy-path tests
api/_lib/stateStore.js      neonStore.readHistory(limit)
src/storage/history.js      frontend loadHistory(limit) API client
src/storage/history.test.js unit tests for loadHistory
src/components/AdminPage.jsx  CATALOG / HISTORY admin modes, history table
src/App.test.jsx            integration test for authenticated history tab
```

## 2. Backend behaviour

- `GET /api/history` requires a valid `angles_session` cookie.
- Missing/invalid session returns `401`.
- Non-GET methods return `405`.
- `limit` defaults to `200` and is clamped to `1..500`.
- Rows come from `change_log`, ordered newest first:
  `created_at DESC, id DESC`.

Response shape:

```json
{
  "rows": [
    {
      "id": 10,
      "username": "Tomek",
      "action": "angle_changed",
      "entity": "Austin",
      "field": "value",
      "oldValue": "30",
      "newValue": "45",
      "createdAt": "2026-06-08T12:00:00.000Z"
    }
  ]
}
```

The history remains server-derived from Phase 2A/2D `PUT /api/state` writes; the
client never submits audit events directly.

## 3. Frontend behaviour

- `src/storage/history.js` adds `loadHistory(limit)` with same-origin
  credentials and response-shape validation.
- `AdminPage` now has two modes in the left footer:
  - `CATALOG` - existing hold/angle editor.
  - `HISTORY` - authenticated change journal.
- Opening `HISTORY` loads the newest 200 rows. The tab has a manual refresh
  button.
- Successful admin **SAVE** refreshes history when the history tab is currently
  open.
- Empty, loading, and error states are rendered inside the history panel.

## 4. Test coverage added

- `api/history.test.js`
  - unauthenticated `GET` -> 401
  - invalid methods -> 405
  - valid session returns injected store rows
- `src/storage/history.test.js`
  - calls `/api/history?limit=...`
  - throws with status on non-OK response
  - rejects invalid response shape
- `src/App.test.jsx`
  - authenticated admin can open `HISTORY`, which fetches `/api/history` and
    renders user/action/entity/change values.

## 5. Verification

`npm test` -> **595 passed (74 files)**.

`npm run build` -> **passed**.

## 6. Next

- **4** - add latest-change awareness:
  - `/api/session` returns `latestChange`.
  - browser stores `lastSeenChangeId`.
  - logged-in users see "{username} изменил базу" when another user saved after
    their last seen change.
  - OK opens the history tab and advances the seen marker.
