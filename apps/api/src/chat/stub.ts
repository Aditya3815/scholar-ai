import type { Paper, SearchResponse, SearchScope } from "@scholar/shared";
import type { StreamComplete } from "../docs/qa";
import { extractJson } from "../llm/gateway";
import { QuotaError } from "../llm";

/**
 * Offline stand-ins for the search and the model, used ONLY by tests and the local end-to-end run (QA_STUB=1 with ENABLE_DEV_ROUTES=1, never production secrets).
 * Words in the question steer them: "nothing" finds no papers, "partial" makes one source fail, "unanswerable" makes the model say the papers do not answer,
 * "hallucinate" makes it cite a sentence that does not exist, "slowly" makes the answer take a few seconds (to press Stop), "longabstract" gives the first paper a long abstract, "stalled" keeps the stream silent for a few seconds. When the papers do not answer, the general background (chat_general) is steered by "gibberish", "greeting", "cites" and "marks".
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

/** "oapapers": four papers whose DOIs the offline network of src/oa/stub.ts knows (full text from XML, a slow one, a free PDF, one that cannot be read), for the "Ask this paper" tests. */
const OA_RECORDS = [
  { doi: "10.5555/oa.xml", title: "Smartphone Retinal Imaging for Glaucoma Screening in Rural Clinics", abstract: "We evaluated a smartphone adapter for retinal imaging in rural primary clinics. Sensitivity for glaucoma was 91 percent and specificity was 87 percent." },
  { doi: "10.5555/oa.slow2", title: "A Slowly Read Paper on Glaucoma Screening", abstract: "This paper takes a few seconds to be read into the shared index, so that a progress line can be seen while it happens." },
  { doi: "10.5555/oa.pdf", title: "Federated Learning for Hospital Data: A Practical Guide", abstract: "We train a federated model across five hospitals without sharing patient records. The method keeps every record inside the hospital that holds it." },
  { doi: "10.5555/oa.retracted", title: "A Retracted Paper About Glaucoma Risk", abstract: "This abstract is long enough to be read, but the paper it belongs to has been retracted by the journal because of problems with its data.", retracted: true },
  { doi: "10.5555/oa.blocked", title: "A Paper From A Big Publisher", abstract: "This paper describes a screening programme in rural clinics. The programme reached eight thousand people in two years and found glaucoma in four percent of them." },
];
const stubOaPapers = (): Paper[] => stubPapers().slice(0, OA_RECORDS.length).map((p, i) => ({ ...p, id: `doi:${OA_RECORDS[i]!.doi}`, doi: OA_RECORDS[i]!.doi, title: OA_RECORDS[i]!.title, abstract: OA_RECORDS[i]!.abstract, retracted: "retracted" in OA_RECORDS[i]! && OA_RECORDS[i]!.retracted === true, retractionSources: [], oaUrl: null }));

/**
 * The "Indian sources" search: an article from a journal published in India (DOAJ), a thesis on Shodhganga (no DOI, no abstract: it is listed with the page of its
 * record and cannot be cited by the answer), and a paper by authors at an Indian institution.
 */
export function stubIndiaPapers(): Paper[] {
  const base = { pmid: null, citationCount: null, retracted: false, retractionSources: [] as string[], oaUrl: null };
  return [
    { ...base, id: "doi:10.4103/stub.india.1", doi: "10.4103/stub.india.1", title: "Glaucoma screening camps in rural Maharashtra", authors: ["P. Deshmukh", "R. Kulkarni"], year: 2021, venue: "Indian Journal of Ophthalmology", abstract: "Screening camps examined 4,200 adults in twelve villages. Glaucoma was found in 3.1 percent of them, and most had not known about it. Follow-up visits were kept by two thirds of those referred.", oaUrl: "https://example.org/ijo/stub-1", sources: ["doaj"], score: 0.9, workType: "article", doiStatus: "verified" },
    { ...base, id: "t:stub-shodhganga-thesis", doi: null, title: "A study of glaucoma awareness among adults in Karnataka", authors: ["S. Hegde"], year: 2016, venue: "Shodhganga", abstract: null, sources: ["shodhganga"], score: 0.8, workType: "dissertation", url: "https://shodhganga.inflibnet.ac.in/handle/10603/00001" },
    { ...base, id: "doi:10.1000/india.inst.1", doi: "10.1000/india.inst.1", title: "Cost of glaucoma care in a tertiary hospital in Chennai", authors: ["K. Raman"], year: 2022, venue: "Journal of Glaucoma", abstract: "Direct costs of glaucoma care were collected for 310 patients over a year. Medicines were the largest part of the cost. Patients from rural areas spent more on travel than on treatment.", citationCount: 4, sources: ["openalex-india"], score: 0.7, workType: "article", doiStatus: "verified" },
  ];
}

