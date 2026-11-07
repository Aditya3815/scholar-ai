// The MCP tool check_claim (src/chat/claim-check.ts, docs "Sodhsetu understanding, follow-ups and MCP (design)", page 10, tool 5: "Phase 3 ... judge ka naya use, eval ke baad") over the
// hand-labelled claims of the support judge (scripts/fixtures/support-gold.json): each labelled claim is checked ALONE against the papers it cites, as an AI app would send it (the claim and its
// DOIs), with the model's answers RECORDED once from live Workers AI and replayed here, so `npm run eval` (and CI) checks the gate offline:
//   npm run eval                                                  replay (CI): fails if a prompt has no recording (re-record after any change to the strict prompt or to judgeClaim)
//   CLAIM_EVAL=record npx vitest run -c vitest.eval.config.ts eval/claim.eval.ts --silent=false
//                                                                 record: live Workers AI through `wrangler`'s own login (no key is read from any file), then replay
// The gate: no claim a person labelled "no" (not supported) is called supported. Partial verdicts on those claims, and what happens to the claims labelled yes and partial, are printed.
import { afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import type { StreamComplete } from "../src/docs/qa";
import { judgeClaim, type ClaimJudgement, type ClaimPaper } from "../src/chat/claim-check";
import { splitClaims } from "../src/chat/support";
import { DEFAULT_CONFIG } from "../src/llm/config";
import { createGateway } from "../src/llm/gateway";
import { workersAiProvider } from "../src/llm/providers/workersai";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const RECORDING = HERE + "data/claim-recorded.json.gz";
const RECORD = process.env.CLAIM_EVAL === "record";
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

type Call = { ok: boolean; json?: unknown; error?: string; ms: number };
type Recording = { version: 1; recordedAt: string; model: string; note: string; calls: Record<string, Call> };
const recording: Recording = existsSync(RECORDING) ? (JSON.parse(gunzipSync(readFileSync(RECORDING)).toString("utf8")) as Recording) : { version: 1, recordedAt: "", model: MODEL, note: "", calls: {} };
const keyOf = (system: string, user: string) => createHash("sha256").update(`${MODEL}\n${system}\n${user}`).digest("hex").slice(0, 32);

let live: StreamComplete | null = null;
let dispose: (() => Promise<void>) | null = null;
async function startLive() {
  // a config of its own with the AI binding only: nothing of the app is started, and wrangler's own login is used
  const dir = mkdtempSync(join(tmpdir(), "claim-record-"));
  const config = join(dir, "wrangler.jsonc");
  writeFileSync(config, JSON.stringify({ name: "claim-record", compatibility_date: "2026-10-01", ai: { binding: "AI", remote: true } }));
  const { getPlatformProxy } = await import("wrangler");
  const proxy = await getPlatformProxy<{ AI: Ai }>({ configPath: config });
  dispose = () => proxy.dispose();
  const gateway = createGateway({ providers: { workersai: workersAiProvider(proxy.env.AI) }, ledger: { tokensToday: async () => 0, record: async () => {} }, config: DEFAULT_CONFIG });
  live = async (req, hooks) => {
    const r = await gateway.stream({ task: "qa", sensitivity: "private", subject: "eval", system: req.system, user: req.user, schema: req.schema, maxTokens: 4500, timeoutMs: 120_000, label: req.label }, hooks);
    return { json: r.json, model: r.model };
  };
}

const missing: string[] = [];
const judge: StreamComplete = async (req, hooks) => {
  const key = keyOf(req.system, req.user);
  let call = recording.calls[key];
  if (!call && RECORD && live) {
    const t0 = Date.now();
    try {
      const r = await live(req, hooks);
      call = { ok: true, json: r.json, ms: Date.now() - t0 };
    } catch (e) {
      // the error's class and a short reason only: never the prompt
      call = { ok: false, error: e instanceof Error ? `${e.name}: ${e.message}`.replace(/\s+/g, " ").slice(0, 160) : "error", ms: Date.now() - t0 };
    }
    recording.calls[key] = call;
  }
  if (!call) {
    missing.push(key);
    throw new Error("no recording");
  }
  if (!call.ok) throw new Error(call.error ?? "failed");
  return { json: call.json, model: MODEL };
};

const results: { item: Item; j: ClaimJudgement }[] = [];

describe("check_claim on the support judge's labelled claims", () => {
  it("checks every labelled claim", { timeout: 2 * 60 * 60 * 1000 }, async () => {
    if (RECORD) await startLive();
    try {
      const queue = [...items];
      await Promise.all(
        Array.from({ length: RECORD ? 6 : 1 }, async () => {
          for (let item = queue.shift(); item; item = queue.shift()) results.push({ item, j: await judgeClaim({ claim: item.claim, papers: item.papers, judge, label: "eval_check_claim" }) });
        }),
      );
    } finally {
      if (RECORD) {
        recording.recordedAt = new Date().toISOString();
        recording.model = MODEL;
        recording.note = "Live Workers AI through wrangler's remote proxy from a laptop; each claim of scripts/fixtures/support-gold.json alone, against the papers it cites.";
        writeFileSync(RECORDING, gzipSync(JSON.stringify(recording)));
        await dispose?.();
      }
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
    if (!RECORD) expect(missing).toEqual([]);
  });
});

afterAll(() => {
  const by = (label: Item["label"]) => {
    const rs = results.filter((r) => r.item.label === label);
    const n = (v: string) => rs.filter((r) => r.j.verdict === v).length;
    return `${label} ${rs.length}: supported ${n("supported")}, partly ${n("partly")}, not_supported ${n("not_supported")}, cannot_check ${n("cannot_check")}`;
  };
  const ms = Object.values(recording.calls).map((c) => c.ms).sort((a, b) => a - b);
  const pct = (p: number) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor((p / 100) * ms.length))] : 0);
  process.stdout.write(`\ncheck_claim (${RECORD ? "record" : "replay"}, ${recording.model}): ${by("no")}; ${by("partial")}; ${by("yes")}; recorded p50 ${pct(50)} ms, p95 ${pct(95)} ms${missing.length ? `; ${missing.length} without a recording` : ""}\n`);
});
