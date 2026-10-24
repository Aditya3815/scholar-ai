import { FileWarning, Loader2, X } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { fetchDocument, fileUrl } from "../../lib/documents";
import { useNotes } from "../../lib/notes";
import { openPdf, PdfError, type PDFDocumentProxy } from "../../lib/pdf";

// the same viewer chunk as the first paper: already loaded by the time a second paper is chosen
const PdfViewer = lazy(() => import("./PdfViewer").then((m) => ({ default: m.PdfViewer })));

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; pdf: PDFDocumentProxy; title: string };

/**
 * A second paper beside the one being read, to compare two (a method here, a result there). It is a reference: it can be read, searched, zoomed and its
 * highlights are shown, but drawing and the Ask panel belong to the first paper. Closing it leaves everything as it was.
 */
export function SecondPaper({ docId, onClose }: { docId: string; onClose: () => void }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const notes = useNotes(docId);

  useEffect(() => {
    let cancelled = false;
    let opened: PDFDocumentProxy | null = null;
    setState({ status: "loading" });
    (async () => {
      try {
        const { document } = await fetchDocument(docId);
        const pdf = await openPdf({ url: fileUrl(docId) });
        opened = pdf;
        if (cancelled) return void pdf.loadingTask.destroy();
        setState({ status: "ready", pdf, title: document.title });
      } catch (e) {
        if (!cancelled) setState({ status: "error", message: e instanceof PdfError ? e.message : "This paper could not be opened." });
      }
    })();
    return () => {
      cancelled = true;
      void opened?.loadingTask.destroy();
    };
  }, [docId]);

  return (
    <section className="dw-second" aria-label={state.status === "ready" ? `Second paper: ${state.title}` : "Second paper"}>
      <header className="dw-second-head">
        <p className="dw-second-title">{state.status === "ready" ? state.title : "Second paper"}</p>
        <button type="button" className="icon-btn icon-btn-sm" aria-label="Close the second paper" title="Close the second paper" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      {state.status === "loading" && (
        <div className="dw-opening" role="status">
          <Loader2 className="spin" size={22} aria-hidden="true" />
          <p>Opening the second paper…</p>
        </div>
      )}
      {state.status === "error" && (
        <div className="empty" role="alert">
          <FileWarning size={26} aria-hidden="true" />
          <p className="empty-title">{state.message}</p>
        </div>
      )}
      {state.status === "ready" && (
        <div className="dw-viewer">
          <Suspense fallback={<div className="dw-opening" role="status"><Loader2 className="spin" size={22} aria-hidden="true" /></div>}>
            <PdfViewer idPrefix="pdfv2" pdf={state.pdf} title={state.title} docId={docId} downloadHref={fileUrl(docId)} notes={notes.notes} />
          </Suspense>
        </div>
      )}
    </section>
  );
}
