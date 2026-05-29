# SECURITY DEBT — angles-proto

> Backlog of known security debt with owner/effort/priority. Date: 2026-05-29.
> Severity scheme matches `SECURITY_AUDIT.md`. Status: OPEN unless noted.

---

## Prioritized Backlog

| # | Item | Severity | Effort | Type | Status |
|---|------|----------|--------|------|--------|
| D1 | Admin auth is client-only / bypassable | SEV-CRITICAL | L (needs backend) | Architecture | OPEN (documented as UX-only; see README) |
| D2 | Default `admin`/`admin` bootstrap + public README creds | SEV-HIGH | S | Auth | **MITIGATED** — default removed; first-run requires ≥8-char non-weak password; README updated |
| D3 | Unsalted SHA-256 password hash in `localStorage` | SEV-HIGH | M | Crypto | OPEN (needs backend) |
| D4 | No login rate limit/lockout (README over-claims) | SEV-HIGH | S–M | Anti-abuse | OPEN (README claim removed; throttle still TODO) |
| D5 | No CSP / security headers (HSTS, nosniff, frame, Referrer, Permissions) | SEV-MEDIUM | S | Config | **DONE** — `vercel.json` (verify CSP at runtime incl. print) |
| D6 | JSON import accepts `data:image/svg+xml` unsanitized | SEV-MEDIUM | S | Input validation | **DONE** — raster allowlist (`isSafeRasterDataUrl`) |
| D7 | Plaintext data + hash in `localStorage`; `_corrupt_*` unbounded | SEV-MEDIUM | S | Data-at-rest | PARTIAL — `_corrupt_*` capped to newest 1; data still plaintext (needs backend) |
| D8 | Dependency CVEs (esbuild, postcss, vite) — build/dev only | SEV-MEDIUM | S–M | Supply chain | PARTIAL — postcss fixed; esbuild/vite remain (major upgrade) |
| D9 | `sessionStorage` flag is constant `"1"` | SEV-LOW | (with D1) | Auth | OPEN |
| D10 | No CI/CD security gates (SAST, secret scan, Dependabot, branch protection) | SEV-LOW | M | SDLC | OPEN |
| D11 | Global `outline:none` removes focus visibility | SEV-LOW | S | A11y | OPEN |
| D12 | `printImage` uses `document.write` (static today) | SEV-LOW | S | Hardening | OPEN (info) |
| D13 | `README.md` describes removed/modular features & live creds | SEV-LOW | S | Docs accuracy | **DONE** — README rewritten |
| R1 | DB dumps in git history | SEV-HIGH (was) | — | Data exposure | **RESOLVED** (monitor GitHub GC residual) |

Effort: S ≤ 1h · M ≤ half-day · L > 1 day.

---

## Detail & Acceptance Criteria

### D1 — Client-only admin (CRITICAL)
**Debt:** No server-side authentication/authorization; gate is React state + `localStorage`/`sessionStorage`.
**Why deferred:** Requires introducing a backend/serverless API — out of scope for a static prototype.
**Accept when:** Either (a) a backend enforces auth + per-request authZ with httpOnly sessions, **or** (b) documentation clearly states admin is non-security UX and the app is single-operator/local-only.

### D2 — Default credentials (HIGH)
**Accept when:** First-run forces a strong password (min length, rejects `admin`); README contains no live default creds.

### D3 — Weak credential storage (HIGH)
**Accept when:** No credential hash is stored client-side (auth server-side), or — interim — PBKDF2 w/ random salt + high iterations is used with documented limitations.

### D4 — No rate limiting (HIGH)
**Accept when:** Server-side throttle/lockout exists (with backend); interim client backoff after N failures.

### D5 — Security headers / CSP (MEDIUM)
**Accept when:** `vercel.json` (or host config) sets CSP, HSTS, `X-Content-Type-Options`, `frame-ancestors 'none'`, `Referrer-Policy`, `Permissions-Policy`; verified via `curl -I` with no CSP violations in normal/print/upload flows.

### D6 — Import image sanitization (MEDIUM)
**Accept when:** Imported `drawing`/`holdImages` restricted to `data:image/(png|jpeg|webp)` or re-encoded; `svg+xml` rejected.

### D7 — Data-at-rest / corrupt retention (MEDIUM)
**Accept when:** `_corrupt_*` capped (e.g., keep newest 1); shared-machine risk documented.

### D8 — Dependency CVEs (MEDIUM)
**Accept when:** `npm audit` reports 0 (postcss via `npm audit fix`; vite/esbuild major upgrade tested with `npm run build`).

### D10 — SDLC gates (LOW)
**Accept when:** PR workflow runs `npm ci` + `npm audit --audit-level=high` + build; secret scanning + push protection + Dependabot enabled; `main` protected.

### D13 — Docs accuracy (LOW)
**Accept when:** `README.md` reflects actual shipped architecture (monolithic `App.jsx`, modules removed) and contains no live credentials or unimplemented security claims.

---

## Risk Acceptance Notes

- The product is currently positioned as a **local, single-operator reference tool**. Under that framing, D1/D3/D9 are *accepted architectural limitations*, **provided** they are documented and the admin gate is never advertised as protecting confidential or multi-user data.
- If the product moves to a **shared, public, or multi-user** context, D1 becomes a blocking SEV-CRITICAL and must be remediated via a backend before launch.

---

*End of SECURITY_DEBT.md*
