# THREAT MODEL — angles-proto

> Method: STRIDE over a client-only SPA. Date: 2026-05-29. Baseline commit: `a4475fb`.

---

## 1. System Description

`angles-proto` is a static, single-page React application for referencing saw angles per product ("blade"/hold). It has **no backend**. All data is stored in the browser's `localStorage`/`sessionStorage` and served as static assets (Vercel, `UNVERIFIED`). There is an in-app "admin" mode for editing data, gated client-side only.

---

## 2. Assets

| ID | Asset | Sensitivity | Where |
|----|-------|-------------|-------|
| A1 | Product/angle dataset (holds, angles, images) | Low–Medium (business data) | `localStorage: angles_proto_v1` |
| A2 | Admin password hash | Medium (credential material) | `localStorage: angles_proto_v1_admin_hash` |
| A3 | Session flag | Low | `sessionStorage: angles_proto_v1_admin_session` |
| A4 | Backups / corrupt snapshots | Low–Medium | `localStorage: *_backups`, `*_corrupt_*` |
| A5 | Source code & repo | Low (no secrets) | GitHub `ipostatos/angles-proto` |
| A6 | Build/dev toolchain | Low | dev machine |

There is **no multi-user, multi-tenant, or shared server-side data**. Each browser holds its own copy.

---

## 3. Trust Boundaries

```
TB1: Network → Browser            (static asset delivery; should be HTTPS + headers)
TB2: Page script → Web Storage     (same-origin; plaintext, no isolation between "admin" and "user")
TB3: External file → App           (JSON import / image upload crossing into app state)
TB4: Dev machine → VCS/CDN         (commits, deploys)
```
**No server-side trust boundary exists.** All "admin vs user" separation lives on one side of TB2 and is advisory.

---

## 4. Threat Actors

| Actor | Capability | Motivation |
|-------|-----------|------------|
| Curious/Local user | DevTools, edit storage | Bypass admin gate, tamper data |
| Shared-machine next user | Read browser profile | View/alter data, read password hash |
| Malicious file supplier | Provide crafted JSON/image | Inject SVG/oversized payload via import |
| Network attacker (no TLS/headers) | MITM on insecure transport | Tamper assets, clickjack |
| Supply-chain attacker | Compromise dependency | Inject build-time code |
| Repo browser | Read public GitHub history | Recover previously committed data |

---

## 5. Data Flow (DFD, level 0)

```
(User) ──input(search, angles, names)──► [React App] ──read/write──► (Web Storage A1–A4)
(User) ──upload image──► [canvas re-encode → JPEG dataURL] ──► (A1)
(User) ──import JSON──► [size cap → JSON.parse → migrateAndSanitize] ──► (A1)
[React App] ──render <img src=dataURL>──► (DOM / print iframe)
(User) ──#/admin──► [client gate: adminAuthed || sessionFlag] ──► (Admin UI → A1)
```
No process crosses the network after initial asset load.

---

## 6. STRIDE Analysis

### Spoofing
- **T-S1 — Forge admin session.** Set `sessionStorage` flag or `adminAuthed`. **Mitigation:** none possible client-side. **Residual:** High locally / bounded globally. → SECURITY_AUDIT CRITICAL-1.
- **T-S2 — Default credential use.** `admin`/`admin` bootstrap. → HIGH-2.

### Tampering
- **T-T1 — Direct storage edit.** Edit `angles_proto_v1` to change/erase data, bypassing admin UI. **Mitigation:** `migrateAndSanitize` on load (shape/clamp) limits corruption but not intentional edits. **Residual:** bounded to own browser.
- **T-T2 — Malicious import.** Crafted JSON with SVG/large payloads. **Mitigation:** size cap (good), but SVG accepted (MEDIUM). 
- **T-T3 — Asset tampering over insecure transport.** **Mitigation:** enforce HTTPS/HSTS (MEDIUM — currently unset).

### Repudiation
- **T-R1 — No audit log.** No record of who changed what (single-user local tool). **Residual:** acceptable for current scope; required if multi-user is added.

### Information Disclosure
- **T-I1 — Storage readable by any same-origin script / local user.** Password hash + data in plaintext. → MEDIUM (data-at-rest) + HIGH-3 (hash).
- **T-I2 — Repo history disclosure.** DB dumps previously committed. → RESOLVED-1.
- **T-I3 — Referrer/3rd-party leakage.** None (no external scripts/calls); add `Referrer-Policy` for completeness. → MEDIUM (headers).

### Denial of Service
- **T-D1 — Oversized import → OOM/quota.** **Mitigation:** `MAX_DB_SIZE_KB` file-size + serialized-size guard (good). **Residual:** Low.
- **T-D2 — `QuotaExceededError` on save.** **Mitigation:** handled with toast; save returns success flag. **Residual:** Low.
- **T-D3 — Corrupt storage.** **Mitigation:** preserves corrupt copy, recovers to defaults, warns user. **Residual:** Low.

### Elevation of Privilege
- **T-E1 — User → Admin.** Same as T-S1. → CRITICAL-1.
- **T-E2 — Future backend trusting client gate.** If a backend is added that trusts `adminAuthed`/sessionStorage, this becomes a true server-side privilege escalation. **Mitigation:** enforce authZ server-side from day one.

---

## 7. Attacker Goals vs Controls

| Goal | Feasible today? | Control gap |
|------|-----------------|-------------|
| Read other users' data | **No** | No shared store (architectural control) |
| Become admin in own browser | **Yes (trivial)** | No server enforcement (CRITICAL-1) |
| Tamper own data | Yes | Expected for a local tool |
| Inject executing script (XSS) | No path found | React escaping; no `dangerouslySetInnerHTML`; SVG via `<img>` only |
| Steal secrets | N/A | No secrets exist |
| DoS the app | Hard | Import/size/quota guards present |
| Exfiltrate via network | No | App makes zero outbound calls |

---

## 8. Key Risks Carried Into Production

1. **Admin is UX-only, not security** (CRITICAL-1) — must be documented or replaced with a backend.
2. **Credential material on the client** (HIGH-3) — unavoidable without a server.
3. **Missing browser-hardening headers** (MEDIUM) — easy win on the static deploy.
4. **Import content trust** (MEDIUM) — restrict to raster images.

---

## 9. Assumptions & UNVERIFIED Items

- Deployment target is Vercel static hosting — `UNVERIFIED` (inferred from README; no `vercel.json`).
- HTTPS is provided by the host by default — `UNVERIFIED` (no header config in repo).
- No analytics/telemetry — **verified** (no network calls in code).

---

*End of THREAT_MODEL.md*
