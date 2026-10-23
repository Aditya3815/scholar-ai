import {
  FACET_KEYS,
  FACET_LABELS,
  type FacetKey,
  type IdeaComparison,
  type IdeaFacets,
  type IdeaInsights,
  type IdeaPaper,
  type IdeaSearched,
  type OutcomeKind,
} from "./idea";

/* ---------------------------------------------------------------- gaps that need no model */

/** Two parts of the idea that each have close prior work among the compared papers, but never in the same paper. */
export type CombinationGap = { a: FacetKey; b: FacetKey; aPapers: string[]; bPapers: string[] };

/** Most useful pairs first: the method in the researcher's field is what an idea most often rests on. */
const PAIRS: [FacetKey, FacetKey][] = [
  ["mechanism", "domain"],
  ["purpose", "domain"],
  ["purpose", "mechanism"],
  ["mechanism", "evaluation"],
  ["domain", "evaluation"],
  ["purpose", "evaluation"],
];

/**
 * Worked out from the VERIFIED matches of a comparison only (so it needs no model and no quota): for every pair of parts, if some compared paper covers
 * the first and some other paper covers the second but no paper covers both, that combination was not found among the compared papers.
 * It says nothing about papers that were not compared, and the page and report say so.
 */
export function combinationGaps(c: IdeaComparison): CombinationGap[] {
  const covering = (k: FacetKey) => new Set(c.coverage.find((r) => r.facet === k)?.papers.map((p) => p.id) ?? []);
  const out: CombinationGap[] = [];
  for (const [a, b] of PAIRS) {
    const A = covering(a);
    const B = covering(b);
    if (A.size === 0 || B.size === 0) continue;
    if ([...A].some((id) => B.has(id))) continue;
    out.push({ a, b, aPapers: [...A], bPapers: [...B] });
  }
  return out;
}

/** Ids of the compared papers that match at least one part of the idea (with a checked quote): the ones worth reading further. */
export function relatedIds(c: IdeaComparison): Set<string> {
  return new Set(c.comparisons.filter((p) => p.level === "close" || p.level === "partial" || p.level === "related").map((p) => p.id));
}

/** Parts of the idea that the researcher stated and that no compared paper covers (not even closely). */
export function uncoveredParts(c: IdeaComparison): FacetKey[] {
  return c.coverage.filter((r) => r.status === "none").map((r) => r.facet);
}

/* ---------------------------------------------------------------- the report */

/**
 * The text of an Idea Check as a Markdown file the researcher keeps. Pure: the same input gives the same text, so it can be tested.
 * Rules it keeps: text that came from a database or a model is escaped (it cannot add links, headings or HTML of its own); every claim
 * made from a paper is next to its quote; model opinion is labelled as opinion; and it never says an idea is new or not new.
 */
export type ReportInput = {
  appName: string;
  /** ISO time the report was made; the only clock in it. */
  generatedAt: string;
  title: string;
  summary: string;
  facets: IdeaFacets;
  question?: string;
  searched: IdeaSearched[];
  considered: number;
  papers: IdeaPaper[];
  comparison?: IdeaComparison | null;
  insights?: IdeaInsights | null;
};

const SOURCE_NAME: Record<IdeaSearched["source"], string> = { openalex: "OpenAlex", s2: "Semantic Scholar", pubmed: "PubMed", arxiv: "arXiv", core: "CORE" };
const KIND_NAME: Record<IdeaPaper["kind"], string> = { paper: "", preprint: "preprint", book: "book", thesis: "thesis", report: "report", data: "dataset or software" };
const OUTCOME_TEXT: Record<OutcomeKind, string> = { positive: "reports that it worked", mixed: "reports mixed results", negative: "reports that it did not work", not_stated: "no result stated in the abstract" };
const COVERAGE_TEXT = { covered: "covered", similar: "something similar", none: "no compared paper covers it", not_stated: "not stated in your idea" } as const;