export function stubSearchFor(q: string, scope: SearchScope = "all"): SearchResponse {
  if (scope === "india") {
    const results = /\bnothing\b/i.test(q) ? [] : stubIndiaPapers();
    const st = (n: number) => ({ ok: true, count: n, ms: 5, cached: false });
    return { query: q, results, providers: { "openalex-india": st(results.length ? 1 : 0), doaj: st(results.length ? 1 : 0), shodhganga: st(results.length ? 1 : 0) }, doiCheck: st(0), retractionCheck: st(0), tookMs: 12, scope } as SearchResponse;
  }
  const none = /\bnothing\b/i.test(q);
  const results = none ? [] : /\boapapers\b/i.test(q) ? stubOaPapers() : stubPapers();
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
  if (req.label === "chat_general") {
    // the background: "gibberish" is a subject it does not recognise, "greeting" is not a research question, "cites" tries to name a paper (the server must throw that away),
    // "marks" writes source marks (the server must remove them), anything else is background
    if (/gibberish/i.test(q)) json = { kind: "unsure", answer: "" };
    else if (/greeting/i.test(q)) json = { kind: "not_research", answer: "This box finds research papers and answers from them." };
    else if (/cites/i.test(q)) json = { kind: "background", answer: "Smith et al. showed in 2019 that this is generally the case, and it is widely accepted by now." };
    else if (/marks/i.test(q)) json = { kind: "background", answer: "It is generally understood that this works well in practice [1]. Most experts would agree [2][3]." };
    else json = { kind: "background", answer: "In general terms this is a well studied question, and the usual answer depends on the setting, the people involved and how the outcome is measured." };
  } else if (/unanswerable/i.test(q) || !first) json = { coverage: "none", answer: "", evidence: [] };
  else if (/hallucinate/i.test(q)) json = { coverage: "full", answer: `A made-up claim [${first}].`, evidence: [{ n: Number(first), s: 99 }] };
  else if (/tighten(fail|quota)/i.test(q)) json = { coverage: "full", answer: `The first paper reports its main result (${/tighten\w+/i.exec(q)![0].toLowerCase()}) [${first}].`, evidence: [{ n: Number(first), s: 2 }] };
  else if (/tightenslow/i.test(q)) json = { coverage: "full", answer: `The first paper reports its main result (tightenslow) and also claims a cure [${first}].`, evidence: [{ n: Number(first), s: 2 }] };
  else if (/tighten/i.test(q)) json = { coverage: "full", answer: `The first paper reports its main result and also claims a cure [${first}].`, evidence: [{ n: Number(first), s: 2 }] };
  else if (/judgedrop/i.test(q)) json = { coverage: "full", answer: `The first paper reports its main result [${first}]. The paper also claims an invented cure [${first}].`, evidence: [{ n: Number(first), s: 2 }] };
  else if (/judge(fail|bad|slow|move)/i.test(q)) json = { coverage: "full", answer: `The first paper reports its main result (${/judge\w+/i.exec(q)![0].toLowerCase()}) [${first}].`, evidence: [{ n: Number(first), s: 2 }] };
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

/**
 * The support judge, offline (QA_STUB=1): it reads the claims of the stub answer and steers by a word in them. A claim with "invented" is judged `no`; "judgefail" makes the call fail,
 * "judgebad" gives a reply that cannot be used, "judgeslow" takes a few seconds, "judgemove" backs the claim with sentence 3 instead of the model's sentence 2; any other claim that cites a
 * paper is judged `yes` with sentence 2 of its first paper, and a claim that cites nothing is `framing`.
 */
export const stubJudgeStream = (_env?: unknown): StreamComplete => async (req) => {
  const lines = [...req.user.matchAll(/^c(\d+) cites ([^:]*): (.*)$/gm)];
  if (lines.some((l) => /judgefail/.test(l[3]!))) throw new Error("the stub judge failed");
  if (lines.some((l) => /judgebad/.test(l[3]!))) return { json: { nothing: true }, model: "stub" };
  if (lines.some((l) => /judgeslow/.test(l[3]!))) await sleep(2500);
  const move = lines.some((l) => /judgemove/.test(l[3]!));
  const claims = lines.map((l) => {
    const n = Number(/\[(\d+)\]/.exec(l[2]!)?.[1]);
    if (!n) return { c: Number(l[1]), v: "framing", refs: [] };
    if (/invented/.test(l[3]!)) return { c: Number(l[1]), v: "no", refs: [] };
    return { c: Number(l[1]), v: "yes", refs: [{ n, s: [move ? 3 : 2] }] };
  });
  return { json: { claims }, model: "stub" };
};

/**
 * The strict check's model, offline: like the quick judge, but a claim that says "claims a cure" is called `partial` and offered without it; "tightenfail" makes the call fail,
 * "tightenquota" makes it fail as the daily allowance does, "tightenslow" makes it take four seconds (to press Cancel).
 */
export const stubStrictStream: StreamComplete = async (req) => {
  const lines = [...req.user.matchAll(/^c(\d+) cites ([^:]*): (.*)$/gm)];
  if (lines.some((l) => /tightenquota/.test(l[3]!))) throw new QuotaError("daily AI quota reached (stub)");
  if (lines.some((l) => /tightenfail/.test(l[3]!))) throw new Error("the stub strict check failed");
  if (lines.some((l) => /tightenslow/.test(l[3]!))) await sleep(4000);
  const claims = lines.map((l) => {
    const n = Number(/\[(\d+)\]/.exec(l[2]!)?.[1]);
    if (!n) return { c: Number(l[1]), v: "framing", refs: [], safe: "" };
    if (/claims a cure/.test(l[3]!)) return { c: Number(l[1]), v: "partial", refs: [{ n, s: [2] }], safe: l[3]!.replace(/ and also claims a cure/, "") };
    return { c: Number(l[1]), v: "yes", refs: [{ n, s: [2] }], safe: "" };
  });
  return { json: { claims }, model: "stub" };
};
