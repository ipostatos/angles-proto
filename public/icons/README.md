# App icons (required PNGs)

These three PNG files are referenced by `index.html` and `public/site.webmanifest`
but are **not yet committed** — add them here to fix the iPhone home-screen icon
(currently a generic gray "A") and Android/Chrome install icons.

| File | Size | Used by |
|---|---|---|
| `apple-touch-icon-180.png` | 180×180 | `<link rel="apple-touch-icon">` — iPhone "Add to Home Screen" |
| `icon-192.png` | 192×192 | `site.webmanifest` — Android/Chrome install |
| `icon-512.png` | 512×512 | `site.webmanifest` — splash / high-res |

## Design spec

- **Style:** flat, Industrial-Minimal (matches the app design system) — no
  gradients, no drop shadows.
- **Background:** full-bleed, opaque (iOS applies its own rounded mask — do NOT
  pre-round the corners or use transparency for the Apple touch icon). White
  `#ffffff` or shell `#f5f7fa`.
- **Motif:** the saw-blade + ruler/angle mark in near-black `#1a1a1a`
  (the app's `textPrimary`), high contrast on the light background.
- **Safe margin:** keep the motif within ~12% padding so iOS corner-rounding
  doesn't clip it.
- Each size is the **same artwork** exported at the listed pixel dimensions
  (square, no padding beyond the safe margin baked into the art).

Once these files are added, no code change is needed — the metadata already
points at them.
