import { useEffect, useState } from "react";

type McpAdmin = {
  mode: "off" | "beta" | "on";
  days: { day: string; calls: number }[];
  tools: { tool: string; calls: number; ok: number; invalid: number; error: number; quota: number; rateLimited: number; avgMs: number }[];
  clients: { client: string; calls: number }[];
  accountsToday: number;
};

const n = (x: number) => x.toLocaleString("en-IN");
const MODE_TEXT = { off: "Off: /mcp answers 404.", beta: "Beta: only the accounts in MCP_BETA_USERS can connect an app.", on: "On: every signed-in account can connect an app." } as const;

/** The MCP server (apps/api/src/mcp): where the switch stands and the last seven days of tool calls, by tool, outcome and app. Counts only: never a query, a reference or a DOI. */
export function McpPanel() {
  const [data, setData] = useState<McpAdmin | null | "error">(null);
  useEffect(() => {
    let live = true;
    void fetch("/api/v1/admin/mcp", { credentials: "same-origin" })
      .then(async (r) => live && setData(r.ok ? ((await r.json()) as McpAdmin) : "error"))
      .catch(() => live && setData("error"));
    return () => {
      live = false;
    };
  }, []);
  return (
    <section className="card admin-sec" aria-labelledby="mcp-h">
      <h2 id="mcp-h" className="admin-h2">AI apps (MCP server)</h2>
      {data === null ? (
        <p className="admin-lead">Loading</p>
      ) : data === "error" ? (
        <p className="admin-lead">The MCP counts could not be loaded.</p>
      ) : (
        <>
          <p className="admin-lead">
            {MODE_TEXT[data.mode]} Accounts that called a tool today: {n(data.accountsToday)}. Counts only: what the apps sent is never kept.
          </p>
          {data.tools.length === 0 ? (
            <p className="admin-empty">No tool calls in the last 7 days.</p>
          ) : (
            <table className="admin-table">
              <caption>Tool calls, last 7 days</caption>
              <thead>
                <tr><th scope="col">Tool</th><th scope="col" className="num">Calls</th><th scope="col" className="num">Answered</th><th scope="col" className="num">Bad input</th><th scope="col" className="num">Failed</th><th scope="col" className="num">Over quota</th><th scope="col" className="num">Rate limited</th><th scope="col" className="num">Average ms</th></tr>
              </thead>
              <tbody>
                {data.tools.map((t) => (
                  <tr key={t.tool}>
                    <td>{t.tool}</td><td className="num">{n(t.calls)}</td><td className="num">{n(t.ok)}</td><td className="num">{n(t.invalid)}</td><td className="num">{n(t.error)}</td><td className="num">{n(t.quota)}</td><td className="num">{n(t.rateLimited)}</td><td className="num">{n(t.avgMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data.clients.length > 0 && (
            <table className="admin-table">
              <caption>By app, last 7 days</caption>
              <thead>
                <tr><th scope="col">App (as it names itself)</th><th scope="col" className="num">Calls</th></tr>
              </thead>
              <tbody>
                {data.clients.map((c) => (
                  <tr key={c.client}>
                    <td>{c.client}</td><td className="num">{n(c.calls)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
