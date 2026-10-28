import { describe, expect, it } from "vitest";
import { fromSqliteTime, parsePaper, sqliteTime } from "./validate";

const base = {
  id: "doi:10.1000/xyz",
  doi: "10.1000/xyz",
  pmid: "12345",
  title: "A Paper",
  authors: ["A One", "B Two"],
  year: 2024,
  venue: "Journal",
  abstract: "Abstract.",
  citationCount: 12,
  oaUrl: "https://example.org/paper.pdf",
  retracted: false,
  retractionSources: [] as string[],
  sources: ["openalex"],
  score: 0.03,
};

describe("parsePaper (untrusted input)", () => {
  it("accepts a valid paper and drops unknown fields", () => {
    const p = parsePaper({ ...base, evil: "<script>", __proto__: { x: 1 } });
    expect(p).toEqual(expect.objectContaining({ id: base.id, title: "A Paper", citationCount: 12 }));
    expect(p).not.toHaveProperty("evil");
  });

  it("accepts nullable fields and the other id kinds", () => {
    expect(parsePaper({ ...base, id: "pmid:12345", doi: null, year: null, venue: null, abstract: null, citationCount: null, oaUrl: null })).not.toBeNull();
    expect(parsePaper({ ...base, id: "t:some title|2020" })).not.toBeNull();
  });

  it.each([
    ["javascript: link", { oaUrl: "javascript:alert(1)" }],
    ["data: link", { oaUrl: "data:text/html,<script>alert(1)</script>" }],
    ["ftp link", { oaUrl: "ftp://example.org/x" }],
    ["not a URL", { oaUrl: "not a url" }],
    ["id without a known prefix", { id: "evil:1" }],
    ["control character in id", { id: "doi:10.1/a\nb" }],
    ["empty title", { title: "   " }],
    ["oversized title", { title: "x".repeat(1001) }],
    ["too many authors", { authors: Array.from({ length: 51 }, (_, i) => `A${i}`) }],
    ["author not a string", { authors: ["ok", 5] }],
    ["retracted not boolean", { retracted: "false" }],
    ["non-numeric pmid", { pmid: "12a" }],
    ["year out of range", { year: 99999 }],
    ["negative citations", { citationCount: -1 }],
    ["oversized abstract", { abstract: "x".repeat(10_001) }],
    ["javascript: record page", { url: "javascript:alert(1)" }],
    ["record page that is not a string", { url: 5 }],
    ["work type with markup", { workType: "<b>thesis</b>" }],
  ])("rejects %s", (_name, patch) => {
    expect(parsePaper({ ...base, ...patch })).toBeNull();
  });

  it("keeps a thesis's own page and its kind, so a saved thesis still opens and still says it is a thesis", () => {
    const p = parsePaper({ ...base, id: "t:a thesis|2016", doi: null, pmid: null, url: "https://shodhganga.inflibnet.ac.in/handle/10603/1", workType: "dissertation" });
    expect(p).toMatchObject({ url: "https://shodhganga.inflibnet.ac.in/handle/10603/1", workType: "dissertation" });
    const plain = parsePaper(base);
    expect(plain).not.toHaveProperty("url");
    expect(plain).not.toHaveProperty("workType");
  });

  it("rejects non-objects", () => {
    for (const v of [null, undefined, "str", 5, [], [base]]) expect(parsePaper(v)).toBeNull();
  });
});

describe("time helpers", () => {
  it("round-trips a timestamp through SQLite format", () => {
    const ms = Date.UTC(2026, 9, 17, 12, 30, 45);
    expect(sqliteTime(ms)).toBe("2026-10-17 12:30:45");
    expect(fromSqliteTime("2026-10-17 12:30:45")).toBe(ms);
  });
  it("falls back to now for nonsense", () => {
    for (const v of ["x", -5, 0, Number.NaN, Date.now() + 10 * 86_400_000, undefined]) {
      expect(sqliteTime(v)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    }
  });
});
