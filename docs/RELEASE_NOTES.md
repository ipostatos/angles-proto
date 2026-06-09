# Release Notes

Narrative summary of releases. For the itemized list, see
[`../CHANGELOG.md`](../CHANGELOG.md).

## v1.5 — Shared backend & multi-user

v1.5 is the milestone where Angles became a genuinely multi-user tool. Before
this release the catalog lived in the browser's `localStorage`; now it lives in
**Neon Postgres** behind same-origin **Vercel Functions**, and admin actions are
authorized by a server-verified session rather than client-side checks.

**Highlights:**

- **One shared catalog.** Operators read it publicly (`GET /api/state`); admins
  edit a single source of truth that everyone sees. Saves are revision-locked
  for optimistic concurrency — a stale save is rejected with `409` rather than
  silently clobbering another admin's work.
- **Real auth.** Named admin users authenticate against the server; sessions are
  httpOnly HMAC-signed cookies; passwords are scrypt-hashed server-side; login
  is rate-limited via a distributed Neon-backed throttle.
- **Audit trail.** Every catalog save is logged; the `HISTORY` view shows who
  changed what and when, and logged-in users are notified when someone else has
  edited the database.
- **UI polish.** The interface was translated to English and the admin and
  mobile layouts were refined (full-width history, collapsible mobile rows,
  narrower cards, restored focus rings).
- **Operations & CI.** A backup/restore runbook ([`OPERATIONS.md`](OPERATIONS.md)),
  a CI pipeline (lint/test/build/audit + secret scan), and Dependabot.

**Stabilization:** a single-pass review before planning v1.6/v2.0 confirmed all
gates green and surfaced only non-blocking polish/UX findings — see
`superpowers/specs/2026-06-09-phase1.5-stabilization.md`.

**Upgrade / operational notes:**

- The app is **online-only**: without a reachable backend it shows a
  no-connection retry screen. The most common failure is operational — a missing
  `DATABASE_URL` / `SESSION_SECRET` or an un-run `db:setup`. Preview deploys
  intentionally lack `SESSION_SECRET` (Production-only).
- Work-mode progress and theme remain **device-local** by design and are not
  part of the shared catalog or any backup.

See [`ROADMAP.md`](ROADMAP.md) for what comes next.
