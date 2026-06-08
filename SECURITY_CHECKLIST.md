# SECURITY CHECKLIST — angles-proto

> Pre-launch defensive checklist for the shared-backend architecture. Date: 2026-06-08.
> Legend: ✅ pass · ⚠️ partial/needs work · ❌ fail/missing · N/A not applicable

---

## 1. Project Inventory

- [✅] Stack identified: React 19 + Vite 8 SPA, Vercel Functions, Neon Postgres
- [✅] Server routes identified: `/api/login`, `/api/logout`, `/api/session`, `/api/state`, `/api/history`
- [✅] DB schema present: `users`, `app_state`, `change_log`
- [✅] No `.env` / secrets files in repo
- [✅] Lockfile present
- [✅] Automated tests present
- [✅] CI/CD pipeline present

## 2. Authentication

- [✅] Password verification server-side only
- [✅] Passwords stored as salted scrypt hashes
- [✅] Session cookie is httpOnly and SameSite=Strict
- [✅] Secure cookie flag is set in production/Vercel env
- [✅] No password hash or bearer token in localStorage
- [✅] Logout clears the session cookie
- [✅] Seeded users require explicit env passwords by default
- [⚠️] Login has best-effort in-memory rate limiting; distributed lockout still pending

## 3. Authorization

- [✅] Public catalog read is intentional
- [✅] `PUT /api/state` requires a valid session
- [✅] `GET /api/history` requires a valid session
- [✅] Frontend admin route is UX only; server endpoints are authoritative
- [N/A] Role separation: all named users are equal admins by product decision

## 4. API Security

- [✅] State-changing API uses same-origin credentials
- [✅] Invalid methods return 405 on implemented routes
- [✅] Unauthenticated writes/history return 401
- [✅] `PUT /api/state` validates body shape server-side
- [✅] Optimistic revision locking prevents stale overwrite
- [✅] Change log is derived server-side from old/new catalog snapshots
- [⚠️] Login is rate-limited in-memory; no shared/distributed limiter yet
- [⚠️] No centralized monitoring/alerting

## 5. Input Validation / Injection

- [✅] No `dangerouslySetInnerHTML`, `eval`, or dynamic HTML injection
- [✅] React escapes dynamic text
- [✅] Catalog data is sanitized with allowlisted fields
- [✅] Angle values are numeric and clamped to `0..90`
- [✅] Raw SQL uses Neon tagged template parameterization
- [✅] SVG image data URLs are rejected
- [✅] JSON import is size-capped and parsed through migration/sanitization

## 6. File Upload / Parser

- [✅] Uploads must be browser-decoded as images
- [✅] Uploaded images are re-encoded/compressed through canvas
- [✅] Import accepts only raster image data URLs
- [✅] Oversized imports are rejected before save
- [N/A] No server filesystem upload path

## 7. Secrets

- [✅] `DATABASE_URL` and `SESSION_SECRET` are server-only
- [✅] No `VITE_` secret usage
- [✅] No hardcoded API keys found in app code
- [✅] DB dumps are gitignored
- [⚠️] Historical DB dump exposure was previously remediated; residual public clones/caches cannot be fully recalled

## 8. Frontend / Browser Security

- [✅] CSP and hardening headers configured in `vercel.json`
- [✅] No third-party scripts
- [✅] No PII in URLs
- [✅] ErrorBoundary avoids raw stack display to users
- [⚠️] Global focus-outline suppression remains an accessibility debt
- [⚠️] `printImage` uses `document.write` into an isolated iframe

## 9. CSRF / CORS

- [✅] API is same-origin
- [✅] Session cookie uses SameSite=Strict
- [✅] CSP keeps `connect-src 'self'`
- [N/A] Cross-origin API access is not supported

## 10. Database

- [✅] Shared catalog stored in Neon `app_state`
- [✅] Single-row `app_state` constraint
- [✅] Revision compare-and-set on writes
- [✅] Change log index on `created_at DESC`
- [⚠️] No documented automated DB backup/restore procedure in repo

## 11. Deployment / Infrastructure

- [✅] Vercel-compatible `/api` function layout
- [✅] `vercel.json` security headers
- [⚠️] Full local backend requires Vercel CLI and env pull
- [❌] Monitoring/alerting not configured in repo
- [✅] CI required checks configured in repo

## 12. Supply Chain

- [✅] `package-lock.json` present
- [✅] Minimal runtime dependency set
- [✅] `npm run lint` is installed and green
- [✅] Dependency audit runs locally and in CI
- [✅] Dependabot configured
- [❌] SAST/secret scanning workflow not configured

## 13. Privacy

- [✅] No analytics/telemetry in app code
- [✅] Work progress/theme/last-seen id are device-local only
- [✅] Export is user-initiated
- [⚠️] Change history stores usernames and edit metadata indefinitely

---

## Go / No-Go Gate

**GO for internal workshop shared use** when:

- [x] Server-side auth/session protects writes and history
- [x] Shared catalog saves use revision locking
- [x] Change history exists
- [x] Latest-change notification exists
- [x] Security headers are configured
- [x] Tests and build pass

**NO-GO for broad public exposure** until:

- [x] Seeded weak passwords are replaced or explicitly opt-in only
- [x] Login rate limiting exists
- [x] CI/security checks are configured
- [ ] Operational DB backup/restore process is documented

---

*End of SECURITY_CHECKLIST.md*
