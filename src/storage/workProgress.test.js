import { describe, it, expect, beforeEach, vi } from 'vitest';
import { saveWorkProgress, loadWorkProgress, clearWorkProgress } from './workProgress.js';

describe('workProgress', () => {
    let store;

    beforeEach(() => {
        store = {};
        const mockLS = {
            getItem: (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: (k) => { delete store[k]; },
            clear: () => { store = {}; },
        };
        vi.stubGlobal('localStorage', mockLS);
    });

    it('returns null when nothing saved', () => {
        expect(loadWorkProgress()).toBeNull();
    });
    it('saves and loads roundtrip', () => {
        const holds = new Set(['Austin', 'Amon']);
        const checked = new Set(['id1', 'id2']);
        saveWorkProgress(holds, checked, 'all');
        const loaded = loadWorkProgress();
        expect(loaded.holds).toContain('Austin');
        expect(loaded.checked).toContain('id1');
        expect(loaded.mode).toBe('all');
        expect(typeof loaded.savedAt).toBe('number');
    });
    it('clearWorkProgress removes data', () => {
        saveWorkProgress(new Set(['A']), new Set(), 'main');
        clearWorkProgress();
        expect(loadWorkProgress()).toBeNull();
    });
});
