# SECURITY AUDIT — angles-proto

> Defensive AppSec review before production launch. **Audit only** — no code was modified to produce this report.
> Date: 2026-05-29 · Reviewer: AppSec review pass · Commit baseline: `a4475fb` (post history-rewrite)

---

## 0. Executive Summary

`angles-proto` is a **100% client-side React SPA** (Vite 5 + React 18 + `react-hot-toast`) with **no backend, no API, no database, no server-side auth, no webhooks, no queues, and no AI integration**. All state lives in the browser's `localStorage` / `sessionStorage`. It is deployed as a static site (Vercel per `README.md`).

Because there is no server and no shared/multi-tenant data store, the **entire classic server attack surface is absent** (no IDOR/BOLA, no SQLi, no SSRF, no CSRF, no CORS, no broken function-level authZ across users). The security posture is therefore dominated by:

1. **Client-side-only "admin" gate** that is trivially bypassable (formally an auth-bypass / privilege-escalation class issue, but with **architecturally bounded impact** — see SEV-CRITICAL-1).
2. **Weak credential handling** (default creds, unsalted SHA-256 in `localStorage`, no rate limiting).
3. **Missing browser hardening headers** (CSP/HSTS/etc.) on the static deployment.
4. **Build-time dependency CVEs** (dev/build only).

| Severity | Count |
|----------|-------|
| SEV-CRITICAL | 1 |
| SEV-HIGH | 1 (2 resolved) |
| SEV-MEDIUM | 2 (3 resolved) |
| SEV-LOW | 5 |
| RESOLVED | 4 |

**Launch recommendation:** Acceptable to launch as a **single-user / trusted-operator local tool**. **Not** acceptable to present the admin area as a real access-control boundary on a public URL without a backend. See staged remediation plan (§8).

---

## 1. Project Inventory & Attack Surface Map

### Stack detection

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React 18, Vite 5 | SPA, hash routing (`#/`, `#/admin`) |
| Backend / API | **None** | No server, no serverless functions |
| Database / ORM | **None** | Data in `localStorage` key `angles_proto_v1` |
| Auth / session | Client-only | SHA-256 hash in `localStorage`, flag in `sessionStorage` |
| Storage / upload | Client-only | Images → canvas → JPEG data URL; JSON import |
| Queues / workers | **None** | N/A |
| Webhooks / payments | **None** | N/A |
| AI integrations | **None** | N/A |
| Deployment | Static (Vercel) | `UNVERIFIED` — inferred from `README.md`; no `vercel.json` present |
| CI/CD | **None** | No `.github/workflows`, no Docker, no pipelines |
| Monitoring / logging | **None** | `console.warn` only |

### Files of interest

| Area | File | Public? | Auth? | User Input? | Risk |
|------|------|---------|-------|-------------|------|
| App shell | `src/main.jsx` | Yes | No | No | Low |
| Monolith UI + logic | `src/App.jsx` (~3000 LoC) | Yes | "Admin" UI gate only | Yes (search, angle values, hold names, file upload, JSON import) | Medium |
| Error boundary | `src/components/ErrorBoundary.jsx` | Yes | No | No | Low |
| HTML entry | `index.html` | Yes | No | No | Medium (no security headers/CSP) |
| Build config | `vite.config.js` | n/a | n/a | n/a | Low |

### Input vectors (all client-side)

| Input | Location | Handling |
|-------|----------|----------|
| Hold search | `holdSearch` / `adminHoldSearch` | `.toLowerCase().includes()` filter — rendered as React text (escaped) |
| Angle value | `AdminAngleRow` input | `Number()` + `clamp(0,90)` |
| Hold name | admin "NEW" / rename | `normalizeHoldName`, rendered as React text |
| Image upload | `handleDrawingUpload` / `handleHoldCoverUpload` | MIME check → canvas re-encode to JPEG |
| JSON import | `handleImportDb` | size guard → `JSON.parse` → `migrateAndSanitize` |
| Hash route | `useHashRoute` | compared to `/admin` only; no external redirect |

### Trust boundaries

```
[ User's browser ] ── localStorage / sessionStorage (same-origin, plaintext)
        │
        └── static assets served by Vercel CDN (no app server)
```
There is **no server-side trust boundary**. Everything the client "enforces" is advisory.

