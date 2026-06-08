# THREAT MODEL — angles-proto

> Method: STRIDE over the current shared-backend architecture. Date: 2026-06-08.

---

## 1. System Description

`angles-proto` is a React/Vite SPA for workshop saw-angle reference. The public
operator view reads one shared catalog from same-origin Vercel Functions.
Authenticated admins can save catalog edits, view change history, and receive a
startup notification when another user changed the database.

Backend functions in `/api` talk to Neon Postgres. Browser code never receives
`DATABASE_URL`, `SESSION_SECRET`, password hashes, or direct database access.

---

## 2. Assets

| ID | Asset | Sensitivity | Where |
|----|-------|-------------|-------|
| A1 | Product/angle catalog and images | Low-Medium business data | Neon `app_state.data` |
| A2 | User password hashes/salts | Medium credential material | Neon `users` |
| A3 | Session token | Medium | httpOnly `angles_session` cookie |
| A4 | Change history | Low-Medium accountability data | Neon `change_log` |
| A5 | Device-local work progress/theme/last-seen id | Low | Browser `localStorage` |
| A6 | Server secrets | High | Vercel env: `DATABASE_URL`, `SESSION_SECRET` |
| A7 | Source code and build pipeline | Low-Medium | Git / Vercel |

---

## 3. Trust Boundaries

```
TB1: Network -> Browser
    Static assets and same-origin API responses over HTTPS.

TB2: Browser -> Vercel Functions (/api)
    Public reads, login/logout/session, authenticated writes/history.

TB3: Vercel Functions -> Neon Postgres
    Server-only database access using DATABASE_URL.

TB4: External file -> Browser app state
    JSON import and image upload, validated before staging/saving.

TB5: Browser -> localStorage
    Device-local UI state only, not the shared catalog or credentials.
```

---

## 4. Threat Actors

| Actor | Capability | Motivation |
|-------|------------|------------|
| Public viewer | Can read catalog and use DevTools | Inspect public data, attempt write APIs |
| Named admin | Valid session | Edit catalog, possibly make mistakes |
| Credential guesser | Repeated login attempts | Obtain admin session |
| Shared-machine user | Access browser profile | Read device-local work state, reuse non-expired session |
| Malicious file supplier | Provides import/image file | Corrupt catalog or trigger parser/resource issues |
| Network attacker | Intercepts insecure transport | Tamper responses if HTTPS/headers fail |
| Supply-chain attacker | Compromises package/build | Inject app or server code |

---

## 5. Data Flow

```
Operator browser
  GET /api/state ---------------> Vercel Function -----> Neon app_state
  work progress ----------------> localStorage

Admin browser
  POST /api/login --------------> Vercel Function -----> Neon users
  httpOnly session cookie <------ Vercel Function
  PUT /api/state ---------------> Vercel Function -----> Neon app_state + change_log
  GET /api/history -------------> Vercel Function -----> Neon change_log
  GET /api/session -------------> Vercel Function -----> latest change summary
```

---

## 6. STRIDE Analysis

### Spoofing

- **T-S1 — Guess admin credentials.** Seed passwords are provided through
  server-side env by default; the legacy password = username seed mode is
  explicit opt-in only. **Mitigation:** server-side scrypt hashes, httpOnly
  cookies, login throttling, no client-side password storage. **Residual:**
  Medium until distributed rate limiting/password rotation exist.
- **T-S2 — Forge session cookie.** Session token is HMAC-signed with
  `SESSION_SECRET`. **Mitigation:** `verifySession`, timing-safe signature check,
  expiry, httpOnly cookie. **Residual:** Low if `SESSION_SECRET` stays secret.

### Tampering

- **T-T1 — Unauthenticated catalog write.** Direct `PUT /api/state` without a
  valid cookie returns 401. **Residual:** Low.
- **T-T2 — Stale admin overwrites newer changes.** `app_state.revision` is a
  compare-and-set token; stale saves return 409 and write nothing. **Residual:**
  Medium UX risk; user must reload/reapply manually.
- **T-T3 — Malicious import/image payload.** Imports are size-checked and
  sanitized; images are re-encoded/compressed; SVG data URLs are rejected.
  **Residual:** Low-Medium for browser image/parser issues.

### Repudiation

- **T-R1 — Admin denies edits.** Server derives audit events from old/new
  catalog snapshots and writes `change_log` rows attributed to the session user.
  Image-only changes are intentionally not logged. **Residual:** Low-Medium.

### Information Disclosure

- **T-I1 — Public catalog visibility.** `GET /api/state` is public by product
  decision. **Residual:** Accepted.
- **T-I2 — History visibility.** `GET /api/history` requires session. **Residual:** Low.
- **T-I3 — Secret exposure.** Database URL and session secret are server-only env
  vars. **Residual:** depends on Vercel/project secret hygiene.
- **T-I4 — Device-local storage exposure.** Work progress/theme/last-seen id are
  visible to local users/same-origin scripts. **Residual:** Low.

### Denial of Service

- **T-D1 — Oversized import/images.** File-size and serialized-size guards plus
  image compression reduce browser storage/memory risk. **Residual:** Low.
- **T-D2 — Login brute force.** `/api/login` has best-effort in-memory
  throttling keyed by username and source IP. **Residual:** Medium for exposed
  deployments until the limiter uses shared storage across serverless instances.
- **T-D3 — Backend/database outage.** Public app shows "Нет связи с сервером" and
  retry; no offline catalog fallback. **Residual:** Accepted online-only design.

### Elevation of Privilege

- **T-E1 — Public viewer becomes admin.** Server endpoints enforce session for
  writes/history. Frontend route gating is UX only; backend is authoritative.
  **Residual:** Low, bounded by session/auth robustness.
- **T-E2 — Admin role separation.** All three named users are equal admins.
  **Residual:** Accepted.

---

## 7. Key Risks Carried Forward

1. Login throttling is currently in-memory, not distributed across serverless instances.
2. Online-only dependency on Vercel Functions and Neon availability.
3. Public catalog read is intentional but should remain clearly documented.
4. No automatic merge/reapply for stale admin edits.
5. Historical DB dump exposure was previously remediated, but public Git hosting
   cache/clone residuals should be treated as impossible to fully recall.

---

## 8. Verification Hooks

- Unauthenticated `PUT /api/state` -> 401.
- Stale `PUT /api/state` -> 409 and no write.
- Unauthenticated `GET /api/history` -> 401.
- Session cookie is httpOnly, SameSite=Strict, Secure in production.
- Browser localStorage has no password hash or shared catalog state.
- CSP/HSTS/frame headers are present from `vercel.json`.

---

*End of THREAT_MODEL.md*
