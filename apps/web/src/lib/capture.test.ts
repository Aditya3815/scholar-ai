import { describe, expect, it } from "vitest";
import { FIRST_FRAME, captureTransform, nudgeFrame, rectFromDrag } from "./capture";

describe("Capture: the place on the page (docs/design/paper-reader.md, 21.1, 6)", () => {
  const box = { width: 600, height: 800 };

  it("a drag gives fractions of the page's box, whichever way it went, held inside the page", () => {
    expect(rectFromDrag({ x: 60, y: 80 }, { x: 360, y: 480 }, box)).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
    expect(rectFromDrag({ x: 360, y: 480 }, { x: 60, y: 80 }, box)).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
    expect(rectFromDrag({ x: -50, y: 700 }, { x: 300, y: 900 }, box)).toEqual({ x: 0, y: 0.875, w: 0.5, h: 0.125 });
  });

  it("a click or a tiny drag is not a frame", () => {
    expect(rectFromDrag({ x: 100, y: 100 }, { x: 105, y: 300 }, box)).toBeNull();
    expect(rectFromDrag({ x: 100, y: 100 }, { x: 300, y: 104 }, box)).toBeNull();
    expect(rectFromDrag({ x: 0, y: 0 }, { x: 100, y: 100 }, { width: 0, height: 0 })).toBeNull();
  });

  it("the keyboard's frame: arrows move it, Shift and arrows resize it, never out of the page or below 5 %", () => {
    expect(nudgeFrame(FIRST_FRAME, "ArrowRight", false)).toEqual({ ...FIRST_FRAME, x: 0.27 });
    let r = FIRST_FRAME;
    for (let i = 0; i < 100; i++) r = nudgeFrame(r, "ArrowLeft", false);
    expect(r.x).toBe(0);
    for (let i = 0; i < 100; i++) r = nudgeFrame(r, "ArrowDown", true);
    expect(r.y + r.h).toBeCloseTo(1);
    for (let i = 0; i < 100; i++) r = nudgeFrame(r, "ArrowLeft", true);
    expect(r.w).toBe(0.05);
    expect(nudgeFrame(r, "Enter", false)).toBe(r);
  });

  it("drawn sharp at any width: the canvas is the frame at the device's pixels, the page moved so the frame's corner is the canvas's (a rotated page is its rotated viewport)", () => {
    const r = { x: 0.25, y: 0.5, w: 0.5, h: 0.25 };
    // a portrait page (612 x 792), 300 CSS pixels wide on a 2x screen
    const t = captureTransform(r, { width: 612, height: 792 }, 300, 2);
    expect(t.width).toBe(600);
    expect(t.scale).toBeCloseTo(600 / 306);
    expect(t.height).toBe(Math.round(0.25 * 792 * t.scale));
    expect(t.transform[4]).toBeCloseTo(-0.25 * 612 * t.scale);
    expect(t.transform[5]).toBeCloseTo(-0.5 * 792 * t.scale);
    // the same page turned a quarter (its viewport is 792 x 612): the same fractions are a wider, shorter part
    const turned = captureTransform(r, { width: 792, height: 612 }, 300, 2);
    expect(turned.width).toBe(600);
    expect(turned.height).toBe(Math.round(0.25 * 612 * turned.scale));
    expect(turned.cssHeight).toBeCloseTo(turned.height / 2);
  });
});
