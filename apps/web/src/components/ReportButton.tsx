import { m } from "motion/react";
import { Check, Flag, Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { FEEDBACK_PROBLEMS, MAX_FEEDBACK_NOTE_CHARS, type FeedbackKind, type FeedbackRequest } from "@scholar/shared";
import { sendReport } from "../lib/feedback";
import { springPop } from "../lib/motion";
import { Pop } from "./Pop";

/** What is being reported, without the parts the researcher fills in (the problem and the note). */
export type ReportBody =
  | { kind: "answer"; docId: string; answerId: string }
  | { kind: "reference"; reference: string; status: string; reason?: string }
  | { kind: "idea"; semanticQuery?: string; keywordQueries?: string[] }
  | { kind: "other" };

/** What the report contains, in words, so sending it is an informed choice. */
const WHAT: Record<FeedbackKind, string> = {
  answer: "This sends the question, the answer and its cited passages, and your note, to us.",
  reference: "This sends the reference text, our verdict on it, and your note, to us.",
  idea: "This sends the search that was run (not your idea) and your note to us.",
  other: "This sends your note to us.",
};

function Form({ body, close, label }: { body: ReportBody; close: () => void; label: string }) {
  const id = useId();
  const problems = FEEDBACK_PROBLEMS[body.kind];
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  const submit = async () => {
    setState("sending");
    setError("");
    try {
      await sendReport({ ...body, problem, note: note.trim() || undefined } as FeedbackRequest);
      setState("sent");
      window.setTimeout(close, 1400);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The report could not be sent.");
      setState("idle");
    }
  };

  if (state === "sent") {
    return (
      <m.div className="report-done" role="status" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
        <m.span initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={springPop} className="report-done-ico"><Check size={18} aria-hidden="true" /></m.span>
        <p>Thank you. This helps us make the checking better.</p>
      </m.div>
    );
  }

  return (
    <form
      className="report"
      onSubmit={(e) => {
        e.preventDefault();
        if (problem && state === "idle") void submit();
      }}
    >
      <h3 className="pop-title">{label}</h3>
      <fieldset className="report-problems">
        <legend className="sr-only">What went wrong</legend>
        {problems.map((p) => (
          <label key={p.id} className="report-opt">
            <input type="radio" name={`${id}-p`} value={p.id} checked={problem === p.id} onChange={() => setProblem(p.id)} />
            <span>{p.label}</span>
          </label>
        ))}
      </fieldset>
      <label className="report-note-label" htmlFor={`${id}-n`}>Tell us more <span className="idea-opt">(optional)</span></label>
      <textarea id={`${id}-n`} className="report-note" rows={3} maxLength={MAX_FEEDBACK_NOTE_CHARS} value={note} onChange={(e) => setNote(e.target.value)} />
      <p className="report-what">{WHAT[body.kind]} It is kept for a year, and deleted if you delete your account.</p>
      {error && <p className="report-error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary btn-sm" disabled={!problem || state === "sending"} aria-busy={state === "sending"}>
        {state === "sending" ? <Loader2 className="spin" size={15} aria-hidden="true" /> : null}
        <span>{state === "sending" ? "Sending…" : "Send report"}</span>
      </button>
    </form>
  );
}

/** "Report a problem": a small popover that sends one report. `compact` is an icon button for tight places. */
export function ReportButton({ body, label = "Report a problem", compact = false }: { body: ReportBody; label?: string; compact?: boolean }) {
  return (
    <Pop
      label={label}
      align="end"
      trigger={() =>
        compact ? (
          <button type="button" className="ask-copy" aria-label={label} title={label}>
            <Flag size={15} aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm">
            <Flag size={15} aria-hidden="true" />
            <span>{label}</span>
          </button>
        )
      }
    >
      {(close) => <Form body={body} close={close} label={label} />}
    </Pop>
  );
}
