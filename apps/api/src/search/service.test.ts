import { describe, expect, it } from "vitest";
import { readSearch } from "./service";

/** The service layer (docs/design: "service layer"): what the web routes and the MCP tools both call. Behaviour of the routes themselves is held by their own tests and the goldens. */

const q = (o: Record<string, string>) => (k: string) => o[k];

describe("searchService.read", () => {
  it("reads a search as the route always did: trimmed, limit 1 to 40 (20 by default), scope all or india", () => {
    expect(readSearch(q({ q: "  crispr  " }))).toEqual({ ok: true, input: { q: "crispr", limit: 20, scope: "all" } });
    expect(readSearch(q({ q: "crispr", limit: "500" }))).toEqual({ ok: true, input: { q: "crispr", limit: 40, scope: "all" } });
    expect(readSearch(q({ q: "crispr", limit: "abc" }))).toEqual({ ok: true, input: { q: "crispr", limit: 20, scope: "all" } });
    expect(readSearch(q({ q: "crispr", limit: "-3", scope: "india" }))).toEqual({ ok: true, input: { q: "crispr", limit: 1, scope: "india" } });
  });
  it("refuses one letter, more than 300 characters, and an unknown scope", () => {
    expect(readSearch(q({ q: "a" })).ok).toBe(false);
    expect(readSearch(q({ q: "x".repeat(301) })).ok).toBe(false);
    expect(readSearch(q({ q: "crispr", scope: "mars" })).ok).toBe(false);
  });
});
