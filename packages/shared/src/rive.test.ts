import { describe, expect, it } from "vitest";
import { LITSCAN_MAX_ITEMS, LITSCAN_MIN_ITEMS, cssColorToArgb, readingPose, riveBlockedBy, setuPose, type LitscanPart, type LitscanView } from "@scholar/shared";

/** The decisions behind the Rive pieces (docs/design/setu-rive.md, rive-ideas.md): whether to show one at all, the page's colours as the file wants them, and what the bridge is told. */

const calm = { reducedMotion: false, saveData: false, wasm: true };

describe("riveBlockedBy: when the page does not show a Rive piece", () => {
  it("shows it on an ordinary device", () => {
    expect(riveBlockedBy(calm)).toBeNull();
    expect(riveBlockedBy({ ...calm, effectiveType: "4g" })).toBeNull();
    expect(riveBlockedBy({ ...calm, effectiveType: "3g" })).toBeNull();
    expect(riveBlockedBy({ ...calm, effectiveType: undefined })).toBeNull();
  });
  it("does not show it to someone who asked for less motion", () => {
    expect(riveBlockedBy({ ...calm, reducedMotion: true })).toBe("reduced-motion");
  });
  it("does not spend a person's data when they asked to save it, or on a very slow connection", () => {
    expect(riveBlockedBy({ ...calm, saveData: true })).toBe("save-data");
    expect(riveBlockedBy({ ...calm, effectiveType: "2g" })).toBe("slow-network");
    expect(riveBlockedBy({ ...calm, effectiveType: "slow-2g" })).toBe("slow-network");
  });
  it("cannot show it where WebAssembly is missing", () => {
    expect(riveBlockedBy({ ...calm, wasm: false })).toBe("no-wasm");
  });
  it("names the first reason when there are several (reduced motion, then data, then network, then wasm)", () => {
    expect(riveBlockedBy({ reducedMotion: true, saveData: true, effectiveType: "2g", wasm: false })).toBe("reduced-motion");
    expect(riveBlockedBy({ reducedMotion: false, saveData: true, effectiveType: "2g", wasm: false })).toBe("save-data");
    expect(riveBlockedBy({ reducedMotion: false, saveData: false, effectiveType: "2g", wasm: false })).toBe("slow-network");
  });
});

describe("cssColorToArgb: the page's colours, as the Rive file takes them (0xAARRGGBB)", () => {
  it("reads hex colours: the tokens of the app are written that way", () => {
    expect(cssColorToArgb("#3548c8")).toBe(0xff3548c8);
    expect(cssColorToArgb("#93A6FF")).toBe(0xff93a6ff);
    expect(cssColorToArgb("#fff")).toBe(0xffffffff);
    expect(cssColorToArgb("#0f1115")).toBe(0xff0f1115);
    expect(cssColorToArgb("#3548c8cc")).toBe(0xcc3548c8);
    expect(cssColorToArgb("#abcd")).toBe(0xddaabbcc);
  });
  it("reads what a browser gives back for a computed colour: rgb() and rgba(), with commas or spaces", () => {
    expect(cssColorToArgb("rgb(53, 72, 200)")).toBe(0xff3548c8);
    expect(cssColorToArgb("rgb(53 72 200)")).toBe(0xff3548c8);
    expect(cssColorToArgb("rgba(53, 72, 200, 0.5)")).toBe(0x803548c8);
    expect(cssColorToArgb("rgb(53 72 200 / 50%)")).toBe(0x803548c8);
    expect(cssColorToArgb("rgba(53,72,200,1)")).toBe(0xff3548c8);
    expect(cssColorToArgb("rgba(0, 0, 0, 0)")).toBe(0x00000000);
  });
  it("ignores case and spaces round it", () => {
    expect(cssColorToArgb("  #ABC ")).toBe(0xffaabbcc);
    expect(cssColorToArgb(" RGB(1, 2, 3) ")).toBe(0xff010203);
  });
  it("keeps a channel in range", () => {
    expect(cssColorToArgb("rgb(300, -5, 20)")).toBe(0xffff0014);
    expect(cssColorToArgb("rgba(1, 2, 3, 7)")).toBe(0xff010203);
  });
  it("gives an unsigned number (a Rive colour is not negative)", () => {
    expect(cssColorToArgb("#ffffff")! > 0).toBe(true);
    expect(Number.isInteger(cssColorToArgb("#123456"))).toBe(true);
  });
  it("says null for what it cannot read, and never throws", () => {
    for (const bad of ["", "   ", "red", "#12", "#12345", "#ggg", "rgb()", "rgb(1,2)", "rgb(a,b,c)", "hsl(10,10%,10%)", "var(--accent)", "transparent", "#1234567"]) {
      expect(cssColorToArgb(bad), bad).toBeNull();
    }
    expect(cssColorToArgb(undefined as never)).toBeNull();
    expect(cssColorToArgb(null as never)).toBeNull();
  });
});

