import { LS_KEY } from './db.js';

export const LS_BACKUPS_KEY = `${LS_KEY}_backups`;
export const MAX_BACKUPS = 5;

export function pushBackup(snapshot) {
    try {
        const raw = localStorage.getItem(LS_BACKUPS_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        const next = [{ ts: Date.now(), data: snapshot }, ...(Array.isArray(arr) ? arr : [])].slice(0, MAX_BACKUPS);
        localStorage.setItem(LS_BACKUPS_KEY, JSON.stringify(next));
    } catch (e) {
        console.warn('Backup failed:', e);
    }
}
