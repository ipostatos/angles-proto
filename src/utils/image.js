export function compressImageFile(file, maxSize = 800, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith("image/")) {
      reject(new Error("Not an image"));
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);

    const cleanup = () => {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    };

    img.onload = () => {
      try {
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
          throw new Error("No canvas context");
        }
        ctx.drawImage(img, 0, 0, dw, dh);

        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl);
      } catch (e) {
        reject(e);
      } finally {
        cleanup();
      }
    };

    img.onerror = () => {
      cleanup();
      reject(new Error("Failed to load image"));
    };

    img.src = url;
  });
}

export function checkStorageCapacity(testData) {
  const json = JSON.stringify(testData);
  const sizeKB = new Blob([json]).size / 1024;
  const MAX_SIZE_KB = 4 * 1024;

  if (sizeKB > MAX_SIZE_KB) {
    throw new Error(
      `Storage full: ${sizeKB.toFixed(0)}KB (max ${MAX_SIZE_KB}KB). Remove some drawings or use smaller images.`
    );
  }
  return true;
}
