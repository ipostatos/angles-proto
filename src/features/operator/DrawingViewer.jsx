import React from 'react';
import { PrinterIcon, ZoomIcon } from '../../components/icons.jsx';

export function DrawingViewer({ src, onZoom, onPrint, styles }) {
    return (
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
                    <div style={{ fontSize: 12, color: "#9ca3af" }}>no drawing uploaded</div>
                </div>
            )}
        </div>
    );
}
