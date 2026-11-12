// The MCP tool check_claim (src/chat/claim-check.ts, docs "Sodhsetu understanding, follow-ups and MCP (design)", page 10, tool 5: "Phase 3 ... judge ka naya use, eval ke baad") over the
// hand-labelled claims of the support judge (scripts/fixtures/support-gold.json): each labelled claim is checked ALONE against the papers it cites, as an AI app would send it (the claim and its
// DOIs), with the model's answers RECORDED once from live Workers AI and replayed here, so `npm run eval` (and CI) checks the gate offline:
//   npm run eval                                                  replay (CI): fails if a prompt has no recording (re-record after any change to the strict prompt or to judgeClaim)
//   EVAL_MODE=record npx vitest run -c vitest.eval.config.ts eval/claim.eval.ts --silent=false
//                                                                 record what is missing: live Workers AI through `wrangler`'s own login (no key is read from any file), then replay
//                                                                 (eval/lib/model-layer.ts; the recording is data/claim-recorded.json.gz)
// The gate: no claim a person labelled "no" (not supported) is called supported. Partial verdicts on those claims, and what happens to the claims labelled yes and partial, are printed.
import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { judgeClaim, type ClaimJudgement, type ClaimPaper } from "../src/chat/claim-check";
import { splitClaims } from "../src/chat/support";
import { DEFAULT_CONFIG } from "../src/llm/config";
import { createGateway } from "../src/llm/gateway";
import { workersAiProvider } from "../src/llm/providers/workersai";
import { ModelLayer } from "./lib/model-layer";

const HERE = fileURLToPath(new URL(".", import.meta.url));
/** The model the strict reading uses (the private `qa` chain, as "Check strictly" and check_claim call it). */
const MODEL = DEFAULT_CONFIG.routes.qa!.private[0]!.model;

type Gold = { cases: { id: string; split: string; group: string; papers: { n: number; title: string; year: number | null; abstract: string }[]; text: string; claims: { c: number; label: "yes" | "partial" | "no" | "framing" }[] }[] };
const gold = JSON.parse(readFileSync(HERE + "../scripts/fixtures/support-gold.json", "utf8")) as Gold;

/** One claim as check_claim gets it: its words without marks, and the papers it cited (numbered 1..k in this check, as the DOIs an app sends would be). */
type Item = { id: string; label: "yes" | "partial" | "no"; group: string; claim: string; papers: ClaimPaper[] };
const items: Item[] = gold.cases.flatMap((c) => {
  const claims = splitClaims(c.text);
  return c.claims.flatMap((g): Item[] => {
    const claim = claims[g.c];
    if (!claim || g.label === "framing" || claim.marks.length === 0) return [];
    const cited = claim.marks.map((m) => c.papers.find((p) => p.n === m)).filter((p): p is Gold["cases"][number]["papers"][number] => !!p);
    if (cited.length === 0) return [];
    return [{ id: `${c.id}/c${g.c}`, label: g.label, group: c.group, claim: claim.plain, papers: cited.map((p, i) => ({ n: i + 1, title: p.title, year: p.year, abstract: p.abstract })) }];
  });
});

const layer = new ModelLayer({
  file: HERE + "data/claim-recorded.json.gz",
  layout: { kind: "flat", model: MODEL },
  note: "Live Workers AI through wrangler's remote proxy from a laptop; each claim of scripts/fixtures/support-gold.json alone, against the papers it cites.",
  ask: (ai) => {
    const gateway = createGateway({ providers: { workersai: workersAiProvider(ai) }, ledger: { tokensToday: async () => 0, record: async () => {} }, config: DEFAULT_CONFIG });
    return async (_model, req, hooks) => {
      const r = await gateway.stream({ task: "qa", sensitivity: "private", subject: "eval", system: req.system, user: req.user, schema: req.schema, maxTokens: 4500, timeoutMs: 120_000, label: req.label }, hooks ?? {});
      return { json: r.json };
    };
  },
});
const RECORD = layer.mode === "record";
const judge = layer.session(MODEL);

const results: { item: Item; j: ClaimJudgement }[] = [];

describe("check_claim on the support judge's labelled claims", () => {
  it("checks every labelled claim", { timeout: 2 * 60 * 60 * 1000 }, async () => {
    try {
      const queue = [...items];
      await Promise.all(
        Array.from({ length: RECORD ? 6 : 1 }, async () => {
          for (let item = queue.shift(); item; item = queue.shift()) results.push({ item, j: await judgeClaim({ claim: item.claim, papers: item.papers, judge, label: "eval_check_claim" }) });
        }),
      );
    } finally {
      await layer.close();
    }
    expect(results.length).toBe(items.length);
  });

  it("calls NONE of the claims a person labelled unsupported supported (the gate)", () => {
    const wrong = results.filter((r) => r.item.label === "no" && r.j.verdict === "supported").map((r) => `${r.item.id}: ${r.item.claim}`);
    expect(wrong).toEqual([]);
  });

  it("gives every supported or partly verdict sentences of the abstracts as its evidence", () => {
    for (const r of results.filter((x) => x.j.verdict === "supported" || x.j.verdict === "partly")) {
      expect(r.j.evidence.length, r.item.id).toBeGreaterThan(0);
      for (const e of r.j.evidence) for (const s of e.sentences) expect(r.item.papers.find((p) => p.n === e.n)!.abstract.replace(/\s+/g, " "), r.item.id).toContain(s.replace(/…$/, "").slice(0, 60));
    }
  });

  it("needs no prompt that was not recorded (replay)", () => {
    expect([...layer.missing]).toEqual([]);
  });
});

afterAll(() => {
  const by = (label: Item["label"]) => {
    const rs = results.filter((r) => r.item.label === label);
    const n = (v: string) => rs.filter((r) => r.j.verdict === v).length;
    return `${label} ${rs.length}: supported ${n("supported")}, partly ${n("partly")}, not_supported ${n("not_supported")}, cannot_check ${n("cannot_check")}`;
  };
  const ms = layer.recorded(MODEL).map((c) => c.ms).sort((a, b) => a - b);
  const pct = (p: number) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor((p / 100) * ms.length))] : 0);
  process.stdout.write(`\ncheck_claim (${layer.mode}, ${layer.recordedModel}): ${by("no")}; ${by("partial")}; ${by("yes")}; recorded p50 ${pct(50)} ms, p95 ${pct(95)} ms${layer.missing.size ? `; ${layer.missing.size} without a recording` : ""}\n`);
});
