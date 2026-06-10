// Device-local "last seen change id" used to decide whether to show the
// "database changed" notification. Extracted verbatim from App.jsx during
// v1.6 A1; behavior unchanged. Intentionally device-local (localStorage).

export const LS_LAST_SEEN_CHANGE_KEY = "angles_proto_v1_last_seen_change_id";

export function loadLastSeenChangeId() {
    try {
        const raw = localStorage.getItem(LS_LAST_SEEN_CHANGE_KEY);
        const n = Number(raw);
        return Number.isFinite(n) ? n : 0;
    } catch {
        return 0;
    }
}

export function saveLastSeenChangeId(id) {
    const n = Number(id);
    if (!Number.isFinite(n)) return;
    try { localStorage.setItem(LS_LAST_SEEN_CHANGE_KEY, String(n)); } catch {}
}
