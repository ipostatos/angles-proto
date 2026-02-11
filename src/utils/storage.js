import { DEFAULT_HOLDS, DEFAULT_ANGLES } from "../constants/defaults";
import { sortHolds, clamp, cryptoRandomId, normalizeHoldNameSafe } from "./helpers";

const LS_KEY = "angles_proto_v1";
const LS_VERSION = 1;
const LS_LAST_MODIFIED_KEY = "angles_proto_v1_lastModified";
const LS_BACKUPS_KEY = `${LS_KEY}_backups`;
const MAX_BACKUPS = 5;
const MAX_STORAGE_SIZE_KB = 4 * 1024;

export { LS_KEY, LS_VERSION, LS_LAST_MODIFIED_KEY, LS_BACKUPS_KEY, MAX_BACKUPS };

function sanitizeHoldList(holds) {
  const arr = Array.isArray(holds) ? holds : [];
  const cleaned = arr.map(normalizeHoldNameSafe).filter(Boolean);

  const seen = new Set();
  const unique = [];
  for (const h of cleaned) {
    const key = h.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(h);
  }
  return sortHolds(unique);
}

function sanitizeAngle(a, holdsSet) {
  const hold = normalizeHoldNameSafe(a?.hold);
  const saw = a?.saw === "stefan" ? "stefan" : "main";

  const raw = a?.value;
  const num = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(",", "."));
  const value = Number.isFinite(num) ? clamp(num, 0, 90) : 0;

  const id = typeof a?.id === "string" && a.id.trim() ? a.id : cryptoRandomId();

  const drawing =
    typeof a?.drawing === "string" && a.drawing.startsWith("data:image/") ? a.drawing : undefined;

  if (!hold || !holdsSet.has(hold)) return null;

  return { id, hold, value, saw, ...(drawing ? { drawing } : {}) };
}

function unwrapImportedDb(parsed) {
  if (!parsed || typeof parsed !== "object") return parsed;
  if (parsed.data && typeof parsed.data === "object") return parsed.data;
  return parsed;
}

export function migrateAndSanitize(parsed) {
  const unwrapped = unwrapImportedDb(parsed);

  const holds = sanitizeHoldList(unwrapped?.holds ?? DEFAULT_HOLDS);
  const holdsSet = new Set(holds);

  const anglesRaw = Array.isArray(unwrapped?.angles) ? unwrapped.angles : DEFAULT_ANGLES;

  const angles = [];
  const ids = new Set();

  for (const a of anglesRaw) {
    const sa = sanitizeAngle(a, holdsSet);
    if (!sa) continue;
    if (ids.has(sa.id)) sa.id = cryptoRandomId();
    ids.add(sa.id);
    angles.push(sa);
  }

  const rawHoldImages =
    unwrapped?.holdImages && typeof unwrapped.holdImages === "object" ? unwrapped.holdImages : {};
  const holdImages = {};
  for (const h of holds) {
    const v = rawHoldImages[h];
    if (typeof v === "string" && v.startsWith("data:image/")) {
      holdImages[h] = v;
    }
  }

  return { version: LS_VERSION, holds, angles, holdImages };
}

export function validateImportSize(parsed) {
  const json = JSON.stringify(parsed);
  const sizeKB = new Blob([json]).size / 1024;

  if (sizeKB > MAX_STORAGE_SIZE_KB) {
    throw new Error(
      `Import too large: ${sizeKB.toFixed(0)}KB (max ${MAX_STORAGE_SIZE_KB}KB). Remove some images or compress them.`
    );
  }
  return parsed;
}

function ensureLastModifiedExists() {
  try {
    const v = localStorage.getItem(LS_LAST_MODIFIED_KEY);
    if (!v) localStorage.setItem(LS_LAST_MODIFIED_KEY, String(Date.now()));
  } catch {}
}

export function touchLastModified() {
  try {
    localStorage.setItem(LS_LAST_MODIFIED_KEY, String(Date.now()));
  } catch {}
}

export function loadLastModified() {
  try {
    const v = localStorage.getItem(LS_LAST_MODIFIED_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      const init = migrateAndSanitize({
        version: LS_VERSION,
        holds: DEFAULT_HOLDS,
        angles: DEFAULT_ANGLES,
        holdImages: {},
      });
      localStorage.setItem(LS_KEY, JSON.stringify(init));
      localStorage.setItem(LS_LAST_MODIFIED_KEY, String(Date.now()));
      return init;
    }

    const parsed = JSON.parse(raw);
    const next = migrateAndSanitize(parsed);

    localStorage.setItem(LS_KEY, JSON.stringify(next));
    ensureLastModifiedExists();
    return next;
  } catch {
    const fallback = migrateAndSanitize({
      version: LS_VERSION,
      holds: DEFAULT_HOLDS,
      angles: DEFAULT_ANGLES,
      holdImages: {},
    });
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(fallback));
      localStorage.setItem(LS_LAST_MODIFIED_KEY, String(Date.now()));
    } catch {}
    return fallback;
  }
}

export function saveState(next) {
  try {
    const safe = migrateAndSanitize(next);
    localStorage.setItem(LS_KEY, JSON.stringify(safe));
    touchLastModified();
  } catch (err) {
    if (err?.name === "QuotaExceededError" || err?.code === 22) {
      console.warn("Storage full:", err);
    }
  }
}

export function pushBackup(snapshot) {
  try {
    const raw = localStorage.getItem(LS_BACKUPS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    const next = [{ ts: Date.now(), data: snapshot }, ...(Array.isArray(arr) ? arr : [])].slice(
      0,
      MAX_BACKUPS
    );
    localStorage.setItem(LS_BACKUPS_KEY, JSON.stringify(next));
  } catch (e) {
    console.warn("Backup failed:", e);
  }
}
