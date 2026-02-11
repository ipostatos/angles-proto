import { migrateAndSanitize } from "./storage";

export function downloadJsonFile(obj, filename = "angles-db.json") {
  const safe = migrateAndSanitize(obj);
  const payload = {
    app: "AnglesProto",
    exportedAt: new Date().toISOString(),
    version: 1,
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

export async function readJsonFile(file) {
  const text = await file.text();
  return JSON.parse(text);
}
