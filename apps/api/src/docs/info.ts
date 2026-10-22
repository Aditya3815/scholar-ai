import { MAX_PAPER_REFERENCES, lookupDoi, type OutlineItem, type PaperInfo, type PaperMetadata } from "@scholar/shared";
import { tokenize } from "../references/match";
import { crossrefByDoi, crossrefReferenceStrings, openAlexByDoi, type LookupEnv } from "../references/lookup";

const DOI = /^10\.\d{4,9}\/[^\s"<>]{1,200}$/i;
const ARXIV = /^(\d{4}\.\d{4,5}|[a-z\-]+(\.[A-Z]{2})?\/\d{7})$/;

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const int = (v: unknown, min: number, max: number, fallback: number): number => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback);

function outline(v: unknown, pages: number): OutlineItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, 150)
    .map((o): OutlineItem | null => {
      const r = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
      const title = str(r.title, 200);
      return title ? { title, page: int(r.page, 0, pages, 0), level: int(r.level, 1, 6, 1) } : null;
    })
    .filter((o): o is OutlineItem => o !== null);
}

/**
 * What the browser sends is untrusted: keep only what we expect, in bounds. `metadata` and `referencesSource: "crossref"` are
 * decided here on the server, never taken from the client.
 */
export function sanitizePaperInfo(raw: unknown): PaperInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const pages = int(r.pages, 1, 500, 0);
  if (!pages) return null;
  const refs = (Array.isArray(r.references) ? r.references : []).map((x) => str(x, 1000)).filter((x) => x.length >= 20).slice(0, MAX_PAPER_REFERENCES);
  const doi = str(r.doi, 220).toLowerCase();
  const arxiv = str(r.arxiv, 40);
  return {
    pages,
    title: str(r.title, 300) || null,
    doi: DOI.test(doi) ? doi : null,
    arxiv: ARXIV.test(arxiv) ? arxiv : null,
    outline: outline(r.outline, pages),
    headings: outline(r.headings, pages),
    references: refs,
    referencesSource: refs.length > 0 ? "pdf" : "none",
    metadata: null,
  };
}

const overlap = (a: string, b: string): number => {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  const i = [...A].filter((t) => B.has(t)).length;
  return Math.min(A.size, B.size) ? i / Math.min(A.size, B.size) : 0;
};

/** The first DOI (the paper's own, then the one arXiv gives every preprint) that finds a record whose title agrees with the PDF's. */
async function findMetadata(info: PaperInfo, env: LookupEnv): Promise<PaperMetadata | null> {
  const dois = [...new Set([info.doi, lookupDoi({ doi: null, arxiv: info.arxiv })].filter((d): d is string => !!d))];
  for (const doi of dois) {
    try {
      const fromCrossref = await crossrefByDoi(doi, env);
      const rec = fromCrossref ?? (await openAlexByDoi(doi, env));
      if (!rec) continue;
      // A DOI printed on page 1 can belong to something else (a related article, a dataset): trust it only if the titles agree.
      if (info.title && overlap(info.title, rec.title) < 0.5) continue;
      // OpenAlex merges every version of a preprint and can report the latest year; the arXiv id itself says when it first appeared.
      const arxivYear = doi.startsWith("10.48550/") ? /^(\d{2})(0[1-9]|1[0-2])\./.exec(info.arxiv ?? "") : null;
      const year = arxivYear ? 2000 + Number(arxivYear[1]) : rec.year;
      return { title: rec.title, authors: rec.authors.slice(0, 30), year, venue: rec.venue, doi: rec.doi ?? doi, source: fromCrossref ? "crossref" : "openalex" };
    } catch {
      /* a lookup service is down: the paper still works without metadata */
    }
  }
  return null;
}

const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

/** Adds what the registries know (best effort, never fails the upload). */
export async function enrichPaperInfo(info: PaperInfo, env: LookupEnv): Promise<PaperInfo> {
  const out: PaperInfo = { ...info };
  out.metadata = await withTimeout(findMetadata(info, env), 8000, null);
  // The PDF's own list could not be read: use the publisher's list for the DOI (published papers almost always have one).
  const doi = out.metadata?.doi ?? lookupDoi(info);
  if (out.references.length < 3 && doi) {
    const deposited = await withTimeout(crossrefReferenceStrings(doi, env).catch(() => [] as string[]), 8000, [] as string[]);
    if (deposited.length >= 3) {
      out.references = deposited.slice(0, MAX_PAPER_REFERENCES);
      out.referencesSource = "crossref";
    }
  }
  return out;
}
