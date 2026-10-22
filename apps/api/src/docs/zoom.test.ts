import { describe, expect, it } from "vitest";
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STOPS, anchoredScroll, clampZoom, pinchFactor, stepZoom, wheelFactor } from "@scholar/shared";

describe("clampZoom", () => {
  it("keeps the zoom between the smallest and the largest step", () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(9)).toBe(MAX_ZOOM);
    expect(clampZoom(1.37)).toBe(1.37);
  });
  it("a value that is not a number falls back to fit-to-width", () => {
    for (const bad of [Number.NaN, Infinity, -Infinity]) expect(clampZoom(bad)).toBe(bad === Infinity ? 1 : 1);
  });
});

describe("stepZoom", () => {
  it("goes to the neighbouring step from a step", () => {
    expect(stepZoom(1, 1)).toBe(1.15);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(0.6, 1)).toBe(0.75);
  });
  it("from between two steps (after a pinch) goes to the next one in that direction, not past it", () => {
    expect(stepZoom(1.2, 1)).toBe(1.3);
    expect(stepZoom(1.2, -1)).toBe(1.15);
    expect(stepZoom(0.62, 1)).toBe(0.75);
    expect(stepZoom(2.4, -1)).toBe(2);
  });
  it("a value a hair off a step counts as being on it", () => {
    expect(stepZoom(1.0001, 1)).toBe(1.15);
    expect(stepZoom(0.9999, -1)).toBe(0.9);
  });
  it("stays at the ends", () => {
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });
  it("the steps are in order and fit-to-width (100%) is one of them", () => {
    expect([...ZOOM_STOPS]).toEqual([...ZOOM_STOPS].sort((a, b) => a - b));
    expect(ZOOM_STOPS).toContain(1);
  });
});

describe("wheelFactor", () => {
  it("a pinch outwards (the wheel turns up with Ctrl) zooms in, inwards zooms out, and they undo each other", () => {
    expect(wheelFactor(-4)).toBeGreaterThan(1);
    expect(wheelFactor(4)).toBeLessThan(1);
    expect(wheelFactor(-7) * wheelFactor(7)).toBeCloseTo(1, 10);
  });
  it("one notch of a mouse wheel changes the zoom by about a quarter, never a leap", () => {
    expect(wheelFactor(-100)).toBeCloseTo(1.284, 2);
    expect(wheelFactor(100)).toBeCloseTo(0.779, 2);
    expect(wheelFactor(-100000)).toBeLessThan(1.3);
  });
  it("line and page modes of the wheel are turned into pixels first", () => {
    expect(wheelFactor(-1, 1)).toBeCloseTo(wheelFactor(-16, 0), 10);
    expect(wheelFactor(-1, 2)).toBe(wheelFactor(-100000));
  });
  it("no turn, or no number, changes nothing", () => {
    expect(wheelFactor(0)).toBe(1);
    expect(wheelFactor(Number.NaN)).toBe(1);
  });
});

describe("pinchFactor", () => {
  it("fingers moving apart zoom in by the ratio of the distances, together zoom out", () => {
    expect(pinchFactor(100, 150)).toBe(1.5);
    expect(pinchFactor(150, 100)).toBeCloseTo(2 / 3, 10);
  });
  it("two fingers on one spot, or a distance that is not a number, change nothing", () => {
    expect(pinchFactor(0, 100)).toBe(1);
    expect(pinchFactor(100, 0)).toBe(1);
    expect(pinchFactor(Number.NaN, 100)).toBe(1);
  });
});

describe("anchoredScroll", () => {
  it("keeps the point under the fingers where it was", () => {
    // 300 px down the page, the fingers are 200 px below the top of the view: that point is at 500 in the page. Doubled, it is at 1000, and should still be 200 from the top.
    expect(anchoredScroll(300, 200, 2)).toBe(800);
    expect(1000 - anchoredScroll(300, 200, 2)).toBe(200);
  });
  it("zooming out near the top cannot scroll above the start", () => {
    expect(anchoredScroll(10, 400, 0.5)).toBe(0);
  });
  it("a factor of one does not move anything", () => {
    expect(anchoredScroll(123, 45, 1)).toBe(123);
  });
});
