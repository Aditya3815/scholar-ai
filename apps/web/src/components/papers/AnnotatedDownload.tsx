import { FileDown, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DocNote, InkItem } from "@scholar/shared";
import { fileUrl } from "../../lib/documents";
import { useLegend } from "../../lib/legend";
import { showNotice } from "../../lib/notice";
import type { PDFDocumentProxy } from "../../lib/pdf";

const fileName = (title: string) => `${title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "paper"}-marked.pdf`;

/**
 * "Download with my marks": a copy of the paper with the reader's highlights, highlighter and pen drawn into it, and the notes listed on a last page. Built in the
 * browser from the original file (pdf-lib is loaded only now); the paper itself is not changed.
 */
export function AnnotatedDownload({ docId, pdf, title, notes, strokes }: { docId: string; pdf: PDFDocumentProxy; title: string; notes: DocNote[]; strokes: InkItem[] }) {
  const legend = useLegend();
  const [busy, setBusy] = useState(false);
  const empty = notes.length === 0 && strokes.length === 0;

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(fileUrl(docId), { credentials: "same-origin" });
      if (!res.ok) throw new Error("download");
      const original = await res.arrayBuffer();
      const { buildAnnotatedPdf, ExportError } = await import("../../lib/annotated-pdf");
      let out;
      try {
        out = await buildAnnotatedPdf({ original, pdf, title, notes, strokes, legend });
      } catch (e) {
        if (e instanceof ExportError) return void showNotice(e.message);
        throw e;
      }
      const url = URL.createObjectURL(new Blob([out.bytes as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName(title);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      const { report } = out;
      const said = [`${report.strokes} ${report.strokes === 1 ? "drawing" : "drawings"}`, ...(report.texts > 0 ? [`${report.texts} written ${report.texts === 1 ? "note" : "notes"}`] : []), `${report.highlights} ${report.highlights === 1 ? "highlight" : "highlights"}`];
      const list = said.length < 2 ? said.join("") : `${said.slice(0, -1).join(", ")} and ${said.at(-1)}`;
      showNotice(
        `Your copy is ready (${list} marked${report.notesPage ? ", notes on the last page" : ""}).` +
          (report.notPlaced > 0 ? ` ${report.notPlaced} ${report.notPlaced === 1 ? "highlight" : "highlights"} could not be found on the page, so ${report.notPlaced === 1 ? "it is" : "they are"} only on the notes page.` : "") +
          (report.replacedChars > 0 ? " Some characters in your notes could not be shown on the notes page." : ""),
      );
    } catch {
      showNotice("The marked copy could not be made. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  // the command palette asks for the same thing ("Download a copy with my marks")
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    const go = () => void latest.current();
    window.addEventListener("scholar:annotated", go);
    return () => window.removeEventListener("scholar:annotated", go);
  }, []);

  return (
    <button type="button" className="icon-btn icon-btn-sm" aria-label="Download a copy with my marks" title={empty ? "Download a copy with my marks (nothing is marked yet)" : "Download a copy with my marks"} disabled={busy} onClick={() => void run()}>
      {busy ? <Loader2 className="spin" size={15} aria-hidden="true" /> : <FileDown size={15} aria-hidden="true" />}
    </button>
  );
}
