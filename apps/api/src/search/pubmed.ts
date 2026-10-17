import { normalizeDoi } from "./normalize";
import type { Provider, ProviderPaper } from "./types";

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

type Summary = {
  uid: string;
  title?: string;
  pubdate?: string;
  source?: string;
  authors?: { name?: string }[];
  articleids?: { idtype: string; value: string }[];
};

/** esearch (ids, relevance sort) + esummary (metadata). Abstract efetch XML Phase 1 mein. */
export const pubmed: Provider = {
  name: "pubmed",
  async search(q, limit, env, signal) {
    const searchParams = new URLSearchParams({
      db: "pubmed",
      term: q,
      retmax: String(limit),
      retmode: "json",
      sort: "relevance",
    });
    if (env.NCBI_API_KEY) searchParams.set("api_key", env.NCBI_API_KEY);
    const sRes = await fetch(`${EUTILS}/esearch.fcgi?${searchParams}`, { signal });
    if (!sRes.ok) throw new Error(`PubMed esearch HTTP ${sRes.status}`);
    const ids = ((await sRes.json()) as { esearchresult?: { idlist?: string[] } }).esearchresult?.idlist ?? [];
    if (ids.length === 0) return [];

    const sumParams = new URLSearchParams({ db: "pubmed", id: ids.join(","), retmode: "json" });
    if (env.NCBI_API_KEY) sumParams.set("api_key", env.NCBI_API_KEY);
    const mRes = await fetch(`${EUTILS}/esummary.fcgi?${sumParams}`, { signal });
    if (!mRes.ok) throw new Error(`PubMed esummary HTTP ${mRes.status}`);
    const result = ((await mRes.json()) as { result?: Record<string, Summary> }).result ?? {};

    const out: ProviderPaper[] = [];
    for (const id of ids) {
      const s = result[id];
      if (!s?.title) continue;
      const year = Number(s.pubdate?.match(/\d{4}/)?.[0]);
      out.push({
        doi: normalizeDoi(s.articleids?.find((a) => a.idtype === "doi")?.value),
        pmid: s.uid,
        title: s.title.replace(/\.$/, ""),
        authors: (s.authors ?? []).map((a) => a.name).filter((n): n is string => !!n).slice(0, 10),
        year: Number.isFinite(year) ? year : null,
        venue: s.source ?? null,
        abstract: null,
        citationCount: null,
        oaUrl: null,
        retracted: false,
      });
    }
    return out;
  },
};
