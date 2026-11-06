import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MCP_PATHS, betaUsers, isMcpPath, mcpAllowedFor, mcpMode } from "./flag";
import { positionOfVariable } from "../understand/flags";

const kv = (value: string | null) => ({ get: async () => value }) as unknown as KVNamespace;
const OAUTH = { OAUTH_KV: kv(null) };

describe("the MCP switch", () => {
  it("is off unless the variable is exactly beta or on, and off without the OAUTH_KV namespace whatever it says", async () => {
    expect(await mcpMode(undefined)).toBe("off");
    expect(await mcpMode({ ...OAUTH })).toBe("off");
    expect(await mcpMode({ ...OAUTH, MCP: "beta" })).toBe("beta");
    expect(await mcpMode({ ...OAUTH, MCP: "on" })).toBe("on");
    for (const v of ["ON", "Beta", "true", "", "shadow", "core", "writer"]) expect(await mcpMode({ ...OAUTH, MCP: v }), v).toBe("off");
    expect(await mcpMode({ MCP: "on" })).toBe("off");
  });

  it("can only be lowered by the KV key flag:MCP, never raised", async () => {
    expect(await mcpMode({ ...OAUTH, MCP: "on", CACHE: kv("beta") } as never)).toBe("beta");
    expect(await mcpMode({ ...OAUTH, MCP: "on", CACHE: kv(" OFF ") } as never)).toBe("off");
    expect(await mcpMode({ ...OAUTH, MCP: "beta", CACHE: kv("on") } as never)).toBe("beta");
  });

  it("beta lets in only the listed accounts; on lets in everyone; off no one", () => {
    const env = { MCP_BETA_USERS: " u-1, u-2\nu-3 " };
    expect(betaUsers(env)).toEqual(["u-1", "u-2", "u-3"]);
    expect(mcpAllowedFor("beta", env, "u-2")).toBe(true);
    expect(mcpAllowedFor("beta", env, "u-9")).toBe(false);
    expect(mcpAllowedFor("on", env, "u-9")).toBe(true);
    expect(mcpAllowedFor("off", env, "u-1")).toBe(false);
  });

  it("the shared reader knows beta only for a flag that asks for it", () => {
    expect(positionOfVariable("beta", false)).toEqual({ position: "off", bad: true });
    expect(positionOfVariable("beta", false, false, true)).toEqual({ position: "beta", bad: false });
  });
});

describe("the paths the MCP server owns", () => {
  it("are exactly these, with or without a trailing slash, and nothing under /api", () => {
    expect(isMcpPath("/mcp")).toBe(true);
    expect(isMcpPath("/mcp/")).toBe(true);
    expect(isMcpPath("/oauth/token")).toBe(true);
    expect(isMcpPath("/.well-known/oauth-protected-resource/mcp")).toBe(true);
    expect(isMcpPath("/mcpx")).toBe(false);
    expect(isMcpPath("/api/v1/search")).toBe(false);
    expect(isMcpPath("/")).toBe(false);
  });

  it("all reach the Worker before the static assets, in production and staging (wrangler.jsonc run_worker_first)", () => {
    const text = readFileSync(fileURLToPath(new URL("../../wrangler.jsonc", import.meta.url)), "utf8");
    const cfg = JSON.parse(text.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n")) as { assets: { run_worker_first: string[] }; env: { staging: { assets: { run_worker_first: string[] } } } };
    const covered = (patterns: string[], path: string) => patterns.some((p) => (p.endsWith("/*") ? path.startsWith(p.slice(0, -1)) : p === path));
    for (const list of [cfg.assets.run_worker_first, cfg.env.staging.assets.run_worker_first]) for (const p of MCP_PATHS) expect(covered(list, p), p).toBe(true);
  });
});
