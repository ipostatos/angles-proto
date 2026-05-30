export const LS_KEY = 'angles_proto_v1';
export const ADMIN_HASH_KEY = `${LS_KEY}_admin_hash`;
export const ADMIN_SESSION_KEY = `${LS_KEY}_admin_session`;
export const ADMIN_REMEMBER_KEY = `${LS_KEY}_admin_remember`;

export function hasAdminSession() {
    try {
        if (sessionStorage.getItem(ADMIN_SESSION_KEY) === "1") return true;
        if (localStorage.getItem(ADMIN_REMEMBER_KEY) === "1") return true;
        return false;
    } catch { return false; }
}

export async function sha256Hex(text) {
    const enc = new TextEncoder();
    const bytes = enc.encode(String(text ?? ""));
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
