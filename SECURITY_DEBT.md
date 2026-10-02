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
| D5 | Distributed login rate limit/lockout | SEV-HIGH | S-M | Anti-abuse | **DONE** — Neon-backed throttle shared across serverless instances |
| D6 | Security headers / CSP | SEV-MEDIUM | S | Config | **DONE** — `vercel.json` |
| D7 | JSON import accepts SVG | SEV-MEDIUM | S | Input validation | **DONE** — raster data URL allowlist |
| D8 | Shared catalog in browser `localStorage` | SEV-MEDIUM | M | Data-at-rest | **DONE** — shared catalog moved to Neon |
| D9 | Device-local work progress in `localStorage` | SEV-LOW | S | Privacy | ACCEPTED — no credentials/catalog; local UI state only |
| D10 | Dependency / audit drift | SEV-MEDIUM | S-M | Supply chain | OPEN — run/maintain `npm audit` and upgrades |
| D11 | No CI/CD security gates | SEV-LOW | M | SDLC | PARTIAL — CI runs lint/test/build/audit + gitleaks secret scan; branch protection is a GitHub-UI setup step |
| D12 | Global `outline:none` removes focus visibility | SEV-LOW | S | A11y | **DONE** — keyboard `:focus-visible` ring restored |
| D13 | `printImage` uses `document.write` into iframe | SEV-LOW | S | Hardening | **DONE** — rebuilt via DOM APIs, no `document.write` |
| D14 | No documented DB backup/restore procedure | SEV-MEDIUM | S | Operations | **DONE** — `docs/OPERATIONS.md` |
| D15 | `POST /api/watch` (Send to watch) is unauthenticated | SEV-LOW | S | Auth | ACCEPTED — single user; only overwrites the watch hold selection, names validated against catalog, 16 KB body cap. Revisit (require session) if more people use watches |
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

`/api/login` throttles by `${ip}:${username}` using a Neon-backed counter
(`login_attempts` table) with a 15-minute sliding window and an 8-failure
lockout, so the limit is shared across serverless instances. The
increment/reset is a single atomic UPSERT; the limiter **fails open** if the
store is unavailable, so a throttle-DB outage degrades brute-force protection
rather than locking everyone out. Errors stay generic (`429 too_many_attempts`)
with no password enumeration. Logic in `api/_lib/rateLimit.js`, storage in
`api/_lib/rateLimitStore.js`.

Future improvement: prune expired `login_attempts` rows on a schedule (currently
they accumulate until a key is reused or cleared).

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

CI now runs all of the above plus a **gitleaks** secret scan
(`.github/workflows/ci.yml`, `.gitleaks.toml`). Remaining manual step (GitHub UI,
not expressible in-repo): enable branch protection / required status checks and
secret push-protection on `main`.

---

## Current Risk Notes

- Public catalog read is an intentional product decision.
- Admin writes, history, and latest-change state are server-authorized.
- Work progress, work theme, and last-seen change id remain device-local.
- `DATABASE_URL` and `SESSION_SECRET` must stay server-only and never use a
  `VITE_` prefix.

---

*End of SECURITY_DEBT.md*
