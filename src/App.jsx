import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * PROTOTYPE (no backend)
 * - Holds + angles stored in localStorage
 * - Two tables: MAIN + STEFAN
 * - Viewer shows uploaded drawings (angle drawing) and HOLD cover (fallback)
 * - Admin page: /#/admin
 * - UI simplified: no transitions/animations
 *
 * v0.9
 * - Debounced localStorage writes (perf + race fix)
 * - ObjectURL cleanup hardened (leak fix)
 * - useCallback on handlers (perf)
 * - Backup ring before import (data safety)
 * - iOS focus fix (setTimeout instead of rAF)
 * - Admin: SHA-256 hash stored in localStorage (no hardcoded password after first login)
 */

const APP_VERSION = "0.9";

const DEFAULT_HOLDS = [
    "Anton", "Austin", "Amon", "Asteca", "Avalon", "Avalon Flat", "Avalon SuperFlat",
    "Base 10", "Base 15", "Base Zero", "Boomerang", "Chava", "Circo", "Classica",
    "Concord", "Crack", "Crack Midle", "Crack ending 30", "Crack ending 45",
    "Cuneo", "Cuneo Lungo", "Delta", "Etna", "Flat 80", "Flat 90", "Fratelli",
    "French fries", "Fresco 10", "Fresco 20", "Fresco 30", "Fuji", "Gamma 3",
    "Gamma 3 (Large)", "Gamma 4", "Gamma 4 (30)", "Gamma 4 (Large)",
    "Gamma 4 (40)", "Gobba", "Gradino", "Half Chava", "Half Circo", "Half Lancia",
    "Inca", "Katla", "Lancia", "Lancia Flat", "Leon", "Lipari", "Mago (Large)",
    "Mago - set A", "Mago - set B", 'Mago medium "A"', 'Mago medium "B"',
    "Parapetto 60", "Parapetto 70", "Parapetto 80", "Rampa", "Rampa wide",
    "Rumba High", "Rumba Low", "Salina", "Samba", "Sparo", "Sparo Super Flat",
    "Sparo Flat", "Splash", "Square", "Square Flat", "Square SuperFlat",
    "Tufa", "Ustica", "WI-FI 70", "WI-FI 80",
];

const LS_KEY = "angles_proto_v1";
const LS_VERSION = 1;
const LS_LAST_MODIFIED_KEY = "angles_proto_v1_lastModified";

// backups
const LS_BACKUPS_KEY = `${LS_KEY}_backups`;
const MAX_BACKUPS = 5;

// admin auth
const ADMIN_HASH_KEY = `${LS_KEY}_admin_hash`; // sha256 hex

function cryptoRandomId() {
    try {
        return globalThis.crypto?.randomUUID?.() ?? `id_${Math.random().toString(16).slice(2)}`;
    } catch {
        return `id_${Math.random().toString(16).slice(2)}`;
    }
}

const DEFAULT_ANGLES = [
    { id: cryptoRandomId(), hold: "Austin", value: 28.2, saw: "main" },
    { id: cryptoRandomId(), hold: "Avalon Flat", value: 65.0, saw: "main" },
    { id: cryptoRandomId(), hold: "Austin", value: 65.3, saw: "main" },
    { id: cryptoRandomId(), hold: "Avalon SuperFlat", value: 30.0, saw: "stefan" },
    { id: cryptoRandomId(), hold: "Amon", value: 50.0, saw: "stefan" },
];

function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
}

function toAngleLabel(n) {
    const isInt = Math.abs(Number(n) - Math.round(Number(n))) < 1e-9;
    return isInt ? `${Math.round(Number(n))}°` : `${Number(n).toFixed(1)}°`;
}

function sortHolds(holds) {
    return [...holds].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/* -------------------- tiny debounce hook (P0) -------------------- */
function useDebounce(value, delay) {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(t);
    }, [value, delay]);
    return debounced;
}

/* -------------------- STORAGE: migration + sanitize -------------------- */

function normalizeHoldNameSafe(s) {
    return String(s || "").trim().replace(/\s+/g, " ");
}

function sanitizeHoldList(holds) {
    const arr = Array.isArray(holds) ? holds : [];
    const cleaned = arr.map(normalizeHoldNameSafe).filter(Boolean);

    const seen = new Set();
    const unique = [];
    for (const h of cleaned) {
        const key = h.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(h);
    }
    return sortHolds(unique);
}

function sanitizeAngle(a, holdsSet) {
    const hold = normalizeHoldNameSafe(a?.hold);
    const saw = a?.saw === "stefan" ? "stefan" : "main";

    const raw = a?.value;
    const num = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(",", "."));
    const value = Number.isFinite(num) ? clamp(num, 0, 90) : 0;

    const id = typeof a?.id === "string" && a.id.trim() ? a.id : cryptoRandomId();

    const drawing =
        typeof a?.drawing === "string" && a.drawing.startsWith("data:image/") ? a.drawing : undefined;

    if (!hold || !holdsSet.has(hold)) return null;

    return { id, hold, value, saw, ...(drawing ? { drawing } : {}) };
}

/** Accepts raw db OR wrapper: { data: { holds, angles, holdImages } } */
function unwrapImportedDb(parsed) {
    if (!parsed || typeof parsed !== "object") return parsed;
    if (parsed.data && typeof parsed.data === "object") return parsed.data;
    return parsed;
}

function migrateAndSanitize(parsed) {
    const unwrapped = unwrapImportedDb(parsed);

    const holds = sanitizeHoldList(unwrapped?.holds ?? DEFAULT_HOLDS);
    const holdsSet = new Set(holds);

    const anglesRaw = Array.isArray(unwrapped?.angles) ? unwrapped.angles : DEFAULT_ANGLES;

    const angles = [];
    const ids = new Set();

    for (const a of anglesRaw) {
        const sa = sanitizeAngle(a, holdsSet);
        if (!sa) continue;
        if (ids.has(sa.id)) sa.id = cryptoRandomId();
        ids.add(sa.id);
        angles.push(sa);
    }

    const rawHoldImages =
        unwrapped?.holdImages && typeof unwrapped.holdImages === "object" ? unwrapped.holdImages : {};
    const holdImages = {};
    for (const h of holds) {
        const v = rawHoldImages[h];
        if (typeof v === "string" && v.startsWith("data:image/")) {
            holdImages[h] = v;
        }
    }

    return { version: LS_VERSION, holds, angles, holdImages };
}

function ensureLastModifiedExists() {
    try {
        const v = localStorage.getItem(LS_LAST_MODIFIED_KEY);
        if (!v) localStorage.setItem(LS_LAST_MODIFIED_KEY, String(Date.now()));
    } catch { }
}

function touchLastModified() {
    try {
        localStorage.setItem(LS_LAST_MODIFIED_KEY, String(Date.now()));
    } catch { }
}

function loadLastModified() {
    try {
        const v = localStorage.getItem(LS_LAST_MODIFIED_KEY);
        return v ? Number(v) : null;
    } catch {
        return null;
    }
}

