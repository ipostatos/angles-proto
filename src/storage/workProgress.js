export const LS_WORK_PROGRESS_KEY = 'angles_proto_v1_work_progress';

export function saveWorkProgress(holds, checked, mode) {
    try {
        localStorage.setItem(LS_WORK_PROGRESS_KEY, JSON.stringify({
            holds: [...holds],
            checked: [...checked],
            mode,
            savedAt: Date.now(),
        }));
    } catch { }
}

export function loadWorkProgress() {
    try {
        const raw = localStorage.getItem(LS_WORK_PROGRESS_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

export function clearWorkProgress() {
    try { localStorage.removeItem(LS_WORK_PROGRESS_KEY); } catch { }
}
