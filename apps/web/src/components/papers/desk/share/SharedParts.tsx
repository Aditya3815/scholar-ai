import { MessageSquare } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { blockAnchor, pageLabel, strokesWord, type CommentAnchor, type DocNote, type NoteColor, type NotebookInk, type NotebookPage } from "@scholar/shared";
import { api } from "../../../../lib/api/client";
import type { Meaning } from "../../../../lib/meanings";
import { AgentBlockView, MdView, QuoteBlockView } from "../notebook/NbBlocks";
import { readInk, readPages } from "./read-pages";
// the ink on the pages (paper-reader.md 25), drawn by the nb-ink chunk's read-only layer, fetched only when a page has ink
const InkView = lazy(() => import("../notebook/NbInk").then((m) => ({ default: m.InkView })));
import "./share.css";

/**
 * The read-only Notes of a Viewer or a Commenter (docs/design/paper-share.md, section 4): a chunk of its own ("shared"), fetched when sharing is on for the paper. The comments are a chunk of
 * their own (Comments.tsx), fetched when they are first opened.
 */

/* ---------------------------------------------------------------- the read-only Notes */

export type ReadNotebookProps = {
  docId: string;
  notes: DocNote[];
  meanings: Record<NoteColor, Meaning>;
  onGoTo: (page: number, quote: string) => void;
  /** Open threads on a block, and the way to them (a Commenter up writes; a Viewer reads). */
  comments: { openOn: (a: CommentAnchor) => number; show: (a: CommentAnchor) => void; canWrite: boolean; open: number; showAll: () => void } | null;
  /** The block to bring into view and flash (a comment's "Show"). */
  focus: { pageId: string; blockId: string; tick: number } | null;
  /** Read the pages again when this changes (someone saved: docs/design/paper-live.md). */
  refresh?: number;
};


/** A Viewer's or a Commenter's Notes: the owner's pages, as they are, with a page picker and, on each block, its comments. Nothing here can be changed. */
export function ReadNotebook({ docId, notes, meanings, onGoTo, comments, focus, refresh = 0 }: ReadNotebookProps) {
  const [pages, setPages] = useState<NotebookPage[] | null>(() => readPages.get(docId) ?? null);
  const [ink, setInk] = useState<NotebookInk[]>(() => readInk.get(docId) ?? []);
  const wrap = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    api<{ pages: NotebookPage[]; ink?: NotebookInk[] }>(`/api/v1/documents/${docId}/notebook`).then(
      (j) => {
        readPages.set(docId, j.pages);
        readInk.set(docId, j.ink ?? []);
        if (!gone) {
          setPages(j.pages);
          setInk(j.ink ?? []);
        }
      },
      () => !gone && !readPages.has(docId) && setError(true),
    );
    return () => {
      gone = true;
    };
  }, [docId, refresh]);
  useEffect(() => {
    if (!focus) return;
    setOpenId(focus.pageId);
    const t = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`.nbr [data-block="${focus.blockId}"]`);
      el?.scrollIntoView({ block: "center" });
      el?.classList.add("ref-flash");
      window.setTimeout(() => el?.classList.remove("ref-flash"), 1600);
    }, 80);
    return () => window.clearTimeout(t);
  }, [focus]);
  const known = useMemo(() => new Set(notes.map((n) => n.id)), [notes]);
  if (error) return <p className="notes-error" role="alert">The notes could not be loaded.</p>;
  if (!pages) return <p className="nb-wait" role="status">Loading the notes…</p>;
  if (pages.length === 0) return <p className="cm-empty nbr">No notes on this paper yet.</p>;
  const page = pages.find((p) => p.id === openId) ?? pages[0]!;
  const name = pageLabel(page.title, pages.indexOf(page));
  const strokes = ink.find((x) => x.pageId === page.id)?.strokes ?? [];
  const counts = new Map<string, number>();
  for (const s of strokes) counts.set(s.a.b, (counts.get(s.a.b) ?? 0) + 1);
  return (
    <div className="nbr nb">
      {pages.length > 1 && (
        <div className="nbr-pages" role="group" aria-label="Pages of notes">
          {pages.map((p, k) => (
            <button key={p.id} type="button" className="nbr-page" aria-pressed={p.id === page.id} onClick={() => setOpenId(p.id)}>
              {pageLabel(p.title, k)}
            </button>
          ))}
        </div>
      )}
      <div className="nbr-head">
        <h3 className="nbr-title">{name}</h3>
        {comments && (
          <button type="button" className="nb-hbtn nb-cmbtn" aria-label={comments.open ? `Comments, ${comments.open} open` : "Comments"} title="Comments" onClick={comments.showAll}>
            <MessageSquare size={16} aria-hidden="true" />
            {comments.open > 0 && <span className="nb-badge" aria-hidden="true">{comments.open > 99 ? "99+" : comments.open}</span>}
          </button>
        )}
      </div>
      <div ref={wrap} className="nb-inkwrap">
      <ol className="nbr-blocks" aria-label={`Blocks of ${name}`}>
        {page.blocks.map((b) => {
          const a = blockAnchor(page.id, b.id);
          const n = comments?.openOn(a) ?? 0;
          return (
            <li key={b.id} className="nbr-block" data-block={b.id}>
              {counts.has(b.id) && b.kind !== "space" && <span className="sr-only">Has a drawing, {strokesWord(counts.get(b.id)!)}.</span>}
              <div className="nbr-body nb-text" data-ink-body data-ink-text={b.kind === "text" || undefined}>
                {b.kind === "text" ? <MdView md={b.md} /> : b.kind === "space" ? <div className="nb-space" role="img" aria-label={`A drawing, ${strokesWord(counts.get(b.id) ?? 0)}`} style={{ aspectRatio: `10000 / ${b.h}` }} /> : b.kind === "quote" ? <QuoteBlockView b={b} mean={meanings[b.color]} removed={!!b.noteId && !known.has(b.noteId)} onGo={() => onGoTo(b.page, b.quote)} /> : b.kind === "image" ? <img className="nbr-img" src={`/api/v1/documents/${docId}/notebook/images/${b.id}`} alt={b.alt || "A picture in the notes"} width={b.w} height={b.h} loading="lazy" style={b.width !== undefined ? { width: `${b.width * 100}%`, height: "auto" } : undefined} /> : b.kind === "agent" ? <AgentBlockView b={b} onGo={(p) => onGoTo(p, "")} /> : <p className="cm-empty">{b.kind === "capture" ? `A part of page ${b.page}${b.caption ? `: ${b.caption}` : ""}` : "A sketch"}</p>}
              </div>
              {comments && (n > 0 || comments.canWrite) && (
                <button type="button" className="cm-dot" data-open={n > 0 || undefined} onClick={() => comments.show(a)} aria-label={n > 0 ? `${n} open ${n === 1 ? "comment" : "comments"} on this block` : "Comment on this block"} title={n > 0 ? "Open comments" : "Comment"}>
                  <MessageSquare size={13} aria-hidden="true" />
                  {n > 0 ? <span>{n}</span> : null}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {strokes.length > 0 && (
        <Suspense fallback={null}>
          <InkView wrap={wrap} blocks={page.blocks} strokes={strokes} />
        </Suspense>
      )}
      </div>
    </div>
  );
}
