# Roadmap

Direction for Angles. Items are triaged from the Phase 1.5 stabilization review
(`docs/superpowers/specs/2026-06-09-phase1.5-stabilization.md`). Nothing here is
a commitment to a date — it is the planned order of work.

## v1.5 — current stable

The shared-backend, multi-user milestone. Catalog in Neon Postgres, server-side
admin sessions, audit log, change notifications, and responsive UI polish. All
quality gates green (lint, 633 tests, build, `npm audit`). See
[`../CHANGELOG.md`](../CHANGELOG.md).

## v1.6 — stabilization & maintainability

Small, safe, incremental work. Every change is behavior-preserving (one
documented exception below), lands as its own small PR, and must keep all gates
green (lint, the full test suite, build, `npm audit`). No API, schema, auth, or
persistence-contract changes.

**Maintainability — decompose the monoliths (primary theme).** The two largest
files concentrate most of the app's state and logic and are the top
maintainability risk surfaced by the v1.5 audit:

- `src/App.jsx` (~1430 lines, ~68 hooks)
- `src/components/AdminPage.jsx` (~1150 lines, ~59 hooks)

Decompose incrementally, strictly preserving behavior — one slice per PR, with
the existing test suite as the safety net (if a test needs changing to pass, the
behavior moved and the PR is wrong):

- Extract pure helpers/constants out of `App.jsx` (e.g. `useHashRoute`,
  last-seen-change helpers, id/constants).
- Pull self-contained operator sub-views into `features/operator/` as
  presentational components with explicit props.
- Give `features/admin/` real content by extracting `AdminPage.jsx` blocks
  (login form, catalog editor, history view) — this also retires the
  admin re-export-stub doc debt.
- Group related `App.jsx` state into custom hooks (catalog, work mode, change
  notifications) to shrink the root component.

**Stabilization fixes:**

- **Smoother 409 recovery** — on a stale-revision save, auto-refetch the latest
  revision and re-present the draft so the user can re-save without a manual
  reload (F1). *This one does change the save-flow behavior — keep it isolated,
  test-covered, and separate from the refactor PRs.*
- **Operational docs** — document the setup gotchas (`DATABASE_URL` /
  `SESSION_SECRET` / un-run `db:setup`, and Preview-vs-Production secrets) that
  surface as the "No connection to the server" screen.
- **Prune `login_attempts`** — scheduled cleanup of expired throttle rows (F5).
- General UX/copy polish surfaced during use.

**Explicitly out of scope for v1.6** (tracked separately):

- `x-forwarded-for` rate-limit hardening — a security/behavior change, handled
  as its own `security:` ticket once the deployment posture (internal / public
  demo / production) is settled. Not part of stabilization.
- Everything under v2.0 below.

## v2.0 — larger / architectural

Bigger product or architecture changes:

- **Image storage** — move cover/drawing images out of the catalog JSON into
  dedicated blob storage, shrinking payloads and removing the size cap as a
  practical limit (F6).
- **Identity** — self-service password rotation or an external identity
  provider, retiring the seeded-password model (D4).
- **Real stale-save merge** — proper merge/reapply flow instead of
  reload-and-retry.
- **Repo hardening** — branch protection, required status checks, and secret
  push-protection on `main` (GitHub-UI setup; D11 residual).
