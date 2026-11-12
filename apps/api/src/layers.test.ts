import { describe, expect, it } from "vitest";
import { violations } from "@scholar/test-support/layers.mjs";

/**
 * The dependency rule of the API (docs/design/untangle.md, 1.5), checked on every import of apps/api/src. Allowed, and nothing else:
 *   - the composition root (index.ts, app/, and today jobs.ts, maintenance.ts, outcomes.ts, which move to app/) imports anything of this package;
 *   - platform (platform/, and today cache/, gate/, llm/, monitoring/ and the loose files of the root that are platform code) imports shared and the
 *     platform modules at its own level or below: env, switches, dev, deps, config <- db, cache, gate, monitoring <- services <- llm <- http;
 *   - a feature (every other folder) imports shared, platform, its own files, and of another feature only its service.ts or a type;
 *   - understand/ imports shared, its own files, platform/llm/port.ts and the types of platform/switches.ts (legal-match.test.ts rule 3 stays the
 *     guard of the network);
 *   - a feature's testing/ folder, and test-d1.ts, are imported only by app/stand-ins.ts and tests;
 *   - nothing imports apps/web, packages/test-support (tests may) or a file of shared by its path (`@scholar/shared/src/...`);
 *   - a test imports and reads its own package, shared and test-support only (never apps/web).
 * ALLOW lists the edges that break it today (from depgraph.txt, 12 Nov 2026). Each wave of the untangle takes edges off it; a new edge fails, and so does
 * an entry that is no longer an edge (take it off). The plan is done when ALLOW is empty.
 */

const ROOT_FILES = new Set(["index.ts", "jobs.ts", "maintenance.ts", "outcomes.ts"]);
/** Platform modules by level: a module imports its own level and those below. */
const LEVEL: Record<string, number> = { env: 0, switches: 0, dev: 0, deps: 0, config: 0, db: 1, cache: 1, gate: 1, monitoring: 1, services: 2, llm: 3, http: 4 };
/** Today's places of platform code, until F5 to F11 move them under platform/. */
const TODAY: Record<string, string> = {
  "cache": "cache",
  "gate": "gate",
  "llm": "llm",
  "monitoring": "monitoring",
  "hash.ts": "db",
  "sql-time.ts": "db",
  "throttle.ts": "gate",
  "s2-throttle.ts": "gate",
  "idempotency.ts": "http",
  "middleware.ts": "http",
  "problem.ts": "http",
  "ratelimit.ts": "http",
  "sse.ts": "http",
};

type Place = { kind: "root" } | { kind: "platform"; module: string } | { kind: "feature"; feature: string; testing: boolean } | { kind: "test-helper" } | { kind: "test" };
const SRC = "apps/api/src/";

function placeOf(path: string): Place {
  const p = path.slice(SRC.length);
  if (/\.test\.ts$/.test(p)) return { kind: "test" };
  if (p === "test-d1.ts") return { kind: "test-helper" };
  if (ROOT_FILES.has(p) || p.startsWith("app/")) return { kind: "root" };
  const [head, second] = p.split("/");
  if (head === "platform") return { kind: "platform", module: (second ?? "").replace(/\.ts$/, "") };
  if (TODAY[head!]) return { kind: "platform", module: TODAY[head!]! };
  return { kind: "feature", feature: head!, testing: second === "testing" };
}

type Edge = { from: string; to: string; spec: string; typeOnly: boolean; kind: string; test: boolean };

