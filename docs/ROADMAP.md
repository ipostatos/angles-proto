# Roadmap

Direction for Angles. Items are triaged from the Phase 1.5 stabilization review
(`docs/superpowers/specs/2026-06-09-phase1.5-stabilization.md`). Nothing here is
a commitment to a date — it is the planned order of work.

## v1.5 — current stable

The shared-backend, multi-user milestone. Catalog in Neon Postgres, server-side
admin sessions, audit log, change notifications, and responsive UI polish. All
quality gates green (lint, 633 tests, build, `npm audit`). See
[`../CHANGELOG.md`](../CHANGELOG.md).

## v1.6 — stabilization / UX polish / bug fixes

Small, safe, incremental work:

- **Smoother 409 recovery** — on a stale-revision save, auto-refetch the latest
  revision and re-present the draft so the user can re-save without a manual
  reload (F1).
- **Operational docs** — document the setup gotchas (`DATABASE_URL` /
  `SESSION_SECRET` / un-run `db:setup`, and Preview-vs-Production secrets) that
  surface as the "No connection to the server" screen.
- **Prune `login_attempts`** — scheduled cleanup of expired throttle rows (F5).
- General UX/copy polish surfaced during use.

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
