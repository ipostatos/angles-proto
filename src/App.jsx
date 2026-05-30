import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { clamp, toAngleLabel } from './domain/angles.js';
import { normalizeHoldName as normalizeHoldNameSafe, sanitizeHoldList } from './domain/holds.js';
import { isSafeRasterDataUrl, isStrongAdminPassword, WEAK_PINS } from './domain/validation.js';
import { migrateAndSanitize, unwrapImportedDb, LS_VERSION, DEFAULT_HOLDS, getSortedHoldNames, findHoldById, findHoldByName } from './domain/migration.js';
import { loadState, saveState, loadLastModified, touchLastModified, getAndResetDidRecover, LS_KEY, MAX_DB_SIZE_KB } from './storage/db.js';
import { pushBackup, LS_BACKUPS_KEY } from './storage/backups.js';
import { hasAdminSession, sha256Hex, ADMIN_HASH_KEY, ADMIN_SESSION_KEY, ADMIN_REMEMBER_KEY } from './storage/auth.js';
import { saveWorkProgress, loadWorkProgress, clearWorkProgress, LS_WORK_PROGRESS_KEY } from './storage/workProgress.js';
import { downloadJsonFile, readJsonFile, serializedSizeKB } from './storage/importExport.js';
import { compressImageFile, printImage } from './utils/image.js';
import { SearchIcon, PrinterIcon, SaveIcon, ZoomIcon, PhoneIcon, SortIcon } from './components/icons.jsx';
import { Card } from './components/Card.jsx';
import { ConfirmDialog } from './components/ConfirmDialog.jsx';
import { PasswordInput } from './components/PasswordInput.jsx';
import { PrintModeSelect } from './components/PrintModeSelect.jsx';
import { AngleTable } from './components/AngleTable.jsx';
import { PrintTableSection, PRINT_MAX_COLUMNS_ALL, PRINT_MAX_COLUMNS_SINGLE } from './components/PrintSheet.jsx';
import { WorkModeOverlay } from './components/WorkModeOverlay.jsx';
import { AdminPage, formatLastModified } from './components/AdminPage.jsx';
import { theme, getStyles } from './styles/theme.js';

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


function useHashRoute() {
    const [hash, setHash] = useState(() => window.location.hash || "#/");
    useEffect(() => {
        const onHash = () => setHash(window.location.hash || "#/");
        window.addEventListener("hashchange", onHash);
        return () => window.removeEventListener("hashchange", onHash);
    }, []);
    return hash.replace("#", "");
}


/* ===================== APP ===================== */