function rule(e: Edge): string | null {
  if (e.to.startsWith("apps/web/")) return "the API never imports or reads the page";
  if (e.to.startsWith("packages/test-support/")) return e.test ? null : "test support is for tests";
  if (e.to.startsWith("packages/shared/")) return e.spec.startsWith("@scholar/shared/src/") ? "a file of shared by its path" : null;
  if (!e.to.startsWith(SRC)) return e.test ? null : "outside this package";
  if (e.test) return null; // a test may reach any file of its own package
  const from = placeOf(e.from);
  const to = placeOf(e.to);
  if (to.kind === "test") return "production imports a test";
  if (to.kind === "test-helper" || (to.kind === "feature" && to.testing && !(from.kind === "feature" && from.feature === to.feature && from.testing))) {
    return e.from === SRC + "app/stand-ins.ts" ? null : "stand-ins are imported by app/stand-ins.ts and tests only";
  }
  if (from.kind === "root") return null;
  if (from.kind === "test-helper") return null;
  if (from.kind === "platform") {
    if (to.kind === "root") return "platform imports the composition root";
    if (to.kind === "feature") return "platform imports a feature";
    if (to.kind === "platform" && (LEVEL[to.module] ?? 9) > (LEVEL[from.module] ?? 9)) return `platform/${from.module} imports the higher platform/${to.module}`;
    return null;
  }
  if (from.kind === "feature") {
    if (to.kind === "root") return "a feature imports the composition root";
    if (from.feature === "understand") {
      if (to.kind === "feature" && to.feature === "understand") return null;
      if (to.kind === "platform" && e.to === SRC + "platform/llm/port.ts") return null;
      if (to.kind === "platform" && e.to === SRC + "platform/switches.ts" && e.typeOnly) return null;
      return "understand/ imports only shared, its siblings, platform/llm/port.ts and the types of platform/switches.ts";
    }
    if (to.kind === "platform") return null;
    if (to.kind === "feature") {
      if (to.feature === from.feature) return null;
      if (e.typeOnly) return null;
      if (e.to === `${SRC}${to.feature}/service.ts`) return null;
      return `${from.feature}/ imports ${to.feature}/ past its service.ts`;
    }
  }
  return null;
}

