import { arxivIdFromDoi, cleanArxivId, cleanDoi, cleanPmcid, type OaRef, type OaReason, type OaSource } from "@scholar/shared";
import { normaliseLicense } from "./jats";
import { fetchPdf, safeFetch, type FetchOptions } from "./safe-fetch";

/**
 * Where the text of a paper can be read from, in order (spike R8, 26 Oct 2026: a server can fetch only about half of the open-access PDF links that search results carry,
 * the big publishers answer 403 even for CC BY articles, and Europe PMC's PDF link is 403 to a program while its full-text XML is not):
 *   1. Europe PMC full-text XML, when the DOI has a PubMed Central copy that is open access: structured, the licence is known, nothing to extract, never blocked;
 *   2. the arXiv PDF, by arXiv number;
 *   3. the open-access PDF that OpenAlex knows for the DOI, when it can be fetched (the address comes from OpenAlex, never from the browser: the shared index must not
 *      be fillable with a stranger's file under a real paper's name);
 *   4. nothing: the caller answers from the abstract alone and says so.
 * Every network call goes through `deps.gated`, which is where the polite limits live (one lane per service), and through `safeFetch`, which is where the safety checks live.
 */

export type Lane = "europepmc" | "arxiv" | "openalex" | "oahost";
export type SourceDeps = {
  fetchImpl?: typeof fetch;
  /** Runs one network call inside the limits of its lane. The default does not limit. */
  gated?: <T>(lane: Lane, run: () => Promise<T>) => Promise<T>;
  /** Identifies us to the services we call, with a contact address. */
  userAgent: string;
  /** Sent to OpenAlex, which asks for it and gives a better service for it. */
  mailto?: string;
  openAlexKey?: string;
};
const passThrough: NonNullable<SourceDeps["gated"]> = (_lane, run) => run();

const opts = (deps: SourceDeps, extra: Partial<FetchOptions> = {}): FetchOptions => ({ fetchImpl: deps.fetchImpl, userAgent: deps.userAgent, ...extra });

/* ---------------------------------------------------------------- Europe PMC */

export type PmcRecord = { pmcid: string | null; isOpenAccess: boolean; license: string | null; title: string | null; abstract: string | null };

const EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest";

/** Europe PMC's abstract text has a little HTML in it (<h4>Background</h4>, <i>): the words are kept. */
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();

