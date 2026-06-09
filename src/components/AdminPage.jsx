import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { clamp, toAngleLabel } from '../domain/angles.js';
import { getSortedHoldNames, generateHoldId, migrateAndSanitize } from '../domain/migration.js';
import { saveState, MAX_DB_SIZE_KB, serializedSizeKB } from '../storage/db.js';
import { pushBackup } from '../storage/backups.js';
import { downloadJsonFile, readJsonFile } from '../storage/importExport.js';
import { loadHistory } from '../storage/history.js';
import { compressImageFile } from '../utils/image.js';
import { SaveIcon } from './icons.jsx';
import { ConfirmDialog } from './ConfirmDialog.jsx';
import { SearchIcon } from './icons.jsx';
import { Card } from './Card.jsx';
import { theme, getStyles } from '../styles/theme.js';

const APP_VERSION = "1.5";

function cryptoRandomId() {
    try {
        return globalThis.crypto?.randomUUID?.() ?? `id_${Math.random().toString(16).slice(2)}`;
    } catch {
        return `id_${Math.random().toString(16).slice(2)}`;
    }
}

export function formatLastModified(ms) {
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

function formatHistoryDate(value) {
    if (!value) return "—";
    const ts = Date.parse(value);
    if (!Number.isFinite(ts)) return "—";
    return formatLastModified(ts);
}

function formatHistoryAction(row) {
    const action = String(row?.action || '');
    const labels = {
        hold_added: "Hold added",
        hold_renamed: "Hold renamed",
        hold_deleted: "Hold deleted",
        angle_added: "Angle added",
        angle_changed: "Angle changed",
        angle_deleted: "Angle deleted",
    };
    return labels[action] || action || "Change";
}

function formatHistoryChange(row) {
    const oldValue = row?.oldValue;
    const newValue = row?.newValue;
    if (oldValue == null && newValue == null) return "—";
    if (oldValue == null) return `+ ${newValue}`;
    if (newValue == null) return `${oldValue} → deleted`;
    return `${oldValue} → ${newValue}`;
}


/* -------------------- ADMIN ROW: only angle value, no hold name -------------------- */
export function AdminAngleRow({ angle, onUpdate, onRemove, onUpload, onRemoveImage, onZoomImage, styles }) {
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

/* ===================== ADMIN PAGE ===================== */
export function AdminPage({ data, setData, serverRevision, onCatalogSaved, initialView = "catalog", onHistoryViewed, onExit, onLogout, currentUser, lastModifiedMs }) {
    const styles = useMemo(() => getStyles(theme), []);

    const [draftData, setDraftData] = useState(() => data);

    const holdsSafe = useMemo(() => getSortedHoldNames(Array.isArray(draftData?.holds) ? draftData.holds : []), [draftData]);
    const anglesSafe = useMemo(() => Array.isArray(draftData?.angles) ? draftData.angles : [], [draftData]);

    const [selectedProduct, setSelectedProduct] = useState(null);
    const [newHoldName, setNewHoldName] = useState("");
    const [editingHold, setEditingHold] = useState(null);
    const [editingHoldName, setEditingHoldName] = useState("");
    const [zoomedImage, setZoomedImage] = useState(null);
    const [confirmState, setConfirmState] = useState(null);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [saving, setSaving] = useState(false);
    const [adminView, setAdminView] = useState(initialView === "history" ? "history" : "catalog");
    const [historyRows, setHistoryRows] = useState([]);
    const [historyStatus, setHistoryStatus] = useState("idle");
    // Mobile: history rows collapse to entity + change; tapping expands full detail.
    const [expandedHistory, setExpandedHistory] = useState(() => new Set());
    const toggleHistoryRow = useCallback((id) => {
        setExpandedHistory((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }, []);
    const confirmResolverRef = useRef(null);

    const [adminHoldSearch, setAdminHoldSearch] = useState("");
    const adminSearchRef = useRef(null);

    const visibleAdminHolds = useMemo(() => {
        const q = adminHoldSearch.trim().toLowerCase();
        if (!q) return holdsSafe;
        return holdsSafe.filter((h) => h.name.toLowerCase().includes(q));
    }, [holdsSafe, adminHoldSearch]);

    const fileInputRef = useRef(null);
    const uploadTargetIdRef = useRef(null);
    const importDbInputRef = useRef(null);
    const holdCoverInputRef = useRef(null);
    const uploadHoldIdRef = useRef(null);

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

    const refreshHistory = useCallback(() => {
        setHistoryStatus("loading");
        loadHistory(200)
            .then((rows) => {
                setHistoryRows(rows);
                setHistoryStatus("ready");
            })
            .catch((err) => {
                console.warn("History load failed:", err);
                setHistoryStatus("error");
            });
    }, []);

    useEffect(() => {
        if (adminView === "history" && historyStatus === "idle") refreshHistory();
    }, [adminView, historyStatus, refreshHistory]);

    useEffect(() => {
        if (initialView === "history") setAdminView("history");
    }, [initialView]);

    useEffect(() => {
        if (adminView === "history") onHistoryViewed?.();
    }, [adminView, onHistoryViewed]);

    const handleSave = useCallback(async () => {
        if (saving) return;
        setSaving(true);
        try {
            const saved = await saveState(draftData, serverRevision);
            setData(saved.data);
            onCatalogSaved?.(saved);
            setDraftData(saved.data);
            setHasUnsavedChanges(false);
            if (adminView === "history") refreshHistory();
            toast.success("Catalog saved");
        } catch (err) {
            console.warn("Shared save failed:", err);
            if (err?.status === 409 || err?.code === "stale_revision") {
                toast.error("The catalog changed elsewhere. Reload the page and reapply your edit.", { duration: 7000 });
            } else if (err?.status === 401) {
                toast.error("Session expired. Please sign in again.");
            } else {
                toast.error("Could not save the catalog. Please try again.");
            }
        } finally {
            setSaving(false);
        }
    }, [adminView, draftData, onCatalogSaved, refreshHistory, saving, serverRevision, setData]);

    const handleExit = useCallback(async () => {
        if (hasUnsavedChanges) {
            const ok = await askConfirm("You have unsaved changes. Leave without saving?");
            if (!ok) return;
        }
        onExit();
    }, [askConfirm, hasUnsavedChanges, onExit]);

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
        if (selectedProduct && !holdsSafe.some(h => h.id === selectedProduct)) setSelectedProduct(null);
    }, [holdsSafe, selectedProduct]);

    const addHold = useCallback(() => {
        const name = normalizeHoldName(newHoldName);
        if (!name) return;
        let newId;
        updateAdminData((prev) => {
            const prevHolds = Array.isArray(prev.holds) ? prev.holds : [];
            if (prevHolds.some((h) => h.name.toLowerCase() === name.toLowerCase())) return prev;
            const newHold = { id: generateHoldId(), name };
            newId = newHold.id;
            return { ...prev, holds: getSortedHoldNames([...prevHolds, newHold]) };
        });
        setNewHoldName("");
        if (newId) setSelectedProduct(newId);
    }, [newHoldName, updateAdminData]);

    const confirmRemoveHold = useCallback(async () => {
        const holdId = selectedProduct;
        const holdObj = holdsSafe.find(h => h.id === holdId);
        const holdName = holdObj?.name ?? holdId;
        const cnt = anglesSafe.filter((a) => a.holdId === holdId).length;
        const ok = await askConfirm(cnt > 0 ? `Delete "${holdName}" and ${cnt} angle(s)?` : `Delete "${holdName}"?`);
        if (!ok) return;

        updateAdminData((prev) => ({
            ...prev,
            holds: getSortedHoldNames((prev.holds || []).filter((h) => h.id !== holdId)),
            angles: (prev.angles || []).filter((a) => a.holdId !== holdId),
        }));

        setSelectedProduct(null);
        if (editingHold === holdId) setEditingHold(null);
    }, [anglesSafe, askConfirm, editingHold, holdsSafe, selectedProduct, updateAdminData]);

    const startRenameHold = useCallback((holdId) => {
        const holdObj = holdsSafe.find(h => h.id === holdId);
        setEditingHold(holdId);
        setEditingHoldName(holdObj?.name ?? "");
    }, [holdsSafe]);

    const cancelRenameHold = useCallback(() => {
        setEditingHold(null);
        setEditingHoldName("");
    }, []);

    const saveRenameHold = useCallback((oldId) => {
        const nextName = normalizeHoldName(editingHoldName);
        if (!nextName) return;

        const oldHold = holdsSafe.find(h => h.id === oldId);
        if (
            nextName.toLowerCase() !== (oldHold?.name ?? "").toLowerCase() &&
            holdsSafe.some((h) => h.name.toLowerCase() === nextName.toLowerCase())
        ) return;

        updateAdminData((prev) => ({
            ...prev,
            holds: getSortedHoldNames(prev.holds.map(h =>
                h.id === oldId ? { ...h, name: nextName } : h
            )),
            // angles.holdId doesn't change — stable IDs
        }));

        setEditingHold(null);
    }, [editingHoldName, holdsSafe, updateAdminData]);

    const addAngleForHold = useCallback((holdId, saw) => {
        updateAdminData((prev) => ({
            ...prev,
            angles: [...(prev.angles || []), { id: cryptoRandomId(), holdId, value: 0, saw }],
        }));
        setSelectedProduct(holdId);
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
        const holdId = uploadHoldIdRef.current;
        e.target.value = "";
        uploadHoldIdRef.current = null;
        if (!file || !holdId) return;

        compressImageFile(file, 900, 0.85)
            .then((dataUrl) => {
                updateAdminData((prev) => ({
                    ...prev,
                    holds: prev.holds.map(h =>
                        h.id === holdId ? { ...h, coverImage: dataUrl } : h
                    ),
                }));
            })
            .catch((err) => {
                console.warn("Cover upload failed:", err);
                toast.error("Could not process this image. Try another file.");
            });
    }, [updateAdminData]);

    const removeHoldCover = useCallback(async () => {
        if (!(await askConfirm("Remove hold cover image?"))) return;
        updateAdminData((prev) => ({
            ...prev,
            holds: prev.holds.map(h =>
                h.id === selectedProduct ? { ...h, coverImage: undefined } : h
            ),
        }));
    }, [askConfirm, selectedProduct, updateAdminData]);

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
        holdsSafe.forEach((h) => map.set(h.id, []));
        anglesSafe.forEach((a) => {
            if (map.has(a.holdId)) map.get(a.holdId).push(a);
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

    const selectedHoldObj = useMemo(
        () => holdsSafe.find(h => h.id === selectedProduct) ?? null,
        [holdsSafe, selectedProduct]
    );

    const selectedCover = selectedHoldObj?.coverImage ?? null;

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
            max-height: 38vh !important;
          }

          .table {
            max-height: 40vh !important;
            overflow-y: auto !important;
          }

          button {
            min-height: 0 !important;
          }
          input {
            font-size: 16px !important;
          }

          .adminAngleRow {
            padding: 10px 0 !important;
          }

          .holdsCardBody {
            padding-top: calc(28px + 20px) !important;
          }
          /* Search bar: fixed at top in admin mobile */
          .adminSearchWrap {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            z-index: 50 !important;
            background: #f5f7fa !important;
            padding: 8px 12px 4px !important;
          }
          .adminSearchFade {
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
          .adminSearchWrap .searchPill {
            height: 28px !important;
            min-height: 28px !important;
            padding: 0 10px !important;
          }
          .adminSearchWrap .searchPill input {
            min-height: 0 !important;
            height: 28px !important;
            font-size: 13px !important;
          }

          .adminFooter {
            position: fixed !important;
            bottom: 0 !important;
            left: 0 !important;
            right: 0 !important;
            z-index: 100 !important;
            background: #ffffff !important;
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
            padding-bottom: calc(220px + env(safe-area-inset-bottom, 0px)) !important;
          }

          /* History rows: collapse to entity + change, tap to expand full detail. */
          .historyRow {
            font-size: 14px !important;
          }
          .historyRowDesktop {
            display: none !important;
          }
          .historyRowMobile {
            display: flex !important;
          }
          .historyRowDetail {
            display: flex !important;
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
          /* History view: holds panel + history fill the full width (2 columns). */
          .admin-grid-container.history-mode {
            grid-template-columns: minmax(180px, 220px) minmax(0, 1fr) !important;
          }
          .admin-grid-container.history-mode > :nth-child(2) {
            grid-column: 2 !important;
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

            <div className="adminSearchFade" style={{ display: "none" }} />
            <div style={styles.adminGrid} className={`admin-grid-container${adminView === "history" ? " history-mode" : ""}`}>
                {/* Left: holds list */}
                <Card style={styles.card}>
                    <div style={styles.cardBody} className="holdsCardBody">
                        <div style={styles.searchWrap} className="searchWrap adminSearchWrap">
                            <div
                                style={styles.searchPill}
                                role="search"
                                className="searchPill"
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
                            {visibleAdminHolds.map((h) => (
                                <button
                                    key={h.id}
                                    type="button"
                                    onClick={() => setSelectedProduct(h.id)}
                                    onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
                                    style={{ ...styles.holdRowBtn, ...(selectedProduct === h.id ? styles.holdRowBtnActive : null) }}
                                >
                                    <span style={styles.holdName}>{h.name}</span>
                                </button>
                            ))}
                        </div>

                        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleDrawingUpload} />
                        <input ref={importDbInputRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={handleImportDb} />
                        <input ref={holdCoverInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleHoldCoverUpload} />

                        <div className="adminFooter" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <div className="adminFooterDivider" style={{ borderTop: `1px solid ${theme.colors.borderLight}`, marginTop: 16, paddingTop: 16, display: "flex", gap: 8 }}>
                                <button
                                    type="button"
                                    style={{ ...styles.btnGhost, flex: 1, fontWeight: adminView === "catalog" ? 700 : 400 }}
                                    onClick={() => setAdminView("catalog")}
                                >
                                    CATALOG
                                </button>
                                <button
                                    type="button"
                                    style={{ ...styles.btnGhost, flex: 1, fontWeight: adminView === "history" ? 700 : 400 }}
                                    onClick={() => {
                                        setAdminView("history");
                                        onHistoryViewed?.();
                                        if (historyStatus === "error") refreshHistory();
                                    }}
                                >
                                    HISTORY
                                </button>
                            </div>

                            <div style={{ ...styles.footerRow, borderTop: "none", marginTop: 0, paddingTop: 0 }}>
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
                                style={{ ...styles.btnGhost, width: "100%", opacity: saving ? 0.65 : 1 }}
                                onClick={handleSave}
                                disabled={saving}
                                title="Save all changes"
                            >
                                <SaveIcon />
                                {saving ? "SAVING…" : `SAVE${hasUnsavedChanges ? " *" : ""}`}
                            </button>

                            <div style={{ display: "flex", gap: 8 }}>
                                <button style={{ ...styles.btnGhost, flex: 1 }} onClick={exportDb}>EXPORT</button>
                                <button style={{ ...styles.btnGhost, flex: 1 }} onClick={triggerImportDb}>IMPORT</button>
                            </div>

                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                                <span style={{ fontSize: 11, color: theme.colors.textTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {currentUser ? `Signed in: ${currentUser}` : ""}
                                </span>
                                <button type="button" style={styles.btnGhost} onClick={onLogout}>Sign out</button>
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

                {adminView === "history" ? (
                    <Card style={styles.card}>
                        <div style={styles.tableBody}>
                            <div style={{ ...styles.tableHeader, justifyContent: "space-between", marginBottom: 12 }}>
                                <div style={{ ...styles.tableTitleCenter, textAlign: "left", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    CHANGE HISTORY
                                </div>
                                <button
                                    type="button"
                                    style={{ ...styles.btnSmallGhost, flex: "0 0 auto" }}
                                    onClick={refreshHistory}
                                    disabled={historyStatus === "loading"}
                                >
                                    {historyStatus === "loading" ? "Loading..." : "Refresh"}
                                </button>
                            </div>

                            {historyStatus === "error" ? (
                                <div style={{ fontSize: 12, color: theme.colors.textMuted, textAlign: "center", padding: 24 }}>
                                    Could not load history.
                                </div>
                            ) : historyStatus === "loading" ? (
                                <div style={{ fontSize: 12, color: theme.colors.textMuted, textAlign: "center", padding: 24 }}>
                                    Loading...
                                </div>
                            ) : historyRows.length === 0 ? (
                                <div style={{ fontSize: 12, color: theme.colors.textMuted, textAlign: "center", padding: 24 }}>
                                    No changes yet.
                                </div>
                            ) : (
                                <div style={{ ...styles.table, gap: 6 }}>
                                    {historyRows.map((row) => {
                                        const isOpen = expandedHistory.has(row.id);
                                        return (
                                        <button
                                            key={row.id}
                                            type="button"
                                            className="historyRow"
                                            aria-expanded={isOpen}
                                            onClick={() => toggleHistoryRow(row.id)}
                                            style={{
                                                display: "block",
                                                width: "100%",
                                                textAlign: "left",
                                                border: `1px solid ${theme.colors.borderLight}`,
                                                borderRadius: 4,
                                                padding: "8px 10px",
                                                fontSize: 12,
                                                color: theme.colors.textSecondary,
                                                background: theme.colors.cardBg,
                                                cursor: "pointer",
                                            }}
                                        >
                                            {/* Desktop: full table row (5 columns) */}
                                            <div
                                                className="historyRowDesktop"
                                                style={{
                                                    display: "grid",
                                                    gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 0.9fr) minmax(0, 1.1fr) minmax(0, 1.4fr) minmax(0, 1.2fr)",
                                                    gap: 10,
                                                    alignItems: "center",
                                                }}
                                            >
                                                <span style={{ color: theme.colors.textTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{formatHistoryDate(row.createdAt)}</span>
                                                <span style={{ fontWeight: 600, color: theme.colors.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.username || "—"}</span>
                                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{formatHistoryAction(row)}</span>
                                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.entity || "—"}</span>
                                                <span style={{ color: theme.colors.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{formatHistoryChange(row)}</span>
                                            </div>

                                            {/* Mobile: compact summary (entity + change) with a chevron */}
                                            <div
                                                className="historyRowMobile"
                                                style={{ display: "none", alignItems: "center", gap: 8 }}
                                            >
                                                <span style={{ fontWeight: 600, color: theme.colors.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{row.entity || "—"}</span>
                                                <span style={{ color: theme.colors.textPrimary, flex: "0 0 auto" }}>{formatHistoryChange(row)}</span>
                                                <span aria-hidden="true" style={{ flex: "0 0 auto", color: theme.colors.textTertiary, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>›</span>
                                            </div>

                                            {/* Mobile: expanded detail */}
                                            {isOpen && (
                                                <div className="historyRowDetail" style={{ display: "none", flexDirection: "column", gap: 4, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${theme.colors.borderLight}` }}>
                                                    <div><span style={{ color: theme.colors.textTertiary }}>Date: </span>{formatHistoryDate(row.createdAt)}</div>
                                                    <div><span style={{ color: theme.colors.textTertiary }}>By: </span><span style={{ fontWeight: 600, color: theme.colors.textPrimary }}>{row.username || "—"}</span></div>
                                                    <div><span style={{ color: theme.colors.textTertiary }}>Action: </span>{formatHistoryAction(row)}</div>
                                                    <div><span style={{ color: theme.colors.textTertiary }}>Change: </span><span style={{ color: theme.colors.textPrimary }}>{formatHistoryChange(row)}</span></div>
                                                </div>
                                            )}
                                        </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </Card>
                ) : (
                    <>
                        {/* Hold panel */}
                        <Card style={styles.card}>
                            <div style={styles.tableBody}>
                                <div style={styles.tableTitleCenter}>HOLD</div>

                                {selectedProduct ? (
                            !editingHold ? (
                                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                    <div style={{ fontSize: 16, color: theme.colors.textPrimary, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {selectedHoldObj?.name ?? ''}
                                    </div>

                                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        <button style={styles.btnSmallGhost} onClick={() => startRenameHold(selectedProduct)}>Edit</button>
                                        <button style={styles.btnX} onClick={() => confirmRemoveHold()}>×</button>
                                    </div>

                                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                                        <div style={{ fontSize: 11, color: theme.colors.textTertiary }}>Hold cover</div>

                                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                            <button
                                                type="button"
                                                style={styles.btnSmallGhost}
                                                onClick={() => {
                                                    uploadHoldIdRef.current = selectedProduct;
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
                    </>
                )}
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