---

## 2. Findings

### SEV-CRITICAL — Client-side-only admin authentication (auth bypass / privilege escalation)

- **File:** `src/App.jsx` (`hasAdminSession` L46, gate L~700, `submitLogin` L553, `ADMIN_HASH_KEY`/`ADMIN_SESSION_KEY` L42)
- **Endpoint:** `#/admin` (client route)
- **Category:** Broken Authentication / Privilege Escalation (OWASP A07 / API2)
- **Problem:** Admin access is gated only by React state (`adminAuthed`), a `sessionStorage` flag set to the literal `"1"`, and a SHA-256 hash in `localStorage`. None is enforced by a server.
- **Risk:** Anyone with DevTools or `localStorage`/`sessionStorage` access can enter the admin UI and edit/delete all stored data, with no server to reject them.
- **Attack/Abuse Scenario:**
  - `sessionStorage.setItem('angles_proto_v1_admin_session','1')` then navigate to `#/admin`.
  - Or set/replace `angles_proto_v1_admin_hash` with the SHA-256 of a chosen password, then log in.
  - Or edit `angles_proto_v1` directly — bypasses the admin UI entirely.
- **Evidence:**
  ```js
  function hasAdminSession() {
      try { return sessionStorage.getItem(ADMIN_SESSION_KEY) === "1"; } catch { return false; }
  }
  // route render gate:
  if (route === "/admin" && (adminAuthed || hasAdminSession())) { return <AdminPage .../> }
  ```
- **Impact (honest, architecture-bounded):** Because there is **no backend and no shared data store**, an attacker can only manipulate **their own browser's** copy of the data. There is **no cross-user/multi-tenant data exposure**. The real risks are: (a) false sense of security if the admin gate is presented as protection; (b) tampering on a **shared/kiosk machine**; (c) any future backend that trusts this client gate would inherit a true critical bypass.
- **Recommended Fix:** Treat the current admin gate as **UX-only**, not security. If real protection is required, add a backend (or serverless API + auth provider) that:
  - authenticates server-side,
  - issues an httpOnly, Secure, SameSite cookie session,
  - authorizes every mutating request server-side.
  Until then, document explicitly that "admin" is not an access-control boundary.
- **Test/Verification:** In a fresh browser, run the three scenarios above and confirm admin UI loads. After a backend exists, confirm direct API calls without a valid session return 401/403.
- **Status:** OPEN

---

### SEV-HIGH — Default credentials `admin` / `admin` (and resettable bootstrap)

- **File:** `src/App.jsx` `submitLogin` L565–L572; `README.md`
- **Category:** Identification & Authentication Failures (OWASP A07)
- **Problem:** When no hash exists, login succeeds only with `admin`/`admin` and stores `sha256("admin")`. Clearing `angles_proto_v1_admin_hash` re-enables the default bootstrap.
- **Risk:** Predictable first-access credentials; trivial "reset to default" by removing one `localStorage` key.
- **Attack/Abuse Scenario:** `localStorage.removeItem('angles_proto_v1_admin_hash')` → log in with `admin`/`admin`.
- **Evidence:**
  ```js
  if (!storedHash) {
      if (loginUser === "admin" && loginPass === "admin") { /* store hash, finish() */ }
      else { toast("First login: use admin / admin once to set your password."); }
  }
  ```
- **Recommended Fix:** Force a strong password on first run (min length, reject `admin`); never document live default creds in a public README; ideally move auth server-side (see CRITICAL-1).
- **Test/Verification:** Confirm `admin`/`admin` is rejected and a password policy is enforced on first setup.
- **Status:** RESOLVED — `submitLogin` now requires a strong password on first run (`isStrongAdminPassword`: min 8 chars, `WEAK_PASSWORDS` blocklist). Default `admin`/`admin` logic removed entirely. Resolved in commit `a4475fb`.

---

### SEV-HIGH — Unsalted SHA-256 password hash in `localStorage`

