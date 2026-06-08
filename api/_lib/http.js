// Small HTTP helpers shared by the Node serverless handlers.

/**
 * Read and JSON-parse a request body. Prefers Vercel's pre-parsed `req.body`,
 * falling back to reading the raw stream. Returns {} on empty/invalid bodies.
 */
export async function readJsonBody(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') {
        try { return JSON.parse(req.body || '{}'); } catch { return {}; }
    }
    return await new Promise((resolve) => {
        let raw = '';
        req.on('data', (chunk) => { raw += chunk; });
        req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
        req.on('error', () => resolve({}));
    });
}