const view = (over: Partial<LitscanView> = {}): Pick<LitscanView, "state" | "total" | "stages" | "parts"> => ({ state: "running", total: 5, stages: {}, parts: {}, ...over });
const answered = (idx: number): LitscanPart => ({ idx, status: "answered", found: 5, text: "T [1].", citations: [], sources: [] });
const gap = (idx: number): LitscanPart => ({ idx, status: "gap", found: 0, reason: "nothing_found" });

describe("setuPose: what the bridge is told about a scan", () => {
  it("picks the artboard by the number of themes, and tells six numbers (the unused ones are 0)", () => {
    expect(setuPose(view({ total: 5 }))).toEqual({ artboard: "Setu5", p: [0, 0, 0, 0, 0, 0], cross: false });
    expect(setuPose(view({ total: 2 }))!.artboard).toBe("Setu2");
    expect(setuPose(view({ total: 6 }))!.artboard).toBe("Setu6");
    for (let n = LITSCAN_MIN_ITEMS; n <= LITSCAN_MAX_ITEMS; n++) expect(setuPose(view({ total: n }))!.p).toHaveLength(6);
  });
  it("has no bridge for a number of themes the plan cannot have", () => {
    for (const n of [0, 1, 7, 100, -1, 2.5, Number.NaN]) expect(setuPose(view({ total: n })), String(n)).toBeNull();
  });
  it("tells searching 1, reading 2, answered 3 and a gap 4, theme by theme", () => {
    const pose = setuPose(view({ parts: { 0: answered(0), 2: gap(2) }, stages: { 1: "reading", 3: "searching" } }))!;
    expect(pose.p).toEqual([3, 2, 4, 1, 0, 0]);
    expect(pose.cross).toBe(false);
  });
  it("a finished theme is answered or a gap whatever stage was last heard of it", () => {
    expect(setuPose(view({ parts: { 0: answered(0), 1: gap(1) }, stages: { 0: "reading", 1: "searching" } }))!.p.slice(0, 2)).toEqual([3, 4]);
  });
  it("sets the question across only when the scan is completed and every theme is answered", () => {
    const all = { 0: answered(0), 1: answered(1), 2: answered(2), 3: answered(3), 4: answered(4) };
    expect(setuPose(view({ state: "completed", parts: all }))!.cross).toBe(true);
    expect(setuPose(view({ state: "running", parts: all }))!.cross).toBe(false); // the last event not yet in
    expect(setuPose(view({ state: "completed", parts: { ...all, 2: gap(2) } }))!.cross).toBe(false); // finished with a gap: the question stays on its bank
    const { 4: _gone, ...four } = all;
    expect(setuPose(view({ state: "completed", parts: four }))!.cross).toBe(false); // a theme that was never answered
  });
  it("a scan that was cancelled or failed has no theme in progress, and no crossing", () => {
    for (const state of ["canceled", "failed"] as const) {
      const pose = setuPose(view({ state, parts: { 0: answered(0), 1: gap(1) }, stages: { 2: "reading", 3: "searching" } }))!;
      expect(pose.p, state).toEqual([3, 4, 0, 0, 0, 0]);
      expect(pose.cross, state).toBe(false);
    }
  });
  it("ignores a theme or a stage that is not in the plan, and a stage it does not know", () => {
    const pose = setuPose(view({ total: 3, parts: { 7: answered(7) }, stages: { 5: "reading", 1: "typing" as never } }))!;
    expect(pose.p).toEqual([0, 0, 0, 0, 0, 0]);
  });
  it("is the same for the same scan, and does not change what it was given", () => {
    const v = view({ parts: { 0: answered(0) }, stages: { 1: "reading" } });
    const copy = JSON.stringify(v);
    expect(setuPose(v)).toEqual(setuPose(v));
    expect(JSON.stringify(v)).toBe(copy);
  });
});

