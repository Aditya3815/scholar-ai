import { INVITE_PICTURE_MAX_BYTES, MAX_COVER_BYTES } from "@scholar/shared";
import type { EnvPick } from "../platform/env";

/**
 * The picture of a paper's first page in its invitation e-mail (docs/design/paper-share.md, S4). First choice: the paper's stored cover (the JPEG of page 1, about 360 px wide, that the
 * page made at upload: `docs/<user>/<id>.cover.jpg` in R2), read when the e-mail is sent, so the picture comes from any device on any connection. Second: a picture the owner's Share
 * dialog drew with pdf.js and sent, for a paper with no cover. Last: none, and the e-mail shows a neutral page-shaped block. Either picture is checked strictly, never stored again and never
 * given an address: it goes into that one e-mail as an inline part. What is checked: at most its size cap, a JPEG from its first marker to its last (SOI ... EOI), every segment's length inside
 * the file, a frame header whose size is a page's (100 px up to the cap's width, at most twice as tall as wide, at least half), and only the segments a picture needs: the metadata segments
 * (APP1 to APP15, comments) are taken out, so nothing but the picture is passed on.
 */

export type InvitePicture = { bytes: Uint8Array; width: number; height: number };
export type PictureCheck = { ok: true; picture: InvitePicture } | { ok: false; reason: string };

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MIN_W = 100;
/** What the dialog may send, and what a stored cover may be (the upload route takes covers up to MAX_COVER_BYTES). */
export const SENT_LIMITS = { maxBytes: INVITE_PICTURE_MAX_BYTES, maxWidth: 480 } as const;
export const COVER_LIMITS = { maxBytes: MAX_COVER_BYTES, maxWidth: 600 } as const;
type Limits = { maxBytes: number; maxWidth: number };

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

/** Checks what the dialog sent (base64). Nothing sent is not an error (an older page, a paper with a cover, or a page that could not draw it). */
export function checkInvitePicture(raw: unknown): PictureCheck {
  if (typeof raw !== "string") return { ok: false, reason: "not_text" };
  if (raw.length > Math.ceil(SENT_LIMITS.maxBytes / 3) * 4) return { ok: false, reason: "too_big" };
  const b = decode(raw);
  if (!b) return { ok: false, reason: "not_base64" };
  return checkJpeg(b, SENT_LIMITS);
}

/** Checks a JPEG's bytes against the limits; the picture without its metadata segments when it passes. */
export function checkJpeg(b: Uint8Array, limits: Limits): PictureCheck {
  if (b.length > limits.maxBytes) return { ok: false, reason: "too_big" };
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
  if (width < MIN_W || width > limits.maxWidth || height < width / 2 || height > width * 2) return { ok: false, reason: "bad_size" };
  const total = kept.reduce((n, p) => n + p.length, 0);
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const p of kept) {
    bytes.set(p, at);
    at += p.length;
  }
  return { ok: true, picture: { bytes, width, height } };
}

/** The object store as this module reads it (R2's `get`). */
type Files = { get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; size: number } | null> };

/**
 * The paper's stored cover as the e-mail's picture, or null: no cover, not found, too big, not a page's JPEG, or the store failed (the reason is logged, never the paper). Read once, when
 * the e-mail goes.
 */
export async function coverPicture(env: EnvPick<"FILES">, key: string): Promise<InvitePicture | null> {
  const files = env.FILES as unknown as Files;
  try {
    const obj = await files.get(key);
    if (!obj) return leftOut("cover_missing");
    if (obj.size > COVER_LIMITS.maxBytes) return leftOut("cover_too_big");
    const got = checkJpeg(new Uint8Array(await obj.arrayBuffer()), COVER_LIMITS);
    return got.ok ? got.picture : leftOut(`cover_${got.reason}`);
  } catch (e) {
    return leftOut(`cover_${e instanceof Error ? e.name : "error"}`);
  }
}

/** A picture left out of an invitation: its reason in the log, nothing else. */
export function leftOut(reason: string): null {
  console.warn(JSON.stringify({ level: "warn", msg: "invite_picture_left_out", reason }));
  return null;
}
