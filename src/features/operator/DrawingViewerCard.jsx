import React from 'react';
import { Card } from '../../components/Card.jsx';
import { PrinterIcon, ZoomIcon } from '../../components/icons.jsx';

// Presentational drawing-viewer card (image + print/zoom tools, or empty state).
// Extracted verbatim from the inline block in App.jsx during v1.6 A2.2; markup,
// class names, data-print-hide, button titles, and the empty-state color
// (theme.colors.textMuted) are preserved. State (viewerSrc, zoomedImage),
// printImage, theme, and styles stay in App.jsx and arrive here as props.
//
// NOTE: intentionally NOT reusing the existing DrawingViewer.jsx — it hardcodes
// a different empty-state color (#9ca3af); reconciling that is a later slice.
export function DrawingViewerCard({ src, onPrint, onZoom, styles, theme, emptyText = "no drawing uploaded" }) {
    return (
        <Card data-print-hide style={styles.card}>
            <div style={styles.viewerWrap}>
                {src ? (
                    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
                        <img src={src} alt="drawing" style={styles.viewerImg} draggable={false} />
                        <div style={styles.viewerTools}>
                            <button
                                type="button"
                                onClick={() => onPrint(src)}
                                style={styles.viewerToolBtn}
                                className="viewerToolBtn"
                                title="Print drawing"
                            >
                                <PrinterIcon size={20} />
                            </button>
                            <button
                                type="button"
                                onClick={() => onZoom(src)}
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
                        <div style={{ fontSize: 12, color: theme.colors.textMuted, textAlign: "center", lineHeight: 1.4, padding: "0 16px", maxWidth: 260 }}>{emptyText}</div>
                    </div>
                )}
            </div>
        </Card>
    );
}
