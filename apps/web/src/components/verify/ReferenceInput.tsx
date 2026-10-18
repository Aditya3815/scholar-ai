import { m } from "motion/react";
import { ArrowRight, FileUp, ListChecks, Loader2, Trash2 } from "lucide-react";
import { useId, useMemo, useRef, type RefObject } from "react";
import { MAX_REFERENCES, splitReferences } from "@scholar/shared";
import { springPop } from "../../lib/motion";
import { showNotice } from "../../lib/notice";

const MAX_FILE_BYTES = 1_000_000;

export function ReferenceInput({
  value,
  onChange,
  onSubmit,
  running,
  progress,
  onExample,
  onClear,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (entries: string[]) => void;
  running: boolean;
  progress: string;
  onExample: () => void;
  onClear: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const entries = useMemo(() => splitReferences(value), [value]);
  const n = entries.length;
  const over = n > MAX_REFERENCES;
  const ready = n > 0 && !running;

  const count = n === 0 ? "Nothing detected yet" : `${n} ${n === 1 ? "reference" : "references"} detected`;

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      showNotice("That file is larger than 1 MB. Paste the reference list instead.");
      return;
    }
    onChange(await file.text());
  }

  return (
    <form
      className="card vin"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSubmit(entries);
      }}
    >
      <label className="vin-label" htmlFor={id}>
        Your references
      </label>
      <p className="vin-hint" id={`${id}-hint`}>
        Paste a bibliography: one reference per line, a numbered list, or BibTeX. Up to {MAX_REFERENCES} at a time.
      </p>

      <textarea
        id={id}
        ref={inputRef}
        className="vin-text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ready) {
            e.preventDefault();
            onSubmit(entries);
          }
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const f = e.dataTransfer.files[0];
          if (f) {
            e.preventDefault();
            void readFile(f);
          }
        }}
        rows={9}
        spellCheck={false}
        autoComplete="off"
        aria-describedby={`${id}-hint ${id}-count`}
        placeholder={"[1] Watson, J. D., & Crick, F. H. C. (1953). Molecular structure of nucleic acids. Nature, 171, 737–738.\n[2] LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521, 436–444.\n[3] …"}
        readOnly={running}
      />

      <div className="vin-bar">
        <p className="vin-count" id={`${id}-count`} role="status" data-over={over}>
          <m.span key={n} className="vin-count-n" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={springPop}>
            {n === 0 ? "" : n}
          </m.span>
          {n === 0 ? count : over ? ` detected. Only the first ${MAX_REFERENCES} will be checked.` : n === 1 ? " reference detected" : " references detected"}
        </p>
        <div className="vin-actions">
          <input ref={fileRef} type="file" accept=".txt,.bib,.bibtex,text/plain" className="sr-only" tabIndex={-1} aria-label="Open a .txt or .bib file" onChange={(e) => { void readFile(e.target.files?.[0]); e.target.value = ""; }} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={running}>
            <FileUp size={15} aria-hidden="true" />
            <span>Open file</span>
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onExample} disabled={running}>
            <ListChecks size={15} aria-hidden="true" />
            <span>Try an example</span>
          </button>
          {value && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
              <Trash2 size={15} aria-hidden="true" />
              <span>Clear</span>
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={!ready} aria-busy={running}>
            {running ? <Loader2 className="spin" size={17} aria-hidden="true" /> : null}
            <span>{running ? progress : "Verify references"}</span>
            {!running && <ArrowRight size={16} aria-hidden="true" />}
          </button>
        </div>
      </div>
      <p className="vin-privacy">
        Your list is not saved. Only the text of each reference is sent to Crossref and OpenAlex to look it up. <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to verify.
      </p>
    </form>
  );
}