function loadState() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) {
            const init = migrateAndSanitize({
                version: LS_VERSION,
                holds: DEFAULT_HOLDS,
                angles: DEFAULT_ANGLES,
                holdImages: {},
            });
            localStorage.setItem(LS_KEY, JSON.stringify(init));
            localStorage.setItem(LS_LAST_MODIFIED_KEY, String(Date.now()));
            return init;
        }

        const parsed = JSON.parse(raw);
        const next = migrateAndSanitize(parsed);

        localStorage.setItem(LS_KEY, JSON.stringify(next));
        ensureLastModifiedExists();
        return next;
    } catch {
        const fallback = migrateAndSanitize({
            version: LS_VERSION,
            holds: DEFAULT_HOLDS,
            angles: DEFAULT_ANGLES,
            holdImages: {},
        });
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(fallback));
            localStorage.setItem(LS_LAST_MODIFIED_KEY, String(Date.now()));
        } catch { }
        return fallback;
    }
}

function saveState(next) {
    try {
        const safe = migrateAndSanitize(next);
        localStorage.setItem(LS_KEY, JSON.stringify(safe));
        touchLastModified();
    } catch (err) {
        if (err?.name === "QuotaExceededError" || err?.code === 22) {
            console.warn("Storage full: image not saved. Use smaller images or remove some drawings.");
            alert("Storage full. Remove some drawings or upload smaller images.");
        }
    }
}

/* -------------------- backups ring (P1) -------------------- */
function pushBackup(snapshot) {
    try {
        const raw = localStorage.getItem(LS_BACKUPS_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        const next = [{ ts: Date.now(), data: snapshot }, ...(Array.isArray(arr) ? arr : [])].slice(0, MAX_BACKUPS);
        localStorage.setItem(LS_BACKUPS_KEY, JSON.stringify(next));
    } catch (e) {
        console.warn("Backup failed:", e);
    }
}

/** Resize/compress image to reduce localStorage size. Returns data URL (jpeg). */
function compressImageFile(file, maxSize = 800, quality = 0.82) {
    return new Promise((resolve, reject) => {
        if (!file?.type?.startsWith("image/")) {
            reject(new Error("Not an image"));
            return;
        }

        const img = new Image();
        const url = URL.createObjectURL(file);

        let done = false;
        const finish = (fn) => (arg) => {
            if (done) return;
            done = true;
            try {
                URL.revokeObjectURL(url);
            } finally {
                fn(arg);
            }
        };

        img.onload = finish(() => {
            const w = img.naturalWidth;
            const h = img.naturalHeight;
            let dw = w, dh = h;

            if (w > maxSize || h > maxSize) {
                if (w >= h) {
                    dw = maxSize;
                    dh = Math.round((h * maxSize) / w);
                } else {
                    dh = maxSize;
                    dw = Math.round((w * maxSize) / h);
                }
            }

            const canvas = document.createElement("canvas");
            canvas.width = dw;
            canvas.height = dh;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
                reject(new Error("No canvas context"));
                return;
            }
            ctx.drawImage(img, 0, 0, dw, dh);
            try {
                resolve(canvas.toDataURL("image/jpeg", quality));
            } catch (e) {
                reject(e);
            }
        });

        img.onerror = finish(() => {
            reject(new Error("Failed to load image"));
        });

        img.src = url;
    });
}

function useHashRoute() {
    const [hash, setHash] = useState(() => window.location.hash || "#/");
    useEffect(() => {
        const onHash = () => setHash(window.location.hash || "#/");
        window.addEventListener("hashchange", onHash);
        return () => window.removeEventListener("hashchange", onHash);
    }, []);
    return hash.replace("#", "");
}

/* -------------------- EXPORT / IMPORT DB -------------------- */

