import { AnimatePresence } from "motion/react";
// Only icons the conversation's chunk (ChatView) already uses: an icon this chunk alone added was moved by the bundler out of the first-load chunk into small chunks of their own that the first load still
// preloads (+2 to 3 KB measured on 9 Nov 2026, with the Check references page's card and its status table imported here; +0.1 KB with these icons). e2e/chat-tools.mjs and the budget hold it.
import { ArrowRight, Check, Info, RefreshCw, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { refTally, type AssistantMsg, type ChatAskState, type ChatRefItem, type ChatToolResult, type RefStatus, type RefVerdict } from "@scholar/shared";
import { AnswerCard, Basis, ERROR_HELP, Reading, STAGE_SAY } from "../components/oa/OaAskSheet";
import { StreamingText } from "../components/papers/AskPanel";
import { SignInDialog } from "../components/SignInDialog";
import type { OaTurn } from "../lib/oa-ask";
import type { VerifyItem } from "../lib/verify";
import "../styles/chat-tools.css";

/**
 * The Check references page's words for a verdict (lib/refStatus.ts STATUS: the same labels, tones and buckets; only the icons differ, see above). Repeated here and not imported, for the same reason.
 * e2e/chat-tools.mjs reads these words on the screen.
 */
export const REF_STATUS: Record<RefStatus | "error", { label: string; Icon: typeof Check; tone: "ok" | "danger" | "warn" | "muted"; bucket: "verified" | "attention" | "unchecked" }> = {
  verified: { label: "Verified", Icon: Check, tone: "ok", bucket: "verified" },
  mismatch: { label: "Details don’t match", Icon: TriangleAlert, tone: "warn", bucket: "attention" },
  not_found: { label: "Not found", Icon: X, tone: "danger", bucket: "attention" },
  unverifiable: { label: "Could not verify", Icon: Info, tone: "muted", bucket: "unchecked" },
  unparsed: { label: "Not a full reference", Icon: Info, tone: "muted", bucket: "unchecked" },
  error: { label: "Check failed", Icon: Info, tone: "muted", bucket: "unchecked" },
};
const statusOf = (it: VerifyItem) => (it.state === "done" && it.verdict ? REF_STATUS[it.verdict.status] : REF_STATUS.error);

/**
 * A tool that ran in the reply (CHAT_TOOLS, docs/design/chat-tools.md): the same cards as the tool's own page, inside the conversation. A chunk of its own, fetched only when a reply has a tool.
 * - Check references: the verdicts as they arrive (the Check references page's cards), with a line that adds them up and the way to the full page.
 * - Retractions: each DOI, retracted (with its notice), not retracted, or could not be checked (never "not retracted" for a check that did not run).
 * - A question about one paper: "Ask this paper"'s own reading line, what the answer is made from, the words as they are written and the checked answer with its quotes.
 */
export default function ChatTool({ msg, onOpen }: { msg: AssistantMsg; onOpen: (to: "verify" | "paper") => void }) {
  const t = msg.tool;
  if (!t) return null;
  const working = msg.status === "working";
  return (
    <section className="chat-tool" data-kind={t.kind} aria-label={LABEL[t.kind]}>
      {t.kind === "verify" ? <Verify t={t} working={working} onOpen={() => onOpen("verify")} /> : t.kind === "retractions" ? <Retractions t={t} working={working} /> : <Ask msg={msg} t={t} working={working} onPapers={() => onOpen("paper")} />}
    </section>
  );
}

const LABEL: Record<ChatToolResult["kind"], string> = { verify: "References checked", retractions: "Retractions checked", ask_paper: "The paper's answer", ask_doc: "Your paper's answer" };

const asItem = (i: ChatRefItem): VerifyItem => ({ id: i.n, input: i.input, state: i.verdict ? "done" : "error", ...(i.verdict ? { verdict: i.verdict } : {}), ...(i.error ? { error: i.error } : {}) });

function Verify({ t, working, onOpen }: { t: Extract<ChatToolResult, { kind: "verify" }>; working: boolean; onOpen: () => void }) {
  // a reference checked again from its card (Check again): its new verdict replaces the one the reply has, on this screen
  const [again, setAgain] = useState<Record<number, VerifyItem>>({});
  const items = t.items.map((i) => again[i.n] ?? asItem(i));
  const n = refTally(t.items);
  const recheck = async (id: number) => {
    const one = t.items.find((i) => i.n === id);
    if (!one) return;
    setAgain((a) => ({ ...a, [id]: { id, input: one.input, state: "checking" } }));
    try {
      const res = await fetch("/api/v1/references/verify", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference: one.input }) });
      if (!res.ok) throw new Error(res.status === 429 ? "Too many checks just now. Wait a minute and try again." : "The check could not be made just now.");
      const verdict = (await res.json()) as RefVerdict;
      setAgain((a) => ({ ...a, [id]: { id, input: one.input, state: "done", verdict } }));
    } catch (e) {
      setAgain((a) => ({ ...a, [id]: { id, input: one.input, state: "error", error: e instanceof Error ? e.message : "The check could not be made just now." } }));
    }
  };
  return (
    <>
      <p className="chat-tool-head" role="status">
        {working ? (
          <>Checking references at Crossref and OpenAlex: {t.items.length} of {t.total} done…</>
        ) : (
          <>
            <b>{t.items.length} {t.items.length === 1 ? "reference" : "references"} checked</b>
            {n.verified > 0 && <span className="chat-tool-n" data-tone="ok"> · {n.verified} verified</span>}
            {n.mismatch > 0 && <span className="chat-tool-n" data-tone="warn"> · {n.mismatch} with details that differ</span>}
            {n.notFound > 0 && <span className="chat-tool-n" data-tone="bad"> · {n.notFound} not found</span>}
            {n.unchecked > 0 && <span className="chat-tool-n" data-tone="muted"> · {n.unchecked} could not be checked</span>}
          </>
        )}
      </p>
      {t.skipped > 0 && <p className="chat-tool-note" role="note">Only the first {t.total} references were checked here. Check the other {t.skipped} on the Check references page.</p>}
      <ul className="refs chat-tool-refs">
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <RefRow key={item.id} item={item} onRecheck={(id) => void recheck(id)} />
          ))}
        </AnimatePresence>
      </ul>
      {!working && (
        <p className="chat-tool-more">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onOpen}>
            <span>Open on the Check references page</span>
            <ArrowRight size={15} aria-hidden="true" />
          </button>
          <span className="chat-tool-why">Not found means no record in Crossref or OpenAlex, not that the work does not exist: books, theses and reports are often missing.</span>
        </p>
      )}
    </>
  );
}

