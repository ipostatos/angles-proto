# SECURITY DEBT — angles-proto

> Current backlog for the shared-backend architecture. Date: 2026-06-08.

---

## Prioritized Backlog

| # | Item | Severity | Effort | Type | Status |
|---|------|----------|--------|------|--------|
| D1 | Client-only admin gate | SEV-CRITICAL | L | Architecture | **DONE** — writes/history require server-verified httpOnly session |
| D2 | Default `admin`/`admin` bootstrap | SEV-HIGH | S | Auth | **DONE** — removed; named users are server-seeded |
| D3 | Client-side SHA-256 password hash in `localStorage` | SEV-HIGH | M | Crypto | **DONE** — passwords are server-side scrypt hashes in Neon |
| D4 | Weak seeded passwords (`password = username`) | SEV-HIGH | S | Auth | **DONE** — explicit env passwords required by default |
| D5 | Distributed login rate limit/lockout | SEV-HIGH | S-M | Anti-abuse | PARTIAL — best-effort in-memory throttle |
| D6 | Security headers / CSP | SEV-MEDIUM | S | Config | **DONE** — `vercel.json` |
| D7 | JSON import accepts SVG | SEV-MEDIUM | S | Input validation | **DONE** — raster data URL allowlist |
| D8 | Shared catalog in browser `localStorage` | SEV-MEDIUM | M | Data-at-rest | **DONE** — shared catalog moved to Neon |
| D9 | Device-local work progress in `localStorage` | SEV-LOW | S | Privacy | ACCEPTED — no credentials/catalog; local UI state only |
| D10 | Dependency / audit drift | SEV-MEDIUM | S-M | Supply chain | OPEN — run/maintain `npm audit` and upgrades |
| D11 | No CI/CD security gates | SEV-LOW | M | SDLC | OPEN |
| D12 | Global `outline:none` removes focus visibility | SEV-LOW | S | A11y | OPEN |
| D13 | `printImage` uses `document.write` into iframe | SEV-LOW | S | Hardening | OPEN (info) |
| D14 | No documented DB backup/restore procedure | SEV-MEDIUM | S | Operations | **DONE** — `docs/OPERATIONS.md` |
| R1 | DB dumps in git history | SEV-HIGH (was) | — | Data exposure | **RESOLVED** (monitor residual public clones/caches) |

Effort: S <= 1h, M <= half-day, L > 1 day.

---

## Acceptance Criteria

### D4 — Weak Seeded Passwords

`scripts/db-setup.mjs` seeds `Tomek`, `Alessandro`, and `Artsi` only when
explicit passwords are provided through `SEED_PASSWORD_<USERNAME>` env vars or a
`SEED_USER_PASSWORDS` JSON map. The legacy password = username mode requires
`ALLOW_WEAK_SEED_PASSWORDS=true` and is intended only for local/internal setup.

Accepted. Future improvements: user-initiated password rotation or an external
identity provider.

### D5 — Login Rate Limiting

Accept fully when `/api/login` uses a distributed throttle/lockout keyed by
username and source signal, with generic errors and no password enumeration.
The current in-memory throttle is a useful first layer but does not share state
across serverless instances.

### D10 — Dependency / Audit Drift

Accept when `npm audit --audit-level=high` is part of routine verification and
framework/tooling upgrades are tested with `npm test` and `npm run build`.

### D11 — CI/CD Security Gates

Accepted when CI runs at least:

- `npm ci`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm audit --audit-level=high`

Also enable secret scanning/push protection and branch protection for protected
branches.

---

## Current Risk Notes

- Public catalog read is an intentional product decision.
- Admin writes, history, and latest-change state are server-authorized.
- Work progress, work theme, and last-seen change id remain device-local.
- `DATABASE_URL` and `SESSION_SECRET` must stay server-only and never use a
  `VITE_` prefix.

---

*End of SECURITY_DEBT.md*