export default function App() {
    const route = useHashRoute();
    const [data, setData] = useState(() => loadState());
    const [selectedHolds, setSelectedHolds] = useState(() => new Set());
    const [activeAngleId, setActiveAngleId] = useState(null);
    const [checkedAngles, setCheckedAngles] = useState(() => new Set());

    const toggleAngleCheck = useCallback((id, e) => {
        e.stopPropagation();
        setCheckedAngles(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);
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
    const [loginShake, setLoginShake] = useState(false);
    const [loginMode, setLoginMode] = useState("login"); // "login" | "setup"
    const [loginError, setLoginError] = useState("");
    const [showPass, setShowPass] = useState(false);
    const [rememberMe, setRememberMe] = useState(false);
    // Keeps admin mounted after one-time session token is consumed on AdminPage mount
    const [adminAuthed, setAdminAuthed] = useState(false);
    const prevRouteRef = useRef(null);

    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const [workMode, setWorkMode] = useState(false);
    const [savedProgress, setSavedProgress] = useState(() => loadWorkProgress());
    const [showExitWorkConfirm, setShowExitWorkConfirm] = useState(false);
    const [showSavedModal, setShowSavedModal] = useState(false);
    const [showDiscardProgressConfirm, setShowDiscardProgressConfirm] = useState(false);
    const [workTheme, setWorkTheme] = useState(() => {
        try { return localStorage.getItem("angles_work_theme") || "light"; } catch { return "light"; }
    });

    const openAdmin = useCallback(() => {
        if (hasAdminSession()) {
            window.location.hash = "#/admin";
        } else {
            setLoginPass("");
            setLoginError("");
            let storedHash = null;
            try { storedHash = localStorage.getItem(ADMIN_HASH_KEY); } catch { }
            setLoginMode(storedHash ? "login" : "setup");
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
            if (rememberMe) {
                try { localStorage.setItem(ADMIN_REMEMBER_KEY, "1"); } catch { }
            } else {
                try { localStorage.removeItem(ADMIN_REMEMBER_KEY); } catch { }
            }
            setAdminAuthed(true);
            setShowLogin(false);
            setLoginPass("");
            setShowPass(false);
            window.location.hash = "#/admin";
        };

        const shake = (msg = "") => {
            setLoginError(msg);
            setLoginShake(true);
            setLoginPass("");
            setTimeout(() => setLoginShake(false), 600);
        };

        try {
            if (!storedHash) {
                if (!isStrongAdminPassword(loginPass)) {
                    shake("4 digits, not all the same");
                    return;
                }
                try {
                    localStorage.setItem(ADMIN_HASH_KEY, await sha256Hex(loginPass));
                } catch {
                    shake("Не удалось сохранить пароль");
                    return;
                }
                finish();
                return;
            }

            const hash = await sha256Hex(loginPass);
            if (loginUser === "admin" && hash === storedHash) {
                setLoginError("");
                finish();
            } else {
                shake();
            }
        } catch (err) {
            console.warn("Login failed:", err);
            shake();
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
        if (getAndResetDidRecover()) {
            toast.error("Saved data was unreadable...", { duration: 6000 });
        }
    }, []);

    useEffect(() => {
        if (activeAngleId && !data.angles.some((a) => a.id === activeAngleId)) {
            setActiveAngleId(null);
        }
    }, [data.angles, activeAngleId]);

    const sortedHolds = useMemo(() => getSortedHoldNames(data.holds || []), [data.holds]);

    const visibleHolds = useMemo(() => {
        const q = holdSearch.trim().toLowerCase();
        if (!q) return sortedHolds;
        return sortedHolds.filter((h) => h.name.toLowerCase().includes(q));
    }, [sortedHolds, holdSearch]);

    const selectedAngles = useMemo(() => {
        const holdsSet = selectedHolds;
        const all = data.angles
            .filter((a) => holdsSet.has(a.holdId))
            .map(a => ({ ...a, hold: findHoldById(data.holds, a.holdId)?.name ?? '' }));

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
            const holdId = Array.from(selectedHolds)[0];
            const hold = findHoldById(data.holds, holdId);
            const cover = hold?.coverImage;
            if (cover) return cover;
        }
        return null;
    }, [activeAngle, selectedHolds, data.holds]);

    // P1: useCallback handlers
    const toggleHold = useCallback((name) => {
        setSelectedHolds((prev) => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });
    }, []);

    const saveProgress = useCallback(() => {
        saveWorkProgress(selectedHolds, checkedAngles, printMode);
        setSavedProgress(loadWorkProgress());
        setShowSavedModal(true);
        setTimeout(() => setShowSavedModal(false), 1500);
    }, [selectedHolds, checkedAngles, printMode]);

    const resumeProgress = useCallback(() => {
        const p = savedProgress;
        if (!p) return;
        // Guard: if holds look like names (not h_ prefixed), discard stale progress
        const holdsToSet = p.holds.filter(id => typeof id === 'string' && id.startsWith('h_'));
        if (holdsToSet.length === 0 && p.holds.length > 0) {
            // stale v1 progress — discard silently
            clearWorkProgress();
            setSavedProgress(null);
            return;
        }
        setSelectedHolds(new Set(holdsToSet));
        setCheckedAngles(new Set(p.checked));
        setPrintMode(p.mode || "all");
        setWorkMode(true);
        setSavedProgress(null);
    }, [savedProgress]);

    const finishWork = useCallback(() => {
        clearWorkProgress();
        setCheckedAngles(new Set());
        setWorkMode(false);
        setSavedProgress(null);
        setShowExitWorkConfirm(false);
    }, []);

    const exitWorkMode = useCallback(() => {
        if (checkedAngles.size > 0) {
            setShowExitWorkConfirm(true);
        } else {
            clearWorkProgress();
            setWorkMode(false);
        }
    }, [checkedAngles]);

    // Intercept browser back button while in work mode
    useEffect(() => {
        if (!workMode) return;
        window.history.pushState({ workMode: true }, "");
        const onPop = (e) => {
            e.preventDefault();
            exitWorkMode();
        };
        window.addEventListener("popstate", onPop);
        return () => window.removeEventListener("popstate", onPop);
    }, [workMode, exitWorkMode]);

    // Clear search when a hold is added so the full list reappears
    const prevSizeRef = useRef(0);
    useEffect(() => {
        const size = selectedHolds.size;
        if (size > prevSizeRef.current) setHoldSearch("");
        prevSizeRef.current = size;
    }, [selectedHolds]);

    // Auto-save work progress when in work mode
    useEffect(() => {
        if (workMode) saveWorkProgress(selectedHolds, checkedAngles, printMode);
    }, [checkedAngles, workMode, selectedHolds, printMode]);

    const clearSelection = useCallback(() => {
        setShowClearConfirm(true);
    }, []);

    const confirmClear = useCallback(() => {
        setSelectedHolds(new Set());
        setActiveAngleId(null);
        setCheckedAngles(new Set());
        setShowClearConfirm(false);
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
          
          /* Search Bar: fixed at top */
          .searchWrap {
             position: fixed !important;
             top: 0 !important;
             left: 0 !important;
             right: 0 !important;
             z-index: 50 !important;
             background: #f5f7fa !important;
             padding: 8px 12px 4px !important;
          }
          .searchFade {
             display: block !important;
             position: fixed !important;
             top: 40px !important;
             left: 0 !important;
             right: 0 !important;
             height: 28px !important;
             background: linear-gradient(to bottom, #f5f7fa 30%, rgba(245,247,250,0) 100%) !important;
             z-index: 49 !important;
             pointer-events: none !important;
          }
          /* Offset the card body so content starts below the fixed search */
          .holdsCardBody {
             padding-top: calc(28px + 15px) !important;
          }
          .searchPill {
             height: 28px !important;
             min-height: 28px !important;
             border: 1px solid #e0e0e0 !important;
             background: #fff !important;
             margin-bottom: 0 !important;
             display: flex !important;
             align-items: center !important;
             padding: 0 10px !important;
          }
          .searchInput {
             font-size: 13px !important;
             height: 28px !important;
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

          /* Touch targets — only footer/primary actions get 44px, not all buttons */
          button, input, [role="button"] {
            touch-action: manipulation;
          }
          .footerBtn, .footerRow button, .footerRow select {
            min-height: 44px !important;
          }
          input[type="text"], input[type="password"], input[type="search"] {
            min-height: 44px;
          }
          /* All buttons: strict square shape, no oval */
          button {
            min-height: 0 !important;
            height: auto;
          }
          /* Viewer tool buttons and zoom close */
          .viewerToolBtn, .zoomCloseBtn {
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

            <div className="searchFade" style={{ display: "none" }} />
            <div style={styles.grid} className="main-grid">
                {/* Left: holds */}
                <Card data-print-hide style={styles.card}>
                    <div style={styles.cardBody} className="holdsCardBody">
                        <div style={styles.searchWrap} className="searchWrap">
                            <div
                                style={styles.searchPill}
                                role="search"
                                className="searchPill"
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

                        {savedProgress && (
                            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, padding: "8px 10px", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                                <div style={{ fontSize: 11, color: "#166534", lineHeight: 1.4 }}>
                                    <strong>Saved work</strong><br />
                                    {formatLastModified(savedProgress.savedAt)}
                                </div>
                                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                                    <button style={{ ...styles.btnSmallGhost, background: "#166534", color: "#fff", border: "none" }} onClick={resumeProgress}>Resume</button>
                                    <button style={{ ...styles.btnSmallGhost }} onClick={() => setShowDiscardProgressConfirm(true)}>✕</button>
                                </div>
                            </div>
                        )}

                        <div style={styles.holdsList} className="holdsList">
                            {visibleHolds.map((h) => (
                                <label key={h.id} style={styles.holdRow} className="holdRow">
                                    <input
                                        type="checkbox"
                                        checked={selectedHolds.has(h.id)}
                                        onChange={() => toggleHold(h.id)}
                                        style={styles.checkbox}
                                        className="holdCheckbox"
                                    />
                                    <span style={styles.holdName} className="holdName">{h.name}</span>
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
                                onClick={() => setWorkMode(true)}
                                title="Work mode"
                                aria-label="Work mode"
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
                                <PhoneIcon />
                            </button>

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

            {workMode && (
                <WorkModeOverlay
                    main={selectedAngles.main}
                    stefan={selectedAngles.stefan}
                    checkedAngles={checkedAngles}
                    onToggleCheck={toggleAngleCheck}
                    onExit={exitWorkMode}
                    onSave={saveProgress}
                    styles={styles}
                    showSaved={showSavedModal}
                    theme={workTheme}
                    onToggleTheme={() => {
                        const next = workTheme === "light" ? "dark" : "light";
                        setWorkTheme(next);
                        try { localStorage.setItem("angles_work_theme", next); } catch {}
                    }}
                />
            )}

            {showExitWorkConfirm && (
                <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
                    <div style={{ background: "#fff", borderRadius: 10, padding: 24, maxWidth: 300, width: "100%", display: "flex", flexDirection: "column", gap: 12, boxSizing: "border-box" }}>
                        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", color: "#888", textAlign: "center" }}>EXIT WORK MODE</div>
                        <div style={{ fontSize: 13, color: "#1a1a1a", textAlign: "center", lineHeight: 1.5 }}>Keep progress for tomorrow?</div>
                        <button style={{ ...styles.btnPrimary, height: 44 }} onClick={() => { saveWorkProgress(selectedHolds, checkedAngles, printMode); setSavedProgress(loadWorkProgress()); setWorkMode(false); setShowExitWorkConfirm(false); }}>Keep &amp; exit</button>
                        <button style={{ ...styles.btnGhost, height: 44 }} onClick={finishWork}>Clear &amp; exit</button>
                        <button style={{ ...styles.btnGhost, height: 36, fontSize: 12, color: "#999" }} onClick={() => setShowExitWorkConfirm(false)}>Back</button>
                    </div>
                </div>
            )}

            {showDiscardProgressConfirm && (
                <ConfirmDialog
                    message="Discard saved progress?"
                    styles={styles}
                    onConfirm={() => { clearWorkProgress(); setSavedProgress(null); setCheckedAngles(new Set()); setShowDiscardProgressConfirm(false); }}
                    onCancel={() => setShowDiscardProgressConfirm(false)}
                />
            )}

            {showClearConfirm && (
                <ConfirmDialog
                    message="Clear selection?"
                    styles={styles}
                    onConfirm={confirmClear}
                    onCancel={() => setShowClearConfirm(false)}
                />
            )}

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
                        @keyframes loginShake {
                            0%   { transform: translateX(0); }
                            15%  { transform: translateX(-8px); }
                            35%  { transform: translateX(7px); }
                            55%  { transform: translateX(-5px); }
                            75%  { transform: translateX(4px); }
                            90%  { transform: translateX(-2px); }
                            100% { transform: translateX(0); }
                        }
                        .login-modal-shake {
                            animation: loginShake 0.55s ease;
                        }
                        .login-modal-error .login-modal-input {
                            border-color: #e53e3e !important;
                            background: #fff5f5 !important;
                        }
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
                        className={`${loginShake ? "login-modal-shake login-modal-error" : ""}`}
                        style={{
                            width: "100%",
                            maxWidth: 300,
                            background: theme.colors.cardBg,
                            border: `1px solid ${loginShake ? "#e53e3e" : theme.colors.border}`,
                            borderRadius: 8,
                            padding: 24,
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                            boxSizing: "border-box",
                        }}
                    >
                        {loginMode === "setup" ? (
                            <>
                                <div style={{ textAlign: "center" }}>
                                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={theme.colors.textPrimary} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 8 }}>
                                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                    </svg>
                                    <div style={{ ...styles.adminTitle, marginBottom: 4, textAlign: "center" }}>FIRST LOGIN</div>
                                    <div style={{ fontSize: 12, color: theme.colors.textSecondary, lineHeight: 1.5 }}>
                                        Create a 4-digit admin PIN.
                                    </div>
                                </div>
                                <PasswordInput value={loginPass} onChange={(v) => { if (/^\d{0,4}$/.test(v)) setLoginPass(v); }} show={showPass} onToggle={() => setShowPass(v => !v)} placeholder="PIN" styles={styles} inputMode="numeric" maxLength={4} />
                                {loginError && (
                                    <div style={{ fontSize: 11, color: "#e53e3e", textAlign: "center", marginTop: -4 }}>
                                        {loginError}
                                    </div>
                                )}
                                <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 4 }}>
                                    <button type="button" style={{ ...styles.btnPrimary, minWidth: 60 }} onClick={submitLogin}>SET</button>
                                    <button type="button" style={styles.btnGhost} onClick={() => setShowLogin(false)}>CANCEL</button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div style={{ ...styles.adminTitle, marginBottom: 4, textAlign: "center" }}>ADMIN</div>
                                <input
                                    value={loginUser}
                                    onChange={(e) => setLoginUser(e.target.value)}
                                    placeholder="LOGIN"
                                    className="login-modal-input"
                                    style={{ ...styles.input, textAlign: "center", background: theme.colors.inputBg, boxShadow: "none" }}
                                />
                                <PasswordInput value={loginPass} onChange={setLoginPass} show={showPass} onToggle={() => setShowPass(v => !v)} placeholder="Password" styles={styles} autoFocus />
                                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", justifyContent: "center" }}>
                                    <input
                                        type="checkbox"
                                        checked={rememberMe}
                                        onChange={(e) => setRememberMe(e.target.checked)}
                                        style={{ width: 14, height: 14, cursor: "pointer", accentColor: theme.colors.textPrimary }}
                                    />
                                    <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>Remember me</span>
                                </label>
                                <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                                    <button type="button" style={{ ...styles.btnPrimary, minWidth: 60 }} onClick={submitLogin}>OK</button>
                                    <button type="button" style={styles.btnGhost} onClick={() => setShowLogin(false)}>CANCEL</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

