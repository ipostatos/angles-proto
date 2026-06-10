// Pure random-id helper. Extracted verbatim from App.jsx during v1.6 A1;
// behavior unchanged. (Note: equivalent copies still live in
// components/AdminPage.jsx and domain/migration.js — deduplicating those is
// left to a later A-slice to keep this diff small.)

export function cryptoRandomId() {
    try {
        return globalThis.crypto?.randomUUID?.() ?? `id_${Math.random().toString(16).slice(2)}`;
    } catch {
        return `id_${Math.random().toString(16).slice(2)}`;
    }
}
