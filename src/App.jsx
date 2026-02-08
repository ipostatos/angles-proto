import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * PROTOTYPE (no backend)
 * - Holds + angles stored in localStorage
 * - Two tables: MAIN + STEFAN
 * - Viewer shows uploaded drawings (angle drawing) and HOLD cover (fallback)
 * - Admin page: /#/admin  (login admin/admin)
 * - UI simplified: no transitions/animations
 *
 * v1.7
 * - Holds sorted A–Z (old + new)
 * - Search above holds list (MAIN + ADMIN), no dropdown
 *   - click anywhere on search pill focuses input
 * - Admin: hold cover photo upload (shown on main screen when hold selected)
 * - Admin footer: Last modified + AVA Volumes © + app version
 */

const APP_VERSION = "1.7";

const DEFAULT_HOLDS = [
  "Anton","Austin","Amon","Asteca","Avalon","Avalon Flat","Avalon SuperFlat",
  "Base 10","Base 15","Base Zero","Boomerang","Chava","Circo","Classica",
  "Concord","Crack","Crack Midle","Crack ending 30","Crack ending 45",
  "Cuneo","Cuneo Lungo","Delta","Etna","Flat 80","Flat 90","Fratelli",
  "French fries","Fresco 10","Fresco 20","Fresco 30","Fuji","Gamma 3",
  "Gamma 3 (Large)","Gamma 4","Gamma 4 (30)","Gamma 4 (Large)",
  "Gamma 4 (40)","Gobba","Gradino","Half Chava","Half Circo","Half Lancia",
  "Inca","Katla","Lancia","Lancia Flat","Leon","Lipari","Mago (Large)",
  "Mago - set A","Mago - set B",'Mago medium "A"','Mago medium "B"',
  "Parapetto 60","Parapetto 70","Parapetto 80","Rampa","Rampa wide",
  "Rumba High","Rumba Low","Salina","Samba","Sparo","Sparo Super Flat",
  "Sapro Flat","Splash","Square","Square Flat","Square SuperFlat",
  "Tufa","Ustica","WI-FI 70","WI-FI 80",
];

const LS_KEY = "angles_proto_v1";
const LS_VERSION = 1;
const LS_LAST_MODIFIED_KEY = "angles_proto_v1_lastModified";

function cryptoRandomId() {
  try {
    return globalThis.crypto?.randomUUID?.() ?? `id_${Math.random().toString(16).slice(2)}`;
  } catch {
    return `id_${Math.random().toString(16).slice(2)}`;
  }
}

const DEFAULT_ANGLES = [
  { id: cryptoRandomId(), hold: "Austin", value: 28.2, saw: "main" },
  { id: cryptoRandomId(), hold: "Avalon Flat", value: 65.0, saw: "main" },
  { id: cryptoRandomId(), hold: "Austin", value: 65.3, saw: "main" },
  { id: cryptoRandomId(), hold: "Avalon SuperFlat", value: 30.0, saw: "stefan" },
  { id: cryptoRandomId(), hold: "Amon", value: 50.0, saw: "stefan" },
];

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function toAngleLabel(n) {
  const isInt = Math.abs(Number(n) - Math.round(Number(n))) < 1e-9;
  return isInt ? `${Math.round(Number(n))}°` : `${Number(n).toFixed(1)}°`;
}

