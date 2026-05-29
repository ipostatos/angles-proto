import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

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

const APP_VERSION = "1.01";

const DEFAULT_HOLDS = [
    "Anton",
];

const LS_KEY = "angles_proto_v1";
const LS_VERSION = 1;
const LS_LAST_MODIFIED_KEY = "angles_proto_v1_lastModified";

// backups
const LS_BACKUPS_KEY = `${LS_KEY}_backups`;
const MAX_BACKUPS = 5;
const LS_CORRUPT_KEY = `${LS_KEY}_corrupt`;

// Max serialized DB size we allow to keep in localStorage / accept on import (~4.5MB)
const MAX_DB_SIZE_KB = 4500;

// Set when loadState() had to recover from corrupt data; App surfaces a toast.
let didRecoverFromCorrupt = false;

// admin auth
const ADMIN_HASH_KEY = `${LS_KEY}_admin_hash`; // sha256 hex
const ADMIN_SESSION_KEY = `${LS_KEY}_admin_session`; // "1" while logged in this session

function hasAdminSession() {
    try { return sessionStorage.getItem(ADMIN_SESSION_KEY) === "1"; } catch { return false; }
}

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

// Only accept raster image data URLs. Rejects SVG (data:image/svg+xml) and any
// non-image string to avoid storing/rendering untrusted markup from JSON import.
function isSafeRasterDataUrl(s) {
    return typeof s === "string" && /^data:image\/(png|jpe?g|webp|gif);/i.test(s);
}

function sanitizeAngle(a, holdsSet) {
    const hold = normalizeHoldNameSafe(a?.hold);
    const saw = a?.saw === "stefan" ? "stefan" : "main";

    const raw = a?.value;
    const num = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(",", "."));
    const value = Number.isFinite(num) ? clamp(num, 0, 90) : 0;

    const id = typeof a?.id === "string" && a.id.trim() ? a.id : cryptoRandomId();

    const drawing = isSafeRasterDataUrl(a?.drawing) ? a.drawing : undefined;

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
        if (isSafeRasterDataUrl(v)) {
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
        // Data is unreadable. Preserve the original bytes for recovery instead of
        // silently overwriting them, and DON'T touch LS_KEY here so the user can
        // still export/inspect the corrupt payload. Keep only the newest copy.
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) {
                for (let i = localStorage.length - 1; i >= 0; i--) {
                    const k = localStorage.key(i);
                    if (k && k.startsWith(`${LS_CORRUPT_KEY}_`)) localStorage.removeItem(k);
                }
                localStorage.setItem(`${LS_CORRUPT_KEY}_${Date.now()}`, raw);
            }
        } catch { }
        didRecoverFromCorrupt = true;
        return migrateAndSanitize({
            version: LS_VERSION,
            holds: DEFAULT_HOLDS,
            angles: DEFAULT_ANGLES,
            holdImages: {},
        });
    }
}

