import { AnimatePresence, m } from "motion/react";
import { ArrowLeft, BookMarked, ExternalLink, FileWarning, Highlighter, Maximize2, Minimize2, X } from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { NOTE_COLORS, planNewHighlight, type Answer, type Citation, type DocNote, type DocumentInfo, type NoteColor, type PaperInfo, type ScanInfo } from "@scholar/shared";
import { fileUrl } from "../../../lib/documents";
import { registerCommands } from "../../../lib/commands";
import { copyText } from "../../../lib/copy";
import { VIEW_KEY, WIDE_QUERY, fitView, setDeskOpen, startView, useWide, viewsFor, type DeskView } from "../../../lib/desk";
import { deskToolKey, inTextField, type DeskTool } from "../../../lib/desk-keys";
import { toggleFullscreen } from "../../../lib/fullscreen";
import type { InkApi } from "../../../lib/ink";
import { MEANINGS } from "../../../lib/meanings";
import { easeOut, spring } from "../../../lib/motion";
import type { NotesApi } from "../../../lib/notes";
import { showNotice } from "../../../lib/notice";
import { openOaAsk } from "../../../lib/oa-ask";
import { toggleSaved } from "../../../lib/library";
import { toast } from "../../../lib/toast";
import type { useVerify, VerifyItem } from "../../../lib/verify";
import { PAPERS_NAME } from "../../../lib/workspace";
import { Announcer, announce } from "../../../workspace/announcer";
import { ThemeSwitch } from "../../ThemeSwitch";
import { DocMeta } from "../DocMeta";
import { NotesPanel } from "../NotesPanel";
import type { DeskSlots, NewNote, ViewerHandle } from "../PdfViewer";
import { OpeningPaper, TitleEditor, authorsLine, contentsOf, type Pdf } from "../ReaderParts";
import { ReferencesPanel } from "../ReferencesPanel";
import { ScanBanner } from "../ScanBanner";
import type { AgentsDrawerProps } from "./AgentsDrawer";
import { AgentsFab, DownloadMenu, MeaningPicker, SIDE_KEY, SplitDivider, Toasts, ToolSegment, ViewSwitch, clampSide } from "./DeskBits";
import { SelectionPopup, type PopupActions } from "./SelectionPopup";
import "./desk.css";

const PdfViewer = lazy(() => import("../PdfViewer").then((mod) => ({ default: mod.PdfViewer })));
// the Agents drawer (with the Ask panel) is the "agents" chunk: fetched when the button is first pressed, or a little after the paper is open
const loadAgents = () => import("./AgentsDrawer");
const AgentsDrawer = lazy(() => loadAgents().then((mod) => ({ default: mod.AgentsDrawer })));

/** What the page (DocWorkspace, which keeps the paper, its notes and its drawing) hands the new reader. */
export type DeskProps = {
  doc: DocumentInfo;
  history: Answer[];
  info: PaperInfo | null;
  scan: ScanInfo | null;
  onDoc: (d: DocumentInfo) => void;
  pdf: Pdf;
  notes: NotesApi;
  ink: InkApi;
  viewer: RefObject<ViewerHandle | null>;
  page: number;
  onPage: (n: number) => void;
  focusNote: { id: string; tick: number } | null;
  setFocusNote: (f: (cur: { id: string; tick: number } | null) => { id: string; tick: number } | null) => void;
  resumedFrom: number | null;
  setResumedFrom: (n: number | null) => void;
  fs: { available: boolean; on: boolean };
  onBack: () => void;
  online: boolean;
  verify: ReturnType<typeof useVerify>;
  citeRefs: string[] | null;
  itemOf: (i: number) => VerifyItem | undefined;
  savedIds: ReadonlySet<string>;
  analyzing: boolean;
  scanLeft: number;
  scanRunning: boolean;
  reindexing: boolean;
  onContinueScan: () => void;
  onPauseScan: () => void;
  onReindex: () => void;
  onUseReferenceList: (entries: string[]) => Promise<void>;
};

