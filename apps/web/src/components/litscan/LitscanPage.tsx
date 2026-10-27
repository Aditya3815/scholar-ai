import { BookOpenCheck, Download, Loader2, LockKeyhole, Plus, Printer, ShieldCheck, Square, Trash2, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useId, useRef, useState } from "react";
import {
  LITSCAN_GAP_TEXT,
  LITSCAN_LANGUAGES,
  LITSCAN_LANGUAGE_NAMES,
  LITSCAN_MAX_ITEMS,
  LITSCAN_MAX_TOPIC,
  LITSCAN_MIN_ITEMS,
  LITSCAN_MIN_TOPIC,
  LITSCAN_PER_DAY,
  LITSCAN_QUESTION_CHARS,
  LITSCAN_SEARCH_CHARS,
  PRIVACY_VERSION,
  assembleReport,
  buildLitscanMarkdown,
  estimateScanTokens,
  litscanFileName,
  type LitscanItem,
  type LitscanLanguage,
  type LitscanListItem,
  type LitscanPlan,
  type Report,
  type ReportSection,
} from "@scholar/shared";
import { useAuth } from "../../lib/auth";
import { ApiError } from "../../lib/documents";
import { downloadText } from "../../lib/idea";
import { ScanRunningError, cancelScan, deleteScan, listScans, planScan, startScan, useScan } from "../../lib/litscan";
import { showNotice } from "../../lib/notice";
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

const STATE_NAME = { running: "Running", completed: "Finished", canceled: "Stopped", failed: "Did not finish" } as const;
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const tokens = (n: number) => n.toLocaleString("en-IN");

/* ---------------------------------------------------------------- the plan, before anything is searched */

type Draft = { topic: string; language: LitscanLanguage; items: (LitscanItem & { key: number })[]; allowance: LitscanPlan["allowance"] };
let keyCounter = 0;
const toDraft = (p: LitscanPlan): Draft => ({ topic: p.topic, language: p.language, items: p.items.map((i) => ({ ...i, key: ++keyCounter })), allowance: p.allowance });

