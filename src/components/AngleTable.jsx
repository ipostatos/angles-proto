import React from 'react';
import { toAngleLabel } from '../domain/angles.js';

function AngleTable({ rows, onPick, styles }) {
    return (
        <div style={styles.table} className="print-table-container">
            {rows.map((r) => (
                <button key={r.id} onClick={() => onPick(r.id)} style={styles.tableRow} className="print-table-row">
                    <span style={styles.angleCell}>{toAngleLabel(r.value)}</span>
                    <span style={styles.nameCell}>{r.hold}</span>
                </button>
            ))}
            {rows.length === 0 ? <div style={styles.tableEmpty} /> : null}
        </div>
    );
}

export default AngleTable;
