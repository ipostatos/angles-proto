import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { clamp, toAngleLabel } from '../domain/angles.js';
import { normalizeHoldName as normalizeHoldNameSafe, sortHolds } from '../domain/holds.js';
import { isSafeRasterDataUrl } from '../domain/validation.js';
import { saveState, loadLastModified, MAX_DB_SIZE_KB, serializedSizeKB } from '../storage/db.js';
import { pushBackup } from '../storage/backups.js';
import { ADMIN_SESSION_KEY } from '../storage/auth.js';
import { downloadJsonFile, readJsonFile } from '../storage/importExport.js';
import { compressImageFile } from '../utils/image.js';
import { migrateAndSanitize } from '../domain/migration.js';
import { SaveIcon } from './icons.jsx';
import { ConfirmDialog } from './ConfirmDialog.jsx';
import { SearchIcon } from './icons.jsx';
import { Card } from './Card.jsx';

const APP_VERSION = "1.01";

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
    tableTitleCenter: {
        fontSize: "clamp(10px, 2vw, 11px)",
        fontWeight: 700,
        letterSpacing: "0.05em",
        color: theme.colors.textTertiary,
        textAlign: "center",
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
    tableEmpty: { height: 8 },
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
    adminTitle: {
        fontSize: "clamp(10px, 2vw, 11px)",
        fontWeight: 600,
        letterSpacing: "0.05em",
        color: theme.colors.textTertiary,
        marginBottom: 10,
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
export function AdminPage({ data, setData, onExit, lastModifiedMs }) {
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

            <div className="adminSearchFade" style={{ display: "none" }} />
            <div style={styles.adminGrid} className="admin-grid-container">
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
