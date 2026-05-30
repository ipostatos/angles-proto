import React from 'react';

export function PasswordInput({ value, onChange, show, onToggle, placeholder, styles, autoFocus, inputMode, maxLength }) {
    return (
        <div style={{ position: "relative" }}>
            <input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                type={show ? "text" : "password"}
                autoFocus={autoFocus}
                inputMode={inputMode}
                maxLength={maxLength}
                className="login-modal-input"
                style={{ ...styles.input, textAlign: "center", background: "#fff", boxShadow: "none", width: "100%", boxSizing: "border-box", paddingRight: 36 }}
            />
            <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={onToggle}
                style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 4, color: "#999", display: "flex", alignItems: "center", minHeight: 0 }}
            >
                {show ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                    </svg>
                )}
            </button>
        </div>
    );
}

export default PasswordInput;
