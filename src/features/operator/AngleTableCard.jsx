import React from 'react';
import { Card } from '../../components/Card.jsx';
import { AngleTable } from '../../components/AngleTable.jsx';
import { SortIcon } from '../../components/icons.jsx';

// Presentational MAIN/STEFAN angle table card. Extracted verbatim from the two
// inline table blocks in App.jsx during v1.6 A2.1; markup, class names,
// data-print-hide, and aria-label behavior are preserved. All state, sorting,
// and selected-angle logic stay in App.jsx and arrive here as props.
export function AngleTableCard({ title, rows, sortDirection, onCycleSort, onPick, styles }) {
    return (
        <Card style={styles.card} className="angleTableCard">
            <div style={styles.tableBody}>
                <div style={styles.tableHeader} className="print-header tableHeader">
                    <div style={styles.tableTitleCenter} className="tableTitleCenter">{title}</div>
                    <button
                        type="button"
                        onClick={onCycleSort}
                        onMouseDown={(e) => e.preventDefault()}
                        style={styles.sortButton}
                        className="sortButton"
                        title="Sort by angle"
                        aria-label={`Sort ${title} table`}
                        data-print-hide
                    >
                        <SortIcon direction={sortDirection} />
                    </button>
                </div>
                <AngleTable styles={styles} rows={rows} onPick={onPick} />
            </div>
        </Card>
    );
}
