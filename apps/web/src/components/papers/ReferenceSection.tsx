import { CircleAlert, CircleCheck, FileText, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { MAX_PAPER_REFERENCES, splitReferences, type ReferenceSection as Section } from "@scholar/shared";
import { readReferenceSection } from "../../lib/paperinfo";
import type { PDFDocumentProxy } from "../../lib/pdf";

type Load = { status: "idle" | "reading" | "error" } | { status: "ready"; section: Section };

/**
 * The reference section of the PDF, as the app reads it, and a way to correct it. The list that is checked is cut out of this section; when a PDF is laid out
 * in a way the cutting cannot follow, the reader can see exactly what was found (and, for a numbered list, how many entries it says there are), fix it in the box
 * (one reference to a paragraph) and check that list instead. The corrected list is kept with the paper.
 */
export function ReferenceSection({ pdf, current, onOpenPage, onUseList }: { pdf: PDFDocumentProxy | null; current: string[]; onOpenPage: (page: number) => void; onUseList: (entries: string[]) => Promise<void> }) {
  const [load, setLoad] = useState<Load>({ status: "idle" });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const started = useRef(false);
  const boxId = useId();

  const open = () => {
    if (started.current || !pdf) return;
    started.current = true;
    setLoad({ status: "reading" });
    readReferenceSection(pdf).then(
      (section) => {
        setLoad({ status: "ready", section });
        // what the box starts with: the list that is being checked now (it may be a corrected one), else what the section gave
        setText((current.length > 0 ? current : section.entries).join("\n\n"));
      },
      () => setLoad({ status: "error" }),
    );
  };
  useEffect(() => {
    started.current = false; // another paper
    setLoad({ status: "idle" });
    setSaved(false);
  }, [pdf]);

  const entries = splitReferences(text).slice(0, MAX_PAPER_REFERENCES);
  const same = entries.length === current.length && entries.every((e, i) => e === current[i]);
  const section = load.status === "ready" ? load.section : null;

  const use = async () => {
    setBusy(true);
    try {
      await onUseList(entries);
      setSaved(true);
    } finally {
      setBusy(false);
    }
  };

  let verdict: { ok: boolean; text: string } | null = null;
  if (section?.found) {
    if (section.printedMax > 0) {
      verdict =
        section.entries.length === section.printedMax
          ? { ok: true, text: `The list is numbered up to ${section.printedMax} and ${section.entries.length} entries were found.` }
          : { ok: false, text: `The list is numbered up to ${section.printedMax}, but ${section.entries.length} entries were found: some may be joined or missing. Fix the list below if you can see which.` };
    } else verdict = { ok: true, text: `${section.entries.length} entries were found. This list has no numbers, so its count cannot be checked against the PDF: look at the pages if it matters.` };
  }

  return (
    <details className="refsec" onToggle={(e) => e.currentTarget.open && open()}>
      <summary className="refsec-sum">
        <FileText size={15} aria-hidden="true" />
        <span>The reference section of this PDF</span>
      </summary>
      <div className="refsec-body">
        {!pdf && <p className="ask-hint">The paper is still opening.</p>}
        {load.status === "reading" && (
          <p className="ask-hint" role="status">
            <Loader2 className="spin" size={14} aria-hidden="true" /> Reading the pages…
          </p>
        )}
        {load.status === "error" && <p className="ask-hint" role="alert">The pages could not be read just now. Close this and open it again.</p>}
        {section && (
          <>
            {section.found ? (
              <p className="refsec-where">
                Found on {section.firstPage === section.lastPage ? "page" : "pages"} {section.firstPage === section.lastPage ? section.firstPage : `${section.firstPage} to ${section.lastPage}`}.{" "}
                <button type="button" className="link-btn" onClick={() => onOpenPage(section.firstPage)}>Open page {section.firstPage}</button>
              </p>
            ) : (
              <p className="refsec-where">No heading such as “References” or “Bibliography” was found in this PDF. If you have the list, paste it below, one reference to a paragraph.</p>
            )}
            {verdict && (
              <p className="refsec-verdict" data-ok={verdict.ok} role="status">
                {verdict.ok ? <CircleCheck size={15} aria-hidden="true" /> : <CircleAlert size={15} aria-hidden="true" />}
                <span>{verdict.text}</span>
              </p>
            )}
            <label className="refsec-label" htmlFor={boxId}>The list that will be checked (one reference to a paragraph)</label>
            <textarea
              id={boxId}
              className="refsec-text"
              rows={9}
              value={text}
              spellCheck={false}
              onChange={(e) => {
                setText(e.target.value);
                setSaved(false);
              }}
            />
            <div className="refsec-actions">
              <p className="refsec-count" role="status">
                {entries.length} {entries.length === 1 ? "reference" : "references"} in the box{entries.length >= MAX_PAPER_REFERENCES ? ` (the first ${MAX_PAPER_REFERENCES} are used)` : ""}
              </p>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setText(section.entries.join("\n\n"))} disabled={!section.found}>
                <RotateCcw size={14} aria-hidden="true" />
                <span>Back to what was found</span>
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void use()} disabled={busy || entries.length === 0 || (same && !saved)} aria-busy={busy}>
                {busy ? <Loader2 className="spin" size={14} aria-hidden="true" /> : null}
                <span>{saved ? "Saved and checking" : "Check this list"}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </details>
  );
}