function downloadJsonFile(obj, filename = "angles-db.json") {
    const safe = migrateAndSanitize(obj);
    const payload = {
        app: "AnglesProto",
        exportedAt: new Date().toISOString(),
        version: LS_VERSION,
        data: safe,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

async function readJsonFile(file) {
    const text = await file.text();
    return JSON.parse(text);
}

function formatLastModified(ms) {
    if (!ms || !Number.isFinite(ms)) return "—";
    try {
        const d = new Date(ms);
        return d.toLocaleString(undefined, {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return "—";
    }
}

/* -------------------- crypto: sha256 hex (P1) -------------------- */
async function sha256Hex(text) {
    const enc = new TextEncoder();
    const bytes = enc.encode(String(text ?? ""));
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ===================== SORT ICON ===================== */
function SortIcon({ direction }) {
    if (direction === "asc") {
        return (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <path d="M6 2L9 7H3L6 2Z" />
            </svg>
        );
    }
    if (direction === "desc") {
        return (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <path d="M6 10L3 5H9L6 10Z" />
            </svg>
        );
    }
    return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" opacity="0.3">
            <path d="M6 2L8 5H4L6 2Z M6 10L4 7H8L6 10Z" />
        </svg>
    );
}

/* ===================== APP ===================== */

const theme = {
    colors: {
        background: '#fafafa',
        cardBg: '#ffffff',
        textPrimary: '#1a1a1a',
        textSecondary: '#666666',
        textTertiary: '#888888',
        textMuted: '#999999',
        textLight: '#aaaaaa',
        border: '#e8e8e8',
        borderLight: '#eeeeee',
        borderMedium: '#e0e0e0',
        borderDark: '#dddddd',
        hoverBg: '#f6f6f6',
        activeBg: '#f5f5f5',
        inputBg: '#ffffff',
        buttonPrimaryBg: '#1a1a1a',
        buttonPrimaryText: '#ffffff',
        buttonPrimaryBorder: '#1a1a1a',
        buttonGhostBg: '#ffffff',
        buttonGhostText: '#1a1a1a',
        buttonGhostBorder: '#dddddd',
        viewerEmptyBg: '#fafafa',
        viewerEmptyBorder: '#e0e0e0',
        adminPageBg: '#fafafa',
    },
};

export default function App() {
    const route = useHashRoute();
    const [data, setData] = useState(() => loadState());
    const [selectedHolds, setSelectedHolds] = useState(() => new Set());
    const [activeAngleId, setActiveAngleId] = useState(null);
    const [zoomedImage, setZoomedImage] = useState(null);
    const [lastModifiedMs, setLastModifiedMs] = useState(() => loadLastModified());

    const [mainSort, setMainSort] = useState("asc");
    const [stefanSort, setStefanSort] = useState("asc");

    const [holdSearch, setHoldSearch] = useState("");
    const searchRef = useRef(null);

    // P0: debounce localStorage writes
    const debouncedData = useDebounce(data, 500);
    useEffect(() => {
        saveState(debouncedData);
        setLastModifiedMs(loadLastModified());
    }, [debouncedData]);

    useEffect(() => {
        if (activeAngleId && !data.angles.some((a) => a.id === activeAngleId)) {
            setActiveAngleId(null);
        }
    }, [data.angles, activeAngleId]);

    const sortedHolds = useMemo(() => sortHolds(data.holds || []), [data.holds]);

    const visibleHolds = useMemo(() => {
        const q = holdSearch.trim().toLowerCase();
        if (!q) return sortedHolds;
        return sortedHolds.filter((name) => String(name).toLowerCase().includes(q));
    }, [sortedHolds, holdSearch]);

    const selectedAngles = useMemo(() => {
        const holdsSet = selectedHolds;
        const all = data.angles.filter((a) => holdsSet.has(a.hold));

        let main = all.filter((a) => a.saw === "main");
        if (mainSort === "asc") {
            main = main.slice().sort((x, y) => Number(x.value) - Number(y.value) || x.hold.localeCompare(y.hold));
        } else {
            main = main.slice().sort((x, y) => Number(y.value) - Number(x.value) || x.hold.localeCompare(y.hold));
        }

        let stefan = all.filter((a) => a.saw === "stefan");
        if (stefanSort === "asc") {
            stefan = stefan.slice().sort((x, y) => Number(x.value) - Number(y.value) || x.hold.localeCompare(y.hold));
        } else {
            stefan = stefan.slice().sort((x, y) => Number(y.value) - Number(x.value) || x.hold.localeCompare(y.hold));
        }

        return { main, stefan };
    }, [data.angles, selectedHolds, mainSort, stefanSort]);

    const activeAngle = useMemo(
        () => data.angles.find((a) => a.id === activeAngleId) || null,
        [data.angles, activeAngleId]
    );

    const viewerSrc = useMemo(() => {
        if (activeAngle?.drawing) return activeAngle.drawing;

        if (selectedHolds.size === 1) {
            const hold = Array.from(selectedHolds)[0];
            const cover = data?.holdImages?.[hold];
            if (cover) return cover;
        }
        return null;
    }, [activeAngle, selectedHolds, data?.holdImages]);

    // P1: useCallback handlers
    const toggleHold = useCallback((name) => {
        setSelectedHolds((prev) => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });
    }, []);

    const clearSelection = useCallback(() => {
        setSelectedHolds(new Set());
        setActiveAngleId(null);
    }, []);

    const cycleSortMain = useCallback(() => {
        setMainSort((prev) => (prev === "asc" ? "desc" : "asc"));
    }, []);

    const cycleSortStefan = useCallback(() => {
        setStefanSort((prev) => (prev === "asc" ? "desc" : "asc"));
    }, []);

    const styles = useMemo(() => getStyles(theme), []);

    if (route === "/admin") {
        return (
            <AdminPage
                data={data}
                setData={setData}
                onExit={() => (window.location.hash = "#/")}
                lastModifiedMs={lastModifiedMs}
            />
        );
    }

    return (
        <div style={styles.page} className="app-page">
            <style>{`
        @media print {
          html, body, .app-page {
            height: auto !important;
            min-height: 0 !important;
            overflow: visible !important;
          }
          [data-print-hide] { display: none !important; }
          .main-grid {
            display: grid !important;
            grid-template-columns: 1fr 1fr !important;
            grid-template-rows: auto !important;
            gap: 2px !important;
            height: auto !important;
            padding: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            align-items: start !important;
          }
          .main-grid > * {
            min-width: 0 !important;
          }
          .main-grid > :nth-child(1) { display: none !important; }
          .main-grid > :nth-child(2) { display: block !important; grid-column: 1 !important; grid-row: 1 !important; }
          .main-grid > :nth-child(3) { display: block !important; grid-column: 2 !important; grid-row: 1 !important; }
          .main-grid > :nth-child(4) { display: none !important; }
          .main-grid .card { 
            break-inside: auto !important;
            border: none !important;
            box-shadow: none !important;
            overflow: visible !important;
            display: block !important;
          }
          .print-table-container {
            display: block !important;
            overflow: visible !important;
            gap: 0 !important;
          }
          .print-table-row {
            border: none !important;
            padding: 0 !important;
            background: transparent !important;
            margin-bottom: 2px !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          .print-header {
            margin-bottom: 2px !important;
          }
          button { all: unset; }
          
          /* Ensure hidden elements stay hidden (override earlier display: block) */
          [data-print-hide], .main-grid > :nth-child(1), .main-grid > :nth-child(4) {
             display: none !important;
          }
        }
        
        @media screen and (max-width: 1200px) {
          .main-grid {
            grid-template-columns: 180px 1fr 1fr !important;
            grid-template-rows: auto 1fr !important;
          }
          .main-grid > :nth-child(1) {
            grid-row: 1 / 3;
          }
          .main-grid > :nth-child(4) {
            grid-column: 2 / 4;
            grid-row: 2;
          }
        }

        /* MOBILE ADAPTATION START */
        @media screen and (max-width: 900px) {
          html, body, #root {
            height: auto !important;
            min-height: 100vh !important;
            overflow: visible !important;
            display: block !important;
            padding: 0 !important; /* Remove root padding from App.css */
            max-width: 100% !important; /* Override max-width constraint */
          }
          .app-page {
            height: auto !important;
            min-height: 100vh !important;
            overflow: visible !important;
            padding: 12px !important;
          }

          .main-grid {
            display: flex !important;
            flex-direction: column !important;
            height: auto !important;
            min-height: 0 !important;
            gap: 16px !important;
          }
          
          .main-grid > * {
            grid-column: auto !important;
            grid-row: auto !important;
            width: 100% !important;
          }

          .card {
            height: auto !important;
            min-height: 0 !important;
            flex: none !important;
            overflow: visible !important;
            padding: 0 !important; /* Remove card padding from App.css to use cardBody padding */
          }
          
          .holdsList {
             max-height: 30vh !important;
          }
          
          .table {
            max-height: 40vh !important;
            overflow-y: auto !important;
          }

          /* Touch targets */
          button, input, [role="button"] {
            min-height: 44px;
            touch-action: manipulation;
          }
          
          input { font-size: 16px !important; }
        }
        /* MOBILE ADAPTATION END */
        
        button:focus { outline: none; }
        button:focus-visible { outline: none; }
      `}</style>

            <div style={styles.grid} className="main-grid">
                {/* Left: holds */}
                <Card data-print-hide style={styles.card}>
                    <div style={styles.cardBody}>
                        <div style={styles.searchWrap}>
                            <div
                                style={styles.searchPill}
                                role="search"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    searchRef.current?.focus();
                                }}
                            >
                                <input
                                    ref={searchRef}
                                    value={holdSearch}
                                    onChange={(e) => setHoldSearch(e.target.value)}
                                    placeholder="Search..."
                                    style={styles.searchInput}
                                />
                                <span style={styles.searchIconWrap} aria-hidden="true">
                                    <SearchIcon />
                                </span>
                            </div>
                        </div>

                        <div style={styles.holdsList}>
                            {visibleHolds.map((name) => (
                                <label key={name} style={styles.holdRow}>
                                    <input
                                        type="checkbox"
                                        checked={selectedHolds.has(name)}
                                        onChange={() => toggleHold(name)}
                                        style={styles.checkbox}
                                    />
                                    <span style={styles.holdName}>{name}</span>
                                </label>
                            ))}
                        </div>

                        <div style={styles.footerRow}>
                            <button
                                type="button"
                                onClick={() => window.print()}
                                title="Print MAIN and STEFAN tables"
                                aria-label="Print"
                                data-print-hide
                                style={{
                                    ...styles.btnGhost,
                                    width: 36,
                                    height: 36,
                                    padding: 0,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flex: "0 0 auto",
                                }}
                            >
                                <PrinterIcon />
                            </button>



                            <button
                                type="button"
                                style={{ ...styles.btnGhost, ...styles.footerBtn }}
                                onClick={() => (window.location.hash = "#/admin")}
                            >
                                admin
                            </button>

                            <button
                                type="button"
                                style={{ ...styles.btnDanger, ...styles.footerBtn }}
                                onClick={clearSelection}
                            >
                                clear
                            </button>
                        </div>
                    </div>
                </Card>

                {/* Main table */}
                <Card style={styles.card}>
                    <div style={styles.tableBody}>
                        <div style={styles.tableHeader} className="print-header">
                            <div style={styles.tableTitleCenter}>MAIN</div>
                            <button
                                type="button"
                                onClick={cycleSortMain}
                                onMouseDown={(e) => e.preventDefault()}
                                style={styles.sortButton}
                                title="Sort by angle"
                                aria-label="Sort MAIN table"
                                data-print-hide
                            >
                                <SortIcon direction={mainSort} />
                            </button>
                        </div>
                        <AngleTable styles={styles} rows={selectedAngles.main} onPick={setActiveAngleId} />
                    </div>
                </Card>

                {/* Stefan table */}
                <Card style={styles.card}>
                    <div style={styles.tableBody}>
                        <div style={styles.tableHeader} className="print-header">
                            <div style={styles.tableTitleCenter}>STEFAN</div>
                            <button
                                type="button"
                                onClick={cycleSortStefan}
                                onMouseDown={(e) => e.preventDefault()}
                                style={styles.sortButton}
                                title="Sort by angle"
                                aria-label="Sort STEFAN table"
                                data-print-hide
                            >
                                <SortIcon direction={stefanSort} />
                            </button>
                        </div>
                        <AngleTable styles={styles} rows={selectedAngles.stefan} onPick={setActiveAngleId} />
                    </div>
                </Card>

                {/* Viewer */}
                <Card data-print-hide style={styles.card}>
                    <div style={styles.viewerWrap}>
                        {viewerSrc ? (
                            <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
                                <img src={viewerSrc} alt="drawing" style={styles.viewerImg} draggable={false} />
                                <button
                                    onClick={() => setZoomedImage(viewerSrc)}
                                    style={styles.zoomBtn}
                                    title="Zoom image"
                                >
                                    <ZoomIcon />
                                </button>
                            </div>
                        ) : (
                            <div style={styles.viewerEmpty}>
                                <div style={{ fontSize: 12, color: theme.colors.textMuted }}>no drawing uploaded</div>
                            </div>
                        )}
                    </div>
                </Card>
            </div>

            {/* Zoom Overlay */}
            {zoomedImage && (
                <div
                    style={styles.zoomOverlay}
                    onClick={() => setZoomedImage(null)}
                >
                    <img
                        src={zoomedImage}
                        alt="Zoomed"
                        style={styles.zoomImage}
                        onClick={(e) => e.stopPropagation()}
                    />
                    <button
                        onClick={() => setZoomedImage(null)}
                        style={styles.zoomCloseBtn}
                    >
                        ×
                    </button>
                </div>
            )}
        </div>
    );
}

function SearchIcon() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            style={{ opacity: 0.75, flex: "0 0 auto" }}
        >
            <path d="M10 4a6 6 0 104.472 10.06l4.234 4.234 1.414-1.414-4.234-4.234A6 6 0 0010 4zm0 2a4 4 0 110 8 4 4 0 010-8z" />
        </svg>
    );
}

