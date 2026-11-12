import { describe, expect, it } from "vitest";
import { violations } from "@scholar/test-support/layers.mjs";

/**
 * The dependency rule of shared (docs/design/untangle.md, 1.2 and 1.5), checked on every import of packages/shared/src. Allowed, and nothing else:
 *   - text.ts, ids.ts and vocab/ import nothing;
 *   - protocol/ imports text, ids, vocab and the types of protocol/;
 *   - every other module imports text, ids, vocab and the types of protocol/;
 *   - index.ts is a barrel that imports everything, and nothing inside shared imports it;
 *   - nothing imports apps/ or packages/test-support (tests may);
 *   - a test imports and reads shared and test-support only (never an app).
 * Today only text.ts is in its place (ids.ts, vocab/ and protocol/ come with F2 to F4), so every other module counts as "other" until it moves.
 * ALLOW lists the edges that break the rule today (12 Nov 2026). Each wave of the untangle takes edges off it; a new edge fails, and so does an entry that
 * is no longer an edge (take it off). The plan is done when ALLOW is empty.
 */

type Place = "base" | "protocol" | "barrel" | "other" | "test";
const SRC = "packages/shared/src/";

function placeOf(path: string): Place {
  const p = path.slice(SRC.length);
  if (/\.test\.ts$/.test(p)) return "test";
  if (p === "index.ts") return "barrel";
  if (p === "text.ts" || p === "ids.ts" || p.startsWith("vocab/")) return "base";
  if (p.startsWith("protocol/")) return "protocol";
  return "other";
}

type Edge = { from: string; to: string; spec: string; typeOnly: boolean; kind: string; test: boolean };

function rule(e: Edge): string | null {
  if (e.to.startsWith("apps/")) return "shared never imports or reads an app";
  if (e.to.startsWith("packages/test-support/")) return e.test ? null : "test support is for tests";
  if (!e.to.startsWith(SRC)) return e.test ? null : "outside this package";
  if (e.test) return null; // a test may reach any file of its own package
  const from = placeOf(e.from);
  const to = placeOf(e.to);
  if (to === "test") return "production imports a test";
  if (from === "barrel") return null;
  if (to === "barrel") return "a module of shared imports index.ts";
  if (from === "base") return "text, ids and vocab import nothing";
  if (to === "base") return null;
  if (to === "protocol" && e.typeOnly) return null;
  return from === "protocol" ? "protocol/ imports only text, ids, vocab and protocol types" : "a module imports only text, ids, vocab and protocol types";
}

/** Today's edges against the rule. */
const ALLOW: string[] = [
  "shared/chat-context.ts -> shared/route.ts",
  "shared/chat-copy.ts -> shared/chat-state.ts",
  "shared/chat-copy.ts -> shared/chat.ts",
  "shared/chat-copy.ts -> shared/index.ts",
  "shared/chat-copy.ts -> shared/litscan-review.ts",
  "shared/chat-memory.ts -> shared/chat-state.ts",
  "shared/chat-state.ts -> shared/chat-context.ts",
  "shared/chat-state.ts -> shared/chat-tools.ts",
  "shared/chat-state.ts -> shared/chat.ts",
  "shared/chat-state.ts -> shared/index.ts",
  "shared/chat-state.ts -> shared/reading.ts",
  "shared/chat-state.ts -> shared/route.ts",
  "shared/chat-state.ts -> shared/sentences.ts",
  "shared/chat-state.ts -> shared/think.ts",
  "shared/chat-tools.ts -> shared/documents.ts",
  "shared/chat-tools.ts -> shared/oa.ts",
  "shared/chat-tools.ts -> shared/references.ts",
  "shared/chat.ts -> shared/chat-context.ts",
  "shared/chat.ts -> shared/chat-tools.ts",
  "shared/chat.ts -> shared/index.ts",
  "shared/chat.ts -> shared/reading.ts",
  "shared/chat.ts -> shared/route.ts",
  "shared/chat.ts -> shared/think.ts",
  "shared/citations.ts -> shared/paperinfo.ts",
  "shared/feedback.ts -> shared/jobs.ts",
  "shared/idea-m3.ts -> shared/idea.ts",
  "shared/idea.ts -> shared/index.ts",
  "shared/ledger.ts -> shared/chat-state.ts",
  "shared/litscan-docx.ts -> shared/docx.ts",
  "shared/litscan-docx.ts -> shared/litscan-review.ts",
  "shared/litscan-docx.ts -> shared/litscan.ts",
  "shared/litscan-review.ts -> shared/litscan.ts",
  "shared/litscan.ts -> shared/chat.ts",
  "shared/litscan.ts -> shared/index.ts",
  "shared/litscan.ts -> shared/route.ts",
  "shared/notes-md.ts -> shared/documents.ts",
  "shared/oa.ts -> shared/documents.ts",
  "shared/oa.ts -> shared/index.ts",
  "shared/paperinfo.ts -> shared/references.ts",
  "shared/reading.ts -> shared/chat-context.ts",
  "shared/rive.ts -> shared/litscan.ts",
  "shared/route.ts -> shared/chat.ts",
  "shared/route.ts -> shared/references.ts",
  "shared/scan-info.ts -> shared/documents.ts",
  "shared/scan-info.ts -> shared/paperinfo.ts",
  "shared/stream-shape.ts -> shared/chat.ts",
  "shared/stream-shape.ts -> shared/idea.ts",
  "shared/stream-shape.ts -> shared/litscan.ts",
  "shared/stream-shape.ts -> shared/oa.ts",
  "shared/trending-row.ts -> shared/chat-state.ts",
  "shared/trending-row.ts -> shared/trending-client.ts",
  "shared/trending.ts -> shared/chat.ts",
  "shared/trending.ts -> shared/route.ts",
  "shared/trending.ts -> shared/subfield-policy.ts",
  "shared/trending.ts -> shared/trending-client.ts",
];

describe("shared's dependency rule (docs/design/untangle.md, 1.2 and 1.5)", () => {
  const found = violations("packages/shared/src", rule);

  it("finds the imports (the parser read the files)", () => {
    expect(found.files).toBeGreaterThan(40);
    expect(found.edges).toBeGreaterThan(100);
  });

  it("has no edge against the rule that is not on the allowlist, and no allowlist entry that is no longer an edge", () => {
    const allow = new Set(ALLOW);
    const fresh = found.lines.filter((l) => !allow.has(l)).map((l) => found.reasons.get(l));
    const gone = ALLOW.filter((l) => !found.lines.includes(l));
    expect(fresh, "new edges against the rule: change the import, or the plan").toEqual([]);
    expect(gone, "edges that are gone: take them off ALLOW").toEqual([]);
  });
});
