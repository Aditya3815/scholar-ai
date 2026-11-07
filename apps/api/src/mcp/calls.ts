/**
 * What the MCP server keeps (migration 0026): a count of each account's tool calls per day, for the quota, and one row per call for the admin page with the tool, the app's name, how long it took
 * and how it ended. Never what was sent or answered, never who asked (the daily count holds an account id and a number, nothing else).
 */

/** Tool calls an account may make in a day (page 12: "jaise 300 tool calls/day"). */
export const MCP_CALLS_PER_DAY = 300;

export type CallOutcome = "ok" | "invalid" | "error" | "quota" | "rate_limited";

/** Every tool name the server has. A row names one of these (anything else is written as "unknown"), so the admin page's table is a closed list. */
export const MCP_TOOLS = ["search_papers", "verify_references", "check_retractions", "ask_paper", "get_library", "save_paper", "check_claim"] as const;
export type McpTool = (typeof MCP_TOOLS)[number];

const today = () => new Date().toISOString().slice(0, 10);

/** Counts one call against the account's day; false when the day's calls are used up (nothing is counted then). */
export async function takeCall(db: D1Database, userId: string, max = MCP_CALLS_PER_DAY): Promise<boolean> {
  const r = await db.prepare("INSERT INTO mcp_daily (user_id, day, n) VALUES (?1, ?2, 1) ON CONFLICT (user_id, day) DO UPDATE SET n = n + 1 WHERE n < ?3").bind(userId, today(), max).run();
  return (r.meta?.changes ?? 0) > 0;
}

/** One row for the admin page. The app's name is what it registered with, cut to 60 characters; a failure to write is not the caller's problem. */
export async function logCall(db: D1Database, row: { tool: string; client: string; ms: number; outcome: CallOutcome }): Promise<void> {
  await db
    .prepare("INSERT INTO mcp_calls (tool, client, duration_ms, outcome) VALUES (?1, ?2, ?3, ?4)")
    .bind((MCP_TOOLS as readonly string[]).includes(row.tool) ? row.tool : "unknown", row.client.slice(0, 60) || "unknown", Math.max(0, Math.round(row.ms)), row.outcome)
    .run()
    .catch((e) => console.warn(JSON.stringify({ level: "warn", msg: "mcp_call_log_failed", error: e instanceof Error ? e.name : "unknown" })));
}

export type McpAdmin = {
  days: { day: string; calls: number }[];
  tools: { tool: string; calls: number; ok: number; invalid: number; error: number; quota: number; rateLimited: number; avgMs: number }[];
  clients: { client: string; calls: number }[];
  accountsToday: number;
};

/** The admin page's panel: the last seven days, counts only. */
export async function readMcpAdmin(db: D1Database): Promise<McpAdmin> {
  const [days, tools, clients, accounts] = await Promise.all([
    db.prepare("SELECT date(at) AS day, COUNT(*) AS calls FROM mcp_calls WHERE at >= date('now', '-6 days') GROUP BY date(at) ORDER BY day").all<{ day: string; calls: number }>(),
    db
      .prepare(
        "SELECT tool, COUNT(*) AS calls, COALESCE(SUM(outcome = 'ok'), 0) AS ok, COALESCE(SUM(outcome = 'invalid'), 0) AS invalid, COALESCE(SUM(outcome = 'error'), 0) AS error, COALESCE(SUM(outcome = 'quota'), 0) AS quota, COALESCE(SUM(outcome = 'rate_limited'), 0) AS rate_limited, COALESCE(AVG(duration_ms), 0) AS avg_ms FROM mcp_calls WHERE at >= date('now', '-6 days') GROUP BY tool ORDER BY calls DESC",
      )
      .all<{ tool: string; calls: number; ok: number; invalid: number; error: number; quota: number; rate_limited: number; avg_ms: number }>(),
    db.prepare("SELECT client, COUNT(*) AS calls FROM mcp_calls WHERE at >= date('now', '-6 days') GROUP BY client ORDER BY calls DESC LIMIT 20").all<{ client: string; calls: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM mcp_daily WHERE day = date('now')").first<{ n: number }>(),
  ]);
  return {
    days: days.results,
    tools: tools.results.map((t) => ({ tool: t.tool, calls: t.calls, ok: t.ok, invalid: t.invalid, error: t.error, quota: t.quota, rateLimited: t.rate_limited, avgMs: Math.round(t.avg_ms) })),
    clients: clients.results,
    accountsToday: accounts?.n ?? 0,
  };
}
