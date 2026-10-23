/**
 * The page picture the browser sends is checked before anything is spent on it: it must be a JPEG, of a size a page can have, and not a picture
 * that would cost far more than a page (a huge image makes a model read, and bill, for thousands of tokens). Reads the header only.
 */
export type JpegInfo = { width: number; height: number; comment: string | null };

/** Start-of-frame markers: the ones that carry the picture's height and width (0xC0 to 0xCF except 0xC4 DHT, 0xC8 JPG and 0xCC DAC). */
const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

export function readJpeg(bytes: Uint8Array): JpegInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  let comment: string | null = null;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    let marker = bytes[i + 1]!;
    while (marker === 0xff && i + 2 < bytes.length) {
      i++;
      marker = bytes[i + 1]!;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of picture, or the picture data, without having seen a size
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (len < 2 || i + 2 + len > bytes.length) return null;
    if (marker === 0xfe && comment === null) comment = new TextDecoder().decode(bytes.subarray(i + 4, i + 2 + len));
    if (isSof(marker)) {
      if (len < 8) return null;
      const height = (bytes[i + 5]! << 8) | bytes[i + 6]!;
      const width = (bytes[i + 7]! << 8) | bytes[i + 8]!;
      return width > 0 && height > 0 ? { width, height, comment } : null;
    }
    i += 2 + len;
  }
  return null;
}

/** Writes `comment` into a JPEG (as a COM segment right after the start marker). Used by tests to tell the stand-in reader what the page "says". */
export function withComment(bytes: Uint8Array, comment: string): Uint8Array {
  const text = new TextEncoder().encode(comment);
  const seg = new Uint8Array(4 + text.length);
  seg.set([0xff, 0xfe, (text.length + 2) >> 8, (text.length + 2) & 0xff]);
  seg.set(text, 4);
  const out = new Uint8Array(bytes.length + seg.length);
  out.set(bytes.subarray(0, 2));
  out.set(seg, 2);
  out.set(bytes.subarray(2), 2 + seg.length);
  return out;
}
