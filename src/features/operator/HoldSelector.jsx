import React from 'react';
import { SearchIcon } from '../../components/icons.jsx';

export function HoldSelector({ holds, selectedHolds, onToggle, searchValue, onSearchChange, searchRef, styles }) {
    return (
        <>
            <div style={styles.searchWrap} className="searchWrap">
                <div
                    style={styles.searchPill}
                    role="search"
                    className="searchPill"
                    onMouseDown={(e) => {
                        e.preventDefault();
                        searchRef.current?.focus();
                    }}
                >
                    <input
                        ref={searchRef}
                        value={searchValue}
                        onChange={(e) => onSearchChange(e.target.value)}
                        placeholder="Search..."
                        style={styles.searchInput}
                    />
                    <span style={styles.searchIconWrap} aria-hidden="true">
                        <SearchIcon />
                    </span>
                </div>
            </div>

            <div style={styles.holdsList} className="holdsList">
                {holds.map((h) => (
                    <label key={h.id} style={styles.holdRow} className="holdRow">
                        <input
                            type="checkbox"
                            checked={selectedHolds.has(h.id)}
                            onChange={() => onToggle(h.id)}
                            style={styles.checkbox}
                            className="holdCheckbox"
                        />
                        <span style={styles.holdName} className="holdName">{h.name}</span>
                    </label>
                ))}
            </div>
        </>
    );
}