/** Today's edges against the rule. */
const ALLOW: string[] = [
  "api/account/erase.ts -> api/docs/routes.ts",
  "api/account/erase.ts -> api/mcp/apps.ts",
  "api/account/routes.ts -> api/auth/http.ts",
  "api/account/routes.ts -> api/auth/session.ts",
  "api/account/routes.ts -> api/library/validate.ts",
  "api/admin/routes.ts -> api/account/erase.ts",
  "api/admin/routes.ts -> api/auth/http.ts",
  "api/admin/routes.ts -> api/jobs.ts",
  "api/admin/routes.ts -> api/mcp/calls.ts",
  "api/admin/routes.ts -> api/mcp/flag.ts",
  "api/admin/routes.ts -> api/outcomes.ts",
  "api/chat/answer.ts -> api/docs/stream-json.ts",
  "api/chat/general.ts -> api/docs/stream-json.ts",
  "api/chat/routes.ts -> api/auth/http.ts",
  "api/chat/routes.ts -> api/docs/qa.ts",
  "api/chat/routes.ts -> api/docs/routes.ts",
  "api/chat/routes.ts -> api/docs/vector.ts",
  "api/chat/routes.ts -> api/outcomes.ts",
  "api/chat/routes.ts -> api/search/env.ts",
  "api/chat/routes.ts -> api/search/retraction-service.ts",
  "api/chat/routes.ts -> api/understand/chat-reply.ts",
  "api/chat/routes.ts -> api/understand/frame.ts",
  "api/chat/routes.ts -> api/understand/greeting.ts",
  "api/chat/routes.ts -> api/understand/guards.ts",
  "api/chat/routes.ts -> api/understand/input-shape.ts",
  "api/chat/routes.ts -> api/understand/lane-text.ts",
  "api/chat/routes.ts -> api/understand/lane.ts",
  "api/chat/routes.ts -> api/understand/ledger-input.ts",
  "api/chat/routes.ts -> api/understand/reading-check.ts",
  "api/chat/routes.ts -> api/understand/tiers-text.ts",
  "api/chat/routes.ts -> api/understand/tiers.ts",
  "api/chat/routes.ts -> api/understand/understand-counters.ts",
  "api/chat/routes.ts -> api/understand/understand.ts",
  "api/chat/understand-wire.ts -> api/search/cache.ts",
  "api/chat/understand-wire.ts -> api/search/index.ts",
  "api/chat/understand-wire.ts -> api/search/merge.ts",
  "api/chat/understand-wire.ts -> api/search/normalize.ts",
  "api/chat/understand-wire.ts -> api/search/openalex.ts",
  "api/docs/info.ts -> api/references/lookup.ts",
  "api/docs/info.ts -> api/references/match.ts",
  "api/docs/routes.ts -> api/auth/http.ts",
  "api/docs/routes.ts -> api/library/validate.ts",
  "api/docs/routes.ts -> api/ocr/jpeg.ts",
  "api/docs/routes.ts -> api/ocr/process.ts",
  "api/docs/routes.ts -> api/ocr/read.ts",
  "api/docs/routes.ts -> api/ocr/stub.ts",
  "api/docs/routes.ts -> api/outcomes.ts",
  "api/feedback/routes.ts -> api/auth/http.ts",
  "api/feedback/routes.ts -> api/idea/plan.ts",
  "api/idea/compare.ts -> api/docs/qa.ts",
  "api/idea/routes.ts -> api/auth/http.ts",
  "api/idea/routes.ts -> api/docs/embed.ts",
  "api/idea/routes.ts -> api/search/env.ts",
  "api/idea/search.ts -> api/docs/vector.ts",
  "api/idea/search.ts -> api/search/arxiv.ts",
  "api/idea/search.ts -> api/search/core.ts",
  "api/idea/search.ts -> api/search/index.ts",
  "api/idea/search.ts -> api/search/merge.ts",
  "api/idea/search.ts -> api/search/normalize.ts",
  "api/idea/search.ts -> api/search/openalex.ts",
  "api/idea/search.ts -> api/search/pubmed.ts",
  "api/idea/search.ts -> api/search/s2.ts",
  "api/idea/stub.ts -> api/docs/vector.ts",
  "api/legal-match.test.ts -> web/components/legal/LegalPages.tsx",
  "api/legal-text.test.ts -> shared/subfield-policy.ts",
  "api/legal-text.test.ts -> shared/trending.ts",
  "api/legal-text.test.ts -> web/",
  "api/legal-text.test.ts -> web/components/SettingsDialog.tsx",
  "api/legal-text.test.ts -> web/components/legal/LegalPages.tsx",
  "api/legal-text.test.ts -> web/workspace/HomePage.tsx",
  "api/library/retraction.ts -> api/references/crossref-gate.ts",
  "api/library/retraction.ts -> api/search/retraction.ts",
  "api/library/routes.ts -> api/auth/http.ts",
  "api/litscan/model.ts -> api/chat/stub.ts",
  "api/litscan/model.ts -> api/search/env.ts",
  "api/litscan/model.ts -> api/search/index.ts",
  "api/litscan/plan.ts -> api/idea/plan.ts",
  "api/litscan/routes.ts -> api/auth/http.ts",
  "api/litscan/routes.ts -> api/library/validate.ts",
  "api/litscan/share.ts -> api/library/validate.ts",
  "api/litscan/store.ts -> api/library/validate.ts",
  "api/litscan/stub.ts -> api/chat/stub.ts",
  "api/litscan/worker.ts -> api/chat/answer.ts",
  "api/litscan/workflow.ts -> api/outcomes.ts",
  "api/mcp/apps.ts -> api/auth/http.ts",
  "api/mcp/oauth.ts -> api/auth/http.ts",
  "api/mcp/oauth.ts -> api/auth/oauth.ts",
  "api/mcp/oauth.ts -> api/auth/providers.ts",
  "api/mcp/server.ts -> api/chat/claim-check.ts",
  "api/mcp/server.ts -> api/chat/stub.ts",
  "api/mcp/server.ts -> api/docs/routes.ts",
  "api/mcp/server.ts -> api/library/validate.ts",
  "api/mcp/server.ts -> api/search/retraction-service.ts",
  "api/mcp/tools.ts -> api/chat/claim-check.ts",
  "api/mcp/tools.ts -> api/references/match.ts",
  "api/mcp/tools.ts -> api/search/index.ts",
  "api/mcp/tools.ts -> api/search/normalize.ts",
  "api/monitoring/routes.ts -> api/auth/http.ts",
  "api/oa/chunks.ts -> api/docs/chunk.ts",
  "api/oa/routes.ts -> api/auth/http.ts",
  "api/oa/routes.ts -> api/docs/routes.ts",
  "api/oa/service.ts -> api/docs/qa.ts",
  "api/oa/service.ts -> api/docs/routes.ts",
  "api/oa/service.ts -> api/outcomes.ts",
  "api/oa/service.ts -> api/search/retraction-service.ts",
  "api/oa/sources.ts -> api/search/normalize.ts",
  "api/oa/store.ts -> api/docs/vector.ts",
  "api/oa/workflow.ts -> api/docs/embed.ts",
  "api/ocr/process.ts -> api/docs/chunk.ts",
  "api/ocr/process.ts -> api/docs/vector.ts",
  "api/outcome-labels.test.ts -> web/components/admin/AdminOps.tsx",
  "api/references/lookup.ts -> api/search/cache.ts",
  "api/references/routes.ts -> api/auth/http.ts",
  "api/references/service.ts -> api/search/cache.ts",
  "api/references/verify.ts -> api/search/retraction.ts",
  "api/search/crossref.ts -> api/references/crossref-gate.ts",
  "api/search/doi-check.ts -> api/references/crossref-gate.ts",
  "api/search/doi-check.ts -> api/references/lookup.ts",
  "api/search/doi-check.ts -> api/references/match.ts",
  "api/search/plain-text.test.ts -> web/lib/",
  "api/search/retraction-service.ts -> api/library/retraction-stub.ts",
  "api/search/retraction.ts -> api/references/crossref-gate.ts",
  "api/trending/arxiv.ts -> shared/trending.ts",
  "api/trending/contract.test.ts -> shared/trending-client.ts",
  "api/trending/contract.test.ts -> shared/trending.ts",
  "api/trending/job.test.ts -> shared/trending.ts",
  "api/trending/job.ts -> api/search/env.ts",
  "api/trending/job.ts -> api/search/index.ts",
  "api/trending/job.ts -> shared/subfield-policy.ts",
  "api/trending/job.ts -> shared/trending.ts",
  "api/trending/openalex.test.ts -> shared/trending.ts",
  "api/trending/openalex.ts -> shared/trending.ts",
  "api/trending/pipeline.test.ts -> shared/trending.ts",
  "api/trending/policy.test.ts -> shared/subfield-policy.ts",
  "api/trending/rank.test.ts -> shared/subfield-policy.ts",
  "api/trending/rank.test.ts -> shared/trending.ts",
  "api/trending/routes.test.ts -> apps/web/public/sw.js",
  "api/trending/routes.ts -> shared/trending.ts",
  "api/trending/scan.test.ts -> shared/trending.ts",
  "api/trending/scan.ts -> shared/subfield-policy.ts",
  "api/trending/scan.ts -> shared/trending.ts",
  "api/trending/select.test.ts -> shared/subfield-policy.ts",
  "api/trending/select.test.ts -> shared/trending.ts",
  "api/trending/stub.ts -> shared/trending.ts",
  "api/trending/text.test.ts -> shared/trending.ts",
  "api/trending/verify.test.ts -> shared/trending.ts",
  "api/understand/chat-reply.ts -> api/docs/qa.ts",
  "api/understand/tiers.ts -> api/litscan/relevance.ts",
  "api/understand/understand.ts -> api/docs/qa.ts",
];

describe("the API's dependency rule (docs/design/untangle.md, 1.5)", () => {
  const found = violations("apps/api/src", rule);

  it("finds the imports (the parser read the files)", () => {
    expect(found.files).toBeGreaterThan(300);
    expect(found.edges).toBeGreaterThan(1000);
  });

  it("has no edge against the rule that is not on the allowlist, and no allowlist entry that is no longer an edge", () => {
    const allow = new Set(ALLOW);
    const fresh = found.lines.filter((l: string) => !allow.has(l)).map((l: string) => found.reasons.get(l));
    const gone = ALLOW.filter((l) => !found.lines.includes(l));
    expect(fresh, "new edges against the rule: change the import, or the plan").toEqual([]);
    expect(gone, "edges that are gone: take them off ALLOW").toEqual([]);
  });
});