type PanelTab = "highlights" | "refs";
const MEANING_KEY = "scholar.meaning";
const readStore = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeStore = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* private mode: only for this visit */
  }
};
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/**
 * The new Paper Reader, phase 1 "Desk" (docs/design/paper-reader.md): the view switch with the phone rule, the panel tabs Highlights and References, the tool segment (Select, Highlight,
 * Draw) with the meaning picker, the selection pop-up with Explain and Copy, the Download menu, toasts with Undo, and the Agents button with its drawer (Ask). Drawn instead of today's
 * reader only when the server's READER switch puts this account in; the paper, its notes and its drawing are still kept by DocWorkspace.
 */
export function Desk(props: DeskProps) {
  const { doc, history, info, scan, pdf, notes, ink, viewer, fs, onBack, online, verify, citeRefs, itemOf, savedIds, focusNote, setFocusNote, resumedFrom, setResumedFrom } = props;
  const wide = useWide();

  /* ---- the view ---- */
  const [view, setViewState] = useState<DeskView>(() => startView(readStore, typeof matchMedia === "function" ? matchMedia(WIDE_QUERY).matches : true));
  // the old key is read once: from now on the choice is kept under the new one
  useEffect(() => {
    if (readStore(VIEW_KEY) === null) writeStore(VIEW_KEY, view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setView = useCallback((v: DeskView) => {
    setViewState(v);
    writeStore(VIEW_KEY, v);
  }, []);
  // a screen that turns from wide to phone (a rotation, a window dragged narrow) while in Split shows Paper; the kept choice is left as it is
  useEffect(() => {
    if (!wide && view === "split") setViewState("paper");
  }, [wide, view]);
  const shown = fitView(view, wide);
  const [tab, setTab] = useState<PanelTab>("highlights");

  /* ---- the panel's width in Split, kept on this device ---- */
  const [sideW, setSideW] = useState<number | null>(() => {
    const v = Number(readStore(SIDE_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  });
  const sideEl = useRef<HTMLDivElement>(null);
  const onSideW = useCallback((px: number) => {
    setSideW(px);
    writeStore(SIDE_KEY, String(px));
  }, []);
  useEffect(() => {
    if (sideW === null) return;
    const fit = () => setSideW((w) => (w === null ? w : clampSide(w, window.innerWidth)));
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [sideW === null]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- a phone: the panel takes the height under the header ---- */
  const gridEl = useRef<HTMLDivElement>(null);
  const deskEl = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const desk = deskEl.current;
    if (wide || !desk) return void desk?.style.removeProperty("--desk-phone-h");
    const fit = () => {
      const g = gridEl.current;
      if (!g) return;
      const top = g.getBoundingClientRect().top + window.scrollY;
      desk.style.setProperty("--desk-phone-h", `${Math.max(256, Math.round(window.innerHeight - top - 12))}px`);
    };
    fit();
    const head = desk.querySelector(".desk-head");
    const ro = new ResizeObserver(fit);
    if (head) ro.observe(head);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [wide, online, scan]);

  /* ---- the new reader is on screen: the colours carry their meanings (lib/legend.ts) and the shortcut list has its keys ---- */
  useEffect(() => {
    setDeskOpen(true);
    return () => setDeskOpen(false);
  }, []);

  /* ---- the tool in hand ---- */
  const [mode, setMode] = useState<"select" | "highlight">("select");
  const [meaning, setMeaningState] = useState<NoteColor>(() => {
    const v = readStore(MEANING_KEY);
    return (NOTE_COLORS as readonly string[]).includes(v ?? "") ? (v as NoteColor) : "yellow";
  });
  const setMeaning = useCallback((c: NoteColor) => {
    setMeaningState(c);
    writeStore(MEANING_KEY, c);
  }, []);
  const [drawOpen, setDrawOpen] = useState(false);
  const drawApi = useRef<{ toggle: () => void; close: () => void } | null>(null);
  const pickTool = useCallback(
    (t: DeskTool) => {
      if (t === "draw") {
        if (!drawOpen) (drawApi.current?.toggle ?? viewer.current?.toggleDraw)?.();
        return;
      }
      if (drawOpen) drawApi.current?.close();
      setMode(t);
      if (t === "highlight") announce(`Highlight: what you select is highlighted as ${MEANINGS[meaning].name}`);
      else announce("Select: a selection shows what can be done with it");
    },
    [drawOpen, meaning, viewer],
  );
  // V, H and D, when the focus is not in a text field (inside the open Draw toolbar the letters stay the drawing tools)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = deskToolKey(e, { drawOpen, typing: inTextField(e.target) });
      if (!t) return;
      e.preventDefault();
      pickTool(t);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawOpen, pickTool]);

  /* ---- the Agents ---- */
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [agentsEver, setAgentsEver] = useState(false);
  const [prefill, setPrefill] = useState({ text: "", tick: 0 });
  const fab = useRef<HTMLButtonElement>(null);
  const openAgents = useCallback(() => {
    setAgentsEver(true);
    setAgentsOpen(true);
  }, []);
  const closeAgents = useCallback(() => {
    setAgentsOpen(false);
    window.setTimeout(() => fab.current?.focus({ preventScroll: true }), 0);
  }, []);
  // the drawer's chunk is fetched in idle time once the paper is open, so the first press does not wait for it
  useEffect(() => {
    const t = window.setTimeout(() => void loadAgents().catch(() => {}), 2500);
    return () => window.clearTimeout(t);
  }, []);

  /* ---- what is shown where: the paper (Paper or Split), or the panel (Notes) ---- */
  const showPaper = useCallback(() => {
    if (shown === "notes") setView(wide ? "split" : "paper");
  }, [shown, wide, setView]);
  const showPanel = useCallback(
    (t: PanelTab) => {
      setTab(t);
      if (shown === "paper") setView(wide ? "split" : "notes");
    },
    [shown, wide, setView],
  );
  const goTo = useCallback(
    (page: number, quote?: string) => {
      showPaper();
      // on a phone the sheet covers the paper: it goes, and the paper is shown
      if (!wide) setAgentsOpen(false);
      window.setTimeout(() => viewer.current?.goTo(page, quote), 120);
    },
    [showPaper, wide, viewer],
  );
  const onCite = useCallback((c: Citation) => goTo(c.page, c.quote), [goTo]);
  const onGoToNote = useCallback((n: DocNote) => goTo(n.page, n.quote), [goTo]);
  const onGoToPage = useCallback((p: number) => goTo(p), [goTo]);
  const openNote = useCallback(
    (noteId: string) => {
      setFocusNote((f) => ({ id: noteId, tick: (f?.tick ?? 0) + 1 }));
      showPanel("highlights");
    },
    [setFocusNote, showPanel],
  );
  const onShowInList = useCallback(
    (i: number, page: number | null) => {
      const entry = citeRefs?.[i];
      if (page && entry) return void viewer.current?.goTo(page, entry.split(/\s+/).slice(0, 10).join(" "));
      showPanel("refs");
      window.setTimeout(() => {
        const card = document.querySelector<HTMLElement>(`.refs-list [data-ref-id="${i}"]`);
        card?.scrollIntoView({ block: "center", behavior: "smooth" });
        card?.classList.add("ref-flash");
        window.setTimeout(() => card?.classList.remove("ref-flash"), 1600);
      }, 180);
    },
    [citeRefs, viewer, showPanel],
  );

  /* ---- highlights ---- */
  const { add: addNote, update: updateNote, remove: removeNote, notes: existing } = notes;
  const onCreateNote = useCallback(
    async (n: NewNote) => {
      // highlights may overlap, but the same text is never drawn twice (planNewHighlight)
      const plan = planNewHighlight(existing, n);
      if (plan.action === "open") return openNote(plan.id);
      if (plan.action === "recolor") {
        await updateNote(plan.id, { color: n.color });
        return void announce(`Now ${MEANINGS[n.color].name}`);
      }
      if (plan.action === "skip") return void toast(`That text is already highlighted as ${MEANINGS[n.color].name}.`);
      const saved = await addNote({ page: n.page, quote: n.quote, color: n.color });
      if (saved && n.withNote) openNote(saved.id);
      else if (saved) announce(`Highlighted as ${MEANINGS[n.color].name}`);
    },
    [existing, addNote, updateNote, openNote],
  );
  const actions: PopupActions = useMemo(
    () => ({
      meaning,
      explain: (quote) => {
        // phase 1: Explain is Ask with the selection put into the question box (the Explain agent comes in phase 3)
        setPrefill((p) => ({ text: `Explain: "${clip(quote.replace(/\s+/g, " ").trim(), 560)}"`, tick: p.tick + 1 }));
        openAgents();
      },
      copy: (quote) => {
        void copyText(quote).then((ok) => {
          if (ok) toast("Copied");
          else showNotice("Could not copy. Select the text and press Ctrl+C.");
        });
      },
      recolor: (note, color) => {
        void updateNote(note.id, { color }).then(() => announce(`Now ${MEANINGS[color].name}`));
      },
      remove: (note) => {
        void removeNote(note.id).then((gone) => {
          if (!gone) return;
          toast("Highlight removed", { label: "Undo", run: () => void addNote({ page: note.page, quote: note.quote, color: note.color, note: note.note }).then((back) => back && announce("The highlight is back")) });
        });
      },
      openNote: (note) => openNote(note.id),
    }),
    [meaning, openAgents, updateNote, removeNote, addNote, openNote],
  );

  /* ---- the Agents button keeps clear of the pop-up and the toast ---- */
  const [popRect, setPopRect] = useState<DOMRect | null>(null);
  const [toastRect, setToastRect] = useState<DOMRect | null>(null);
  const [lift, setLift] = useState(0);
  useLayoutEffect(() => {
    const el = fab.current;
    if (!el || el.hidden) return setLift(0);
    // where the button stands when it is not lifted (its transform moves it; its layout box does not)
    const style = getComputedStyle(el);
    const bottom = window.innerHeight - parseFloat(style.bottom || "0");
    const right = window.innerWidth - parseFloat(style.right || "0");
    const left = right - el.offsetWidth;
    const top = bottom - el.offsetHeight;
    let need = 0;
    for (const r of [popRect, toastRect]) {
      if (!r || r.width === 0) continue;
      const across = r.left < right + 8 && r.right > left - 8;
      const below = r.bottom > top - 8;
      if (across && below) need = Math.max(need, bottom - r.top + 12);
    }
    setLift(need);
  }, [popRect, toastRect, wide, agentsOpen, drawOpen]);

  /* ---- the palette (Ctrl+K) ---- */
  const pdfReady = pdf.status === "ready";
  const numPages = pdfReady ? pdf.pdf.numPages : 0;
  useEffect(() => {
    return registerCommands({
      id: "reader",
      commands: () => [
        ...(fs.available && wide ? [{ id: "r-full", label: fs.on ? "Leave full screen" : "Full screen", group: "This paper", keywords: "fullscreen full screen whole screen reading focus maximize", hint: "F", run: toggleFullscreen }] : []),
        { id: "r-agents", label: "Agents", group: "This paper", keywords: "ask question ai explain chat agents assistant", run: openAgents },
        { id: "r-ask", label: "Ask this paper a question", group: "This paper", keywords: "chat questions agents", run: openAgents },
        { id: "r-view-paper", label: "Paper view", group: "This paper", keywords: "view paper only wide", run: () => setView("paper") },
        ...(wide ? [{ id: "r-view-split", label: "Split view: the paper and the notes side by side", group: "This paper", keywords: "view split side by side panel", run: () => setView("split") }] : []),
        { id: "r-view-notes", label: "Notes view", group: "This paper", keywords: "view notes highlights references panel", run: () => setView("notes") },
        ...(pdfReady
          ? [
              { id: "r-select", label: "Select and read", group: "This paper", keywords: "tool select pointer", hint: "V", run: () => pickTool("select") },
              { id: "r-highlight", label: "Highlight mode: every selection becomes a highlight", group: "This paper", keywords: "tool highlight marker meaning", hint: "H", run: () => pickTool("highlight") },
              { id: "r-draw", label: "Draw, highlight and write on the paper", group: "This paper", keywords: "pen highlighter tools annotate shapes text note lasso", hint: "D", run: () => pickTool("draw") },
              { id: "r-find", label: "Find in this paper", group: "This paper", keywords: "search", hint: "Ctrl+F", run: () => viewer.current?.find() },
              { id: "r-pdf", label: "Download a copy with my marks", group: "This paper", keywords: "annotated pdf export save", run: () => window.dispatchEvent(new Event("scholar:annotated")) },
            ]
          : []),
        { id: "r-notes", label: "Show my highlights", group: "This paper", keywords: "notes colours meanings highlights", run: () => showPanel("highlights") },
        { id: "r-refs", label: "Show the references of this paper", group: "This paper", keywords: "bibliography", run: () => showPanel("refs") },
        { id: "r-back", label: `Back to ${PAPERS_NAME}`, group: "This paper", keywords: "close list", run: onBack },
      ],
      dynamic: (q) => {
        const n = /^\s*(?:p(?:age)?\s*)?(\d{1,4})\s*$/i.exec(q)?.[1];
        return n && numPages > 0 && Number(n) >= 1 && Number(n) <= numPages ? [{ id: "r-page", label: `Go to page ${Number(n)} of ${numPages}`, group: "This paper", run: () => goTo(Number(n)) }] : [];
      },
    });
  }, [fs.available, fs.on, wide, pdfReady, numPages, openAgents, setView, pickTool, showPanel, onBack, goTo, viewer]);

  /* ---- what the viewer is given ---- */
  const slots: DeskSlots = useMemo(
    () => ({
      tools: (draw) => {
        drawApi.current = draw;
        return (
          <>
            <ToolSegment tool={draw.open ? "draw" : mode} onTool={pickTool} />
            {mode === "highlight" && !draw.open && <MeaningPicker value={meaning} onChange={setMeaning} />}
          </>
        );
      },
      download: pdfReady ? <DownloadMenu href={fileUrl(doc.id)} title={doc.title} docId={doc.id} pdf={pdf.pdf} notes={notes.notes} strokes={ink.strokes} /> : null,
      highlight: mode === "highlight" ? meaning : null,
      popup: (p) => <SelectionPopup key={p.note?.id ?? "sel"} p={p} wide={wide} actions={actions} onRect={setPopRect} />,
      onDraw: setDrawOpen,
    }),
    [mode, meaning, setMeaning, pickTool, pdfReady, pdf, doc.id, doc.title, notes.notes, ink.strokes, wide, actions],
  );

  const meta = info?.metadata;
  const refCount = info?.references.length ?? 0;
  const views = viewsFor(wide);
  const drawerProps: AgentsDrawerProps = { open: agentsOpen, wide, onClose: closeAgents, doc, history, notes: notes.notes, scan: doc.scanned ? scan : null, onCite, onGoToPage, onReindex: props.onReindex, reindexing: props.reindexing, prefill };

  return (
    <m.div ref={deskEl} className="dw desk" data-view={shown} data-wide={wide} data-drawing={drawOpen} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: easeOut }}>
      <div className="dw-head desk-head">
        <button type="button" className="icon-btn dw-back" aria-label={`Back to ${PAPERS_NAME}`} title={`Back to ${PAPERS_NAME}`} onClick={onBack}>
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <div className="dw-titles">
          <TitleEditor doc={doc} onChange={props.onDoc} />
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
        <div className="dw-head-end desk-head-end">
          <DocMeta doc={doc} onChange={(d) => props.onDoc({ ...doc, readState: d.readState, tags: d.tags })} />
          <ViewSwitch view={shown} views={views} onChange={setView} />
          {fs.available && wide && (
            <button type="button" className="icon-btn icon-btn-sm dw-full-btn" aria-pressed={fs.on} aria-keyshortcuts="F" aria-label="Full screen" title={fs.on ? "Leave full screen (F or Esc)" : "Full screen (F)"} onClick={toggleFullscreen}>
              {fs.on ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
            </button>
          )}
          <ThemeSwitch scope="reader" />
        </div>
      </div>

      {!online && <p className="offline-banner" role="status">You are offline. You can keep reading and drawing; what you draw is kept on this device and sent when you are back online.</p>}
      {doc.scanned && scan && <ScanBanner doc={doc} scan={scan} running={props.scanRunning} onContinue={props.onContinueScan} onPause={props.onPauseScan} onGo={onGoToPage} />}

      <div ref={gridEl} className="dw-grid desk-grid" data-view={shown} data-sized={sideW !== null} style={sideW !== null ? ({ "--desk-side": `${sideW}px` } as React.CSSProperties) : undefined}>
        <div id="dw-panel-paper" className="dw-panel dw-paper" role="region" aria-label="Paper" hidden={shown === "notes"}>
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
                  <PdfViewer
                    ref={viewer}
                    pdf={pdf.pdf}
                    title={doc.title}
                    docId={doc.id}
                    downloadHref={fileUrl(doc.id)}
                    onPage={props.onPage}
                    contents={contentsOf(info)}
                    notes={notes.notes}
                    onCreateNote={(n) => void onCreateNote(n)}
                    focusNoteId={focusNote?.id ?? null}
                    onOpenNote={openNote}
                    ink={ink}
                    citations={citeRefs && citeRefs.length > 0 ? { references: citeRefs, itemOf, bump: verify.bump, onShowInList, online, onAsk: openOaAsk, savedIds, onToggleSave: toggleSaved } : undefined}
                    desk={slots}
                  />
                </Suspense>
              </m.div>
            )}
          </AnimatePresence>
          {pdfReady && <p className="sr-only" aria-live="polite">Page {props.page} of {numPages}</p>}
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

        {shown === "split" && <SplitDivider width={sideW} onWidth={onSideW} panel={() => sideEl.current} />}

        <div ref={sideEl} id="dw-panel-side" className="dw-panel dw-ask desk-side" role="region" aria-label="Notes" hidden={shown === "paper"}>
          <div className="dw-sidehead desk-sidehead">
            <div className="dw-sidetabs" role="tablist" aria-label="Highlights or references">
              {([["highlights", "Highlights", Highlighter], ["refs", "References", BookMarked]] as const).map(([t, label, Icon]) => (
                <button key={t} type="button" role="tab" id={`desk-tab-${t}`} aria-selected={tab === t} aria-controls={`desk-tabpanel-${t}`} tabIndex={tab === t ? 0 : -1} className="dw-sidetab" onClick={() => setTab(t)} onKeyDown={(e) => {
                  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                  e.preventDefault();
                  const next = t === "highlights" ? "refs" : "highlights";
                  setTab(next);
                  window.setTimeout(() => document.getElementById(`desk-tab-${next}`)?.focus(), 0);
                }}>
                  {tab === t && <m.span layoutId="desk-side-pill" className="dw-sidetab-pill" transition={spring} />}
                  <Icon size={15} aria-hidden="true" />
                  <span>{label}</span>
                  {t === "refs" && refCount > 0 && <span className="dw-tab-n">{refCount}</span>}
                  {t === "highlights" && notes.notes.length > 0 && <span className="dw-tab-n">{notes.notes.length}</span>}
                </button>
              ))}
            </div>
          </div>
          {/* Both stay mounted, so references being checked are not lost by switching tabs. */}
          <div className="dw-side desk-tabpanel" id="desk-tabpanel-highlights" role="tabpanel" aria-labelledby="desk-tab-highlights" hidden={tab !== "highlights"}>
            <NotesPanel doc={doc} api={notes} focusId={focusNote?.id ?? null} focusTick={focusNote?.tick ?? 0} onGo={onGoToNote} onFocusDone={(id) => setFocusNote((f) => (f?.id === id ? null : f))} />
          </div>
          <div className="dw-side desk-tabpanel" id="desk-tabpanel-refs" role="tabpanel" aria-labelledby="desk-tab-refs" hidden={tab !== "refs"}>
            <ReferencesPanel
              info={info}
              analyzing={props.analyzing}
              pdf={pdfReady ? pdf.pdf : null}
              scanDocId={doc.scanned ? doc.id : undefined}
              waiting={props.scanLeft > 0 ? `The references are looked for when every page has been read (${props.scanLeft} ${props.scanLeft === 1 ? "page is" : "pages are"} still to be read).` : undefined}
              onOpenPage={onGoToPage}
              onUseList={props.onUseReferenceList}
              verify={verify}
            />
          </div>
        </div>
      </div>

      <AgentsFab open={agentsOpen} wide={wide} lift={agentsOpen ? 0 : lift} hidden={drawOpen} fabRef={fab} onToggle={() => (agentsOpen ? closeAgents() : openAgents())} />
      {agentsEver && (
        <Suspense fallback={null}>
          <AgentsDrawer {...drawerProps} />
        </Suspense>
      )}
      <Toasts onRect={setToastRect} />
      <Announcer />
    </m.div>
  );
}
