# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.5.x | ✅ |
| < 1.5 | ❌ |

## Reporting a vulnerability

This is an internal workshop tool. **Do not open a public GitHub issue for
security problems.** Instead, report privately to the maintainer
(ipostatos@gmail.com) — or, on GitHub, use **Security → Report a vulnerability**
(private advisory) if enabled on the repository.

Please include:

- What the issue is and the impact you expect.
- Steps to reproduce (a minimal proof of concept if possible).
- The affected version / commit.

You can expect an acknowledgement and an initial assessment. Fixes are
prioritized by severity.

## Threat model & scope

Angles is intended for an **internal/trusted-network** workshop. The threat
model, accepted risks, and current security backlog are documented in:

- [`THREAT_MODEL.md`](THREAT_MODEL.md) — assets, trust boundaries, threats.
- [`SECURITY_DEBT.md`](SECURITY_DEBT.md) — prioritized backlog and accepted debt.
- [`SECURITY_CHECKLIST.md`](SECURITY_CHECKLIST.md) — review checklist.
- [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) — historical pre-backend audit.

### Known, intentional design decisions

- **Public catalog read** (`GET /api/state`) is an intentional product choice;
  admin writes and history require a server-verified httpOnly session.
- **Secrets stay server-side only** (`DATABASE_URL`, `SESSION_SECRET`, seed
  passwords); they must never use a `VITE_` prefix.
- **Login throttling fails open** if the throttle store is unavailable
  (availability over strictness) — see `D5` in `SECURITY_DEBT.md`.
- Security headers (CSP, HSTS, frame/Content-Type/Referrer/Permissions
  policies) are configured in [`vercel.json`](vercel.json).

## Automated checks

CI runs `npm audit --audit-level=high` and a **gitleaks** secret scan on every
push and pull request ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).
Dependabot opens weekly dependency-update PRs.
