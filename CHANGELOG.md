# Changelog

All notable changes to this project are documented here. This project loosely
follows [Semantic Versioning](https://semver.org/).

## v2.0

Production release. Angles is a complete, in-use workshop tool rather than a
prototype. This milestone consolidates the shared-backend architecture (v1.5)
with the incremental UI decomposition, design-system consolidation, operator and
sidebar polish, and the mobile/PWA layer (installable iOS home-screen icon,
standalone display, safe-area handling).

### Changed
- Promoted the project to a production-ready tool; refreshed documentation to
  match the current shared-backend architecture.

### Fixed
- Various UI polish and mobile touch-target / safe-area refinements.

## v1.5

The shared-backend, multi-user milestone: the catalog moved from browser
`localStorage` to a shared Neon Postgres database behind same-origin Vercel
Functions, with server-verified admin sessions and an audit log.

### Added
- Shared catalog backend: public read via `GET /api/state`, authenticated
  admin write via `PUT /api/state`, stored in Neon Postgres as a single JSON
  document.
- Named admin users (`Tomek`, `Alessandro`, `Artsi`) seeded by
  `npm run db:setup` from explicit env passwords.
- httpOnly HMAC-signed session cookie for admin auth; server-side scrypt
  password hashes.
- Change history: `GET /api/history` plus an admin `HISTORY` view showing who
  changed what and when.
- Change notification toast when another user has updated the database.
- Distributed, Neon-backed login rate limiting (per IP + username, 15-minute
  window, fail-open).
- Backup & restore runbook (`docs/OPERATIONS.md`).
- CI workflow (`lint`, `test`, `build`, `npm audit`, gitleaks secret scan) and
  Dependabot config.

### Changed
- Translated the UI to English and reworked the admin layout.
- Catalog persistence moved off `localStorage` onto the shared database;
  optimistic concurrency enforced via an `app_state.revision` token.
- Mobile/responsive polish: full-width change-history view, narrower
  MAIN/STEFAN cards, collapsible mobile history rows, refined focus styling.
- Import accepts only raster image data URLs (SVG rejected); size caps applied
  before and after sanitization.

### Fixed
- v2 export/import: unwrap the `{ data }` envelope before version detection so
  v2 backups import correctly (guarded by a regression test).
- Bundler shebang crash: extracted seed-password logic out of the build path.
- Recovery toast copy that read as an unfinished sentence.
- Restored the keyboard `:focus-visible` ring and removed `document.write`
  usage in print (a11y / hardening).

### Known issues
- On a stale-revision (`409`) save the user must manually reload before
  retrying; the draft is kept but the revision is not auto-refreshed.
- The login throttle fails open if its store is unavailable, and is per-IP, so
  IP rotation still gets fresh attempts.
- Expired `login_attempts` rows are not pruned on a schedule (negligible at
  workshop scale).
- Cover/drawing images are base64 inside the catalog JSON, so payload size is
  dominated by image data at runtime.

See [`docs/RELEASE_NOTES.md`](docs/RELEASE_NOTES.md) for a narrative summary and
[`docs/ROADMAP.md`](docs/ROADMAP.md) for what is planned next.