function PlanStep({ draft, busy, onChange, onBack, onStart }: { draft: Draft; busy: boolean; onChange: (d: Draft) => void; onBack: () => void; onStart: () => void }) {
  const id = useId();
  const n = draft.items.length;
  const estimate = estimateScanTokens(n);
  const left = Math.max(0, draft.allowance.limit - draft.allowance.used);
  const enough = estimate <= left;
  const filled = draft.items.every((i) => i.question.trim().length >= 3 && i.searchQuery.trim().length >= 2);
  const why = n < LITSCAN_MIN_ITEMS ? `Keep at least ${LITSCAN_MIN_ITEMS} sub-questions.` : !filled ? "Every sub-question needs its question and some search words." : !enough ? "Today's AI allowance is not enough for this many. Remove a sub-question, or come back tomorrow." : "";
  const set = (key: number, patch: Partial<LitscanItem>) => onChange({ ...draft, items: draft.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) });

  return (
    <form
      className="ls-plan"
      onSubmit={(e) => {
        e.preventDefault();
        if (!why && !busy) onStart();
      }}
    >
      <div className="card ls-card">
        <p className="eyebrow">Your topic</p>
        <h2 className="ls-topic">{draft.topic}</h2>
        <div className="ls-sendnote">
          <ShieldCheck size={20} aria-hidden="true" />
          <p>
            Your topic goes to a private AI service only. <b>Only the search words below</b> go to the public paper indexes (OpenAlex, Semantic Scholar and others), so change or remove anything you would rather not send.
          </p>
        </div>
      </div>

      <ol className="ls-items" aria-label="Sub-questions">
        {draft.items.map((it, i) => (
          <li key={it.key} className="card ls-item">
            <div className="ls-item-head">
              <span className="ls-n" aria-hidden="true">{i + 1}</span>
              <label className="ls-label" htmlFor={`${id}-q${it.key}`}>Sub-question {i + 1}</label>
              <button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove sub-question ${i + 1}: ${it.question}`} onClick={() => onChange({ ...draft, items: draft.items.filter((x) => x.key !== it.key) })} disabled={busy || n <= LITSCAN_MIN_ITEMS}>
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <input id={`${id}-q${it.key}`} className="ls-input" value={it.question} maxLength={LITSCAN_QUESTION_CHARS} onChange={(e) => set(it.key, { question: e.target.value })} readOnly={busy} />
            <label className="ls-label ls-label-s" htmlFor={`${id}-s${it.key}`}>Search words <span className="ls-opt">(English; this is what is sent)</span></label>
            <input id={`${id}-s${it.key}`} className="ls-input" lang="en" value={it.searchQuery} maxLength={LITSCAN_SEARCH_CHARS} onChange={(e) => set(it.key, { searchQuery: e.target.value })} readOnly={busy} />
          </li>
        ))}
      </ol>
      {n < LITSCAN_MAX_ITEMS && (
        <button type="button" className="btn btn-ghost btn-sm ls-add" disabled={busy} onClick={() => onChange({ ...draft, items: [...draft.items, { question: "", searchQuery: "", key: ++keyCounter }] })}>
          <Plus size={15} aria-hidden="true" />
          <span>Add a sub-question</span>
        </button>
      )}

      <div className="card ls-card ls-options">
        <div>
          <label className="ls-label" htmlFor={`${id}-lang`}>Write the answers in</label>
          <select id={`${id}-lang`} className="ls-select" value={draft.language} onChange={(e) => onChange({ ...draft, language: e.target.value as LitscanLanguage })} disabled={busy}>
            {LITSCAN_LANGUAGES.map((l) => (
              <option key={l} value={l}>{LITSCAN_LANGUAGE_NAMES[l]}</option>
            ))}
          </select>
          <p className="ls-hint">Chosen for you from how you wrote the topic. The sub-questions above stay as you see them; the written answers follow this language.</p>
        </div>
        <p className="ls-cost" data-over={!enough}>
          <b>This scan is expected to use about {tokens(estimate)} AI tokens</b> of the {tokens(draft.allowance.limit)} you have a day ({tokens(left)} left today). It reads abstracts only, and each claim it writes is checked against a sentence of an abstract.
        </p>
      </div>

      {why && <p className="ls-why" role="note">{why}</p>}
      <div className="ls-bar">
        <button type="button" className="btn btn-ghost" onClick={onBack} disabled={busy}>Edit the topic</button>
        <button type="submit" className="btn btn-primary" disabled={!!why || busy} aria-busy={busy}>
          {busy ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <BookOpenCheck size={16} aria-hidden="true" />}
          <span>{busy ? "Starting…" : "Start the scan"}</span>
        </button>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------- a scan: progress, then the report */

const STAGE_TEXT = { searching: "Searching the papers…", reading: "Reading the abstracts…" } as const;

/** The text of a section with its [n] marks as buttons that go to source n of the list below. */
function MarkedText({ text, onCite, label }: { text: string; onCite: (g: number) => void; label: (g: number) => string }) {
  return (
    <p className="reading ls-text">
      {text.split(/(\[\d{1,3}\])/g).map((part, i) => {
        const g = /^\[(\d{1,3})\]$/.exec(part)?.[1];
        return g ? (
          <button key={i} type="button" className="cite-chip" aria-label={label(Number(g))} onClick={() => onCite(Number(g))}>{g}</button>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        );
      })}
    </p>
  );
}

function Section({ s, stage, report, onCite }: { s: ReportSection; stage: "searching" | "reading" | undefined; report: Report; onCite: (g: number) => void }) {
  const h = useId();
  const title = (g: number) => report.sources.find((r) => r.g === g)?.title ?? `source ${g}`;
  return (
    <section className="card ls-section" aria-labelledby={h} data-status={s.status}>
      <h3 id={h} className="ls-section-h"><span className="ls-n" aria-hidden="true">{s.idx + 1}</span> {s.question}</h3>
      {s.status === "answered" ? (
        <>
          <span className="ask-status" data-tone="ok"><ShieldCheck size={15} aria-hidden="true" /> Each claim points at a sentence of an abstract</span>
          <MarkedText text={s.text} onCite={onCite} label={(g) => `Source ${g}: ${title(g)}. Go to the source`} />
          <details className="chat-evidence">
            <summary>The sentences behind it</summary>
            <ul>
              {s.evidence.map((e, i) => (
                <li key={i}>
                  <button type="button" className="chat-ev" onClick={() => onCite(e.g)}>
                    <span className="chat-ev-n">{e.g}</span>
                    <span>
                      <span className="chat-ev-t">{title(e.g)}</span>
                      <span className="chat-ev-q">“{e.sentence}”</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : s.status === "gap" ? (
        <p className="ls-gap" role="note"><b>No written answer.</b> {LITSCAN_GAP_TEXT[s.reason]}</p>
      ) : stage ? (
        <p className="ls-wait"><span className="pulse-dot" aria-hidden="true" /> {STAGE_TEXT[stage]}</p>
      ) : (
        <p className="ls-wait ls-wait-quiet">Waiting…</p>
      )}
    </section>
  );
}

function ScanView({ id, onLeave }: { id: string; onLeave: () => void }) {
  const { scan, view, problem, reload } = useScan(id);
  const [confirm, setConfirm] = useState(false);
  const [stopping, setStopping] = useState(false);
  const headRef = useRef<HTMLHeadingElement>(null);
  const srcRefs = useRef(new Map<number, HTMLLIElement>());

  useEffect(() => {
    if (scan) headRef.current?.focus({ preventScroll: true });
  }, [scan?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = scan?.items ?? [];
  const report = assembleReport(items, view.parts);
  const running = view.state === "running";
  const cite = useCallback((g: number) => {
    const el = srcRefs.current.get(g);
    el?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    el?.focus();
  }, []);

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
  const markdown = () => buildLitscanMarkdown({ appName: "Scholar AI", generatedAt: new Date().toISOString(), topic: scan.topic, language: scan.language, report });
  const done = view.done;
  const total = view.total || scan.total;

  return (
    <div className="ls-scan">
      <div className="card ls-card">
        <p className="eyebrow">Literature scan · {STATE_NAME[view.state]}</p>
        <h2 className="ls-topic" tabIndex={-1} ref={headRef}>{scan.topic}</h2>
        <p className="ls-meta">Answers in {LITSCAN_LANGUAGE_NAMES[scan.language]} · kept until {when(scan.expiresAt)}, then removed</p>
        {running ? (
          <>
            <div className="ls-progress" role="progressbar" aria-label="Sub-questions finished" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
              <span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
            </div>
            <p className="ls-count">{done} of {total} sub-questions finished</p>
            <p className="ls-hint">You can close this page: the scan keeps running, and it will be in your recent scans when you come back.</p>
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
              : `${report.answered} of ${total} sub-questions answered${report.gaps ? `, ${report.gaps} without a written answer` : ""}${view.state === "canceled" ? " before it was stopped" : ""}.`}
          </p>
        )}
        {/* one polite line, said when a sub-question finishes or the scan ends: not word by word */}
        <p className="sr-only" role="status">{running ? `${done} of ${total} sub-questions finished.` : `Scan ${STATE_NAME[view.state].toLowerCase()}: ${report.answered} of ${total} answered.`}</p>
      </div>

      {report.sections.map((s) => (
        <Section key={s.idx} s={s} stage={view.stages[s.idx]} report={report} onCite={cite} />
      ))}

      {report.sources.length > 0 && (
        <section className="card ls-card" aria-labelledby={`${id}-src`}>
          <h3 id={`${id}-src`} className="ls-section-h">Sources</h3>
          <p className="ls-hint">Real records from the paper indexes. Only abstracts were read, not the full papers. A sentence without a source number is wording, not a finding.</p>
          <ol className="ls-sources">
            {report.sources.map((r) => (
              <li key={r.g} id={`ls-src-${r.g}`} tabIndex={-1} ref={(el) => { if (el) srcRefs.current.set(r.g, el); else srcRefs.current.delete(r.g); }}>
                <span className="chat-ev-n" aria-hidden="true">{r.g}</span>
                <span>
                  <span className="chat-ev-t">{r.title}{r.year ? ` (${r.year})` : ""}</span>
                  <span className="ls-src-m">{r.authors.length ? `${r.authors.slice(0, 3).join(", ")}${r.authors.length > 3 ? " et al." : ""}` : ""}{r.venue ? ` · ${r.venue}` : ""}</span>
                  {(r.doi || r.url) && <a href={r.doi ? `https://doi.org/${r.doi}` : r.url!} target="_blank" rel="noopener noreferrer">{r.doi ? `doi:${r.doi}` : "Open the paper"}</a>}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="ls-bar ls-actions">
        {!running && report.answered > 0 && (
          <>
            <button type="button" className="btn btn-primary" onClick={() => downloadText(litscanFileName(scan.topic), markdown())}>
              <Download size={16} aria-hidden="true" />
              <span>Download as Markdown</span>
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
              <Printer size={16} aria-hidden="true" />
              <span>Print</span>
            </button>
          </>
        )}
        <button type="button" className="btn btn-ghost" onClick={onLeave}>{running ? "Back to my scans" : "New scan"}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setConfirm(true)}>
          <Trash2 size={16} aria-hidden="true" />
          <span>Delete this scan</span>
        </button>
      </div>
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
              <span className="ls-recent-m">{STATE_NAME[s.state]} · {s.done} of {s.total} sub-questions · {when(s.createdAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const HOW = [
  "You give a topic. A private AI splits it into sub-questions and you edit them.",
  "Each one is searched in the paper indexes, and a short answer is written from the abstracts it finds.",
  "Each claim is checked against a sentence of an abstract. What cannot be checked is left out and said plainly.",
];

/**
 * Literature scan: a topic is split into sub-questions that **you approve before anything is searched**; each is searched and answered from the abstracts (the same check as the prompt
 * box), on our servers, so the page can be closed and reopened; the answers are put together as one report with one list of sources, kept for a day. Nothing is written by a model after
 * the checks, and a sub-question that could not be answered is said to be a gap.
 */
export function LitscanPage() {
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
      setDraft(toDraft(await planScan(topic.trim(), language, ctl.signal)));
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
      const sid = await startScan({ topic: draft.topic, language: draft.language, items: draft.items.map(({ question, searchQuery }) => ({ question: question.trim(), searchQuery: searchQuery.trim() })) });
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
      <p className="ws-page-lead">A topic, split into sub-questions that you approve, each searched and answered from the abstracts of real papers. Each claim points at a sentence you can read.</p>

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
