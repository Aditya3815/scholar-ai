import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { textAttrs, thinkSummary, type AssistantMsg, type ChatStep, type ThinkLine } from "@scholar/shared";
import { announce } from "./announcer";
import "../styles/think.css";

/**
 * The Thinking block (design PDF "Sodhsetu understanding, follow-ups and MCP", "Thinking dikhana", M2): what the server says it did, line by line, from the real counts of each stage (`think` events; the
 * server sends them only while CHAT_THINK is on). A reply that has none draws nothing here, and the page is what it was.
 * - Open while the reply is written, with the lines added and updated in place, and the steps as a thin bar inside it (the row of step names is not drawn for such a reply). Folded into one line when the
 *   reply is done ("Thought for 14 s · 1 search · 20 papers"); a button opens it again (Enter or Space, `aria-expanded`).
 * - Only the `understood` line can carry words a model wrote (a restated question): it is labelled "I understood", and its actions (Change, Use my exact words) are the page's own controls.
 * - A screen reader hears the stage when it changes, once (the conversation's one polite status line), never each line.
 */
const STAGES: Partial<Record<ChatStep, string>> = { route: "Understanding", search: "Searching", read: "Reading the papers", write: "Writing", check: "Checking each claim", general: "Writing background" };
const ORDER: ChatStep[] = ["route", "search", "read", "write", "check", "general"];

function ThinkBar({ msg }: { msg: AssistantMsg }) {
  const steps = ORDER.filter((s) => (s === "route" ? msg.auto : s === "general" ? msg.step === "general" : true));
  const at = msg.step ? steps.indexOf(msg.step) : -1;
  const done = steps.filter((s) => msg.stepsDone.includes(s)).length;
  const value = Math.max(done, at < 0 ? 0 : at) + (at >= 0 ? 0.5 : 0);
  return (
    <div className="think-bar" aria-hidden="true" data-step={msg.step ?? ""}>
      <span style={{ width: `${Math.min(100, Math.round((value / Math.max(1, steps.length)) * 100))}%` }} />
    </div>
  );
}

export function ThinkBlock({ msg, working, actions }: { msg: AssistantMsg; working: boolean; /** what the page draws for a line's actions (the Change menu, "Use my exact words") */ actions: (line: ThinkLine) => ReactNode }) {
  const lines = msg.think ?? [];
  // open while it is being written, folded when it is done, unless the person opened or closed it themselves (their choice stands until the reply works again)
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? working;
  const id = useId();
  const was = useRef(working);
  useEffect(() => {
    if (!was.current && working) setChosen(null);
    was.current = working;
  }, [working]);
  // the stage, said once when it changes (not each line)
  const said = useRef<ChatStep | null>(null);
  useEffect(() => {
    if (!working || !msg.step || said.current === msg.step) return;
    said.current = msg.step;
    const words = STAGES[msg.step];
    if (words) announce(`${words}…`);
  }, [working, msg.step]);
  if (lines.length === 0) return null;
  const head = working ? "Thinking" : thinkSummary({ tookMs: msg.tookMs, lines, papers: msg.papers.length });
  return (
    <section className="think" data-open={open} data-working={working} aria-label="What I did for this reply">
      <button type="button" className="think-head" aria-expanded={open} aria-controls={id} onClick={() => setChosen(!open)}>
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        <span>{head}</span>
        {working && <span className="pulse-dot" aria-hidden="true" />}
      </button>
      {working && <ThinkBar msg={msg} />}
      <ol id={id} className="think-lines" hidden={!open}>
        {lines.map((l) => (
          <li key={l.id} data-kind={l.kind}>
            {l.kind === "understood" && <span className="think-label">I understood: </span>}
            <span {...textAttrs(l.text)}>{l.text}</span>
            {l.actions && l.actions.length > 0 && !working && actions(l)}
          </li>
        ))}
      </ol>
    </section>
  );
}
