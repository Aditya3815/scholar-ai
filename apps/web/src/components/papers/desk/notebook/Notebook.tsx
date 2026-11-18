import { Bold, ChevronDown, Crop, GripVertical, Heading, Italic, List, ListOrdered, ImagePlus, MessageSquare, MoreHorizontal, PenLine, Plus, TextQuote, Trash2, Type, Underline, X } from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { NOTEBOOK_STYLES, mdPlainText, type CaptureBlock, type DocNote, type ImageBlock, type NotebookBlock, type NotebookStyle, type QuoteColor } from "@scholar/shared";
import { activeMarks, continueList, isOn, toggleHeading, toggleList, toggleMark, type Edit, type Mark } from "../../../../lib/md-edit";
// the meanings and the copy come from the reader (props): imported here too, they would be cut out of the first load's chunks into chunks of their own
import type { Meaning } from "../../../../lib/meanings";
import { useNotebook, type NbPage, type NotebookStore } from "../../../../lib/notebook";
import { showNotice } from "../../../../lib/notice";
import { toast } from "../../../../lib/toast";
import { CaptureBlockView, ImageBlockView, MdView, QuoteBlockView, TextBlockView } from "./NbBlocks";
import { downloadMarkdown, markdownOf } from "./nb-export";
import { NbItem, NbPop } from "./NbMenu";
// its stylesheet (notebook.css) comes with the reader's own chunk (Desk.tsx): the Notes tab is the panel's first tab, so the page is styled before this chunk arrives

// the chunk's door for the reader (Desk.tsx loads this module, then makes the store with what it exports)
export { attachNotebook, browserNotebookDeps, createNotebookStore } from "../../../../lib/notebook";
export { MdView };

/** What a drag from the paper carries (docs/design/paper-reader.md, 19.4): a highlight (`noteId`), or a selection that becomes one in the meaning chosen when it is dropped. */
export const QUOTE_DRAG_TYPE = "application/x-sodhsetu-quote";
export type DroppedQuote = { noteId: string | null; page: number; quote: string };

export type NotebookProps = {
  store: NotebookStore;
  docTitle: string;
  /** The paper's highlights: the quote picker lists them, and a quote of one that is gone says "highlight removed". */
  notes: DocNote[];
  notesReady: boolean;
  wide: boolean;
  /** "p. N" on a quote: to the paper, the passage flashed. */
  onGoTo: (page: number, quote: string) => void;
  /** A highlight or a selection dropped on a page at `index` (wide screens only). */
  onDropQuote: (d: DroppedQuote, pageId: string, index: number) => void;
  /** The shared announcer (workspace/announcer.tsx), handed in by the reader. */
  announce: (s: string) => void;
  /** A block to bring into view and flash (Add to notes, In notes); with no block, the Notes tab was opened: the cursor goes into an empty page's block. */
  focus: { blockId: string | null; tick: number } | null;
  /** What each colour means (lib/meanings.ts), and the app's copy (lib/copy.ts): handed in by the reader. */
  meanings: Record<QuoteColor, Meaning>;
  copy: (text: string) => Promise<boolean>;
  /** Capture (21.1, 6): the reader takes the paper's Capture tool up (Split on a wide screen, Paper on a phone), and the new block comes back here. */
  onCapture?: () => void;
  /** Draws a capture from the open paper into a canvas, `cssWidth` wide; resolves to its height. */
  paintCapture?: (canvas: HTMLCanvasElement, b: CaptureBlock, cssWidth: number) => Promise<number>;
  /** Pictures (the owner's yes of 18 Nov): where a picture block's file is, and how one is sent (the reader knows the paper). Without them, no Image button. */
  imageUrl?: (blockId: string) => string;
  uploadImage?: (blockId: string, blob: Blob) => Promise<{ w: number; h: number; type: string }>;
  /** PDF and Word (21.1, 4): made by the reader, which holds the open paper (the captures are drawn from it); without it, Export offers Markdown only. */
  exportFile?: (fmt: "pdf" | "docx", pages: NbPage[], docTitle: string, names: Record<QuoteColor, string>, all: boolean) => Promise<void>;
  /** A shared paper's comments on a block (docs/design/paper-share.md, 5): its open threads (a dot) and the way to them (the dot, and Comment in the block's menu). Absent: sharing is off. */
  comments?: { openOn: (pageId: string, blockId: string) => number; show: (pageId: string, blockId: string) => void };
};

// a sketch is drawn and edited by a small chunk of its own (the pen, its outlines): most pages have none
const SketchBlockView = lazy(() => import("./NbSketch").then((m) => ({ default: m.SketchBlockView })));

const STYLE_NAME: Record<NotebookStyle, string> = { plain: "Plain", ruled: "Ruled", dotted: "Dotted", grid: "Graph" };

export type ExportFormat = "pdf" | "docx" | "md";