const authorLine = (a: string[]) => (a.length === 0 ? "No authors listed" : a.length <= 4 ? a.join(", ") : `${a.slice(0, 3).join(", ")} et al.`);

/**
 * One reference's verdict, with the Check references page's words, icons and styles (lib/refStatus.ts, verify.css). Not that page's card itself: importing it here made the bundler move it out of the
 * first-load chunk into one of its own that the first load still preloads (+3.2 KB measured on 9 Nov 2026). Preview, Cite and Report stay on the page, one click away ("Open on the Check references page").
 */
function RefRow({ item, onRecheck }: { item: VerifyItem; onRecheck: (id: number) => void }) {
  const s = statusOf(item);
  const v = item.verdict;
  const pending = item.state === "checking" || item.state === "queued";
  const canRecheck = item.state === "error" || v?.status === "unverifiable";
  return (
    <li className="card ref" data-state={item.state} data-bucket={pending ? "pending" : s.bucket} data-status={v?.status} data-retracted={v?.retracted ? "true" : undefined}>
      <div className="ref-head">
        <span className="ref-ico" data-tone={pending ? "pending" : s.tone} aria-hidden="true">
          {pending ? <span className="pulse-dot" /> : <s.Icon size={20} />}
        </span>
        <p className="ref-status" data-tone={pending ? "pending" : s.tone}>{pending ? "Checking…" : s.label}</p>
        <span className="ref-num" aria-label={`Reference ${item.id}`}>#{item.id}</span>
      </div>
      <p className="ref-input clamp">{item.input}</p>
      {!pending && <p className="ref-reason" role={item.state === "error" ? "alert" : undefined}>{v?.reason ?? item.error}</p>}
      {v?.retracted && (
        <div className="retract" role="alert">
          <TriangleAlert size={18} aria-hidden="true" />
          <div>
            <strong>This paper has been retracted.</strong> Do not cite it without reading the retraction notice.
          </div>
        </div>
      )}
      {v?.match && (
        <div className="ref-match">
          <p className="ref-match-label">{v.status === "verified" ? "Matched record" : "Closest real record"}</p>
          <p className="ref-match-title">{v.match.title}</p>
          <p className="ref-match-meta">
            {authorLine(v.match.authors)}
            {v.match.year ? ` · ${v.match.year}` : ""}
            {v.match.venue ? ` · ${v.match.venue}` : ""}
          </p>
        </div>
      )}
      {(v?.match?.doi || canRecheck) && (
        <div className="actions">
          {v?.match?.doi && (
            <a className="btn btn-ghost btn-sm" href={`https://doi.org/${v.match.doi}`} target="_blank" rel="noreferrer noopener">
              <ArrowRight size={15} aria-hidden="true" />
              <span>Open DOI</span>
            </a>
          )}
          {canRecheck && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRecheck(item.id)}>
              <RefreshCw size={15} aria-hidden="true" />
              <span>Check again</span>
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function Retractions({ t, working }: { t: Extract<ChatToolResult, { kind: "retractions" }>; working: boolean }) {
  if (working && !t.final) return <p className="chat-tool-head" role="status">Checking {t.dois} {t.dois === 1 ? "DOI" : "DOIs"} for retractions at Crossref…</p>;
  const retracted = t.checked.filter((c) => c.status === "retracted").length;
  return (
    <>
      <p className="chat-tool-head" role="status">
        <b>{t.checked.length} {t.checked.length === 1 ? "DOI" : "DOIs"} checked</b>
        <span className="chat-tool-n" data-tone={retracted > 0 ? "bad" : "ok"}> · {retracted} retracted</span>
      </p>
      <ul className="chat-tool-dois">
        {t.checked.map((c) => (
          <li key={c.doi} className="chat-tool-doi" data-status={c.status}>
            {c.status === "retracted" ? <TriangleAlert size={16} aria-hidden="true" /> : c.status === "not_retracted" ? <ShieldCheck size={16} aria-hidden="true" /> : <Info size={16} aria-hidden="true" />}
            <a href={`https://doi.org/${c.doi}`} target="_blank" rel="noreferrer noopener" className="chat-tool-doi-id">{c.doi}</a>
            <span className="chat-tool-doi-says">{c.status === "retracted" ? "Retracted" : c.status === "not_retracted" ? "Not retracted" : "Could not be checked: try again later"}</span>
            {c.notices.length > 0 && (
              <span className="chat-tool-doi-notice">
                Notice:{" "}
                {c.notices.map((d) => (
                  <a key={d} href={`https://doi.org/${d}`} target="_blank" rel="noreferrer noopener">{d}</a>
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
      {t.invalid.length > 0 && <p className="chat-tool-note" role="note">Not read as DOIs: {t.invalid.join(", ")}</p>}
      <p className="chat-tool-why">From Crossref&apos;s retraction data, which includes the Retraction Watch database.</p>
    </>
  );
}

function Ask({ msg, t, working, onPapers }: { msg: AssistantMsg; t: Extract<ChatToolResult, { kind: "ask_paper" | "ask_doc" }>; working: boolean; onPapers: () => void }) {
  const a: ChatAskState = t.ask;
  // the shape "Ask this paper"'s own cards read
  const turn: OaTurn = { id: msg.id, question: t.question, status: a.answer ? "done" : a.error ? "error" : working ? "working" : "stopped", ingest: a.ingest, paper: a.paper, stage: a.stage, pages: a.pages, live: a.live, answer: a.answer, error: a.error };
  return (
    <>
      <p className="chat-tool-head">
        {t.kind === "ask_doc" ? "From your paper" : "From the paper"}
        {t.paper.title ? <>: <b>{t.paper.title}</b></> : null}
      </p>
      {a.paper && <Basis paper={a.paper} onPapers={onPapers} />}
      {a.paper?.retracted && (
        <p className="chat-tool-note" data-tone="bad" role="alert">
          <TriangleAlert size={15} aria-hidden="true" /> This paper has been retracted. Read the retraction notice before relying on anything in it.
        </p>
      )}
      {turn.status === "working" && <Reading turn={turn} />}
      {turn.status === "working" && a.stage && !a.live && <p className="oa-stage" aria-live="polite">{STAGE_SAY[a.stage]}…</p>}
      {turn.status === "working" && a.live && <StreamingText text={a.live} writing={a.stage === "writing"} />}
      {a.answer && <AnswerCard turn={turn} />}
      {a.error && (
        <div className="ask-error" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>
            {a.error.title}.{a.error.detail ? ` ${a.error.detail}` : ERROR_HELP[a.error.code] ? ` ${ERROR_HELP[a.error.code]}` : ""}
          </span>
          {a.error.code === "sign_in" && <SignInDialog />}
        </div>
      )}
    </>
  );
}
