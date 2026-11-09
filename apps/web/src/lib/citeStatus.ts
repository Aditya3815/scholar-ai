import type { Paper, RefRecord, RefVerdict } from "@scholar/shared";

/**
 * What a citation card says about its entry's check (docs/design/reader-citations.md, 3). Pure, so the tests can hold the one rule that matters:
 * "verified" only when the Reference Verifier said verified. Every other state has its own words.
 */
export type CiteStatus = "verified" | "mismatch" | "not_found" | "unverifiable" | "unparsed" | "error" | "checking" | "offline";

/**
 * The card's words for each state: the Reference Verifier's own words (lib/refStatus.ts STATUS; a test holds them equal). Kept here as plain words so that the reader's chunk
 * does not import refStatus and its icons from the first load (that split them into chunks of their own and made the first load bigger).
 */
export const CITE_LABEL: Record<Exclude<CiteStatus, "verified" | "checking" | "offline">, string> = {
  mismatch: "Details don’t match",
  not_found: "Not found",
  unverifiable: "Could not verify",
  unparsed: "Not a full reference",
  error: "Check failed",
};
export const NOT_FOUND_HELP =
  "This can mean the reference is wrong or made up. It can also mean the source is not in Crossref: books, theses, reports and many regional journals are not. Check it at the source before deciding.";

export function citeStatus(item: { state: "queued" | "checking" | "done" | "error"; verdict?: RefVerdict } | undefined, online: boolean): CiteStatus {
  if (item?.state === "done" && item.verdict) return item.verdict.status;
  if (item?.state === "error") return online ? "error" : "offline";
  if (!online) return "offline";
  return "checking";
}

/** Ask, Save and Open act on a known paper: only a verified entry with a matched record that has a DOI. */
export function cardRecord(item: { state: string; verdict?: RefVerdict } | undefined): { record: RefRecord; paper: Paper } | null {
  const v = item?.state === "done" ? item.verdict : undefined;
  if (!v || v.status !== "verified" || !v.match?.doi) return null;
  return { record: v.match, paper: recordPaper(v.match, !!v.retracted) };
}

/** The matched record as a Paper (for Ask, Save and the library's "Saved"), as the Reference Verifier's card makes it. */
export const recordPaper = (r: RefRecord, retracted: boolean): Paper => ({
  id: r.doi ? `doi:${r.doi}` : `t:${r.title}`,
  doi: r.doi,
  pmid: null,
  title: r.title,
  authors: r.authors,
  year: r.year,
  venue: r.venue,
  abstract: null,
  citationCount: null,
  oaUrl: null,
  retracted,
  retractionSources: retracted ? ["crossref"] : [],
  sources: ["crossref"],
  score: 0,
});

/** "Vaswani et al., NeurIPS 2017": the line under the title. */
export function metaLine(r: Pick<RefRecord, "authors" | "venue" | "year">): string {
  const a = r.authors;
  const who = a.length === 0 ? "" : a.length === 1 ? surnameOf(a[0]!) : a.length === 2 ? `${surnameOf(a[0]!)} and ${surnameOf(a[1]!)}` : `${surnameOf(a[0]!)} et al.`;
  const where = [r.venue, r.year].filter(Boolean).join(" ");
  return [who, where].filter(Boolean).join(", ");
}
/** "Ashish Vaswani" -> "Vaswani"; "Vaswani, A." -> "Vaswani". */
const surnameOf = (name: string) => (name.includes(",") ? name.split(",")[0]!.trim() : name.trim().split(/\s+/).pop() ?? name);
