import { normalizeDoi, normalizeTitle } from "./normalize";
import type { Provider, ProviderPaper } from "./types";

/**
 * arXiv's own search (Atom feed, no key). The preprints in the physics, maths, computer science, statistics and quantitative-biology
 * archives often appear here days before other indexes carry them. arXiv asks for at most one request every three seconds, so Idea Check
 * asks it at most twice per check, one after the other (see idea/search.ts). Parsed with plain patterns: the feed is a fixed, simple format.
 */
const API = "https://export.arxiv.org/api/query";
const STOP = new Set(["the", "a", "an", "of", "for", "and", "or", "in", "on", "to", "with", "by", "from", "using", "based", "is", "are"]);

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const tag = (xml: string, name: string) => decode(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml)?.[1] ?? "");

/** Every word that carries meaning, all of which must appear ("smartphone fundus photography glaucoma" -> all:smartphone AND all:fundus ...). */
export function arxivQuery(q: string): string {
  const terms = [...new Set(normalizeTitle(q).split(" ").filter((w) => w.length > 2 && !STOP.has(w)))].slice(0, 6);
  return terms.map((w) => `all:${w}`).join(" AND ");
}

export function parseArxivFeed(xml: string): ProviderPaper[] {
  const out: ProviderPaper[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1]!;
    const id = /arxiv\.org\/abs\/([^<\s]+?)(?:v\d+)?<\/id>/.exec(e)?.[1];
    const title = tag(e, "title");
    if (!id || !title) continue;
    const year = Number(/^(\d{4})/.exec(tag(e, "published"))?.[1]);
    const ownDoi = normalizeDoi(tag(e, "arxiv:doi"));
    out.push({
      // every preprint has the DOI arXiv registers for it, which is what other indexes list for the same paper, so the copies merge
      doi: ownDoi ?? (/^\d{4}\.\d{4,5}$/.test(id) ? `10.48550/arxiv.${id}` : null),
      pmid: null,
      title,
      authors: [...e.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)].map((a) => decode(a[1]!)).filter(Boolean).slice(0, 10),
      year: Number.isFinite(year) ? year : null,
      venue: "arXiv",
      abstract: tag(e, "summary") || null,
      citationCount: null,
      oaUrl: `https://arxiv.org/pdf/${id}`,
      retracted: false,
      workType: "preprint",
    });
  }
  return out;
}

export const arxiv: Provider = {
  name: "arxiv",
  async search(q, limit, _env, signal) {
    const query = arxivQuery(q);
    if (!query) return [];
    const params = new URLSearchParams({ search_query: query, start: "0", max_results: String(limit), sortBy: "relevance" });
    const res = await fetch(`${API}?${params}`, { signal });
    if (!res.ok) throw new Error(`arXiv HTTP ${res.status}`);
    return parseArxivFeed(await res.text());
  },
};
