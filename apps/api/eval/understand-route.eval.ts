// The multi-turn set of the Understand eval (docs/eval/understand/multi.json) run through the WIRED chat route (M5): POST /api/v1/chat with CHAT_UNDERSTAND=on, the turn's gold ledger sent the way the page
// sends it, and the step's model answered from the same recording understand.eval.ts replays (data/understand-recorded.json.gz, the shipped model). What is scored is what the route DID (the intent of the
// `understood` event, or for the rules' fallback what the reply shows it did), not what the module returned: the gate is the design's 90% of turns right, and a New topic never leaks.
// The papers a turn asks about are given back as they are named (the trust rule, that a paper is only used after it is looked up again by DOI, is tested in src/chat/understand-route.test.ts).
//   npm run eval
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import type { ChatEvent, Paper } from "@scholar/shared";
import type { Complete } from "../src/docs/qa";
import { UNDERSTAND_CHAIN } from "../src/llm/config";
import { UNDERSTAND_TIMEOUT_MS } from "../src/understand/understand";
import type { LedgerPaper } from "../src/understand/ledger-input";
import { agreedLabel, intentOk, type MultiChat } from "./lib/understand-score";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const RECORDING = HERE + "data/understand-recorded.json.gz";
type Call = { ok: boolean; json?: unknown; error?: string; ms: number };
const recording = existsSync(RECORDING) ? (JSON.parse(gunzipSync(readFileSync(RECORDING)).toString("utf8")) as { calls: Record<string, Record<string, Call[]>> }) : { calls: {} };
const SHIPPED = UNDERSTAND_CHAIN[0]!.model;
const keyOf = (system: string, user: string) => createHash("sha256").update(system).update("\u0000").update(user).digest("hex").slice(0, 24);

/** Calls of the current turn per prompt (a retry is the second recorded call of the same prompt). */
const used = vi.hoisted(() => new Map<string, number>());
const missing = vi.hoisted(() => [] as string[]);

vi.mock("../src/chat/understand-wire", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/chat/understand-wire")>();
  const replay: Complete = async (req) => {
    const key = keyOf(req.system, req.user);
    const i = used.get(key) ?? 0;
    used.set(key, i + 1);
    const call = recording.calls[SHIPPED]?.[key]?.[i];
    if (!call) {
      missing.push(key);
      throw new Error("no recording");
    }
    if (call.ms > UNDERSTAND_TIMEOUT_MS && req.label === "chat_understand") throw new Error("understand timeout (recorded)");
    if (!call.ok) {
      const err = new Error(call.error ?? "failed");
      if (/AllProvidersFailedError/.test(call.error ?? "")) err.name = "AllProvidersFailedError";
      throw err;
    }
    return { json: call.json, model: SHIPPED };
  };
  // a paper named by the ledger, as a record (title and year as the ledger has them): the scoring is of the decision, not of the lookup
  const asPaper = (p: LedgerPaper, i: number): Paper => ({ id: p.id ?? `doi:${p.doi ?? `10.5555/eval.${i}`}`, doi: p.doi ?? `10.5555/eval.${i}`, pmid: null, title: p.title, authors: p.first_author ? [p.first_author] : [], year: p.year, venue: null, abstract: "An abstract that is long enough to be read by the writer of the answer in this evaluation.", citationCount: null, oaUrl: null, retracted: false, retractionSources: [], sources: ["openalex"], score: 1 }) as Paper;
  return { ...real, stubUnderstand: replay, resolveLedgerPapers: async (_env: unknown, refs: readonly LedgerPaper[]) => refs.map(asPaper) };
});

import { chatRoutes } from "../src/chat/routes";

