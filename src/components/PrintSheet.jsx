import React from 'react';
import { toAngleLabel } from '../domain/angles.js';

// A4 portrait: ~46 rows per column keeps each column on one page
export const PRINT_ROWS_PER_COLUMN = 46;
export const PRINT_MAX_COLUMNS_ALL = 2;
export const PRINT_MAX_COLUMNS_SINGLE = 4;

export function chunkRowsForPrint(rows, rowsPerColumn) {
    if (!rows.length) return [];
    const chunks = [];
    for (let i = 0; i < rows.length; i += rowsPerColumn) {
        chunks.push(rows.slice(i, i + rowsPerColumn));
    }
    return chunks;
}

export function buildPrintColumnGroups(rows, rowsPerColumn, maxColumnsPerRow) {
    const chunks = chunkRowsForPrint(rows, rowsPerColumn);
    if (!chunks.length) return [];
    const groups = [];
    for (let i = 0; i < chunks.length; i += maxColumnsPerRow) {
        groups.push(chunks.slice(i, i + maxColumnsPerRow));
    }
    return groups;
}

export function PrintAngleRow({ row }) {
    return (
        <div className="print-table-row">
            <span className="print-angle">{toAngleLabel(row.value)}</span>
            <span className="print-hold">{row.hold}</span>
        </div>
    );
}

export function PrintTableSection({ title, rows, maxColumnsPerRow, className = "" }) {
    const columnGroups = buildPrintColumnGroups(rows, PRINT_ROWS_PER_COLUMN, maxColumnsPerRow);
    return (
        <div className={`print-section ${className}`.trim()}>
            <div className="print-section-title">{title}</div>
            {columnGroups.map((group, groupIdx) => (
                <div
                    key={groupIdx}
                    className={`print-columns-row${groupIdx > 0 ? " print-columns-row-break" : ""}`}
                >
                    {group.map((col, colIdx) => (
                        <div
                            key={colIdx}
                            className="print-column"
                            style={{ width: `${100 / group.length}%` }}
                        >
                            {col.map((r) => (
                                <PrintAngleRow key={r.id} row={r} />
                            ))}
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}