function PrinterIcon() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ display: "block" }}
        >
            <polyline points="6 9 6 2 18 2 18 9" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" />
        </svg>
    );
}

function ZoomIcon() {
    return (
        <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ display: "block" }}
        >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
    );
}

function AngleTable({ rows, onPick, styles }) {
    return (
        <div style={styles.table} className="print-table-container">
            {rows.map((r) => (
                <button key={r.id} onClick={() => onPick(r.id)} style={styles.tableRow} className="print-table-row">
                    <span style={styles.angleCell}>{toAngleLabel(r.value)}</span>
                    <span style={styles.nameCell}>{r.hold}</span>
                </button>
            ))}
            {rows.length === 0 ? <div style={styles.tableEmpty} /> : null}
        </div>
    );
}

/* ===================== ADMIN ===================== */

function AdminPage({ data, setData, onExit, lastModifiedMs }) {
    const styles = useMemo(() => getStyles(theme), []);
    const [authed, setAuthed] = useState(false);
    const [login, setLogin] = useState("admin");
    const [password, setPassword] = useState("");

    const holdsSafe = useMemo(() => sortHolds(Array.isArray(data?.holds) ? data.holds : []), [data?.holds]);
    const anglesSafe = Array.isArray(data?.angles) ? data.angles : [];

    const [selectedProduct, setSelectedProduct] = useState(null);
    const [newHoldName, setNewHoldName] = useState("");
    const [editingHold, setEditingHold] = useState(null);
    const [editingHoldName, setEditingHoldName] = useState("");
    const [selectedAngleId, setSelectedAngleId] = useState(null);

    const [adminHoldSearch, setAdminHoldSearch] = useState("");
    const adminSearchRef = useRef(null);

    const visibleAdminHolds = useMemo(() => {
        const q = adminHoldSearch.trim().toLowerCase();
        if (!q) return holdsSafe;
        return holdsSafe.filter((name) => String(name).toLowerCase().includes(q));
    }, [holdsSafe, adminHoldSearch]);

    const fileInputRef = useRef(null);
    const uploadTargetIdRef = useRef(null);
    const importDbInputRef = useRef(null);
    const holdCoverInputRef = useRef(null);
    const uploadHoldNameRef = useRef(null);

    const normalizeHoldName = (s) => String(s || "").trim().replace(/\s+/g, " ");

    useEffect(() => {
        if (selectedProduct && !holdsSafe.includes(selectedProduct)) setSelectedProduct(null);
    }, [holdsSafe, selectedProduct]);

    useEffect(() => {
        if (selectedAngleId && !anglesSafe.some((a) => a.id === selectedAngleId)) setSelectedAngleId(null);
    }, [anglesSafe, selectedAngleId]);

    // P1: no hardcoded password after first login
    const doLogin = useCallback(async () => {
        const storedHash = (() => {
            try { return localStorage.getItem(ADMIN_HASH_KEY); } catch { return null; }
        })();

        // first-time bootstrap: allow admin/admin and store hash
        if (!storedHash) {
            if (login === "admin" && password === "admin") {
                try {
                    const h = await sha256Hex(password);
                    localStorage.setItem(ADMIN_HASH_KEY, h);
                } catch { }
                setAuthed(true);
                return;
            }
            alert("First login: use admin/admin (once) to set password hash.");
            return;
        }

        const hash = await sha256Hex(password);
        if (login === "admin" && hash === storedHash) {
            setAuthed(true);
        } else {
            alert("Wrong credentials");
        }
    }, [login, password]);

    const addHold = useCallback(() => {
        const name = normalizeHoldName(newHoldName);
        if (!name) return;
        setData((prev) => {
            const prevHolds = Array.isArray(prev.holds) ? prev.holds : [];
            if (prevHolds.some((h) => String(h).toLowerCase() === name.toLowerCase())) return prev;
            return { ...prev, holds: sortHolds([...prevHolds, name]) };
        });
        setNewHoldName("");
        setSelectedProduct(name);
    }, [newHoldName, setData]);

    const confirmRemoveHold = useCallback((nameToRemove) => {
        const cnt = anglesSafe.filter((a) => a.hold === nameToRemove).length;
        if (!window.confirm(cnt > 0 ? `Delete "${nameToRemove}" and ${cnt} angle(s)?` : `Delete "${nameToRemove}"?`)) return;

        setData((prev) => {
            const nextHoldImages = { ...(prev.holdImages || {}) };
            delete nextHoldImages[nameToRemove];

            return {
                ...prev,
                holds: sortHolds((prev.holds || []).filter((h) => h !== nameToRemove)),
                angles: (prev.angles || []).filter((a) => a.hold !== nameToRemove),
                holdImages: nextHoldImages,
            };
        });

        if (selectedProduct === nameToRemove) setSelectedProduct(null);
        if (editingHold === nameToRemove) setEditingHold(null);
    }, [anglesSafe, editingHold, selectedProduct, setData]);

    const startRenameHold = useCallback((h) => {
        setEditingHold(h);
        setEditingHoldName(h);
    }, []);

    const cancelRenameHold = useCallback(() => {
        setEditingHold(null);
        setEditingHoldName("");
    }, []);

    const saveRenameHold = useCallback((oldName) => {
        const nextName = normalizeHoldName(editingHoldName);
        if (!nextName) return;

        if (
            nextName.toLowerCase() !== oldName.toLowerCase() &&
            holdsSafe.some((h) => String(h).toLowerCase() === nextName.toLowerCase())
        ) return;

        setData((prev) => {
            const nextHoldImages = { ...(prev.holdImages || {}) };
            if (nextHoldImages[oldName]) {
                nextHoldImages[nextName] = nextHoldImages[oldName];
                delete nextHoldImages[oldName];
            }

            return {
                ...prev,
                holds: sortHolds((prev.holds || []).map((h) => (h === oldName ? nextName : h))),
                angles: (prev.angles || []).map((a) => (a.hold === oldName ? { ...a, hold: nextName } : a)),
                holdImages: nextHoldImages,
            };
        });

        setEditingHold(null);
        if (selectedProduct === oldName) setSelectedProduct(nextName);
    }, [editingHoldName, holdsSafe, selectedProduct, setData]);

    const addAngleForHold = useCallback((holdName, saw) => {
        setData((prev) => ({
            ...prev,
            angles: [...(prev.angles || []), { id: cryptoRandomId(), hold: holdName, value: 0, saw }],
        }));
        setSelectedProduct(holdName);
    }, [setData]);

    const updateAngle = useCallback((id, patch) => {
        setData((prev) => ({
            ...prev,
            angles: (prev.angles || []).map((a) => (a.id === id ? { ...a, ...patch } : a)),
        }));
    }, [setData]);

    const removeAngle = useCallback((id) => {
        if (!window.confirm("Delete this angle?")) return;
        setData((prev) => ({
            ...prev,
            angles: (prev.angles || []).filter((a) => a.id !== id),
        }));
        if (selectedAngleId === id) setSelectedAngleId(null);
    }, [selectedAngleId, setData]);

    const handleDrawingUpload = useCallback((e) => {
        const file = e.target.files?.[0];
        const angleId = uploadTargetIdRef.current;
        e.target.value = "";
        if (!file || !angleId) return;
        uploadTargetIdRef.current = null;

        compressImageFile(file)
            .then((dataUrl) => updateAngle(angleId, { drawing: dataUrl }))
            .catch(() => { });
    }, [updateAngle]);

    const handleHoldCoverUpload = useCallback((e) => {
        const file = e.target.files?.[0];
        const holdName = uploadHoldNameRef.current;
        e.target.value = "";
        uploadHoldNameRef.current = null;
        if (!file || !holdName) return;

        compressImageFile(file, 900, 0.85)
            .then((dataUrl) => {
                setData((prev) => ({
                    ...prev,
                    holdImages: {
                        ...(prev.holdImages || {}),
                        [holdName]: dataUrl,
                    },
                }));
            })
            .catch(() => { });
    }, [setData]);

    const removeHoldCover = useCallback((holdName) => {
        if (!window.confirm("Remove hold cover image?")) return;
        setData((prev) => {
            const next = { ...(prev.holdImages || {}) };
            delete next[holdName];
            return { ...prev, holdImages: next };
        });
    }, [setData]);

    const exportDb = useCallback(() => {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const dd = String(now.getDate()).padStart(2, "0");
        const hh = String(now.getHours()).padStart(2, "0");
        const min = String(now.getMinutes()).padStart(2, "0");
        const filename = `Base_${yyyy}-${mm}-${dd}_${hh}-${min}.json`;
        downloadJsonFile(data, filename);
    }, [data]);
    const triggerImportDb = useCallback(() => importDbInputRef.current?.click(), []);

    const handleImportDb = useCallback(async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;

        try {
            const parsed = await readJsonFile(file);
            const safe = migrateAndSanitize(parsed);
            if (!safe.holds?.length) {
                alert("Import failed: no holds found.");
                return;
            }

            // P1: backup before import
            pushBackup(data);

            setData(safe);
            setSelectedProduct(null);
            setSelectedAngleId(null);
            touchLastModified();
            alert("DB imported ✅");
        } catch (err) {
            console.warn(err);
            alert("Import failed: invalid JSON.");
        }
    }, [data, setData]);

    const anglesByHold = useMemo(() => {
        const map = new Map();
        holdsSafe.forEach((h) => map.set(h, []));
        anglesSafe.forEach((a) => {
            if (map.has(a.hold)) map.get(a.hold).push(a);
        });
        map.forEach((arr) =>
            arr.sort((x, y) => String(x.saw).localeCompare(String(y.saw)) || Number(x.value) - Number(y.value))
        );
        return map;
    }, [holdsSafe, anglesSafe]);

    const mainAngles = useMemo(
        () => (selectedProduct ? (anglesByHold.get(selectedProduct) || []).filter((a) => a.saw === "main") : []),
        [selectedProduct, anglesByHold]
    );
    const stefanAngles = useMemo(
        () => (selectedProduct ? (anglesByHold.get(selectedProduct) || []).filter((a) => a.saw === "stefan") : []),
        [selectedProduct, anglesByHold]
    );

    if (!authed) {
        return (
            <div style={styles.page}>
                <div style={{ ...styles.adminGrid, maxWidth: 400, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Card style={{ ...styles.card, width: "100%", maxWidth: 320 }}>
                        <div style={{ ...styles.cardBody, alignItems: "center", justifyContent: "center", gap: 16, padding: 32 }}>
                            <div style={{ ...styles.adminTitle, marginBottom: 0 }}>admin</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
                                <input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="login" style={{ ...styles.input, textAlign: "center" }} />
                                <input
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="password"
                                    type="password"
                                    style={{ ...styles.input, textAlign: "center" }}
                                />
                                <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 8 }}>
                                    <button style={{ ...styles.btnPrimary, minWidth: 60 }} onClick={doLogin}>ok</button>
                                    <button style={styles.btnGhost} onClick={onExit}>back</button>
                                </div>
                            </div>
                        </div>
                    </Card>
                </div>
            </div>
        );
    }

    const selectedCover = selectedProduct ? (data?.holdImages?.[selectedProduct] || null) : null;

    return (
        <div style={styles.adminPage} className="admin-page-wrapper">
            <style>{`
        @media (max-width: 1200px) {
          .admin-grid-container {
            grid-template-columns: 200px 1fr 1fr !important;
            grid-template-rows: auto auto !important;
          }
          .admin-grid-container > :nth-child(1) {
            grid-row: 1 / 3;
          }
          .admin-grid-container > :nth-child(2) {
            grid-column: 2 / 4;
          }
        }

        /* MOBILE ADAPTATION START */
        @media (max-width: 900px) {
          html, body, #root {
            height: auto !important;
            min-height: 100vh !important;
            overflow: visible !important;
            display: block !important;
          }

          .admin-page-wrapper {
            height: auto !important;
            min-height: 100vh !important;
            overflow: visible !important;
            padding: 12px !important;
          }
          
          .admin-grid-container {
            display: flex !important;
            flex-direction: column !important;
            height: auto !important;
            min-height: 0 !important;
            gap: 16px !important;
          }

          .admin-grid-container > * {
            grid-column: auto !important;
            grid-row: auto !important;
            width: 100% !important;
          }
          
          .card {
            height: auto !important;
            min-height: 0 !important;
          }

          .holdsList {
            max-height: 30vh !important;
          }
          
          .table {
            max-height: 40vh !important;
            overflow-y: auto !important;
          }
          
          input, button {
            min-height: 44px;
          }
          input {
            font-size: 16px !important;
          }
          
          .adminAngleRow {
            padding: 10px 0 !important;
          }
        }
        /* MOBILE ADAPTATION END */
        
        button:focus { outline: none; }
        button:focus-visible { outline: none; }
        button::-moz-focus-inner { border: 0; }
      `}</style>

            <div style={styles.adminGrid} className="admin-grid-container">
                {/* Left: holds list */}
                <Card style={styles.card}>
                    <div style={styles.cardBody}>
                        <div style={styles.searchWrap}>
                            <div
                                style={styles.searchPill}
                                role="search"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    adminSearchRef.current?.focus();
                                }}
                            >
                                <input
                                    ref={adminSearchRef}
                                    value={adminHoldSearch}
                                    onChange={(e) => setAdminHoldSearch(e.target.value)}
                                    placeholder="Search..."
                                    style={styles.searchInput}
                                />
                                <span style={styles.searchIconWrap} aria-hidden="true">
                                    <SearchIcon />
                                </span>
                            </div>
                        </div>

                        <div style={styles.holdsList}>
                            {visibleAdminHolds.map((name) => (
                                <button
                                    key={name}
                                    type="button"
                                    onClick={() => setSelectedProduct(name)}
                                    onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
                                    style={{ ...styles.holdRowBtn, ...(selectedProduct === name ? styles.holdRowBtnActive : null) }}
                                >
                                    <span style={styles.holdName}>{name}</span>
                                </button>
                            ))}
                        </div>

                        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleDrawingUpload} />
                        <input ref={importDbInputRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={handleImportDb} />
                        <input ref={holdCoverInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleHoldCoverUpload} />

                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={styles.footerRow}>
                                <button style={styles.btnGhost} onClick={onExit}>back</button>
                                <input
                                    value={newHoldName}
                                    onChange={(e) => setNewHoldName(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && addHold()}
                                    placeholder="new"
                                    style={{ ...styles.input, flex: 1, minWidth: 0, padding: "6px 8px" }}
                                />
                                <button style={styles.btnPrimary} onClick={addHold}>+</button>
                            </div>

                            <div style={{ display: "flex", gap: 8 }}>
                                <button style={{ ...styles.btnGhost, flex: 1 }} onClick={exportDb}>Export</button>
                                <button style={{ ...styles.btnGhost, flex: 1 }} onClick={triggerImportDb}>Import</button>
                            </div>

                            <div style={{ fontSize: 11, color: theme.colors.textTertiary, lineHeight: 1.2 }}>
                                Last modified: {formatLastModified(lastModifiedMs)}
                            </div>

                            <div style={{ fontSize: 11, color: theme.colors.textTertiary, lineHeight: 1.2 }}>
                                AVA Volumes © {new Date().getFullYear()} — v{APP_VERSION}
                            </div>
                        </div>
                    </div>
                </Card>

                {/* Hold panel */}
                <Card style={styles.card}>
                    <div style={styles.tableBody}>
                        <div style={styles.tableTitleCenter}>Hold</div>

                        {selectedProduct ? (
                            !editingHold ? (
                                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                    <div style={{ fontSize: 16, color: theme.colors.textPrimary, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {selectedProduct}
                                    </div>

                                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        <button style={styles.btnSmallGhost} onClick={() => startRenameHold(selectedProduct)}>Edit</button>
                                        <button style={styles.btnX} onClick={() => confirmRemoveHold(selectedProduct)}>×</button>
                                    </div>

                                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                                        <div style={{ fontSize: 11, color: theme.colors.textTertiary }}>Hold cover</div>

                                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                            <button
                                                type="button"
                                                style={styles.btnSmallGhost}
                                                onClick={() => {
                                                    uploadHoldNameRef.current = selectedProduct;
                                                    holdCoverInputRef.current?.click();
                                                }}
                                            >
                                                {selectedCover ? "Change photo" : "Upload photo"}
                                            </button>

                                            {selectedCover ? (
                                                <button type="button" style={styles.btnSmallGhost} onClick={() => removeHoldCover(selectedProduct)}>
                                                    Remove
                                                </button>
                                            ) : null}
                                        </div>

                                        {selectedCover ? (
                                            <img
                                                src={selectedCover}
                                                alt=""
                                                style={{
                                                    width: "100%",
                                                    maxHeight: 220,
                                                    objectFit: "contain",
                                                    border: `1px solid ${theme.colors.borderLight}`,
                                                    borderRadius: 6,
                                                    background: theme.colors.cardBg,
                                                }}
                                            />
                                        ) : (
                                            <div style={{ fontSize: 12, color: theme.colors.textLight }}>No photo</div>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    <input
                                        value={editingHoldName}
                                        onChange={(e) => setEditingHoldName(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") saveRenameHold(selectedProduct);
                                            if (e.key === "Escape") cancelRenameHold();
                                        }}
                                        style={{ ...styles.input, padding: "8px 10px" }}
                                        autoFocus
                                    />
                                    <div style={{ display: "flex", gap: 6 }}>
                                        <button style={styles.btnSmallPrimary} onClick={() => saveRenameHold(selectedProduct)}>Save</button>
                                        <button style={styles.btnSmallGhost} onClick={cancelRenameHold}>Cancel</button>
                                    </div>
                                </div>
                            )
                        ) : (
                            <div style={{ fontSize: 12, color: theme.colors.textMuted }}>Select a hold</div>
                        )}
                    </div>
                </Card>

                {/* MAIN */}
                <Card style={styles.card}>
                    <div style={styles.tableBody}>
                        <div style={styles.tableTitleCenter}>MAIN</div>
                        <div style={styles.table}>
                            {selectedProduct ? (
                                <>
                                    {mainAngles.map((a) => (
                                        <AdminAngleRow styles={styles}
                                            key={a.id}
                                            angle={a}
                                            isActive={selectedAngleId === a.id}
                                            onSelect={() => setSelectedAngleId(a.id)}
                                            onUpdate={(patch) => updateAngle(a.id, patch)}
                                            onRemove={() => removeAngle(a.id)}
                                            onUpload={() => {
                                                uploadTargetIdRef.current = a.id;
                                                fileInputRef.current?.click();
                                            }}
                                        />
                                    ))}
                                    <button style={{ ...styles.btnGhost, marginTop: 6 }} onClick={() => addAngleForHold(selectedProduct, "main")}>
                                        + Add Main angle
                                    </button>
                                </>
                            ) : (
                                <div style={styles.tableEmpty} />
                            )}
                        </div>
                    </div>
                </Card>

                {/* STEFAN */}
                <Card style={styles.card}>
                    <div style={styles.tableBody}>
                        <div style={styles.tableTitleCenter}>STEFAN</div>
                        <div style={styles.table}>
                            {selectedProduct ? (
                                <>
                                    {stefanAngles.map((a) => (
                                        <AdminAngleRow styles={styles}
                                            key={a.id}
                                            angle={a}
                                            isActive={selectedAngleId === a.id}
                                            onSelect={() => setSelectedAngleId(a.id)}
                                            onUpdate={(patch) => updateAngle(a.id, patch)}
                                            onRemove={() => removeAngle(a.id)}
                                            onUpload={() => {
                                                uploadTargetIdRef.current = a.id;
                                                fileInputRef.current?.click();
                                            }}
                                        />
                                    ))}
                                    <button style={{ ...styles.btnGhost, marginTop: 6 }} onClick={() => addAngleForHold(selectedProduct, "stefan")}>
                                        + Add Stefan angle
                                    </button>
                                </>
                            ) : (
                                <div style={styles.tableEmpty} />
                            )}
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
}

/* -------------------- ADMIN ROW: only angle value, no hold name -------------------- */
function AdminAngleRow({ angle, isActive, onSelect, onUpdate, onRemove, onUpload, styles }) {
    const [draft, setDraft] = useState(() => String(angle.value ?? 0));

    useEffect(() => {
        setDraft(String(angle.value ?? 0));
    }, [angle.value]);

    const commit = () => {
        const raw = String(draft).trim();
        if (!raw) {
            setDraft(String(angle.value ?? 0));
            return;
        }
        const v = Number(raw.replace(",", "."));
        if (Number.isFinite(v)) {
            const vv = clamp(v, 0, 90);
            onUpdate({ value: vv });
            setDraft(String(vv));
        } else {
            setDraft(String(angle.value ?? 0));
        }
    };

    // P1: iOS focus fix: setTimeout instead of rAF
    const handleFocus = (e) => {
        const s = String(draft ?? "").trim();
        if (/^0([.,]0+)?$/.test(s)) {
            setDraft("");
            setTimeout(() => {
                try {
                    e.target.setSelectionRange(0, e.target.value.length);
                } catch { }
            }, 0);
        } else {
            setTimeout(() => {
                try {
                    e.target.select();
                } catch { }
            }, 0);
        }
    };

    return (
        <div
            style={{
                ...styles.adminAngleRow,
                ...(isActive ? styles.adminAngleRowActive : null),
            }}
            onClick={onSelect}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onSelect()}
        >
            <span style={styles.adminAngleLabel}>{toAngleLabel(angle.value)}</span>

            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }} onClick={(e) => e.stopPropagation()}>
                <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onFocus={handleFocus}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            commit();
                            e.currentTarget.blur();
                        }
                        if (e.key === "Escape") {
                            e.preventDefault();
                            setDraft(String(angle.value ?? 0));
                            e.currentTarget.blur();
                        }
                    }}
                    style={styles.adminAngleInput}
                />

                <button type="button" style={styles.btnSmallGhost28} onClick={onUpload}>
                    {angle.drawing ? "Change" : "Upload"}
                </button>

                {angle.drawing && (
                    <>
                        <img src={angle.drawing} alt="" style={{ width: 28, height: 28, objectFit: "cover", borderRadius: 4 }} />
                        <button
                            type="button"
                            style={{ ...styles.btnSmallGhost28, width: 28, padding: 0 }}
                            onClick={() => {
                                if (window.confirm("Remove image?")) onUpdate({ drawing: null });
                            }}
                            title="Remove image"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                    </>
                )}

                <button type="button" style={styles.btnX} onClick={onRemove} title="Remove angle">
                    ×
                </button>
            </div>
        </div>
    );
}

