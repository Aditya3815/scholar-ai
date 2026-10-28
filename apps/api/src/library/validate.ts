import type { Paper } from "@scholar/shared";

export const MAX_LIBRARY_ITEMS = 2000;
export const MAX_IMPORT_ITEMS = 500;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max ? v : null);
const optText = (v: unknown, max: number): string | null | undefined =>
  v === null || v === undefined ? null : typeof v === "string" && v.length <= max ? v : undefined;
const optInt = (v: unknown, min: number, max: number): number | null | undefined =>
  v === null || v === undefined ? null : Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : undefined;
const strList = (v: unknown, maxItems: number, maxLen: number): string[] | null =>
  Array.isArray(v) && v.length <= maxItems && v.every((s) => typeof s === "string" && s.length <= maxLen) ? (v as string[]) : null;

/**
 * Validates and rebuilds a Paper from untrusted JSON. Unknown fields are dropped; every field is bounded; `oaUrl` must be
 * http(s) so a stored value can never become a `javascript:` link. Returns null if anything is off.
 */
export function parsePaper(x: unknown): Paper | null {
  if (!isObj(x)) return null;
  const id = text(x.id, 200);
  if (!id || !/^(doi:|pmid:|t:)/.test(id) || /[\u0000-\u001f]/.test(id)) return null;
  const title = text(x.title, 1000)?.trim();
  if (!title) return null;

  const authors = strList(x.authors, 50, 200);
  const sources = strList(x.sources, 8, 40);
  const retractionSources = strList(x.retractionSources ?? [], 5, 60);
  const year = optInt(x.year, 1000, 2100);
  const citationCount = optInt(x.citationCount, 0, 100_000_000);
  const venue = optText(x.venue, 500);
  const abstract = optText(x.abstract, 10_000);
  const doi = optText(x.doi, 200);
  const pmid = optText(x.pmid, 20);
  const oaRaw = optText(x.oaUrl, 1000);
  if (!authors || !sources || !retractionSources) return null;
  if ([year, citationCount, venue, abstract, doi, pmid, oaRaw].some((v) => v === undefined)) return null;
  if (typeof x.retracted !== "boolean") return null;
  if (pmid && !/^\d{1,20}$/.test(pmid)) return null;

  const oaUrl = oaRaw ? webUrl(oaRaw) : null;
  if (oaRaw && !oaUrl) return null;
  // the page of a record with no DOI (a thesis on Shodhganga), and what kind of work it is: kept so a saved thesis still opens and still says "Thesis"
  const urlRaw = optText(x.url, 1000);
  const url = urlRaw ? webUrl(urlRaw) : null;
  if (urlRaw === undefined || (urlRaw && !url)) return null;
  const workType = optText(x.workType, 40);
  if (workType === undefined || (workType && !/^[a-z][a-z-]*$/.test(workType))) return null;

  return {
    id,
    doi: doi ?? null,
    pmid: pmid ?? null,
    title,
    authors,
    year: year ?? null,
    venue: venue ?? null,
    abstract: abstract ?? null,
    citationCount: citationCount ?? null,
    oaUrl,
    retracted: x.retracted,
    retractionSources,
    sources,
    score: typeof x.score === "number" && Number.isFinite(x.score) ? x.score : 0,
    ...(url ? { url } : {}),
    ...(workType ? { workType } : {}),
  };
}

/** An http(s) address, normalised, or null: a stored value can never become a `javascript:` link. */
function webUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** SQLite "YYYY-MM-DD HH:MM:SS" (UTC) from an epoch-ms timestamp; falls back to now for nonsense values. */
export function sqliteTime(ms: unknown): string {
  const n = typeof ms === "number" && Number.isFinite(ms) && ms > 946684800000 && ms <= Date.now() + 86_400_000 ? ms : Date.now();
  return new Date(n).toISOString().slice(0, 19).replace("T", " ");
}

export const fromSqliteTime = (s: string): number => Date.parse(`${s.replace(" ", "T")}Z`);
