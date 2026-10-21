import { m } from "motion/react";
import { Bug, FileStack, MessagesSquare, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { FEEDBACK_PROBLEMS, type AdminFeedback, type AdminOverview } from "@scholar/shared";
import { useAuth } from "../../lib/auth";
import { easeOut, stagger } from "../../lib/motion";

const rise = (i: number) => ({ initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.45, ease: easeOut, delay: 0.05 + stagger(i, 0.06) } });
const n = (v: number) => v.toLocaleString("en-IN");
const problemLabel = (f: AdminFeedback) => FEEDBACK_PROBLEMS[f.kind]?.find((p) => p.id === f.problem)?.label ?? f.problem;

function Stat({ Icon, label, value, sub, i }: { Icon: typeof Users; label: string; value: string; sub?: string; i: number }) {
  return (
    <m.li className="card admin-stat" {...rise(i)}>
      <span className="principle-ico" aria-hidden="true"><Icon size={20} /></span>
      <p className="admin-stat-n">{value}</p>
      <p className="admin-stat-l">{label}</p>
      {sub && <p className="admin-stat-s">{sub}</p>}
    </m.li>
  );
}

/** Tokens per day for the last two weeks, as bars; a day with failures says so. */
function Usage({ days }: { days: AdminOverview["usage"] }) {
  const max = Math.max(1, ...days.map((d) => d.tokens));
  if (days.length === 0) return <p className="admin-empty">No AI calls recorded in the last two weeks.</p>;
  return (
    <ol className="admin-bars" aria-label="AI tokens per day">
      {days.map((d) => (
        <li key={d.day}>
          <span className="admin-bar-day">{d.day.slice(5)}</span>
          <span className="admin-bar" role="img" aria-label={`${n(d.tokens)} tokens in ${n(d.calls)} calls`}>
            <m.span className="admin-bar-fill" initial={{ width: 0 }} animate={{ width: `${Math.max(2, (d.tokens / max) * 100)}%` }} transition={{ duration: 0.6, ease: easeOut }} />
          </span>
          <span className="admin-bar-n">{n(d.tokens)} tokens · {n(d.calls)} calls</span>
          <span className="admin-bar-fail" data-fail={d.failed > 0}>{d.failed > 0 ? `${n(d.failed)} failed` : ""}</span>
        </li>
      ))}
    </ol>
  );
}

