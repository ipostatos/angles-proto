/** Resize/compress image to reduce localStorage size. Returns data URL (jpeg). */
export function compressImageFile(file, maxSize = 800, quality = 0.82) {
    return new Promise((resolve, reject) => {
        if (!file?.type?.startsWith("image/")) {
            reject(new Error("Not an image"));
            return;
        }

        const img = new Image();
        const url = URL.createObjectURL(file);

        let done = false;
        const finish = (fn) => (arg) => {
            if (done) return;
            done = true;
            try {
                URL.revokeObjectURL(url);
            } finally {
                fn(arg);
            }
        };

        img.onload = finish(() => {
            const w = img.naturalWidth;
            const h = img.naturalHeight;
            let dw = w, dh = h;

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
        });

        img.onerror = finish(() => {
            reject(new Error("Failed to load image"));
        });

        img.src = url;
    });
}

export function printImage(src) {
    if (!src) return;

    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    Object.assign(iframe.style, {
        position: "fixed",
        width: "0",
        height: "0",
        border: "0",
        opacity: "0",
        pointerEvents: "none",
    });
    document.body.appendChild(iframe);

    const cleanup = () => {
        setTimeout(() => iframe.remove(), 500);
    };

    const win = iframe.contentWindow;
    const doc = iframe.contentDocument || win?.document;
    if (!doc || !win) {
        cleanup();
        return;
    }

    doc.open();
    doc.write(`<!DOCTYPE html><html><head><title>Drawing</title><style>
      @page { margin: 12mm; }
      html, body { margin: 0; padding: 0; height: 100%; }
      body { display: flex; align-items: center; justify-content: center; }
      img { max-width: 100%; max-height: 100%; object-fit: contain; }
    </style></head><body><img id="print-drawing" alt="drawing" /></body></html>`);
    doc.close();

    const img = doc.getElementById("print-drawing");
    if (!img) {
        cleanup();
        return;
    }

    let printed = false;
    const doPrint = () => {
        if (printed) return;
        printed = true;
        try {
            win.focus();
            win.print();
        } finally {
            cleanup();
        }
    };

    img.onerror = cleanup;
    img.onload = doPrint;
    img.src = src;
    if (img.complete) doPrint();
}
