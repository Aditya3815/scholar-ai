import { AnimatePresence, m } from "motion/react";
import { ArrowLeft, BookMarked, ExternalLink, FileWarning, Highlighter, Maximize2, Minimize2, NotebookPen, Share2, X } from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { INVITE_PICTURE_MAX_BYTES, INVITE_PICTURE_WIDTH, MAX_SELECTION_CHARS, NOTEBOOK_LIMITS, NOTE_COLORS, ROLE_LABEL, noteAnchor, planNewHighlight, roleAtLeast, type Answer, type Citation, type CommentAnchor, type DocNote, type DocumentInfo, type LivePerson, type NoteColor, type NotebookAgent, type NotebookBlock, type PaperAccess, type ReaderAgent, type PaperInfo, type ScanInfo } from "@scholar/shared";
import { downloadBlob } from "../../../lib/download";
import { useComments } from "../../../lib/comments";
import { leaveShared } from "../../../lib/share";
import { fileUrl } from "../../../lib/documents";
import { renderInvitePicture } from "../../../lib/invite-picture";
import { registerCommands } from "../../../lib/commands";
import { copyText } from "../../../lib/copy";
import { VIEW_KEY, WIDE_QUERY, fitView, setDeskOpen, startView, useWide, viewsFor, type DeskView } from "../../../lib/desk";
import { deskToolKey, inTextField, type DeskTool } from "../../../lib/desk-keys";
import { toggleFullscreen } from "../../../lib/fullscreen";
import type { InkApi } from "../../../lib/ink";
import { MEANINGS } from "../../../lib/meanings";
import { easeOut, spring } from "../../../lib/motion";
// types only: the store's code is the notebook chunk's (a value imported here would pull it into this one)
import type { NbState, NotebookStore } from "../../../lib/notebook";
// types only: the live client is the "live" chunk's
import type { LiveClient, LiveHandlers, LiveState, Where } from "../../../lib/live";
import type { NotebookLive } from "./notebook/Notebook";
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
import { AgentsFab, DownloadMenu, HighlightsExport, MeaningPicker, SIDE_KEY, SplitDivider, Toasts, ToolSegment, ViewSwitch, clampSide } from "./DeskBits";
import { drawCapture } from "../../../lib/capture";
import { CaptureLayer } from "./CaptureLayer";
import { SelectionPopup, type PopupActions } from "./SelectionPopup";
import "./desk.css";
// the Notes tab's styles: the panel opens on it, so they come with the reader and the notes are never drawn unstyled while the notebook chunk arrives
import "./notebook/notebook.css";

const PdfViewer = lazy(() => import("../PdfViewer").then((mod) => ({ default: mod.PdfViewer })));
// the Agents drawer (with the Ask panel) is the "agents" chunk: fetched when the button is first pressed, or a little after the paper is open
const loadAgents = () => import("./AgentsDrawer");
const AgentsDrawer = lazy(() => loadAgents().then((mod) => ({ default: mod.AgentsDrawer })));
// the Notebook (the Notes tab, its store and its Markdown) is the "notebook" chunk: fetched when the panel is shown, when Add to notes is pressed, or a little after the paper is open
const loadNotebook = () => import("./notebook/Notebook");
const NotebookView = lazy(() => loadNotebook().then((mod) => ({ default: mod.Notebook })));
// sharing (docs/design/paper-share.md): the owner's Share dialog ("share" chunk, on the first press of Share), a Viewer's or Commenter's notes ("shared" chunk, when the paper is shared) and
// the comments ("comments" chunk, when they are first opened); none is fetched while sharing is off
const ShareDialog = lazy(() => import("./share/ShareDialog").then((mod) => ({ default: mod.ShareDialog })));
const loadShared = () => import("./share/SharedParts");
const loadComments = () => import("./share/Comments");
const CommentsPanel = lazy(() => loadComments().then((mod) => ({ default: mod.CommentsPanel })));
const ReadNotebook = lazy(() => loadShared().then((mod) => ({ default: mod.ReadNotebook })));
// live presence and live updates (docs/design/paper-live.md): the "live" chunk, fetched only when the server says the paper is live
const loadLive = () => import("./live/Live");
type LiveModule = Awaited<ReturnType<typeof loadLive>>;
const NO_LIVE = () => null;
const NO_SUB = () => () => {};
const herePhrase = (ps: LivePerson[]) => `${ps.map((p) => p.name).join(", ")} ${ps.length === 1 ? "is" : "are"} here`;

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
  /** How this person reaches a paper that is not theirs (docs/design/paper-share.md, 4); null: it is their own. */
  access: PaperAccess | null;
  /** The owner may share it (the server's SHARE switch for this account). */
  canShare: boolean;
  /** The owner's name, for the Share dialog's "You (owner)". */
  myName: string | null;
  /** Live presence and updates are on for this paper (LIVE, docs/design/paper-live.md). */
  live?: boolean;
  /** The room closed this window (access ended): true when the paper still opens for this person (then it connects again); otherwise the page shows "You no longer have access". */
  onAccessLost?: () => Promise<boolean>;
};

type PanelTab = "notes" | "highlights" | "refs";
const TABS: { id: PanelTab; label: string; Icon: typeof Highlighter }[] = [
  { id: "notes", label: "Notes", Icon: NotebookPen },
  { id: "highlights", label: "Highlights", Icon: Highlighter },
  { id: "refs", label: "References", Icon: BookMarked },
];
const NO_NOTEBOOK = () => () => {};
const notebookState = (s: NotebookStore | null): NbState | null => s?.get() ?? null;
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

