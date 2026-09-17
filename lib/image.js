// Host photo uploads: pick a file, downscale it on-device, and hand the
// lot form a compact data URI. Nothing leaves the device until the lot
// is created.
export async function fileToLotImage(file, { maxEdge = 1000, quality = 0.72 } = {}) {
  if (!file || !file.type || !file.type.startsWith("image/")) {
    throw new Error("Pick an image from your device.");
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error("That photo is larger than 8 MB. Pick a smaller one.");
  }

  const drawable = await decodeImage(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(drawable.width, drawable.height));
    const width = Math.max(1, Math.round(drawable.width * scale));
    const height = Math.max(1, Math.round(drawable.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This device could not prepare the photo.");
    context.drawImage(drawable.source, 0, 0, width, height);

    let dataUri = canvas.toDataURL("image/jpeg", quality);
    if (dataUri.length > 300_000) {
      // Rare: a dense image can still exceed the storage bound at q0.72.
      dataUri = canvas.toDataURL("image/jpeg", 0.55);
    }
    if (dataUri.length > 300_000) throw new Error("This photo is still too large. Choose a smaller image.");
    return dataUri;
  } finally {
    drawable.close?.();
  }
}

async function decodeImage(file) {
  // createImageBitmap is fast when WebKit supports the selected photo type,
  // but Nimiq Pay's iOS WebView can reject some Photos-library formats.
  // Fall back to a normal <img> decoder, which is more compatible on iOS.
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close?.()
      };
    } catch {
      // Continue with the WebKit image-element fallback below.
    }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        URL.revokeObjectURL(url);
        reject(new Error("That photo could not be read. Try a JPEG or PNG."));
        return;
      }
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        close: () => URL.revokeObjectURL(url)
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That photo could not be read. Try a JPEG or PNG."));
    };
    image.src = url;
  });
}
