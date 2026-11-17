import { Bold, ChevronDown, GripVertical, Heading, Italic, List, ListOrdered, MoreHorizontal, Plus, TextQuote, Underline } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { NOTEBOOK_STYLES, mdPlainText, type DocNote, type NotebookBlock, type NotebookStyle, type QuoteColor } from "@scholar/shared";
import { activeMarks, continueList, isOn, toggleHeading, toggleList, toggleMark, type Edit, type Mark } from "../../../../lib/md-edit";
// the meanings and the copy come from the reader (props): imported here too, they would be cut out of the first load's chunks into chunks of their own
import type { Meaning } from "../../../../lib/meanings";
import { useNotebook, type NbPage, type NotebookStore } from "../../../../lib/notebook";
import { showNotice } from "../../../../lib/notice";
import { toast } from "../../../../lib/toast";
import { MdView, QuoteBlockView, TextBlockView } from "./NbBlocks";
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
};

const STYLE_NAME: Record<NotebookStyle, string> = { plain: "Plain", ruled: "Ruled", dotted: "Dotted", grid: "Grid" };

const SAVE_WORDS = { idle: "", saving: "Saving…", saved: "Saved", offline: "Offline: kept on this device", error: "Not saved.", conflict: "Updated from another window" } as const;
const EMPTY_HINT = "Write here, or select text in the paper and choose Add to notes.";
const isEmptyPage = (p: NbPage) => p.blocks.length === 1 && p.blocks[0]!.kind === "text" && !p.blocks[0]!.md.trim();

/**
 * The Notes tab of the new reader (docs/design/paper-reader.md, sections 7 and 19): a paper's pages of notes, each a column of blocks (text written in a small Markdown, and quotes of the
 * paper's highlights), with a page picker, a page's own menu (move, paper style, delete), a formatting toolbar, reordering by drag or Alt+arrow, a drop target for quotes dragged from the paper,
 * the save line, and Copy or Download as Markdown. The `notebook` chunk: loaded when the reader needs it, never in the first load.
 */
export function Notebook({ store, docTitle, notes, notesReady, wide, onGoTo, onDropQuote, announce, focus, meanings: MEANINGS, copy: copyText }: NotebookProps) {
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
      {/* one header: the page's title (written in place) with the list of pages beside it, + Page, the save line, and the page's one menu */}
      <div className="nb-bar">
        <div className="nb-head">
          <h2 className="sr-only">Notes: {page.title || "Untitled page"}</h2>
          <input
            ref={title}
            className="nb-title"
            aria-label="Page title"
            // as wide as its words, so the list of pages sits right after it (field-sizing in CSS; `size` where that is not known)
            size={Math.max(6, Math.min(36, (page.title || "Untitled page").length + 1))}
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
          <NbPop
            kind="listbox"
            label="Pages"
            trigger={({ open, toggle, id, ref }) => (
              <button ref={ref} type="button" className="nb-picker" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={`Page ${i + 1} of ${st.pages.length}: ${page.title || "Untitled page"}. Choose a page`} title="Your pages" onClick={toggle}>
                {st.pages.length > 1 && <span aria-hidden="true">{`${i + 1}/${st.pages.length}`}</span>}
                <ChevronDown size={16} aria-hidden="true" />
              </button>
            )}
          >
            {(close) => <PageList pages={st.pages} openId={page.id} onPick={(id) => (store.open(id), close())} />}
          </NbPop>
        </div>
        <div className="nb-acts">
          <button
            type="button"
            className="btn btn-ghost btn-sm nb-addpage"
            onClick={() => {
              if (store.addPage()) setTitleTick((t) => t + 1);
            }}
          >
            <Plus size={14} aria-hidden="true" />
            <span>Page</span>
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
          <NbPop
            kind="menu"
            label="Page"
            align="end"
            trigger={({ open, toggle, ref }) => (
              <button ref={ref} type="button" className="icon-btn icon-btn-sm nb-pagemenu" aria-haspopup="menu" aria-expanded={open} aria-label="Page actions" title="Rename, move, paper, copy, download, delete" onClick={toggle}>
                <MoreHorizontal size={16} aria-hidden="true" />
              </button>
            )}
          >
            {(close) => (
              <div role="menu" aria-label="Page actions" className="desk-menu">
                <NbItem onPick={() => (close(false), setTitleTick((t) => t + 1))}>Rename</NbItem>
                <NbItem disabled={i === 0} onPick={() => (close(), store.movePage(page.id, -1) && announce(`Page moved to place ${i} of ${st.pages.length}`))}>Move up</NbItem>
                <NbItem disabled={i === st.pages.length - 1} onPick={() => (close(), store.movePage(page.id, 1) && announce(`Page moved to place ${i + 2} of ${st.pages.length}`))}>Move down</NbItem>
                <div role="group" aria-label="Paper style">
                  <span className="nb-menu-head" aria-hidden="true">Paper</span>
                  {NOTEBOOK_STYLES.map((s) => (
                    <NbItem key={s} checked={page.style === s} onPick={() => (close(), store.setStyle(page.id, s))}>
                      {STYLE_NAME[s]}
                    </NbItem>
                  ))}
                </div>
                <div role="group" aria-label="Markdown">
                  <span className="nb-menu-head" aria-hidden="true">Markdown</span>
                  <NbItem onPick={() => (close(), copyMd(false))}>Copy this page</NbItem>
                  <NbItem onPick={() => (close(), copyMd(true))}>Copy all pages</NbItem>
                  <NbItem onPick={() => (close(), downloadMd(false))}>Download this page</NbItem>
                  <NbItem onPick={() => (close(), downloadMd(true))}>Download all pages</NbItem>
                </div>
                <span className="nb-menu-sep" aria-hidden="true" />
                <NbItem
                  danger
                  onPick={() => {
                    close(false);
                    const name = page.title || "Untitled page";
                    const undo = store.deletePage(page.id);
                    if (undo) toast(`Deleted "${name}"`, { label: "Undo", run: () => (undo(), announce(`"${name}" is back`)) });
                  }}
                >
                  Delete page
                </NbItem>
              </div>
            )}
          </NbPop>
        </div>
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
              {/* two groups that never split: the marks, then the lists and Quote; a narrow panel puts the second group on a row of its own */}
              <div className="nb-tgroup">
              <Tool label="Heading" pressed={!!current && isOn(current, "h")} onPress={() => apply(toggleHeading)} first>
                <Heading size={15} aria-hidden="true" />
              </Tool>
              <Tool label="Bold" keys="Ctrl+B" pressed={on.has("b")} onPress={() => apply((x) => toggleMark(x, "b"))}>
                <Bold size={15} aria-hidden="true" />
              </Tool>
              <Tool label="Italic" keys="Ctrl+I" pressed={on.has("i")} onPress={() => apply((x) => toggleMark(x, "i"))}>
                <Italic size={15} aria-hidden="true" />
              </Tool>
              <Tool label="Underline" keys="Ctrl+U" pressed={on.has("u")} onPress={() => apply((x) => toggleMark(x, "u"))}>
                <Underline size={15} aria-hidden="true" />
              </Tool>
              <Tool label="Mark" pressed={on.has("mark")} onPress={() => apply((x) => toggleMark(x, "mark"))}>
                <mark aria-hidden="true">ab</mark>
              </Tool>
              </div>
              <div className="nb-tgroup">
              <Tool label="Bullet list" pressed={!!current && isOn(current, "ul")} onPress={() => apply((x) => toggleList(x, "ul"))}>
                <List size={15} aria-hidden="true" />
              </Tool>
              <Tool label="Numbered list" pressed={!!current && isOn(current, "ol")} onPress={() => apply((x) => toggleList(x, "ol"))}>
                <ListOrdered size={15} aria-hidden="true" />
              </Tool>
              <i aria-hidden="true" />
              <NbPop
                kind="dialog"
                label="Insert a quote of a highlight"
                trigger={({ open, toggle, id, ref }) => (
                  <button ref={ref} type="button" tabIndex={-1} className="nb-tool" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} title="Insert a quote of one of your highlights" onMouseDown={(e) => e.preventDefault()} onClick={toggle}>
                    <TextQuote size={15} aria-hidden="true" />
                    <span>Quote</span>
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
              </div>
            </div>
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
                    <p className="nb-later">{b.kind === "capture" ? `A part of page ${b.page}` : mdPlainText(b.text)}</p>
                  )}
                </div>
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
  );
}

