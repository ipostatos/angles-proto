// Small HTTP helpers shared by the Node serverless handlers.

export const DEFAULT_JSON_BODY_LIMIT_BYTES = 64 * 1024;

export class PayloadTooLargeError extends Error {
    constructor(limitBytes) {
        super(`Request body exceeds ${limitBytes} bytes`);
        this.name = 'PayloadTooLargeError';
        this.status = 413;
        this.code = 'payload_too_large';
        this.limitBytes = limitBytes;
    }
}

function byteLength(value) {
    return Buffer.byteLength(String(value), 'utf8');
}

/**
 * Read and JSON-parse a request body. Prefers Vercel's pre-parsed `req.body`,
 * falling back to reading the raw stream. Returns {} on empty/invalid bodies.
 */
export async function readJsonBody(req, opts = {}) {
    const maxBytes = opts.maxBytes ?? DEFAULT_JSON_BODY_LIMIT_BYTES;
    if (req.body && typeof req.body === 'object') {
        if (byteLength(JSON.stringify(req.body)) > maxBytes) throw new PayloadTooLargeError(maxBytes);
        return req.body;
    }
    if (typeof req.body === 'string') {
        if (byteLength(req.body) > maxBytes) throw new PayloadTooLargeError(maxBytes);
        try { return JSON.parse(req.body || '{}'); } catch { return {}; }
    }
    return await new Promise((resolve, reject) => {
        let raw = '';
        let size = 0;
        req.on('data', (chunk) => {
            size += Buffer.byteLength(chunk);
            if (size > maxBytes) {
                reject(new PayloadTooLargeError(maxBytes));
                req.destroy?.();
                return;
            }
            raw += chunk;
        });
        req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
        req.on('error', () => resolve({}));
    });
}