function saveState(next) {
    try {
        const safe = migrateAndSanitize(next);
        localStorage.setItem(LS_KEY, JSON.stringify(safe));
        touchLastModified();
        return true;
    } catch (err) {
        if (err?.name === "QuotaExceededError" || err?.code === 22) {
            console.warn("Storage full: image not saved. Use smaller images or remove some drawings.");
            toast.error("Storage full. Remove some drawings or upload smaller images.");
        } else {
            console.warn("Save failed:", err);
            toast.error("Could not save. Changes may be lost.");
        }
        return false;
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

function serializedSizeKB(obj) {
    try {
        return new Blob([JSON.stringify(obj)]).size / 1024;
    } catch {
        return Infinity;
    }
}

function printImage(src) {
    if (!src) return;

    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    Object.assign(iframe.style, {
        position: "fixed",
        width: "0",
        height: "0",
        border: "0",
        opacity: "0",
        pointerEvents: "none",
    });
    document.body.appendChild(iframe);

    const cleanup = () => {
        setTimeout(() => iframe.remove(), 500);
    };

    const win = iframe.contentWindow;
    const doc = iframe.contentDocument || win?.document;
    if (!doc || !win) {
        cleanup();
        return;
    }

    doc.open();
    doc.write(`<!DOCTYPE html><html><head><title>Drawing</title><style>
      @page { margin: 12mm; }
      html, body { margin: 0; padding: 0; height: 100%; }
      body { display: flex; align-items: center; justify-content: center; }
      img { max-width: 100%; max-height: 100%; object-fit: contain; }
    </style></head><body><img id="print-drawing" alt="drawing" /></body></html>`);
    doc.close();

    const img = doc.getElementById("print-drawing");
    if (!img) {
        cleanup();
        return;
    }

    let printed = false;
    const doPrint = () => {
        if (printed) return;
        printed = true;
        try {
            win.focus();
            win.print();
        } finally {
            cleanup();
        }
    };

    img.onerror = cleanup;
    img.onload = doPrint;
    img.src = src;
    if (img.complete) doPrint();
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

// First-run admin password policy: min length + reject obvious weak choices.
// NOTE: client-side hashing is not a real security boundary (see SECURITY_AUDIT.md);
// this only discourages trivial defaults.
const WEAK_PASSWORDS = new Set([
    "admin", "password", "12345678", "11111111", "00000000",
    "qwerty", "qwertyui", "admin123", "password1", "letmein",
]);
function isStrongAdminPassword(pw) {
    const p = String(pw ?? "");
    if (p.length < 8) return false;
    if (WEAK_PASSWORDS.has(p.toLowerCase())) return false;
    return true;
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
        background: '#f5f7fa',
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
        adminPageBg: '#f5f7fa',
    },
};

export default function App() {
    const route = useHashRoute();
    const [data, setData] = useState(() => loadState());
    const [selectedHolds, setSelectedHolds] = useState(() => new Set());
    const [activeAngleId, setActiveAngleId] = useState(null);
    const [zoomedImage, setZoomedImage] = useState(null);
    const [lastModifiedMs, setLastModifiedMs] = useState(() => loadLastModified());

    // Print mode: 'all' | 'main' | 'stefan'
    const [printMode, setPrintMode] = useState("all");

    const [mainSort, setMainSort] = useState("desc");
    const [stefanSort, setStefanSort] = useState("asc");

    const [holdSearch, setHoldSearch] = useState("");
    const searchRef = useRef(null);

    // admin login modal (appears over the main page, no navigation)
    const [showLogin, setShowLogin] = useState(false);
    const [loginUser, setLoginUser] = useState("admin");
    const [loginPass, setLoginPass] = useState("");
    // Keeps admin mounted after one-time session token is consumed on AdminPage mount
    const [adminAuthed, setAdminAuthed] = useState(false);
    const prevRouteRef = useRef(null);

    const openAdmin = useCallback(() => {
        if (hasAdminSession()) {
            window.location.hash = "#/admin";
        } else {
            setLoginPass("");
            setShowLogin(true);
        }
    }, []);

    // Route guards: require login when entering /admin; clear auth when leaving (browser Back, etc.)
    useEffect(() => {
        const prev = prevRouteRef.current;
        prevRouteRef.current = route;

        if (prev === "/admin" && route !== "/admin") {
            setAdminAuthed(false);
            setShowLogin(false);
            try { sessionStorage.removeItem(ADMIN_SESSION_KEY); } catch { }
        }

        if (route === "/admin" && prev !== "/admin" && !adminAuthed && !hasAdminSession()) {
            setLoginPass("");
            setShowLogin(true);
            if (window.location.hash !== "#/" && window.location.hash !== "#") {
                window.location.hash = "#/";
            }
        }
    }, [route, adminAuthed]);

    const submitLogin = useCallback(async () => {
        if (!globalThis.crypto?.subtle) {
            toast.error("Secure login unavailable here. Open the app over https or localhost.");
            return;
        }

        let storedHash = null;
        try { storedHash = localStorage.getItem(ADMIN_HASH_KEY); } catch { }

        const finish = () => {
            try { sessionStorage.setItem(ADMIN_SESSION_KEY, "1"); } catch { }
            setAdminAuthed(true);
            setShowLogin(false);
            setLoginPass("");
            window.location.hash = "#/admin";
        };

        try {
            if (!storedHash) {
                // First-run setup: operator chooses a strong password (no built-in default).
                if (loginUser !== "admin") {
                    toast.error("Use username \"admin\" to set up.");
                    return;
                }
                if (!isStrongAdminPassword(loginPass)) {
                    toast.error("Set a password with at least 8 characters (not a common word).");
                    return;
                }
                let stored = false;
                try {
                    localStorage.setItem(ADMIN_HASH_KEY, await sha256Hex(loginPass));
                    stored = true;
                } catch {
                    toast.error("Could not save password. Check browser storage settings.");
                }
                if (stored) {
                    toast.success("Admin password set.");
                    finish();
                }
                return;
            }

            const hash = await sha256Hex(loginPass);
            if (loginUser === "admin" && hash === storedHash) {
                finish();
            } else {
                toast.error("Wrong credentials");
            }
        } catch (err) {
            console.warn("Login failed:", err);
            toast.error("Login failed. Please try again.");
        }
    }, [loginUser, loginPass]);

    // P0: debounce localStorage writes. Skip the first run so we don't immediately
    // re-write storage on mount (loadState already persisted sanitized data, and this
    // preserves any corrupt payload backed up for recovery).
    const debouncedData = useDebounce(data, 500);
    const skipFirstSaveRef = useRef(true);
    useEffect(() => {
        if (skipFirstSaveRef.current) {
            skipFirstSaveRef.current = false;
            return;
        }
        saveState(debouncedData);
        setLastModifiedMs(loadLastModified());
    }, [debouncedData]);

    // Surface a one-time warning if stored data was unreadable and we recovered.
    useEffect(() => {
        if (didRecoverFromCorrupt) {
            didRecoverFromCorrupt = false;
            toast.error("Saved data was unreadable. A backup copy was kept; you can re-import from EXPORT file.", { duration: 6000 });
        }
    }, []);

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
    }, [activeAngle, selectedHolds, data.holdImages]);

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

    if (route === "/admin" && (adminAuthed || hasAdminSession())) {
        return (
            <AdminPage
                data={data}
                setData={setData}
                onExit={() => {
                    setShowLogin(false);
                    setAdminAuthed(false);
                    try { sessionStorage.removeItem(ADMIN_SESSION_KEY); } catch { }
                    window.location.hash = "#/";
                }}
                lastModifiedMs={lastModifiedMs}
            />
        );
    }

    return (
        <div style={styles.page} className={`app-page print-mode-${printMode}`}>
            <style>{`
        .print-sheet {
          display: none;
        }

        @media print {
          @page {
            margin: 10mm;
          }
          html, body, #root, .app-page {
            height: auto !important;
            min-height: 0 !important;
            max-height: none !important;
            overflow: visible !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          [data-print-hide] { display: none !important; }
          .main-grid { display: none !important; }

          .print-sheet {
            display: block !important;
            width: 100% !important;
          }
          /* ALL: MAIN left, STEFAN right — reliable table layout for print */
          .print-mode-all .print-sheet {
            display: table !important;
            width: 100% !important;
            table-layout: fixed !important;
            border-collapse: separate !important;
            border-spacing: 4% 0 !important;
          }
          .print-mode-all .print-section {
            display: table-cell !important;
            width: 48% !important;
            vertical-align: top !important;
          }
          .print-mode-main .print-section-stefan { display: none !important; }
          .print-mode-stefan .print-section-main { display: none !important; }

          .print-section-title {
            font-size: 20px !important;
            font-weight: 600 !important;
            text-align: center !important;
            margin: 0 0 10px 0 !important;
            break-after: avoid !important;
            page-break-after: avoid !important;
          }
          .print-columns-row {
            display: block !important;
            width: 100% !important;
            overflow: hidden !important;
          }
          .print-columns-row::after {
            content: "" !important;
            display: table !important;
            clear: both !important;
          }
          .print-columns-row-break {
            break-before: page !important;
            page-break-before: always !important;
          }
          .print-column {
            float: left !important;
            box-sizing: border-box !important;
            padding-right: 10px !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          .print-mode-all .print-column {
            padding-right: 6px !important;
          }
          .card { overflow: visible !important; }
          .print-table-row {
            border: none !important;
            padding: 0 !important;
            background: transparent !important;
            margin-bottom: 4px !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            display: grid !important;
            grid-template-columns: 52px 1fr !important;
            column-gap: 8px !important;
            align-items: baseline !important;
            -webkit-appearance: none !important;
            appearance: none !important;
            outline: none !important;
            box-shadow: none !important;
          }
          .print-table-row span {
            font-size: 15px !important;
            line-height: 1.15 !important;
            font-weight: 400 !important;
          }
          .print-table-row span:first-child,
          .print-table-row .print-angle {
            text-align: right !important;
            font-variant-numeric: tabular-nums !important;
            font-weight: 700 !important;
          }
          .print-table-row span:last-child,
          .print-table-row .print-hold {
            font-weight: 400 !important;
          }
          .tableTitleCenter {
            font-size: 20px !important;
            margin-bottom: 10px !important;
            break-after: avoid !important;
            page-break-after: avoid !important;
          }
          .print-header {
            margin-bottom: 2px !important;
          }
          button { all: unset; }
          
          /* Ensure hidden elements stay hidden (override earlier display: block) */
          [data-print-hide], .main-grid > :nth-child(1), .main-grid > :nth-child(4), .viewerWrap, .sortButton {
             display: none !important;
             visibility: hidden !important;
             opacity: 0 !important;
             height: 0 !important;
             width: 0 !important;
             overflow: hidden !important;
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

          /* MOBILE FIX START */
          /* Holds List: compact, align checkbox/text */
          .holdRow {
            min-height: 48px;
            padding: 4px 0 !important;
            display: flex !important;
            align-items: center !important;
            border-bottom: 1px solid #f0f0f0; /* subtle separator helps tap targets */
          }
          .holdCheckbox {
            margin: 0 12px 0 0 !important;
            width: 20px !important;
            height: 20px !important;
            flex-shrink: 0;
          }
          .holdName {
             font-size: 16px !important; /* readable size */
             line-height: 1.5 !important;
             padding: 0 !important;
          }
          
          /* Footer Actions: fixed at bottom on mobile */
          .footerRow {
             position: fixed !important;
             bottom: 0 !important;
             left: 0 !important;
             right: 0 !important;
             z-index: 100 !important;
             display: flex !important;
             flex-wrap: nowrap !important;
             gap: 8px !important;
             margin-top: 0 !important;
             padding: 10px 12px env(safe-area-inset-bottom, 0px) !important;
             background: #ffffff !important;
             border-top: 1px solid #e8e8e8 !important;
             align-items: center !important;
          }
          /* Compensate for fixed footer height */
          .app-page {
             padding-bottom: calc(64px + env(safe-area-inset-bottom, 0px)) !important;
          }
          .footerBtn {
             height: 44px !important;
             font-size: 15px !important;
             flex: 1 1 auto !important;
             min-width: 0 !important;
          }
          .iconBtn {
             height: 44px !important;
             width: 44px !important;
             flex: 0 0 44px !important;
             justify-content: center !important;
             display: flex !important;
             padding: 0 !important;
          }
          .printSelect {
             height: 44px !important;
             flex: 0 0 80px !important;
             min-width: 0 !important;
             font-size: 15px !important;
             margin-bottom: 0 !important;
             margin-right: 0 !important;
          }
          
          /* Search Bar: compact */
          .searchPill {
             height: 34px !important;
             min-height: 34px !important;
             border: 1px solid #e0e0e0 !important;
             background: #fff !important;
             margin-bottom: 6px !important;
             display: flex !important;
             align-items: center !important;
             padding: 0 10px !important;
          }
          .searchInput {
             font-size: 14px !important;
             height: 34px !important;
             min-height: 0 !important;
          }

          /* MAIN / STEFAN headers: compact */
          .tableHeader {
             min-height: 32px !important;
             height: 32px !important;
             margin-bottom: 0 !important;
             display: flex !important;
             align-items: center !important;
             justify-content: center !important;
          }
          .tableTitleCenter {
             font-size: 11px !important;
             line-height: 32px !important;
          }
          .sortButton {
             top: 50% !important;
             transform: translateY(-50%) !important;
             height: 22px !important;
             width: 22px !important;
             right: 0 !important;
             border: 1px solid #eee !important;
          }
          .sortButton svg {
             width: 10px !important;
             height: 10px !important;
          }

          /* General touch/padding */
          .cardBody { padding: 12px !important; }
          .searchWrap { padding-bottom: 4px !important; }
          /* MOBILE FIX END */

          /* Touch targets */
          button, input, [role="button"] {
            min-height: 44px;
            touch-action: manipulation;
          }
          /* Viewer tool buttons and zoom close — fixed-size circles, exempt from min-height */
          .viewerToolBtn, .zoomCloseBtn {
            min-height: 0 !important;
            width: 44px !important;
            height: 44px !important;
          }
          
          input { font-size: 16px !important; }
        }
        /* MOBILE ADAPTATION END */

                /* MOBILE ULTRA COMPACT START */
        @media screen and (max-width: 640px) {
          /* Search input field: strict 34px */
          .searchPill {
             height: 34px !important;
             min-height: 34px !important;
             margin-bottom: 4px !important;
             padding: 0 8px !important;
          }
          .searchInput {
             line-height: 34px !important;
             height: 34px !important;
             font-size: 14px !important;
          }
          .searchIconWrap svg {
             width: 14px !important;
             height: 14px !important;
          }

          /* MAIN and STEFAN section header: strict 34px */
          .tableHeader {
             height: 34px !important;
             min-height: 34px !important;
             margin-bottom: 0 !important;
             padding-right: 34px !important; /* Make room for the button */
             position: relative !important;
          }
          .tableTitleCenter {
             line-height: 34px !important;
             font-size: 13px !important;
             letter-spacing: 0.5px !important;
          }

          /* MAIN and STEFAN header buttons: full height 34px, no floating */
          .sortButton {
             height: 34px !important;
             width: 34px !important;
             top: 0 !important;
             right: 0 !important;
             transform: none !important; /* Remove translateY constraint */
             border: none !important;
             border-radius: 0 4px 4px 0 !important;
             background: transparent !important;
          }
          .sortButton svg {
             width: 12px !important;
             height: 12px !important;
          }
        }
        /* MOBILE ULTRA COMPACT END */

        /* DESKTOP LOCK: no page sliding, only internal lists/tables scroll */
        @media screen and (min-width: 901px) {
          html, body, #root {
            width: 100% !important;
            height: 100% !important;
            overflow: hidden !important;
          }
          .app-page {
            width: 100vw !important;
            height: 100vh !important;
            overflow: hidden !important;
            display: flex !important;
            flex-direction: column !important;
          }
          .main-grid {
            display: grid !important;
            grid-template-columns: minmax(180px, 220px) minmax(190px, 260px) minmax(190px, 260px) minmax(260px, 1fr) !important;
            grid-template-rows: 1fr !important;
            width: 100% !important;
            max-width: 1500px !important;
            flex: 1 1 auto !important;
            min-height: 0 !important;
            overflow: hidden !important;
            margin: 0 auto !important;
          }
          .main-grid > * {
            min-width: 0 !important;
            min-height: 0 !important;
            grid-row: auto !important;
            grid-column: auto !important;
          }
          .holdsList,
          .table {
            max-height: none !important;
            overflow-y: auto !important;
            overflow-x: hidden !important;
          }
          .card,
          .cardBody,
          .tableBody {
            min-height: 0 !important;
            overflow: hidden !important;
          }
        }
        
        button, [role="button"], input, select, label, a, summary {
          outline: none !important;
          -webkit-tap-highlight-color: transparent;
        }
        button:focus, button:focus-visible,
        [role="button"]:focus, [role="button"]:focus-visible,
        input:focus, input:focus-visible,
        input[type="checkbox"]:focus, input[type="checkbox"]:focus-visible,
        select:focus, select:focus-visible,
        label:focus, a:focus, a:focus-visible {
          outline: none !important;
          box-shadow: none !important;
        }
        button::-moz-focus-inner { border: 0; }
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

                        <div style={styles.holdsList} className="holdsList">
                            {visibleHolds.map((name) => (
                                <label key={name} style={styles.holdRow} className="holdRow">
                                    <input
                                        type="checkbox"
                                        checked={selectedHolds.has(name)}
                                        onChange={() => toggleHold(name)}
                                        style={styles.checkbox}
                                        className="holdCheckbox"
                                    />
                                    <span style={styles.holdName} className="holdName">{name}</span>
                                </label>
                            ))}
                        </div>

                        <div style={styles.footerRow} className="footerRow">
                            <PrintModeSelect
                                value={printMode}
                                onChange={setPrintMode}
                                styles={styles}
                                options={[
                                    { value: "all", label: "ALL" },
                                    { value: "main", label: "MAIN" },
                                    { value: "stefan", label: "STEFAN" },
                                ]}
                            />

                            <button
                                type="button"
                                onClick={() => window.print()}
                                title="Print MAIN and STEFAN tables"
                                aria-label="Print"
                                data-print-hide
                                className="iconBtn"
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
                                className="footerBtn"
                                onClick={openAdmin}
                            >
                                ADMIN
                            </button>

                            <button
                                type="button"
                                style={{ ...styles.btnDanger, ...styles.footerBtn }}
                                className="footerBtn"
                                onClick={clearSelection}
                            >
                                CLEAR
                            </button>
                        </div>
                    </div>
                </Card>

                {/* Main table */}
                <Card style={styles.card}>
                    <div style={styles.tableBody}>
                        <div style={styles.tableHeader} className="print-header tableHeader">
                            <div style={styles.tableTitleCenter} className="tableTitleCenter">MAIN</div>
                            <button
                                type="button"
                                onClick={cycleSortMain}
                                onMouseDown={(e) => e.preventDefault()}
                                style={styles.sortButton}
                                className="sortButton"
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
                        <div style={styles.tableHeader} className="print-header tableHeader">
                            <div style={styles.tableTitleCenter} className="tableTitleCenter">STEFAN</div>
                            <button
                                type="button"
                                onClick={cycleSortStefan}
                                onMouseDown={(e) => e.preventDefault()}
                                style={styles.sortButton}
                                className="sortButton"
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
                                <div style={styles.viewerTools}>
                                    <button
                                        type="button"
                                        onClick={() => printImage(viewerSrc)}
                                        style={styles.viewerToolBtn}
                                        className="viewerToolBtn"
                                        title="Print drawing"
                                    >
                                        <PrinterIcon size={20} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setZoomedImage(viewerSrc)}
                                        style={styles.viewerToolBtn}
                                        className="viewerToolBtn"
                                        title="Zoom image"
                                    >
                                        <ZoomIcon />
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div style={styles.viewerEmpty}>
                                <div style={{ fontSize: 12, color: theme.colors.textMuted }}>no drawing uploaded</div>
                            </div>
                        )}
                    </div>
                </Card>
            </div>

            {/* Print-only layout: headers on top, rows flow into side columns */}
            <div className="print-sheet">
                {(printMode === "all" || printMode === "main") && (
                    <PrintTableSection
                        title="MAIN"
                        rows={selectedAngles.main}
                        maxColumnsPerRow={printMode === "all" ? PRINT_MAX_COLUMNS_ALL : PRINT_MAX_COLUMNS_SINGLE}
                        className="print-section-main"
                    />
                )}
                {(printMode === "all" || printMode === "stefan") && (
                    <PrintTableSection
                        title="STEFAN"
                        rows={selectedAngles.stefan}
                        maxColumnsPerRow={printMode === "all" ? PRINT_MAX_COLUMNS_ALL : PRINT_MAX_COLUMNS_SINGLE}
                        className="print-section-stefan"
                    />
                )}
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
                        className="zoomCloseBtn"
                    >
                        ×
                    </button>
                </div>
            )}

            {/* Admin login modal (over the page, no navigation) */}
            {showLogin && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(0,0,0,0.32)",
                        backdropFilter: "blur(3px)",
                        WebkitBackdropFilter: "blur(3px)",
                        zIndex: 9999,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 20,
                    }}
                    onClick={() => setShowLogin(false)}
                >
                    <style>{`
                        .login-modal-input:focus,
                        .login-modal-input:focus-visible {
                            background: ${theme.colors.inputBg} !important;
                            outline: none !important;
                            box-shadow: none !important;
                            border-color: ${theme.colors.borderMedium} !important;
                        }
                        .login-modal-input:-webkit-autofill,
                        .login-modal-input:-webkit-autofill:hover,
                        .login-modal-input:-webkit-autofill:focus {
                            -webkit-box-shadow: 0 0 0 1000px ${theme.colors.inputBg} inset !important;
                            -webkit-text-fill-color: ${theme.colors.textPrimary} !important;
                            transition: background-color 9999s ease-out 0s;
                        }
                    `}</style>
                    <div
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") submitLogin();
                            if (e.key === "Escape") setShowLogin(false);
                        }}
                        style={{
                            width: "100%",
                            maxWidth: 300,
                            background: theme.colors.cardBg,
                            border: `1px solid ${theme.colors.border}`,
                            borderRadius: 8,
                            padding: 24,
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                            boxSizing: "border-box",
                        }}
                    >
                        <div style={{ ...styles.adminTitle, marginBottom: 4, textAlign: "center" }}>ADMIN</div>
                        <input
                            value={loginUser}
                            onChange={(e) => setLoginUser(e.target.value)}
                            placeholder="LOGIN"
                            className="login-modal-input"
                            style={{
                                ...styles.input,
                                textAlign: "center",
                                background: theme.colors.inputBg,
                                boxShadow: "none",
                            }}
                        />
                        <input
                            value={loginPass}
                            onChange={(e) => setLoginPass(e.target.value)}
                            placeholder="PASSWORD"
                            type="password"
                            autoFocus
                            className="login-modal-input"
                            style={{
                                ...styles.input,
                                textAlign: "center",
                                background: theme.colors.inputBg,
                                boxShadow: "none",
                            }}
                        />
                        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 4 }}>
                            <button type="button" style={{ ...styles.btnPrimary, minWidth: 60 }} onClick={submitLogin}>OK</button>
                            <button type="button" style={styles.btnGhost} onClick={() => setShowLogin(false)}>CANCEL</button>
                        </div>
                    </div>
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

function PrinterIcon({ size = 16 }) {
    return (
        <svg
            width={size}
            height={size}
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

function SaveIcon() {
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
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
        </svg>
    );
}

/* Custom rounded dropdown (no native blue highlight) */
function PrintModeSelect({ value, onChange, options, styles }) {
    const [open, setOpen] = useState(false);
    const [hovered, setHovered] = useState(null);
    const wrapRef = useRef(null);

    useEffect(() => {
        if (!open) return;
        const onDocClick = (e) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener("mousedown", onDocClick);
        return () => document.removeEventListener("mousedown", onDocClick);
    }, [open]);

    const current = options.find((o) => o.value === value) || options[0];

    return (
        <div ref={wrapRef} style={{ position: "relative", flex: "1 1 auto", minWidth: 80 }} data-print-hide>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                title="Select print mode"
                style={{
                    ...styles.btnGhost,
                    height: 36,
                    width: "100%",
                    padding: "0 10px",
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    fontSize: 13,
                    cursor: "pointer",
                }}
            >
                <span>{current.label}</span>
                <span style={{ fontSize: 10, opacity: 0.6 }}>{open ? "▲" : "▼"}</span>
            </button>

            {open && (
                <div
                    style={{
                        position: "absolute",
                        bottom: "calc(100% + 6px)",
                        left: 0,
                        right: 0,
                        background: theme.colors.cardBg,
                        border: `1px solid ${theme.colors.borderMedium}`,
                        borderRadius: 8,
                        overflow: "hidden",
                        zIndex: 50,
                    }}
                >
                    {options.map((o) => {
                        const isSel = o.value === value;
                        const isHov = hovered === o.value;
                        return (
                            <button
                                key={o.value}
                                type="button"
                                onMouseEnter={() => setHovered(o.value)}
                                onMouseLeave={() => setHovered(null)}
                                onClick={() => { onChange(o.value); setOpen(false); }}
                                style={{
                                    display: "block",
                                    width: "100%",
                                    textAlign: "left",
                                    padding: "9px 12px",
                                    border: "none",
                                    cursor: "pointer",
                                    fontSize: 13,
                                    background: isSel ? theme.colors.activeBg : isHov ? theme.colors.hoverBg : "transparent",
                                    color: theme.colors.textPrimary,
                                    fontWeight: isSel ? 600 : 400,
                                }}
                            >
                                {o.label}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
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

function chunkRowsForPrint(rows, rowsPerColumn) {
    if (!rows.length) return [];
    const chunks = [];
    for (let i = 0; i < rows.length; i += rowsPerColumn) {
        chunks.push(rows.slice(i, i + rowsPerColumn));
    }
    return chunks;
}

function buildPrintColumnGroups(rows, rowsPerColumn, maxColumnsPerRow) {
    const chunks = chunkRowsForPrint(rows, rowsPerColumn);
    if (!chunks.length) return [];
    const groups = [];
    for (let i = 0; i < chunks.length; i += maxColumnsPerRow) {
        groups.push(chunks.slice(i, i + maxColumnsPerRow));
    }
    return groups;
}

// A4 portrait: ~46 rows per column keeps each column on one page
const PRINT_ROWS_PER_COLUMN = 46;
const PRINT_MAX_COLUMNS_ALL = 2;
const PRINT_MAX_COLUMNS_SINGLE = 4;

function PrintAngleRow({ row }) {
    return (
        <div className="print-table-row">
            <span className="print-angle">{toAngleLabel(row.value)}</span>
            <span className="print-hold">{row.hold}</span>
        </div>
    );
}

function PrintTableSection({ title, rows, maxColumnsPerRow, className = "" }) {
    const columnGroups = buildPrintColumnGroups(rows, PRINT_ROWS_PER_COLUMN, maxColumnsPerRow);
    return (
        <div className={`print-section ${className}`.trim()}>
            <div className="print-section-title">{title}</div>
            {columnGroups.map((group, groupIdx) => (
                <div
                    key={groupIdx}
                    className={`print-columns-row${groupIdx > 0 ? " print-columns-row-break" : ""}`}
                >
                    {group.map((col, colIdx) => (
                        <div
                            key={colIdx}
                            className="print-column"
                            style={{ width: `${100 / group.length}%` }}
                        >
                            {col.map((r) => (
                                <PrintAngleRow key={r.id} row={r} />
                            ))}
                        </div>
                    ))}
                </div>
            ))}
        </div>
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

    const [draftData, setDraftData] = useState(() => data);

    const holdsSafe = useMemo(() => sortHolds(Array.isArray(draftData?.holds) ? draftData.holds : []), [draftData?.holds]);
    const anglesSafe = Array.isArray(draftData?.angles) ? draftData.angles : [];

    const [selectedProduct, setSelectedProduct] = useState(null);
    const [newHoldName, setNewHoldName] = useState("");
    const [editingHold, setEditingHold] = useState(null);
    const [editingHoldName, setEditingHoldName] = useState("");
    const [zoomedImage, setZoomedImage] = useState(null);
    const [confirmState, setConfirmState] = useState(null);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const confirmResolverRef = useRef(null);

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

    const askConfirm = useCallback((message) => {
        return new Promise((resolve) => {
            confirmResolverRef.current = resolve;
            setConfirmState({ message });
        });
    }, []);

    const closeConfirm = useCallback((result) => {
        if (confirmResolverRef.current) {
            confirmResolverRef.current(result);
            confirmResolverRef.current = null;
        }
        setConfirmState(null);
    }, []);

    const updateAdminData = useCallback((updater) => {
        setHasUnsavedChanges(true);
        setDraftData((prev) => (typeof updater === "function" ? updater(prev) : updater));
    }, []);

    const handleSave = useCallback(() => {
        const ok = saveState(draftData);
        if (!ok) {
            // saveState already surfaced the reason; keep the unsaved flag so the user can retry.
            return;
        }
        setData(draftData);
        setHasUnsavedChanges(false);
        toast.success("Changes saved");
    }, [draftData, setData]);

    const handleExit = useCallback(async () => {
        if (hasUnsavedChanges) {
            const ok = await askConfirm("You have unsaved changes. Leave without saving?");
            if (!ok) return;
        }
        onExit();
    }, [askConfirm, hasUnsavedChanges, onExit]);

    // Session is a one-time token: consume it on mount so re-entering admin
    // (back button, browser nav, reload) always requires logging in again.
    useEffect(() => {
        try { sessionStorage.removeItem(ADMIN_SESSION_KEY); } catch { }
    }, []);

    useEffect(() => {
        if (!hasUnsavedChanges) setDraftData(data);
    }, [data, hasUnsavedChanges]);

    // Warn before closing/reloading the tab while admin edits are unsaved.
    useEffect(() => {
        if (!hasUnsavedChanges) return;
        const onBeforeUnload = (e) => {
            e.preventDefault();
            e.returnValue = "";
            return "";
        };
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, [hasUnsavedChanges]);

    useEffect(() => {
        if (selectedProduct && !holdsSafe.includes(selectedProduct)) setSelectedProduct(null);
    }, [holdsSafe, selectedProduct]);

    const addHold = useCallback(() => {
        const name = normalizeHoldName(newHoldName);
        if (!name) return;
        updateAdminData((prev) => {
            const prevHolds = Array.isArray(prev.holds) ? prev.holds : [];
            if (prevHolds.some((h) => String(h).toLowerCase() === name.toLowerCase())) return prev;
            return { ...prev, holds: sortHolds([...prevHolds, name]) };
        });
        setNewHoldName("");
        setSelectedProduct(name);
    }, [newHoldName, updateAdminData]);

    const confirmRemoveHold = useCallback(async (nameToRemove) => {
        const cnt = anglesSafe.filter((a) => a.hold === nameToRemove).length;
        const ok = await askConfirm(cnt > 0 ? `Delete "${nameToRemove}" and ${cnt} angle(s)?` : `Delete "${nameToRemove}"?`);
        if (!ok) return;

        updateAdminData((prev) => {
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
    }, [anglesSafe, askConfirm, editingHold, selectedProduct, updateAdminData]);

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

        updateAdminData((prev) => {
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
    }, [editingHoldName, holdsSafe, selectedProduct, updateAdminData]);

    const addAngleForHold = useCallback((holdName, saw) => {
        updateAdminData((prev) => ({
            ...prev,
            angles: [...(prev.angles || []), { id: cryptoRandomId(), hold: holdName, value: 0, saw }],
        }));
        setSelectedProduct(holdName);
    }, [updateAdminData]);

    const updateAngle = useCallback((id, patch) => {
        updateAdminData((prev) => ({
            ...prev,
            angles: (prev.angles || []).map((a) => (a.id === id ? { ...a, ...patch } : a)),
        }));
    }, [updateAdminData]);

    const removeAngle = useCallback(async (id) => {
        if (!(await askConfirm("Delete this angle?"))) return;
        updateAdminData((prev) => ({
            ...prev,
            angles: (prev.angles || []).filter((a) => a.id !== id),
        }));
    }, [askConfirm, updateAdminData]);

    const handleDrawingUpload = useCallback((e) => {
        const file = e.target.files?.[0];
        const angleId = uploadTargetIdRef.current;
        e.target.value = "";
        if (!file || !angleId) return;
        uploadTargetIdRef.current = null;

        compressImageFile(file)
            .then((dataUrl) => updateAngle(angleId, { drawing: dataUrl }))
            .catch((err) => {
                console.warn("Image upload failed:", err);
                toast.error("Could not process this image. Try another file.");
            });
    }, [updateAngle]);

    const handleHoldCoverUpload = useCallback((e) => {
        const file = e.target.files?.[0];
        const holdName = uploadHoldNameRef.current;
        e.target.value = "";
        uploadHoldNameRef.current = null;
        if (!file || !holdName) return;

        compressImageFile(file, 900, 0.85)
            .then((dataUrl) => {
                updateAdminData((prev) => ({
                    ...prev,
                    holdImages: {
                        ...(prev.holdImages || {}),
                        [holdName]: dataUrl,
                    },
                }));
            })
            .catch((err) => {
                console.warn("Cover upload failed:", err);
                toast.error("Could not process this image. Try another file.");
            });
    }, [updateAdminData]);

    const removeHoldCover = useCallback(async (holdName) => {
        if (!(await askConfirm("Remove hold cover image?"))) return;
        updateAdminData((prev) => {
            const next = { ...(prev.holdImages || {}) };
            delete next[holdName];
            return { ...prev, holdImages: next };
        });
    }, [askConfirm, updateAdminData]);

    const exportDb = useCallback(() => {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const dd = String(now.getDate()).padStart(2, "0");
        const hh = String(now.getHours()).padStart(2, "0");
        const min = String(now.getMinutes()).padStart(2, "0");
        const filename = `Base_${yyyy}-${mm}-${dd}_${hh}-${min}.json`;
        downloadJsonFile(draftData, filename);
    }, [draftData]);
    const triggerImportDb = useCallback(async () => {
        const ok = await askConfirm("Import will replace all current data. Continue?");
        if (ok) importDbInputRef.current?.click();
    }, [askConfirm]);

    const handleImportDb = useCallback(async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;

        // Guard against oversized files before reading them into memory.
        if (file.size / 1024 > MAX_DB_SIZE_KB) {
            toast.error(`Import too large: ${(file.size / 1024 / 1024).toFixed(1)}MB (max ${(MAX_DB_SIZE_KB / 1024).toFixed(1)}MB).`);
            return;
        }

        try {
            const parsed = await readJsonFile(file);
            const safe = migrateAndSanitize(parsed);
            if (!safe.holds?.length) {
                toast.error("Import failed: no holds found.");
                return;
            }

            // Sanitized payload must still fit in storage.
            if (serializedSizeKB(safe) > MAX_DB_SIZE_KB) {
                toast.error("Import too large after processing. Remove or compress some images.");
                return;
            }

            // P1: backup before import
            pushBackup(draftData);

            updateAdminData(safe);
            setSelectedProduct(null);
            toast.success("Database imported. Press SAVE to keep changes.");
        } catch (err) {
            console.warn(err);
            toast.error("Import failed: invalid JSON.");
        }
    }, [draftData, updateAdminData]);

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

    const selectedCover = selectedProduct ? (draftData?.holdImages?.[selectedProduct] || null) : null;

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

          /* Search pill compact on admin mobile */
          .admin-page-wrapper .searchPill {
            height: 34px !important;
            min-height: 34px !important;
            padding: 0 10px !important;
          }
          .admin-page-wrapper .searchPill input {
            min-height: 0 !important;
            height: 34px !important;
            font-size: 14px !important;
          }

          .adminFooter {
            position: fixed !important;
            bottom: 0 !important;
            left: 0 !important;
            right: 0 !important;
            z-index: 100 !important;
            background: #ffffff !important;
            border-top: 1px solid #e8e8e8 !important;
            padding: 10px 12px env(safe-area-inset-bottom, 0px) !important;
            gap: 8px !important;
          }
          /* Remove separator line from footerRow inside adminFooter */
          .adminFooter .footerRow {
            border-top: none !important;
            margin-top: 0 !important;
            padding-top: 0 !important;
          }
          .adminFooterMeta {
            font-size: 9px !important;
            line-height: 1.2 !important;
          }
          .admin-page-wrapper {
            padding-bottom: calc(180px + env(safe-area-inset-bottom, 0px)) !important;
          }
        }
        /* MOBILE ADAPTATION END */

        /* DESKTOP LOCK: no page sliding, only internal lists/tables scroll */
        @media (min-width: 901px) {
          html, body, #root {
            width: 100% !important;
            height: 100% !important;
            overflow: hidden !important;
          }
          .admin-page-wrapper {
            width: 100vw !important;
            height: 100vh !important;
            overflow: hidden !important;
          }
          .admin-grid-container {
            display: grid !important;
            grid-template-columns: minmax(180px, 220px) minmax(220px, 260px) minmax(220px, 1fr) minmax(220px, 1fr) !important;
            grid-template-rows: 1fr !important;
            width: 100% !important;
            max-width: 1500px !important;
            height: calc(100vh - clamp(24px, 6vw, 48px)) !important;
            overflow: hidden !important;
            margin: 0 auto !important;
          }
          .admin-grid-container > * {
            min-width: 0 !important;
            min-height: 0 !important;
            grid-row: auto !important;
            grid-column: auto !important;
          }
          .holdsList,
          .table {
            max-height: none !important;
            overflow-y: auto !important;
            overflow-x: hidden !important;
          }
          .card,
          .cardBody,
          .tableBody {
            min-height: 0 !important;
            overflow: hidden !important;
          }
        }
        
        button, [role="button"], input, select, label, a, summary {
          outline: none !important;
          -webkit-tap-highlight-color: transparent;
        }
        button:focus, button:focus-visible,
        [role="button"]:focus, [role="button"]:focus-visible,
        input:focus, input:focus-visible,
        input[type="checkbox"]:focus, input[type="checkbox"]:focus-visible,
        select:focus, select:focus-visible,
        label:focus, a:focus, a:focus-visible {
          outline: none !important;
          box-shadow: none !important;
        }
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

                        <div className="adminFooter" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={styles.footerRow}>
                                <button style={styles.btnGhost} onClick={handleExit}>BACK</button>
                                <input
                                    value={newHoldName}
                                    onChange={(e) => setNewHoldName(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && addHold()}
                                    placeholder="NEW"
                                    style={{ ...styles.input, flex: 1, minWidth: 0 }}
                                />
                                <button style={styles.btnPrimary} onClick={addHold}>+</button>
                            </div>

                            <button
                                type="button"
                                style={{ ...styles.btnGhost, width: "100%" }}
                                onClick={handleSave}
                                title="Save all changes"
                            >
                                <SaveIcon />
                                SAVE{hasUnsavedChanges ? " *" : ""}
                            </button>

                            <div style={{ display: "flex", gap: 8 }}>
                                <button style={{ ...styles.btnGhost, flex: 1 }} onClick={exportDb}>EXPORT</button>
                                <button style={{ ...styles.btnGhost, flex: 1 }} onClick={triggerImportDb}>IMPORT</button>
                            </div>

                            <div className="adminFooterMeta" style={{ fontSize: 11, color: theme.colors.textTertiary, lineHeight: 1.3 }}>
                                Import replaces all current data. Unsaved changes will be lost.
                            </div>

                            <div className="adminFooterMeta" style={{ fontSize: 11, color: theme.colors.textTertiary, lineHeight: 1.2 }}>
                                Last modified: {formatLastModified(lastModifiedMs)}
                            </div>

                            <div className="adminFooterMeta" style={{ fontSize: 11, color: theme.colors.textTertiary, lineHeight: 1.2 }}>
                                AVA Volumes © {new Date().getFullYear()} — v{APP_VERSION}
                            </div>
                        </div>
                    </div>
                </Card>

                {/* Hold panel */}
                <Card style={styles.card}>
                    <div style={styles.tableBody}>
                        <div style={styles.tableTitleCenter}>HOLD</div>

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
                                                onClick={() => setZoomedImage(selectedCover)}
                                                style={{
                                                    width: "100%",
                                                    maxHeight: 220,
                                                    objectFit: "contain",
                                                    border: `1px solid ${theme.colors.borderLight}`,
                                                    borderRadius: 6,
                                                    background: theme.colors.cardBg,
                                                    cursor: "zoom-in",
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
                                        style={styles.input}
                                        autoFocus
                                    />
                                    <div style={{ display: "flex", gap: 6 }}>
                                        <button style={styles.btnSmallPrimary} onClick={() => saveRenameHold(selectedProduct)}>Save</button>
                                        <button style={styles.btnSmallGhost} onClick={cancelRenameHold}>Cancel</button>
                                    </div>
                                </div>
                            )
                        ) : (
                            <div style={{ fontSize: 12, color: theme.colors.textMuted }}>Select a Hold</div>
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
                                            onUpdate={(patch) => updateAngle(a.id, patch)}
                                            onRemove={() => removeAngle(a.id)}
                                            onUpload={() => {
                                                uploadTargetIdRef.current = a.id;
                                                fileInputRef.current?.click();
                                            }}
                                            onRemoveImage={async () => {
                                                if (await askConfirm("Remove image?")) updateAngle(a.id, { drawing: null });
                                            }}
                                            onZoomImage={setZoomedImage}
                                        />
                                    ))}
                                    <button style={{ ...styles.btnGhost, marginTop: 6 }} onClick={() => addAngleForHold(selectedProduct, "main")}>
                                        + Add Main Angle
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
                                            onUpdate={(patch) => updateAngle(a.id, patch)}
                                            onRemove={() => removeAngle(a.id)}
                                            onUpload={() => {
                                                uploadTargetIdRef.current = a.id;
                                                fileInputRef.current?.click();
                                            }}
                                            onRemoveImage={async () => {
                                                if (await askConfirm("Remove image?")) updateAngle(a.id, { drawing: null });
                                            }}
                                            onZoomImage={setZoomedImage}
                                        />
                                    ))}
                                    <button style={{ ...styles.btnGhost, marginTop: 6 }} onClick={() => addAngleForHold(selectedProduct, "stefan")}>
                                        + Add Stefan Angle
                                    </button>
                                </>
                            ) : (
                                <div style={styles.tableEmpty} />
                            )}
                        </div>
                    </div>
                </Card>
            </div>

            {zoomedImage && (
                <div style={styles.zoomOverlay} onClick={() => setZoomedImage(null)}>
                    <button type="button" style={styles.zoomCloseBtn} onClick={(e) => { e.stopPropagation(); setZoomedImage(null); }}>×</button>
                    <img src={zoomedImage} alt="Zoomed" style={styles.zoomImage} onClick={(e) => e.stopPropagation()} />
                </div>
            )}

            {confirmState && (
                <ConfirmDialog
                    message={confirmState.message}
                    styles={styles}
                    onConfirm={() => closeConfirm(true)}
                    onCancel={() => closeConfirm(false)}
                />
            )}
        </div>
    );
}

function ConfirmDialog({ message, styles, onConfirm, onCancel }) {
    return (
        <div
            style={styles.confirmOverlay}
            onClick={onCancel}
        >
            <div
                style={styles.confirmCard}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                    if (e.key === "Enter") onConfirm();
                    if (e.key === "Escape") onCancel();
                }}
            >
                <div style={styles.confirmTitle}>CONFIRM ACTION</div>
                <div style={styles.confirmMessage}>{message}</div>
                <div style={styles.confirmActions}>
                    <button type="button" style={{ ...styles.btnPrimary, minWidth: 72 }} onClick={onConfirm} autoFocus>
                        OK
                    </button>
                    <button type="button" style={{ ...styles.btnGhost, minWidth: 84 }} onClick={onCancel}>
                        CANCEL
                    </button>
                </div>
            </div>
        </div>
    );
}

/* -------------------- ADMIN ROW: only angle value, no hold name -------------------- */
function AdminAngleRow({ angle, onUpdate, onRemove, onUpload, onRemoveImage, onZoomImage, styles }) {
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
        <div style={styles.adminAngleRow}>
            <span style={styles.adminAngleLabel}>{toAngleLabel(angle.value)}</span>

            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
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
                        <img 
                            src={angle.drawing} 
                            alt="" 
                            onClick={() => onZoomImage?.(angle.drawing)}
                            style={{ width: 28, height: 28, objectFit: "cover", borderRadius: 4, cursor: "zoom-in" }} 
                        />
                        <button
                            type="button"
                            style={{ ...styles.btnSmallGhost28, width: 28, padding: 0 }}
                            onClick={onRemoveImage}
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
        display: "flex",
        flexDirection: "column",
    },
    appHeader: {
        width: "100%",
        maxWidth: "1500px",
        margin: "0 auto",
        flex: "0 0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 2,
    },
    appHeaderTitle: {
        fontSize: "clamp(16px, 2.4vw, 20px)",
        fontWeight: 700,
        letterSpacing: "0.04em",
        color: theme.colors.textPrimary,
        textTransform: "uppercase",
        margin: 0,
    },
    appHeaderSubtitle: {
        fontSize: "clamp(11px, 1.6vw, 13px)",
        color: theme.colors.textSecondary,
        margin: 0,
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
    viewerTools: {
        position: "absolute",
        bottom: 12,
        right: 12,
        display: "flex",
        gap: 8,
    },
    viewerToolBtn: {
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
        padding: 0,
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
    confirmOverlay: {
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "rgba(0,0,0,0.32)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
    },
    confirmCard: {
        width: "100%",
        maxWidth: 360,
        background: theme.colors.cardBg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: 10,
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        boxSizing: "border-box",
    },
    confirmTitle: {
        fontSize: "clamp(10px, 2vw, 11px)",
        fontWeight: 700,
        letterSpacing: "0.05em",
        color: theme.colors.textTertiary,
        textAlign: "center",
    },
    confirmMessage: {
        fontSize: 13,
        lineHeight: 1.4,
        color: theme.colors.textPrimary,
        textAlign: "center",
        padding: "4px 0",
    },
    confirmActions: {
        display: "flex",
        gap: 8,
        justifyContent: "center",
        marginTop: 4,
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
        flex: "1 1 auto",
        minHeight: 0,
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
        gap: 6,
        padding: "2px 0", /* Reduced from "6px 0" */
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
        accentColor: theme.colors.textPrimary,
    },
    holdName: {
        fontSize: "clamp(12px, 2vw, 13px)",
        color: theme.colors.textPrimary,
        lineHeight: 1.3,
    },

    footerRow: {
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        alignItems: "center",
        paddingTop: 16,
        marginTop: 16,
        borderTop: `1px solid ${theme.colors.borderLight}`,
    },
    footerBtn: {
        flex: 1,
        minWidth: 70,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },

    btnGhost: {
        border: `1px solid ${theme.colors.buttonGhostBorder}`,
        background: theme.colors.buttonGhostBg,
        borderRadius: 4,
        height: 36,
        padding: "0 12px",
        boxSizing: "border-box",
        cursor: "pointer",
        fontSize: "clamp(11px, 2vw, 12px)",
        color: theme.colors.buttonGhostText,
        transition: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        textAlign: "center",
        lineHeight: 1,
    },
    btnDanger: {
        border: `1px solid ${theme.colors.borderMedium}`,
        background: theme.colors.buttonGhostBg,
        borderRadius: 4,
        height: 36,
        padding: "0 12px",
        boxSizing: "border-box",
        cursor: "pointer",
        fontSize: "clamp(11px, 2vw, 12px)",
        color: theme.colors.textSecondary,
        transition: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        textAlign: "center",
        lineHeight: 1,
    },
    btnPrimary: {
        border: `1px solid ${theme.colors.buttonPrimaryBorder}`,
        background: theme.colors.buttonPrimaryBg,
        borderRadius: 4,
        height: 36,
        padding: "0 14px",
        boxSizing: "border-box",
        cursor: "pointer",
        fontSize: "clamp(11px, 2vw, 12px)",
        color: theme.colors.buttonPrimaryText,
        transition: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        textAlign: "center",
        lineHeight: 1,
    },
    btnSmallGhost: {
        border: `1px solid ${theme.colors.buttonGhostBorder}`,
        background: theme.colors.buttonGhostBg,
        borderRadius: 4,
        height: 28,
        padding: "0 10px",
        boxSizing: "border-box",
        cursor: "pointer",
        fontSize: "clamp(10px, 2vw, 11px)",
        color: theme.colors.buttonGhostText,
        transition: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        textAlign: "center",
        lineHeight: 1,
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
        height: 28,
        padding: "0 10px",
        boxSizing: "border-box",
        cursor: "pointer",
        fontSize: "clamp(10px, 2vw, 11px)",
        color: theme.colors.buttonPrimaryText,
        transition: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        textAlign: "center",
        lineHeight: 1,
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
        gap: 4, /* Reduced from 10 */
        alignItems: "center",
        border: `1px solid ${theme.colors.borderLight}`,
        borderRadius: 4,
        padding: "3px 6px", /* Reduced from "8px 10px" */
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
        gap: 6,
        padding: "3px 0",
        cursor: "pointer",
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
        height: 36,
        padding: "0 10px",
        boxSizing: "border-box",
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
