import React from 'react';
import { toAngleLabel } from '../domain/angles.js';

export function AngleTable({ rows, onPick, styles, activeId }) {
    return (
        <div style={styles.table} className="print-table-container">
            {rows.map((r) => {
                const isActive = r.id === activeId;
                return (
                    <button
                        key={r.id}
                        onClick={() => onPick(r.id)}
                        style={isActive ? { ...styles.tableRow, ...styles.tableRowActive } : styles.tableRow}
                        className="print-table-row"
                        aria-current={isActive ? "true" : undefined}
                    >
                        <span style={styles.angleCell}>{toAngleLabel(r.value)}</span>
                        <span style={styles.nameCell}>{r.hold}</span>
                    </button>
                );
            })}
            {rows.length === 0 ? <div style={styles.tableEmpty} /> : null}
        </div>
    );
}

export default AngleTable;
