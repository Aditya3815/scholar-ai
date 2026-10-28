import type { Complete, StreamComplete } from "../docs/qa";
import { AllProvidersFailedError, QuotaError } from "../llm";
import type { SearchResponse, SearchScope } from "@scholar/shared";
import { stubChatStream, stubSearchFor } from "../chat/stub";

/**
 * Offline stand-ins for the model and the search of a literature scan, used ONLY by tests and the local end-to-end run (QA_STUB=1 with ENABLE_DEV_ROUTES=1, never production secrets).
 * They reuse the prompt box's stand-ins, so a sub-question is steered by the same words ("nothing" finds no papers, "unanswerable" makes the model say the papers do not answer,
 * "hallucinate" makes it cite a sentence that does not exist), plus three of their own: "boom" makes the model service fail, "snail" makes the answer take a few seconds (to press
 * Cancel, or to see the progress), "overquota" makes the allowance run out.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const stubPlanScan: Complete = async ({ user }) => {
  const topic = /"""\n([\s\S]*?)\n"""/.exec(user)?.[1]?.replace(/\s+/g, " ").trim() ?? "the topic";
  const short = topic.slice(0, 60);
  // the search words are the first three words of the topic and one more (a real plan's are short: plan.ts keeps seven words at most, and four that began alike would become one)
  const lead = topic.split(" ").slice(0, 3).join(" ");
  return {
    model: "stub",
    json: {
      items: [
        { title: "Strength of the evidence", question: `How strong is the evidence about ${short}?`, searchQuery: `${lead} evidence` },
        { title: "Factors that matter", question: `Which factors matter most for ${short}?`, searchQuery: `${lead} risk factors` },
        { title: "How it is measured", question: `How is ${short} measured in studies?`, searchQuery: `${lead} measurement methods` },
        { title: "Interventions tried", question: `What interventions have been tried for ${short}?`, searchQuery: `${lead} interventions` },
      ],
    },
  };
};

/**
 * The prompt box's stand-in search, with the sub-question's own words added to every paper (so that the relevance check of relevance.ts finds them about the subject), unless the words say
 * "irrelevant": then the papers are the plain stand-in ones, which are about glaucoma and nothing else.
 */
export const stubScanSearch = (q: string, scope: SearchScope = "all"): SearchResponse => {
  const r = stubSearchFor(q, scope);
  if (/\birrelevant\b/i.test(q)) return r;
  return { ...r, results: r.results.map((p) => (p.retracted ? p : { ...p, title: `${p.title} (${q})`, abstract: p.abstract ? `${p.abstract} This study concerns ${q}.` : p.abstract })) };
};

export const stubScanStream: StreamComplete = async (req, hooks) => {
  const q = /^Question: (.*)$/m.exec(req.user)?.[1] ?? "";
  if (/\bboom\b/i.test(q)) throw new AllProvidersFailedError([{ provider: "stub", model: "stub", ok: false, ms: 1, error: "stub outage" }]);
  if (/\boverquota\b/i.test(q)) throw new QuotaError("daily AI quota reached (stub)");
  if (/\bsnail\b/i.test(q)) await sleep(5000);
  return stubChatStream(req, hooks);
};