- **File:** `src/App.jsx` `sha256Hex` L438–L443; storage L575
- **Category:** Cryptographic Failures (OWASP A02)
- **Problem:** Password is hashed with a single round of unsalted SHA-256 and stored client-side in `localStorage` (`angles_proto_v1_admin_hash`), readable by any same-origin script or local user.
- **Risk:** Offline brute-force/rainbow-table recovery of weak passwords; no KDF (bcrypt/scrypt/Argon2), no salt, no pepper.
- **Evidence:**
  ```js
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  localStorage.setItem(ADMIN_HASH_KEY, await sha256Hex(loginPass));
  ```
- **Recommended Fix:** Do not store credential material in the client. Move verification server-side with a slow salted KDF. If a local-only secret is unavoidable, at minimum use PBKDF2 (`crypto.subtle.deriveBits`) with a random salt and high iteration count — but note this still cannot be secret on the client.
- **Test/Verification:** Confirm no credential hash is present in `localStorage` after moving auth server-side.
- **Status:** OPEN

---

### SEV-HIGH — No rate limiting / lockout / anti-automation on login

- **File:** `src/App.jsx` `submitLogin` L553
- **Category:** Unrestricted Resource Consumption / Brute Force (OWASP API4 / A07)
- **Problem:** Login has no attempt counter, delay, lockout, or CAPTCHA. (`README.md` historically claimed "rate-limited login" — **not implemented**.)
- **Risk:** Unlimited local guessing; combined with weak/unsalted hashing, accelerates password recovery. Bounded by being client-side (no server to flood), but still removes a control the project claims to have.
- **Evidence:** `submitLogin` performs hash compare with no throttling state.
- **Recommended Fix:** Implement server-side rate limiting + lockout when auth moves server-side. For the interim client tool, add exponential backoff/lockout after N failures (defense-in-depth only).
- **Test/Verification:** Script repeated wrong logins; confirm backoff/lockout triggers.
- **Status:** OPEN

---

### SEV-MEDIUM — No Content Security Policy or security response headers

- **File:** `index.html`; deployment config (`UNVERIFIED` — no `vercel.json`)
- **Category:** Security Misconfiguration (OWASP A05)
- **Problem:** No CSP, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, or `Permissions-Policy`.
- **Risk:** No defense-in-depth against injected/3rd-party script, clickjacking, MIME sniffing, or referrer leakage. CSP is the main mitigating control that is currently missing for a data-handling SPA.
- **Recommended Fix:** Add a `vercel.json` `headers` block (or `<meta http-equiv="Content-Security-Policy">` as a weaker fallback):
  - `Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: geolocation=(), camera=(), microphone=()`
  - Note: inline `<style>` blocks require `style-src 'unsafe-inline'` (or refactor to external CSS for a stricter policy). The print iframe uses `data:`/inline styles — validate CSP against print flow.
