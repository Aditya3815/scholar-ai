import type { SearchResponse, SearchScope } from "@scholar/shared";
import { devOptions } from "../platform/dev";
import type { Deps } from "../platform/deps";
import type { Env } from "../platform/env";
import type { Complete, ModelProfile, Models, StreamComplete } from "../platform/llm/port";
import type { ProfileName } from "../platform/llm/profiles";
import { stubChatStream, stubJudgeStream, stubPapersByDoi, stubSearchFor, stubStrictStream } from "../chat/testing/stub";
import { stubRoute } from "../chat/testing/stub-route";
import { stubVerify } from "../chat/testing/tools-stub";
import { stubChatReply, stubUnderstand } from "../chat/testing/understand";
import { stubComplete, stubStream } from "../docs/testing/stub";
import { hashEmbedder } from "../docs/testing/embed";
import { stubReader } from "../ocr/testing/stub";
import { stubCompareStream, stubIdeaSearch, stubInsightsStream, stubPlan } from "../idea/testing/stub";
import { scanStandIns } from "../litscan/testing/stub";
import { stubFetch } from "../oa/testing/stub";
import { stubCrossrefFetch } from "../library/testing/retraction-stub";
import { runTrendingStandIn } from "../trending/testing/job";

/**
 * The ONLY importer of the features' testing/ folders (docs/design/untangle.md, F7; layers.test.ts and app/production.test.ts hold it): the deps of a test run (QA_STUB=1 with
 * ENABLE_DEV_ROUTES=1, never in production: platform/dev.ts). Every model profile, the embeddings, the page reader and every outside service is a stand-in that is steered by words of
 * its input (each testing/ module says which); the stand-ins of two features that share one (the literature scan reuses the chat's) are put together here.
 */

/** The search the chat and the MCP tools are given. "stalled" in the words keeps it silent for 3.5 s first (to see the keep-alive line and the "still working" hint); with QA_STUB_TOPIC=1 the records say the words that were asked (chat/testing/stub.ts). */
const chatSearch = (env: Pick<Env, "QA_STUB_TOPIC">): Deps["search"] => async (q, o) => {
  if (/\bstalled\b/i.test(q)) await new Promise((r) => setTimeout(r, 3500));
  const found = stubSearchFor(q, o.scope, { topical: env.QA_STUB_TOPIC === "1" });
  if (found.results.length > 0) await o.onSnapshot?.(found);
  return found;
};

/** Every model profile's stand-in. */
function standInModels(scan: ReturnType<typeof scanStandIns>): Models {
  const complete: Record<string, Complete> = { route: stubRoute, understand: stubUnderstand, chatReply: stubChatReply, docsAsk: stubComplete, ideaPlan: stubPlan, litscanPlan: scan.plan };
  const stream: Record<string, () => StreamComplete> = {
    write: () => stubChatStream,
    judge: () => stubJudgeStream(),
    strict: () => stubStrictStream,
    docsAskStream: () => stubStream,
    ideaCompare: () => stubCompareStream,
    ideaInsights: () => stubInsightsStream,
    litscanAnswer: () => scan.stream,
    litscanJudge: () => stubJudgeStream(),
  } satisfies Partial<Record<ProfileName, () => StreamComplete>>;
  const models: Models = {
    complete: (p: ModelProfile<"complete">) => {
      const m = complete[p.name];
      if (!m) throw new Error(`no stand-in for the model profile ${p.name}`);
      return m;
    },
    stream: (p: ModelProfile<"stream">) => {
      const m = stream[p.name];
      if (!m) throw new Error(`no stand-in for the model profile ${p.name}`);
      return m();
    },
    withOverrides: () => models,
  };
  return models;
}

/** The deps of a test run. */
export function standInDeps(env: Env): Deps {
  // the literature scan's stand-ins are the chat's, with words of their own (litscan/testing/stub.ts)
  const scan = scanStandIns({ stream: stubChatStream, search: (q: string, scope: SearchScope): SearchResponse => stubSearchFor(q, scope) });
  return {
    dev: devOptions(env),
    models: standInModels(scan),
    embedder: hashEmbedder,
    pageReader: stubReader,
    search: chatSearch(env),
    scanSearch: (scope) => async (q) => scan.search(q, scope),
    ideaSearch: stubIdeaSearch,
    verifyReference: stubVerify,
    papersByDoi: async (dois) => stubPapersByDoi(dois),
    fetch: { crossref: stubCrossrefFetch, papers: stubFetch },
  };
}

/** The Trending job of a test run: the job's own code over the stand-ins of its sources, on a clock of its own (trending/testing/job.ts). */
export const trendingJobStandIn = runTrendingStandIn;
