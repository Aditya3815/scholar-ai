import { AnimatePresence, m } from "motion/react";
import { ArrowLeft, BookMarked, ExternalLink, FileWarning, Highlighter, Loader2, MessageSquareText, Pencil, ScrollText } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { Answer, Citation, DocNote, DocumentInfo, OutlineItem, PaperInfo } from "@scholar/shared";
import { useAuth } from "../../lib/auth";
import { ApiError, fetchDocument, fileUrl, reindexDoc, renameDoc, savePaperInfo, useJobs } from "../../lib/documents";
import { analyzeOpenPdf } from "../../lib/paperinfo";
import { useNotes } from "../../lib/notes";
import { easeOut, spring } from "../../lib/motion";
import { showNotice } from "../../lib/notice";
import { PdfError, openPdf, type PDFDocumentProxy } from "../../lib/pdf";
import { AskPanel } from "./AskPanel";
import { NotesPanel } from "./NotesPanel";
import { ReferencesPanel } from "./ReferencesPanel";
import type { NewNote, ViewerHandle } from "./PdfViewer";

// The viewer (and pdf.js with it) is its own chunk: it is only downloaded when a paper is opened.
const PdfViewer = lazy(() => import("./PdfViewer").then((m) => ({ default: m.PdfViewer })));

type Load = { status: "loading" } | { status: "error"; message: string; notFound?: boolean } | { status: "ready"; doc: DocumentInfo; history: Answer[]; info: PaperInfo | null };
type Pdf = { status: "loading"; progress: number } | { status: "error"; message: string } | { status: "ready"; pdf: PDFDocumentProxy };