const SAVE_WORDS = { idle: "", saving: "Saving…", saved: "Saved", offline: "Offline: kept on this device", error: "Not saved.", conflict: "Updated from another window" } as const;
const EMPTY_HINT = "Write here, or select text in the paper and choose Add to notes.";
const isEmptyPage = (p: NbPage) => p.blocks.length === 1 && p.blocks[0]!.kind === "text" && !p.blocks[0]!.md.trim();

/**
 * The Notes tab of the new reader (docs/design/paper-reader.md, sections 7 and 19): a paper's pages of notes, each a column of blocks (text written in a small Markdown, and quotes of the
 * paper's highlights), with a page picker, a page's own menu (move, paper style, delete), a formatting toolbar, reordering by drag or Alt+arrow, a drop target for quotes dragged from the paper,
 * the save line, and Copy or Download as Markdown. The `notebook` chunk: loaded when the reader needs it, never in the first load.
 */
export function Notebook({ store, docTitle, notes, notesReady, wide, onGoTo, onDropQuote, announce, focus, meanings: MEANINGS, copy: copyText, exportFile, onCapture, paintCapture, imageUrl, uploadImage, comments }: NotebookProps) {
  const NAMES = useMemo(() => ({ yellow: MEANINGS.yellow.name, green: MEANINGS.green.name, blue: MEANINGS.blue.name, pink: MEANINGS.pink.name }), [MEANINGS]);
  const st = useNotebook(store);
  const page = st.pages.find((p) => p.id === st.openId) ?? st.pages[0] ?? null;

  /* ---- editing: which text block is a field, and the last selection in one (what the toolbar acts on) ---- */
  const [editing, setEditing] = useState<string | null>(null);
  const [editTick, setEditTick] = useState(0);
  const [sel, setSel] = useState<{ blockId: string; start: number; end: number } | null>(null);
  const fields = useRef(new Map<string, HTMLTextAreaElement>());
  const pendingSel = useRef<{ blockId: string; start: number; end: number } | null>(null);
  useEffect(() => {
    setEditing(null);
    setSel(null);
  }, [page?.id]);
  useLayoutEffect(() => {
    const want = pendingSel.current;
    const el = want ? fields.current.get(want.blockId) : null;
    if (!want || !el) return;
    pendingSel.current = null;
    el.focus({ preventScroll: true });
    el.setSelectionRange(want.start, want.end);
  });
  const edit = useCallback((blockId: string) => {
    setEditing(blockId);
    setEditTick((t) => t + 1);
  }, []);

  /* ---- what the save line says, and what is announced ---- */
  const said = useRef(st.save);
  useEffect(() => {
    if (said.current === st.save) return;
    said.current = st.save;
    if (st.save === "offline") announce("Offline: your notes are kept on this device and sent when you are back online.");
    else if (st.save === "conflict") announce("Your notes were updated from another window.");
    else if (st.save === "error") announce("Your notes are not saved.");
  }, [st.save, announce]);
  useEffect(() => {
    if (st.error) showNotice(st.error);
  }, [st.error]);

  /* ---- a block to bring into view (Add to notes, In notes), or the Notes tab opened ---- */
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!focus || !page) return;
    if (!focus.blockId) {
      // the Notes tab was opened: an empty page's block takes the cursor
      if (isEmptyPage(page)) edit(page.blocks[0]!.id);
      return;
    }
    const id = focus.blockId;
    const t = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`.nb [data-block="${id}"]`);
      el?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      setFlash(id);
      window.setTimeout(() => setFlash((f) => (f === id ? null : f)), 1600);
    }, 60);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.tick]);

  /* ---- the toolbar ---- */
  const target = (): { blockId: string; e: Edit } | null => {
    if (!page) return null;
    const known = sel && page.blocks.find((b) => b.id === sel.blockId && b.kind === "text");
    if (known && known.kind === "text") return { blockId: known.id, e: { value: known.md, start: Math.min(sel!.start, known.md.length), end: Math.min(sel!.end, known.md.length) } };
    const last = [...page.blocks].reverse().find((b) => b.kind === "text");
    if (last && last.kind === "text") return { blockId: last.id, e: { value: last.md, start: last.md.length, end: last.md.length } };
    const made = store.addText(page.id);
    return made ? { blockId: made, e: { value: "", start: 0, end: 0 } } : null;
  };
  const apply = (fn: (e: Edit) => Edit, at?: { blockId: string; e: Edit }) => {
    const t = at ?? target();
    if (!t || !page) return;
    const next = fn(t.e);
    store.setText(page.id, t.blockId, next.value);
    const s = { blockId: t.blockId, start: next.start, end: next.end };
    setSel(s);
    pendingSel.current = s;
    setEditing(t.blockId);
  };
  const current = useMemo(() => {
    const b = sel && page?.blocks.find((x) => x.id === sel.blockId);
    if (!b || b.kind !== "text") return null;
    return { value: b.md, start: sel!.start, end: sel!.end };
  }, [sel, page]);
  const on = useMemo(() => (current ? activeMarks(current) : new Set<Mark>()), [current]);
  const fieldKeys = (blockId: string) => (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const here = { blockId, e: { value: el.value, start: el.selectionStart, end: el.selectionEnd } };
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && !e.shiftKey) {
      const mark = ({ b: "b", i: "i", u: "u" } as Record<string, Mark>)[e.key.toLowerCase()];
      if (mark) {
        e.preventDefault();
        apply((x) => toggleMark(x, mark), here);
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
      const next = continueList(here.e);
      if (next) {
        e.preventDefault();
        apply(() => next, here);
      }
    }
  };

  /* ---- moving blocks: the handle, by drag or Alt+arrow ---- */
  const list = useRef<HTMLOListElement>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const drag = useRef<{ id: string; y: number; moved: boolean } | null>(null);
  const refocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!refocus.current) return;
    document.querySelector<HTMLElement>(`.nb [data-block="${refocus.current}"] .nb-handle`)?.focus({ preventScroll: false });
    refocus.current = null;
  });
  const indexAt = (y: number): number => {
    const items = [...(list.current?.querySelectorAll<HTMLElement>(":scope > .nb-block") ?? [])];
    for (let i = 0; i < items.length; i++) {
      const r = items[i]!.getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return items.length;
  };
  const moveTo = (blockId: string, to: number) => {
    if (!page) return;
    const n = page.blocks.length;
    const at = store.moveBlock(page.id, blockId, to);
    if (at < 0) return;
    refocus.current = blockId;
    announce(`Moved to position ${at + 1} of ${n}`);
  };

  /* ---- drop from the paper ---- */
  const dropProps = wide && page
    ? {
        onDragOver: (e: React.DragEvent) => {
          if (!e.dataTransfer.types.includes(QUOTE_DRAG_TYPE)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDropAt(indexAt(e.clientY));
        },
        onDragLeave: (e: React.DragEvent) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null);
        },
        onDrop: (e: React.DragEvent) => {
          const raw = e.dataTransfer.getData(QUOTE_DRAG_TYPE);
          const at = dropAt ?? indexAt(e.clientY);
          setDropAt(null);
          if (!raw) return;
          e.preventDefault();
          try {
            const d = JSON.parse(raw) as Partial<DroppedQuote>;
            if (typeof d.page === "number" && Number.isInteger(d.page) && d.page >= 1 && typeof d.quote === "string" && d.quote.trim().length >= 3) {
              onDropQuote({ noteId: typeof d.noteId === "string" ? d.noteId : null, page: d.page, quote: d.quote }, page.id, at);
            }
          } catch {
            /* not ours */
          }
        },
      }
    : {};

  /* ---- Markdown out ---- */
  const markdown = (all: boolean) => markdownOf(docTitle, (all ? st.pages : page ? [page] : []).map((p) => ({ title: p.title, blocks: p.blocks })), NAMES);
  const copyMd = (all: boolean) => {
    void copyText(markdown(all)).then((ok) => (ok ? toast(all ? "All pages copied as Markdown" : "This page copied as Markdown") : showNotice("Could not copy. Select the text and press Ctrl+C.")));
  };
  const downloadMd = (all: boolean) => downloadMarkdown(docTitle, all ? null : page?.title ?? "", markdown(all));
  /** Export ▾: Markdown here; PDF and Word through the reader (exportFile), which can draw the captures from the open paper. */
  const exportAs = (fmt: ExportFormat, all: boolean) => {
    if (fmt === "md") return downloadMd(all);
    const pages = all ? st.pages : page ? [page] : [];
    void exportFile?.(fmt, pages, docTitle, NAMES, all).catch(() => showNotice(`The ${fmt === "pdf" ? "PDF" : "Word file"} could not be made. Check the connection, then try again.`));
  };

  /* ---- the toolbar's second row (More), and the basic row's fade when it scrolls (a phone) ---- */
  const [moreOpen, setMoreOpen] = useState(false);
  const mainRow = useRef<HTMLDivElement>(null);
  const [toolsMore, setToolsMore] = useState("");
  useEffect(() => {
    const el = mainRow.current;
    if (!el) return;
    const seen = () => {
      const start = el.scrollLeft > 1;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setToolsMore(start && end ? "both" : start ? "start" : end ? "end" : "");
    };
    seen();
    el.addEventListener("scroll", seen, { passive: true });
    const ro = new ResizeObserver(seen);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", seen);
      ro.disconnect();
    };
  }, [st.status]);

  /* ---- a picture (Image): made smaller in the browser (at most 2000 px a side, no camera data), sent, then put in as a block with the same id ---- */
  const imageInput = useRef<HTMLInputElement>(null);
  const addPicture = async (file: File) => {
    if (!page || !imageUrl || !uploadImage) return;
    const at = insertAt();
    const pageId = page.id;
    announce("Adding the picture…");
    try {
      const { prepareNoteImage } = await import("./nb-image");
      const made = await prepareNoteImage(file);
      const id = `img${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const kept = await uploadImage(id, made.blob);
      const placed = store.insertBlock({ kind: "image", w: kept.w, h: kept.h, type: kept.type as ImageBlock["type"], alt: "" }, { pageId, index: at }, id);
      if (placed) {
        announce(`The picture is on ${placed.title}`);
        toast("Picture added", { label: "Undo", run: () => (placed.undo(), announce("The picture is taken out")) });
      }
    } catch (e) {
      showNotice(e instanceof Error && e.message ? e.message : "The picture could not be added. Check the connection, then try again.");
    }
  };

  /* ---- the title field of a new page takes the focus ---- */
  const title = useRef<HTMLInputElement>(null);
  const [titleTick, setTitleTick] = useState(0);
  useEffect(() => {
    if (!titleTick) return;
    title.current?.focus();
    title.current?.select();
  }, [titleTick]);

  if (st.status === "loading") return <div className="nb nb-wait" role="status">Loading your notes…</div>;
  if (st.status === "error" || !page)
    return (
      <div className="nb nb-wait" role="alert">
        Your notes could not be loaded.{" "}
        <button type="button" className="link-btn" onClick={() => store.retry()}>
          Try again
        </button>
      </div>
    );

  const i = st.pages.indexOf(page);
  const quotedHere = new Set(page.blocks.flatMap((b) => (b.kind === "quote" && b.noteId ? [b.noteId] : [])));
  const noteIds = new Set(notes.map((n) => n.id));
  const removed = (b: NotebookBlock) => b.kind === "quote" && (b.noteId === null || (notesReady && !noteIds.has(b.noteId)));
  const lastBlock = page.blocks[page.blocks.length - 1];
  const endsOnEmpty = lastBlock?.kind === "text" && !lastBlock.md.trim();
  const insertAt = () => {
    const after = sel?.blockId ?? editing;
    const k = after ? page.blocks.findIndex((b) => b.id === after) : -1;
    return k >= 0 ? k + 1 : page.blocks.length;
  };

  return (
    <div className="nb" data-wide={wide}>
      {/* the pages as tabs (the mock's), each with its paper; + Page opens "Choose paper for the new page" */}
      <PageTabs pages={st.pages} openId={page.id} onOpen={(id) => store.open(id)} onNew={(style) => store.addPage(undefined, style) && setTitleTick((t) => t + 1)} />
      <div className="nb-pagepanel" role="tabpanel" id="nb-pagepanel" aria-labelledby={`nbt-${page.id}`}>
      {/* the page's header: its title, Delete this page, the save line, Export, and a small menu for moving and renaming */}
      <div className="nb-bar">
        <h2 className="sr-only">Notes: {page.title || "Untitled page"}</h2>
        <input
          ref={title}
          className="nb-title"
          aria-label="Page title"
          maxLength={120}
          placeholder="Untitled page"
          value={page.title}
          onChange={(e) => store.rename(page.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const first = page.blocks.find((b) => b.kind === "text");
              if (first) edit(first.id);
            }
          }}
        />
        <button
          type="button"
          className="icon-btn icon-btn-sm nb-trash"
          aria-label="Delete this page"
          title="Delete this page"
          onClick={() => {
            const name = page.title || "Untitled page";
            const undo = store.deletePage(page.id);
            if (undo) toast(`Deleted "${name}"`, { label: "Undo", run: () => (undo(), announce(`"${name}" is back`)) });
          }}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
        <p className="nb-save" data-state={st.save}>
          {SAVE_WORDS[st.save]}
          {st.save === "error" && (
            <>
              {" "}
              <button type="button" className="link-btn" onClick={() => store.retry()}>
                Retry
              </button>
            </>
          )}
        </p>
        <ExportMenu onExport={exportAs} onCopy={copyMd} files={!!exportFile} />
        <NbPop
          kind="menu"
          label="Page"
          align="end"
          trigger={({ open, toggle, ref }) => (
            <button ref={ref} type="button" className="icon-btn icon-btn-sm nb-pagemenu" aria-haspopup="menu" aria-expanded={open} aria-label="Page actions" title="Move or rename this page" onClick={toggle}>
              <MoreHorizontal size={16} aria-hidden="true" />
            </button>
          )}
        >
          {(close) => (
            <div role="menu" aria-label="Page actions" className="desk-menu">
              <NbItem disabled={i === 0} onPick={() => (close(), store.movePage(page.id, -1) && announce(`Page moved to place ${i} of ${st.pages.length}`))}>Move left</NbItem>
              <NbItem disabled={i === st.pages.length - 1} onPick={() => (close(), store.movePage(page.id, 1) && announce(`Page moved to place ${i + 2} of ${st.pages.length}`))}>Move right</NbItem>
              <NbItem onPick={() => (close(false), setTitleTick((t) => t + 1))}>Rename</NbItem>
              <div role="group" aria-label="Paper">
                <span className="nb-menu-head" aria-hidden="true">Paper</span>
                {NOTEBOOK_STYLES.map((s) => (
                  <NbItem key={s} checked={page.style === s} onPick={() => (close(), store.setStyle(page.id, s))}>
                    {STYLE_NAME[s]}
                  </NbItem>
                ))}
              </div>
            </div>
          )}
        </NbPop>
      </div>

      <div className="nb-scroll" data-style={page.style}>
        <div className="nb-sheet">
          <div className="nb-toolrow">
            <div
              className="nb-tools"
              role="toolbar"
              aria-label="Format"
              onKeyDown={(e) => {
                const items = [...e.currentTarget.querySelectorAll<HTMLElement>(".nb-tool")];
                const k = items.indexOf(document.activeElement as HTMLElement);
                const to = e.key === "ArrowRight" ? (k + 1) % items.length : e.key === "ArrowLeft" ? (k - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
                if (to < 0 || k < 0) return;
                e.preventDefault();
                items.forEach((b, n) => (b.tabIndex = n === to ? 0 : -1));
                items[to]?.focus();
              }}
            >
              {/* the basic actions, always in one row (on a phone it scrolls sideways with a fade, never wraps); the rest behind More (the owner's choice of 18 Nov) */}
              <div ref={mainRow} className="nb-tools-main" data-more={toolsMore || undefined}>
                <Tool label="Bold" keys="Ctrl+B" pressed={on.has("b")} onPress={() => apply((x) => toggleMark(x, "b"))} first>
                  <Bold size={15} aria-hidden="true" />
                </Tool>
                <Tool label="Italic" keys="Ctrl+I" pressed={on.has("i")} onPress={() => apply((x) => toggleMark(x, "i"))}>
                  <Italic size={15} aria-hidden="true" />
                </Tool>
                <Tool label="Mark" pressed={on.has("mark")} onPress={() => apply((x) => toggleMark(x, "mark"))}>
                  <mark aria-hidden="true">ab</mark>
                </Tool>
                <Tool label="Bullet list" pressed={!!current && isOn(current, "ul")} onPress={() => apply((x) => toggleList(x, "ul"))}>
                  <List size={15} aria-hidden="true" />
                </Tool>
                <i aria-hidden="true" />
                <NbPop
                  kind="dialog"
                  label="Insert a quote of a highlight"
                  trigger={({ open, toggle, id, ref }) => (
                    <button ref={ref} type="button" tabIndex={-1} className="nb-tool" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} aria-label="Quote" title="Insert a quote of one of your highlights" onMouseDown={(e) => e.preventDefault()} onClick={toggle}>
                      <TextQuote size={15} aria-hidden="true" />
                      <span className="nb-tl">Quote</span>
                    </button>
                  )}
                >
                  {(close) => (
                    <QuotePicker
                      meanings={MEANINGS}
                      notes={notes}
                      quotedHere={quotedHere}
                      onPick={(n) => {
                        close();
                        const at = store.addQuote({ noteId: n.id, page: n.page, quote: n.quote, color: n.color }, { pageId: page.id, index: insertAt() });
                        if (at) announce(`Quote added: ${MEANINGS[n.color].name}, page ${n.page}`);
                      }}
                    />
                  )}
                </NbPop>
                {onCapture && (
                  <Tool label="Capture" onPress={onCapture}>
                    <Crop size={15} aria-hidden="true" />
                    <span className="nb-tl">Capture</span>
                  </Tool>
                )}
                <Tool
                  label="Draw"
                  onPress={() => {
                    const at = store.addSketch({ pageId: page.id, index: insertAt() });
                    if (at) announce(`A sketch is on ${at.title}: draw in it with the pen`);
                  }}
                >
                  <PenLine size={15} aria-hidden="true" />
                  <span className="nb-tl">Draw</span>
                </Tool>
                {imageUrl && (
                  <Tool label="Image" onPress={() => imageInput.current?.click()}>
                    <ImagePlus size={15} aria-hidden="true" />
                    <span className="nb-tl">Image</span>
                  </Tool>
                )}
                <i aria-hidden="true" />
                <button type="button" tabIndex={-1} className="nb-tool nb-more" aria-label="More formatting and paper" title="More: heading, underline, numbered list, text, paper" aria-expanded={moreOpen} aria-controls="nb-tools-more" onMouseDown={(e) => e.preventDefault()} onClick={() => setMoreOpen((o) => !o)}>
                  <span aria-hidden="true">Aa</span>
                  <ChevronDown size={13} aria-hidden="true" />
                </button>
              </div>
              {moreOpen && (
                <div id="nb-tools-more" className="nb-tools-more">
                  <div className="nb-tgroup">
                    <Tool label="Heading" pressed={!!current && isOn(current, "h")} onPress={() => apply(toggleHeading)}>
                      <Heading size={15} aria-hidden="true" />
                    </Tool>
                    <Tool label="Underline" keys="Ctrl+U" pressed={on.has("u")} onPress={() => apply((x) => toggleMark(x, "u"))}>
                      <Underline size={15} aria-hidden="true" />
                    </Tool>
                    <Tool label="Numbered list" pressed={!!current && isOn(current, "ol")} onPress={() => apply((x) => toggleList(x, "ol"))}>
                      <ListOrdered size={15} aria-hidden="true" />
                    </Tool>
                    <Tool label="Text" onPress={() => { const id = store.addText(page.id, page.blocks[insertAt() - 1]?.id ?? null); if (id) edit(id); }}>
                      <Type size={15} aria-hidden="true" />
                      <span className="nb-tl">Text</span>
                    </Tool>
                  </div>
                  <div className="nb-tgroup" role="group" aria-label="Paper">
                    {NOTEBOOK_STYLES.map((s) => (
                      <Tool key={s} label={`${STYLE_NAME[s]} paper`} pressed={page.style === s} onPress={() => store.setStyle(page.id, s)}>
                        <span className="nb-sw" data-style={s} aria-hidden="true" />
                      </Tool>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {imageUrl && <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void addPicture(f); }} />}
          </div>

          <ol ref={list} className="nb-blocks" role="list" aria-label={`Blocks of ${page.title || "Untitled page"}`} data-dropping={dropAt !== null || undefined} {...dropProps}>
            {page.blocks.map((b, k) => (
              // a block's handle and menu show when it is pointed at or holds the focus; with no hover (touch), for the block that was tapped (data-active)
              <li key={b.id} className="nb-block" role="listitem" data-block={b.id} data-kind={b.kind} data-active={active === b.id || undefined} onPointerDown={() => setActive(b.id)} data-flash={flash === b.id || undefined} data-dragging={dragging === b.id || undefined} data-drop-before={dropAt === k || undefined} data-drop-after={dropAt === page.blocks.length && k === page.blocks.length - 1 ? true : undefined}>
                <button
                  type="button"
                  className="nb-handle"
                  aria-label={`Move block, position ${k + 1} of ${page.blocks.length}`}
                  title="Drag to move, or press Alt+Up and Alt+Down"
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  onKeyDown={(e) => {
                    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                    e.preventDefault();
                    moveTo(b.id, k + (e.key === "ArrowUp" ? -1 : 1));
                  }}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    drag.current = { id: b.id, y: e.clientY, moved: false };
                  }}
                  onPointerMove={(e) => {
                    const d = drag.current;
                    if (!d) return;
                    if (!d.moved && Math.abs(e.clientY - d.y) < 5) return;
                    d.moved = true;
                    setDragging(d.id);
                    setDropAt(indexAt(e.clientY));
                  }}
                  onPointerUp={(e) => {
                    const d = drag.current;
                    drag.current = null;
                    setDragging(null);
                    if (!d?.moved) return setDropAt(null);
                    const to = indexAt(e.clientY);
                    setDropAt(null);
                    const from = page.blocks.findIndex((x) => x.id === d.id);
                    moveTo(d.id, to > from ? to - 1 : to);
                  }}
                  onPointerCancel={() => {
                    drag.current = null;
                    setDragging(null);
                    setDropAt(null);
                  }}
                >
                  <GripVertical size={15} aria-hidden="true" />
                </button>
                <div className="nb-body">
                  {b.kind === "text" ? (
                    <TextBlockView
                      b={b}
                      n={k + 1}
                      editing={editing === b.id}
                      focusTick={editTick}
                      // only the page's last line invites writing; an empty block between two others is a blank line, not a second "Write here"
                      placeholder={k < page.blocks.length - 1 ? "" : page.blocks.length === 1 ? EMPTY_HINT : "Write here…"}
                      onEdit={() => edit(b.id)}
                      onStop={() => setEditing((cur) => (cur === b.id ? null : cur))}
                      onChange={(md) => store.setText(page.id, b.id, md)}
                      onKeys={fieldKeys(b.id)}
                      onSelect={(el) => setSel({ blockId: b.id, start: el.selectionStart, end: el.selectionEnd })}
                      fieldRef={(el) => (el ? fields.current.set(b.id, el) : fields.current.delete(b.id))}
                    />
                  ) : b.kind === "quote" ? (
                    <QuoteBlockView b={b} mean={MEANINGS[b.color]} removed={removed(b)} onGo={() => onGoTo(b.page, b.quote)} />
                  ) : (
                    b.kind === "capture" ? (
                      <CaptureBlockView b={b} paint={paintCapture} onGo={() => onGoTo(b.page, "")} onCaption={(caption) => store.updateBlock(page.id, b.id, "capture", { caption })} onSize={(size) => store.updateBlock(page.id, b.id, "capture", { size })} />
                    ) : b.kind === "image" ? (
                      <ImageBlockView b={b} src={imageUrl?.(b.id) ?? ""} onAlt={(alt) => store.updateBlock(page.id, b.id, "image", { alt })} />
                    ) : b.kind === "sketch" ? (
                      <Suspense fallback={<div className="nb-sketch-wait" style={{ height: b.height }} />}><SketchBlockView b={b} onStrokes={(strokes) => store.updateBlock(page.id, b.id, "sketch", { strokes })} onHeight={(height) => store.updateBlock(page.id, b.id, "sketch", { height })} onRefused={showNotice} /></Suspense>
                    ) : (
                      <p className="nb-later">{mdPlainText(b.text)}</p>
                    )
                  )}
                </div>
                {comments && comments.openOn(page.id, b.id) > 0 && (
                  <button type="button" className="cm-dot" data-open="true" onClick={() => comments.show(page.id, b.id)} aria-label={`${comments.openOn(page.id, b.id)} open comments on block ${k + 1}`} title="Open comments">
                    <MessageSquare size={13} aria-hidden="true" />
                    <span>{comments.openOn(page.id, b.id)}</span>
                  </button>
                )}
                <NbPop
                  kind="menu"
                  label="Block"
                  align="end"
                  className="nb-blockmenu"
                  trigger={({ open, toggle, ref }) => (
                    <button ref={ref} type="button" className="icon-btn icon-btn-sm" aria-haspopup="menu" aria-expanded={open} aria-label={`Actions of block ${k + 1}`} title="Block actions" onClick={toggle}>
                      <MoreHorizontal size={15} aria-hidden="true" />
                    </button>
                  )}
                >
                  {(close) => (
                    <div role="menu" aria-label={`Actions of block ${k + 1}`} className="desk-menu">
                      {comments && (
                        <NbItem
                          onPick={() => {
                            close(false);
                            comments.show(page.id, b.id);
                          }}
                        >
                          Comment
                        </NbItem>
                      )}
                      <NbItem
                        danger
                        onPick={() => {
                          close(false);
                          const undo = store.removeBlock(page.id, b.id);
                          if (undo) toast("Block deleted", { label: "Undo", run: () => (undo(), announce("The block is back")) });
                        }}
                      >
                        Delete block
                      </NbItem>
                    </div>
                  )}
                </NbPop>
              </li>
            ))}
          </ol>
          {/* the page always ends on a line to write on: the last block when it is an empty text block, or this line, which becomes one at the first key */}
          {!endsOnEmpty && (
            <textarea
              className="nb-field nb-ghost"
              aria-label="Write a new text block at the end"
              placeholder="Write here…"
              rows={1}
              value=""
              onChange={(e) => {
                const md = e.target.value;
                const id = store.addText(page.id);
                if (!id) return;
                store.setText(page.id, id, md);
                pendingSel.current = { blockId: id, start: md.length, end: md.length };
                setEditing(id);
              }}
            />
          )}
          <div className="nb-rest" aria-hidden="true" />
        </div>
      </div>
      </div>
    </div>
  );
}

/** A button of the format toolbar: a toggle (aria-pressed; an action such as Text has none) that keeps the focus in the text field it acts on. One stop in the tab order (the first); the arrows move along. */
function Tool({ label, keys, pressed, onPress, first, children }: { label: string; keys?: string; pressed?: boolean; onPress: () => void; first?: boolean; children: ReactNode }) {
  return (
    <button type="button" className="nb-tool" tabIndex={first ? 0 : -1} aria-label={label} aria-pressed={pressed} aria-keyshortcuts={keys?.replace("Ctrl", "Control")} title={keys ? `${label} (${keys})` : label} onMouseDown={(e) => e.preventDefault()} onClick={onPress}>
      {children}
    </button>
  );
}

/**
 * The pages as tabs (docs/design/paper-reader.md, 21.1, 2): each with its paper and its title, the open one raised; a tablist (← and → move, Home and End go to the ends, Enter or a click
 * opens), in a row that scrolls sideways with a fade on the side that has more. "+" (Add a page) right after the last tab, kept in sight when the row scrolls, opens "Choose paper for the new page".
 */
function PageTabs({ pages, openId, onOpen, onNew }: { pages: NbPage[]; openId: string; onOpen: (id: string) => void; onNew: (style: NotebookStyle) => void }) {
  const row = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState("");
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const seen = () => {
      const start = el.scrollLeft > 1;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setMore(start && end ? "both" : start ? "start" : end ? "end" : "");
    };
    seen();
    el.addEventListener("scroll", seen, { passive: true });
    const ro = new ResizeObserver(seen);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", seen);
      ro.disconnect();
    };
  }, [pages.length]);
  // the open page's tab is kept in sight
  useEffect(() => {
    document.getElementById(`nbt-${openId}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [openId]);
  const keys = (e: KeyboardEvent<HTMLButtonElement>, k: number) => {
    const to = e.key === "ArrowRight" ? Math.min(pages.length - 1, k + 1) : e.key === "ArrowLeft" ? Math.max(0, k - 1) : e.key === "Home" ? 0 : e.key === "End" ? pages.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    const el = document.getElementById(`nbt-${pages[to]!.id}`);
    el?.focus();
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  return (
    <div className="nb-tabsrow">
      <div ref={row} className="nb-pagetabs" role="tablist" aria-label="Pages" data-more={more || undefined}>
        {pages.map((p, k) => (
          <button
            key={p.id}
            id={`nbt-${p.id}`}
            type="button"
            role="tab"
            className="nb-pagetab"
            aria-selected={p.id === openId}
            aria-controls="nb-pagepanel"
            tabIndex={p.id === openId ? 0 : -1}
            onClick={() => onOpen(p.id)}
            onKeyDown={(e) => keys(e, k)}
          >
            <span className="nb-sw" data-style={p.style} aria-hidden="true" />
            <span className="nb-pagetab-t">{p.title || "Untitled page"}</span>
          </button>
        ))}
      </div>
      <NbPop
        kind="dialog"
        label="Choose paper for the new page"
        align="end"
        trigger={({ open, toggle, id, ref }) => (
          <button ref={ref} type="button" className="nb-addpage" aria-label="Add a page" title="Add a page" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={toggle}>
            <Plus size={16} aria-hidden="true" />
          </button>
        )}
      >
        {(close) => (
          <div className="nb-paperpick">
            <div className="nb-paperpick-head">
              <p>Choose paper for the new page</p>
              <button type="button" className="icon-btn icon-btn-sm" aria-label="Close" onClick={() => close()}>
                <X size={15} aria-hidden="true" />
              </button>
            </div>
            <div className="nb-papercards">
              {NOTEBOOK_STYLES.map((s, k) => (
                <button key={s} type="button" className="nb-papercard" data-autofocus={k === 0 || undefined} onClick={() => (close(false), onNew(s))}>
                  <span className="nb-paperprev" data-style={s} aria-hidden="true" />
                  <span>{STYLE_NAME[s]}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </NbPop>
    </div>
  );
}

/** Export ▾ (21.1, 4): this page or all pages, as PDF, Word or Markdown (PDF and Word when the reader hands in a way to make them), or the Markdown copied. */
function ExportMenu({ onExport, onCopy, files }: { onExport: (fmt: ExportFormat, all: boolean) => void; onCopy: (all: boolean) => void; files: boolean }) {
  const [all, setAll] = useState(false);
  return (
    <NbPop
      kind="menu"
      label="Export"
      align="end"
      trigger={({ open, toggle, ref }) => (
        <button ref={ref} type="button" className="btn btn-ghost btn-sm nb-export" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
          <span>Export</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      )}
    >
      {(close) => (
        <div role="menu" aria-label="Export" className="desk-menu">
          <div role="group" aria-label="What to export">
            <NbItem checked={!all} onPick={() => setAll(false)}>
              This page
            </NbItem>
            <NbItem checked={all} onPick={() => setAll(true)}>
              All pages
            </NbItem>
          </div>
          <div role="group" aria-label="Download as">
            <span className="nb-menu-head" aria-hidden="true">
              Download as
            </span>
            {files && <NbItem onPick={() => (close(), onExport("pdf", all))}>PDF</NbItem>}
            {files && <NbItem onPick={() => (close(), onExport("docx", all))}>Word (.docx)</NbItem>}
            <NbItem onPick={() => (close(), onExport("md", all))}>Markdown</NbItem>
          </div>
          <span className="nb-menu-sep" aria-hidden="true" />
          <NbItem onPick={() => (close(), onCopy(all))}>Copy as Markdown</NbItem>
        </div>
      )}
    </NbPop>
  );
}

/** ❝ Quote: the paper's highlights (meaning, page, first words), filtered as you type; those already on this page are marked. */
function QuotePicker({ notes, quotedHere, onPick, meanings: MEANINGS }: { notes: DocNote[]; quotedHere: ReadonlySet<string>; onPick: (n: DocNote) => void; meanings: Record<QuoteColor, Meaning> }) {
  const [q, setQ] = useState("");
  const words = q.toLowerCase().trim();
  const shown = notes.filter((n) => !words || `${n.quote} ${MEANINGS[n.color].name} p. ${n.page} ${n.note}`.toLowerCase().includes(words));
  return (
    <div className="nb-qpick">
      <label className="sr-only" htmlFor="nb-qpick-find">
        Find a highlight
      </label>
      <input id="nb-qpick-find" data-autofocus type="search" placeholder="Find a highlight" value={q} onChange={(e) => setQ(e.target.value)} />
      {notes.length === 0 ? (
        <p>No highlights yet. Select text in the paper to make one.</p>
      ) : shown.length === 0 ? (
        <p role="status">No highlight has those words.</p>
      ) : (
        <ul aria-label="Highlights">
          {shown.map((n) => {
            const here = quotedHere.has(n.id);
            const mean = MEANINGS[n.color];
            return (
              <li key={n.id}>
                <button type="button" onClick={() => onPick(n)} aria-label={`${mean.name}, page ${n.page}: ${n.quote}${here ? " (already on this page)" : ""}`}>
                  <span className="desk-dot" data-color={n.color} aria-hidden="true">
                    {mean.letter}
                  </span>
                  <span className="nb-dim" aria-hidden="true">p. {n.page}</span>
                  <span aria-hidden="true">{n.quote.length > 140 ? `${n.quote.slice(0, 139)}…` : n.quote}</span>
                  {here && <span className="nb-dim" aria-hidden="true">On this page</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
