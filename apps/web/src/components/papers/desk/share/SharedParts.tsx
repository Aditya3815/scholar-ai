import { MessageSquare } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { blockAnchor, mdPlainText, pageLabel, type CommentAnchor, type DocNote, type NoteColor, type NotebookPage } from "@scholar/shared";
import type { Meaning } from "../../../../lib/meanings";
import { MdView, QuoteBlockView } from "../notebook/NbBlocks";
import { readPages } from "./read-pages";
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
};


/** A Viewer's or a Commenter's Notes: the owner's pages, as they are, with a page picker and, on each block, its comments. Nothing here can be changed. */
export function ReadNotebook({ docId, notes, meanings, onGoTo, comments, focus }: ReadNotebookProps) {
  const [pages, setPages] = useState<NotebookPage[] | null>(() => readPages.get(docId) ?? null);
  const [error, setError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    fetch(`/api/v1/documents/${docId}/notebook`, { credentials: "same-origin" })
      .then((r) => (r.ok ? (r.json() as Promise<{ pages: NotebookPage[] }>) : Promise.reject(new Error(String(r.status)))))
      .then(
        (j) => {
          readPages.set(docId, j.pages);
          if (!gone) setPages(j.pages);
        },
        () => !gone && !readPages.has(docId) && setError(true),
      );
    return () => {
      gone = true;
    };
  }, [docId]);
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
      <ol className="nbr-blocks" aria-label={`Blocks of ${name}`}>
        {page.blocks.map((b) => {
          const a = blockAnchor(page.id, b.id);
          const n = comments?.openOn(a) ?? 0;
          return (
            <li key={b.id} className="nbr-block" data-block={b.id}>
              <div className="nbr-body nb-text">
                {b.kind === "text" ? <MdView md={b.md} /> : b.kind === "quote" ? <QuoteBlockView b={b} mean={meanings[b.color]} removed={!!b.noteId && !known.has(b.noteId)} onGo={() => onGoTo(b.page, b.quote)} /> : b.kind === "image" ? <img className="nbr-img" src={`/api/v1/documents/${docId}/notebook/images/${b.id}`} alt={b.alt || "A picture in the notes"} width={b.w} height={b.h} loading="lazy" /> : <p className="cm-empty">{b.kind === "capture" ? `A part of page ${b.page}${b.caption ? `: ${b.caption}` : ""}` : b.kind === "sketch" ? "A sketch" : mdPlainText(b.text)}</p>}
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
    </div>
  );
}
