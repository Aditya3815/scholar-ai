import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SWITCHES, flag, killSwitch, type GateName, type KillName } from "./switches";
import { checkClaimAllowedFor, mcpMode } from "../mcp/flag";
import { readTrending } from "../trending/routes";
import { runTrending } from "../trending/job";
import { fakeKv } from "../trending/fake-kv";
import { TRENDING_KEYS } from "../trending/store";

const TABLE_FILE = fileURLToPath(new URL("./switches.table.json", import.meta.url));

const VARIABLES: readonly (string | undefined)[] = [undefined, "off", "shadow", "beta", "core", "writer", "on", "dark", "ON", " on", "Core", "true", ""];
const KV_TEXTS: readonly string[] = ["off", "shadow", "beta", "core", "writer", "on", "dark", " OFF ", "Writer", "garbage", ""];
type KvState = { label: string; cache: unknown };
const label = (v: string | undefined) => (v === undefined ? "(unset)" : JSON.stringify(v));
const kvGet = (text: string | null) => ({ get: async () => text }) as unknown as KVNamespace;
const kvStates = (): KvState[] => [
  { label: "(no binding)", cache: undefined },
  { label: "(no key)", cache: kvGet(null) },
  ...KV_TEXTS.map((t) => ({ label: JSON.stringify(t), cache: kvGet(t) })),
  { label: "(throws)", cache: { get: async () => { throw new Error("503"); } } as unknown as KVNamespace },
];

const GATES = ["CHAT_COUNTERS", "CHAT_FAILPOLICY", "CHAT_SAFETY", "CHAT_CLEAN", "CHAT_FLOOR", "CHAT_THINK", "CHAT_UNDERSTAND", "CHAT_UNDERSTAND_VISITORS", "CHAT_TOOLS", "MCP", "MCP_CHECK_CLAIM"] as const;
type Gate = (typeof GATES)[number];

/** The reading of one gate, as every caller makes it: through the registry. */
const readGate = (name: Gate, env: Record<string, unknown>) => flag(env, name);

async function gateTable(name: Gate) {
  const rows: Record<string, Record<string, string>> = {};
  for (const v of VARIABLES) {
    const row: Record<string, string> = {};
    for (const k of kvStates()) {
      const env: Record<string, unknown> = { ...(v === undefined ? {} : { [name]: v }), ...(k.cache ? { CACHE: k.cache } : {}) };
      const r = await readGate(name, env);
      let cell = `${r.position} (variable ${r.variable}${r.badVariable ? ", bad" : ""}; override ${r.override ?? "none"}${r.badOverride ? ", bad" : ""}${r.kvUnreadable ? ", unreadable" : ""})`;
      if (name === "MCP") {
        cell += `; server ${await mcpMode({ ...env, OAUTH_KV: kvGet(null) } as never)}, without OAUTH_KV ${await mcpMode(env as never)}`;
      }
      if (name === "MCP_CHECK_CLAIM") {
        const withUsers = { ...env, MCP_BETA_USERS: "u-in" };
        cell += `; listed ${await checkClaimAllowedFor(withUsers as never, "u-in")}, not listed ${await checkClaimAllowedFor(withUsers as never, "u-out")}`;
      }
      row[k.label] = cell;
    }
    rows[label(v)] = row;
  }
  return rows;
}

const KILL_VALUES: readonly (string | undefined)[] = [undefined, "off", "OFF", " off", "Off", "on", "dark", "", "false", "0"];
const KILLS = ["CHAT_JUDGE", "CHAT_CONTEXT", "SEARCH_PLAINTEXT"] as const;
/** Every read (chat/routes.ts, litscan/workflow.ts, search/index.ts) goes through killSwitch; no KV. Before the registry each was `env.NAME === "off"`. */
const killToday = (name: (typeof KILLS)[number], v: string | undefined) => killSwitch(v === undefined ? {} : { [name]: v }, name);

