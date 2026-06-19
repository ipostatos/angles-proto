import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { getSortedHoldNames, findHoldById } from './domain/migration.js';
import { loadState, loadLastModified, getAndResetDidRecover } from './storage/db.js';
import { getSession, login as apiLogin, logout as apiLogout } from './storage/auth.js';
import { saveWorkProgress, loadWorkProgress, clearWorkProgress, LS_WORK_PROGRESS_KEY } from './storage/workProgress.js';
import { useHashRoute } from './hooks/useHashRoute.js';
import { loadLastSeenChangeId, saveLastSeenChangeId } from './storage/changeNotifications.js';
import { SearchIcon, PrinterIcon, PhoneIcon } from './components/icons.jsx';
import { Card } from './components/Card.jsx';
import { ConfirmDialog } from './components/ConfirmDialog.jsx';
import { PasswordInput } from './components/PasswordInput.jsx';
import { PrintModeSelect } from './components/PrintModeSelect.jsx';
import { AngleTableCard } from './features/operator/AngleTableCard.jsx';
import { DrawingViewerCard } from './features/operator/DrawingViewerCard.jsx';
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

/* ===================== APP ===================== */

export default function App() {
    const route = useHashRoute();
    // Phase 2B: catalog is loaded async from GET /api/state. Start with an empty
    // safe catalog so the data-derived hooks below never see null; a loading/error
    // overlay gates rendering until the fetch resolves.
    const [data, setData] = useState(() => ({ version: 2, holds: [], angles: [] }));
    // Server revision used by AdminPage SAVE for optimistic locking.
    const [serverRevision, setServerRevision] = useState(null);
    // "loading" → "ready" | "error"
    const [loadStatus, setLoadStatus] = useState("loading");
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

    // Phase 2C: server-backed auth. currentUser comes from GET /api/session;
    // null = public viewer. sessionLoading gates only the admin entry, never the
    // public catalog (which renders as soon as the catalog load resolves).
    const [currentUser, setCurrentUser] = useState(null);
    const [latestChange, setLatestChange] = useState(null);
    const [sessionLoading, setSessionLoading] = useState(true);
    const [showDbChanged, setShowDbChanged] = useState(false);
    const [adminInitialView, setAdminInitialView] = useState("catalog");

    // username/password login modal (appears over the main page, no navigation)
    const [showLogin, setShowLogin] = useState(false);
    const [loginUser, setLoginUser] = useState("");
    const [loginPass, setLoginPass] = useState("");
    const [loginShake, setLoginShake] = useState(false);
    const [loginError, setLoginError] = useState("");
    const [loginLoading, setLoginLoading] = useState(false);
    const [showPass, setShowPass] = useState(false);

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
        if (currentUser) {
            window.location.hash = "#/admin";
        } else {
            setLoginUser("");
            setLoginPass("");
            setLoginError("");
            setShowLogin(true);
        }
    }, [currentUser]);

    // Phase 2C: who am I? Resolved once on mount from the session cookie. Runs
    // independently of the catalog load and must NOT gate the public page.
    useEffect(() => {
        let cancelled = false;
        getSession()
            .then(({ username, latestChange }) => {
                if (cancelled) return;
                setCurrentUser(username ?? null);
                setLatestChange(latestChange ?? null);
            })
            .catch((err) => {
                if (cancelled) return;
                console.warn("Session check failed:", err);
                setCurrentUser(null);
                setLatestChange(null);
            })
            .finally(() => { if (!cancelled) setSessionLoading(false); });
        return () => { cancelled = true; };
    }, []);

    const markLatestChangeSeen = useCallback(() => {
        const id = Number(latestChange?.id);
        if (Number.isFinite(id)) saveLastSeenChangeId(id);
        setShowDbChanged(false);
    }, [latestChange]);

    useEffect(() => {
        if (!currentUser || !latestChange) {
            setShowDbChanged(false);
            return;
        }
        const id = Number(latestChange.id);
        if (!Number.isFinite(id)) return;
        if (latestChange.username === currentUser) {
            saveLastSeenChangeId(id);
            setShowDbChanged(false);
            return;
        }
        setShowDbChanged(id > loadLastSeenChangeId());
    }, [currentUser, latestChange]);

    // Admin gate: a visitor on /admin without a session is bounced home and shown
    // the login form. We wait for the session check so a logged-in user reloading
    // straight onto /admin is never locked out before we know who they are.
    useEffect(() => {
        if (sessionLoading) return;
        if (route === "/admin" && !currentUser) {
            setLoginUser("");
            setLoginPass("");
            setLoginError("");
            setShowLogin(true);
            if (window.location.hash !== "#/" && window.location.hash !== "#") {
                window.location.hash = "#/";
            }
        }
    }, [route, currentUser, sessionLoading]);

    const submitLogin = useCallback(async () => {
        const username = loginUser.trim();
        const password = loginPass;
        const shake = (msg = "") => {
            setLoginError(msg);
            setLoginShake(true);
            setLoginPass("");
            setTimeout(() => setLoginShake(false), 600);
        };
        if (!username || !password) {
            shake("Enter username and password");
            return;
        }
        setLoginLoading(true);
        setLoginError("");
        try {
            // Credentials are verified ONLY by the server (/api/login); the
            // frontend never checks the password itself.
            const { username: who } = await apiLogin(username, password);
            setCurrentUser(who ?? username);
            setLatestChange(null);
            setShowLogin(false);
            setLoginPass("");
            setShowPass(false);
            window.location.hash = "#/admin";
        } catch (err) {
            console.warn("Login failed:", err);
            shake(err?.status === 401 ? "Invalid username or password" : "Sign-in error. Please try again.");
        } finally {
            setLoginLoading(false);
        }
    }, [loginUser, loginPass]);

    const handleLogout = useCallback(async () => {
        // Best-effort: clear server cookie, then lock the UI regardless.
        try { await apiLogout(); }
        catch (err) { console.warn("Logout request failed:", err); }
        setCurrentUser(null);
        setLatestChange(null);
        setShowLogin(false);
        window.location.hash = "#/";
    }, []);

    // Phase 2B: load the shared catalog from GET /api/state. On failure we show a
    // no-connection state (online-only — no localStorage fallback).
    const loadCatalog = useCallback(() => {
        setLoadStatus("loading");
        loadState()
            .then(({ data: serverData, revision }) => {
                setData(serverData);
                setServerRevision(revision);
                setLoadStatus("ready");
            })
            .catch((err) => {
                console.warn("Failed to load catalog from /api/state:", err);
                setLoadStatus("error");
            });
    }, []);

    useEffect(() => { loadCatalog(); }, [loadCatalog]);

    // Surface a one-time warning if stored data was unreadable and we recovered.
    useEffect(() => {
        if (getAndResetDidRecover()) {
            toast.error("Some saved data was unreadable and has been reset.", { duration: 6000 });
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
            .map(a => {
                const h = findHoldById(data.holds, a.holdId);
                // `hold` kept for the table cell; holdName/holdCoverImage carry the
                // metadata the drawing viewer needs so it never has to re-derive
                // which hold an active row belongs to.
                return {
                    ...a,
                    hold: h?.name ?? '',
                    holdName: h?.name ?? '',
                    holdCoverImage: h?.coverImage,
                };
            });

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
    }, [data.angles, data.holds, selectedHolds, mainSort, stefanSort]);

    // The active row, resolved from the *visible* aggregated rows so it always
    // carries holdName/holdCoverImage and disappears if its hold is deselected.
    const activeRow = useMemo(() => {
        if (!activeAngleId) return null;
        return (
            selectedAngles.main.find((r) => r.id === activeAngleId) ||
            selectedAngles.stefan.find((r) => r.id === activeAngleId) ||
            null
        );
    }, [selectedAngles, activeAngleId]);

    const viewerSrc = useMemo(() => {
        // Row-driven: a tapped angle shows its own drawing, else its hold's cover.
        // We never guess an image for a multi-hold selection — that is left blank
        // with an explanatory placeholder (see viewerEmptyText).
        if (activeRow) {
            if (activeRow.drawing) return activeRow.drawing;
            return activeRow.holdCoverImage || null;
        }
        // Nothing tapped: a single selected hold shows its blueprint.
        if (selectedHolds.size === 1) {
            const holdId = Array.from(selectedHolds)[0];
            return findHoldById(data.holds, holdId)?.coverImage || null;
        }
        return null;
    }, [activeRow, selectedHolds, data.holds]);

    // Placeholder shown only when viewerSrc is null. Three distinct cases:
    // a tapped row with no image, a multi-hold selection awaiting a tap, or
    // the plain single-hold/no-selection case.
    const viewerEmptyText = useMemo(() => {
        if (activeRow) {
            return `No drawing or cover for ${activeRow.holdName || 'this hold'}.`;
        }
        if (selectedHolds.size > 1) {
            return "Multiple holds selected. Tap an angle row in MAIN/STEFAN to show the drawing or cover for that hold.";
        }
        return "no drawing uploaded";
    }, [activeRow, selectedHolds]);

    // P1: useCallback handlers
    const toggleHold = useCallback((name) => {
        setSelectedHolds((prev) => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });
    }, []);

    // Print just the current drawing. We flip the page into a print-only
    // single-image layout (body.printing-drawing) and call window.print()
    // *synchronously* inside the tap. The hidden <img.print-drawing-img> is
    // already mounted with viewerSrc, so the print view paints immediately and
    // there is no async img.onload — that async gap is what made iOS Safari
    // block this as an "automatic" print. afterprint / matchMedia restore the UI.
    const printDrawing = useCallback((src) => {
        if (!src) return;
        document.body.classList.add("printing-drawing");
        const mql = typeof window.matchMedia === "function" ? window.matchMedia("print") : null;
        let cleaned = false;
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            document.body.classList.remove("printing-drawing");
            window.removeEventListener("afterprint", cleanup);
            mql?.removeEventListener?.("change", onMqlChange);
        };
        function onMqlChange(e) { if (!e.matches) cleanup(); }
        window.addEventListener("afterprint", cleanup);
        mql?.addEventListener?.("change", onMqlChange);
        window.print();
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

    if (loadStatus === "loading") {
        return (
            <div style={styles.page} className="app-page">
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: theme.colors.textMuted, fontSize: 14 }}>
                    Loading…
                </div>
            </div>
        );
    }

    if (loadStatus === "error") {
        return (
            <div style={styles.page} className="app-page">
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", gap: 12, alignItems: "center", justifyContent: "center", padding: 20, textAlign: "center" }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: theme.colors.textPrimary }}>No connection to the server</div>
                    <div style={{ fontSize: 12, color: theme.colors.textMuted, maxWidth: 280, lineHeight: 1.5 }}>
                        Could not load the catalog. Check your connection and try again.
                    </div>
                    <button type="button" style={styles.btnPrimary} onClick={loadCatalog}>Retry</button>
                </div>
            </div>
        );
    }

    if (route === "/admin" && currentUser) {
        return (
            <AdminPage
                data={data}
                setData={setData}
                serverRevision={serverRevision}
                onCatalogSaved={({ data: savedData, revision }) => {
                    setData(savedData);
                    setServerRevision(revision);
                    setLastModifiedMs(loadLastModified());
                }}
                initialView={adminInitialView}
                onHistoryViewed={markLatestChangeSeen}
                currentUser={currentUser}
                onLogout={handleLogout}
                onExit={() => {
                    setShowLogin(false);
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

        .print-drawing-wrap {
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

          /* Single-drawing print: hide the table sheet, show only the image. */
          body.printing-drawing .main-grid,
          body.printing-drawing .print-sheet {
            display: none !important;
          }
          body.printing-drawing .print-drawing-wrap {
            display: block !important;
            text-align: center !important;
            width: 100% !important;
          }
          body.printing-drawing .print-drawing-wrap img {
            max-width: 100% !important;
            max-height: 95vh !important;
            object-fit: contain !important;
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

          /* MAIN/STEFAN tables: narrower and centered on mobile, not full-bleed */
          .main-grid > .angleTableCard {
            width: 100% !important;
            max-width: 360px !important;
            margin-left: auto !important;
            margin-right: auto !important;
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
             padding: 10px 12px max(16px, env(safe-area-inset-bottom, 0px)) !important;
             background: #ffffff !important;
             border-top: 1px solid #e8e8e8 !important;
             align-items: center !important;
          }
          /* Compensate for fixed footer height */
          .app-page {
             padding-bottom: calc(64px + max(16px, env(safe-area-inset-bottom, 0px))) !important;
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
          -webkit-tap-highlight-color: transparent;
        }
        /* Suppress the focus ring for pointer interaction only — :focus without
           :focus-visible is mouse/touch. Keyboard focus keeps a visible ring
           below for accessibility. */
        button:focus:not(:focus-visible),
        [role="button"]:focus:not(:focus-visible),
        input:focus:not(:focus-visible),
        select:focus:not(:focus-visible),
        label:focus:not(:focus-visible),
        a:focus:not(:focus-visible),
        summary:focus:not(:focus-visible) {
          outline: none !important;
          box-shadow: none !important;
        }
        button:focus-visible,
        [role="button"]:focus-visible,
        a:focus-visible,
        summary:focus-visible {
          outline: 2px solid ${theme.colors.textPrimary} !important;
          outline-offset: 2px !important;
        }
        /* No focus ring on text fields / search inputs. */
        input:focus,
        input:focus-visible,
        select:focus,
        select:focus-visible {
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
                            <div style={styles.savedWorkCard}>
                                <div style={styles.savedWorkText}>
                                    <strong>Saved work</strong><br />
                                    {formatLastModified(savedProgress.savedAt)}
                                </div>
                                <div style={styles.savedWorkActions}>
                                    <button style={{ ...styles.btnSmallGhost, ...styles.savedWorkResumeBtn }} onClick={resumeProgress}>Resume</button>
                                    <button style={{ ...styles.btnSmallGhost }} onClick={() => setShowDiscardProgressConfirm(true)}>✕</button>
                                </div>
                            </div>
                        )}

                        <div style={styles.holdsList} className="holdsList">
                            {visibleHolds.map((h) => {
                                const isSelected = selectedHolds.has(h.id);
                                return (
                                    <label
                                        key={h.id}
                                        style={isSelected ? { ...styles.holdRow, ...styles.holdRowSelected } : styles.holdRow}
                                        className="holdRow"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleHold(h.id)}
                                            style={styles.checkbox}
                                            className="holdCheckbox"
                                        />
                                        <span
                                            style={isSelected ? { ...styles.holdName, ...styles.holdNameSelected } : styles.holdName}
                                            className="holdName"
                                        >
                                            {h.name}
                                        </span>
                                    </label>
                                );
                            })}
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
                <AngleTableCard
                    title="MAIN"
                    rows={selectedAngles.main}
                    sortDirection={mainSort}
                    onCycleSort={cycleSortMain}
                    onPick={setActiveAngleId}
                    activeId={activeAngleId}
                    styles={styles}
                />

                {/* Stefan table */}
                <AngleTableCard
                    title="STEFAN"
                    rows={selectedAngles.stefan}
                    sortDirection={stefanSort}
                    onCycleSort={cycleSortStefan}
                    onPick={setActiveAngleId}
                    activeId={activeAngleId}
                    styles={styles}
                />

                {/* Viewer */}
                <DrawingViewerCard
                    src={viewerSrc}
                    onPrint={printDrawing}
                    onZoom={setZoomedImage}
                    styles={styles}
                    theme={theme}
                    emptyText={viewerEmptyText}
                />
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

            {/* Print-only single-drawing layout. Hidden by default; the per-drawing
                print button flips body.printing-drawing to show only this image. */}
            <div className="print-drawing-wrap" aria-hidden="true">
                {viewerSrc ? <img className="print-drawing-img" src={viewerSrc} alt="drawing" /> : null}
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

            {showDbChanged && latestChange && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(0,0,0,0.32)",
                        backdropFilter: "blur(3px)",
                        WebkitBackdropFilter: "blur(3px)",
                        zIndex: 9998,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 20,
                    }}
                >
                    <div
                        style={{
                            width: "100%",
                            maxWidth: 320,
                            background: theme.colors.cardBg,
                            border: `1px solid ${theme.colors.border}`,
                            borderRadius: 8,
                            padding: 24,
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                            boxSizing: "border-box",
                            textAlign: "center",
                        }}
                    >
                        <div style={{ ...styles.adminTitle, marginBottom: 4, textAlign: "center" }}>CATALOG CHANGED</div>
                        <div style={{ fontSize: 13, color: theme.colors.textPrimary, lineHeight: 1.5 }}>
                            {latestChange.username || "Someone"} changed the catalog
                        </div>
                        <button
                            type="button"
                            style={{ ...styles.btnPrimary, alignSelf: "center", minWidth: 80 }}
                            onClick={() => {
                                markLatestChangeSeen();
                                setAdminInitialView("history");
                                window.location.hash = "#/admin";
                            }}
                        >
                            OK
                        </button>
                    </div>
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
                        <div style={{ ...styles.adminTitle, marginBottom: 4, textAlign: "center" }}>SIGN IN</div>
                        <input
                            value={loginUser}
                            onChange={(e) => setLoginUser(e.target.value)}
                            placeholder="Username"
                            className="login-modal-input"
                            autoFocus
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            style={{ ...styles.input, textAlign: "center", background: theme.colors.inputBg, boxShadow: "none" }}
                        />
                        <PasswordInput value={loginPass} onChange={setLoginPass} show={showPass} onToggle={() => setShowPass(v => !v)} placeholder="Password" styles={styles} />
                        <div style={{ fontSize: 11, color: theme.colors.textTertiary, textAlign: "center" }}>
                            Tomek · Alessandro · Artsi
                        </div>
                        {loginError && (
                            <div style={{ fontSize: 11, color: "#e53e3e", textAlign: "center", marginTop: -4 }}>
                                {loginError}
                            </div>
                        )}
                        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                            <button type="button" style={{ ...styles.btnPrimary, minWidth: 60, opacity: loginLoading ? 0.6 : 1 }} onClick={submitLogin} disabled={loginLoading}>
                                {loginLoading ? "…" : "Sign in"}
                            </button>
                            <button type="button" style={styles.btnGhost} onClick={() => setShowLogin(false)}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

