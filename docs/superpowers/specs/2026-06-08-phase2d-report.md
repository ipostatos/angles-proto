# Phase 2D report - frontend shared save (`PUT /api/state`)

**Date:** 2026-06-08
**Scope:** Wire the admin **SAVE** button to the shared backend with optimistic
revision locking. Remove the transitional device-local catalog save path from
the app shell. **No** history UI, **no** startup modal.

---

## 1. Files changed

```
src/storage/db.js        saveState(data, revision) -> authenticated PUT /api/state
src/storage/db.test.js   +3 saveState tests (PUT body, stale revision, missing revision)
src/App.jsx              removes debounced local catalog persistence; passes serverRevision to AdminPage
src/App.test.jsx         +2 Phase 2D integration tests for explicit SAVE and stale save
src/components/AdminPage.jsx  async SAVE, saving state, stale_revision handling
```

## 2. Save contract

- `loadState()` still performs public `GET /api/state` and returns
  `{ data, revision }`.
- `saveState(data, revision)` now requires a finite server revision. It sanitizes
  the outgoing catalog and sends:

```json
{ "data": { "version": 2, "holds": [], "angles": [] }, "revision": 2 }
```

to `PUT /api/state` with same-origin credentials.

- On success, it returns `{ data, revision, changes }` from the server response
  after client-side sanitization.
- On `409 stale_revision`, it throws an error carrying:
  `{ status: 409, code: "stale_revision", currentRevision }`.
- On missing revision, it throws before fetch so the client cannot send a blind
  write.

## 3. App/Admin behaviour

- `App.jsx` no longer debounces catalog writes to localStorage. The shared
  catalog is saved only by explicit admin **SAVE**.
- `serverRevision` loaded from `GET /api/state` is passed to `AdminPage`.
- `AdminPage` calls `saveState(draftData, serverRevision)` and, on success:
  - updates the rendered catalog from the server-returned data,
  - updates the stored server revision,
  - clears the unsaved marker,
  - shows `База сохранена`.
- While saving, the button is disabled and displays `SAVING...`.
- On `409 stale_revision`, the draft remains unsaved and the user sees:
  `База уже изменилась. Обновите страницу и повторите правку.`

This is intentionally conservative: Phase 2D does **not** auto-retry a stale
full-document save, because doing so could silently overwrite another user's
newer catalog changes. A richer merge/reapply UI can be added later if needed.

## 4. What remains local

- Work-mode progress stays device-local in `localStorage`.
- Import still stages a draft in admin state first; it is persisted to the shared
  backend only when **SAVE** succeeds.
- Export remains a local download of the currently visible draft/catalog.
- `lastModifiedMs` is still a device-local timestamp used for footer display.

## 5. Test coverage added

- `src/storage/db.test.js`
  - `saveState` sends `PUT /api/state` with `{ data, revision }`.
  - stale revision response exposes status/code/currentRevision.
  - missing revision rejects before fetch.
- `src/App.test.jsx`
  - app does not auto-save with PUT after initial load.
  - authenticated admin edit + **SAVE** sends exactly one `PUT /api/state` with
    the loaded revision.
  - stale save keeps the admin draft marked unsaved.

## 6. Verification

`npm test` -> **588 passed (72 files)**.

`npm run build` -> **passed**.

## 7. Next

- **3** - add `GET /api/history` and the admin "История изменений" tab.
- **4** - add `latestChange` in `/api/session`, `lastSeenChangeId`, and the
  startup "{username} изменил базу" modal.
- Follow-up cleanup: update README/security docs that still describe the old
  zero-backend/PIN/localStorage catalog architecture.