function sortHolds(holds) {
  return [...holds].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/* -------------------- STORAGE: migration + sanitize -------------------- */

function normalizeHoldNameSafe(s) {
  return String(s || "").trim().replace(/\s+/g, " ");
}

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

/** Accepts raw db OR wrapper: { data: { holds, angles, holdImages } } */
function unwrapImportedDb(parsed) {
  if (!parsed || typeof parsed !== "object") return parsed;
  if (parsed.data && typeof parsed.data === "object") return parsed.data;
  return parsed;
}

function migrateAndSanitize(parsed) {
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

  // ✅ hold cover images: keep only existing holds and valid data:image/*
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

function ensureLastModifiedExists() {
  try {
    const v = localStorage.getItem(LS_LAST_MODIFIED_KEY);
    if (!v) localStorage.setItem(LS_LAST_MODIFIED_KEY, String(Date.now()));
  } catch {}
}

function touchLastModified() {
  try {
    localStorage.setItem(LS_LAST_MODIFIED_KEY, String(Date.now()));
  } catch {}
}

function loadLastModified() {
  try {
    const v = localStorage.getItem(LS_LAST_MODIFIED_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

function loadState() {
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

function saveState(next) {
  try {
    const safe = migrateAndSanitize(next);
    localStorage.setItem(LS_KEY, JSON.stringify(safe));
    touchLastModified();
  } catch (err) {
    if (err?.name === "QuotaExceededError" || err?.code === 22) {
      console.warn("Storage full: image not saved. Use smaller images or remove some drawings.");
      alert("Storage full. Remove some drawings or upload smaller images.");
    }
  }
}

/** Resize/compress image to reduce localStorage size. Returns data URL (jpeg). */
function compressImageFile(file, maxSize = 800, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Not an image"));
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      let dw = w,
        dh = h;
      if (w > maxSize || h > maxSize) {
        if (w >= h) {
          dw = maxSize;
          dh = Math.round((h * maxSize) / w);
        } else {
          dh = maxSize;
          dw = Math.round((w * maxSize) / h);
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = dw;
      canvas.height = dh;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("No canvas context"));
        return;
      }
      ctx.drawImage(img, 0, 0, dw, dh);
      try {
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash || "#/");
  useEffect(() => {
    const onHash = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return hash.replace("#", "");
}

/* -------------------- EXPORT / IMPORT DB -------------------- */

function downloadJsonFile(obj, filename = "angles-db.json") {
  const safe = migrateAndSanitize(obj);
  const payload = {
    app: "AnglesProto",
    exportedAt: new Date().toISOString(),
    version: LS_VERSION,
    data: safe,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function readJsonFile(file) {
  const text = await file.text();
  return JSON.parse(text);
}

function formatLastModified(ms) {
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

/* ===================== APP ===================== */

export default function App() {
  const route = useHashRoute();
  const [data, setData] = useState(() => loadState());
  const [selectedHolds, setSelectedHolds] = useState(() => new Set());
  const [activeAngleId, setActiveAngleId] = useState(null);
  const [lastModifiedMs, setLastModifiedMs] = useState(() => loadLastModified());

  // ✅ search above holds
  const [holdSearch, setHoldSearch] = useState("");
  const searchRef = useRef(null);

  useEffect(() => {
    saveState(data);
    setLastModifiedMs(loadLastModified());
  }, [data]);

  useEffect(() => {
    if (activeAngleId && !data.angles.some((a) => a.id === activeAngleId)) {
      setActiveAngleId(null);
    }
  }, [data.angles, activeAngleId]);

  const sortedHolds = useMemo(() => sortHolds(data.holds || []), [data.holds]);

  const visibleHolds = useMemo(() => {
    const q = holdSearch.trim().toLowerCase();
    if (!q) return sortedHolds;
    return sortedHolds.filter((name) => String(name).toLowerCase().includes(q));
  }, [sortedHolds, holdSearch]);

  const selectedAngles = useMemo(() => {
    const holdsSet = selectedHolds;
    const all = data.angles.filter((a) => holdsSet.has(a.hold));

    const main = all
      .filter((a) => a.saw === "main")
      .slice()
      .sort((x, y) => Number(x.value) - Number(y.value) || x.hold.localeCompare(y.hold));

    const stefan = all
      .filter((a) => a.saw === "stefan")
      .slice()
      .sort((x, y) => Number(x.value) - Number(y.value) || x.hold.localeCompare(y.hold));

    return { main, stefan };
  }, [data.angles, selectedHolds]);

  const activeAngle = useMemo(
    () => data.angles.find((a) => a.id === activeAngleId) || null,
    [data.angles, activeAngleId]
  );

  // ✅ Viewer priority:
  // 1) active angle drawing
  // 2) hold cover if exactly one hold selected
  const viewerSrc = useMemo(() => {
    if (activeAngle?.drawing) return activeAngle.drawing;

    if (selectedHolds.size === 1) {
      const hold = Array.from(selectedHolds)[0];
      const cover = data?.holdImages?.[hold];
      if (cover) return cover;
    }
    return null;
  }, [activeAngle, selectedHolds, data?.holdImages]);

  const toggleHold = (name) => {
    setSelectedHolds((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedHolds(new Set());
    setActiveAngleId(null);
  };

  if (route === "/admin") {
    return (
      <AdminPage
        data={data}
        setData={setData}
        onExit={() => (window.location.hash = "#/")}
        lastModifiedMs={lastModifiedMs}
      />
    );
  }

  return (
    <div style={styles.page}>
      <style>{`
        @media print {
          [data-print-hide] { display: none !important; }
          .main-grid {
            display: grid !important;
            grid-template-columns: 1fr 1fr !important;
            gap: 12px !important;
            height: auto !important;
          }
          .main-grid > :nth-child(1) { display: none !important; }
          .main-grid > :nth-child(4) { display: none !important; }
          .main-grid .card { break-inside: avoid; }
          button { all: unset; }
        }
        button:focus { outline: none; }
        button:focus-visible { outline: none; }
      `}</style>

      <div style={styles.grid} className="main-grid">
        {/* Left: holds */}
        <Card data-print-hide>
          <div style={styles.cardBody}>
            {/* ✅ Search (click anywhere focuses input) */}
            <div style={styles.searchWrap}>
              <div
                style={styles.searchPill}
                role="search"
                onMouseDown={(e) => {
                  e.preventDefault();
                  searchRef.current?.focus();
                }}
              >
                <input
                  ref={searchRef}
                  value={holdSearch}
                  onChange={(e) => setHoldSearch(e.target.value)}
                  placeholder="Search..."
                  style={styles.searchInput}
                />
                <span style={styles.searchIconWrap} aria-hidden="true">
                  <SearchIcon />
                </span>
              </div>
            </div>

            <div style={styles.holdsList}>
              {visibleHolds.map((name) => (
                <label key={name} style={styles.holdRow}>
                  <input
                    type="checkbox"
                    checked={selectedHolds.has(name)}
                    onChange={() => toggleHold(name)}
                    style={styles.checkbox}
                  />
                  <span style={styles.holdName}>{name}</span>
                </label>
              ))}
            </div>

            <div style={styles.footerRow}>
              <button
                type="button"
                onClick={() => window.print()}
                title="Print MAIN and STEFAN tables"
                aria-label="Print"
                data-print-hide
                style={{
                  ...styles.btnGhost,
                  width: 36,
                  height: 36,
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: "0 0 auto",
                }}
              >
                <PrinterIcon />
              </button>

              <button
                type="button"
                style={{ ...styles.btnGhost, ...styles.footerBtn }}
                onClick={() => (window.location.hash = "#/admin")}
              >
                admin
              </button>

              <button
                type="button"
                style={{ ...styles.btnDanger, ...styles.footerBtn }}
                onClick={clearSelection}
              >
                clear
              </button>
            </div>
          </div>
        </Card>

        {/* Main table */}
        <Card>
          <div style={styles.tableBody}>
            <div style={styles.tableTitleCenter}>MAIN</div>
            <AngleTable rows={selectedAngles.main} onPick={setActiveAngleId} />
          </div>
        </Card>

        {/* Stefan table */}
        <Card>
          <div style={styles.tableBody}>
            <div style={styles.tableTitleCenter}>STEFAN</div>
            <AngleTable rows={selectedAngles.stefan} onPick={setActiveAngleId} />
          </div>
        </Card>

        {/* Viewer */}
        <Card data-print-hide>
          <div style={styles.viewerWrap}>
            {viewerSrc ? (
              <img src={viewerSrc} alt="drawing" style={styles.viewerImg} draggable={false} />
            ) : (
              <div style={styles.viewerEmpty}>
                <div style={{ fontSize: 12, color: "#999" }}>no drawing uploaded</div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      style={{ opacity: 0.75, flex: "0 0 auto" }}
    >
      <path d="M10 4a6 6 0 104.472 10.06l4.234 4.234 1.414-1.414-4.234-4.234A6 6 0 0010 4zm0 2a4 4 0 110 8 4 4 0 010-8z" />
    </svg>
  );
}

function PrinterIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block" }}
    >
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}

function AngleTable({ rows, onPick }) {
  return (
    <div style={styles.table}>
      {rows.map((r) => (
        <button key={r.id} onClick={() => onPick(r.id)} style={styles.tableRow}>
          <span style={styles.angleCell}>{toAngleLabel(r.value)}</span>
          <span style={styles.nameCell}>{r.hold}</span>
        </button>
      ))}
      {rows.length === 0 ? <div style={styles.tableEmpty} /> : null}
    </div>
  );
}

/* ===================== ADMIN ===================== */

function AdminPage({ data, setData, onExit, lastModifiedMs }) {
  const [authed, setAuthed] = useState(false);
  const [login, setLogin] = useState("admin");
  const [password, setPassword] = useState("admin");

  const holdsSafe = useMemo(() => sortHolds(Array.isArray(data?.holds) ? data.holds : []), [data?.holds]);
  const anglesSafe = Array.isArray(data?.angles) ? data.angles : [];

  const [selectedProduct, setSelectedProduct] = useState(null);
  const [newHoldName, setNewHoldName] = useState("");
  const [editingHold, setEditingHold] = useState(null);
  const [editingHoldName, setEditingHoldName] = useState("");
  const [selectedAngleId, setSelectedAngleId] = useState(null);

  // ✅ admin search
  const [adminHoldSearch, setAdminHoldSearch] = useState("");
  const adminSearchRef = useRef(null);

  const visibleAdminHolds = useMemo(() => {
    const q = adminHoldSearch.trim().toLowerCase();
    if (!q) return holdsSafe;
    return holdsSafe.filter((name) => String(name).toLowerCase().includes(q));
  }, [holdsSafe, adminHoldSearch]);

  const fileInputRef = useRef(null);
  const uploadTargetIdRef = useRef(null);
  const importDbInputRef = useRef(null);

  // ✅ hold cover upload (per hold)
  const holdCoverInputRef = useRef(null);
  const uploadHoldNameRef = useRef(null);

  const normalizeHoldName = (s) => String(s || "").trim().replace(/\s+/g, " ");

  useEffect(() => {
    if (selectedProduct && !holdsSafe.includes(selectedProduct)) setSelectedProduct(null);
  }, [holdsSafe, selectedProduct]);

  useEffect(() => {
    if (selectedAngleId && !anglesSafe.some((a) => a.id === selectedAngleId)) setSelectedAngleId(null);
  }, [anglesSafe, selectedAngleId]);

  const doLogin = () => {
    if (login === "admin" && password === "admin") setAuthed(true);
  };

  const addHold = () => {
    const name = normalizeHoldName(newHoldName);
    if (!name) return;
    setData((prev) => {
      const prevHolds = Array.isArray(prev.holds) ? prev.holds : [];
      if (prevHolds.some((h) => String(h).toLowerCase() === name.toLowerCase())) return prev;
      return { ...prev, holds: sortHolds([...prevHolds, name]) };
    });
    setNewHoldName("");
    setSelectedProduct(name);
  };

  const confirmRemoveHold = (nameToRemove) => {
    const cnt = anglesSafe.filter((a) => a.hold === nameToRemove).length;
    if (!window.confirm(cnt > 0 ? `Delete "${nameToRemove}" and ${cnt} angle(s)?` : `Delete "${nameToRemove}"?`)) return;

    setData((prev) => {
      const nextHoldImages = { ...(prev.holdImages || {}) };
      delete nextHoldImages[nameToRemove];

      return {
        ...prev,
        holds: sortHolds((prev.holds || []).filter((h) => h !== nameToRemove)),
        angles: (prev.angles || []).filter((a) => a.hold !== nameToRemove),
        holdImages: nextHoldImages,
      };
    });

    if (selectedProduct === nameToRemove) setSelectedProduct(null);
    if (editingHold === nameToRemove) setEditingHold(null);
  };

  const startRenameHold = (h) => {
    setEditingHold(h);
    setEditingHoldName(h);
  };

  const cancelRenameHold = () => {
    setEditingHold(null);
    setEditingHoldName("");
  };

  const saveRenameHold = (oldName) => {
    const nextName = normalizeHoldName(editingHoldName);
    if (!nextName) return;

    if (
      nextName.toLowerCase() !== oldName.toLowerCase() &&
      holdsSafe.some((h) => String(h).toLowerCase() === nextName.toLowerCase())
    ) return;

    setData((prev) => {
      const nextHoldImages = { ...(prev.holdImages || {}) };
      if (nextHoldImages[oldName]) {
        nextHoldImages[nextName] = nextHoldImages[oldName];
        delete nextHoldImages[oldName];
      }

      return {
        ...prev,
        holds: sortHolds((prev.holds || []).map((h) => (h === oldName ? nextName : h))),
        angles: (prev.angles || []).map((a) => (a.hold === oldName ? { ...a, hold: nextName } : a)),
        holdImages: nextHoldImages,
      };
    });

    setEditingHold(null);
    if (selectedProduct === oldName) setSelectedProduct(nextName);
  };

  const addAngleForHold = (holdName, saw) => {
    setData((prev) => ({
      ...prev,
      angles: [...(prev.angles || []), { id: cryptoRandomId(), hold: holdName, value: 0, saw }],
    }));
    setSelectedProduct(holdName);
  };

  const updateAngle = (id, patch) => {
    setData((prev) => ({
      ...prev,
      angles: (prev.angles || []).map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
  };

  const removeAngle = (id) => {
    if (!window.confirm("Delete this angle?")) return;
    setData((prev) => ({
      ...prev,
      angles: (prev.angles || []).filter((a) => a.id !== id),
    }));
    if (selectedAngleId === id) setSelectedAngleId(null);
  };

  const handleDrawingUpload = (e) => {
    const file = e.target.files?.[0];
    const angleId = uploadTargetIdRef.current;
    e.target.value = "";
    if (!file || !angleId) return;
    uploadTargetIdRef.current = null;
    compressImageFile(file)
      .then((dataUrl) => updateAngle(angleId, { drawing: dataUrl }))
      .catch(() => {});
  };

  // ✅ Hold cover upload
  const handleHoldCoverUpload = (e) => {
    const file = e.target.files?.[0];
    const holdName = uploadHoldNameRef.current;
    e.target.value = "";
    uploadHoldNameRef.current = null;
    if (!file || !holdName) return;

    compressImageFile(file, 900, 0.85)
      .then((dataUrl) => {
        setData((prev) => ({
          ...prev,
          holdImages: {
            ...(prev.holdImages || {}),
            [holdName]: dataUrl,
          },
        }));
      })
      .catch(() => {});
  };

  const removeHoldCover = (holdName) => {
    if (!window.confirm("Remove hold cover image?")) return;
    setData((prev) => {
      const next = { ...(prev.holdImages || {}) };
      delete next[holdName];
      return { ...prev, holdImages: next };
    });
  };

  const exportDb = () => downloadJsonFile(data, "angles-db.json");
  const triggerImportDb = () => importDbInputRef.current?.click();

  const handleImportDb = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      const parsed = await readJsonFile(file);
      const safe = migrateAndSanitize(parsed);
      if (!safe.holds?.length) {
        alert("Import failed: no holds found.");
        return;
      }
      setData(safe);
      setSelectedProduct(null);
      setSelectedAngleId(null);
      touchLastModified();
      alert("DB imported ✅");
    } catch (err) {
      console.warn(err);
      alert("Import failed: invalid JSON.");
    }
  };

  const anglesByHold = useMemo(() => {
    const map = new Map();
    holdsSafe.forEach((h) => map.set(h, []));
    anglesSafe.forEach((a) => {
      if (map.has(a.hold)) map.get(a.hold).push(a);
    });
    map.forEach((arr) =>
      arr.sort((x, y) => String(x.saw).localeCompare(String(y.saw)) || Number(x.value) - Number(y.value))
    );
    return map;
  }, [holdsSafe, anglesSafe]);

  const mainAngles = useMemo(
    () => (selectedProduct ? (anglesByHold.get(selectedProduct) || []).filter((a) => a.saw === "main") : []),
    [selectedProduct, anglesByHold]
  );
  const stefanAngles = useMemo(
    () => (selectedProduct ? (anglesByHold.get(selectedProduct) || []).filter((a) => a.saw === "stefan") : []),
    [selectedProduct, anglesByHold]
  );

  if (!authed) {
    return (
      <div style={styles.page}>
        <div style={{ ...styles.grid, gridTemplateColumns: "1fr", maxWidth: 400, margin: "0 auto" }}>
          <Card>
            <div style={styles.cardBody}>
              <div style={styles.adminTitle}>admin</div>
              <div style={{ ...styles.adminRow, flexDirection: "column", alignItems: "stretch", gap: 10 }}>
                <input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="login" style={styles.input} />
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="password"
                  type="password"
                  style={styles.input}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={styles.btnPrimary} onClick={doLogin}>ok</button>
                  <button style={styles.btnGhost} onClick={onExit}>back</button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  const selectedCover = selectedProduct ? (data?.holdImages?.[selectedProduct] || null) : null;

  return (
    <div style={styles.page}>
      <style>{`
        button:focus { outline: none; }
        button:focus-visible { outline: none; }
        button::-moz-focus-inner { border: 0; }
      `}</style>

      <div style={{ ...styles.grid, gridTemplateColumns: "220px 260px 320px 320px" }}>
        {/* Left: holds list */}
        <Card>
          <div style={styles.cardBody}>
            {/* ✅ Admin search */}
            <div style={styles.searchWrap}>
              <div
                style={styles.searchPill}
                role="search"
                onMouseDown={(e) => {
                  e.preventDefault();
                  adminSearchRef.current?.focus();
                }}
              >
                <input
                  ref={adminSearchRef}
                  value={adminHoldSearch}
                  onChange={(e) => setAdminHoldSearch(e.target.value)}
                  placeholder="Search..."
                  style={styles.searchInput}
                />
                <span style={styles.searchIconWrap} aria-hidden="true">
                  <SearchIcon />
                </span>
              </div>
            </div>

            <div style={styles.holdsList}>
              {visibleAdminHolds.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setSelectedProduct(name)}
                  onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
                  style={{ ...styles.holdRowBtn, ...(selectedProduct === name ? styles.holdRowBtnActive : null) }}
                >
                  <span style={styles.holdName}>{name}</span>
                </button>
              ))}
            </div>

            {/* hidden inputs */}
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleDrawingUpload} />
            <input ref={importDbInputRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={handleImportDb} />
            <input ref={holdCoverInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleHoldCoverUpload} />

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={styles.footerRow}>
                <button style={styles.btnGhost} onClick={onExit}>back</button>
                <input
                  value={newHoldName}
                  onChange={(e) => setNewHoldName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addHold()}
                  placeholder="new"
                  style={{ ...styles.input, flex: 1, minWidth: 0, padding: "6px 8px" }}
                />
                <button style={styles.btnPrimary} onClick={addHold}>+</button>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button style={{ ...styles.btnGhost, flex: 1 }} onClick={exportDb}>Export</button>
                <button style={{ ...styles.btnGhost, flex: 1 }} onClick={triggerImportDb}>Import</button>
              </div>

              <div style={{ fontSize: 11, color: "#888", lineHeight: 1.2 }}>
                Last modified: {formatLastModified(lastModifiedMs)}
              </div>

              <div style={{ fontSize: 11, color: "#888", lineHeight: 1.2 }}>
                AVA Volumes © {new Date().getFullYear()} — v{APP_VERSION}
              </div>
            </div>
          </div>
        </Card>

        {/* Hold panel */}
        <Card>
          <div style={styles.tableBody}>
            <div style={styles.tableTitleCenter}>Hold</div>

            {selectedProduct ? (
              !editingHold ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 16, color: "#1a1a1a", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {selectedProduct}
                  </div>

                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button style={styles.btnSmallGhost} onClick={() => startRenameHold(selectedProduct)}>Edit</button>
                    <button style={styles.btnX} onClick={() => confirmRemoveHold(selectedProduct)}>×</button>
                  </div>

                  {/* ✅ Hold cover upload */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                    <div style={{ fontSize: 11, color: "#888" }}>Hold cover</div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <button
                        type="button"
                        style={styles.btnSmallGhost}
                        onClick={() => {
                          uploadHoldNameRef.current = selectedProduct;
                          holdCoverInputRef.current?.click();
                        }}
                      >
                        {selectedCover ? "Change photo" : "Upload photo"}
                      </button>

                      {selectedCover ? (
                        <button type="button" style={styles.btnSmallGhost} onClick={() => removeHoldCover(selectedProduct)}>
                          Remove
                        </button>
                      ) : null}
                    </div>

                    {selectedCover ? (
                      <img
                        src={selectedCover}
                        alt=""
                        style={{
                          width: "100%",
                          maxHeight: 220,
                          objectFit: "contain",
                          border: "1px solid #eee",
                          borderRadius: 6,
                          background: "#fff",
                        }}
                      />
                    ) : (
                      <div style={{ fontSize: 12, color: "#aaa" }}>No photo</div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <input
                    value={editingHoldName}
                    onChange={(e) => setEditingHoldName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveRenameHold(selectedProduct);
                      if (e.key === "Escape") cancelRenameHold();
                    }}
                    style={{ ...styles.input, padding: "8px 10px" }}
                    autoFocus
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button style={styles.btnSmallPrimary} onClick={() => saveRenameHold(selectedProduct)}>Save</button>
                    <button style={styles.btnSmallGhost} onClick={cancelRenameHold}>Cancel</button>
                  </div>
                </div>
              )
            ) : (
              <div style={{ fontSize: 12, color: "#999" }}>Select a hold</div>
            )}
          </div>
        </Card>

        {/* MAIN */}
        <Card>
          <div style={styles.tableBody}>
            <div style={styles.tableTitleCenter}>MAIN</div>
            <div style={styles.table}>
              {selectedProduct ? (
                <>
                  {mainAngles.map((a) => (
                    <AdminAngleRow
                      key={a.id}
                      angle={a}
                      isActive={selectedAngleId === a.id}
                      onSelect={() => setSelectedAngleId(a.id)}
                      onUpdate={(patch) => updateAngle(a.id, patch)}
                      onRemove={() => removeAngle(a.id)}
                      onUpload={() => {
                        uploadTargetIdRef.current = a.id;
                        fileInputRef.current?.click();
                      }}
                    />
                  ))}
                  <button style={{ ...styles.btnGhost, marginTop: 6 }} onClick={() => addAngleForHold(selectedProduct, "main")}>
                    + Add Main angle
                  </button>
                </>
              ) : (
                <div style={styles.tableEmpty} />
              )}
            </div>
          </div>
        </Card>

        {/* STEFAN */}
        <Card>
          <div style={styles.tableBody}>
            <div style={styles.tableTitleCenter}>STEFAN</div>
            <div style={styles.table}>
              {selectedProduct ? (
                <>
                  {stefanAngles.map((a) => (
                    <AdminAngleRow
                      key={a.id}
                      angle={a}
                      isActive={selectedAngleId === a.id}
                      onSelect={() => setSelectedAngleId(a.id)}
                      onUpdate={(patch) => updateAngle(a.id, patch)}
                      onRemove={() => removeAngle(a.id)}
                      onUpload={() => {
                        uploadTargetIdRef.current = a.id;
                        fileInputRef.current?.click();
                      }}
                    />
                  ))}
                  <button style={{ ...styles.btnGhost, marginTop: 6 }} onClick={() => addAngleForHold(selectedProduct, "stefan")}>
                    + Add Stefan angle
                  </button>
                </>
              ) : (
                <div style={styles.tableEmpty} />
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* -------------------- ADMIN ROW: aligned, one line, auto-clear 0 -------------------- */
function AdminAngleRow({ angle, isActive, onSelect, onUpdate, onRemove, onUpload }) {
  const [draft, setDraft] = useState(() => String(angle.value ?? 0));

  useEffect(() => {
    const next = String(angle.value ?? 0);
    if (next !== draft) setDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [angle.value]);

  const commit = () => {
    const raw = String(draft).trim();
    if (!raw) {
      setDraft(String(angle.value ?? 0));
      return;
    }
    const v = Number(raw.replace(",", "."));
    if (Number.isFinite(v)) {
      const vv = clamp(v, 0, 90);
      onUpdate({ value: vv });
      setDraft(String(vv));
    } else {
      setDraft(String(angle.value ?? 0));
    }
  };

  const handleFocus = (e) => {
    const s = String(draft ?? "").trim();
    if (/^0([.,]0+)?$/.test(s)) {
      setDraft("");
      requestAnimationFrame(() => {
        try {
          e.target.setSelectionRange(0, e.target.value.length);
        } catch {}
      });
    } else {
      requestAnimationFrame(() => {
        try {
          e.target.select();
        } catch {}
      });
    }
  };

  return (
    <div
      style={{
        ...styles.tableRow,
        ...styles.adminAngleRow,
        ...(isActive ? styles.tableRowActive : null),
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        flexWrap: "nowrap",
        cursor: "pointer",
      }}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
    >
      <div
        style={{
          minWidth: 0,
          display: "grid",
          gridTemplateColumns: "64px 1fr",
          gap: 10,
          alignItems: "center",
          flex: "1 1 auto",
        }}
      >
        <span style={styles.angleCell}>{toAngleLabel(angle.value)}</span>
        <span
          title={angle.hold}
          style={{ ...styles.nameCell, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {angle.hold}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }} onClick={(e) => e.stopPropagation()}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={handleFocus}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setDraft(String(angle.value ?? 0));
              e.currentTarget.blur();
            }
          }}
          style={styles.adminAngleInput}
        />

        <button type="button" style={styles.btnSmallGhost28} onClick={onUpload}>
          {angle.drawing ? "Change" : "Upload"}
        </button>

        {angle.drawing && (
          <img src={angle.drawing} alt="" style={{ width: 28, height: 28, objectFit: "cover", borderRadius: 4 }} />
        )}

        <button type="button" style={styles.btnX} onClick={onRemove}>
          ×
        </button>
      </div>
    </div>
  );
}

function Card({ children, style, ...rest }) {
  return (
    <div style={{ ...styles.card, ...style }} className="card" {...rest}>
      {children}
    </div>
  );
}

/* ===================== STYLES ===================== */

const styles = {
  page: {
    minHeight: "100vh",
    height: "100vh",
    overflow: "hidden",
    background: "#fafafa",
    padding: 24,
    boxSizing: "border-box",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "220px 260px 260px 1fr",
    gap: 20,
    alignItems: "stretch",
    height: "calc(100vh - 48px)",
    width: "min(1500px, 96vw)",
    margin: "0 auto",
  },
  card: {
    background: "#fff",
    border: "1px solid #e8e8e8",
    borderRadius: 6,
    overflow: "hidden",
    minHeight: 0,
  },
  cardBody: {
    padding: 16,
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    boxSizing: "border-box",
  },

  /* search */
  searchWrap: { paddingBottom: 12 },
  searchPill: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "#fff",
    border: "1px solid #e0e0e0",
    borderRadius: 6,
    padding: "8px 10px",
    boxShadow: "none",
    cursor: "text",
  },
  searchInput: {
    flex: 1,
    border: "none",
    outline: "none",
    fontSize: 12,
    color: "#111",
    minWidth: 0,
    background: "transparent",
    padding: 0,
  },
  searchIconWrap: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
  },

  holdsList: {
    overflow: "auto",
    paddingRight: 4,
    flex: 1,
    minHeight: 0,
  },
  holdRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 0",
    userSelect: "none",
  },

  holdRowBtn: {
    width: "100%",
    border: "1px solid transparent",
    background: "transparent",
    padding: "6px 8px",
    display: "flex",
    alignItems: "center",
    gap: 8,
    cursor: "pointer",
    textAlign: "left",
    userSelect: "none",
    outline: "none",
    boxShadow: "none",
    transition: "none",
    WebkitTapHighlightColor: "transparent",
    borderRadius: 6,
  },
  holdRowBtnActive: {
    background: "#f6f6f6",
    borderColor: "#efefef",
  },

  checkbox: {
    width: 14,
    height: 14,
    cursor: "pointer",
  },
  holdName: {
    fontSize: 13,
    color: "#1a1a1a",
    lineHeight: 1.3,
  },

  footerRow: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    paddingTop: 16,
    marginTop: 16,
    borderTop: "1px solid #eee",
  },
  footerBtn: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  btnGhost: {
    border: "1px solid #ddd",
    background: "#fff",
    borderRadius: 4,
    padding: "8px 12px",
    cursor: "pointer",
    fontSize: 12,
    color: "#1a1a1a",
    transition: "none",
  },
  btnDanger: {
    border: "1px solid #e0e0e0",
    background: "#fff",
    borderRadius: 4,
    padding: "8px 12px",
    cursor: "pointer",
    fontSize: 12,
    color: "#666",
    transition: "none",
  },
  btnPrimary: {
    border: "1px solid #1a1a1a",
    background: "#1a1a1a",
    borderRadius: 4,
    padding: "8px 14px",
    cursor: "pointer",
    fontSize: 12,
    color: "#fff",
    transition: "none",
  },
  btnSmallGhost: {
    border: "1px solid #ddd",
    background: "#fff",
    borderRadius: 4,
    padding: "6px 10px",
    cursor: "pointer",
    fontSize: 11,
    color: "#1a1a1a",
    transition: "none",
  },
  btnSmallGhost28: {
    border: "1px solid #ddd",
    background: "#fff",
    borderRadius: 4,
    padding: "0 10px",
    height: 28,
    cursor: "pointer",
    fontSize: 11,
    color: "#1a1a1a",
    transition: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
  },
  btnSmallPrimary: {
    border: "1px solid #1a1a1a",
    background: "#1a1a1a",
    borderRadius: 4,
    padding: "6px 10px",
    cursor: "pointer",
    fontSize: 11,
    color: "#fff",
    transition: "none",
  },

  tableBody: {
    padding: 16,
    height: "100%",
    minHeight: 0,
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
  },
  tableTitleCenter: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "#888",
    marginBottom: 10,
    textAlign: "center",
  },
  table: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    overflow: "auto",
    flex: 1,
    paddingRight: 4,
    minHeight: 0,
  },
  tableRow: {
    display: "grid",
    gridTemplateColumns: "64px 1fr",
    gap: 10,
    alignItems: "center",
    border: "1px solid #eee",
    borderRadius: 4,
    padding: "8px 10px",
    background: "#fff",
    cursor: "pointer",
    textAlign: "left",
    outline: "none",
    boxShadow: "none",
    transition: "none",
    WebkitTapHighlightColor: "transparent",
  },
  tableRowActive: {
    borderColor: "#eee",
    background: "#fff",
    boxShadow: "none",
    outline: "none",
  },

  adminAngleRow: {
    border: "none",
    borderRadius: 0,
    boxShadow: "none",
    background: "transparent",
    padding: "8px 0",
  },

  adminAngleInput: {
    border: "1px solid #ddd",
    borderRadius: 4,
    height: 28,
    width: 70,
    padding: "0 8px",
    fontSize: 12,
    outline: "none",
    background: "#fff",
    boxSizing: "border-box",
  },

  angleCell: {
    fontWeight: 500,
    color: "#1a1a1a",
    fontSize: 13,
  },
  nameCell: {
    color: "#666",
    fontSize: 12,
  },
  tableEmpty: { height: 8 },

  viewerWrap: { padding: 16, height: "100%", boxSizing: "border-box" },
  viewerEmpty: {
    width: "100%",
    height: "100%",
    border: "1px dashed #e0e0e0",
    borderRadius: 4,
    background: "#fafafa",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  viewerImg: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    borderRadius: 4,
    background: "#fff",
  },

  adminTitle: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.05em",
    color: "#888",
    marginBottom: 10,
  },
  adminRow: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
  },
  input: {
    border: "1px solid #e0e0e0",
    borderRadius: 4,
    padding: "8px 10px",
    fontSize: 12,
    outline: "none",
    background: "#fff",
    transition: "none",
  },
  btnX: {
    border: "1px solid #ddd",
    background: "#fff",
    borderRadius: 4,
    width: 28,
    height: 28,
    cursor: "pointer",
    fontSize: 14,
    lineHeight: "14px",
    color: "#666",
    transition: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
  },
};