/** One line of plain text that cannot change the Markdown around it. */
export function md(s: unknown, max = 400): string {
  const t = String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return t.replace(/([\\`*_{}[\]<>#|~])/g, "\\$1").replace(/^([-+]|\d+[.)])(?=\s|$)/, "\\$1");
}

const quote = (q: string) => `> “${md(q, 320)}”`;
const doiLink = (doi: string | null) => (doi && /^10\.\d{4,9}\/[^\s<>]+$/.test(doi) ? `https://doi.org/${encodeURI(doi)}` : null);
const dayOf = (iso: string) => (Number.isFinite(Date.parse(iso)) ? new Date(iso).toISOString().slice(0, 10) : "");

/** The services that were really asked, in the order of the list above, as a sentence part: "OpenAlex, PubMed and arXiv". */
function searchedNames(searched: IdeaSearched[]): { text: string; many: boolean } {
  const names = [...new Set(searched.map((s) => SOURCE_NAME[s.source]))];
  if (names.length === 0) return { text: "no service", many: false };
  return { text: names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`, many: names.length > 1 };
}

export function buildIdeaReport(r: ReportInput): string {
  const out: string[] = [];
  const number = new Map(r.papers.map((p, i) => [p.id, i + 1]));
  const ref = (id: string) => (number.has(id) ? `[${number.get(id)}]` : "[?]");
  const refs = (ids: string[]) => ids.map(ref).join(" ");
  // a heading is always followed by a blank line, and every block ends with one
  const push = (...lines: string[]) => out.push(...lines.flatMap((l) => (l.startsWith("#") ? [l, ""] : [l])), "");

  push(`# Idea Check${r.title ? `: ${md(r.title, 200)}` : ""}`);
  push(`*Made with ${md(r.appName, 60)} on ${dayOf(r.generatedAt)} (UTC). This report shows what the closest published papers say about the idea, with their own words as evidence. It does not say whether the idea is new, and it is not a verdict.*`);

  push("## Your idea", md(r.summary, 1500) || "(no summary)");
  push(
    "| Part | In your words |",
    "| --- | --- |",
    ...FACET_KEYS.map((k) => `| ${FACET_LABELS[k]} | ${md(r.facets[k], 220) || "not stated"} |`),
  );
  if (r.question) push(`**Your question:** ${md(r.question, 600)}`);

  const failed = r.searched.filter((s) => !s.ok);
  push(
    "## What was searched",
    ...r.searched.map((s) => `- ${SOURCE_NAME[s.source]}, ${s.kind === "semantic" ? "by meaning" : "by keywords"}: “${md(s.query, 200)}”, ${s.ok ? `${s.count} papers` : "did not answer"}`),
  );
  push(`${r.considered} different papers came back; the ${r.papers.length} closest are listed below.${failed.length ? ` **${failed.length} of ${r.searched.length} searches did not answer, so some papers may be missing.**` : ""}`);

  push(
    "## The closest papers",
    ...r.papers.map((p, i) => {
      const bits = [
        `**${md(p.title, 300)}**`,
        p.year ? `(${p.year})` : "",
        p.authors.length ? `${md(p.authors.slice(0, 3).join(", "), 120)}${p.authors.length > 3 ? " et al." : ""}` : "",
        p.venue ? `*${md(p.venue, 120)}*` : "",
        KIND_NAME[p.kind] ? `[${KIND_NAME[p.kind]}]` : "",
        p.retracted ? "**RETRACTED**" : "",
        doiLink(p.doi) ? `<${doiLink(p.doi)}>` : "",
      ].filter(Boolean);
      return `${i + 1}. ${bits.join(" ")}`;
    }),
  );

  const c = r.comparison;
  if (c) {
    push(
      "## How the compared papers relate to your idea",
      `Only the abstracts of ${c.compared} papers were compared. A match is shown only with the sentence it rests on, checked to be in that abstract${c.droppedClaims ? `; ${c.droppedClaims} claim(s) whose sentence was not there were left out` : ""}.`,
    );
    for (const row of c.coverage) {
      push(`**${FACET_LABELS[row.facet]}: ${COVERAGE_TEXT[row.status]}**`);
      for (const p of row.papers.slice(0, 4)) push(`- ${ref(p.id)} (${p.match === "same" ? "does this" : "something similar"})`, quote(p.quote));
    }
    const gaps = combinationGaps(c);
    const none = uncoveredParts(c);
    push("## Gaps among the compared papers", "These are things not found among the compared abstracts. They are not proof that nothing exists: see the limits at the end.");
    if (none.length === 0 && gaps.length === 0 && !(r.insights?.openProblems.length ?? 0)) push("No gap was found: every stated part has a close paper, and no combination of parts is missing.");
    if (none.length) push("**Parts of your idea that no compared paper covers**", ...none.map((k) => `- ${FACET_LABELS[k]}: ${md(r.facets[k], 220)}`));
    if (gaps.length) {
      push(
        "**Combinations that no single compared paper covers**",
        ...gaps.map((g) => `- ${FACET_LABELS[g.a]} (${refs(g.aPapers)}) together with ${FACET_LABELS[g.b]} (${refs(g.bPapers)}): each is covered, but not both in one paper.`),
      );
    }
  }

  const ins = r.insights;
  if (ins) {
    if (ins.openProblems.length) {
      push("**What the papers themselves say is still open**", ...ins.openProblems.flatMap((o) => [`- ${ref(o.id)}`, quote(o.quote)]));
    }
    push("## Feasibility: what the papers report", `Read from ${ins.papersRead} abstracts. A result is stated only with its sentence.`);
    // a paper that matches no part of the idea says nothing about whether the idea works, so what it reports is left out
    const related = c ? relatedIds(c) : null;
    const rows = ins.readings.filter((x) => (!related || related.has(x.id)) && (x.outcome.kind !== "not_stated" || x.data || x.method));
    if (rows.length === 0) push("The abstracts say nothing about results, data or methods that could be quoted.");
    for (const x of rows) {
      push(
        `- **${ref(x.id)} ${OUTCOME_TEXT[x.outcome.kind]}**`,
        ...(x.outcome.quote ? [`  ${quote(x.outcome.quote)}`] : []),
        ...(x.method ? [`  - Method: “${md(x.method, 320)}”`] : []),
        ...(x.data ? [`  - Data: “${md(x.data, 320)}”`] : []),
      );
    }
    if (ins.opinion.length) {
      push("## Practical feasibility: opinion", "*Written by the AI model from your idea alone. It is opinion, not checked against any paper.*", ...ins.opinion.map((o) => `- ${md(o, 240)}`));
    }
    if (ins.answer) {
      push("## Answer to your question", `*From the abstracts of the closest papers only. The sentence of the abstract is the evidence; a line of the AI's own words appears above it only where the sentence supports it.*`);
      if (ins.answer.statements.length === 0) push("The abstracts of these papers do not answer it.");
      for (const s of ins.answer.statements) push(`- ${s.text ? md(s.text, 400) : "A sentence the AI picked for your question:"} ${refs(s.cites.map((x) => x.id))}`, ...s.cites.map((x) => `  ${quote(x.quote)}`));
    }
  }

  push(
    "## What this report cannot tell you",
    "- It does not say whether your idea is new. Not finding a paper here does not mean it does not exist.",
    `- Only ${searchedNames(r.searched).text} ${searchedNames(r.searched).many ? "were" : "was"} searched (as listed above). Theses, books, many regional-language and non-indexed journals, unpublished work and paywalled full texts are covered only as far as those services list them.`,
    "- Papers were compared by their abstracts, not their full text. A paper can do more (or less) than its abstract says.",
    "- An AI model read the abstracts. Every statement from a paper is shown with its sentence, checked to be in the abstract, so you can judge it; the model can still read a sentence wrongly.",
    "- Please read the papers before relying on any of this.",
  );
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
