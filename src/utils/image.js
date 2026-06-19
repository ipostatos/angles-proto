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
