# Contributing

Thanks for working on Angles. This is a small internal workshop tool; the goal
of these notes is to keep changes safe, reviewable, and consistent.

## Before you start

- Read [`README.md`](README.md) for setup and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
  for how the pieces fit together.
- For backend or auth changes, also read [`SECURITY_DEBT.md`](SECURITY_DEBT.md)
  and [`THREAT_MODEL.md`](THREAT_MODEL.md).

## Local setup

```bash
npm install
npm run dev          # UI-only (no /api)
# or, for full local backend:
vercel env pull .env.local
node --env-file=.env.local scripts/db-setup.mjs
vercel dev
```

See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for the full workflow.

## Branching & commits

- Branch off `main`. Use a descriptive prefix, e.g. `fix/`, `feature/`, `ui/`,
  `docs/`.
- Keep commits focused. Write imperative subjects ("Fix stale-revision toast",
  not "Fixed").
- Open a pull request against `main` using the PR template.

## Required checks

All of these must pass before a PR is merged. CI runs them too
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

```bash
npm run lint     # eslint, zero warnings
npm test         # vitest, all green
npm run build    # vite production build
npm run audit    # npm audit --audit-level=high
```

## Guidelines

- **Match the surrounding code.** Naming, file layout, and idioms should look
  like the code already in the folder you are editing.
- **Test what you change.** Domain logic, storage, and API handlers have
  colocated `*.test.*` files — add or update them.
- **Never commit secrets or database dumps.** `DATABASE_URL`, `SESSION_SECRET`,
  and seed passwords are server-only. Dump patterns (`base.json`, `*-db.json`,
  …) are gitignored and must stay out of the working tree — see
  [`docs/OPERATIONS.md`](docs/OPERATIONS.md).
- **Don't break the public/private boundary.** Public catalog read is
  intentional; writes and history require a valid server session.
- **Mobile CSS is fragile.** Responsive overrides rely on `!important`
  media-query rules. Verify on a real narrow viewport after layout changes.

## Reporting bugs / requesting features

Use the GitHub issue templates under `.github/ISSUE_TEMPLATE/`. For anything
security-sensitive, follow [`SECURITY.md`](SECURITY.md) instead of opening a
public issue.
