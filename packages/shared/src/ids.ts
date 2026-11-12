/**
 * The identifiers both apps read (docs/design/untangle.md, 1.2 and F3): DOIs, arXiv numbers, the citation marks [n] of an answer, ORCID iDs and e-mail addresses. Each pattern is written once,
 * here; a place that needs a DOI inside a longer pattern builds it from `DOI_START` (a regular expression's source). Imports nothing.
 */

/* ---------------------------------------------------------------- DOIs */

/** "10.", a registrant of 4 to 9 digits and "/": how every DOI starts. The source of a regular expression, to build a pattern from. */
export const DOI_START = String.raw`10\.\d{4,9}\/`;

/** A whole DOI: its start and anything but white space ("10.1000/abc"). */
export const DOI_WHOLE = new RegExp(String.raw`^${DOI_START}\S+$`);
/** A whole DOI that is safe to keep: at most 200 characters after the slash, no quote or angle bracket (a paper's record, a ledger's paper). */
export const DOI_KEPT = new RegExp(String.raw`^${DOI_START}[^\s"<>]{1,200}$`);
/** A whole DOI that can be put in a link: no white space and no angle bracket. */
export const DOI_LINKABLE = new RegExp(String.raw`^${DOI_START}[^\s<>]+$`);
/** A message that is only a DOI: bare, after "doi:", or as a doi.org address (the rules and the Understand step's guards search it as written). */
export const DOI_INPUT = new RegExp(String.raw`^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?${DOI_START}\S+$`, "i");

/** A DOI anywhere in a text, to the next white space. */
const DOI_ANYWHERE = new RegExp(String.raw`${DOI_START}\S+`, "i");
/**
 * "https://doi.org/10.1000/ABC" -> "10.1000/abc" (DOIs are case-insensitive), as a search source's record gives it. Also strips link artefacts some indexes leave on the DOI
 * ("10.1051/bioconf/202621302009/pdf"), which would otherwise be a DOI that does not exist.
 */
export function normalizeDoi(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(DOI_ANYWHERE);
  if (!m) return null;
  return m[0]
    .toLowerCase()
    .replace(/[.,;)\]]+$/, "")
    .replace(/\/(pdf|epdf|pdfdirect|full|fulltext|full-text|abstract|summary|html|xml|meta)$/, "");
}

/** A DOI as a lower-case bare identifier (a URL, "doi:" and surrounding junk removed), or null: what a person or a tool hands in. */
export function cleanDoi(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "").replace(/[\s.,;)]+$/, "").toLowerCase();
  return s.length <= 200 && DOI_WHOLE.test(s) ? s : null;
}

/** A DOI as the path of an address (Crossref's /works/, doi.org's handles, OpenAlex's doi:): every character escaped but the slashes. `reserved`: only "%", "?" and "#" (what a fetch that keeps the rest of the path needs). */
export const doiPath = (doi: string, opts: { reserved?: boolean } = {}): string => (opts.reserved ? doi.replace(/[%?#]/g, (c) => encodeURIComponent(c)) : encodeURIComponent(doi).replace(/%2F/g, "/"));

/* ---------------------------------------------------------------- arXiv */

/** A new-style arXiv number ("1706.03762") and an old-style id ("hep-th/9901001", "math.GT/0309136"), without a version: sources to build a pattern from. */
export const ARXIV_NEW = String.raw`\d{4}\.\d{4,5}`;
export const ARXIV_OLD = String.raw`[a-z-]+(?:\.[A-Z]{2})?\/\d{7}`;
/** A message that is only an arXiv number or an arxiv.org address. */
export const ARXIV_INPUT = new RegExp(String.raw`^(?:arxiv:\s*)?${ARXIV_NEW}(?:v\d+)?$|^https?:\/\/arxiv\.org\/(?:abs|pdf)\/\S+$`, "i");

/** The DOI arXiv (through DataCite) gives every preprint. */
export const arxivDoi = (id: string): string => `10.48550/arxiv.${id}`;

const ARXIV_ID = new RegExp(String.raw`^(?:${ARXIV_NEW}|${ARXIV_OLD})(?:v\d+)?$`);
/** An arXiv number without its version ("1706.03762v5" -> "1706.03762"), from a bare id, "arXiv:" or an arxiv.org address; or null. */
export function cleanArxivId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().replace(/^arxiv:\s*/i, "");
  const url = /^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf|html)\/(.+?)(?:\.pdf)?(?:[?#].*)?$/i.exec(s);
  if (url) s = url[1]!;
  s = s.replace(/v\d+$/, "");
  return ARXIV_ID.test(s) ? s : null;
}

/** The DOI of an arXiv paper is 10.48550/arXiv.<number>: the number is the arXiv id. */
export function arxivIdFromDoi(doi: string): string | null {
  const m = /^10\.48550\/arxiv\.(.+)$/i.exec(doi);
  return m ? cleanArxivId(m[1]) : null;
}

/* ---------------------------------------------------------------- the marks [n] of an answer */

/**
 * A mark [n] that points into the numbered papers of a reply: one or two digits (`MARK`, what the page turns into a button), or up to three (`MARK_WIDE`, a literature scan's report, which numbers
 * the papers of every part). Global, with the number captured: for `replace`, `matchAll` and `split` only (`test` and `exec` on a global pattern remember where they stopped).
 */
export const MARK = /\[(\d{1,2})\]/g;
export const MARK_WIDE = /\[(\d{1,3})\]/g;
/** Does the text hold a mark [n] (one or two digits)? */
export const hasMark = (s: string): boolean => /\[\d{1,2}\]/.test(s);
/** The text without its marks [n] and the space before each. `unfinished`: also a mark still being written at the end ("... [1", "... ["), as a reply that is still arriving shows it. */
export const stripMarks = (s: string, opts: { unfinished?: boolean } = {}): string => {
  const t = s.replace(/\s*\[\d{1,2}\]/g, "");
  return opts.unfinished ? t.replace(/\s*\[\d{0,2}$/, "") : t;
};

/* ---------------------------------------------------------------- people */

/** An ORCID iD ("0000-0002-1825-0097"), and one written as its orcid.org address (the iD captured). */
export const ORCID = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;
export const ORCID_URL = /^https?:\/\/(?:www\.)?orcid\.org\/(\d{4}-\d{4}-\d{4}-\d{3}[\dXx])\/?$/i;
/** A whole e-mail address as a person types it into a form (no space, bracket, comma or quote; a dot in the domain). */
export const EMAIL_WHOLE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

/* ---------------------------------------------------------------- days */

/** A day as the server writes it ("2026-11-12"). */
export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The UTC day of a moment ("2026-11-12"). */
export const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
