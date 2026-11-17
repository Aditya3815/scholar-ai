import { Hono, type MiddlewareHandler } from "hono";
import { devOptions, standIns } from "../platform/dev";
import type { Deps } from "../platform/deps";
import type { Env, HonoEnv } from "../platform/env";
import { gatewayModels } from "../platform/llm/models";
import { workersAiEmbedder } from "../docs/embed";
import { workersAiReader } from "../ocr/read";
import { searchService } from "../search/service";
import { searchEnvFrom } from "../search/env";
import { searchFor } from "../litscan/model";
import { runIdeaSearch } from "../idea/search";
import { referenceService } from "../references/service";
import { ledgerPapersByDoi } from "../chat/understand-wire";
import { runTrendingFromEnv } from "../trending/job";
import { standInDeps, trendingJobStandIn } from "./stand-ins";

/**
 * The deps of one entry (a request, a scheduled run, a Workflow step), decided here and nowhere else (docs/design/untangle.md, F7): the real services, the gateway's models, the Workers AI
 * embeddings and page reader; or, in a test run (platform/dev.ts standIns), the stand-ins (app/stand-ins.ts). Building them makes no call: each piece is made when it is first used.
 */
export function depsFor(env: Env): Deps {
  if (standIns(env)) return standInDeps(env);
  const embedder = env.AI ? workersAiEmbedder(env.AI) : null;
  return {
    dev: devOptions(env),
    models: gatewayModels(env),
    embedder,
    pageReader: env.AI ? workersAiReader(env.AI) : null,
    search: (q, o) => (o.onSnapshot ? searchService.run(env, { q, limit: o.limit, scope: o.scope }, { onSnapshot: o.onSnapshot }) : searchService.run(env, { q, limit: o.limit, scope: o.scope })),
    scanSearch: (scope) => searchFor(env, scope),
    ideaSearch: (req, emit) => runIdeaSearch({ env: searchEnvFrom(env), embed: embedder, req, emit }),
    verifyReference: async (text) => (await referenceService.verify(env, text)).result,
    papersByDoi: (dois) => ledgerPapersByDoi(searchEnvFrom(env), dois),
    fetch: {},
  };
}

/** Puts the request's deps on its context (for every /api request: index.ts mounts it in front of the routers). */
export const withRequestDeps: MiddlewareHandler<HonoEnv> = async (c, next) => {
  c.set("deps", depsFor(c.env));
  await next();
};

/** A router with the deps in front of it, as the Worker mounts it: for a test that calls one router alone. */
export const withDeps = (routes: Hono<HonoEnv>): Hono<HonoEnv> => new Hono<HonoEnv>().use("*", withRequestDeps).route("/", routes);

/** The Trending job of the scheduled run: the real one, or in a test run the job's code over its stand-in sources. */
export const trendingJobFor = (env: Env): typeof runTrendingFromEnv => (standIns(env) ? trendingJobStandIn : runTrendingFromEnv);
