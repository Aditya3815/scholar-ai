import { describe, expect, it } from "vitest";
import { foldTitle } from "@scholar/shared";
import { mergeAndRank } from "./merge";
import type { ProviderPaper } from "./types";

/*
 * The merge key of a title (untangle F3, bug B5, decision 16): every title that folds to a key today folds to the same key after the change, so no stored id `t:<key>|<year>` changes. Checked over every
 * string of every recording this repository holds: the eval's fixtures (Crossref, OpenAlex, Semantic Scholar, DOAJ, PubMed, doi.org), the prior-art fixtures (CORE and the rest), the probe strings of
 * the plain-text work, and Trending's fixtures. A test of the change, not of the product: it goes in the tests pass (docs/design/untangle.md, 4.2), with the frozen copy below.
 */

/** `normalizeTitle` of apps/api/src/search/normalize.ts as it was before F3 (main 5d2cb3c), frozen. */
const before = (title: string): string =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const nodeFs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL): Uint8Array & { toString(encoding: "utf8"): string } };
const nodeZlib = (await import(/* @vite-ignore */ "node:" + "zlib")) as { gunzipSync(data: Uint8Array): { toString(encoding: "utf8"): string } };
const readGz = (path: string): unknown => JSON.parse(nodeZlib.gunzipSync(nodeFs.readFileSync(new URL(path, import.meta.url))).toString("utf8"));

/** Every string inside a JSON value. */
function stringsOf(v: unknown, out: Set<string>): void {
  if (typeof v === "string") out.add(v);
  else if (Array.isArray(v)) for (const x of v) stringsOf(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) stringsOf(x, out);
}

/** A recorded body: JSON (every string in it), else XML or text (every run of text between two tags). */
function bodyStrings(body: string, out: Set<string>): void {
  try {
    stringsOf(JSON.parse(body), out);
  } catch {
    for (const m of body.matchAll(/>([^<]+)</g)) out.add(m[1]!);
  }
}

const corpus = (() => {
  const out = new Set<string>();
  for (const file of ["../../eval/fixtures.json.gz", "../../eval/fixtures-prior-art.json.gz"]) {
    for (const fx of Object.values(readGz(file) as Record<string, { b?: string }>)) if (typeof fx.b === "string") bodyStrings(fx.b, out);
  }
  stringsOf(readGz("../../eval/probe-strings.json.gz"), out);
  for (const name of ["arxiv-count.xml", "arxiv-error.xml", "oa-countries-class-imbalance.json", "oa-exact-count.json", "oa-journals-class-imbalance.json", "oa-keywords-1702-a.json", "oa-keywords-1702-b.json"]) {
    bodyStrings(nodeFs.readFileSync(new URL(`../trending/fixtures/${name}`, import.meta.url)).toString("utf8"), out);
  }
  return [...out];
})();

describe("foldTitle keeps every key that exists today (B5)", () => {
  it("reads the recordings (a corpus of real titles, names and abstracts)", () => {
    expect(corpus.length).toBeGreaterThan(50_000);
  });

  it("gives today's key for every string whose key today is not empty", () => {
    const differ: string[] = [];
    for (const s of corpus) {
      const key = before(s);
      if (key !== "" && foldTitle(s) !== key) differ.push(s);
    }
    expect(differ.slice(0, 5)).toEqual([]);
  });

  it("gives a title with no Latin letter or digit a key of its own script (it was \"\" for all of them)", () => {
    expect(before("भारत में जल संकट")).toBe("");
    expect(foldTitle("भारत में जल संकट")).toBe("भारत में जल संकट");
    expect(foldTitle("  भारत: में—जल (संकट)! ")).toBe("भारत में जल संकट");
    expect(foldTitle("Ελληνικά Θέματα")).toBe("ελληνικα θεματα");
    expect(foldTitle("中文标题")).toBe("中文标题");
    // the nukta letter written as one character or as two folds to one key
    expect(foldTitle("क़")).toBe(foldTitle("क़"));
    // nothing but signs is still no key
    expect(foldTitle("—!?")).toBe("");
    // a query sent to arXiv or DOAJ keeps the old fold
    expect(foldTitle("भारत में जल संकट", { latinOnly: true })).toBe("");
  });

  it("no longer merges different Indian-language papers of one year that have no DOI or PMID", () => {
    const p = (title: string): ProviderPaper => ({ doi: null, pmid: null, title, authors: [], year: 2021, venue: null, abstract: null, citationCount: null, oaUrl: null, retracted: false });
    const merged = mergeAndRank({ openalex: [p("भारत में जल संकट"), p("हिंदी साहित्य का इतिहास")], crossref: [p("भारत में जल संकट")] }, 10);
    expect(merged.map((m) => [m.id, m.sources])).toEqual([
      ["t:भारत में जल संकट|2021", ["openalex", "crossref"]],
      ["t:हिंदी साहित्य का इतिहास|2021", ["openalex"]],
    ]);
  });

  it("finds titles in the recordings that today fold to nothing, and gives each a key", () => {
    const empty = corpus.filter((s) => before(s) === "" && /\p{L}/u.test(s));
    expect(empty.length).toBeGreaterThan(0);
    expect(empty.every((s) => foldTitle(s) !== "")).toBe(true);
  });
});