const TOKEN = "t".repeat(40);
const sessionRow = { id: "user-1", name: "Test", email: "t@example.org", orcid: null, avatar_url: null, role: "scholar", privacy_ack: null, stale: 0, providers: "google" };
const db = {
  prepare(sql: string) {
    return { bind: () => ({ first: async () => (/FROM sessions/.test(sql) ? sessionRow : /SUM\(tokens_in/.test(sql) ? { t: 0 } : null), run: async () => ({}), all: async () => ({ results: [] }) }) };
  },
  async batch(s: unknown[]) {
    return s.map(() => ({}));
  },
};
const eventsOf = (text: string): ChatEvent[] =>
  text.split("\n\n").flatMap((b) => {
    const data = b.split("\n").find((l) => l.startsWith("data:"));
    return data ? [JSON.parse(data.slice(5)) as ChatEvent] : [];
  });

/** What the route did with a message, as an intent of the step's list. */
function actOf(ev: ChatEvent[]): string {
  const u = ev.find((e) => e.type === "understood") as Extract<ChatEvent, { type: "understood" }> | undefined;
  const done = ev.at(-1) as Extract<ChatEvent, { type: "done" }> | undefined;
  if (u?.intent) return u.intent;
  if (done?.reason === "small_talk") return "chat";
  if (done?.reason === "routed") return u?.mode === "paper" ? "ask_paper" : "offer_tool";
  return "search";
}

const multi = (JSON.parse(readFileSync(HERE + "../../../docs/eval/understand/multi.json", "utf8")) as { chats: MultiChat[] }).chats;

describe("the multi-turn set through the wired chat route (CHAT_UNDERSTAND=on, recorded model)", () => {
  it.runIf(Object.keys(recording.calls[SHIPPED] ?? {}).length > 0)("90% of turns are acted on rightly, and nothing of a topic leaks after New topic", async () => {
    let n = 0;
    let right = 0;
    const wrong: string[] = [];
    for (const chat of multi) {
      let start = 0;
      for (let k = 0; k < chat.turns.length; k++) {
        const t = chat.turns[k]!;
        if (t.labeller_1.newTopicBefore) start = k;
        const label = agreedLabel(t.labeller_1, t.labeller_2);
        if (!label) continue;
        n++;
        used.clear();
        const ledger = chat.turns.slice(start, k).map((x) => x.ledger).filter(Boolean);
        const res = await chatRoutes.request("http://localhost/", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", cookie: `sid=${TOKEN}` }, body: JSON.stringify({ mode: "auto", message: t.user, ...(ledger.length ? { ledger } : {}) }) }, { DB: db, ENABLE_DEV_ROUTES: "1", QA_STUB: "1", CROSSREF_MAILTO: "t@example.org", CHAT_UNDERSTAND: "on" });
        const text = await res.text();
        expect(res.status, `${chat.id}#${t.turn}: ${text.slice(0, 200)}`).toBe(200);
        const ev = eventsOf(text);
        const act = actOf(ev);
        const ok = intentOk(label, act as never);
        if (ok) right++;
        else wrong.push(`${chat.id}#${t.turn} want ${label.intent} got ${act}: ${t.user.slice(0, 50)}`);
        // after New topic, no word of the earlier topic is in what was searched or what the writer was asked about
        if (label.newTopicBefore && label.leakWords?.length) {
          const u = ev.find((e) => e.type === "understood") as Extract<ChatEvent, { type: "understood" }> | undefined;
          const said = [u?.searchQuery ?? "", u?.context?.question ?? ""].join(" ").toLowerCase();
          for (const w of label.leakWords) expect(new RegExp(`\\b${w.toLowerCase()}`).test(said), `${chat.id}#${t.turn} leaks "${w}"`).toBe(false);
        }
      }
    }
    console.log(`route multi-turn: ${right}/${n} (${((right / n) * 100).toFixed(1)}%); missing recordings ${missing.length}`);
    for (const w of wrong) console.log(`  ${w}`);
    expect(missing).toEqual([]);
    expect(right / n).toBeGreaterThanOrEqual(0.9);
  }, 300_000);
});
