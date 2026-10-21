import { m } from "motion/react";
import { ArrowRight, FileUp, Loader2, Trash2 } from "lucide-react";
import { useId, useRef, useState, type RefObject } from "react";
import { MAX_IDEA_CHARS, MAX_IDEA_QUESTION_CHARS, MIN_IDEA_CHARS } from "@scholar/shared";
import { IDEA_FILE_ACCEPT, IDEA_FILE_HELP, IdeaFileError, readIdeaFile } from "../../lib/ideafile";
import { springPop } from "../../lib/motion";
import { showNotice } from "../../lib/notice";

const EXAMPLE_TEXT =
  "I want to screen for glaucoma in rural clinics with no ophthalmologist. A health worker would take a photograph of the back of the eye with a smartphone and a low-cost lens attachment, and a convolutional neural network running on the phone would flag eyes that need a referral. I would test it on a few hundred patients against an ophthalmologist's reading.";

export function IdeaInput({
  text,
  question,
  fileName,
  truncated,
  busy,
  locked = false,
  onText,
  onQuestion,
  onFile,
  onSubmit,
  onClear,
  inputRef,
}: {
  text: string;
  question: string;
  fileName: string | null;
  truncated: boolean;
  busy: boolean;
  /** The privacy note has not been read yet: the idea can be written but not sent. */
  locked?: boolean;
  onText: (v: string) => void;
  onQuestion: (v: string) => void;
  onFile: (name: string, text: string, truncated: boolean) => void;
  onSubmit: () => void;
  onClear: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [over, setOver] = useState(false);
  const ready = text.trim().length >= MIN_IDEA_CHARS && !busy && !reading && !locked;

  async function take(file: File | undefined) {
    if (!file) return;
    setReading(true);
    try {
      const r = await readIdeaFile(file);
      onFile(file.name, r.text, r.truncated);
    } catch (e) {
      showNotice(e instanceof IdeaFileError ? e.message : "That file could not be read.");
    } finally {
      setReading(false);
    }
  }

  return (
    <form
      className="card vin idea-in"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSubmit();
      }}
    >
      <label className="vin-label" htmlFor={id}>
        Your idea
      </label>
      <p className="vin-hint" id={`${id}-hint`}>
        Describe it in a few sentences, paste your notes, or open a file ({IDEA_FILE_HELP}).
      </p>

      {fileName && (
        <p className="idea-file" role="status">
          <FileUp size={15} aria-hidden="true" />
          <span>
            Read from <strong>{fileName}</strong>
            {truncated ? `. Only the first ${Math.round(MAX_IDEA_CHARS / 1000)},000 characters are used.` : ""}
          </span>
        </p>
      )}

      <textarea
        id={id}
        ref={inputRef}
        className="vin-text idea-text"
        data-over={over}
        value={text}
        maxLength={MAX_IDEA_CHARS}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ready) {
            e.preventDefault();
            onSubmit();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) {
            e.preventDefault();
            void take(f);
          }
        }}
        rows={10}
        spellCheck
        autoComplete="off"
        aria-describedby={`${id}-hint ${id}-count`}
        placeholder="What do you want to find out or build? What is the method, and how would you test it?"
        readOnly={busy}
      />

      <label className="vin-label idea-q-label" htmlFor={`${id}-q`}>
        Your question <span className="idea-opt">(optional)</span>
      </label>
      <input
        id={`${id}-q`}
        className="idea-q"
        type="text"
        value={question}
        maxLength={MAX_IDEA_QUESTION_CHARS}
        onChange={(e) => onQuestion(e.target.value)}
        placeholder="For example: has this been tried in India, or with low-cost hardware?"
        readOnly={busy}
      />

      <div className="vin-bar">
        <p className="vin-count" id={`${id}-count`} role="status">
          <m.span key={Math.floor(text.length / 50)} className="vin-count-n" initial={{ scale: 0.85, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }} transition={springPop}>
            {text.trim().length.toLocaleString("en-IN")}
          </m.span>
          {text.trim().length < MIN_IDEA_CHARS ? ` characters (at least ${MIN_IDEA_CHARS})` : " characters"}
        </p>
        <div className="vin-actions">
          <input ref={fileRef} type="file" accept={IDEA_FILE_ACCEPT} className="sr-only" tabIndex={-1} aria-label="Open an idea file" onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ""; }} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={busy || reading}>
            {reading ? <Loader2 className="spin" size={15} aria-hidden="true" /> : <FileUp size={15} aria-hidden="true" />}
            <span>{reading ? "Reading…" : "Open file"}</span>
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onText(EXAMPLE_TEXT); onQuestion("Has this been tried with low-cost hardware?"); inputRef.current?.focus(); }} disabled={busy}>
            <span>Try an example</span>
          </button>
          {(text || question) && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClear} disabled={busy}>
              <Trash2 size={15} aria-hidden="true" />
              <span>Clear</span>
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={!ready} aria-busy={busy}>
            {busy ? <Loader2 className="spin" size={17} aria-hidden="true" /> : null}
            <span>{busy ? "Reading your idea…" : "Prepare the search"}</span>
            {!busy && <ArrowRight size={16} aria-hidden="true" />}
          </button>
        </div>
      </div>
      <p className="vin-privacy">
        Your idea stays in this browser and goes only to a private AI that does not keep or learn from it. Nothing is saved. Before anything is searched you will see
        exactly what will be sent. <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to continue.
      </p>
    </form>
  );
}
