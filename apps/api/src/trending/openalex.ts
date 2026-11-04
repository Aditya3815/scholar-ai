import type { Country, KeywordRow, Venue } from "@scholar/shared/src/trending";
import { SourceError, getText, type CallBudget, type Http } from "./sources";

/**
 * The OpenAlex half of the Trending job's fetch layer (docs/design/chatview-and-trending.md, T5). Everything is a count over one filter: journal articles with abstracts and fewer than 60
 * authors, not retracted, not paratext, in one window of dates, in one subfield. The address, the polite `mailto` and the key are sent the way the search's own client sends them
 * (`api_key` and `mailto` as query parameters). The fetch, the clock and the budget are handed in, so a test runs it on recorded answers and the job on a small, fixed one.
 *
 * Measured on 3 Nov 2026: a group_by answer carries the number of papers that match the filter in `meta.count`, so a subfield's total needs no call of its own; a keyword list is cut at 200
 * groups and does not page; a call takes 1 to 4 seconds; a call costs $0.0001.
 */
const WORKS = "https://api.openalex.org/works";
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A keyword id as it goes into a filter: the tail of its address. Anything that could end the filter and start another (a comma, a colon, a pipe) is not one. */
const SLUG = /^[A-Za-z0-9._~-]{1,100}$/;

export type Window = { from: string; to: string };
export type OaScope = { subfield: number; window: Window; country?: "IN"; keywordId?: string };
export type OaDeps = { http: Http; mailto: string; apiKey?: string; budget: CallBudget };

/** The filter of one question. Throws on a subfield that is not a whole number, dates that are not dates, or a keyword id that is not a plain id, so nothing can add a filter of its own. */
export function oaFilter(s: OaScope): string {
  if (!Number.isInteger(s.subfield) || s.subfield <= 0) throw new RangeError("not a subfield");
  if (!DAY.test(s.window?.from) || !DAY.test(s.window?.to)) throw new RangeError("not a window of days");
  if (s.keywordId !== undefined && !SLUG.test(s.keywordId)) throw new RangeError("not a keyword id");
  return [
    "type:article",
    "is_retracted:false",
    "is_paratext:false",
    "primary_location.source.type:journal",
    "has_abstract:true",
    "authors_count:<60",
    `from_publication_date:${s.window.from}`,
    `to_publication_date:${s.window.to}`,
    `primary_topic.subfield.id:${s.subfield}`,
    ...(s.country ? [`authorships.institutions.country_code:${s.country}`] : []),
    ...(s.keywordId !== undefined ? [`keywords.id:${s.keywordId}`] : []),
  ].join(",");
}

async function ask(d: OaDeps, scope: OaScope, extra: Record<string, string>): Promise<unknown> {
  const params = new URLSearchParams({ filter: oaFilter(scope), ...extra, mailto: d.mailto });
  if (d.apiKey) params.set("api_key", d.apiKey);
  const text = await getText(d.http, "openalex", `${WORKS}?${params}`, {}, d.budget);
  try {
    return JSON.parse(text);
  } catch {
    throw new SourceError("openalex", "shape", undefined, "not JSON");
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

/** The papers that match the filter, and the groups of a group_by. A body that is not that is a failure, not an empty answer. */
function readGroups(body: unknown): { total: number; groups: Record<string, unknown>[] } {
  const meta = isObject(body) ? body.meta : null;
  if (!isObject(meta) || !isCount(meta.count)) throw new SourceError("openalex", "shape", undefined, "no total");
  const groups = (body as Record<string, unknown>).group_by;
  if (!Array.isArray(groups)) throw new SourceError("openalex", "shape", undefined, "no groups");
  return { total: meta.count, groups: groups.filter(isObject) };
}

/** The tail of a keyword's address ("https://openalex.org/keywords/class-imbalance" is "class-imbalance"); null when it is not a plain id. */
const keywordId = (key: unknown): string | null => {
  if (typeof key !== "string") return null;
  const slug = key.slice(key.lastIndexOf("/") + 1);
  return SLUG.test(slug) ? slug : null;
};

/**
 * The 200 keywords with most papers in a window, for one subfield (or only its papers with an author at an Indian institution), and the number of the subfield's papers in that window.
 * `name` is the keyword's display name exactly as OpenAlex wrote it: it becomes a chip. A group with no name, no plain id or no count is left out.
 */
export async function keywordCounts(d: OaDeps, scope: OaScope): Promise<{ total: number; rows: KeywordRow[] }> {
  const { total, groups } = readGroups(await ask(d, scope, { group_by: "keywords.id" }));
  const rows: KeywordRow[] = [];
  for (const g of groups) {
    const id = keywordId(g.key);
    if (id === null || typeof g.key_display_name !== "string" || g.key_display_name === "" || !isCount(g.count)) continue;
    rows.push({ id, name: g.key_display_name, count: g.count });
  }
  return { total, rows };
}

const needKeyword = (scope: OaScope): void => {
  if (scope.keywordId === undefined) throw new RangeError("a keyword is needed");
};

function idsAndCounts(groups: Record<string, unknown>[]): { id: string; count: number }[] {
  const out: { id: string; count: number }[] = [];
  for (const g of groups) if (typeof g.key === "string" && g.key !== "" && isCount(g.count)) out.push({ id: g.key, count: g.count });
  return out;
}

/** Where a keyword's papers in a window were published: the journals (at most 200), with their papers. */
export async function venuesOf(d: OaDeps, scope: OaScope): Promise<Venue[]> {
  needKeyword(scope);
  return idsAndCounts(readGroups(await ask(d, scope, { group_by: "primary_location.source.id" })).groups);
}

/** Where a keyword's authors are: the countries of their institutions, with the papers that have an author there (a paper with authors in two countries is in both). */
export async function countriesOf(d: OaDeps, scope: OaScope): Promise<Country[]> {
  needKeyword(scope);
  return idsAndCounts(readGroups(await ask(d, scope, { group_by: "authorships.institutions.country_code" })).groups);
}

/** The exact number of papers of one keyword in a window (for a keyword that was not in last year's 200). One paper per page: the answer is its `meta.count`. */
export async function exactCount(d: OaDeps, scope: OaScope): Promise<number> {
  needKeyword(scope);
  const body = await ask(d, scope, { "per-page": "1", select: "id" });
  const meta = isObject(body) ? body.meta : null;
  if (!isObject(meta) || !isCount(meta.count)) throw new SourceError("openalex", "shape", undefined, "no total");
  return meta.count;
}
