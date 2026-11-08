import { Plug } from "lucide-react";
import { useEffect, useState } from "react";
import type { ConnectedApps } from "@scholar/shared";
import { showNotice } from "../lib/notice";

type State = { status: "loading" } | { status: "hidden" } | { status: "error" } | { status: "ready"; data: ConnectedApps };

const dateOf = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/**
 * Settings, "Connected apps": the AI apps (Claude, ChatGPT, Cursor ...) a person allowed to use Sodhsetu for them through the MCP server, each with what it may do and a Disconnect button, which
 * revokes the app's access at once (apps/api/src/mcp/apps.ts). While the server is off the list does not exist (404) and nothing is shown.
 */
export function ConnectedAppsSettings({ idPrefix }: { idPrefix: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void fetch("/api/v1/connected-apps", { credentials: "same-origin" })
      .then(async (res) => {
        if (!live) return;
        if (res.status === 404 || res.status === 401) return setState({ status: "hidden" });
        if (!res.ok) return setState({ status: "error" });
        setState({ status: "ready", data: (await res.json()) as ConnectedApps });
      })
      .catch(() => live && setState({ status: "error" }));
    return () => {
      live = false;
    };
  }, []);

  if (state.status === "hidden" || state.status === "loading") return null;

  const disconnect = async (id: string, name: string) => {
    setBusy(id);
    const res = await fetch(`/api/v1/connected-apps/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" }).catch(() => null);
    setBusy(null);
    if (!res?.ok) return showNotice(`${name} could not be disconnected. Please try again.`);
    setState((s) => (s.status === "ready" ? { status: "ready", data: { ...s.data, apps: s.data.apps.filter((a) => a.id !== id) } } : s));
    showNotice(`${name} was disconnected. It can no longer use Sodhsetu for you.`);
  };

  const origin = typeof location === "undefined" ? "https://sodhsetu.in" : location.origin;
  return (
    <section className="settings-sec" aria-labelledby={`${idPrefix}-apps`}>
      <h3 id={`${idPrefix}-apps`} className="settings-h">Connected apps</h3>
      {state.status === "error" ? (
        <p className="settings-p">The list of connected apps could not be loaded. Please try again later.</p>
      ) : (
        <>
          <p className="settings-p">
            AI apps you allowed to search papers and check references with Sodhsetu for you. To connect one, add <code>{origin}/mcp</code> as a connector (an MCP server) in that app.
            {state.data.mode === "beta" ? " Connecting apps is in a closed beta." : ""}
          </p>
          {state.data.apps.length === 0 ? (
            <p className="settings-p">No app is connected.</p>
          ) : (
            <ul className="settings-apps">
              {state.data.apps.map((a) => (
                <li key={a.id} className="settings-app">
                  <Plug size={16} aria-hidden="true" />
                  <div className="settings-app-txt">
                    <strong>{a.name}</strong>
                    <span>Connected {dateOf(a.connectedAt)}</span>
                    <span>Can {a.scopes.join("; ").toLowerCase()}.</span>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy === a.id} onClick={() => void disconnect(a.id, a.name)} aria-label={`Disconnect ${a.name}`}>
                    {busy === a.id ? "Disconnecting" : "Disconnect"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