function Card({ children, style, ...rest }) {
    return (
        <div style={style} className="card" {...rest}>
            {children}
        </div>
    );
}

/* ===================== STYLES ===================== */

const getStyles = (theme) => ({
    page: {
        minHeight: "100vh",
        height: "100vh",
        overflow: "hidden",
        background: theme.colors.background,
        padding: "clamp(12px, 3vw, 24px)",
        boxSizing: "border-box",
    },
    zoomOverlay: {
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.85)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
    },
    zoomImage: {
        maxWidth: "100%",
        maxHeight: "100%",
        objectFit: "contain",
        borderRadius: 8,
        boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
    },
    zoomBtn: {
        position: "absolute",
        bottom: 12,
        right: 12,
        width: 36,
        height: 36,
        borderRadius: "50%",
        background: theme.colors.cardBg,
        border: `1px solid ${theme.colors.borderMedium}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        boxShadow: "0 2px 5px rgba(0,0,0,0.1)",
        color: theme.colors.textPrimary,
    },
    zoomCloseBtn: {
        position: "absolute",
        top: 20,
        right: 20,
        width: 40,
        height: 40,
        borderRadius: "50%",
        background: "rgba(255, 255, 255, 0.2)",
        border: "none",
        color: "#fff",
        fontSize: 24,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        backdropFilter: "blur(4px)",
    },
    adminPage: {
        minHeight: "100vh",
        height: "100vh",
        overflow: "hidden",
        background: theme.colors.adminPageBg,
        padding: "clamp(12px, 3vw, 24px)",
        boxSizing: "border-box",
    },
    grid: {
        display: "grid",
        gridTemplateColumns: "220px 260px 260px 1fr",
        gap: "clamp(12px, 2vw, 20px)",
        alignItems: "stretch",
        height: "calc(100vh - clamp(24px, 6vw, 48px))",
        width: "100%",
        maxWidth: "1500px",
        margin: "0 auto",
    },
    adminGrid: {
        display: "grid",
        gridTemplateColumns: "220px 260px 1fr 1fr",
        gap: "clamp(12px, 2vw, 20px)",
        alignItems: "stretch",
        height: "calc(100vh - clamp(24px, 6vw, 48px))",
        width: "100%",
        maxWidth: "1500px",
        margin: "0 auto",
    },
    card: {
        background: theme.colors.cardBg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: 6,
        overflow: "hidden",
        minHeight: 0,
    },
    cardBody: {
        padding: "clamp(12px, 2vw, 16px)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        boxSizing: "border-box",
    },

    searchWrap: { paddingBottom: 12 },
    searchPill: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: theme.colors.inputBg,
        border: `1px solid ${theme.colors.borderMedium}`,
        borderRadius: 6,
        padding: "8px 10px",
        boxShadow: "none",
        cursor: "text",
    },
    searchInput: {
        flex: 1,
        border: "none",
        outline: "none",
        fontSize: "clamp(11px, 2vw, 12px)",
        color: theme.colors.textPrimary,
        minWidth: 0,
        background: "transparent",
        padding: 0,
    },
    searchIconWrap: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
    },

    holdsList: {
        overflow: "auto",
        paddingRight: 4,
        flex: 1,
        minHeight: 0,
    },
    holdRow: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 0",
        userSelect: "none",
    },

    holdRowBtn: {
        width: "100%",
        border: "1px solid transparent",
        background: "transparent",
        padding: "6px 8px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        cursor: "pointer",
        textAlign: "left",
        userSelect: "none",
        outline: "none",
        boxShadow: "none",
        transition: "none",
        WebkitTapHighlightColor: "transparent",
        borderRadius: 6,
    },
    holdRowBtnActive: {
        background: "transparent",
        color: theme.colors.textPrimary,
        fontWeight: 600,
    },

    checkbox: {
        width: 14,
        height: 14,
        cursor: "pointer",
    },
    holdName: {
        fontSize: "clamp(12px, 2vw, 13px)",
        color: theme.colors.textPrimary,
        lineHeight: 1.3,
    },

    footerRow: {
        display: "flex",
        gap: 8,
        alignItems: "center",
        paddingTop: 16,
        marginTop: 16,
        borderTop: `1px solid ${theme.colors.borderLight}`,
    },
    footerBtn: {
        flex: 1,
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },

    btnGhost: {
        border: `1px solid ${theme.colors.buttonGhostBorder}`,
        background: theme.colors.buttonGhostBg,
        borderRadius: 4,
        padding: "8px 12px",
        cursor: "pointer",
        fontSize: "clamp(11px, 2vw, 12px)",
        color: theme.colors.buttonGhostText,
        transition: "none",
    },
    btnDanger: {
        border: `1px solid ${theme.colors.borderMedium}`,
        background: theme.colors.buttonGhostBg,
        borderRadius: 4,
        padding: "8px 12px",
        cursor: "pointer",
        fontSize: "clamp(11px, 2vw, 12px)",
        color: theme.colors.textSecondary,
        transition: "none",
    },
    btnPrimary: {
        border: `1px solid ${theme.colors.buttonPrimaryBorder}`,
        background: theme.colors.buttonPrimaryBg,
        borderRadius: 4,
        padding: "8px 14px",
        cursor: "pointer",
        fontSize: "clamp(11px, 2vw, 12px)",
        color: theme.colors.buttonPrimaryText,
        transition: "none",
    },
    btnSmallGhost: {
        border: `1px solid ${theme.colors.buttonGhostBorder}`,
        background: theme.colors.buttonGhostBg,
        borderRadius: 4,
        padding: "6px 10px",
        cursor: "pointer",
        fontSize: "clamp(10px, 2vw, 11px)",
        color: theme.colors.buttonGhostText,
        transition: "none",
    },
    btnSmallGhost28: {
        border: `1px solid ${theme.colors.buttonGhostBorder}`,
        background: theme.colors.buttonGhostBg,
        borderRadius: 4,
        padding: "0 10px",
        height: 28,
        cursor: "pointer",
        fontSize: "clamp(10px, 2vw, 11px)",
        color: theme.colors.buttonGhostText,
        transition: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
    },
    btnSmallPrimary: {
        border: `1px solid ${theme.colors.buttonPrimaryBorder}`,
        background: theme.colors.buttonPrimaryBg,
        borderRadius: 4,
        padding: "6px 10px",
        cursor: "pointer",
        fontSize: "clamp(10px, 2vw, 11px)",
        color: theme.colors.buttonPrimaryText,
        transition: "none",
    },

    tableBody: {
        padding: "clamp(12px, 2vw, 16px)",
        height: "100%",
        minHeight: 0,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
    },
    tableHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        marginBottom: 10,
        position: "relative",
    },
    tableTitleCenter: {
        fontSize: "clamp(10px, 2vw, 11px)",
        fontWeight: 700,
        letterSpacing: "0.05em",
        color: theme.colors.textTertiary,
        textAlign: "center",
    },
    sortButton: {
        border: `1px solid ${theme.colors.buttonGhostBorder}`,
        background: theme.colors.buttonGhostBg,
        borderRadius: 4,
        width: 24,
        height: 24,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        color: theme.colors.textSecondary,
        transition: "none",
        position: "absolute",
        right: 0,
    },
    table: {
        display: "flex",
        flexDirection: "column",
        gap: 4,
        overflow: "auto",
        flex: 1,
        paddingRight: 4,
        minHeight: 0,
    },
    tableRow: {
        display: "grid",
        gridTemplateColumns: "64px 1fr",
        gap: 10,
        alignItems: "center",
        border: `1px solid ${theme.colors.borderLight}`,
        borderRadius: 4,
        padding: "8px 10px",
        background: theme.colors.cardBg,
        cursor: "pointer",
        textAlign: "left",
        outline: "none",
        boxShadow: "none",
        transition: "none",
        WebkitTapHighlightColor: "transparent",
    },
    tableRowActive: {
        borderColor: theme.colors.borderLight,
        background: theme.colors.cardBg,
        boxShadow: "none",
        outline: "none",
    },

    adminAngleRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "8px 0",
        cursor: "pointer",
        borderBottom: `1px solid ${theme.colors.activeBg}`,
    },
    adminAngleRowActive: {
        background: theme.colors.hoverBg,
    },
    adminAngleLabel: {
        fontWeight: 500,
        color: theme.colors.textPrimary,
        fontSize: "clamp(12px, 2vw, 13px)",
        minWidth: 50,
    },

    adminAngleInput: {
        border: `1px solid ${theme.colors.buttonGhostBorder}`,
        borderRadius: 4,
        height: 28,
        width: 70,
        padding: "0 8px",
        fontSize: "clamp(11px, 2vw, 12px)",
        outline: "none",
        background: theme.colors.inputBg,
        color: theme.colors.textPrimary,
        boxSizing: "border-box",
    },

    angleCell: {
        fontWeight: 700,
        color: theme.colors.textPrimary,
        fontSize: "clamp(13px, 2.2vw, 15px)",
    },
    nameCell: {
        color: theme.colors.textSecondary,
        fontSize: "clamp(11px, 2vw, 12px)",
    },
    tableEmpty: { height: 8 },

    viewerWrap: { padding: "clamp(12px, 2vw, 16px)", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column" },
    viewerEmpty: {
        width: "100%",
        height: "100%",
        border: `1px dashed ${theme.colors.viewerEmptyBorder}`,
        borderRadius: 4,
        background: theme.colors.viewerEmptyBg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    viewerImg: {
        width: "100%",
        height: "100%",
        objectFit: "contain",
        borderRadius: 4,
        background: theme.colors.cardBg,
        flex: 1,
    },

    adminTitle: {
        fontSize: "clamp(10px, 2vw, 11px)",
        fontWeight: 600,
        letterSpacing: "0.05em",
        color: theme.colors.textTertiary,
        marginBottom: 10,
    },
    adminRow: {
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
    },
    input: {
        border: `1px solid ${theme.colors.borderMedium}`,
        borderRadius: 4,
        padding: "8px 10px",
        fontSize: "clamp(11px, 2vw, 12px)",
        outline: "none",
        background: theme.colors.inputBg,
        color: theme.colors.textPrimary,
        transition: "none",
    },
    btnX: {
        border: `1px solid ${theme.colors.buttonGhostBorder}`,
        background: theme.colors.buttonGhostBg,
        borderRadius: 4,
        width: 28,
        height: 28,
        cursor: "pointer",
        fontSize: 14,
        lineHeight: "14px",
        color: theme.colors.textSecondary,
        transition: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
    },
});
