import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reloadOnce } from "./chunk-reload";
import { PDF_ERROR_WORDS, PdfError, isChunkError, pdfErrorOf } from "./pdf";

describe("a stale page after a deploy (chunk-reload)", () => {
  const reload = vi.fn();
  beforeEach(() => {
    const kv = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => kv.get(k) ?? null, setItem: (k: string, v: string) => void kv.set(k, v) });
    reload.mockReset();
    vi.stubGlobal("location", { reload });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("knows each browser's words for a script that could not be fetched", () => {
    expect(isChunkError(new TypeError("Failed to fetch dynamically imported module: https://x/assets/PdfViewer-abc.js"))).toBe(true);
    expect(isChunkError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkError(new TypeError("error loading dynamically imported module: https://x/a.js"))).toBe(true);
    expect(isChunkError(new Error("Unable to preload CSS for /assets/desk.css"))).toBe(true);
    expect(isChunkError(new Error('Setting up fake worker failed: "Failed to fetch dynamically imported module"'))).toBe(true);
    expect(isChunkError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isChunkError(null)).toBe(false);
  });

  it("reloads once, and not again within half a minute (no loop)", () => {
    expect(reloadOnce()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadOnce()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    // a while later, a new deploy may be stale again
    sessionStorage.setItem("scholar.chunkReload", String(Date.now() - 31_000));
    expect(reloadOnce()).toBe(true);
  });
});

describe("why a paper could not be opened (pdfErrorOf)", () => {
  it("never shows the raw Failed to fetch, and keeps it as the detail", () => {
    const e = pdfErrorOf(new TypeError("Failed to fetch"));
    expect(e).toBeInstanceOf(PdfError);
    expect(e.kind).toBe("network");
    expect(e.message).toBe(PDF_ERROR_WORDS.network);
    expect(e.detail).toContain("Failed to fetch");
  });
  it("sorts pdf.js's own failures", () => {
    expect(pdfErrorOf(Object.assign(new Error("Unexpected server response (503)"), { name: "ResponseException", status: 503 })).kind).toBe("network");
    expect(pdfErrorOf(Object.assign(new Error("Missing PDF"), { name: "ResponseException", status: 404 })).kind).toBe("missing");
    expect(pdfErrorOf(Object.assign(new Error("x"), { name: "PasswordException" })).kind).toBe("password");
    expect(pdfErrorOf(Object.assign(new Error("Invalid PDF structure."), { name: "InvalidPDFException" })).kind).toBe("invalid");
    expect(pdfErrorOf(new Error('Setting up fake worker failed: "Failed to fetch dynamically imported module: /assets/pdf.worker.min-abc.mjs"')).kind).toBe("chunk");
    expect(pdfErrorOf(Object.assign(new Error("NetworkError when attempting to fetch resource."), { name: "UnknownErrorException" })).kind).toBe("network");
    expect(pdfErrorOf(new Error("something else")).kind).toBe("other");
  });
});
