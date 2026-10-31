import * as Dialog from "@radix-ui/react-dialog";
import { BookOpenCheck, Bell, Check, Copy, Link2, Loader2, LockKeyhole, Square, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  LITSCAN_LANGUAGES,
  LITSCAN_LANGUAGE_NAMES,
  LITSCAN_MAX_TOPIC,
  LITSCAN_MIN_TOPIC,
  LITSCAN_PER_DAY,
  PRIVACY_VERSION,
  assembleReport,
  type LitscanLanguage,
  type LitscanListItem,
  type LitscanPublic,
} from "@scholar/shared";
import { useAuth } from "../../lib/auth";
import { ApiError } from "../../lib/documents";
import { PlanStep, toDraft, type Draft } from "./PlanStep";
import { ExportMenu, Review, ThemeBoard } from "./Review";
import { ScanRunningError, cancelScan, deleteScan, getSharedScan, listScans, planScan, shareScan, startScan, unshareScan, useScan } from "../../lib/litscan";
import { showNotice } from "../../lib/notice";
import { askNotifyPermission, notifySupport, notifyWanted, setNotifyWanted, showScanNotice } from "../../lib/notify";
import { ProviderButtons } from "../ProviderButtons";
import { ConfirmDialog } from "../ConfirmDialog";
import { PrivacyCard } from "../legal/PrivacyCard";
import "../../styles/litscan.css";

/** What the person is told when a call fails: the service's own words when it gave some, a fallback otherwise. */
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : e instanceof Error && e.name !== "AbortError" ? fallback : "");

const idFromUrl = (): string | null => {
  const id = new URLSearchParams(location.search).get("scan");
  return id && /^[0-9a-f-]{36}$/.test(id) ? id : null;
};
const setUrl = (id: string | null) => {
  try {
    history.replaceState(history.state, "", id ? `/literature-scan?scan=${id}` : "/literature-scan");
  } catch {
    /* the address is a convenience, not needed */
  }
};

/** The "Indian sources" choice of the prompt box, remembered on this device, is where a new plan starts (it can be changed on the plan). */
const savedScope = (): "all" | "india" => {
  try {
    return localStorage.getItem("scholar.scope") === "india" ? "india" : "all";
  } catch {
    return "all";
  }
};

const STATE_NAME = { running: "Running", completed: "Finished", canceled: "Stopped", failed: "Did not finish" } as const;
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });


/**
 * Sharing a scan: a read-only link. "Share a link" first says what the link will show and who can read it; the link is made only after "Create the link", and "Stop sharing" kills it at once.
 * The link never outlives the scan (a day).
 */
