export async function sha256Hex(text) {
  const enc = new TextEncoder();
  const bytes = enc.encode(String(text ?? ""));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
