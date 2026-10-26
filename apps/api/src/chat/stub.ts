import type { Paper, SearchResponse } from "@scholar/shared";
import type { StreamComplete } from "../docs/qa";
import { extractJson } from "../llm/gateway";

/**
 * Offline stand-ins for the search and the model, used ONLY by tests and the local end-to-end run (QA_STUB=1 with ENABLE_DEV_ROUTES=1, never production secrets).
 * Words in the question steer them: "nothing" finds no papers, "partial" makes one source fail, "unanswerable" makes the model say the papers do not answer,
 * "hallucinate" makes it cite a sentence that does not exist, "slowly" makes the answer take a few seconds (to press Stop), "longabstract" gives the first paper a long abstract, "stalled" keeps the stream silent for a few seconds.
 */
const RECORDS = [
  { doi: "10.1000/glaucoma.1", title: "Deep learning for glaucoma screening from fundus photographs", year: 2021, venue: "Journal of Ophthalmic AI", abstract: "We trained a convolutional network on 12,000 fundus photographs to detect glaucoma. The model reached an AUC of 0.94 on a held-out set. Performance was lower for images with cataract." },
  { doi: "10.1000/glaucoma.2", title: "Smartphone-based retinal imaging in rural clinics", year: 2022, venue: "Lancet Digital Health", abstract: "Low-cost smartphone adapters were used to capture retinal images in three rural clinics. Community health workers took the images after two hours of training. Sensitivity for referable disease was 88 percent." },
  { doi: "10.1000/glaucoma.3", title: "A retracted study of glaucoma risk", year: 2019, venue: "Journal of Doubtful Results", abstract: "This abstract is long enough to be read by the model but the paper has been retracted, so it must never be used as evidence for anything at all.", retracted: true },
  { doi: null, title: "Notes on optic nerve imaging", year: 2018, venue: null, abstract: null },
  { doi: "10.1000/glaucoma.4", title: "Cost of population screening for glaucoma in India", year: 2020, venue: "Indian Journal of Public Health", abstract: "Population screening costs were modelled for five Indian states. Screening with photographs was cheaper than clinic visits. The model assumes stable referral rates." },
] as const;

export function stubPapers(): Paper[] {
  return RECORDS.map((r, i) => ({
    id: r.doi ? `doi:${r.doi}` : `t:chat-stub-${i}`,
    doi: r.doi,
    pmid: null,
    title: r.title,
    authors: ["A. Rao", "S. Iyer"],
    year: r.year,
    venue: r.venue,
    abstract: r.abstract,
    citationCount: 10 * (RECORDS.length - i),
    oaUrl: i === 0 ? "https://example.org/sample.pdf" : null,
    retracted: "retracted" in r && r.retracted === true,
    retractionSources: "retracted" in r && r.retracted ? ["openalex"] : [],
    sources: ["openalex"],
    score: 1 - i / 10,
    doiStatus: r.doi ? ("verified" as const) : undefined,
  }));
}

export function stubSearchFor(q: string): SearchResponse {
  const none = /\bnothing\b/i.test(q);
  const results = none ? [] : stubPapers();
  // "longabstract": the first paper has an abstract far longer than a folded card shows (to see the interim lists carry only its start)
  if (/\blongabstract\b/i.test(q) && results[0]?.abstract) results[0] = { ...results[0], abstract: `${results[0].abstract} ${"Further detail of the method and its limits is given in the full text of this stand-in paper. ".repeat(8)}`.trim() };
  const partial = /\bpartial\b/i.test(q);
  return {
    query: q,
    results,
    providers: { openalex: { ok: true, count: results.length, ms: 5, cached: false }, s2: { ok: !partial, count: partial ? 0 : results.length, ms: 5, cached: false, ...(partial ? { error: "timeout" } : {}) } },
    doiCheck: { ok: true, count: 0, ms: 0, cached: false },
    retractionCheck: { ok: true, count: 0, ms: 0, cached: false },
    tookMs: 12,
  } as SearchResponse;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const stubChatStream: StreamComplete = async (req, hooks) => {
  const q = /^Question: (.*)$/m.exec(req.user)?.[1] ?? "";
  const first = /^\[(\d+)\] /m.exec(req.user)?.[1];
  let json: unknown;
  if (/unanswerable/i.test(q) || !first) json = { coverage: "none", answer: "", evidence: [] };
  else if (/hallucinate/i.test(q)) json = { coverage: "full", answer: `A made-up claim [${first}].`, evidence: [{ n: Number(first), s: 99 }] };
  else json = { coverage: "full", answer: `The first paper reports its main result [${first}].`, evidence: [{ n: Number(first), s: 2 }] };
  const text = JSON.stringify(json, null, 2);
  hooks.onThinking?.();
  await sleep(/slowly/i.test(q) ? 400 : 60);
  for (let i = 0; i < text.length; i += 12) {
    hooks.onContent?.(text.slice(i, i + 12));
    await sleep(/slowly/i.test(q) ? 90 : 15);
  }
  return { json: extractJson(text), model: "stub" };
};
