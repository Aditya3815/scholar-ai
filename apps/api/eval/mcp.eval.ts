// The MCP server's verify_references (src/mcp) over the reference eval's own data (docs "Sodhsetu understanding, follow-ups and MCP (design)", page 14: "MCP verify_references: 70 fabricated + 70
// real; fabricated verified 0"). The calls go through the real MCP protocol (JSON-RPC to the same handler the Worker serves) and the real service, with the recorded API answers of eval.eval.ts:
//   npm run eval -w apps/api            replay (CI: deterministic, offline, free)
// The 70 fabricated references are fake_refs.json (30) and heldout_fakes.json (40); the 70 real ones are the first 70 of papers.json, formatted exactly as eval.eval.ts formats them (same index, so
// the same recorded requests answer them).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { testD1 } from "../src/test-d1";
import { buildServer, type McpEnv } from "../src/mcp/server";
import { FetchLayer, type Mode } from "./lib/fetch-layer";
// @ts-expect-error plain .mjs shared with the build scripts
import { formatRef } from "./lib/text.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const MODE = (process.env.EVAL_MODE ?? "replay") as Mode;
const read = <T>(f: string) => JSON.parse(readFileSync(HERE + "data/" + f, "utf8")) as T;
type Fake = { id: string; kind: string; expect: string[]; text: string };
type Paper = { doi: string; title: string; year: number; authors: { given: string; family: string }[]; venue: string | null };

const fakes = [...read<Fake[]>("fake_refs.json"), ...read<Fake[]>("heldout_fakes.json")];
const real = read<Paper[]>("papers.json").slice(0, 70).map((p, i) => ({ doi: p.doi.toLowerCase(), text: formatRef(p, i) as string }));

const layer = new FetchLayer(MODE, HERE + "fixtures.json.gz");
const env = {
  DB: testD1().db,
  OPENALEX_API_KEY: process.env.OPENALEX_API_KEY ?? "eval",
  CROSSREF_MAILTO: process.env.CROSSREF_MAILTO ?? "eval@example.org",
} as unknown as McpEnv;
const handler = createMcpHandler(() => buildServer({ env, userId: "eval", client: "eval", base: "https://sodhsetu.in", defer: () => {} }), { responseMode: "json" });

type Item = { n: number; verdict: string; doi: string | null; reason: string };
async function verify(references: string[]): Promise<Item[]> {
  const res = await handler.fetch(
    new Request("https://sodhsetu.in/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "verify_references", arguments: { references } } }),
    }),
    { authInfo: { token: "eval", clientId: "eval", scopes: ["papers:read", "references:verify"] } },
  );
  const text = await res.text();
  const data = text.startsWith("{") ? text : text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
  const body = JSON.parse(data) as { result?: { isError?: boolean; structuredContent?: { items: Item[] } } };
  if (!body.result?.structuredContent) throw new Error(`verify_references failed: ${data.slice(0, 300)}`);
  return body.result.structuredContent.items;
}

const out = { fakes: [] as Item[], real: [] as Item[] };

beforeAll(async () => {
  layer.install();
  // two calls of at most 60 each, as an AI app would send a long list
  for (let i = 0; i < fakes.length; i += 35) out.fakes.push(...(await verify(fakes.slice(i, i + 35).map((f) => f.text))));
  for (let i = 0; i < real.length; i += 35) out.real.push(...(await verify(real.slice(i, i + 35).map((r) => r.text))));
}, 60 * 60 * 1000);

afterAll(() => {
  layer.uninstall();
  const count = (items: Item[]) => items.reduce<Record<string, number>>((m, i) => ((m[i.verdict] = (m[i.verdict] ?? 0) + 1), m), {});
  process.stdout.write(`\nMCP verify_references (${MODE}): fabricated ${JSON.stringify(count(out.fakes))} of ${fakes.length}; real ${JSON.stringify(count(out.real))} of ${real.length}; ${layer.calls} HTTP calls${layer.missing.length ? `, ${layer.missing.length} without a recording` : ""}\n`);
});

describe("MCP verify_references on the reference eval", () => {
  it("answers every reference, in order", () => {
    expect(out.fakes.length).toBe(70);
    expect(out.real.length).toBe(70);
    expect(out.fakes.map((i) => i.n)).toEqual([...Array.from({ length: 35 }, (_, k) => k + 1), ...Array.from({ length: 35 }, (_, k) => k + 1)]);
  });

  it("calls NONE of the 70 fabricated references verified (the product's core promise)", () => {
    const verified = out.fakes.map((item, k) => ({ item, fake: fakes[k]! })).filter((x) => x.item.verdict === "verified");
    expect(verified.map((x) => `${x.fake.id}: ${x.fake.text}`)).toEqual([]);
  });

  it("verifies the real references it finds as the record they are (a verified answer names the paper's own DOI)", () => {
    const verified = out.real.map((item, k) => ({ item, paper: real[k]! })).filter((x) => x.item.verdict === "verified");
    const wrongRecord = verified.filter((x) => x.item.doi !== x.paper.doi);
    expect(wrongRecord.map((x) => `${x.paper.doi} -> ${x.item.doi}`)).toEqual([]);
    // the gate is the count measured on the recordings when this eval was written (6 Nov 2026): it may only go up
    expect(verified.length).toBeGreaterThanOrEqual(REAL_VERIFIED_FLOOR);
  });

  it("needs no request that was not recorded (replay)", () => {
    if (MODE === "replay") expect(layer.missing).toEqual([]);
  });
});

/** Real references verified through MCP on the recordings (6 Nov 2026). Raise it when the verifier gets better; never lower it without the owner's written word. */
const REAL_VERIFIED_FLOOR = 70;
