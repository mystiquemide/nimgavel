// Host photo uploads: pick a file, downscale it on-device, and hand the
// lot form a compact data URI. Nothing leaves the device until the lot
// is created.
export async function fileToLotImage(file, { maxEdge = 1000, quality = 0.72 } = {}) {
  if (!file || !file.type || !file.type.startsWith("image/")) {
    throw new Error("Pick a JPEG, PNG, or WebP photo.");
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error("That photo is larger than 8 MB. Pick a smaller one.");
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  let dataUri = canvas.toDataURL("image/jpeg", quality);
  if (dataUri.length > 300_000) {
    // Rare: a dense image can still exceed the storage bound at q0.72.
    dataUri = canvas.toDataURL("image/jpeg", 0.55);
  }
  if (dataUri.length > 300_000) throw new Error("This photo is still too large. Choose a smaller image.");
  return dataUri;
}
