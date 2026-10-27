import type { LitscanGap, LitscanItem, LitscanLanguage, LitscanPart, LitscanSource, LitscanWorkerStage, SearchResponse } from "@scholar/shared";
import { answerFromResults, pickEvidencePapers } from "../chat/answer";
import type { StreamComplete } from "../docs/qa";
import { NoRouteError, QuotaError } from "../llm";
import { isRelevant } from "./relevance";

/**
 * One worker of a literature scan: one sub-question, searched and answered exactly as the prompt box does it (the same search, the same abstracts, the same sentence-by-sentence check), and
 * returned as a checked answer or as the reason there is none. It writes nothing itself: the Workflow stores what it returns, so the worker can be tested with a made-up search and model.
 *
 * What it does **not** do on purpose: no "general background" when the papers do not answer (a scan's report holds only checked statements), and no retry of its own beyond the one the
 * answer step already makes for a malformed reply. A failure that waiting could cure (the model service failing) is thrown, and the Workflow tries the step again.
 */
export type WorkerDeps = {
  search: (query: string) => Promise<SearchResponse>;
  stream: StreamComplete;
};

/** A search that found nothing because the sources did not answer (rate limits, outages) is not "nothing found": it is thrown, so the workflow tries the step again. */
export class SearchUnavailableError extends Error {}

const ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };

/** A title as the index wrote it can carry escaped markup ("&lt;b&gt;Title&lt;/b&gt;") and line breaks; the report shows plain text. */
export function cleanTitle(title: string): string {
  const once = (s: string) => s.replace(/&(?:lt|gt|amp|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m);
  return once(once(title)).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

const gap = (idx: number, found: number, reason: LitscanGap): LitscanPart => ({ idx, status: "gap", found, reason });

export async function answerSubQuestion(args: {
  idx: number;
  item: LitscanItem;
  language: LitscanLanguage;
  deps: WorkerDeps;
  /** Tells where the worker is (searching, reading). No words. */
  onStage?: (stage: LitscanWorkerStage) => void | Promise<void>;
  /** The time limit of the model's part; when it has fired, a failure is "too slow", not an outage. */
  signal?: AbortSignal;
}): Promise<LitscanPart> {
  const { idx, item, language, deps } = args;
  await args.onStage?.("searching");
  const found = await deps.search(item.searchQuery);
  const n = found.results.length;
  if (n === 0) {
    if (Object.values(found.providers).some((p) => !p.ok && !/not configured/i.test(p.error ?? ""))) throw new SearchUnavailableError("the paper sources did not answer");
    return gap(idx, 0, "nothing_found");
  }
  // only papers that are about the sub-question are read (relevance.ts): the first twenty of a loose search include papers that only share a word
  const relevant = found.results.filter((p) => isRelevant(item.searchQuery, p));
  if (relevant.length === 0) return gap(idx, n, "no_relevant");
  const picked = pickEvidencePapers(relevant);
  if (picked.length === 0) return gap(idx, n, "no_abstracts");

  await args.onStage?.("reading");
  let answer;
  try {
    // the answer is for the sub-question as the person approved it, in the language they chose; no word of it is shown before the check, so nothing is emitted
    answer = await answerFromResults({ question: item.question, language, picked, stream: deps.stream, emit: () => {}, label: "litscan_worker" });
  } catch (e) {
    if (e instanceof QuotaError) return gap(idx, n, "quota");
    if (args.signal?.aborted) return gap(idx, n, "too_slow");
    if (e instanceof NoRouteError) return gap(idx, n, "unavailable");
    throw e;
  }
  if (!answer.grounded) return gap(idx, n, answer.enough ? "not_grounded" : "not_answered");

  const byN = new Map(picked.map((p) => [p.n, p.paper]));
  const sources: LitscanSource[] = answer.citations.flatMap((c) => {
    const p = byN.get(c.n);
    return p ? [{ n: c.n, paperId: p.id, title: cleanTitle(p.title), year: p.year, doi: p.doi, authors: p.authors.slice(0, 6), venue: p.venue, url: p.doi ? `https://doi.org/${p.doi}` : p.oaUrl }] : [];
  });
  return { idx, status: "answered", found: n, text: answer.text, citations: answer.citations, sources };
}
