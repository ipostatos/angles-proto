import React, { useState, useMemo } from 'react';
import { toAngleLabel } from '../domain/angles.js';

// Inlined — no icons.jsx in this project yet
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

/* Custom dropdown for ALL/MAIN/STEFAN filter used inside WorkModeOverlay */
function WorkModeFilterSelect({ value, onChange, t }) {
    const [open, setOpen] = useState(false);
    const options = [{ v: "all", l: "ALL" }, { v: "main", l: "MAIN" }, { v: "stefan", l: "STEFAN" }];
    const current = options.find(o => o.v === value);
    return (
        <div style={{ position: "relative", width: 90, flexShrink: 0 }}>
            <button onClick={() => setOpen(v => !v)} style={{ width: "100%", height: 44, background: t.btnBg, border: `1px solid ${t.btnBorder}`, color: t.text, borderRadius: 4, cursor: "pointer", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 10px" }}>
                <span>{current.l}</span>
                <span style={{ fontSize: 9, opacity: 0.6 }}>{open ? "▲" : "▼"}</span>
            </button>
            {open && (
                <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, right: 0, background: t.card, border: `1px solid ${t.btnBorder}`, borderRadius: 6, overflow: "hidden", zIndex: 50 }}>
                    {options.map(o => (
                        <button key={o.v} onClick={() => { onChange(o.v); setOpen(false); }} style={{ display: "block", width: "100%", padding: "10px 12px", textAlign: "left", border: "none", cursor: "pointer", fontSize: 13, fontWeight: o.v === value ? 700 : 400, background: o.v === value ? t.btnBorder : "transparent", color: t.text }}>
                            {o.l}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

/* Single row with checkbox in work mode */
function WorkModeRow({ row, checked, onToggle, t }) {
    return (
        <div
            onClick={(e) => onToggle(row.id, e)}
            style={{
                display: "grid", gridTemplateColumns: "64px 1fr 36px",
                alignItems: "center", gap: 4,
                background: t.card, border: `1px solid ${t.border}`,
                borderRadius: 4, padding: "8px 10px", marginBottom: 4,
                cursor: "pointer",
            }}
        >
            <span style={{ fontWeight: 700, fontSize: 18, color: checked ? t.strike : t.text, textDecoration: checked ? "line-through" : "none" }}>{toAngleLabel(row.value)}</span>
            <span style={{ fontSize: 16, color: checked ? t.strike : t.sub, textDecoration: checked ? "line-through" : "none" }}>{row.hold}</span>
            <div
                onClick={(e) => onToggle(row.id, e)}
                style={{
                    width: 18, height: 18, borderRadius: 3, justifySelf: "center",
                    border: `2px solid ${checked ? t.text : t.border}`,
                    background: checked ? t.text : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                }}
            >
                {checked && (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                        <polyline points="2,6 5,9 10,3" stroke={t.card} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                )}
            </div>
        </div>
    );
}

/* Main fullscreen work-mode overlay */
function WorkModeOverlay({ main, stefan, checkedAngles, onToggleCheck, onExit, onSave, styles, showSaved, theme, onToggleTheme }) {
    const [filter, setFilter] = useState("all"); // all | main | stefan
    const [mainSort, setMainSort] = useState("asc");
    const [stefanSort, setStefanSort] = useState("asc");

    const sortedMain = useMemo(() => {
        const arr = [...main];
        return mainSort === "asc"
            ? arr.sort((a, b) => a.value - b.value || a.hold.localeCompare(b.hold))
            : arr.sort((a, b) => b.value - a.value || a.hold.localeCompare(b.hold));
    }, [main, mainSort]);

    const sortedStefan = useMemo(() => {
        const arr = [...stefan];
        return stefanSort === "asc"
            ? arr.sort((a, b) => a.value - b.value || a.hold.localeCompare(b.hold))
            : arr.sort((a, b) => b.value - a.value || a.hold.localeCompare(b.hold));
    }, [stefan, stefanSort]);

    const showMain = filter !== "stefan";
    const showStefan = filter !== "main";

    const dark = theme === "dark";
    const t = {
        bg: dark ? "#111111" : "#f5f7fa",
        card: dark ? "#1e1e1e" : "#ffffff",
        border: dark ? "#333333" : "#e8e8e8",
        text: dark ? "#e8e8e8" : "#1a1a1a",
        sub: dark ? "#999999" : "#888888",
        strike: dark ? "#555" : "#bbb",
        footerBg: dark ? "#1a1a1a" : "#ffffff",
        footerBorder: dark ? "#2a2a2a" : "#e8e8e8",
        btnBg: dark ? "#2a2a2a" : "#ffffff",
        btnBorder: dark ? "#3a3a3a" : "#dddddd",
    };
    return (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: t.bg, display: "flex", flexDirection: "column", boxSizing: "border-box" }}>
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 12px 90px" }}>
                {showMain && sortedMain.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "relative", marginBottom: 8 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", color: t.sub }}>MAIN</span>
                            <button onClick={() => setMainSort(s => s === "asc" ? "desc" : "asc")} style={{ position: "absolute", right: 0, background: "none", border: "none", cursor: "pointer", color: t.sub, fontSize: 14, padding: "0 4px" }}>
                                {mainSort === "asc" ? "↑" : "↓"}
                            </button>
                        </div>
                        {sortedMain.map(r => <WorkModeRow key={r.id} row={r} checked={checkedAngles.has(r.id)} onToggle={onToggleCheck} t={t} />)}
                    </div>
                )}
                {showStefan && sortedStefan.length > 0 && (
                    <div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "relative", marginBottom: 8 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", color: t.sub }}>STEFAN</span>
                            <button onClick={() => setStefanSort(s => s === "asc" ? "desc" : "asc")} style={{ position: "absolute", right: 0, background: "none", border: "none", cursor: "pointer", color: t.sub, fontSize: 14, padding: "0 4px" }}>
                                {stefanSort === "asc" ? "↑" : "↓"}
                            </button>
                        </div>
                        {sortedStefan.map(r => <WorkModeRow key={r.id} row={r} checked={checkedAngles.has(r.id)} onToggle={onToggleCheck} t={t} />)}
                    </div>
                )}
                {sortedMain.length === 0 && sortedStefan.length === 0 && (
                    <div style={{ textAlign: "center", color: t.sub, marginTop: 60, fontSize: 14 }}>No holds selected</div>
                )}
            </div>
            <div style={{
                position: "fixed", bottom: 0, left: 0, right: 0,
                padding: "10px 12px env(safe-area-inset-bottom, 0px)",
                background: t.footerBg, borderTop: `1px solid ${t.footerBorder}`,
                display: "flex", gap: 8,
            }}>
                <button onClick={onToggleTheme} style={{ background: t.btnBg, border: `1px solid ${t.btnBorder}`, color: t.text, borderRadius: 4, width: 44, height: 44, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 0, cursor: "pointer" }}>
                    {dark
                        ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                        : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                    }
                </button>
                <WorkModeFilterSelect value={filter} onChange={setFilter} t={t} />
                <button onClick={onExit} style={{ background: t.btnBg, border: `1px solid ${t.btnBorder}`, color: t.text, borderRadius: 4, flex: 1, height: 44, fontSize: 14, cursor: "pointer" }}>
                    ← EXIT
                </button>
            </div>

            {showSaved && (
                <div style={{
                    position: "fixed", inset: 0, zIndex: 300,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    pointerEvents: "none",
                }}>
                    <div style={{
                        background: "#1a1a1a", color: "#fff",
                        borderRadius: 12, padding: "16px 28px",
                        fontSize: 15, fontWeight: 500,
                        display: "flex", alignItems: "center", gap: 10,
                        boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                    }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        Progress saved
                    </div>
                </div>
            )}
        </div>
    );
}

export { WorkModeFilterSelect, WorkModeRow, WorkModeOverlay };