- **Test/Verification:** `curl -I https://<deploy>` shows headers; browser console shows no CSP violations during normal + print + upload flows.
- **Status:** RESOLVED — `vercel.json` added with full header set: CSP (`default-src 'self'`, `img-src 'self' data: blob:`, `style-src 'self' 'unsafe-inline'`, `script-src 'self'`, `frame-ancestors 'none'`, `base-uri 'none'`, `object-src 'none'`), HSTS (`max-age=63072000; includeSubDomains; preload`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`. Resolved in commit `a4475fb`.

---

### SEV-MEDIUM — JSON import accepts arbitrary `data:image/*` (incl. SVG) without sanitization

- **File:** `src/App.jsx` `migrateAndSanitize` (drawing accepted if it `startsWith("data:image/")`), `handleImportDb` L~1940
- **Category:** Injection / Unsafe Content (OWASP A03, defense-in-depth)
- **Problem:** Uploaded images are re-encoded to JPEG via canvas (safe), **but JSON import** stores any `data:image/*` string verbatim, including `data:image/svg+xml,...`. These are later rendered in `<img src=...>` (viewer, zoom, print iframe).
- **Risk:** SVG loaded via `<img>` does **not** execute script in modern browsers, so this is **not** a direct XSS. Residual risk: malicious/oversized SVG, polyglot files, or rendering surprises; weaker guarantees than the upload path.
- **Attack/Abuse Scenario:** Craft a malicious JSON export with an embedded `data:image/svg+xml` payload and trick an operator into importing it.
- **Evidence:**
  ```js
  const drawing = typeof a?.drawing === "string" && a.drawing.startsWith("data:image/") ? a.drawing : undefined;
  ```
- **Recommended Fix:** On import, restrict `drawing`/`holdImages` to a raster allowlist (`data:image/(png|jpeg|webp)`), or re-encode imported images through the same canvas pipeline; reject `svg+xml`. Keep `<img>` (never inline SVG / `dangerouslySetInnerHTML`).
- **Test/Verification:** Import a JSON containing an SVG data URL; confirm it is rejected or rasterized.
- **Status:** RESOLVED — `isSafeRasterDataUrl` now uses strict regex `/^data:image\/(png|jpe?g|webp|gif);/i`, explicitly rejecting `svg+xml` and any non-raster MIME on both upload and import paths. Resolved in commit `a4475fb`.

---

### SEV-MEDIUM — Sensitive app data + credential hash stored unencrypted in `localStorage`

- **File:** `src/App.jsx` (`LS_KEY`, `ADMIN_HASH_KEY`, `LS_BACKUPS_KEY`, `LS_CORRUPT_KEY`)
- **Category:** Cryptographic Failures / Data at Rest (OWASP A02)
- **Problem:** All product data, base64 images, password hash, and backups are in plaintext `localStorage`, accessible to any same-origin script and any user of the machine/profile.
- **Risk:** On a shared machine, or in the event of any XSS, the entire dataset and credential hash are readable/exfiltratable. `_corrupt_*` keys (added for recovery) also persist raw prior data indefinitely.
- **Recommended Fix:** Accept as a known limitation for a local tool, **or** move data server-side. Add a retention/cleanup for `_corrupt_*` keys (e.g., keep newest 1). Document the shared-machine risk.
- **Test/Verification:** Inspect `localStorage`; confirm no unbounded growth of `_corrupt_*` keys.
- **Status:** OPEN

---

### SEV-MEDIUM — Build/dev dependency vulnerabilities (esbuild, postcss, vite)

- **File:** `package-lock.json`
- **Category:** Vulnerable & Outdated Components / Supply Chain (OWASP A06)
- **Problem:** `npm audit` reports **3 moderate** advisories:
  - `esbuild <=0.24.2` — [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) (dev server can be queried by any site). Transitive via `vite <=6.4.1`.
  - `postcss <8.5.10` — [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) (XSS via unescaped `</style>` in CSS stringify output).
- **Risk:** **Build/dev-time only** — these packages are not shipped in the production bundle, and the esbuild issue only affects a locally-running dev server. Real production runtime impact is low; tracked for hygiene and to avoid dev-machine exposure.
- **Recommended Fix:** `npm audit fix` for postcss; plan a `vite`/`esbuild` upgrade (major bump — test build). Do not run the Vite dev server on untrusted networks.
- **Test/Verification:** `npm audit` shows 0 vulnerabilities after upgrade; `npm run build` still succeeds.
- **Status:** OPEN

---

### SEV-LOW — `sessionStorage` admin flag is a forgeable constant

- **File:** `src/App.jsx` L563 (`setItem(ADMIN_SESSION_KEY, "1")`)
- **Category:** Broken Authentication (subset of CRITICAL-1)
- **Problem:** The session "token" is the literal string `"1"`, not an unguessable value. Trivially forgeable. (Subsumed by CRITICAL-1; listed for completeness.)
- **Recommended Fix:** Irrelevant until auth is server-side; then use signed httpOnly cookies.
- **Status:** OPEN

---

### SEV-LOW — No CI/CD security gates (SAST, secret scanning, Dependabot, branch protection)

- **File:** repo root (no `.github/`)
- **Category:** Insecure SDLC / Supply Chain (OWASP A06/A08)
- **Problem:** No automated dependency audit, secret scanning, SAST, Dependabot/Renovate, or required checks/branch protection.
- **Risk:** Regressions (like the DB-dump leak, see RESOLVED-1) and vulnerable dependencies can land unnoticed.
- **Recommended Fix:** Add a minimal GitHub Actions workflow: `npm ci` + `npm audit --audit-level=high` + build; enable GitHub secret scanning + push protection + Dependabot; protect `main`.
- **Status:** OPEN

---

### SEV-LOW — Global removal of focus outlines

- **File:** `src/App.jsx` (`outline: none !important` on buttons/inputs)
- **Category:** Accessibility (security-adjacent)
- **Problem:** Keyboard focus visibility removed globally; not a vulnerability but degrades accessible/secure operation.
- **Recommended Fix:** Provide a visible `:focus-visible` style instead of suppressing outlines.
- **Status:** OPEN

---

### SEV-LOW — Print flow uses `document.write` into an iframe

- **File:** `src/App.jsx` `printImage` L363–L399
- **Category:** Injection surface review (no exploit found)
- **Problem:** `printImage` builds a **static** HTML template via `doc.write` and sets the image via `img.src = src` (property assignment, not string interpolation). The `src` is a user-controlled data/blob URL but is never concatenated into HTML.
- **Risk:** No HTML/script injection path identified. Listed as a reviewed surface; if the template is ever changed to interpolate user input into the written HTML string, it becomes XSS-prone.
- **Recommended Fix:** Keep `src` as a property assignment; never interpolate user data into the `doc.write` string. Consider building the DOM via `createElement` instead of `doc.write`.
- **Status:** OPEN (informational)

---

### SEV-LOW — `Math.random()` fallback for element IDs

- **File:** `src/App.jsx` `cryptoRandomId` L51–L54
- **Category:** Crypto hygiene (non-sensitive)
- **Problem:** Falls back to `Math.random()` when `crypto.randomUUID` is unavailable. IDs are used only as React keys / record identifiers, **not** for security tokens.
- **Risk:** None security-relevant in current usage.
- **Recommended Fix:** Acceptable. Do not reuse this generator for any future security token.
- **Status:** OPEN (informational)

---

### RESOLVED — Database dumps committed to git history (fixed this engagement)

- **File:** `base.json`, `Base_2026-02-11_17-30.json`
- **Category:** Data Exposure / Secrets-in-VCS hygiene (OWASP A05)
- **Problem:** Exported DB dumps were committed and pushed to a GitHub remote.
- **Remediation performed:** Files untracked, `.gitignore` patterns added (`base.json`, `Base_*.json`, `angles-db.json`, `*-db.json`), history rewritten with `git filter-repo`, and force-pushed (`bbb1f28...a4475fb`). A pre-rewrite backup bundle was kept locally.
- **Residual:** Old commit SHAs may remain cached on GitHub until GC; prior clones/forks retain the data. Contact GitHub Support for forced GC if the data is sensitive. Content was workshop angle data (non-credential), so residual risk is low.
- **Status:** RESOLVED (monitor residual)

---

## 3. OWASP API Top 10 (2023) Mapping

| ID | Risk | Applicability | Notes |
|----|------|---------------|-------|
| API1 | BOLA / IDOR | **N/A** | No object-level server endpoints |
| API2 | Broken Authentication | **APPLIES** | See CRITICAL-1, HIGH-2/3/4 |
| API3 | BOPLA / Mass Assignment | **N/A** | No server models; `migrateAndSanitize` allowlists fields client-side |
| API4 | Unrestricted Resource Consumption | Partial | No login throttle (HIGH-4); import size cap exists (good) |
| API5 | Broken Function-Level AuthZ | **N/A** (bounded) | Admin gate is client-only (CRITICAL-1) |
| API6 | Sensitive Business Flows | **N/A** | No payments/quotas/business server flows |
| API7 | SSRF | **N/A** | No server-side fetch; **app makes zero network calls** |
| API8 | Security Misconfiguration | **APPLIES** | No CSP/headers (MEDIUM), dep CVEs (MEDIUM) |
| API9 | Improper Inventory | Low | Single static app; no stale endpoints |
| API10 | Unsafe 3rd-party API Consumption | **N/A** | No outbound API calls |

---

## 4. Injection / Input Validation Summary

| Check | Result |
|-------|--------|
| Server-side schema validation | N/A (no server); client `migrateAndSanitize` allowlists shape, clamps angles `0–90`, dedupes holds |
| Parameterized SQL / no raw SQL | N/A (no DB) |
| Command injection | None (no shell/exec) |
| XSS (`dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`) | **None present** — verified by grep; all dynamic text rendered as React children (auto-escaped) |
| Prototype pollution | Low — `JSON.parse` + field allowlist in `migrateAndSanitize`; no recursive merge of untrusted keys |
| XXE | N/A (no XML parsing) |
| ReDoS | Low — only simple regex (`/^0([.,]0+)?$/`, whitespace normalize) |
| Unsafe deserialization | Low — `JSON.parse` only, sanitized; size-capped |
| SVG/CSV/markdown | SVG via import **blocked** — `isSafeRasterDataUrl` regex allowlist (RESOLVED); no markdown/CSV parsing |

---

## 5. Frontend / Browser Security

| Check | Status |
|-------|--------|
| Secrets in bundle | **None** — no API keys/secrets in source or bundle |
| Unsafe HTML/markdown rendering | None (`dangerouslySetInnerHTML` absent) |
| Tokens in localStorage | Password **hash** + data present (MEDIUM); no bearer tokens (no server) |
| CSP / HSTS / nosniff / frame / Referrer / Permissions-Policy | **Present** — configured in `vercel.json` (RESOLVED) |
| Third-party scripts | None (Google Fonts links removed; no external `<script>`) |
| PII in URLs | None |
| UI-only access controls | Yes — admin gate is UI-only (CRITICAL-1) |

---

## 6. CSRF / CORS / Webhooks / Payments / Queues / Workers / AI

**All N/A** — there is no server, no cookies used for state-changing requests, no cross-origin API, no webhooks, no payment provider, no background workers, and no AI/LLM integration. No outbound network calls exist in the codebase (verified by grep for `fetch`/`XMLHttpRequest`/`WebSocket`/`sendBeacon`/`axios`).

---

## 7. Secrets Scan

| Scan | Result |
|------|--------|
| Hardcoded secrets in source | None found |
| `.env` / `.env.example` in repo | None present |
| Secrets in frontend env | None (no `import.meta.env` secret usage) |
| Secrets in Docker / CI logs | N/A (no Docker/CI) |
| Secrets in test fixtures | N/A (no tests) |
| Production secrets in preview | N/A (no secrets exist) |
| **DB dumps in VCS history** | **Was present → RESOLVED** (see RESOLVED-1) |

---

## 8. Staged Remediation Plan

### Stage 0 — Pre-launch (low effort, do now)
1. `npm audit fix` (postcss) and plan vite/esbuild upgrade. (MEDIUM)
2. Add security headers + CSP via `vercel.json`. (MEDIUM)
3. Restrict imported images to raster allowlist or re-encode. (MEDIUM)
4. Remove live default-credential instructions from public `README.md`; enforce a real password on first run. (HIGH-2)
5. Cap `_corrupt_*` retention. (MEDIUM)

### Stage 1 — Honest framing (docs/UX)
6. Document that "admin" is **not** a security boundary in the current architecture. (CRITICAL-1 framing)
7. Add `:focus-visible` styling. (LOW)

### Stage 2 — If real access control is required (larger effort)
8. Introduce a backend / serverless API + identity provider:
   - server-side auth, salted KDF, httpOnly+Secure+SameSite session cookies;
   - server-side authorization on all mutations;
   - server-side rate limiting/lockout;
   - move data out of `localStorage` into a scoped datastore.

### Stage 3 — SDLC hardening
9. GitHub Actions: `npm ci` + `npm audit --audit-level=high` + build on PR.
10. Enable secret scanning + push protection, Dependabot, branch protection on `main`.

---

## 9. Verification Matrix

| Finding | Verification |
|---------|--------------|
| CRITICAL-1 | DevTools bypass reproduces today; after backend, unauthenticated API → 401/403 |
| HIGH-2 | `admin`/`admin` rejected; password policy enforced |
| HIGH-3 | No credential hash in `localStorage` post-fix |
| HIGH-4 | Backoff/lockout on repeated failures |
| MEDIUM (CSP) | `curl -I` shows headers; no CSP violations in normal/print/upload |
| MEDIUM (SVG) | SVG data URL import rejected/rasterized |
| MEDIUM (deps) | `npm audit` clean; build passes |

---

*End of SECURITY_AUDIT.md*
