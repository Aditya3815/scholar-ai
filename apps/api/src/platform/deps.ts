import type { Context } from "hono";
import type { IdeaSearchEvent, IdeaSearchRequest, IdeaSearchResult, Paper, RefVerdict, SearchResponse, SearchScope, SearchSnapshot } from "@scholar/shared";
import type { DevOptions } from "./dev";
import type { Embedder, Models, PageReader } from "./llm/port";

/**
 * What a feature takes from outside itself, built once per entry (a request, a scheduled run, a Workflow step) at the composition root (app/deps.ts: docs/design/untangle.md, F7). Outside a
 * test run every field is the real thing; in a test run (platform/dev.ts, standIns) app/stand-ins.ts builds the same fields from the stand-ins of each feature's testing/ folder. A feature never
 * decides which: it calls what it is given, and no module of a feature imports a stand-in.
 */
export type Deps = {
  /** What development mode may change (platform/dev.ts); in production, nothing. */
  dev: DevOptions;
  /** Every model use, by profile (platform/llm/profiles.ts): modelFor(deps, profile, subject). */
  models: Models;
  /** The embeddings model; null when the Worker has no AI binding (a feature that needs it says it is unavailable). */
  embedder: Embedder | null;
  /** The two models that read a scanned page; null without the AI binding. */
  pageReader: PageReader | null;
  /** The literature search as the chat and the MCP tools ask it (search/service.ts). `onSnapshot` sees the list grow as each source answers. */
  search: (q: string, o: { limit: number; scope: SearchScope; onSnapshot?: (s: SearchSnapshot) => void | Promise<void> }) => Promise<SearchResponse>;
  /** The search of one sub-question of a literature scan (litscan/model.ts: its lane and its log line). */
  scanSearch: (scope: SearchScope) => (query: string) => Promise<SearchResponse>;
  /** Idea Check's search of an approved plan (idea/search.ts), telling `emit` its stages. */
  ideaSearch: (req: IdeaSearchRequest, emit: (e: IdeaSearchEvent) => void | Promise<void>) => Promise<IdeaSearchResult>;
  /** One reference checked (references/service.ts), for the chat's tool. */
  verifyReference: (text: string) => Promise<RefVerdict>;
  /** The papers of these DOIs as they really are (looked up again, the DOI and retraction checks made), in the order given; one that is not found is left out. */
  papersByDoi: (dois: string[]) => Promise<Paper[]>;
  /** The network of the services that take one: the Worker's own fetch when not set. `crossref`: Crossref's retraction data; `papers`: the readers of open-access papers. */
  fetch: { crossref?: typeof fetch; papers?: typeof fetch };
};

declare module "hono" {
  interface ContextVariableMap {
    /** Set for every /api request by the composition root (app/deps.ts). */
    deps: Deps;
  }
}

/** The request's deps. A router reached without the composition root in front of it (a test that forgot it) fails loudly instead of running on something it did not choose. */
export function depsOf(c: Context): Deps {
  const d = c.get("deps") as Deps | undefined;
  if (!d) throw new Error("no deps on this request: mount the router through the composition root (app/deps.ts withDeps)");
  return d;
}
