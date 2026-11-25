import type { Paper } from "@scholar/shared";

/** How a list of papers is narrowed and ordered on the page (no new search: the papers are the ones found). */
export type Refine = {
  sort: "relevance" | "cited" | "newest" | "oldest";
  from: number | null;
  to: number | null;
  author: string;
  openOnly: boolean;
};

export const NO_REFINE: Refine = { sort: "relevance", from: null, to: null, author: "", openOnly: false };

export const isRefined = (r: Refine): boolean => r.sort !== "relevance" || r.from !== null || r.to !== null || r.author.trim() !== "" || r.openOnly;

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** An author filter matches when every word typed is a word (or the start of one) in some author's name: "sharma", "a sharma", "Sharma A" all find "Anil Sharma". */
export function matchesAuthor(authors: readonly string[], typed: string): boolean {
  const want = fold(typed).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (want.length === 0) return true;
  return authors.some((a) => {
    const have = fold(a).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    return want.every((w) => have.some((h) => h.startsWith(w)));
  });
}

/** The papers that pass the filters, in the chosen order. The original position (`index`) is kept so a card keeps its number in the answer's marks. Sorting is stable: ties keep the relevance order. */
export function refine(papers: readonly Paper[], r: Refine): { paper: Paper; index: number }[] {
  const out = papers
    .map((paper, index) => ({ paper, index }))
    .filter(({ paper: p }) => (r.from === null || (p.year !== null && p.year >= r.from)) && (r.to === null || (p.year !== null && p.year <= r.to)) && (!r.openOnly || !!p.oaUrl) && matchesAuthor(p.authors, r.author));
  const by: Record<Refine["sort"], ((a: Paper, b: Paper) => number) | null> = {
    relevance: null,
    cited: (a, b) => (b.citationCount ?? -1) - (a.citationCount ?? -1),
    newest: (a, b) => (b.year ?? -1) - (a.year ?? -1),
    oldest: (a, b) => (a.year ?? 9999) - (b.year ?? 9999),
  };
  const cmp = by[r.sort];
  return cmp ? out.sort((x, y) => cmp(x.paper, y.paper) || x.index - y.index) : out;
}

/** The years the papers span, for the year fields' hints. */
export function yearSpan(papers: readonly Paper[]): { min: number; max: number } | null {
  const ys = papers.map((p) => p.year).filter((y): y is number => y !== null);
  return ys.length ? { min: Math.min(...ys), max: Math.max(...ys) } : null;
}
