# Operations — backup & restore

> Operational runbook for the Angles shared backend (Neon Postgres).
> Scope: protecting the shared catalog and audit log against loss or corruption.

The shared catalog and change history live in **Neon Postgres** (three tables:
`users`, `app_state`, `change_log` — see [`api/_lib/schema.sql`](../api/_lib/schema.sql)).
Work-mode progress and theme are device-local and intentionally **not** backed up.

---

## ⚠️ Where backups must NOT go

Database dumps were once committed to git history and had to be scrubbed with
`git filter-repo` (see `R1` in [`SECURITY_DEBT.md`](../SECURITY_DEBT.md)). To
avoid a repeat:

- **Never** place a dump inside the repo working tree, even briefly.
- `.gitignore` already blocks the known dump patterns (`base.json`, `Base_*.json`,
  `angles-db.json`, `*-db.json`), but the safe habit is to write dumps to a path
  **outside** the repo entirely (e.g. `~/angles-backups/`).
- A dump contains scrypt password hashes and the full catalog. Treat it as a
  secret: store it encrypted or in access-controlled storage, never in a public
  or shared-by-default location.

---

## 1. Backup tiers

| Tier | What it protects | How |
|---|---|---|
| **Neon PITR** (primary) | Everything, automatically | Neon's built-in point-in-time restore / branching. No action needed beyond confirming retention. |
| **Logical dump** (portable) | All three tables, vendor-independent | `pg_dump` on a schedule (below). |
| **Catalog EXPORT** (app-level) | The catalog JSON only (no users, no history) | Admin **EXPORT** button in the UI. Manual, ad-hoc. |

Neon PITR is the first line of defense. The logical dump exists so a restore is
possible even if the Neon project is unavailable or deleted.

### 1a. Confirm Neon PITR retention

In the Neon console for this project, verify **History retention** is set to an
acceptable window (Neon's default is plan-dependent). PITR lets you restore the
branch to any timestamp within that window, or spin up a branch from a past
state to inspect before promoting. This covers accidental bad `PUT /api/state`
writes as well as full data loss.

---

## 2. Logical backup (`pg_dump`)

`DATABASE_URL` is the Neon connection string (server-only — pull it with
`vercel env pull .env.local`, never paste it into a shared shell history).

```bash
# Write OUTSIDE the repo. Custom format (-Fc) is compressed and restore-flexible.
mkdir -p ~/angles-backups
DATABASE_URL="postgresql://...sslmode=require"
pg_dump "$DATABASE_URL" -Fc -f ~/angles-backups/angles-$(date +%Y%m%d-%H%M%S).dump
```

Only three tables matter; to dump just those:

```bash
pg_dump "$DATABASE_URL" -Fc \
  -t users -t app_state -t change_log \
  -f ~/angles-backups/angles-$(date +%Y%m%d-%H%M%S).dump
```

**Cadence:** the catalog changes rarely (a small workshop), so a weekly dump
plus an extra dump before any schema change or bulk import is sufficient. Keep
the last several dumps; prune older ones manually.

**Verify a dump is readable** (does not touch the live DB):

```bash
pg_restore --list ~/angles-backups/angles-YYYYMMDD-HHMMSS.dump | head
```

---

## 3. Restore

### 3a. Preferred — Neon PITR / branch

For accidental edits or recent corruption, restore in the Neon console:
restore the branch to a timestamp **before** the bad change, or create a branch
from that point, validate it, then promote. This keeps `users`, `app_state`
(including `revision`), and `change_log` mutually consistent and needs no local
tooling.

### 3b. From a logical dump

Use when Neon PITR is not an option (project lost, migrating providers). Restore
into an **empty / fresh** database to avoid clobbering live data unintentionally:

```bash
# TARGET_URL points at the fresh/empty database to restore into.
pg_restore --clean --if-exists --no-owner -d "$TARGET_URL" \
  ~/angles-backups/angles-YYYYMMDD-HHMMSS.dump
```

`--clean --if-exists` drops the three tables first if present, so the restore is
repeatable. After restoring, the app needs no re-seed — `users` is included in
the dump. If you restored into a brand-new database that has no schema yet, run
`npm run db:setup` **first** (it is idempotent and also seeds users if absent),
then restore only the data, or simply let `pg_restore` recreate everything from
the dump.

### 3c. Catalog-only recovery (no DB access)

If only the catalog JSON is needed and you have an EXPORT file, an admin can
**IMPORT** it in the UI and **SAVE**. This goes through `PUT /api/state` like any
edit: it is sanitized, revision-checked, and logged. It restores the catalog
**only** — it does not restore `users` or prior `change_log` history.

---

## 4. Post-restore checklist

- [ ] `GET /api/state` returns the expected catalog and a sane `revision`.
- [ ] Admin login works for at least one seeded user (`users` restored).
- [ ] `GET /api/history` shows the expected audit rows (`change_log` restored).
- [ ] The dump file used is stored back in access-controlled, **out-of-repo**
      storage — not left in a synced/shared folder by accident.

---

*See also: [`SECURITY_CHECKLIST.md`](../SECURITY_CHECKLIST.md) §10 (Database),
[`SECURITY_DEBT.md`](../SECURITY_DEBT.md).*
