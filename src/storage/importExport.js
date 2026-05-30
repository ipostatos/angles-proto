import { migrateAndSanitize } from '../domain/migration.js';

export const MAX_DB_SIZE_KB = 4500;

export function downloadJsonFile(obj, filename = 'angles-db.json') {
    // obj is already v2 if the app has migrated, or v1 if not yet
    const payload = {
        app: 'AnglesProto',
        exportedAt: new Date().toISOString(),
        version: obj.version ?? 1,
        data: obj,
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

export function serializedSizeKB(obj) {
    try {
        return new Blob([JSON.stringify(obj)]).size / 1024;
    } catch {
        return Infinity;
    }
}
