# Phase 0 report — data model audit, ID stability, `diffStates`

**Date:** 2026-06-08
**Scope:** Inspection + the pure `diffStates` foundation only. No backend, no
Neon, no UI changes, no localStorage removal. Safe and reversible.

---

## 1. Current data shape

The catalog is **v2** and lives as one JSON object (`{ version, holds, angles }`)
in `localStorage` under key `angles_proto_v1`.

```
holds:  [{ id: "h_<uuid>", name: string, coverImage?: dataURL }]
angles: [{ id: "<uuid>",   holdId: string, value: number(0–90), saw: "main"|"stefan", drawing?: dataURL }]
version: 2
```

- A hold's identity is its **`id`** (`h_`-prefixed); `name` is a mutable label.
- An angle belongs to a hold via **`holdId`** and carries its own **`id`**.
- Images (`coverImage`, `drawing`) are base64 data URLs stored inline.

## 2. Are IDs stable? — **Yes.** (gate passed)

Evidence from the live code:

| Concern | Finding | Reference |
|---|---|---|
| v2 sanitize preserves ids | `sanitizeV2` copies `h.id` / `a.id` verbatim; **no regeneration** | `src/domain/migration.js:119-145` |
| ID regeneration scope | Only in the one-time **v1→v2** legacy path (`sanitizeAngle` mints ids for id-less legacy rows / de-dups collisions) — never for already-v2 data | `src/domain/migration.js:54-69,166-176` |
| Angle value/saw edit keeps id | `updateAngle` patches `a.id === id ? { ...a, ...patch } : a` | `src/components/AdminPage.jsx:320-325` |
| Hold rename keeps id | `saveRenameHold` maps `h.id === oldId ? { ...h, name } : h` (comment: "stable IDs") | `src/components/AdminPage.jsx:301-307` |
| Add / delete | `addHold`/`addAngleForHold` mint new ids; `confirmRemoveHold`/`removeAngle` filter by id | `src/components/AdminPage.jsx:247-333` |

**Conclusion:** within the running app, save/load round-trips and every admin edit
preserve ids. A real id-keyed diff is therefore sound — no fake/heuristic diff
needed. Gate satisfied; implementation proceeded.

> Caveat (not a blocker): if a user **imports** legacy v1 JSON, ids are minted
> fresh during the one-time migration. That is correct behaviour (v1 had no
> stable ids) and only affects the import boundary, not steady-state editing.

## 3. New code (this phase)

- **`src/domain/diff.js`** — pure `diffStates(oldDb, newDb)`. No I/O, no side
  effects. Compares two v2 snapshots by id and returns change events shaped like
  `change_log` rows (`{ action, entity, field, oldValue, newValue }`). Ignores
  image fields by design (images are not logged). Tolerates `null`/empty input.
- **`src/domain/diff.test.js`** — 11 unit tests (TDD: written first, watched
  fail on missing module, then implemented to green).

Event contract (per action):

| action | entity | field | oldValue | newValue |
|---|---|---|---|---|
| `hold_added`    | new name  | `null`    | `null`    | `null`    |
| `hold_deleted`  | old name  | `null`    | `null`    | `null`    |
| `hold_renamed`  | new name  | `'name'`  | old name  | new name  |
| `angle_added`   | hold name | saw       | `null`    | value     |
| `angle_deleted` | hold name | saw       | value     | `null`    |
| `angle_changed` | hold name | `'value'` | old value | new value |
| `angle_changed` | hold name | `'saw'`   | old saw   | new saw   |

A single angle changing both value and saw yields **two** `angle_changed` events.

## 4. Contract additions (doc only, not implemented)

Added the **revision / optimistic-concurrency** contract to the design doc
(§5.1) so the shared base is always the most up-to-date one and stale clients
cannot clobber newer edits:

- `app_state.revision` counter, bumped per successful `PUT`.
- `GET /api/state` → `{ data, revision }`.
- `PUT /api/state` → body `{ data, revision }`; compare-and-set; **409 Conflict**
  on stale revision (returns current `{ data, revision }` so the client reloads,
  re-applies, retries).

No endpoints were implemented in this phase.

## 5. Verification

- **Tests:** `npm test` → **523 passed (66 files)**, including the 11 new
  `diffStates` tests. No regressions.
- **Lint:** could not run — `eslint` is referenced by the `lint` script and
  `eslint.config.js` but is **not installed** (absent from `devDependencies` and
  `node_modules`). Pre-existing project gap, unrelated to this change; new files
  follow existing code conventions. Recommend adding `eslint` + `@eslint/js` to
  devDependencies as a separate fix.

## 6. Production-behaviour impact

**None.** Only two new files were added (`diff.js`, `diff.test.js`); nothing
imports `diffStates` yet. The app builds and runs exactly as before. Fully
reversible (delete the two files).
