import { describe, expect, it } from "vitest";
import { NOTEBOOK_IMAGE_TYPES, checkNotebookBlocks } from "./notebook";
import { NOTE_IMAGE_LIMITS, NOTE_IMAGE_TYPES, noteImageInfo, noteImageProblem } from "./note-image";

const bytes = (...parts: (number[] | string)[]) => new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [(n >> 8) & 255, n & 255];
const png = (w: number, h: number) => bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a], be32(13), "IHDR", be32(w), be32(h), [8, 6, 0, 0, 0], new Array(20).fill(0));
const jpeg = (w: number, h: number, exif = false) =>
  bytes([0xff, 0xd8], exif ? [0xff, 0xe1, ...be16(8)] : [], exif ? "Exif" : "", exif ? [0, 0] : [], [0xff, 0xe0, ...be16(16)], "JFIF", new Array(10).fill(0), [0xff, 0xc0, ...be16(17), 8, ...be16(h), ...be16(w), 3], new Array(20).fill(0));
const webpVP8X = (w: number, h: number, exifFlag = false) => bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8X", [10, 0, 0, 0], [exifFlag ? 0x08 : 0, 0, 0, 0], [(w - 1) & 255, ((w - 1) >> 8) & 255, 0], [(h - 1) & 255, ((h - 1) >> 8) & 255, 0], new Array(10).fill(0));

describe("pictures in the notes: read from their bytes (paper-reader.md 22)", () => {
  it("knows a PNG, a JPEG and a WebP, with their size, whatever the name or the type claimed", () => {
    expect(noteImageInfo(png(640, 480))).toEqual({ type: "image/png", w: 640, h: 480, exif: false });
    expect(noteImageInfo(jpeg(1200, 900))).toEqual({ type: "image/jpeg", w: 1200, h: 900, exif: false });
    expect(noteImageInfo(webpVP8X(800, 600))).toEqual({ type: "image/webp", w: 800, h: 600, exif: false });
    expect(noteImageInfo(bytes("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"))).toBeNull();
    expect(noteImageInfo(bytes("GIF89a", new Array(30).fill(0)))).toBeNull();
    expect(noteImageInfo(bytes("%PDF-1.7", new Array(30).fill(0)))).toBeNull();
  });

  it("refuses what is too big, too large a side, or still holds camera data", () => {
    expect(noteImageProblem(png(2000, 1500))).toBeNull();
    expect(noteImageProblem(png(2001, 10))?.status).toBe(400);
    expect(noteImageProblem(jpeg(100, 100, true))?.reason).toMatch(/EXIF/);
    expect(noteImageProblem(webpVP8X(100, 100, true))?.reason).toMatch(/EXIF/);
    const big = new Uint8Array(NOTE_IMAGE_LIMITS.bytes + 1);
    big.set(png(10, 10));
    expect(noteImageProblem(big)?.status).toBe(413);
    expect(noteImageProblem(bytes("not a picture at all, just words"))?.status).toBe(400);
  });

  it("a picture block: its size, its kind and its words; the kinds are the sniffer's", () => {
    expect([...NOTEBOOK_IMAGE_TYPES]).toEqual([...NOTE_IMAGE_TYPES]);
    const img = { id: "i1", kind: "image", w: 640, h: 480, type: "image/png", alt: " A  diagram " };
    expect(checkNotebookBlocks([img], 10)).toEqual({ ok: true, blocks: [{ ...img, alt: "A diagram" }] });
    for (const bad of [{ w: 0 }, { h: 2001 }, { type: "image/svg+xml" }, { alt: undefined }, { w: 1.5 }]) expect(checkNotebookBlocks([{ ...img, ...bad }], 10).ok).toBe(false);
    expect(checkNotebookBlocks([{ ...img, alt: "a".repeat(301) }], 10)).toMatchObject({ ok: false, status: 413 });
    // the file is never in the block: only its known fields come back
    expect(checkNotebookBlocks([{ ...img, src: "https://example.org/x.png", data: "AAAA" }], 10)).toEqual({ ok: true, blocks: [{ ...img, alt: "A diagram" }] });
  });
});