const TRENDING_VALUES: readonly (string | undefined)[] = [undefined, "off", "OFF", " off ", "dark", "Dark", " DARK ", "on", "", "shadow", "1", "no"];
const TRENDING_KV: readonly (string | null | "(no binding)")[] = ["(no binding)", null, "1", "", "off", "on"];
const NOW = Date.parse("2026-11-03T06:00:00Z");
const fresh = {
  version: 1,
  asOf: "2026-11-03",
  generatedAt: "2026-11-03T03:17:20.000Z",
  validUntil: "2026-11-05T03:17:20.000Z",
  poolAsOf: "2026-11-02",
  disabled: false,
  groups: { global: { chips: ["a", "b", "c", "d", "e", "f", "g", "h"].map((text) => ({ text: `phrase ${text}`, sinceYear: 2025, a: 300, b: 120, field: "Computer Science" })) }, in: { chips: [] } },
};

async function trendingTable() {
  const rows: Record<string, Record<string, string>> = {};
  for (const v of TRENDING_VALUES) {
    const row: Record<string, string> = {};
    // the daily job: runs, or is stopped by the variable (it never reads the KV key)
    let job: string;
    try {
      const failing = fakeKv({ now: () => NOW, fail: () => { throw new Error("kv down"); } });
      const r = await runTrending({ kv: failing.kv as unknown as KVNamespace, mailto: "x@example.org", fetch: (async () => { throw new Error("no network"); }) as unknown as typeof fetch, search: async () => { throw new Error("no search"); }, sleep: async () => {}, clock: () => NOW, variable: v }, NOW);
      job = r.skipped === "off" ? "stopped" : "runs";
    } catch {
      job = "runs";
    }
    for (const k of TRENDING_KV) {
      let route: string;
      if (k === "(no binding)") {
        const r = await readTrending(v === undefined ? {} : { TRENDING: v }, new Date(NOW));
        route = `${r.payload.disabled ? "hidden" : "empty"}${r.storeFailed ? ", store failed" : ""}`;
      } else {
        const kv = fakeKv({ now: () => NOW });
        kv.seed(TRENDING_KEYS.file, JSON.stringify(fresh));
        if (k !== null) kv.seed(TRENDING_KEYS.off, k);
        const r = await readTrending({ ...(v === undefined ? {} : { TRENDING: v }), CACHE: kv.kv as unknown as KVNamespace }, new Date(NOW));
        route = `${r.payload.disabled ? "hidden" : r.payload.groups.global.chips.length > 0 ? "shown" : "empty"}${r.storeFailed ? ", store failed" : ""}, KV reads ${kv.log.gets.length}`;
      }
      row[k === null ? "(no key)" : k === "(no binding)" ? k : JSON.stringify(k)] = `list ${route}; job ${job}`;
    }
    rows[label(v)] = row;
  }
  return rows;
}

async function wholeTable() {
  const table: Record<string, unknown> = {};
  for (const g of GATES) table[g] = await gateTable(g);
  for (const k of KILLS) table[k] = Object.fromEntries(KILL_VALUES.map((v) => [label(v), killToday(k, v)]));
  table.TRENDING = await trendingTable();
  return table;
}

describe("every switch, at every position and every KV lowering, stands where it stood before the registry (docs/design/untangle.md, F6)", () => {
  it("covers every switch of the registry, and every position of each", () => {
    const names = Object.keys(SWITCHES);
    expect([...GATES].sort()).toEqual(names.filter((n) => SWITCHES[n as GateName].kind === "gate").sort());
    expect([...KILLS, "TRENDING"].sort()).toEqual(names.filter((n) => SWITCHES[n as KillName].kind === "kill").sort());
    for (const g of GATES) for (const p of SWITCHES[g].positions) expect(VARIABLES, `${g} ${p}`).toContain(p);
    for (const k of KILLS) for (const p of SWITCHES[k].positions) expect(KILL_VALUES, `${k} ${p}`).toContain(p);
    for (const p of SWITCHES.TRENDING.positions) expect(TRENDING_VALUES, `TRENDING ${p}`).toContain(p);
  });

  it("matches switches.table.json, written from the code before the change", async () => {
    const table = await wholeTable();
    expect(table).toEqual(JSON.parse(readFileSync(TABLE_FILE, "utf8")));
  });
});
