import { NOTE_IMAGE_LIMITS } from "@scholar/shared";

/**
 * A picture for the notes, made ready in the browser (paper-reader.md 22): turned the right way up (the browser reads the camera's orientation), at most 2000 pixels a side, and drawn
 * afresh on a canvas, so what is sent has no camera data (EXIF: the place, the time, the device). A PNG stays a PNG when it fits in 2 MB; anything else becomes a JPEG, made smaller
 * until it fits. Loaded only when Image is used.
 */
export type ReadyImage = { blob: Blob; w: number; h: number; type: "image/jpeg" | "image/png" };

const encode = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob | null>((res) => c.toBlob(res, type, q));

export async function prepareNoteImage(file: File): Promise<ReadyImage> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Choose a JPEG, PNG or WebP picture.");
  if (file.size > 40 * 1024 * 1024) throw new Error("That picture is too big to add.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("That picture could not be read.");
  }
  let scale = Math.min(1, NOTE_IMAGE_LIMITS.side / Math.max(bitmap.width, bitmap.height));
  for (let round = 0; round < 6; round++) {
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) break;
    const png = file.type === "image/png";
    if (!png) {
      // a JPEG has no transparency: what was clear becomes white, as on paper
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    const tries: [string, number | undefined][] = png ? [["image/png", undefined], ["image/jpeg", 0.85]] : [["image/jpeg", 0.85], ["image/jpeg", 0.7]];
    for (const [type, q] of tries) {
      const blob = await encode(c, type, q);
      if (blob && blob.size <= NOTE_IMAGE_LIMITS.bytes) {
        bitmap.close();
        return { blob, w, h, type: type as ReadyImage["type"] };
      }
    }
    scale *= 0.75;
  }
  bitmap.close();
  throw new Error("That picture could not be made small enough (2 MB).");
}
