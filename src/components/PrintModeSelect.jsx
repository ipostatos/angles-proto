import React, { useState, useEffect, useRef } from 'react';

const theme = {
    colors: {
        cardBg: '#ffffff',
        borderMedium: '#e0e0e0',
        activeBg: '#f5f5f5',
        hoverBg: '#f6f6f6',
        textPrimary: '#1a1a1a',
    },
};

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

export default PrintModeSelect;
