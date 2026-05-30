# Angles ✂️

> Saw-angle reference tool for production workshops — select products, compare MAIN and STEFAN cut angles side-by-side, and print reference sheets.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-avacut.vercel.app-black?style=flat-square&logo=vercel)](https://avacut.vercel.app)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev)
[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-000?style=flat-square&logo=vercel)](https://vercel.com)

---

## What it does

A zero-backend, offline-capable reference app for a cutting workshop. Operators pick one or more products from a list, instantly see their angles for two saws (**MAIN** and **STEFAN**), click a row to pull up the cutting drawing, and print a clean A4 reference sheet — all without touching a server.

Admins manage the full product catalogue (products, angles, drawings, cover images) through a password-protected admin panel.

---

## Features

| | |
|---|---|
| **Dual-table view** | MAIN and STEFAN angle tables, sortable asc/desc |
| **Multi-select products** | Check any number of products; tables update instantly |
| **Drawing viewer** | Click a row → drawing appears; zoom + dedicated print |
| **Print mode** | ALL / MAIN / STEFAN — multi-column A4 layout |
| **Admin panel** | Add / rename / delete products and angles, upload drawings |
| **Export / Import** | Full database backup as JSON; auto-backup before import |
| **Offline-first** | 100% localStorage — no network requests ever |
| **Responsive** | Desktop lock-scroll layout, mobile-friendly, print-ready |
| **Resilient** | Corrupt-data recovery, 5-snapshot backup ring, storage quota handling |

---

## Tech stack

- **React 19** — UI
- **Vite 8** — build tooling
- **react-hot-toast** — notifications
- **localStorage** — persistence (no database, no backend)
- **Vercel** — hosting + security headers (CSP, HSTS, X-Frame-Options)

---

## Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (default: `http://localhost:5173`).

```bash
npm run build   # produces static dist/ — deploy anywhere
```

---

## Admin panel

Navigate to `/#/admin` or click **ADMIN** in the app.

- **First run:** choose a password (≥ 8 characters, no common words). It is stored as a SHA-256 hash in `localStorage` — there is no default password.
- To reset: clear `angles_proto_v1_admin_hash` from browser storage.

> **Note:** This is a client-only app with no backend. The admin gate is a UX boundary, not an access-control system. Anyone with DevTools access can modify locally stored data. See [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) for the full threat model.

---

## Data & storage

- All data (products, angles, drawings, backups) lives in the browser's `localStorage`.
- **EXPORT** saves a timestamped JSON snapshot to disk; **IMPORT** restores from it (replaces all data, with auto-backup first).
- Only raster images (PNG / JPEG / WebP / GIF) are accepted — SVG is rejected to prevent XSS via import.
- Storage limit: ~4.5 MB serialized. Images are auto-compressed on upload.

---

## Security

Security headers are configured in [`vercel.json`](vercel.json):
`Content-Security-Policy` · `Strict-Transport-Security` · `X-Frame-Options: DENY` · `X-Content-Type-Options` · `Referrer-Policy` · `Permissions-Policy`

Full review: [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) · [`THREAT_MODEL.md`](THREAT_MODEL.md) · [`SECURITY_DEBT.md`](SECURITY_DEBT.md)
