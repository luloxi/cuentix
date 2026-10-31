/**
 * Resize + JPEG-compress a photo before upload so it fits Vercel's
 * ~4.5MB request body limit and OpenAI vision works well.
 */
export async function compressImageForUpload(
  file: File,
  opts?: { maxEdge?: number; quality?: number; maxBytes?: number },
): Promise<File> {
  const maxEdge = opts?.maxEdge ?? 1600;
  const maxBytes = opts?.maxBytes ?? 3.5 * 1024 * 1024;
  let quality = opts?.quality ?? 0.82;

  // Already small enough and not a huge raw HEIC/PNG from camera
  if (file.size <= maxBytes && file.type === "image/jpeg") {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);

    let blob: Blob | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
      );
      if (!blob) break;
      if (blob.size <= maxBytes) break;
      quality = Math.max(0.45, quality - 0.12);
    }

    if (!blob) return file;

    const name = file.name.replace(/\.\w+$/, "") || "ticket";
    return new File([blob], `${name}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } finally {
    bitmap.close();
  }
}
