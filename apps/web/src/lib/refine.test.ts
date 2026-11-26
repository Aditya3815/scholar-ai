import { describe, expect, it } from "vitest";
import type { Paper } from "@scholar/shared";
import { NO_REFINE, isRefined, journalFacets, matchesAuthor, refine, yearSpan } from "./refine";
const p = (id: string, year: number | null, o: Partial<Paper> = {}): Paper => ({ id, doi: null, pmid: null, title: id, authors: [], year, venue: null, abstract: null, citationCount: 0, oaUrl: null, retracted: false, retractionSources: [], sources: [], score: 0, workType: null, ...o });

const list = [p("a", 2015, { authors: ["Anil Sharma"], citationCount: 50 }), p("b", 2022, { authors: ["José Álvarez", "Li Wei"], citationCount: 5, oaUrl: "x" }), p("c", null, { citationCount: 500 }), p("d", 2022, { citationCount: 5 })];

describe("refine", () => {
  it("keeps the order and positions when nothing is chosen", () => {
    expect(refine(list, NO_REFINE).map((x) => x.paper.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("cuts by year range and drops papers with no year", () => {
    expect(refine(list, { ...NO_REFINE, from: 2020 }).map((x) => x.paper.id)).toEqual(["b", "d"]);
    expect(refine(list, { ...NO_REFINE, to: 2016 }).map((x) => x.paper.id)).toEqual(["a"]);
  });
  it("sorts stably and keeps each paper's original index", () => {
    const out = refine(list, { ...NO_REFINE, sort: "newest" });
    expect(out.map((x) => x.paper.id)).toEqual(["b", "d", "a", "c"]);
    expect(out[0]!.index).toBe(1);
    expect(refine(list, { ...NO_REFINE, sort: "cited" })[0]!.paper.id).toBe("c");
    expect(refine(list, { ...NO_REFINE, sort: "oldest" })[0]!.paper.id).toBe("a");
  });
  it("open access only", () => {
    expect(refine(list, { ...NO_REFINE, openOnly: true }).map((x) => x.paper.id)).toEqual(["b"]);
  });
  it("author: any order, initials, accents, name starts", () => {
    expect(matchesAuthor(["Anil Sharma"], "sharma")).toBe(true);
    expect(matchesAuthor(["Anil Sharma"], "Sharma A")).toBe(true);
    expect(matchesAuthor(["José Álvarez"], "jose alvarez")).toBe(true);
    expect(matchesAuthor(["Anil Sharma"], "verma")).toBe(false);
    expect(refine(list, { ...NO_REFINE, author: "wei" }).map((x) => x.paper.id)).toEqual(["b"]);
  });
  it("year span", () => {
    expect(yearSpan(list)).toEqual({ min: 2015, max: 2022 });
    expect(yearSpan([p("z", null)])).toBeNull();
  });
});

describe("journals", () => {
  const ps = [p("1", 2020, { venue: "Nature" }), p("2", 2020, { venue: "Nature " }), p("3", 2020, { venue: "Lancet" }), p("4", 2020), p("5", 2020, { venue: "Science" })];
  it("counts journals, most first, and ignores a paper with no venue", () => {
    expect(journalFacets(ps)).toEqual([{ name: "Nature", count: 2 }, { name: "Lancet", count: 1 }, { name: "Science", count: 1 }]);
  });
  it("keeps only the chosen journals, and none chosen keeps all", () => {
    expect(refine(ps, { ...NO_REFINE, journals: ["Nature", "Lancet"] }).map((x) => x.index)).toEqual([0, 1, 2]);
    expect(refine(ps, NO_REFINE)).toHaveLength(5);
    expect(isRefined({ ...NO_REFINE, journals: ["Nature"] })).toBe(true);
  });
});