function Report({ f, onDelete }: { f: AdminFeedback; onDelete: (id: string) => void }) {
  return (
    <li className="card admin-report">
      <div className="admin-report-head">
        <span className="badge">{f.kind}</span>
        <strong>{problemLabel(f)}</strong>
        <time dateTime={f.createdAt} className="admin-report-time">{new Date(f.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</time>
        <span className="admin-report-user">user {f.user}</span>
        <button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove this ${f.kind} report`} onClick={() => onDelete(f.id)}>
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </div>
      {f.note && <p className="admin-report-note">{f.note}</p>}
      <details>
        <summary>What was sent</summary>
        <pre className="admin-report-ctx">{JSON.stringify(f.context, null, 2)}</pre>
      </details>
    </li>
  );
}

/** Checks that error reporting is connected: sends one harmless test event and says what Sentry answered. */
function ErrorReporting() {
  const [state, setState] = useState<"idle" | "sending" | "off" | "ok" | "failed">("idle");
  const test = async () => {
    setState("sending");
    try {
      const res = await fetch("/api/v1/admin/monitoring-test", { method: "POST", credentials: "same-origin" });
      const j = (await res.json()) as { configured?: boolean; status?: number | null };
      setState(!j.configured ? "off" : j.status && j.status >= 200 && j.status < 300 ? "ok" : "failed");
    } catch {
      setState("failed");
    }
  };
  return (
    <section className="card admin-sec" aria-labelledby="mon-h">
      <h2 id="mon-h" className="admin-h2">Error reporting</h2>
      <p className="admin-lead">Unexpected errors, in the server and in people's browsers, go to Sentry. Only the error, its stack and a route pattern are sent, never what anyone typed.</p>
      <div className="admin-test">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void test()} disabled={state === "sending"} aria-busy={state === "sending"}>
          <Bug size={15} aria-hidden="true" />
          <span>{state === "sending" ? "Sending…" : "Send a test event"}</span>
        </button>
        <p role="status" className="admin-test-result" data-state={state}>
          {state === "off" && "Not set up yet: no SENTRY_DSN secret is set on the server."}
          {state === "ok" && "Sentry accepted the test event. Look for “Test event from the admin page” in your Sentry project."}
          {state === "failed" && "The test event was not accepted. Check the DSN secret."}
        </p>
      </div>
    </section>
  );
}

/** For the people who run the service: usage, AI cost, failures and what researchers reported. It never shows paper or idea text. */
export function AdminPage() {
  const { status, user } = useAuth();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/overview", { credentials: "same-origin" });
      if (res.status === 404 || res.status === 401) return setState("denied");
      if (!res.ok) return setState("error");
      setData((await res.json()) as AdminOverview);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    if (status !== "ready") return;
    if (user?.role === "admin") void load();
    else setState("denied");
  }, [status, user?.id, user?.role, load]);

  const remove = async (id: string) => {
    const res = await fetch(`/api/v1/admin/feedback/${id}`, { method: "DELETE", credentials: "same-origin" });
    if (res.ok) setData((d) => (d ? { ...d, feedback: d.feedback.filter((f) => f.id !== id) } : d));
  };

  if (state === "denied") {
    return (
      <div className="empty" role="alert">
        <p className="empty-title">Page not found</p>
        <p>There is nothing here.</p>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="empty" role="alert">
        <p className="empty-title">The overview could not be loaded</p>
        <button type="button" className="btn btn-primary" onClick={() => void load()}>Try again</button>
      </div>
    );
  }
  if (state === "loading" || !data) return <div className="empty" aria-busy="true"><span className="pulse-dot" /></div>;

  const tokens14 = data.usage.reduce((a, d) => a + d.tokens, 0);
  const failed14 = data.usage.reduce((a, d) => a + d.failed, 0);
  const calls14 = data.usage.reduce((a, d) => a + d.calls, 0);

  return (
    <div className="admin">
      <section className="admin-head" aria-labelledby="admin-h">
        <p className="eyebrow">Admin</p>
        <h1 id="admin-h" className="admin-title">How it is going</h1>
        <p className="vsub admin-sub">Numbers only. No paper text, idea text or e-mail address is shown here.</p>
      </section>

      <ul className="admin-stats" aria-label="Totals">
        <Stat i={0} Icon={Users} label="People" value={n(data.users.total)} sub={`${n(data.users.newThisWeek)} new this week`} />
        <Stat i={1} Icon={FileStack} label="Uploaded papers" value={n(data.documents.total)} sub={`${n(data.documents.ready)} ready · ${n(data.documents.failed)} failed`} />
        <Stat i={2} Icon={MessagesSquare} label="Questions asked" value={n(data.questions)} />
      </ul>

      <section className="card admin-sec" aria-labelledby="usage-h">
        <h2 id="usage-h" className="admin-h2">AI use, last 14 days</h2>
        <p className="admin-lead">
          {n(tokens14)} tokens in {n(calls14)} calls{failed14 > 0 ? `, ${n(failed14)} failed` : ", none failed"}.
        </p>
        <Usage days={data.usage} />
        {data.byModel.length > 0 && (
          <table className="admin-table">
            <caption>By model, last 7 days</caption>
            <thead>
              <tr><th scope="col">Provider</th><th scope="col">Model</th><th scope="col" className="num">Calls</th><th scope="col" className="num">Failed</th><th scope="col" className="num">Tokens</th></tr>
            </thead>
            <tbody>
              {data.byModel.map((r) => (
                <tr key={`${r.provider}/${r.model}`}>
                  <td>{r.provider}</td><td>{r.model}</td><td className="num">{n(r.calls)}</td><td className="num">{n(r.failed)}</td><td className="num">{n(r.tokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <ErrorReporting />

      <section aria-labelledby="reports-h" className="admin-sec">
        <h2 id="reports-h" className="admin-h2">What people reported ({data.feedback.length})</h2>
        {data.feedback.length === 0 ? (
          <p className="admin-empty">Nothing reported yet.</p>
        ) : (
          <ul className="admin-reports">
            {data.feedback.map((f) => <Report key={f.id} f={f} onDelete={(id) => void remove(id)} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