/** A button of the format toolbar: a toggle (aria-pressed) that keeps the focus in the text field it acts on. One stop in the tab order (the first); the arrows move along. */
function Tool({ label, keys, pressed, onPress, first, children }: { label: string; keys?: string; pressed: boolean; onPress: () => void; first?: boolean; children: ReactNode }) {
  return (
    <button type="button" className="nb-tool" tabIndex={first ? 0 : -1} aria-label={label} aria-pressed={pressed} aria-keyshortcuts={keys?.replace("Ctrl", "Control")} title={keys ? `${label} (${keys})` : label} onMouseDown={(e) => e.preventDefault()} onClick={onPress}>
      {children}
    </button>
  );
}

/** The page picker's list: a listbox (the arrows move, Enter or a click takes it, Esc closes), each page with its title and its number of blocks. */
function PageList({ pages, openId, onPick }: { pages: NbPage[]; openId: string; onPick: (id: string) => void }) {
  const [active, setActive] = useState(Math.max(0, pages.findIndex((p) => p.id === openId)));
  return (
    <ul
      className="nb-pages"
      role="listbox"
      aria-label="Pages"
      tabIndex={0}
      data-autofocus
      aria-activedescendant={`nbp-${pages[active]?.id}`}
      onKeyDown={(e) => {
        const to = e.key === "ArrowDown" ? Math.min(pages.length - 1, active + 1) : e.key === "ArrowUp" ? Math.max(0, active - 1) : e.key === "Home" ? 0 : e.key === "End" ? pages.length - 1 : -1;
        if (to >= 0) {
          e.preventDefault();
          setActive(to);
          document.getElementById(`nbp-${pages[to]!.id}`)?.scrollIntoView({ block: "nearest" });
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick(pages[active]!.id);
        }
      }}
    >
      {pages.map((p, k) => (
        <li key={p.id} id={`nbp-${p.id}`} role="option" aria-selected={p.id === openId} data-active={k === active || undefined} className="nb-pageopt" onClick={() => onPick(p.id)} onPointerMove={() => setActive(k)}>
          <span className="nb-pageopt-title">{p.title || "Untitled page"}</span>
          <span className="nb-pageopt-n">
            {p.blocks.length} {p.blocks.length === 1 ? "block" : "blocks"}
          </span>
        </li>
      ))}
    </ul>
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
