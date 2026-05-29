# SECURITY CHECKLIST — angles-proto

> Pre-launch defensive checklist. Date: 2026-05-29.
> Legend: ✅ pass · ⚠️ partial/needs work · ❌ fail/missing · N/A not applicable (no backend) · ❔ UNVERIFIED

---

## 1. Project Inventory
- [✅] Stack identified (React 18 + Vite 5 SPA, client-only)
- [✅] No `.env` / secrets files in repo
- [N/A] Docker / containers
- [❌] CI/CD pipelines (none present)
- [N/A] Routes/controllers/server actions (no server)
- [N/A] DB schema / migrations
- [✅] Upload/export handlers reviewed
- [❌] Automated tests (none present)

## 2. Authentication
- [⚠️] Password hashing — SHA-256 **unsalted, client-side** (HIGH-3)
- [❌] Login rate limiting / lockout (HIGH-4)
- [✅] Generic error on wrong creds ("Wrong credentials")
- [N/A] Email verification
- [N/A] Reset tokens (one-time/TTL/hashed)
- [N/A] Session cookies httpOnly/Secure/SameSite (no cookies)
- [⚠️] Logout invalidation — clears in-memory + sessionStorage; no server session
- [N/A] JWT expiration/algorithm
- [N/A] OAuth redirect allowlist / state / PKCE
- [❌] No tokens in localStorage — password **hash** stored in localStorage (HIGH-3)
- [✅] No auth secrets in client bundle (no server secrets exist)
- [❌] Default credentials removed (`admin`/`admin` bootstrap present) (HIGH-2)

## 3. Authorization / IDOR / Multi-Tenant
- [N/A] Ownership checks (no server, no multi-tenant data)
- [N/A] No query-by-id-alone
- [N/A] No client-controlled ownerId/role/plan
- [⚠️] Admin routes require role check — **client-only gate, bypassable** (CRITICAL-1)
- [⚠️] Exports/downloads protected — export gated only by client admin UI
- [N/A] Worker re-checks / cache key scoping

## 4. API Security (OWASP API Top 10)
- [N/A] API1 BOLA, API3 BOPLA, API5/6, API7 SSRF, API10 — no API
- [⚠️] API2 Broken Auth (CRITICAL-1, HIGH-2/3/4)
- [⚠️] API4 Resource consumption — import size capped ✅; login unthrottled ❌
- [⚠️] API8 Misconfiguration — no CSP/headers (MEDIUM), dep CVEs (MEDIUM)

## 5. Input Validation / Injection
- [✅] No `dangerouslySetInnerHTML` / `innerHTML` / `eval` / `new Function`
- [✅] Dynamic text rendered as escaped React children
- [⚠️] Client-side sanitization (`migrateAndSanitize`) — allowlist + clamp; **no server validation** (N/A)
- [✅] Angle values numeric + clamped `0–90`
- [✅] No raw SQL / command exec (none)
- [⚠️] SVG via import accepted unsanitized (MEDIUM, D6)
- [✅] No XXE (no XML), low ReDoS, JSON-only deserialization (size-capped)
- [✅] No obvious prototype pollution (field allowlist, no deep merge of untrusted keys)

## 6. File Upload / Parser
- [✅] Import size limit (`MAX_DB_SIZE_KB`, file + serialized)
- [⚠️] Magic-byte validation — upload re-encodes via canvas (effective); import trusts `data:image/*` prefix (D6)
- [⚠️] MIME not trusted alone — upload path also decodes via `<img>`/canvas; import path weaker
- [✅] No server filesystem / path traversal (no server)
- [N/A] Private storage / download authZ (client-only)
- [✅] Malformed file handling (try/catch + toast)
- [❌] SVG sanitization (D6)
- [N/A] Archive bomb / XXE / worker isolation

## 7. SaaS Business Logic Abuse
- [N/A] Plan limits / quotas / entitlements / subscriptions (none)

