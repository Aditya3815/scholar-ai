import { MAX_TIGHTEN_ABSTRACT, MAX_TIGHTEN_PAPERS, MAX_TIGHTEN_TEXT, type ChatCitation, type Paper, type TightenRequest } from "@scholar/shared";
import type { Picked } from "./answer";
import { shownSentence } from "./evidence";

/**
 * What the strict check ("Check strictly", docs/design/claim-support.md) is given, read and made safe: the request is the browser's, so every field is checked and nothing in it
 * is believed more than it must be. The sentences shown as evidence are never taken from the request: they are cut from the abstract by number, as everywhere.
 */
export type TightenInput = { text: string; picked: Picked[]; citations: ChatCitation[] };

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** The request as an input, or the plain reason it is not one. Never throws. */
export function readTighten(raw: unknown): { ok: true; input: TightenInput } | { ok: false; detail: string } {
  const o = (raw && typeof raw === "object" ? raw : null) as Partial<TightenRequest> | null;
  if (!o) return { ok: false, detail: "The request is not a JSON object." };
  const text = typeof o.text === "string" ? o.text.replace(/\s+/g, " ").trim() : "";
  if (!text) return { ok: false, detail: "There is no answer to read." };
  if (text.length > MAX_TIGHTEN_TEXT) return { ok: false, detail: `The answer is longer than ${MAX_TIGHTEN_TEXT} characters.` };
  if (!Array.isArray(o.papers) || o.papers.length === 0) return { ok: false, detail: "The papers the answer was made from are needed." };
  if (o.papers.length > MAX_TIGHTEN_PAPERS) return { ok: false, detail: `At most ${MAX_TIGHTEN_PAPERS} papers.` };
  const picked: Picked[] = [];
  const seen = new Set<number>();
  for (const p of o.papers) {
    const x = (p && typeof p === "object" ? p : {}) as { n?: unknown; title?: unknown; year?: unknown; abstract?: unknown };
    if (!isInt(x.n) || x.n < 1 || x.n > 99 || seen.has(x.n)) return { ok: false, detail: "Each paper needs its own number, from 1 to 99." };
    if (typeof x.abstract !== "string" || x.abstract.trim().length === 0 || x.abstract.length > MAX_TIGHTEN_ABSTRACT) return { ok: false, detail: `Each paper needs an abstract of at most ${MAX_TIGHTEN_ABSTRACT} characters.` };
    seen.add(x.n);
    picked.push({
      n: x.n,
      paper: { id: `req:${x.n}`, doi: null, pmid: null, title: typeof x.title === "string" ? x.title.slice(0, 400) : "", authors: [], year: isInt(x.year) && x.year > 1000 && x.year < 3000 ? x.year : null, venue: null, abstract: x.abstract, citationCount: null, oaUrl: null, retracted: false, retractionSources: [], sources: [], score: 0 } as Paper,
    });
  }
  const byN = new Map(picked.map((p) => [p.n, p.paper]));
  const citations: ChatCitation[] = [];
  for (const c of Array.isArray(o.citations) ? o.citations.slice(0, 60) : []) {
    const x = (c && typeof c === "object" ? c : {}) as { n?: unknown; sentenceNo?: unknown };
    const paper = isInt(x.n) ? byN.get(x.n) : undefined;
    const sentence = paper ? shownSentence(paper, x.sentenceNo) : "";
    if (!paper || !sentence || citations.some((k) => k.n === x.n && k.sentenceNo === x.sentenceNo)) continue;
    citations.push({ n: x.n as number, paperId: paper.id, sentenceNo: x.sentenceNo as number, sentence });
  }
  if (citations.length === 0) return { ok: false, detail: "The sentences shown for the answer are needed." };
  return { ok: true, input: { text, picked, citations } };
}
