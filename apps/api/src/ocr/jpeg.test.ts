import { describe, expect, it } from "vitest";
import { readJpeg, withComment } from "./jpeg";

/** The smallest header a decoder needs: SOI, a JFIF APP0, SOF0 with the size, then the start of scan. Not a decodable picture; readJpeg only reads the header. */
function jpeg(width: number, height: number, { comment, sof = 0xc0 }: { comment?: string; sof?: number } = {}): Uint8Array {
  const parts: number[] = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  if (comment !== undefined) {
    const t = [...new TextEncoder().encode(comment)];
    parts.push(0xff, 0xfe, (t.length + 2) >> 8, (t.length + 2) & 0xff, ...t);
  }
  parts.push(0xff, sof, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xff, 0xd9);
  return new Uint8Array(parts);
}

describe("readJpeg", () => {
  it("reads the size of a JPEG from its header", () => {
    expect(readJpeg(jpeg(1240, 1754))).toEqual({ width: 1240, height: 1754, comment: null });
    expect(readJpeg(jpeg(65535, 3))).toMatchObject({ width: 65535, height: 3 });
  });
  it("finds the size also in progressive and other start-of-frame variants", () => {
    expect(readJpeg(jpeg(800, 600, { sof: 0xc2 }))).toMatchObject({ width: 800, height: 600 });
  });
  it("returns the comment", () => {
    expect(readJpeg(jpeg(10, 20, { comment: '{"first":"x"}' }))?.comment).toBe('{"first":"x"}');
    expect(readJpeg(withComment(jpeg(10, 20), "hello"))).toMatchObject({ width: 10, height: 20, comment: "hello" });
  });
  it("refuses what is not a JPEG", () => {
    expect(readJpeg(new Uint8Array([]))).toBeNull();
    expect(readJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull(); // a PNG
    expect(readJpeg(new TextEncoder().encode("%PDF-1.4 not a picture at all"))).toBeNull();
    expect(readJpeg(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
  it("refuses a header that is cut off, lies about a segment length, or has no size", () => {
    const whole = jpeg(100, 100);
    expect(readJpeg(whole.subarray(0, 25))).toBeNull();
    const lying = whole.slice();
    lying[4] = 0xff;
    lying[5] = 0xff;
    expect(readJpeg(lying)).toBeNull();
    expect(readJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]))).toBeNull();
    expect(readJpeg(jpeg(0, 100))).toBeNull();
  });
  it("is not fooled by 0xFF padding bytes between segments", () => {
    const base = jpeg(300, 400);
    const padded = new Uint8Array([...base.subarray(0, 2), 0xff, 0xff, 0xff, ...base.subarray(2)]);
    expect(readJpeg(padded)).toMatchObject({ width: 300, height: 400 });
  });
});