/**
 * The new Paper Reader, phase 1 "Desk" (docs/design/paper-reader.md): the view switch with the phone rule, the panel tabs Highlights and References, the tool segment (Select, Highlight,
 * Draw) with the meaning picker, the selection pop-up with Explain and Copy, the Download menu, toasts with Undo, and the Agents button with its drawer (Ask). Drawn instead of today's
 * reader only when the server's READER switch puts this account in; the paper, its notes and its drawing are still kept by DocWorkspace.
 */
export function Desk(props: DeskProps) {
  const { doc, history, info, scan, pdf, notes, ink, viewer, fs, onBack, online, verify, citeRefs, itemOf, savedIds, focusNote, setFocusNote, resumedFrom, setResumedFrom } = props;
  const wide = useWide();

  /* ---- a shared paper (docs/design/paper-share.md): what this person's role allows ---- */
  const access = props.access;
  const role = access?.role ?? "owner";
  const isOwner = access === null;
  const canEdit = roleAtLeast(role, "editor");
  const canComment = roleAtLeast(role, "commenter");
  const sharing = props.canShare || !isOwner;
  const comments = useComments(doc.id, sharing);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareEver, setShareEver] = useState(false);
  const shareBtn = useRef<HTMLButtonElement>(null);
  /** The comments in the Notes tab: one thing's threads, or every thread (the Comments filter); null: the notes. */
  const [commentsAt, setCommentsAt] = useState<{ anchor: CommentAnchor | null } | null>(null);
  const [readFocus, setReadFocus] = useState<{ pageId: string; blockId: string; tick: number } | null>(null);

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
  // Notes first (phase 2): the notebook is the panel's first tab
  const [tab, setTab] = useState<PanelTab>("notes");

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
  const [mode, setMode] = useState<"select" | "highlight" | "capture">("select");
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
      // a shared paper: the drawing is the owner's own, and only an Editor highlights
      if (!canEdit || (t === "draw" && !isOwner)) return;
      if (t === "draw") {
        if (!drawOpen) (drawApi.current?.toggle ?? viewer.current?.toggleDraw)?.();
        return;
      }
      if (drawOpen) drawApi.current?.close();
      setMode(t);
      if (t === "highlight") announce(`Highlight: what you select is highlighted as ${MEANINGS[meaning].name}`);
      else if (t === "capture") announce("Capture: drag a frame over a part of a page, or press Enter on a page to place one");
      else announce("Select: a selection shows what can be done with it");
    },
    [drawOpen, meaning, viewer, canEdit, isOwner],
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
  // which agent the drawer shows, and Explain asked from the pop-up (phase 3: the drawer opens on Explain with the selection as its chip; the model is asked only when the person presses Send)
  const [agent, setAgent] = useState<ReaderAgent>("ask");
  const [explainReq, setExplainReq] = useState<{ selection: string; page: number; tick: number } | null>(null);
  const fab = useRef<HTMLButtonElement>(null);
  const openAgents = useCallback(() => {
    setAgentsEver(true);
    setAgentsOpen(true);
  }, []);
  // closed (the drawer's x, Esc): the focus goes back to the Agents button once it is shown again (on a wide screen it is hidden while the drawer is open)
  const refocusFab = useRef(false);
  const closeAgents = useCallback(() => {
    refocusFab.current = true;
    setAgentsOpen(false);
  }, []);
  useEffect(() => {
    if (agentsOpen || !refocusFab.current) return;
    refocusFab.current = false;
    fab.current?.focus({ preventScroll: true });
  }, [agentsOpen]);
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

  /* ---- the Notebook (phase 2): its chunk is loaded when the panel is shown, when Add to notes is pressed, or a little after the paper is open; then the store is made ---- */
  const [nb, setNb] = useState<NotebookStore | null>(null);
  const nbReady = useRef<Promise<NotebookStore> | null>(null);
  const nbStop = useRef<(() => void) | null>(null);
  const ensureNotebook = useCallback((): Promise<NotebookStore> => {
    // a Viewer or a Commenter reads the notes and never writes them: no store, no queue of changes
    if (!canEdit) return Promise.reject(new Error("read only"));
    if (!nbReady.current) {
      const ready = loadNotebook().then(async (mod) => {
        const store = mod.createNotebookStore(doc.id, mod.browserNotebookDeps(() => toast("Updated from another window")));
        if (nbReady.current !== ready) {
          store.destroy();
          throw new Error("left");
        }
        nbStop.current = mod.attachNotebook(store);
        setNb(store);
        await store.load();
        return store;
      });
      ready.catch(() => {
        if (nbReady.current === ready) nbReady.current = null;
      });
      nbReady.current = ready;
    }
    return nbReady.current;
  }, [doc.id, canEdit]);
  useEffect(
    () => () => {
      nbStop.current?.();
      nbStop.current = null;
      nbReady.current = null;
      setNb(null);
    },
    [doc.id],
  );
  useEffect(() => {
    if (shown !== "paper") return void ensureNotebook().catch(() => {});
    const t = window.setTimeout(() => void ensureNotebook().catch(() => {}), 2500);
    return () => window.clearTimeout(t);
  }, [shown, ensureNotebook]);
  const nbState = useSyncExternalStore(nb?.subscribe ?? NO_NOTEBOOK, () => notebookState(nb), () => null);
  // a quote of a highlight that is gone is saved without it (and says "highlight removed")
  useEffect(() => {
    nb?.setKnownNotes(notes.status === "ready" ? new Set(existing.map((n) => n.id)) : null);
  }, [nb, notes.status, existing]);
  const [nbFocus, setNbFocus] = useState<{ blockId: string | null; tick: number } | null>(null);
  /** The Notes tab, on the page and block given (In notes, the toast's Open), or as it is. */
  const openInNotes = useCallback(
    (store: NotebookStore | null, at: { pageId: string; blockId: string } | null) => {
      if (store && at) store.open(at.pageId);
      setTab("notes");
      if (shown === "paper") setView(wide ? "split" : "notes");
      setNbFocus((f) => ({ blockId: at?.blockId ?? null, tick: (f?.tick ?? 0) + 1 }));
    },
    [shown, wide, setView],
  );
  /** A highlight for this text: the one there is (planNewHighlight), or a new one in `color`. null when it could not be made (the notes list says why). */
  const highlightFor = useCallback(
    async (page: number, quote: string, color: NoteColor): Promise<DocNote | null> => {
      const plan = planNewHighlight(existing, { page, quote, color, withNote: false });
      if (plan.action !== "add") return existing.find((n) => n.id === plan.id) ?? null;
      return addNote({ page, quote, color });
    },
    [existing, addNote],
  );
  /** Add to notes: a quote of the highlight on the open page (or where it was dropped), with a toast to undo it; on a phone in Paper view the toast can also open the notes. */
  const quoteToNotes = useCallback(
    async (note: DocNote | null, where?: { pageId: string; index: number }) => {
      if (!note) return void showNotice(notes.error || "That could not be added to your notes.");
      const store = await ensureNotebook().catch(() => null);
      if (!store) return void showNotice("Your notes could not be opened. Check the connection, then try again.");
      const at = store.addQuote({ noteId: note.id, page: note.page, quote: note.quote, color: note.color }, where);
      if (!at) return;
      announce(`Added to ${at.title}`);
      const phonePaper = !wide && shown === "paper";
      toast(`Added to "${at.title}"`, { label: "Undo", run: () => (at.undo(), announce("Taken out of your notes")) }, phonePaper ? { label: "Open", run: () => openInNotes(store, at) } : undefined);
      if (shown !== "paper" && tab === "notes") setNbFocus((f) => ({ blockId: at.blockId, tick: (f?.tick ?? 0) + 1 }));
    },
    [ensureNotebook, notes.error, wide, shown, tab, openInNotes],
  );
  /** "+ Add to notes" on an agent's answer (phase 3): an agent block on the open page, with a toast to undo it (and to open the notes when they are not in sight). */
  const answerToNotes = useCallback(
    async (n: { agent: NotebookAgent; ask: string; md: string; pages: number[] }): Promise<boolean> => {
      const store = await ensureNotebook().catch(() => null);
      if (!store) return (showNotice("Your notes could not be opened. Check the connection, then try again."), false);
      const at = store.insertBlock({ kind: "agent", agent: n.agent, ask: n.ask.replace(/\s+/g, " ").trim().slice(0, NOTEBOOK_LIMITS.ask), md: n.md.slice(0, NOTEBOOK_LIMITS.answer), pages: n.pages.slice(0, NOTEBOOK_LIMITS.answerPages), at: Date.now() });
      if (!at) return false;
      announce(`Added to ${at.title}`);
      const hidden = shown === "paper" || tab !== "notes";
      toast(`Added to "${at.title}"`, { label: "Undo", run: () => (at.undo(), announce("Taken out of your notes")) }, hidden ? { label: "Open", run: () => openInNotes(store, at) } : undefined);
      return true;
    },
    [ensureNotebook, shown, tab, openInNotes],
  );
  /** "Add as a new page" on the Note-taker's draft (phase 3): a new page at the end with the draft's blocks and a line to write on, with a toast to undo it or open it. */
  const draftToNotes = useCallback(
    async (d: { title: string; blocks: NotebookBlock[] }): Promise<string | null> => {
      const store = await ensureNotebook().catch(() => null);
      if (!store) return (showNotice("Your notes could not be opened. Check the connection, then try again."), null);
      const id = store.addPage(d.title, "plain");
      if (!id) return (showNotice(store.get().error ?? "A new page could not be added."), null);
      const tail = `t${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
      store.setBlocks(id, [...d.blocks, { id: tail, kind: "text", md: "" }]);
      const at = { pageId: id, blockId: d.blocks[0]?.id ?? tail };
      announce(`Added as a new page, ${d.title}`);
      toast(`Added "${d.title}" to your notes`, { label: "Undo", run: () => (store.deletePage(id), announce("The page was taken out of your notes")) }, { label: "Open", run: () => openInNotes(store, at) });
      return d.title;
    },
    [ensureNotebook, openInNotes],
  );
  /* ---- Capture (phase 2.5, 21.1, 6): from the paper's tool, or the notes' toolbar (Notes view on a wide screen goes to Split; a phone goes to Paper and comes back after) ---- */
  const captureBack = useRef(false);
  const startCapture = useCallback(() => {
    if (!wide) {
      captureBack.current = shown !== "paper";
      setView("paper");
    } else if (shown === "notes") setView("split");
    pickTool("capture");
  }, [wide, shown, setView, pickTool]);
  const onCaptured = useCallback(
    async (r: { page: number; x: number; y: number; w: number; h: number }) => {
      setMode("select");
      const back = captureBack.current;
      captureBack.current = false;
      const store = await ensureNotebook().catch(() => null);
      if (!store) return void showNotice("Your notes could not be opened. Check the connection, then try again.");
      const at = store.addCapture(r);
      if (!at) return;
      announce(`A part of page ${r.page} is in ${at.title}`);
      toast(`Capture from p. ${r.page} added to "${at.title}"`, { label: "Undo", run: () => (at.undo(), announce("Taken out of your notes")) }, !wide && !back ? { label: "Open", run: () => openInNotes(store, at) } : undefined);
      if (back || (wide && tab === "notes")) openInNotes(store, at);
    },
    [ensureNotebook, wide, tab, openInNotes],
  );
  const paintCapture = useCallback(
    async (canvas: HTMLCanvasElement, b: { page: number; x: number; y: number; w: number; h: number }, cssWidth: number) => {
      if (pdf.status !== "ready") throw new Error("the paper is not open");
      return drawCapture(pdf.pdf, canvas, b.page, b, cssWidth);
    },
    [pdf],
  );
  /** Export ▾ in the notes (21.1, 4): a PDF or a Word file of this page or all pages, made by a lazy chunk (lib/notes-export.ts) that draws the captures from the open paper. */
  const exportNotes = useCallback(
    async (fmt: "pdf" | "docx", pages: { title: string; blocks: NotebookBlock[] }[], docTitle: string, names: Record<NoteColor, string>, all: boolean) => {
      announce(fmt === "pdf" ? "Making the PDF…" : "Making the Word file…");
      const out = await import("../../../lib/notes-export");
      const args = { docTitle, pages, names, pdf: pdf.status === "ready" ? pdf.pdf : null, imageUrl: (id: string) => `/api/v1/documents/${doc.id}/notebook/images/${id}` };
      const name = out.notesFileName(docTitle, all ? null : (pages[0]?.title ?? ""), fmt);
      if (fmt === "pdf") downloadBlob(name, new Blob([(await out.notesPdf(args)) as BlobPart], { type: "application/pdf" }));
      else downloadBlob(name, await out.notesDocx(args));
      toast(fmt === "pdf" ? "The PDF is downloaded" : "The Word file is downloaded");
    },
    [pdf, doc.id],
  );
  /** Pictures in the notes (the owner's yes of 18 Nov): kept under the paper, served only to its owner; the server reads the kind from the bytes and refuses what is not one. */
  const noteImageUrl = useCallback((blockId: string) => `/api/v1/documents/${doc.id}/notebook/images/${blockId}`, [doc.id]);
  const uploadNoteImage = useCallback(
    async (blockId: string, blob: Blob) => {
      const res = await fetch(noteImageUrl(blockId), { method: "PUT", body: blob, credentials: "same-origin", headers: { "Content-Type": blob.type } });
      const body = (await res.json().catch(() => null)) as { w?: number; h?: number; type?: string; title?: string; detail?: string } | null;
      if (!res.ok || !body?.w || !body.h || !body.type) throw new Error(body?.detail ? `${body.title ?? "The picture was not kept"}: ${body.detail}.` : (body?.title ?? "The picture could not be sent. Check the connection, then try again."));
      return { w: body.w, h: body.h, type: body.type };
    },
    [noteImageUrl],
  );
  const showInNotes = useCallback(
    (noteId: string) => {
      void ensureNotebook().then((store) => openInNotes(store, store.findQuote(noteId)));
    },
    [ensureNotebook, openInNotes],
  );
  const onDropQuote = useCallback(
    (d: { noteId: string | null; page: number; quote: string }, pageId: string, index: number) => {
      const known = d.noteId ? existing.find((n) => n.id === d.noteId) : null;
      void (known ? Promise.resolve(known) : highlightFor(d.page, d.quote, meaning)).then((note) => quoteToNotes(note, { pageId, index }));
    },
    [existing, highlightFor, meaning, quoteToNotes],
  );
  const notebookOnCard = useMemo(
    () => ({
      inNotes: (id: string) => !!nbState?.quoted.has(id),
      add: (n: DocNote) => void quoteToNotes(n),
      open: (n: DocNote) => showInNotes(n.id),
    }),
    [nbState, quoteToNotes, showInNotes],
  );

  /* ---- comments (docs/design/paper-share.md, 5): they open in the Notes tab, one thing's threads or all of them ---- */
  const openComments = useCallback(
    (anchor: CommentAnchor | null) => {
      void loadComments().catch(() => {});
      setCommentsAt({ anchor });
      setTab("notes");
      if (shown === "paper") setView(wide ? "split" : "notes");
    },
    [shown, wide, setView],
  );
  const showAnchor = useCallback(
    (a: CommentAnchor) => {
      if (a.startsWith("note:")) {
        const n = existing.find((x) => x.id === a.slice(5));
        if (n) goTo(n.page, n.quote);
        return;
      }
      const [, pageId, blockId] = a.split(":") as [string, string, string];
      setCommentsAt(null);
      if (canEdit) openInNotes(nb, { pageId, blockId });
      else setReadFocus((f) => ({ pageId, blockId, tick: (f?.tick ?? 0) + 1 }));
    },
    [existing, goTo, canEdit, openInNotes, nb],
  );
  const cardComments = useMemo(
    () => (sharing ? { open: (id: string) => comments.openOn(noteAnchor(id)), show: (n: DocNote) => openComments(noteAnchor(n.id)), canWrite: canComment } : undefined),
    [sharing, comments, openComments, canComment],
  );
  const readOnlyCard = useMemo(() => ({ inNotes: () => false, add: () => {}, open: () => {} }), []);
  const blockComments = useMemo(
    () => (sharing ? { openOn: (pageId: string, blockId: string) => comments.openOn(`block:${pageId}:${blockId}`), show: (pageId: string, blockId: string) => openComments(`block:${pageId}:${blockId}`), open: comments.open, showAll: () => openComments(null) } : undefined),
    [sharing, comments, openComments],
  );

  /* ---- live presence and live updates (docs/design/paper-live.md): who is here and where, and other people's saved changes without a reload ---- */
  const [liveMod, setLiveMod] = useState<LiveModule | null>(null);
  useEffect(() => {
    if (!props.live) return;
    let gone = false;
    loadLive().then((mod) => !gone && setLiveMod(mod), () => {});
    return () => {
      gone = true;
    };
  }, [props.live]);
  const liveOn = useRef<LiveHandlers>({});
  const [liveClient, setLiveClient] = useState<LiveClient | null>(null);
  useEffect(() => {
    if (!liveMod) return;
    const c = liveMod.startLive(doc.id, { onChanged: (x) => liveOn.current.onChanged?.(x), onReconnected: () => liveOn.current.onReconnected?.(), onAccessEnded: () => liveOn.current.onAccessEnded?.() });
    setLiveClient(c);
    return () => {
      c.stop();
      setLiveClient(null);
    };
  }, [liveMod, doc.id]);
  const liveState = useSyncExternalStore<LiveState | null>(liveClient?.subscribe ?? NO_SUB, liveClient?.get ?? NO_LIVE, NO_LIVE);
  const livePeople = useMemo(() => liveState?.people ?? [], [liveState]);
  const [readTick, setReadTick] = useState(0);
  // what changed is fetched through its own route, with this person's role (the socket says only that it changed); the handlers see this render's state
  useLayoutEffect(() => {
    liveOn.current = {
      onChanged: (ch) => {
        if (ch.kind === "notebook" || ch.kind === "pages") {
          if (canEdit) void nb?.refresh(ch.kind === "notebook" ? { id: ch.id, rev: ch.rev } : {});
          else setReadTick((t) => t + 1);
        } else if (ch.kind === "highlights") void notes.reload();
        else {
          const before = comments.comments.length;
          void comments.reload().then((list) => {
            // said only while the comments are open, and never for this person's own comment
            if (list && commentsAt && list.length > before && ch.by !== liveState?.me) announce(`${livePeople.find((p) => p.id === ch.by)?.name ?? "Someone"} added a comment`);
          });
        }
      },
      onReconnected: () => {
        void notes.reload();
        if (sharing) void comments.reload();
        if (canEdit) void nb?.refresh();
        else setReadTick((t) => t + 1);
      },
      onAccessEnded: () => {
        void props.onAccessLost?.().then((still) => still && liveClient?.restart());
      },
    };
  });
  // the person is active (a key, the pointer, a scroll), or the tab is hidden: told to the room, at most every 2 s
  useEffect(() => {
    if (!liveClient) return;
    let last = 0;
    const touch = () => {
      const t = Date.now();
      if (t - last < 2000) return;
      last = t;
      liveClient.touch();
    };
    const seen = () => liveClient.visibility();
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true, capture: true });
    document.addEventListener("visibilitychange", seen);
    return () => {
      for (const e of events) window.removeEventListener(e, touch, { capture: true });
      document.removeEventListener("visibilitychange", seen);
    };
  }, [liveClient]);
  // where this window is: the comments, a block being typed in, a notes page, or a page of the paper
  const [typingIn, setTypingIn] = useState<{ pageId: string; blockId: string } | null>(null);
  const onEditing = useCallback((pageId: string | null, blockId: string | null) => setTypingIn(pageId && blockId ? { pageId, blockId } : null), []);
  const panelShown = shown !== "paper" && tab === "notes";
  const where: Where =
    panelShown && commentsAt
      ? { view: "comments" }
      : panelShown && typingIn
        ? { view: "notes", notesPage: typingIn.pageId, editingBlock: typingIn.blockId }
        : shown === "notes" && tab === "notes"
          ? { view: "notes", ...(canEdit && nbState?.openId ? { notesPage: nbState.openId } : {}) }
          : { view: "paper", page: props.page };
  const whereKey = JSON.stringify(where);
  useEffect(() => {
    liveClient?.setWhere(JSON.parse(whereKey) as Where);
  }, [liveClient, whereKey]);
  const pageTitle = useCallback((id: string) => nbState?.pages.find((p) => p.id === id)?.title ?? null, [nbState]);
  const followLive = useCallback(
    (p: LivePerson) => {
      if (p.view === "comments") return openComments(null);
      if (p.view === "notes") {
        const pageId = p.notesPage;
        const blockId = p.editingBlock;
        if (canEdit && pageId) {
          nb?.open(pageId);
          openInNotes(nb, blockId ? { pageId, blockId } : null);
        } else if (pageId && blockId) {
          showPanel("notes");
          setReadFocus((f) => ({ pageId, blockId, tick: (f?.tick ?? 0) + 1 }));
        } else showPanel("notes");
        return;
      }
      if (p.page) goTo(p.page);
      else showPaper();
    },
    [openComments, canEdit, nb, openInNotes, showPanel, goTo, showPaper],
  );
  const nbRef = useRef(nbState);
  nbRef.current = nbState;
  // where this window's cursor is in the block it types in (an Editor's)
  useEffect(() => (liveMod && liveClient && canEdit ? liveMod.watchCaret(liveClient) : undefined), [liveMod, liveClient, canEdit]);
  const notebookLive: NotebookLive | undefined = useMemo(() => {
    if (!liveMod) return undefined;
    const on = (pageId: string) => livePeople.filter((p) => p.view === "notes" && p.notesPage === pageId && !p.idle);
    return {
      tab: (pageId) => {
        const ps = on(pageId);
        return ps.length ? { dots: <liveMod.Dots people={ps} />, label: `, ${herePhrase(ps)}` } : null;
      },
      // the people typing in a block: their avatars and carets (the caret is an offset into the block's Markdown, read from this window's notes when it is drawn)
      editor: (pageId, blockId) => {
        const ps = livePeople.filter((x) => x.notesPage === pageId && x.editingBlock === blockId && !x.idle);
        const md = () => {
          const b = nbRef.current?.pages.find((x) => x.id === pageId)?.blocks.find((x) => x.id === blockId);
          return b && "md" in b ? b.md : "";
        };
        return ps.length ? { colour: ps[0]!.colour, label: <liveMod.EditingMark people={ps} md={md} /> } : null;
      },
      onEditing,
    };
  }, [liveMod, livePeople, onEditing]);
  const thumbMark = useMemo(() => {
    if (!liveMod) return undefined;
    return (n: number) => {
      const ps = livePeople.filter((p) => p.view === "paper" && p.page === n && !p.idle);
      return ps.length ? { node: <liveMod.Dots people={ps} />, label: herePhrase(ps) } : null;
    };
  }, [liveMod, livePeople]);

  const actions: PopupActions = useMemo(
    () => ({
      meaning,
      explain: (quote, page) => {
        // the drawer opens on Explain with the selection (at most 600 characters, cut at a word: the server checks its words are in the paper)
        const flat = quote.replace(/\s+/g, " ").trim();
        const selection = flat.length <= MAX_SELECTION_CHARS ? flat : flat.slice(0, MAX_SELECTION_CHARS).replace(/\s+\S*$/, "");
        setAgent("explain");
        setExplainReq((r) => ({ selection, page, tick: (r?.tick ?? 0) + 1 }));
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
      addToNotes: (p) => {
        if (p.note) return void quoteToNotes(p.note);
        // the selection becomes a highlight: it is let go, so a click on the highlight opens its own pop-up
        window.getSelection()?.removeAllRanges();
        void highlightFor(p.page, p.quote, meaning).then((note) => quoteToNotes(note));
      },
      inNotes: (note) => !!nbState?.quoted.has(note.id),
      showInNotes: (note) => showInNotes(note.id),
      readOnly: !canEdit,
      noExplain: !canComment,
      comment: sharing ? (note) => openComments(noteAnchor(note.id)) : undefined,
    }),
    [meaning, openAgents, updateNote, removeNote, addNote, quoteToNotes, highlightFor, nbState, showInNotes, canEdit, canComment, sharing, openComments],
  );

  /* ---- on a wide screen the drawer starts below the paper's header while that is in sight (the view switch and the theme stay reachable) ---- */
  const [drawerTop, setDrawerTop] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (!agentsOpen || !wide) return;
    const fit = () => setDrawerTop(Math.max(12, Math.round(gridEl.current?.getBoundingClientRect().top ?? 12)));
    fit();
    window.addEventListener("scroll", fit, { passive: true });
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
    };
  }, [agentsOpen, wide]);

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
        ...(canComment
          ? [
              { id: "r-agents", label: "Agents", group: "This paper", keywords: "ask question ai explain chat agents assistant", run: openAgents },
              { id: "r-ask", label: "Ask this paper a question", group: "This paper", keywords: "chat questions agents", run: () => (setAgent("ask"), openAgents()) },
              { id: "r-explain", label: "Explain an idea of this paper", group: "This paper", keywords: "explain plain words simple agents", run: () => (setAgent("explain"), openAgents()) },
              { id: "r-critique", label: "Critique this paper", group: "This paper", keywords: "critique weak points limitations review agents", run: () => (setAgent("critique"), openAgents()) },
              ...(canEdit ? [{ id: "r-notetaker", label: "Note-taker: a draft page from my highlights", group: "This paper", keywords: "note taker notes draft summary highlights agents", run: () => (setAgent("notes"), openAgents()) }] : []),
            ]
          : []),
        ...(isOwner && props.canShare ? [{ id: "r-share", label: "Share this paper", group: "This paper", keywords: "share invite link people collaborate", run: () => (setShareEver(true), setShareOpen(true)) }] : []),
        ...(sharing ? [{ id: "r-comments", label: "Show the comments", group: "This paper", keywords: "comments threads discussion", run: () => openComments(null) }] : []),
        { id: "r-view-paper", label: "Paper view", group: "This paper", keywords: "view paper only wide", run: () => setView("paper") },
        ...(wide ? [{ id: "r-view-split", label: "Split view: the paper and the notes side by side", group: "This paper", keywords: "view split side by side panel", run: () => setView("split") }] : []),
        { id: "r-view-notes", label: "Notes view", group: "This paper", keywords: "view notes highlights references panel", run: () => setView("notes") },
        ...(pdfReady
          ? [
              ...(canEdit
                ? [
                    { id: "r-select", label: "Select and read", group: "This paper", keywords: "tool select pointer", hint: "V", run: () => pickTool("select") },
                    { id: "r-highlight", label: "Highlight mode: every selection becomes a highlight", group: "This paper", keywords: "tool highlight marker meaning", hint: "H", run: () => pickTool("highlight") },
                  ]
                : []),
              ...(isOwner ? [{ id: "r-draw", label: "Draw, highlight and write on the paper", group: "This paper", keywords: "pen highlighter tools annotate shapes text note lasso", hint: "D", run: () => pickTool("draw") }] : []),
              { id: "r-find", label: "Find in this paper", group: "This paper", keywords: "search", hint: "Ctrl+F", run: () => viewer.current?.find() },
              ...(isOwner ? [{ id: "r-pdf", label: "Download a copy with my marks", group: "This paper", keywords: "annotated pdf export save", run: () => window.dispatchEvent(new Event("scholar:annotated")) }] : []),
            ]
          : []),
        { id: "r-notebook", label: "Show my notes", group: "This paper", keywords: "notes notebook pages write", run: () => openInNotes(nb, null) },
        { id: "r-notes", label: "Show my highlights", group: "This paper", keywords: "colours meanings highlights", run: () => showPanel("highlights") },
        { id: "r-refs", label: "Show the references of this paper", group: "This paper", keywords: "bibliography", run: () => showPanel("refs") },
        { id: "r-back", label: `Back to ${PAPERS_NAME}`, group: "This paper", keywords: "close list", run: onBack },
      ],
      dynamic: (q) => {
        const n = /^\s*(?:p(?:age)?\s*)?(\d{1,4})\s*$/i.exec(q)?.[1];
        return n && numPages > 0 && Number(n) >= 1 && Number(n) <= numPages ? [{ id: "r-page", label: `Go to page ${Number(n)} of ${numPages}`, group: "This paper", run: () => goTo(Number(n)) }] : [];
      },
    });
  }, [fs.available, fs.on, wide, pdfReady, numPages, openAgents, setView, pickTool, showPanel, onBack, goTo, viewer, openInNotes, nb, canComment, canEdit, isOwner, props.canShare, sharing, openComments]);

  /* ---- what the viewer is given ---- */
  const slots: DeskSlots = useMemo(
    () => ({
      tools: (draw) => {
        drawApi.current = draw;
        // a Viewer and a Commenter get no tools; an Editor highlights but does not draw (the drawing is the owner's own)
        if (!canEdit) return null;
        return (
          <>
            <ToolSegment tool={draw.open ? "draw" : mode} onTool={pickTool} noDraw={!isOwner} />
            {mode === "highlight" && !draw.open && <MeaningPicker value={meaning} onChange={setMeaning} />}
          </>
        );
      },
      download: pdfReady && (role !== "viewer" || access?.viewersDownload) ? <DownloadMenu href={fileUrl(doc.id)} title={doc.title} docId={doc.id} pdf={pdf.pdf} notes={notes.notes} strokes={ink.strokes} /> : null,
      highlight: canEdit && mode === "highlight" ? meaning : null,
      popup: (p) => <SelectionPopup key={p.note?.id ?? "sel"} p={p} wide={wide} actions={actions} onRect={setPopRect} />,
      onDraw: setDrawOpen,
      quoteDrag: canEdit,
      capture: canEdit && mode === "capture" ? (n) => <CaptureLayer page={n} onCapture={(r) => void onCaptured(r)} onCancel={() => pickTool("select")} /> : undefined,
      thumbMark,
    }),
    [mode, meaning, setMeaning, pickTool, pdfReady, pdf, doc.id, doc.title, notes.notes, ink.strokes, wide, actions, onCaptured, canEdit, isOwner, role, access, thumbMark],
  );

  const meta = info?.metadata;
  const refCount = info?.references.length ?? 0;
  const views = viewsFor(wide);
  const drawerProps: AgentsDrawerProps = {
    open: agentsOpen, wide, onClose: closeAgents, doc, history, notes: notes.notes, scan: doc.scanned ? scan : null, onCite, onGoToPage, onReindex: props.onReindex, reindexing: props.reindexing,
    agent, onAgent: setAgent, explain: explainReq, canWrite: canEdit, onAddToNotes: answerToNotes, onAcceptDraft: draftToNotes, meanings: MEANINGS, top: drawerTop,
  };

  return (
    <m.div ref={deskEl} className="dw desk" data-view={shown} data-wide={wide} data-drawing={drawOpen} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: easeOut }}>
      <div className="dw-head desk-head">
        <button type="button" className="icon-btn dw-back" aria-label={`Back to ${PAPERS_NAME}`} title={`Back to ${PAPERS_NAME}`} onClick={onBack}>
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <div className="dw-titles">
          {isOwner ? <TitleEditor doc={doc} onChange={props.onDoc} /> : <h1 className="dw-title desk-title-read">{doc.title}</h1>}
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
          {isOwner && <DocMeta doc={doc} onChange={(d) => props.onDoc({ ...doc, readState: d.readState, tags: d.tags })} />}
          {/* who else is here: the row keeps its width from the start, so nothing moves when it fills (docs/design/paper-live.md, 5) */}
          {props.live && (liveMod && liveState ? <liveMod.PresenceRow state={liveState} wide={wide} pageTitle={pageTitle} onFollow={followLive} /> : <span className="desk-live-wait" data-wide={wide} aria-hidden="true" />)}
          {isOwner && props.canShare && (
            <button ref={shareBtn} type="button" className="btn btn-ghost btn-sm desk-share-btn" aria-haspopup="dialog" onClick={() => (setShareEver(true), setShareOpen(true))} onPointerEnter={() => void import("./share/ShareDialog").catch(() => {})}>
              <Share2 size={15} aria-hidden="true" />
              <span>Share</span>
            </button>
          )}
          <ViewSwitch view={shown} views={views} onChange={setView} />
          {fs.available && wide && (
            <button type="button" className="icon-btn icon-btn-sm dw-full-btn" aria-pressed={fs.on} aria-keyshortcuts="F" aria-label="Full screen" title={fs.on ? "Leave full screen (F or Esc)" : "Full screen (F)"} onClick={toggleFullscreen}>
              {fs.on ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
            </button>
          )}
          <ThemeSwitch scope="reader" />
        </div>
      </div>

      {access && (
        <p className="desk-shared-banner" role="status">
          <span>
            Shared by <strong>{access.ownerName ?? "someone"}</strong> · You can {access.role === "editor" ? "edit" : access.role === "commenter" ? "comment" : "view"}
            <span className="sr-only"> ({ROLE_LABEL[access.role]})</span>
          </span>
          {access.via === "member" && (
            <button type="button" className="link-btn" onClick={() => void leaveShared(doc.id).then(() => (toast("You left this paper. It is off your list."), onBack()), () => showNotice("That did not work. Please try again."))}>
              Leave
            </button>
          )}
          {!access.signedIn && <span className="desk-shared-sign">Sign in to comment, if the link lets you.</span>}
        </p>
      )}
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
                    onCreateNote={canEdit ? (n) => void onCreateNote(n) : () => {}}
                    focusNoteId={focusNote?.id ?? null}
                    onOpenNote={openNote}
                    ink={canEdit ? ink : undefined}
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
            <div className="dw-sidetabs" role="tablist" aria-label="Notes, highlights or references">
              {TABS.map(({ id: t, label, Icon }, k) => (
                <button key={t} type="button" role="tab" id={`desk-tab-${t}`} aria-selected={tab === t} aria-controls={`desk-tabpanel-${t}`} tabIndex={tab === t ? 0 : -1} className="dw-sidetab" onClick={() => (t === "notes" && tab !== "notes" ? openInNotes(nb, null) : setTab(t))} onKeyDown={(e) => {
                  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
                  e.preventDefault();
                  const to = e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : (k + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
                  const next = TABS[to]!.id;
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
          {/* All three stay mounted, so references being checked are not lost by switching tabs, and a note being written keeps its place. */}
          <div className="dw-side desk-tabpanel" id="desk-tabpanel-notes" role="tabpanel" aria-labelledby="desk-tab-notes" hidden={tab !== "notes"}>
            {commentsAt ? (
              <Suspense fallback={<p className="nb-wait" role="status">Loading the comments…</p>}>
                <CommentsPanel api={comments} role={role} anchor={commentsAt.anchor} docId={doc.id} notes={existing} pages={nbState?.pages ?? null} meanings={MEANINGS} onShow={showAnchor} onOpen={openComments} onClose={() => setCommentsAt(commentsAt.anchor ? { anchor: null } : null)} announce={announce} signedIn={access?.signedIn ?? true} />
              </Suspense>
            ) : !canEdit ? (
              <Suspense fallback={<p className="nb-wait" role="status">Loading the notes…</p>}>
                <ReadNotebook docId={doc.id} notes={existing} meanings={MEANINGS} onGoTo={goTo} comments={sharing ? { openOn: comments.openOn, show: openComments, canWrite: canComment, open: comments.open, showAll: () => openComments(null) } : null} focus={readFocus} refresh={readTick} />
              </Suspense>
            ) : nb ? (
              <Suspense fallback={<p className="nb-wait" role="status">Loading your notes…</p>}>
                <NotebookView store={nb} docTitle={doc.title} notes={existing} notesReady={notes.status === "ready"} wide={wide} onGoTo={goTo} onDropQuote={onDropQuote} announce={announce} focus={nbFocus} meanings={MEANINGS} copy={copyText} onCapture={startCapture} paintCapture={paintCapture} exportFile={exportNotes} imageUrl={noteImageUrl} uploadImage={uploadNoteImage} comments={blockComments} live={notebookLive} />
              </Suspense>
            ) : (
              <p className="nb-wait" role="status">Loading your notes…</p>
            )}
          </div>
          <div className="dw-side desk-tabpanel" id="desk-tabpanel-highlights" role="tabpanel" aria-labelledby="desk-tab-highlights" hidden={tab !== "highlights"}>
            <NotesPanel compact exportMenu={(a) => <HighlightsExport {...a} />} doc={doc} api={notes} focusId={focusNote?.id ?? null} focusTick={focusNote?.tick ?? 0} onGo={onGoToNote} onFocusDone={(id) => setFocusNote((f) => (f?.id === id ? null : f))} notebook={canEdit ? notebookOnCard : readOnlyCard} readOnly={!canEdit} comments={cardComments} />
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

      {canComment && <AgentsFab open={agentsOpen} wide={wide} lift={agentsOpen ? 0 : lift} hidden={drawOpen || (agentsOpen && wide)} fabRef={fab} onToggle={() => (agentsOpen ? closeAgents() : openAgents())} />}
      {agentsEver && canComment && (
        <Suspense fallback={null}>
          <AgentsDrawer {...drawerProps} />
        </Suspense>
      )}
      {shareEver && (
        <Suspense fallback={null}>
          <ShareDialog open={shareOpen} onOpenChange={setShareOpen} docId={doc.id} title={doc.title} ownerName={props.myName} toast={(t, a) => void toast(t, a)} copy={copyText} returnFocus={() => shareBtn.current?.focus({ preventScroll: true })} hasCover={doc.hasCover} pagePicture={pdfReady ? () => renderInvitePicture(pdf.pdf, INVITE_PICTURE_WIDTH, INVITE_PICTURE_MAX_BYTES) : undefined} />
        </Suspense>
      )}
      <Toasts onRect={setToastRect} />
      <Announcer />
    </m.div>
  );
}
