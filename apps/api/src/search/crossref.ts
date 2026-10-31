import { crossrefFetch, SEARCH_GATE_WAIT_MS } from "../references/crossref-gate";
import { normalizeDoi, stripJats } from "./normalize";
import type { Provider, ProviderPaper } from "./types";

const SELECT = "DOI,title,author,issued,container-title,is-referenced-by-count,abstract";

/** Crossref polite pool: mailto param + User-Agent mein contact. */
export function crossrefHeaders(env: { CROSSREF_MAILTO: string }): HeadersInit {
  return { "User-Agent": `SodhsetuSearch/0.1 (mailto:${env.CROSSREF_MAILTO})` };
}

type CRItem = {
  DOI?: string;
  title?: string[];
  author?: { given?: string; family?: string; name?: string }[];
  issued?: { "date-parts"?: (number | null)[][] };
  "container-title"?: string[];
  "is-referenced-by-count"?: number;
  abstract?: string;
};

/**
 * Crossref relevance sirf bibliographic match ke liye achha hai, aur preprint versions (v1, v2) ka noise deta hai.
 * Isliye type filter lagaya; iska main kaam DOI-verified metadata aur retraction check (retraction.ts) hai.
 */
export const crossref: Provider = {
  name: "crossref",
  async search(q, limit, env, signal) {
    const params = new URLSearchParams({
      "query.bibliographic": q,
      rows: String(limit),
      select: SELECT,
      filter: "type:journal-article,type:proceedings-article,type:book-chapter",
      mailto: env.CROSSREF_MAILTO,
    });
    const res = await crossrefFetch(fetch, `https://api.crossref.org/works?${params}`, { signal, headers: crossrefHeaders(env) }, SEARCH_GATE_WAIT_MS);
    if (!res.ok) throw new Error(`Crossref HTTP ${res.status}`);
    const body = (await res.json()) as { message?: { items?: CRItem[] } };

    const out: ProviderPaper[] = [];
    for (const it of body.message?.items ?? []) {
      const title = it.title?.[0];
      const doi = normalizeDoi(it.DOI);
      if (!title || !doi) continue;
      out.push({
        doi,
        pmid: null,
        title,
        authors: (it.author ?? [])
          .map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(" "))
          .filter(Boolean)
          .slice(0, 10),
        year: it.issued?.["date-parts"]?.[0]?.[0] ?? null,
        venue: it["container-title"]?.[0] ?? null,
        abstract: stripJats(it.abstract),
        citationCount: it["is-referenced-by-count"] ?? null,
        oaUrl: null,
        retracted: false,
      });
    }
    return out;
  },
};
