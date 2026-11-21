import { INVITE_PICTURE_MAX_BYTES } from "@scholar/shared";

/**
 * The picture of a paper's first page that the owner's Share dialog sends with an invitation (docs/design/paper-share.md, S4): a small JPEG the browser drew with pdf.js. It is checked
 * strictly, never stored and never given an address: it goes into that one e-mail as an inline part and is forgotten. What is checked: base64 and nothing else, at most
 * INVITE_PICTURE_MAX_BYTES, a JPEG from its first marker to its last (SOI ... EOI), a frame header whose size is a page's (100 to 480 px wide, at most twice as tall as wide, at least
 * half), and only the segments a picture needs: the metadata segments (APP1 to APP15, comments) are taken out, so nothing but the picture is passed on.
 */

export type InvitePicture = { bytes: Uint8Array; width: number; height: number };
export type PictureCheck = { ok: true; picture: InvitePicture } | { ok: false; reason: string };

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MIN_W = 100;
const MAX_W = 480;

/** The frame headers (SOF0 to SOF15 but DHT, JPG and DAC), where the size of the picture is written. */
const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

function decode(b64: string): Uint8Array | null {
  if (b64.length % 4 !== 0 || !B64.test(b64)) return null;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Checks what the dialog sent. Nothing sent is not an error (an older page, or a page that could not draw it): the caller sends the e-mail without the picture either way. */
export function checkInvitePicture(raw: unknown): PictureCheck {
  if (typeof raw !== "string") return { ok: false, reason: "not_text" };
  if (raw.length > Math.ceil(INVITE_PICTURE_MAX_BYTES / 3) * 4) return { ok: false, reason: "too_big" };
  const b = decode(raw);
  if (!b) return { ok: false, reason: "not_base64" };
  if (b.length > INVITE_PICTURE_MAX_BYTES) return { ok: false, reason: "too_big" };
  if (b.length < 128 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return { ok: false, reason: "not_jpeg" };
  if (b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) return { ok: false, reason: "not_jpeg" };

  // the segments before the scan: each is FF, its marker, a two-byte length (the length included); the picture data follows SOS to the end
  const kept: Uint8Array[] = [b.subarray(0, 2)];
  let width = 0;
  let height = 0;
  let i = 2;
  for (;;) {
    if (i + 4 > b.length || b[i] !== 0xff) return { ok: false, reason: "bad_segment" };
    let m = b[i + 1]!;
    while (m === 0xff && i + 2 < b.length) m = b[++i + 1]!; // fill bytes
    if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) return { ok: false, reason: "bad_segment" };
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (len < 2 || i + 2 + len > b.length) return { ok: false, reason: "bad_segment" };
    const seg = b.subarray(i, i + 2 + len);
    if (isSof(m)) {
      if (len < 8) return { ok: false, reason: "bad_segment" };
      height = (b[i + 5]! << 8) | b[i + 6]!;
      width = (b[i + 7]! << 8) | b[i + 8]!;
    }
    if (m === 0xda) {
      kept.push(b.subarray(i)); // the scan and everything after it, to EOI
      break;
    }
    const metadata = (m >= 0xe1 && m <= 0xef) || m === 0xfe;
    if (!metadata) kept.push(seg);
    i += 2 + len;
  }
  if (!width || !height) return { ok: false, reason: "no_frame" };
  if (width < MIN_W || width > MAX_W || height < width / 2 || height > width * 2) return { ok: false, reason: "bad_size" };
  const total = kept.reduce((n, p) => n + p.length, 0);
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const p of kept) {
    bytes.set(p, at);
    at += p.length;
  }
  return { ok: true, picture: { bytes, width, height } };
}
