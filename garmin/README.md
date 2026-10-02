# Angles — Garmin watch app

Connect IQ watch app that shows the saw angles of selected holds on the wrist.
No drawings or images — only hold names and MAIN / STEFAN angles.

Target device: **Instinct 3 AMOLED 45mm** (the manifest also lists a few other
Garmin models; only the Instinct 3 AMOLED 45mm build is tested).

## How it works on the watch

**Holds screen** (start screen):

| Item | What it does |
|---|---|
| **BIG MODE** · `N selected` | One angle per screen, large. |
| **LIST** | All angles of the selected holds as a colored list. |
| **RESET PROGRESS** | Asks *Reset progress?*, then clears the cut marks (green/red). Keeps the selected holds. |
| **RESET HOLDS** | Asks *Untick all holds?*, then unticks all holds. Keeps the cut marks. |
| **FROM PHONE** | Pulls the holds sent from the website (see below). Shows `no phone / offline` if it fails. |
| hold names | START ticks / unticks a hold (green box = picked). |

All screens are drawn by the app itself (no system menus), so the Instinct 3
round subscreen icon never appears. Buttons everywhere: UP / DOWN move,
START selects or marks, BACK goes back. Hold UP (MENU) jumps to the top of a list
(in BIG MODE: back to the first angle).

**Order of angles** (same as the web work mode): MAIN high → low, then STEFAN
low → high.

**Colors:** green = cut; red = missed (not cut, but a later angle of the same
saw is already cut). Marking an angle while one above it in the same saw is
still open vibrates twice, so a skip is noticed right away.

**BIG MODE buttons:** START marks the angle cut and jumps to the next open one
(press again on a cut angle to unmark); UP / DOWN browse.

**Saved on the watch** (Application.Storage, survives Back, exit and reboot):
selected holds, cut marks, cached catalog, time of the last web send.

## Send to watch

1. On the website select holds and press the **⌚** button next to the print icon.
2. The server stores that selection (`POST /api/watch`, table `watch_selection`).
3. When the app starts (or on **FROM PHONE**) the watch calls `GET /api/watch`
   through the phone (Garmin Connect app + Bluetooth must be on). A *new* send
   replaces the picked holds and clears the cut marks; the same send is not
   applied twice. The fresh catalog is cached too.

Without the phone the app works on what it saved last time.

### `/api/watch` response

```json
{ "r": 7, "h": [["Amon", [24.7, 39.8], [32, 39.8]], ...], "s": ["Amon"], "t": 1790939847 }
```

`h` — catalog rows `[name, [main], [stefan]]` (no images, ~3.5 KB);
`s` — hold names sent from the web; `t` — send time in unix **seconds**
(fits a Connect IQ 32-bit Number).

## Build

Requirements: Connect IQ SDK (9.x tested) with the device files installed via
the SDK Manager, Java 17, and a developer key (`developer_key.der`). The key
and build output are **not** committed (`.gitignore`).

```bash
# 1. Optional: refresh the bundled offline catalog from production
node garmin/tools/build-catalog.mjs

# 2. Build (Windows example; adjust SDK and key paths)
monkeyc -f garmin/monkey.jungle -d instinct3amoled45mm -o garmin/bin/angles.prg -y path/to/developer_key.der
```

The bundled catalog (`resources/jsonData/catalog.json`) is only the fallback
for the very first start without a phone; after one successful sync the watch
uses its cached copy from the server.

## Install (sideload)

Connect the watch by USB and copy `angles.prg` to `GARMIN\APPS`. Replace the
file to update. Saved holds and progress are kept across updates.

## Files

| File | Purpose |
|---|---|
| `source/AnglesApp.mc` | App entry, catalog loading, sync with `/api/watch`. |
| `source/ScrollList.mc` | Shared full-screen list (focus row in the middle) + button delegate. |
| `source/HoldsView.mc` | Holds screen, its actions and reset confirmations. |
| `source/Progress.mc` | Ordered cut list, saved cut marks, missed detection. |
| `source/BigView.mc` | BIG MODE screen and buttons. |
| `source/AnglesView.mc` | Colored LIST view. |
| `tools/build-catalog.mjs` | Writes the bundled catalog from `/api/state`. |
