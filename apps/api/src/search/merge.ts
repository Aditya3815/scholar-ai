import type { Paper } from "@scholar/shared";
import { normalizeTitle } from "./normalize";
import type { ProviderPaper } from "./types";

const RRF_K = 60;

function titleKey(p: ProviderPaper): string {
  return `${normalizeTitle(p.title)}|${p.year ?? ""}`;
}

/**
 * DOI (phir PMID, phir title+year) se dedup, aur reciprocal rank fusion se ranking.
 * Field merge: khali fields bharo, lamba abstract rakho, max citation count, retracted = OR.
 */
export function mergeAndRank(lists: Record<string, ProviderPaper[]>, limit: number): Paper[] {
  const papers: Paper[] = [];
  const byDoi = new Map<string, Paper>();
  const byPmid = new Map<string, Paper>();
  const byTitle = new Map<string, Paper>();

  for (const [source, list] of Object.entries(lists)) {
    list.forEach((p, i) => {
      const rr = 1 / (RRF_K + i + 1);
      const tk = titleKey(p);
      let existing =
        (p.doi && byDoi.get(p.doi)) || (p.pmid && byPmid.get(p.pmid)) || byTitle.get(tk) || undefined;

      if (!existing) {
        existing = {
          id: p.doi ? `doi:${p.doi}` : p.pmid ? `pmid:${p.pmid}` : `t:${tk}`,
          doi: p.doi,
          pmid: p.pmid,
          title: p.title,
          authors: p.authors,
          year: p.year,
          venue: p.venue,
          abstract: p.abstract,
          citationCount: p.citationCount,
          oaUrl: p.oaUrl,
          retracted: p.retracted,
          workType: p.workType ?? null,
          retractionSources: p.retracted ? [source] : [],
          sources: [source],
          score: rr,
        };
        papers.push(existing);
      } else {
        existing.score += rr;
        if (!existing.sources.includes(source)) existing.sources.push(source);
        existing.doi ??= p.doi;
        existing.pmid ??= p.pmid;
        if (existing.authors.length === 0) existing.authors = p.authors;
        existing.year ??= p.year;
        existing.venue ??= p.venue;
        if ((p.abstract?.length ?? 0) > (existing.abstract?.length ?? 0)) existing.abstract = p.abstract;
        if ((p.citationCount ?? -1) > (existing.citationCount ?? -1)) existing.citationCount = p.citationCount;
        existing.oaUrl ??= p.oaUrl;
        existing.workType ??= p.workType ?? null;
        if (p.retracted) {
          existing.retracted = true;
          if (!existing.retractionSources.includes(source)) existing.retractionSources.push(source);
        }
      }

      if (existing.doi) byDoi.set(existing.doi, existing);
      if (existing.pmid) byPmid.set(existing.pmid, existing);
      byTitle.set(tk, existing);
    });
  }

  return papers
    .sort((a, b) => b.score - a.score || (b.citationCount ?? 0) - (a.citationCount ?? 0))
    .slice(0, limit);
}
