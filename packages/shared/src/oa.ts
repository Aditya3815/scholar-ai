/**
 * Open-access papers in the shared index (W4). One public copy of the text of a paper, read once on the server and used to answer anyone's question about it. It holds no
 * personal data: nobody is recorded as having asked. Types and limits shared by the API and the web app.
 */
import type { AskStreamEvent } from "./documents";
import type { Paper } from "./index";

/** Where the text came from, best first: Europe PMC's full-text XML, an arXiv PDF, the open-access PDF a record links to, or (when none can be read) the abstract alone. */
export const OA_SOURCES = ["europepmc", "arxiv", "pdf", "abstract"] as const;
export type OaSource = (typeof OA_SOURCES)[number];

/** queued, fetching, reading and embedding are the steps of the ingest; ready and unreadable are the two ways it ends (failed: it stopped for a reason that may pass; asking again tries once more). */
export const OA_STATUSES = ["queued", "fetching", "reading", "embedding", "ready", "failed", "unreadable"] as const;
export type OaStatus = (typeof OA_STATUSES)[number];
export const OA_WORKING: readonly OaStatus[] = ["queued", "fetching", "reading", "embedding"];

/** Why a paper cannot be read here. Plain words for each are in `OA_UNREADABLE_TEXT`. */
export const OA_REASONS = ["not_open_access", "no_source", "blocked", "not_a_pdf", "too_large", "too_long", "scanned", "empty", "wrong_paper", "daily_cap", "fetch_failed", "timeout", "internal"] as const;
export type OaReason = (typeof OA_REASONS)[number];
export const OA_UNREADABLE_TEXT: Record<OaReason, string> = {
  not_open_access: "This paper is not open access.",
  no_source: "No open copy of this paper could be found.",
  blocked: "The publisher does not let a program download this paper.",
  not_a_pdf: "The link did not lead to a PDF.",
  too_large: "This file is too large to read here.",
  too_long: "This paper is too long to read here.",
  scanned: "This PDF is a scan (pictures of pages), which cannot be read here.",
  empty: "No readable text was found in this paper.",
  wrong_paper: "The link led to a different paper.",
  daily_cap: "The day's limit of new papers for the shared index has been reached, so this one was not read. Papers that are already there still work.",
  fetch_failed: "The paper could not be downloaded just now.",
  timeout: "Downloading the paper took too long.",
  internal: "Something went wrong while reading this paper.",
};
/** Reasons that may pass: asking again, later, may work. The others will not change by waiting. */
export const OA_RETRYABLE: readonly OaReason[] = ["fetch_failed", "timeout", "internal"];

export const MAX_OA_BYTES = 25 * 1024 * 1024;
export const MAX_OA_PAGES = 120;
export const MAX_OA_REDIRECTS = 3;
export const OA_FETCH_TIMEOUT_MS = 25_000;
/** An indexed paper is fetched again after this long, when someone asks it and without making them wait (the file may have a new version): src/oa/store.ts, claimRefresh. */
export const OA_REFRESH_DAYS = 180;
/** A paper that could not be fetched is not tried again for this long, whoever asks. */
export const OA_RETRY_AFTER_MINUTES = 60;
/** New papers one person may bring into the shared index in a day (papers already there are free). */
export const OA_NEW_PAPERS_PER_DAY = 20;
/** An emergency brake for the whole service: new papers brought into the shared index in a day by everyone (each costs a download, some storage and some embeddings: cents). */
export const OA_NEW_PAPERS_PER_DAY_ALL = 300;
/** The longest a question waits for a paper that is being read, before it says "still reading, ask again in a minute". */
export const OA_WAIT_MS = 120_000;

/** What identifies a paper: any of these. A DOI is best; an arXiv paper can be named by its number alone. */
export type OaRef = { doi?: string; arxivId?: string; pmcid?: string };

const DOI = /^10\.\d{4,9}\/\S+$/;
const ARXIV_NEW = /^\d{4}\.\d{4,5}(?:v\d+)?$/;
const ARXIV_OLD = /^[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?$/;
const PMCID = /^PMC\d{1,10}$/i;

/** A DOI as a lower-case bare identifier (a URL, "doi:" and surrounding junk removed), or null. */
export function cleanDoi(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "").replace(/[\s.,;)]+$/, "").toLowerCase();
  return s.length <= 200 && DOI.test(s) ? s : null;
}
/** An arXiv number without its version ("1706.03762v5" -> "1706.03762"), from a bare id, "arXiv:" or an arxiv.org address; or null. */
export function cleanArxivId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().replace(/^arxiv:\s*/i, "");
  const url = /^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf|html)\/(.+?)(?:\.pdf)?(?:[?#].*)?$/i.exec(s);
  if (url) s = url[1]!;
  s = s.replace(/v\d+$/, "");
  return ARXIV_NEW.test(s) || ARXIV_OLD.test(s) ? s : null;
}
export function cleanPmcid(raw: unknown): string | null {
  return typeof raw === "string" && PMCID.test(raw.trim()) ? raw.trim().toUpperCase() : null;
}

/** The DOI of an arXiv paper is 10.48550/arXiv.<number>: the number is the arXiv id. */
export function arxivIdFromDoi(doi: string): string | null {
  const m = /^10\.48550\/arxiv\.(.+)$/i.exec(doi);
  return m ? cleanArxivId(m[1]) : null;
}

/** Everything a search result tells about where a paper can be read. */
export function refFromPaper(p: Pick<Paper, "doi" | "oaUrl">): OaRef | null {
  const doi = cleanDoi(p.doi);
  const arxivId = (doi ? arxivIdFromDoi(doi) : null) ?? cleanArxivId(p.oaUrl);
  if (!doi && !arxivId) return null;
  return { ...(doi ? { doi } : {}), ...(arxivId ? { arxivId } : {}) };
}

/** The key of a paper in the shared index: its DOI, else its arXiv number. The same paper under a different link, or as preprint and article with the same DOI, is one key. */
export function oaKey(ref: OaRef): string | null {
  const doi = cleanDoi(ref.doi);
  if (doi) return `doi:${doi}`;
  const arxiv = cleanArxivId(ref.arxivId);
  return arxiv ? `arxiv:${arxiv}` : null;
}

/** Events of the open-access question stream (POST /papers/oa/ask): the ingest, then the same events as a question about a paper of your own. */
export type OaIngestEvent = {
  type: "ingest";
  status: OaStatus;
  /** 0 to 1 while embedding, otherwise a step-by-step estimate */
  progress: number;
  /** what the text is: from Europe PMC's XML, a PDF, or just the abstract */
  source?: OaSource;
  /** the person asking started this reading (true) or joined one that was already going (false) */
  started?: boolean;
};

/** Which paper the answer is about and what it is made from: sent once, before the answer. `source: "abstract"` means the full text could not be read and `reason` says why. */
export type OaPaperEvent = {
  type: "paper";
  key: string;
  title: string | null;
  source: OaSource;
  license: string | null;
  /** The PDF itself may be shown to others under this licence (CC0, CC BY, CC BY-SA). The text is used for answers whatever the licence. */
  permissive: boolean;
  reason?: OaReason;
  /** The paper has been retracted (looked up when it was asked, not only when the card was made): the sheet says so above the answer. Absent when it has not. */
  retracted?: boolean;
};

/** The stream of POST /papers/oa/ask: the ingest, the paper, then the events of a question about a paper of your own (stage, sources, delta, answer; error ends it). */
export type OaAskEvent = AskStreamEvent | OaIngestEvent | OaPaperEvent;
export const MAX_OA_ABSTRACT_CHARS = 4000;