## 8. Rate Limiting / Anti-Bot
- [❌] Login throttle (HIGH-4)
- [✅] Import size/quota guard
- [N/A] Registration / forgot-password / server endpoints / AI calls

## 9. Webhooks / Payments
- [N/A] No webhooks or payment provider

## 10. Secrets
- [✅] No hardcoded secrets in source/bundle
- [✅] No `.env` committed
- [N/A] Docker/CI secrets
- [✅] No secrets in frontend env
- [✅] **RESOLVED:** DB dumps removed from git history (monitor GitHub GC residual)

## 11. Frontend / Browser Security
- [✅] No secrets in bundle
- [✅] No unsafe HTML rendering
- [❌] CSP (MEDIUM, D5)
- [❔] HSTS (host-dependent; not configured in repo)
- [❌] X-Content-Type-Options (D5)
- [❌] Frame protection / `frame-ancestors` (D5)
- [❌] Referrer-Policy (D5)
- [❌] Permissions-Policy (D5)
- [✅] No third-party scripts (external font links removed)
- [✅] No PII in URLs
- [⚠️] UI-only access control (CRITICAL-1)

## 12. CSRF / CORS
- [N/A] CSRF (no cookies / no server state changes)
- [N/A] CORS (no server / no cross-origin API)
- [✅] No state-changing requests over the network at all

## 13. Database
- [N/A] All DB items — data lives in `localStorage` only
- [⚠️] "Backups" exist client-side (`*_backups`, ring of 5); no server backup/restore plan

## 14. Worker / Queue
- [N/A] No workers/queues

## 15. Deployment / Infrastructure
- [❔] HTTPS forced (host default; `UNVERIFIED`)
- [❌] HSTS / strict headers (D5)
- [N/A] Strict CORS
- [N/A] Prod/staging/dev secret separation (no secrets)
- [❔] Preview deploy isolation (no secrets, so low risk; `UNVERIFIED`)
- [N/A] Private storage buckets
- [✅] No debug/stack-trace leakage to users (ErrorBoundary shows generic message)
- [❌] Monitoring/alerting (none)

## 16. CI/CD / Supply Chain
- [✅] Lockfile present (`package-lock.json`)
- [⚠️] Dependency audit — 3 moderate (build/dev only) (D8)
- [✅] No suspicious packages (only react, react-dom, react-hot-toast, vite, plugin-react)
- [❌] GitHub Actions permissions / required checks (none)
- [❌] Fork-PR secret isolation (no Actions)
- [❌] Branch protection (D10)
- [❌] Dependabot/Renovate (D10)
- [❌] Secret scanning / push protection (D10)
- [❌] SAST (D10)
- [N/A] Docker image scanning

## 17. Logging / Monitoring
- [⚠️] Auth/security events — only `console.warn`; no central log
- [✅] No secrets/PII over-logged
- [N/A] Correlation IDs / alerts (no server)

## 18. Privacy
- [✅] Minimal data; no personal data collected by design
- [✅] No PII in URLs/logs/analytics (no analytics)
- [⚠️] Deletion/export — export exists; data deletion = clear `localStorage` (document it)
- [N/A] Third-party processors

## 19. AI / LLM Security
- [N/A] No AI/LLM integration

---

## Go / No-Go Gate

**GO (as local single-operator tool)** — Stage 0 complete:
- [x] D2: removed live default creds from README + enforce ≥8-char first-run password
- [x] D5: added CSP + security headers (`vercel.json`) — *verify CSP at runtime incl. print flow*
- [x] D6: imported images restricted to raster (PNG/JPEG/WebP/GIF; SVG rejected)
- [x] D8: `npm audit fix` applied (postcss); vite/esbuild major upgrade still scheduled
- [x] Documented that admin mode is **not** a security boundary (README)
- [x] D7: `_corrupt_*` retention capped to newest copy

**NO-GO for public/multi-user use** until D1 (server-side auth/authZ) is implemented.

---

*End of SECURITY_CHECKLIST.md*
