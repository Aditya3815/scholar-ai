import { CornerDownRight, Loader2, Pencil, Send, ShieldCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { MAX_LEGEND_CHARS, MAX_QUESTION_CHARS, NOTE_COLORS, type Answer, type Citation, type DocNote, type Legend, type NoteColor } from "@scholar/shared";
import { ApiError, askHighlights } from "../../lib/documents";
import { currentLegend, setLegendName, useLegend } from "../../lib/legend";
import { AnswerText } from "./AskPanel";

/** Show all, or one colour. Each chip carries the reader's own name for the colour and how many highlights have it. */
export function ColourFilter({ notes, value, onChange }: { notes: DocNote[]; value: NoteColor | "all"; onChange: (c: NoteColor | "all") => void }) {
  const legend = useLegend();
  const count = (c: NoteColor) => notes.filter((n) => n.color === c).length;
  return (
    <div className="hl-filter" role="group" aria-label="Show highlights by colour">
      <button type="button" className="chip-btn" aria-pressed={value === "all"} onClick={() => onChange("all")}>
        All <span className="wfilters-n">{notes.length}</span>
      </button>
      {NOTE_COLORS.map((c) => (
        <button key={c} type="button" className="chip-btn hl-chip" aria-pressed={value === c} disabled={count(c) === 0 && value !== c} onClick={() => onChange(value === c ? "all" : c)}>
          <span className="sres-dot" data-color={c} aria-hidden="true" />
          {legend[c]} <span className="wfilters-n">{count(c)}</span>
        </button>
      ))}
    </div>
  );
}

/** The four colour names, editable: yellow can mean "Important" to one reader and "Result" to another. Kept on this device. */
export function LegendEditor() {
  const legend = useLegend();
  const [open, setOpen] = useState(false);
  return (
    <div className="hl-legend">
      <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Pencil size={13} aria-hidden="true" /> {open ? "Done naming colours" : "Name the colours"}
      </button>
      {open && (
        <div className="hl-legend-grid">
          {NOTE_COLORS.map((c) => (
            <label key={c} className="hl-legend-row">
              <span className="sres-dot" data-color={c} aria-hidden="true" />
              <span className="sr-only">What {c} means</span>
              <input
                className="meta-input"
                defaultValue={legend[c]}
                maxLength={MAX_LEGEND_CHARS}
                aria-label={`What ${c} means`}
                // saved when the field is left, so a half-typed name is never what the filters show
                onBlur={(e) => {
                  setLegendName(c, e.target.value);
                  e.target.value = currentLegend()[c];
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())}
              />
            </label>
          ))}
          <p className="meta-fine">These names stay on this device. They name the sections of the Markdown you copy, and are sent with a question about your highlights so the answer uses your words.</p>
        </div>
      )}
    </div>
  );
}
const SUGGEST = (legend: Legend) => ["Summarise what I marked", `What did I mark as “${legend.pink}”?`, "Which highlights have my notes?"];

type Reply = { answer: Answer; used: number; total: number };

/** Ask about the highlights of this paper. The answer cites only highlights, and each quote is checked against the highlight it names. */
export function AskHighlights({ docId, count, onGo }: { docId: string; count: number; onGo: (c: Citation) => void }) {
  const legend = useLegend();
  const [q, setQ] = useState("");
  const [state, setState] = useState<{ status: "idle" } | { status: "busy"; q: string } | { status: "error"; message: string } | { status: "done"; q: string; reply: Reply }>({ status: "idle" });

  async function ask(text: string) {
    const question = text.replace(/\s+/g, " ").trim();
    if (question.length < 3 || state.status === "busy") return;
    setState({ status: "busy", q: question });
    try {
      const reply = await askHighlights(docId, question, legend);
      setState({ status: "done", q: question, reply });
    } catch (e) {
      setState({ status: "error", message: e instanceof ApiError ? (e.status === 429 ? "You have used today's AI allowance. It comes back tomorrow." : e.message) : "The connection was lost. Check your internet and try again." });
    }
  }

  if (count === 0) return null;
  const reply = state.status === "done" ? state.reply : null;
  return (
    <section className="hl-ask" aria-labelledby={`hl-ask-h`}>
      <h3 id="hl-ask-h" className="hl-ask-h">Ask about my highlights</h3>
      <form className="hl-ask-form" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        <label className="sr-only" htmlFor="hl-ask-in">Your question about your highlights</label>
        <input id="hl-ask-in" className="meta-input" value={q} maxLength={MAX_QUESTION_CHARS} placeholder="e.g. What did I mark as a limitation?" onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn btn-primary btn-sm" disabled={q.trim().length < 3 || state.status === "busy"} aria-label="Ask about my highlights">
          {state.status === "busy" ? <Loader2 className="spin" size={15} aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
        </button>
      </form>
      {state.status === "idle" && (
        <div className="hl-suggest">
          {SUGGEST(legend).map((s) => (
            <button key={s} type="button" className="chip-btn" onClick={() => { setQ(s); void ask(s); }}>{s}</button>
          ))}
        </div>
      )}
      {state.status === "busy" && <p className="ask-hint" role="status">Reading your highlights…</p>}
      {state.status === "error" && <p className="notes-error" role="alert">{state.message}</p>}
      {reply && (
        <div className="ask-answer hl-answer" data-tone={reply.answer.found ? (reply.answer.verified ? "ok" : "warn") : "muted"} role="status">
          <span className="ask-status" data-tone={reply.answer.found ? (reply.answer.verified ? "ok" : "warn") : "muted"}>
            {reply.answer.found && reply.answer.verified ? <ShieldCheck size={15} aria-hidden="true" /> : <TriangleAlert size={15} aria-hidden="true" />}
            {!reply.answer.found ? "Not in your highlights" : reply.answer.verified ? "Every source is one of your highlights" : "Could not verify the source"}
          </span>
          <AnswerText text={reply.answer.answer} citations={reply.answer.citations} onCite={onGo} />
          {reply.used < reply.total && <p className="ask-warn" role="note"><TriangleAlert size={15} aria-hidden="true" /><span>You have {reply.total} highlights; the {reply.used} that best match the question were used.</span></p>}
          {reply.answer.found && !reply.answer.verified && <p className="ask-warn" role="note"><TriangleAlert size={15} aria-hidden="true" /><span>The quoted evidence was not found in your highlights. Check the paper yourself.</span></p>}
          {reply.answer.citations.length > 0 && (
            <ul className="ask-sources" aria-label="The highlights this answer used">
              {reply.answer.citations.map((c) => (
                <li key={c.n}>
                  <button type="button" className="ask-source" onClick={() => onGo(c)}>
                    <span className="ask-source-page">p. {c.page}</span>
                    <span className="ask-source-quote">“{c.quote}”</span>
                    <CornerDownRight className="ask-source-go" size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="ask-fine">AI can misread. This answer is not saved with the paper.</p>
        </div>
      )}
    </section>
  );
}