function TitleEditor({ doc, onChange }: { doc: DocumentInfo; onChange: (d: DocumentInfo) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(doc.title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setValue(doc.title), [doc.title]);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  async function save() {
    const next = value.replace(/\s+/g, " ").trim();
    setEditing(false);
    if (!next || next === doc.title) return setValue(doc.title);
    try {
      await renameDoc(doc.id, next);
      onChange({ ...doc, title: next });
    } catch {
      setValue(doc.title);
      showNotice("The title could not be changed. Please try again.");
    }
  }
  return editing ? (
    <form className="dw-title-edit" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="sr-only" htmlFor="dw-title">Paper title</label>
      <input id="dw-title" ref={input} value={value} maxLength={200} onChange={(e) => setValue(e.target.value)} onBlur={() => void save()} onKeyDown={(e) => { if (e.key === "Escape") { setValue(doc.title); setEditing(false); } }} />
    </form>
  ) : (
    <h1 className="dw-title">
      <span>{doc.title}</span>
      <button type="button" className="dc-rename" aria-label="Rename this paper" title="Rename" onClick={() => setEditing(true)}>
        <Pencil size={14} aria-hidden="true" />
      </button>
    </h1>
  );
}

/** Bookmarks when the PDF has a few, otherwise detected headings (and say which, because detected ones can be incomplete). */
function contentsOf(info: PaperInfo | null): { items: OutlineItem[]; detected: boolean } | undefined {
  if (!info) return undefined;
  const outline = info.outline.filter((o) => o.page >= 1);
  if (outline.length >= 3) return { items: outline, detected: false };
  const headings = info.headings.filter((o) => o.page >= 1);
  return headings.length >= 2 ? { items: headings, detected: true } : undefined;
}

const authorsLine = (a: string[]) => (a.length <= 3 ? a.join(", ") : `${a.slice(0, 3).join(", ")} et al.`);

function OpeningPaper({ progress }: { progress: number }) {
  return (
    <div className="dw-opening" role="status" aria-live="polite">
      <svg className="dw-ring" width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
        <circle cx="28" cy="28" r="24" fill="none" stroke="var(--border)" strokeWidth="4" />
        <m.circle cx="28" cy="28" r="24" fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" transform="rotate(-90 28 28)" initial={false} animate={{ pathLength: Math.max(0.08, progress) }} transition={spring} />
      </svg>
      <p>Opening the paper{progress > 0 ? ` · ${Math.round(progress * 100)}%` : "…"}</p>
    </div>
  );
}

export function DocWorkspace({ id, onBack }: { id: string; onBack: () => void }) {
  const { status: authStatus, user } = useAuth();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [pdf, setPdf] = useState<Pdf>({ status: "loading", progress: 0 });
  const [tab, setTab] = useState<"paper" | "side">("paper");
  const [side, setSide] = useState<"ask" | "refs" | "notes">("ask");
  const notes = useNotes(id);
  const [focusNote, setFocusNote] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const analyzed = useRef<string | null>(null);
  const [page, setPage] = useState(1);
  const viewer = useRef<ViewerHandle>(null);
  const jobs = useJobs();
  const reindexing = jobs.some((j) => j.docId === id && j.step !== "done" && j.step !== "error");

  const fetchIt = useCallback(async () => {
    try {
      const r = await fetchDocument(id);
      setLoad({ status: "ready", doc: r.document, history: r.history, info: r.info });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setLoad({ status: "error", message: "Sign in to open your papers." });
      else if (e instanceof ApiError && e.status === 404) setLoad({ status: "error", message: "We could not find that paper. It may have been deleted.", notFound: true });
      else setLoad({ status: "error", message: "We could not load this paper. Check your connection and try again." });
    }
  }, [id]);

  useEffect(() => {
    if (authStatus !== "ready") return;
    if (!user) return setLoad({ status: "error", message: "Sign in to open your papers." });
    setLoad({ status: "loading" });
    void fetchIt();
  }, [authStatus, user?.id, fetchIt]);

  // Open the PDF itself once we know the paper exists and is ours.
  const found = load.status === "ready";
  useEffect(() => {
    if (!found) return;
    let cancelled = false;
    let opened: PDFDocumentProxy | null = null;
    setPdf({ status: "loading", progress: 0 });
    openPdf({ url: fileUrl(id) }, (f) => !cancelled && setPdf({ status: "loading", progress: f }))
      .then((p) => {
        opened = p;
        if (cancelled) void p.loadingTask.destroy();
        else setPdf({ status: "ready", pdf: p });
      })
      .catch((e) => !cancelled && setPdf({ status: "error", message: e instanceof PdfError ? e.message : "The paper could not be opened." }));
    return () => {
      cancelled = true;
      void opened?.loadingTask.destroy();
    };
  }, [found, id]);

  const needsInfo = load.status === "ready" && load.info === null;
  useEffect(() => {
    if (!needsInfo || pdf.status !== "ready" || analyzed.current === id) return;
    analyzed.current = id;
    let cancelled = false;
    setAnalyzing(true);
    analyzeOpenPdf(pdf.pdf)
      .then(async (found) => {
        const saved = await savePaperInfo(id, found).catch(() => null);
        if (!cancelled) setLoad((l) => (l.status === "ready" ? { ...l, doc: saved?.document ?? l.doc, info: saved?.info ?? found } : l));
      })
      .catch(() => !cancelled && setLoad((l) => (l.status === "ready" ? { ...l, info: { pages: pdf.pdf.numPages, title: null, doi: null, arxiv: null, outline: [], headings: [], references: [], referencesSource: "none", metadata: null } } : l)))
      .finally(() => !cancelled && setAnalyzing(false));
    return () => {
      cancelled = true;
    };
  }, [needsInfo, pdf, id]);

  // When a re-index finishes, pick up the new status.
  const wasReindexing = useRef(false);
  useEffect(() => {
    if (wasReindexing.current && !reindexing) void fetchIt();
    wasReindexing.current = reindexing;
  }, [reindexing, fetchIt]);

  const onCite = useCallback((c: Citation) => {
    setTab("paper");
    window.setTimeout(() => viewer.current?.goTo(c.page, c.quote), 120);
  }, []);

  const onGoToNote = useCallback((n: DocNote) => {
    setTab("paper");
    window.setTimeout(() => viewer.current?.goTo(n.page, n.quote), 120);
  }, []);

  const addNote = notes.add;
  const onCreateNote = useCallback(
    async (n: NewNote) => {
      const saved = await addNote({ page: n.page, quote: n.quote, color: n.color });
      if (saved && n.withNote) {
        setFocusNote(saved.id);
        setSide("notes");
        setTab("side");
      }
    },
    [addNote],
  );

  const onGoToPage = useCallback((page: number) => {
    setTab("paper");
    window.setTimeout(() => viewer.current?.goTo(page), 120);
  }, []);

  if (load.status === "loading") {
    return <div className="dw dw-center"><OpeningPaper progress={0} /></div>;
  }
  if (load.status === "error") {
    return (
      <div className="dw dw-center">
        <div className="empty" role="alert">
          <FileWarning size={30} aria-hidden="true" />
          <p className="empty-title">{load.message}</p>
          <div className="empty-actions">
            <button type="button" className="btn btn-primary" onClick={onBack}>
              <ArrowLeft size={16} aria-hidden="true" />
              <span>Back to my papers</span>
            </button>
            {!load.notFound && authStatus === "ready" && user && (
              <button type="button" className="btn btn-ghost" onClick={() => { setLoad({ status: "loading" }); void fetchIt(); }}>Try again</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const { doc, history, info } = load;
  const meta = info?.metadata;
  const refCount = info?.references.length ?? 0;
  return (
    <m.div className="dw" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: easeOut }}>
      <div className="dw-head">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          <ArrowLeft size={15} aria-hidden="true" />
          <span>My papers</span>
        </button>
        <div className="dw-titles">
          <TitleEditor doc={doc} onChange={(d) => setLoad({ status: "ready", doc: d, history, info })} />
          <p className="dw-meta">
            {doc.pages ? `${doc.pages} pages · ` : ""}
            {doc.status === "ready" ? `${doc.chunkCount} passages indexed` : doc.status === "failed" ? "Not indexed" : "Indexing"}
          </p>
          {meta && (
            <p className="dw-byline">
              {[meta.authors.length ? authorsLine(meta.authors) : null, meta.year, meta.venue].filter(Boolean).join(" · ")}
              {meta.doi && (
                <a className="dw-doi" href={`https://doi.org/${meta.doi}`} target="_blank" rel="noreferrer noopener">
                  DOI <ExternalLink size={12} aria-hidden="true" />
                </a>
              )}
            </p>
          )}
        </div>
      </div>

      <div className="dw-tabs" role="tablist" aria-label="Workspace">
        {([["paper", "Paper", ScrollText], ["ask", "Ask", MessageSquareText], ["refs", "References", BookMarked], ["notes", "Notes", Highlighter]] as const).map(([t, label, Icon]) => {
          const active = t === "paper" ? tab === "paper" : tab === "side" && side === t;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              id={`dw-tab-${t}`}
              aria-selected={active}
              aria-controls={t === "paper" ? "dw-panel-paper" : "dw-panel-side"}
              className="dw-tab"
              onClick={() => {
                if (t === "paper") setTab("paper");
                else {
                  setSide(t);
                  setTab("side");
                }
              }}
            >
              {active && <m.span layoutId="dw-tab-pill" className="topnav-pill" transition={spring} />}
              <Icon size={16} aria-hidden="true" />
              <span className="topnav-label">{label}</span>
              {t === "refs" && refCount > 0 && <span className="dw-tab-n">{refCount}</span>}
              {t === "notes" && notes.notes.length > 0 && <span className="dw-tab-n">{notes.notes.length}</span>}
            </button>
          );
        })}
      </div>

      <div className="dw-grid">
        <div id="dw-panel-paper" role="tabpanel" aria-labelledby="dw-tab-paper" className="dw-panel dw-paper" data-active={tab === "paper"}>
          <AnimatePresence mode="wait" initial={false}>
            {pdf.status === "loading" && (
              <m.div key="l" exit={{ opacity: 0 }}>
                <OpeningPaper progress={pdf.progress} />
              </m.div>
            )}
            {pdf.status === "error" && (
              <m.div key="e" className="empty" role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <FileWarning size={28} aria-hidden="true" />
                <p className="empty-title">The paper could not be shown</p>
                <p>{pdf.message}</p>
              </m.div>
            )}
            {pdf.status === "ready" && (
              <m.div key="r" className="dw-viewer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
                <Suspense fallback={<OpeningPaper progress={1} />}>
                  <PdfViewer ref={viewer} pdf={pdf.pdf} title={doc.title} downloadHref={fileUrl(doc.id)} onPage={setPage} contents={contentsOf(info)} notes={notes.notes} onCreateNote={(n) => void onCreateNote(n)} />
                </Suspense>
              </m.div>
            )}
          </AnimatePresence>
          {pdf.status === "ready" && <p className="sr-only" aria-live="polite">Page {page} of {pdf.pdf.numPages}</p>}
        </div>

        <div id="dw-panel-side" role="tabpanel" className="dw-panel dw-ask" data-active={tab === "side"}>
          <div className="dw-sidetabs" role="tablist" aria-label="Ask, references or notes">
            {([["ask", "Ask", MessageSquareText], ["refs", "References", BookMarked], ["notes", "Notes", Highlighter]] as const).map(([s, label, Icon]) => (
              <button key={s} type="button" role="tab" aria-selected={side === s} className="dw-sidetab" onClick={() => setSide(s)}>
                {side === s && <m.span layoutId="dw-side-pill" className="dw-sidetab-pill" transition={spring} />}
                <Icon size={15} aria-hidden="true" />
                <span>{label}</span>
                {s === "refs" && refCount > 0 && <span className="dw-tab-n">{refCount}</span>}
                {s === "notes" && notes.notes.length > 0 && <span className="dw-tab-n">{notes.notes.length}</span>}
              </button>
            ))}
          </div>
          {/* Both stay mounted so a question being answered, or references being checked, are never lost by switching tabs. */}
          <div className="dw-side" hidden={side !== "ask"}>
            <AskPanel doc={doc} history={history} onCite={onCite} onGoToPage={onGoToPage} onReindex={() => void reindexDoc(doc)} />
            {reindexing && (
              <p className="ask-fine" role="status">
                <Loader2 className="spin" size={13} aria-hidden="true" /> Indexing again…
              </p>
            )}
          </div>
          <div className="dw-side" hidden={side !== "refs"}>
            <ReferencesPanel info={info} analyzing={analyzing || (needsInfo && pdf.status !== "error")} />
          </div>
          <div className="dw-side" hidden={side !== "notes"}>
            <NotesPanel doc={doc} api={notes} focusId={focusNote} onGo={onGoToNote} />
          </div>
        </div>
      </div>
    </m.div>
  );
}
