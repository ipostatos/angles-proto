export function cryptoRandomId() {
  try {
    return globalThis.crypto?.randomUUID?.() ?? `id_${Math.random().toString(16).slice(2)}`;
  } catch {
    return `id_${Math.random().toString(16).slice(2)}`;
  }
}

export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function toAngleLabel(n) {
  const isInt = Math.abs(Number(n) - Math.round(Number(n))) < 1e-9;
  return isInt ? `${Math.round(Number(n))}°` : `${Number(n).toFixed(1)}°`;
}

export function sortHolds(holds) {
  return [...holds].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function normalizeHoldNameSafe(s) {
  return String(s || "").trim().replace(/\s+/g, " ");
}

export function formatLastModified(ms) {
  if (!ms || !Number.isFinite(ms)) return "—";
  try {
    const d = new Date(ms);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}