function ShareDialog({ id, token, expiresAt, open, onOpenChange, onToken }: { id: string; token: string | null; expiresAt: string; open: boolean; onOpenChange: (o: boolean) => void; onToken: (t: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = token ? `${location.origin}/literature-scan/shared/${token}` : "";
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      showNotice(errorText(e, "That did not work. Please try again.") || "That did not work.");
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      showNotice("Your browser would not copy it. Select the link and copy it by hand.");
    }
  };
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <div className="modal-wrap">
          <Dialog.Content className="modal" aria-describedby="ls-share-d">
            <Dialog.Close className="icon-btn modal-close" aria-label="Close" disabled={busy}><X size={18} aria-hidden="true" /></Dialog.Close>
            <Dialog.Title className="modal-title">{token ? "This scan is shared" : "Share this scan with a link?"}</Dialog.Title>
            <Dialog.Description id="ls-share-d" className="modal-sub">
              Anyone who has the link can read this review until {when(expiresAt)}, when it is removed: your topic, the themes, the findings, the evidence table and the references. It does not show your name or e-mail. They cannot change anything, and you can stop sharing at any time.
            </Dialog.Description>
            {token ? (
              <div className="ls-share">
                <label className="ls-label" htmlFor="ls-share-url">The link</label>
                <div className="ls-share-row">
                  <input id="ls-share-url" className="ls-input" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
                  <button type="button" className="btn btn-primary" onClick={() => void copy()}>
                    {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                    <span>{copied ? "Copied" : "Copy"}</span>
                  </button>
                </div>
                <p className="ls-hint" role="status">{copied ? "The link is copied." : "Whoever you give it to can pass it on: treat it like the scan itself."}</p>
                <div className="confirm-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => onOpenChange(false)} disabled={busy}>Close</button>
                  <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void run(async () => { await unshareScan(id); onToken(null); })}>Stop sharing</button>
                </div>
              </div>
            ) : (
              <div className="confirm-actions">
                <button type="button" className="btn btn-ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</button>
                <button type="button" className="btn btn-primary" disabled={busy} aria-busy={busy} onClick={() => void run(async () => onToken(await shareScan(id)))}>
                  {busy ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
                  <span>Create the link</span>
                </button>
              </div>
            )}
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ScanView({ id, onLeave }: { id: string; onLeave: () => void }) {
  const { scan, view, problem, reload } = useScan(id);
  const [confirm, setConfirm] = useState(false);
  const [stopping, setStopping] = useState(false);
  const headRef = useRef<HTMLHeadingElement>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  // "tell me when it is done": the browser's own notification, only for a scan seen running on this page and only when the page is in the background (lib/notify.ts)
  const [support, setSupport] = useState(notifySupport);
  const [notify, setNotify] = useState(() => notifyWanted() && notifySupport() === "granted");
  const armed = useRef(false);
  useEffect(() => {
    if (!scan) return;
    if (view.state === "running") {
      armed.current = true;
      return;
    }
    if (!armed.current) return;
    armed.current = false;
    if (!notify) return;
    const answered = Object.values(view.parts).filter((p) => p.status === "answered").length;
    showScanNotice({
      id: scan.id,
      title: view.state === "completed" ? "Your literature scan has finished" : view.state === "failed" ? "Your literature scan did not finish" : "Your literature scan was stopped",
      body: `${answered} of ${view.total || scan.total} themes answered. Open Sodhsetu to read it.`,
    });
  }, [view.state, scan]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleNotify = async () => {
    if (notify) {
      setNotify(false);
      setNotifyWanted(false);
      return;
    }
    const ok = await askNotifyPermission();
    setSupport(notifySupport());
    setNotify(ok);
    setNotifyWanted(ok);
    if (!ok) showNotice("Notifications are not allowed for this site in your browser, so we cannot tell you when it finishes.");
  };

  useEffect(() => {
    if (scan) headRef.current?.focus({ preventScroll: true });
  }, [scan?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = scan?.items ?? [];
  const report = assembleReport(items, view.parts);
  const running = view.state === "running";
  useEffect(() => {
    setShareToken(scan?.share ?? null);
  }, [scan?.share]);

  if (problem === "missing") {
    return (
      <div className="card ls-card" role="alert">
        <h2 className="ls-topic">This scan is gone</h2>
        <p>Scans are kept for a day, or you deleted it.</p>
        <button type="button" className="btn btn-primary" onClick={onLeave}>Start a new scan</button>
      </div>
    );
  }
  if (!scan) {
    return <div className="empty" role="status" aria-busy="true"><span className="pulse-dot" /> <span className="sr-only">Loading the scan</span></div>;
  }

  const stop = async () => {
    setStopping(true);
    try {
      await cancelScan(id);
      reload();
    } catch (e) {
      showNotice(errorText(e, "The scan could not be stopped just now.") || "The scan could not be stopped just now.");
    } finally {
      setStopping(false);
    }
  };
  const done = view.done;
  const total = view.total || scan.total;

  return (
    <div className="ls-scan">
      <div className="card ls-card">
        <p className="eyebrow">Literature scan · {STATE_NAME[view.state]}</p>
        <h2 className="ls-topic" tabIndex={-1} ref={headRef}>{scan.topic}</h2>
        <p className="ls-meta">Written in {LITSCAN_LANGUAGE_NAMES[scan.language]}{scan.scope === "india" ? " · Indian sources only" : ""} · kept until {when(scan.expiresAt)}, then removed</p>
        {running ? (
          <>
            <div className="ls-progress" role="progressbar" aria-label="Themes finished" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
              <span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
            </div>
            <p className="ls-count">{done} of {total} themes finished</p>
            <ThemeBoard report={report} stages={view.stages} />
            <p className="ls-hint">You can close this page: the scan keeps running, and it will be in your recent scans when you come back.</p>
            {support !== "unsupported" && support !== "denied" && (
              <>
                <button type="button" className="btn btn-ghost btn-sm" aria-pressed={notify} onClick={() => void toggleNotify()}>
                  <Bell size={14} aria-hidden="true" />
                  <span>{notify ? "We will notify you when it finishes" : "Notify me when it finishes"}</span>
                </button>
                <p className="ls-hint">The notice comes from your browser and works while this tab stays open, in the background too. It shows only how many were answered, not your topic.</p>
              </>
            )}
            {problem === "offline" && <p className="ls-why" role="note">Reconnecting… the scan itself is not affected.</p>}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void stop()} disabled={stopping} aria-busy={stopping}>
              <Square size={14} aria-hidden="true" />
              <span>{stopping ? "Stopping…" : "Stop the scan"}</span>
            </button>
          </>
        ) : (
          <p className="ls-count">
            {view.state === "failed"
              ? "The scan did not finish. What it had finished is below."
              : `${report.answered} of ${total} themes answered${report.gaps ? `, ${report.gaps} without a written answer` : ""}${view.state === "canceled" ? " before it was stopped" : ""}.`}
          </p>
        )}
        {/* one polite line, said when a theme finishes or the scan ends: not word by word */}
        <p className="sr-only" role="status">{running ? `${done} of ${total} themes finished.` : `Scan ${STATE_NAME[view.state].toLowerCase()}: ${report.answered} of ${total} answered.`}</p>
      </div>

      {/* the review fills in as themes finish; before the first one there is only the board above */}
      {(!running || report.answered > 0) && <Review report={report} scope={scan.scope} running={running} />}

      <div className="ls-bar ls-actions">
        {!running && report.answered > 0 && (
          <>
            <ExportMenu topic={scan.topic} language={scan.language} report={report} scope={scan.scope} />
            <button type="button" className="btn btn-ghost" onClick={() => setShareOpen(true)}>
              <Link2 size={16} aria-hidden="true" />
              <span>{shareToken ? "Sharing is on" : "Share a link"}</span>
            </button>
          </>
        )}
        <button type="button" className="btn btn-ghost" onClick={onLeave}>{running ? "Back to my scans" : "New scan"}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setConfirm(true)}>
          <Trash2 size={16} aria-hidden="true" />
          <span>Delete this scan</span>
        </button>
      </div>
      <ShareDialog id={id} token={shareToken} expiresAt={scan.expiresAt} open={shareOpen} onOpenChange={setShareOpen} onToken={setShareToken} />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete this scan?"
        description="The topic and everything the scan found are removed from our servers now. A scan is removed after a day anyway."
        confirmLabel="Delete the scan"
        onConfirm={async () => {
          await deleteScan(id);
          onLeave();
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- the page */

function Recent({ scans, onOpen }: { scans: LitscanListItem[]; onOpen: (id: string) => void }) {
  if (scans.length === 0) return null;
  return (
    <section className="ls-recent" aria-labelledby="ls-recent-h">
      <h2 id="ls-recent-h" className="ls-recent-h">Your scans of the last day</h2>
      <ul>
        {scans.map((s) => (
          <li key={s.id}>
            <button type="button" className="ls-recent-item" onClick={() => onOpen(s.id)}>
              <span className="ls-recent-t">{s.topic}</span>
              <span className="ls-recent-m">{STATE_NAME[s.state]} · {s.done} of {s.total} themes · {when(s.createdAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const HOW = [
  "You give a topic. A private AI proposes the themes a review of it would cover; you glance at them, change any, and start.",
  "Each theme is searched in the paper indexes and answered from the abstracts it finds; each claim is checked against a sentence of an abstract.",
  "You get a review: findings by theme, an evidence table of the papers (with their study designs), the gaps, and APA references to download.",
];

/**
 * Literature scan: a topic becomes the themes of a review, which **you approve before anything is searched**; each is searched and answered from the abstracts (the same check as the prompt
 * box), on our servers, so the page can be closed and reopened; the answers become one review (findings by theme, evidence table, gaps, references), kept for a day. Nothing is written by a
 * model after the checks, and a theme that could not be answered is said to be a gap.
 */
const sharedTokenFromPath = (): string | null => /^\/literature-scan\/shared\/([A-Za-z0-9_-]{43})\/?$/.exec(location.pathname)?.[1] ?? null;

/** A scan someone shared by a link: read-only, no sign-in, not indexed, nothing about its owner. */
function SharedPage({ token }: { token: string }) {
  const [state, setState] = useState<{ s: "loading" } | { s: "gone" } | { s: "ok"; scan: LitscanPublic }>({ s: "loading" });
  useEffect(() => {
    const ctl = new AbortController();
    getSharedScan(token, ctl.signal).then(
      (scan) => setState({ s: "ok", scan }),
      () => !ctl.signal.aborted && setState({ s: "gone" }),
    );
    return () => ctl.abort();
  }, [token]);
  // the page itself says it is not to be indexed (the headers of the static host say so as well)
  useEffect(() => {
    const m = document.createElement("meta");
    m.name = "robots";
    m.content = "noindex, nofollow";
    document.head.appendChild(m);
    return () => m.remove();
  }, []);
  const scan = state.s === "ok" ? state.scan : null;
  const report = scan ? assembleReport(scan.items, Object.fromEntries(scan.parts.map((p) => [p.idx, p]))) : null;
  return (
    <section className="ws-page ls-page" aria-labelledby="ls-h">
      <h1 id="ls-h" className="ws-page-h"><BookOpenCheck size={22} aria-hidden="true" /> Shared literature scan</h1>
      {state.s === "loading" ? (
        <div className="empty" role="status" aria-busy="true"><span className="pulse-dot" /> <span className="sr-only">Loading the scan</span></div>
      ) : !scan || !report ? (
        <div className="card ls-card" role="alert">
          <h2 className="ls-topic">This link does not work</h2>
          <p>It was turned off, or the scan was removed: scans are kept for a day.</p>
          <a className="btn btn-primary" href="/literature-scan">Make your own literature scan</a>
        </div>
      ) : (
        <div className="ls-scan">
          <p className="ws-page-lead">Someone shared this scan with you to read. It is a map of what the abstracts of the papers found say, not a systematic review. Each claim points at a sentence of an abstract. They can stop sharing at any time, and it is removed after a day.</p>
          <div className="card ls-card">
            <p className="eyebrow">Literature scan · {STATE_NAME[scan.state]}</p>
            <h2 className="ls-topic">{scan.topic}</h2>
            <p className="ls-meta">Written in {LITSCAN_LANGUAGE_NAMES[scan.language]}{scan.scope === "india" ? " · Indian sources only" : ""} · removed {when(scan.expiresAt)}</p>
            <p className="ls-count">{report.answered} of {scan.total} themes answered{report.gaps ? `, ${report.gaps} without a written answer` : ""}.</p>
          </div>
          <Review report={report} scope={scan.scope} />
          <div className="ls-bar ls-actions">
            {report.answered > 0 && <ExportMenu topic={scan.topic} language={scan.language} report={report} scope={scan.scope} />}
            <a className="btn btn-ghost" href="/literature-scan">Make your own scan</a>
          </div>
        </div>
      )}
    </section>
  );
}

export function LitscanPage() {
  const token = sharedTokenFromPath();
  return token ? <SharedPage token={token} /> : <ScanApp />;
}

function ScanApp() {
  const { status, user } = useAuth();
  const [scanId, setScanIdState] = useState<string | null>(idFromUrl);
  const [topic, setTopic] = useState("");
  const [language, setLanguage] = useState<LitscanLanguage | "auto">("auto");
  const [planning, setPlanning] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [starting, setStarting] = useState(false);
  const [recent, setRecent] = useState<LitscanListItem[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const id = useId();
  const abort = useRef<AbortController | null>(null);

  const setScanId = (v: string | null) => {
    setScanIdState(v);
    setUrl(v);
  };
  useEffect(() => () => abort.current?.abort(), []);

  const refresh = useCallback(async () => {
    try {
      const scans = await listScans();
      setRecent(scans);
      setRunning(scans.find((s) => s.state === "running")?.id ?? null);
    } catch {
      /* the list is a convenience */
    }
  }, []);
  useEffect(() => {
    if (user && !scanId) void refresh();
  }, [user, scanId, refresh]);

  const prepare = async () => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setPlanning(true);
    try {
      setDraft(toDraft(await planScan(topic.trim(), language, ctl.signal), savedScope()));
    } catch (e) {
      showNotice(errorText(e, "We could not read the topic just now. Please try again.") || "We could not read the topic just now.");
    } finally {
      setPlanning(false);
    }
  };

  const start = async () => {
    if (!draft) return;
    setStarting(true);
    try {
      const sid = await startScan({ topic: draft.topic, language: draft.language, items: draft.items.map(({ title, question, searchQuery }) => ({ title: (title ?? "").trim(), question: question.trim(), searchQuery: searchQuery.trim() })), ...(draft.scope === "india" ? { scope: "india" as const } : {}) });
      setDraft(null);
      setScanId(sid);
    } catch (e) {
      if (e instanceof ScanRunningError) {
        setRunning(e.id);
        setDraft(null);
        showNotice("A scan is already running. Wait for it to finish, or stop it, before starting another.");
      } else showNotice(errorText(e, "The scan could not be started. Please try again.") || "The scan could not be started.");
    } finally {
      setStarting(false);
    }
  };

  const leave = () => {
    setScanId(null);
    setDraft(null);
    setTopic("");
    void refresh();
  };

  const ready = topic.trim().length >= LITSCAN_MIN_TOPIC && !planning;
  const locked = !!user && user.privacyAck !== PRIVACY_VERSION;

  return (
    <section className="ws-page ls-page" aria-labelledby="ls-h">
      <h1 id="ls-h" className="ws-page-h"><BookOpenCheck size={22} aria-hidden="true" /> Literature scan</h1>
      <p className="ws-page-lead">Give a topic, get a short literature review: findings by theme, an evidence table of the papers, the gaps, and references to download. Each claim points at a sentence of a real abstract.</p>

      {status === "loading" ? (
        <div className="empty" aria-busy="true"><span className="pulse-dot" /></div>
      ) : !user ? (
        <div className="card papers-gate">
          <span className="principle-ico" aria-hidden="true"><LockKeyhole size={20} /></span>
          <h2 className="papers-gate-title">Sign in to scan the literature</h2>
          <p>Your topic is read by a private AI, and the scan runs on your account, so we need to know it is you. It takes one click.</p>
          <ProviderButtons />
        </div>
      ) : scanId ? (
        <ScanView key={scanId} id={scanId} onLeave={leave} />
      ) : draft ? (
        <PlanStep draft={draft} busy={starting} onChange={setDraft} onBack={() => setDraft(null)} onStart={() => void start()} />
      ) : (
        <>
          <PrivacyCard kind="scans" />
          {running && (
            <p className="ls-running" role="status">
              A scan is running. <button type="button" className="link-btn" onClick={() => setScanId(running)}>Open it</button>
            </p>
          )}
          <form
            className="card ls-card ls-topic-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready && !locked) void prepare();
            }}
          >
            <label className="ls-label" htmlFor={`${id}-t`}>What do you want to know about?</label>
            <textarea
              id={`${id}-t`}
              className="ls-input ls-textarea"
              rows={3}
              maxLength={LITSCAN_MAX_TOPIC}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="For example: air pollution and asthma in children"
              readOnly={planning}
              aria-describedby={`${id}-th`}
            />
            <p id={`${id}-th`} className="ls-hint">{topic.trim().length} of {LITSCAN_MAX_TOPIC} characters. A sentence or two is enough; write in English, Hindi or Hinglish.</p>
            <label className="ls-label" htmlFor={`${id}-l`}>Write the answers in</label>
            <select id={`${id}-l`} className="ls-select" value={language} onChange={(e) => setLanguage(e.target.value as LitscanLanguage | "auto")} disabled={planning}>
              <option value="auto">Same as my topic (recommended)</option>
              {LITSCAN_LANGUAGES.map((l) => (
                <option key={l} value={l}>{LITSCAN_LANGUAGE_NAMES[l]}</option>
              ))}
            </select>
            <div className="ls-bar">
              <button type="submit" className="btn btn-primary" disabled={!ready || locked} aria-busy={planning}>
                {planning ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <BookOpenCheck size={16} aria-hidden="true" />}
                <span>{planning ? "Planning…" : "Plan the scan"}</span>
              </button>
            </div>
          </form>
          <ol className="ls-how" aria-label="How a literature scan works">
            {HOW.map((h) => <li key={h}>{h}</li>)}
          </ol>
          <p className="ls-hint">You can start up to {LITSCAN_PER_DAY} scans a day. Nothing is searched until you approve the plan. Only abstracts are read, so this is a map of what the papers found say, not a systematic review.</p>
          <Recent scans={recent} onOpen={setScanId} />
        </>
      )}
    </section>
  );
}