describe("readingPose: what the reading scene is told about an upload", () => {
  it("tells the step as a mode, and how far along the whole job is (a third for each of its three steps, as the bar under it counts)", () => {
    expect(readingPose({ step: "reading", progress: 0 })).toEqual({ mode: 0, progress: 0 });
    expect(readingPose({ step: "reading", progress: 0.6 })!.mode).toBe(0);
    expect(readingPose({ step: "reading", progress: 0.6 })!.progress).toBeCloseTo(0.2, 10);
    expect(readingPose({ step: "uploading", progress: 0.5 })!.mode).toBe(1);
    expect(readingPose({ step: "uploading", progress: 0.5 })!.progress).toBeCloseTo(0.5, 10);
    expect(readingPose({ step: "indexing", progress: 0.3 })!.mode).toBe(2);
    expect(readingPose({ step: "indexing", progress: 0.3 })!.progress).toBeCloseTo((2 + 0.3) / 3, 10);
  });
  it("a paper of page pictures: the pages being read are the third step", () => {
    const p = readingPose({ step: "scanning", progress: 0.45 })!;
    expect(p.mode).toBe(2);
    expect(p.progress).toBeCloseTo((2 + 0.45) / 3, 10);
  });
  it("paused keeps how far it got and says paused", () => {
    const p = readingPose({ step: "paused", progress: 0.5 })!;
    expect(p.mode).toBe(4);
    expect(p.progress).toBeCloseTo((2 + 0.5) / 3, 10);
  });
  it("done is the whole ring, whatever the last progress was", () => {
    expect(readingPose({ step: "done", progress: 0 })).toEqual({ mode: 3, progress: 1 });
    expect(readingPose({ step: "done", progress: 1 })).toEqual({ mode: 3, progress: 1 });
  });
  it("an error has no scene (the page shows its own sign for it), and neither does a step it does not know", () => {
    expect(readingPose({ step: "error", progress: 0.5 })).toBeNull();
    expect(readingPose({ step: "teleporting", progress: 0.5 })).toBeNull();
    expect(readingPose({ step: "", progress: 0.5 })).toBeNull();
  });
  it("keeps progress between 0 and 1, and treats a number that is not one as 0", () => {
    expect(readingPose({ step: "reading", progress: -3 })!.progress).toBe(0);
    expect(readingPose({ step: "reading", progress: 9 })!.progress).toBeCloseTo(1 / 3, 10);
    expect(readingPose({ step: "reading", progress: Number.NaN })!.progress).toBe(0);
    expect(readingPose({ step: "reading", progress: Number.POSITIVE_INFINITY })!.progress).toBeCloseTo(1 / 3, 10);
    expect(readingPose({ step: "indexing", progress: 1 })!.progress).toBe(1);
  });
  it("never goes backwards within a job: each step starts where the one before ended", () => {
    const at = (step: string, progress: number) => readingPose({ step, progress })!.progress;
    expect(at("reading", 1)).toBeLessThanOrEqual(at("uploading", 0) + 1e-12);
    expect(at("uploading", 1)).toBeLessThanOrEqual(at("indexing", 0) + 1e-12);
    expect(at("indexing", 1)).toBeLessThanOrEqual(at("done", 0) + 1e-12);
  });
});
