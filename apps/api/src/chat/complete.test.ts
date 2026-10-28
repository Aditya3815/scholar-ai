import { describe, expect, it } from "vitest";
import { searchComplete } from "./complete";

const ok = { ok: true, count: 3, ms: 5, cached: false };
const bad = { ok: false, count: 0, ms: 5, cached: false, error: "HTTP 503" };

describe("searchComplete", () => {
  it("is true when every place answered", () => expect(searchComplete({ providers: { openalex: ok, s2: ok, crossref: ok, pubmed: ok, "doaj-all": ok } })).toBe(true));
  it("is false when one of the four regular sources did not", () => {
    for (const name of ["openalex", "s2", "crossref", "pubmed"]) expect(searchComplete({ providers: { openalex: ok, s2: ok, crossref: ok, pubmed: ok, "doaj-all": ok, [name]: bad } })).toBe(false);
  });
  it("is still true when only DOAJ, the supplement, did not answer", () => expect(searchComplete({ providers: { openalex: ok, s2: ok, crossref: ok, pubmed: ok, "doaj-all": bad } })).toBe(true));
  it("is false when DOAJ and another did not", () => expect(searchComplete({ providers: { openalex: bad, s2: ok, crossref: ok, pubmed: ok, "doaj-all": bad } })).toBe(false));
  it("counts the Indian scope's own DOAJ (a source of that scope, not a supplement) as required", () => expect(searchComplete({ providers: { "openalex-india": ok, doaj: bad, shodhganga: ok } })).toBe(false));
  it("is true for no providers at all (a search that asked nothing)", () => expect(searchComplete({ providers: {} })).toBe(true));
});
