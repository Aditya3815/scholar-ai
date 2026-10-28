import { AnimatePresence, m } from "motion/react";
import { ArrowLeft, BookMarked, Columns2, ExternalLink, FileWarning, Highlighter, Loader2, Maximize2, MessageSquareText, Minimize2, Pencil, ScrollText, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { analyzeScan, planNewHighlight, type Answer, type Citation, type DocNote, type DocumentInfo, type OutlineItem, type PaperInfo, type ScanInfo } from "@scholar/shared";
import { useAuth } from "../../lib/auth";
import { ApiError, continueScan, fetchDocument, fileUrl, pauseScan, postProgress, reindexDoc, renameDoc, savePaperInfo, loadDocs, useDocs, useJobs } from "../../lib/documents";
import { registerCommands } from "../../lib/commands";
import { useOnline } from "../../lib/offline";
import { takeJump } from "../../lib/jump";
import { fetchScan, fetchScanText } from "../../lib/scan";
import { analyzeOpenPdf } from "../../lib/paperinfo";
import { useNotes } from "../../lib/notes";
import { useInk } from "../../lib/ink";
import { PAPERS_NAME, PARKED } from "../../lib/workspace";
import { easeOut, spring } from "../../lib/motion";
import { showNotice } from "../../lib/notice";
import { PdfError, openPdf, type PDFDocumentProxy } from "../../lib/pdf";
import { ThemeSwitch } from "../ThemeSwitch";
import { AskPanel } from "./AskPanel";
import { DocMeta } from "./DocMeta";
import { Pop } from "../Pop";
import { SecondPaper } from "./SecondPaper";
import { NotesPanel } from "./NotesPanel";
import { ReferencesPanel } from "./ReferencesPanel";
import { ScanBanner } from "./ScanBanner";
import type { NewNote, ViewerHandle } from "./PdfViewer";

// The viewer (and pdf.js with it) is its own chunk: it is only downloaded when a paper is opened.
const PdfViewer = lazy(() => import("./PdfViewer").then((m) => ({ default: m.PdfViewer })));

type Load = { status: "loading" } | { status: "error"; message: string; notFound?: boolean } | { status: "ready"; doc: DocumentInfo; history: Answer[]; info: PaperInfo | null; scan: ScanInfo | null };
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
  // drawing (pen, highlighter, eraser) is part of My Workspace
  const ink = useInk(id);
  // the note being written, or the one whose icon was pressed; `tick` makes a second press on the same note work again
  const [focusNote, setFocusNote] = useState<{ id: string; tick: number } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const analyzed = useRef<string | null>(null);
  const [page, setPage] = useState(1);
  const viewer = useRef<ViewerHandle>(null);
  // My Workspace remembers the page: the paper opens where the reader left it ("resume"), and the place is saved while they read
  const [resumedFrom, setResumedFrom] = useState<number | null>(null);
  const [tracking, setTracking] = useState(false);
  // focus mode: the paper takes the whole window (the Ask, References and Notes panel is put away); kept on this device
  const [focus, setFocus] = useState(() => {
    try {
      return localStorage.getItem("scholar.focus") === "1";
    } catch {
      return false;
    }
  });
  const toggleFocus = useCallback(() => {
    setFocus((f) => {
      try {
        localStorage.setItem("scholar.focus", f ? "0" : "1");
      } catch {
        /* private mode: only for this visit */
      }
      return !f;
    });
  }, []);
  // a second paper beside this one (compare two); not kept: a fresh visit starts with one
  const [split, setSplit] = useState<string | null>(null);
  const online = useOnline();
  const allDocs = useDocs();
  const otherPapers = allDocs.items.filter((d) => d.id !== id && d.status === "ready");
  // opened by its address, the list of papers has not been loaded yet: the palette and the second-paper picker need it
  useEffect(() => {
    if (user && allDocs.status === "idle") void loadDocs();
  }, [user, allDocs.status]);
  const jobs = useJobs();
  const myJob = jobs.find((j) => j.docId === id && ["reading", "uploading", "indexing", "scanning"].includes(j.step));
  const reindexing = !!myJob;

  const fetchIt = useCallback(async () => {
    try {
      const r = await fetchDocument(id);
      setLoad({ status: "ready", doc: r.document, history: r.history, info: r.info, scan: r.scan });
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

  const isScan = load.status === "ready" && load.doc.scanned;
  const scanLeft = load.status === "ready" && load.doc.scanned ? load.doc.scanPending : 0;
  const needsInfo = load.status === "ready" && load.info === null && scanLeft === 0;
  useEffect(() => {
    if (!needsInfo || pdf.status !== "ready" || analyzed.current === id) return;
    analyzed.current = id;
    let cancelled = false;
    setAnalyzing(true);
    // a scan has no text layer: its DOI and references are looked for in the text that was read from its pictures
    (isScan ? fetchScanText(id).then((pages) => analyzeScan(pages, pdf.pdf.numPages)) : analyzeOpenPdf(pdf.pdf))
      .then(async (found) => {
        const saved = await savePaperInfo(id, found).catch(() => null);
        if (!cancelled) setLoad((l) => (l.status === "ready" ? { ...l, doc: saved?.document ?? l.doc, info: saved?.info ?? found } : l));
      })
      .catch(() => !cancelled && setLoad((l) => (l.status === "ready" ? { ...l, info: { pages: pdf.pdf.numPages, title: null, doi: null, arxiv: null, outline: [], headings: [], references: [], referencesSource: "none", metadata: null } } : l)))
      .finally(() => !cancelled && setAnalyzing(false));
    return () => {
      cancelled = true;
    };
  }, [needsInfo, isScan, pdf, id]);

  // While a scanned paper is being read, its counts are kept up to date (the reading itself is a job that lives outside this page).
  const scanRunning = !!myJob && myJob.step === "scanning";
  useEffect(() => {
    if (!isScan || !scanRunning) return;
    const t = window.setInterval(() => {
      void fetchScan(id).then((scan) => scan && setLoad((l) => (l.status === "ready" ? { ...l, scan } : l)), () => {});
    }, 3000);
    return () => window.clearInterval(t);
  }, [isScan, scanRunning, id]);

  // When a re-index finishes, pick up the new status.
  const wasReindexing = useRef(false);
  useEffect(() => {
    if (wasReindexing.current && !reindexing) void fetchIt();
    wasReindexing.current = reindexing;
  }, [reindexing, fetchIt]);

  const resumed = useRef<string | null>(null);
  useEffect(() => {
    if (pdf.status !== "ready" || load.status !== "ready" || resumed.current === id) return;
    resumed.current = id;
    const jump = takeJump(id);
    const wanted = jump?.page ?? (load.doc.lastPage && load.doc.lastPage > 1 ? load.doc.lastPage : null);
    const target = wanted ? Math.min(wanted, pdf.pdf.numPages) : null;
    if (!target || target < 1 || (target === 1 && !jump?.quote)) return void setTracking(true);
    let tries = 0;
    let timer = 0;
    // the viewer is a lazy chunk: wait until it is there, go to the page at once, and once more when the pages near it have taken their real size
    const go = () => {
      const v = viewer.current;
      if (!v) {
        if (tries++ < 40) timer = window.setTimeout(go, 100);
        else setTracking(true);
        return;
      }
      v.goTo(target, jump?.quote, true);
      if (!jump && target > 1) setResumedFrom(target);
      timer = window.setTimeout(() => {
        stop();
        viewer.current?.goTo(target, jump?.quote, true);
        setTracking(true);
      }, 500);
      // if the reader does anything in that half second the second go is dropped: it must never pull them back
      window.addEventListener("pointerdown", mine, true);
      window.addEventListener("wheel", mine, true);
      window.addEventListener("keydown", mine, true);
    };
    const events = ["pointerdown", "wheel", "keydown"] as const;
    const stop = () => events.forEach((e) => window.removeEventListener(e, mine, true));
    const mine = () => {
      window.clearTimeout(timer);
      stop();
      setTracking(true);
    };
    go();
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [pdf, load.status, id]);
  useEffect(() => {
    if (!resumedFrom) return;
    const t = window.setTimeout(() => setResumedFrom(null), 10_000);
    return () => window.clearTimeout(t);
  }, [resumedFrom]);

  // the place is saved two seconds after the reader stops turning pages, when they leave the paper, and when the tab is hidden
  const pageNow = useRef(1);
  pageNow.current = page;
  const sent = useRef<number | null>(null);
  const flush = useCallback((keepalive: boolean) => {
    if (!tracking || sent.current === pageNow.current) return;
    sent.current = pageNow.current;
    postProgress(id, pageNow.current, keepalive);
  }, [id, tracking]);
  useEffect(() => {
    if (!tracking) return;
    const t = window.setTimeout(() => flush(false), sent.current === null ? 0 : 2000);
    return () => window.clearTimeout(t);
  }, [page, tracking, flush]);
  useEffect(() => {
    if (!tracking) return;
    const hide = () => document.visibilityState === "hidden" && flush(true);
    const leave = () => flush(true);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave);
      flush(true);
    };
  }, [tracking, flush]);

  const onCite = useCallback((c: Citation) => {
    setTab("paper");
    window.setTimeout(() => viewer.current?.goTo(c.page, c.quote), 120);
  }, []);

  const onGoToNote = useCallback((n: DocNote) => {
    setTab("paper");
    window.setTimeout(() => viewer.current?.goTo(n.page, n.quote), 120);
  }, []);

  const addNote = notes.add;
  const updateNote = notes.update;
  const existing = notes.notes;
  const openNote = useCallback((noteId: string) => {
    setFocusNote((f) => ({ id: noteId, tick: (f?.tick ?? 0) + 1 }));
    setSide("notes");
    setTab("side");
  }, []);
  const onCreateNote = useCallback(
    async (n: NewNote) => {
      // Highlights may overlap, but the same text is never drawn twice: see planNewHighlight.
      const plan = planNewHighlight(existing, n);
      if (plan.action === "open") return openNote(plan.id);
      if (plan.action === "recolor") return void (await updateNote(plan.id, { color: n.color }));
      if (plan.action === "skip") return showNotice("That text is already highlighted in this colour.");
      const saved = await addNote({ page: n.page, quote: n.quote, color: n.color });
      if (saved && n.withNote) openNote(saved.id);
    },
    [addNote, updateNote, existing, openNote],
  );

  /** The reader corrected the reference list: keep it with the paper (the server cleans it), and the panel checks it. */
  const onUseReferenceList = useCallback(
    async (entries: string[]) => {
      if (load.status !== "ready" || !load.info) return;
      const next: PaperInfo = { ...load.info, references: entries, referencesSource: "pdf" };
      const saved = await savePaperInfo(id, next).catch(() => null);
      setLoad((l) => (l.status === "ready" ? { ...l, info: saved?.info ?? next } : l));
      if (!saved) showNotice("The list is being checked, but it could not be saved with the paper. It will be read from the PDF again next time.");
    },
    [id, load],
  );

  const onGoToPage = useCallback((page: number) => {
    setTab("paper");
    window.setTimeout(() => viewer.current?.goTo(page), 120);
  }, []);

  // what the command palette (Ctrl+K) can do while this paper is open
  const doc0 = load.status === "ready" ? load.doc : null;
  const hasOthers = otherPapers.length > 0;
  useEffect(() => {
    if (!doc0) return;
    return registerCommands({
      id: "reader",
      commands: () => [
        { id: "r-focus", label: focus ? "Leave focus mode" : "Focus mode: paper on the whole window", group: "This paper", keywords: "focus full width reading side panel hide", hint: "F", run: toggleFocus },
        ...(pdf.status === "ready" ? [
          { id: "r-draw", label: "Draw, highlight and write on the paper", group: "This paper", keywords: "pen highlighter tools annotate shapes text note lasso", run: () => viewer.current?.toggleDraw() },
          { id: "r-find", label: "Find in this paper", group: "This paper", keywords: "search", hint: "Ctrl+F", run: () => viewer.current?.find() },
          { id: "r-pdf", label: "Download a copy with my marks", group: "This paper", keywords: "annotated pdf export save", run: () => window.dispatchEvent(new Event("scholar:annotated")) },
        ] : []),
        { id: "r-ask", label: "Ask this paper a question", group: "This paper", keywords: "chat questions", run: () => { setSide("ask"); setTab("side"); if (focus) toggleFocus(); } },
        { id: "r-notes", label: "Show my highlights and notes", group: "This paper", keywords: "notes colours legend", run: () => { setSide("notes"); setTab("side"); if (focus) toggleFocus(); } },
        { id: "r-refs", label: "Show the references of this paper", group: "This paper", keywords: "bibliography", run: () => { setSide("refs"); setTab("side"); if (focus) toggleFocus(); } },
        ...(PARKED.splitView && split ? [{ id: "r-split-off", label: "Close the second paper", group: "This paper", keywords: "split beside compare", run: () => setSplit(null) }] : []),
        ...(PARKED.splitView && !split && hasOthers ? [{ id: "r-split", label: "Open another paper beside this one", group: "This paper", keywords: "split compare two side by side", run: () => document.getElementById("dw-split-btn")?.click() }] : []),
        { id: "r-back", label: `Back to ${PAPERS_NAME}`, group: "This paper", keywords: "close list", run: onBack },
      ],
      dynamic: (q) => {
        const n = /^\s*(?:p(?:age)?\s*)?(\d{1,4})\s*$/i.exec(q)?.[1];
        const total = pdf.status === "ready" ? pdf.pdf.numPages : 0;
        return n && total > 0 && Number(n) >= 1 && Number(n) <= total ? [{ id: "r-page", label: `Go to page ${Number(n)} of ${total}`, group: "This paper", run: () => viewer.current?.goTo(Number(n)) }] : [];
      },
    });
  }, [doc0, focus, split, hasOthers, pdf, toggleFocus, onBack]);
  // F: focus mode (not while typing, not with a modifier)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "f" || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      e.preventDefault();
      toggleFocus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFocus]);

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
              <span>Back to {PAPERS_NAME}</span>
            </button>
            {!load.notFound && authStatus === "ready" && user && (
              <button type="button" className="btn btn-ghost" onClick={() => { setLoad({ status: "loading" }); void fetchIt(); }}>Try again</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const { doc, history, info, scan } = load;
  const meta = info?.metadata;
  const refCount = info?.references.length ?? 0;
  return (
    <m.div className="dw" data-focus={focus} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: easeOut }}>
      <div className="dw-head">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          <ArrowLeft size={15} aria-hidden="true" />
          <span>{PAPERS_NAME}</span>
        </button>
        <div className="dw-titles">
          <TitleEditor doc={doc} onChange={(d) => setLoad({ status: "ready", doc: d, history, info, scan })} />
          <p className="dw-meta">
            {doc.pages ? `${doc.pages} pages · ` : ""}
            {doc.status === "ready" ? `${doc.chunkCount} passages ${doc.scanned ? "read from a scan" : "indexed"}` : doc.status === "failed" ? "Not indexed" : doc.scanned ? "Reading the scanned pages" : "Indexing"}
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
        <div className="dw-head-end">
          <DocMeta doc={doc} onChange={(d) => setLoad((l) => (l.status === "ready" ? { ...l, doc: { ...l.doc, readState: d.readState, tags: d.tags } } : l))} />
          <button type="button" className="icon-btn icon-btn-sm dw-focus-btn" aria-pressed={focus} aria-keyshortcuts="F" aria-label="Focus mode" title={focus ? "Bring the side panel back (F)" : "Paper on the whole window (F)"} onClick={toggleFocus}>
            {focus ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
          </button>
          {PARKED.splitView && (split ? (
            <button type="button" id="dw-split-btn" className="icon-btn icon-btn-sm dw-split-btn" aria-pressed="true" aria-label="Close the second paper" title="Close the second paper" onClick={() => setSplit(null)}>
              <Columns2 size={16} aria-hidden="true" />
            </button>
          ) : (
            <Pop
              label="Open another paper beside this one"
              align="end"
              trigger={() => (
                <button type="button" id="dw-split-btn" className="icon-btn icon-btn-sm dw-split-btn" aria-label="Open another paper beside this one" title="Open another paper beside this one">
                  <Columns2 size={16} aria-hidden="true" />
                </button>
              )}
            >
              {(close) => (
                <div className="split-pick">
                  <p className="pop-title">Compare with</p>
                  {otherPapers.length === 0 ? (
                    <p className="meta-fine">You have no other paper that is ready. Add one in {PAPERS_NAME} first.</p>
                  ) : (
                    <ul className="split-list" aria-label="Your other papers">
                      {otherPapers.map((d) => (
                        <li key={d.id}>
                          <button type="button" className="split-item" onClick={() => { setSplit(d.id); close(); }}>
                            <span>{d.title}</span>
                            {d.tags.length > 0 && <small>{d.tags.join(", ")}</small>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Pop>
          ))}
          <ThemeSwitch scope="reader" />
        </div>
      </div>

      {!online && (
        <p className="offline-banner" role="status">You are offline. You can keep reading and drawing; what you draw is kept on this device and sent when you are back online.</p>
      )}

      {doc.scanned && scan && (
        <ScanBanner
          doc={doc}
          scan={scan}
          running={scanRunning}
          onContinue={() => void continueScan(doc)}
          onPause={() => myJob && pauseScan(myJob.key)}
          onGo={onGoToPage}
        />
      )}

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
              {active && <m.span layoutId="dw-tab-pill" className="dw-tab-pill" transition={spring} />}
              <Icon size={16} aria-hidden="true" />
              <span className="dw-tab-label">{label}</span>
              {t === "refs" && refCount > 0 && <span className="dw-tab-n">{refCount}</span>}
              {t === "notes" && notes.notes.length > 0 && <span className="dw-tab-n">{notes.notes.length}</span>}
            </button>
          );
        })}
      </div>

      <div className="dw-grid">
        <div id="dw-panel-paper" role="tabpanel" aria-labelledby="dw-tab-paper" className="dw-panel dw-paper" data-active={tab === "paper"} data-split={!!split}>
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
                  <PdfViewer ref={viewer} pdf={pdf.pdf} title={doc.title} docId={doc.id} downloadHref={fileUrl(doc.id)} onPage={setPage} contents={contentsOf(info)} notes={notes.notes} onCreateNote={(n) => void onCreateNote(n)} focusNoteId={focusNote?.id ?? null} onOpenNote={openNote} ink={ink} />
                </Suspense>
              </m.div>
            )}
          </AnimatePresence>
          {PARKED.splitView && split && pdf.status === "ready" && <SecondPaper key={split} docId={split} onClose={() => setSplit(null)} />}
          {pdf.status === "ready" && <p className="sr-only" aria-live="polite">Page {page} of {pdf.pdf.numPages}</p>}
          <AnimatePresence>
            {resumedFrom && (
              <m.div className="dw-resume" role="status" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.25, ease: easeOut }}>
                <span>Continued from page {resumedFrom}</span>
                <button type="button" className="link-btn" onClick={() => { viewer.current?.goTo(1); setResumedFrom(null); }}>Back to page 1</button>
                <button type="button" className="icon-btn icon-btn-sm" aria-label="Dismiss" onClick={() => setResumedFrom(null)}><X size={14} aria-hidden="true" /></button>
              </m.div>
            )}
          </AnimatePresence>
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
            <AskPanel doc={doc} history={history} notes={notes.notes} scan={doc.scanned ? scan : null} onCite={onCite} onGoToPage={onGoToPage} onReindex={() => void (doc.scanned ? continueScan(doc) : reindexDoc(doc))} />
            {reindexing && (
              <p className="ask-fine" role="status">
                <Loader2 className="spin" size={13} aria-hidden="true" /> Indexing again…
              </p>
            )}
          </div>
          <div className="dw-side" hidden={side !== "refs"}>
            <ReferencesPanel
              info={info}
              analyzing={analyzing || (needsInfo && pdf.status !== "error")}
              pdf={pdf.status === "ready" ? pdf.pdf : null}
              scanDocId={doc.scanned ? doc.id : undefined}
              waiting={scanLeft > 0 ? `The references are looked for when every page has been read (${scanLeft} ${scanLeft === 1 ? "page is" : "pages are"} still to be read).` : undefined}
              onOpenPage={onGoToPage}
              onUseList={onUseReferenceList}
            />
          </div>
          <div className="dw-side" hidden={side !== "notes"}>
            <NotesPanel doc={doc} api={notes} focusId={focusNote?.id ?? null} focusTick={focusNote?.tick ?? 0} onGo={onGoToNote} onFocusDone={(id) => setFocusNote((f) => (f?.id === id ? null : f))} />
          </div>
        </div>
      </div>
    </m.div>
  );
}
