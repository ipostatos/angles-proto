import React from 'react';

function ConfirmDialog({ message, styles, onConfirm, onCancel }) {
    return (
        <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div style={{ background: "#fff", borderRadius: 10, padding: 24, maxWidth: 300, width: "100%", display: "flex", flexDirection: "column", gap: 12, boxSizing: "border-box" }}>
                <div style={{ fontSize: 13, color: "#1a1a1a", textAlign: "center", lineHeight: 1.5 }}>{message}</div>
                <button style={{ ...styles.btnPrimary, height: 44 }} onClick={onConfirm}>OK</button>
                <button style={{ ...styles.btnGhost, height: 44 }} onClick={onCancel}>Cancel</button>
            </div>
        </div>
    );
}

export default ConfirmDialog;