/** What Europe PMC knows about a DOI: its PubMed Central number (null if it has none), whether it is open access, the licence. Null if it knows nothing (or could not be asked). */
export async function lookupByDoi(doi: string, deps: SourceDeps): Promise<PmcRecord | null> {
  const clean = cleanDoi(doi);
  if (!clean || /["\\]/.test(clean)) return null;
  const gated = deps.gated ?? passThrough;
  const url = `${EPMC}/search?query=${encodeURIComponent(`DOI:"${clean}"`)}&format=json&resultType=core&pageSize=1`;
  const r = await gated("europepmc", () => safeFetch(url, opts(deps, { accept: "application/json", maxBytes: 2_000_000 })));
  if (!r.ok) return null;
  try {
    const hit = (JSON.parse(new TextDecoder().decode(r.bytes)) as { resultList?: { result?: Record<string, unknown>[] } }).resultList?.result?.[0];
    if (!hit) return null;
    return {
      pmcid: cleanPmcid(hit.pmcid),
      isOpenAccess: hit.isOpenAccess === "Y",
      license: normaliseLicense(typeof hit.license === "string" ? hit.license : null),
      title: typeof hit.title === "string" ? plain(hit.title) : null,
      abstract: typeof hit.abstractText === "string" ? plain(hit.abstractText) : null,
    };
  } catch {
    return null;
  }
}

export async function fetchPmcXml(pmcid: string, deps: SourceDeps): Promise<{ ok: true; xml: string } | { ok: false; reason: OaReason }> {
  const id = cleanPmcid(pmcid);
  if (!id) return { ok: false, reason: "no_source" };
  const gated = deps.gated ?? passThrough;
  const r = await gated("europepmc", () => safeFetch(`${EPMC}/${id}/fullTextXML`, opts(deps, { accept: "application/xml", maxBytes: 12 * 1024 * 1024 })));
  if (!r.ok) return { ok: false, reason: r.reason };
  const xml = new TextDecoder().decode(r.bytes);
  // an error is sometimes sent as a small XML or HTML document with a 200
  return /<article[\s>]/i.test(xml) ? { ok: true, xml } : { ok: false, reason: "no_source" };
}

/* ---------------------------------------------------------------- arXiv */

export const arxivPdfUrl = (id: string) => `https://arxiv.org/pdf/${id}`;

/** The title and abstract of an arXiv paper, for an answer from the abstract alone. */
export async function fetchArxivMeta(id: string, deps: SourceDeps): Promise<{ title: string | null; abstract: string | null } | null> {
  const clean = cleanArxivId(id);
  if (!clean) return null;
  const gated = deps.gated ?? passThrough;
  const r = await gated("arxiv", () => safeFetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(clean)}`, opts(deps, { accept: "application/atom+xml", maxBytes: 1_000_000 })));
  if (!r.ok) return null;
  const xml = new TextDecoder().decode(r.bytes);
  const entry = /<entry>([\s\S]*?)<\/entry>/.exec(xml)?.[1];
  if (!entry) return null;
  const tag = (name: string) => {
    const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(entry);
    return m ? plain(m[1]!) : null;
  };
  return { title: tag("title"), abstract: tag("summary") };
}

/* ---------------------------------------------------------------- OpenAlex */

export type OpenAlexRecord = { title: string | null; pdfUrl: string | null; license: string | null };

/** The title, and where OpenAlex says a free PDF (or a landing page that names one) is, for a DOI. Null if it knows nothing or could not be asked. */
export async function lookupOpenAlex(doi: string, deps: SourceDeps): Promise<OpenAlexRecord | null> {
  const clean = cleanDoi(doi);
  if (!clean) return null;
  const gated = deps.gated ?? passThrough;
  const path = clean.replace(/[%?#]/g, (c) => encodeURIComponent(c));
  const q = new URLSearchParams({ select: "title,best_oa_location" });
  if (deps.mailto) q.set("mailto", deps.mailto);
  if (deps.openAlexKey) q.set("api_key", deps.openAlexKey);
  const r = await gated("openalex", () => safeFetch(`https://api.openalex.org/works/doi:${path}?${q}`, opts(deps, { accept: "application/json", maxBytes: 1_000_000 })));
  if (!r.ok) return null;
  try {
    const w = JSON.parse(new TextDecoder().decode(r.bytes)) as { title?: unknown; best_oa_location?: { pdf_url?: unknown; landing_page_url?: unknown; license?: unknown } | null };
    const loc = w.best_oa_location;
    const link = typeof loc?.pdf_url === "string" ? loc.pdf_url : typeof loc?.landing_page_url === "string" ? loc.landing_page_url : null;
    return { title: typeof w.title === "string" ? w.title : null, pdfUrl: link, license: normaliseLicense(typeof loc?.license === "string" ? loc.license : null) };
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- the ladder */

export type PaperSource =
  | { ok: true; source: Exclude<OaSource, "abstract">; format: "xml"; xml: string; title: string | null; license: string | null }
  | { ok: true; source: Exclude<OaSource, "abstract">; format: "pdf"; pdf: Uint8Array; title: string | null; license: string | null }
  | { ok: false; reason: OaReason; /** what the services said about the paper even though it could not be read */ title?: string | null };

/** The reason to report when every source failed: the most informative, not the last. */
const RANK: OaReason[] = ["blocked", "not_a_pdf", "too_large", "timeout", "fetch_failed", "no_source"];
const worst = (reasons: OaReason[]): OaReason | null => RANK.find((r) => reasons.includes(r)) ?? reasons[0] ?? null;

export async function fetchPaperSource(ref: OaRef, deps: SourceDeps): Promise<PaperSource> {
  const gated = deps.gated ?? passThrough;
  const failures: OaReason[] = [];
  const doi = cleanDoi(ref.doi);
  const arxivId = cleanArxivId(ref.arxivId) ?? (doi ? arxivIdFromDoi(doi) : null);

  // 1. Europe PMC
  let record: PmcRecord | null = null;
  if (doi) {
    record = await lookupByDoi(doi, deps).catch(() => null);
    const pmcid = record?.pmcid ?? cleanPmcid(ref.pmcid);
    if (pmcid && (record?.isOpenAccess ?? true)) {
      const x = await fetchPmcXml(pmcid, deps);
      if (x.ok) return { ok: true, source: "europepmc", format: "xml", xml: x.xml, title: record?.title ?? null, license: record?.license ?? null };
      failures.push(x.reason);
    }
  }

  // 2. arXiv
  if (arxivId) {
    const r = await gated("arxiv", () => fetchPdf(arxivPdfUrl(arxivId), opts(deps)));
    if (r.ok) return { ok: true, source: "arxiv", format: "pdf", pdf: r.bytes, title: record?.title ?? null, license: null };
    failures.push(r.reason);
  }

  // 3. the free PDF OpenAlex knows for this DOI
  let oa: OpenAlexRecord | null = null;
  if (doi) {
    oa = await lookupOpenAlex(doi, deps).catch(() => null);
    if (oa?.pdfUrl) {
      const link = oa.pdfUrl;
      const r = await gated("oahost", () => fetchPdf(link, opts(deps)));
      if (r.ok) return { ok: true, source: "pdf", format: "pdf", pdf: r.bytes, title: oa.title ?? record?.title ?? null, license: oa.license };
      failures.push(r.reason);
    }
  }
  const title = record?.title ?? oa?.title ?? null;

  // nothing could be read: say why as plainly as the facts allow
  if (failures.length === 0) return { ok: false, reason: record && !record.isOpenAccess ? "not_open_access" : "no_source", title };
  if (record && !record.isOpenAccess && failures.every((f) => f === "no_source")) return { ok: false, reason: "not_open_access", title };
  return { ok: false, reason: worst(failures) ?? "no_source", title };
}

