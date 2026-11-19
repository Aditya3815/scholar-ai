/**
 * Pictures in the notes (docs/design/paper-reader.md, 22, the owner's yes of 18 Nov 2026): what a file must be, read from its first bytes (never from its name or the type the
 * browser claims). JPEG, PNG or WebP; at most 2 MB; at most 2000 pixels a side (the page makes it so before it sends it); a JPEG with EXIF (where a camera puts the place and the
 * time) is refused, because the page's copy never has it. Imports nothing.
 */
export const NOTE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type NoteImageType = (typeof NOTE_IMAGE_TYPES)[number];
export const NOTE_IMAGE_LIMITS = { bytes: 2 * 1024 * 1024, side: 2000, perPaper: 200, alt: 300 } as const;

export type NoteImageInfo = { type: NoteImageType; w: number; h: number; exif: boolean };

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

/** The kind and size of a picture, from its bytes; null when it is none of the three or cannot be read. */
export function noteImageInfo(b: Uint8Array): NoteImageInfo | null {
  if (b.length < 24) return null;
  // PNG: the signature, then IHDR with the width and height
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    if (ascii(b, 12, 4) !== "IHDR") return null;
    return { type: "image/png", w: u32be(b, 16), h: u32be(b, 20), exif: false };
  }
  // WebP: RIFF....WEBP and one of its three kinds of first chunk
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP" && b.length >= 30) {
    const kind = ascii(b, 12, 4);
    if (kind === "VP8 ") return { type: "image/webp", w: u16le(b, 26) & 0x3fff, h: u16le(b, 28) & 0x3fff, exif: false };
    if (kind === "VP8L") {
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
      return { type: "image/webp", w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1, exif: false };
    }
    if (kind === "VP8X") return { type: "image/webp", w: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), h: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)), exif: (b[20]! & 0x08) !== 0 };
    return null;
  }
  // JPEG: walk the markers to the frame (SOFn), noting an APP1 Exif on the way
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    let exif = false;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1]!;
      if (m === 0xff) {
        i++;
        continue;
      }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = u16be(b, i + 2);
      if (len < 2) return null;
      if (m === 0xe1 && ascii(b, i + 4, 4) === "Exif") exif = true;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type: "image/jpeg", h: u16be(b, i + 5), w: u16be(b, i + 7), exif };
      i += 2 + len;
    }
    return null;
  }
  return null;
}

/** Why a picture cannot be kept, or null when it can. */
export function noteImageProblem(b: Uint8Array): { status: 400 | 413; reason: string } | null {
  if (b.length > NOTE_IMAGE_LIMITS.bytes) return { status: 413, reason: "too big: a picture in the notes is at most 2 MB" };
  const info = noteImageInfo(b);
  if (!info) return { status: 400, reason: "not a JPEG, PNG or WebP picture" };
  if (info.w < 1 || info.h < 1 || info.w > NOTE_IMAGE_LIMITS.side || info.h > NOTE_IMAGE_LIMITS.side) return { status: 400, reason: "a picture is at most 2000 pixels a side" };
  if (info.exif) return { status: 400, reason: "the picture still has its camera data (EXIF)" };
  return null;
}
