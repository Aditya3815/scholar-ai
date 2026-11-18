import { MessageSquare } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_COMMENT_CHARS, blockAnchor, mdPlainText, type CommentAnchor, type DocComment, type DocNote, type NoteColor, type NotebookPage } from "@scholar/shared";
import type { CommentsApi } from "../../../../lib/comments";
import type { Meaning } from "../../../../lib/meanings";
import { MdView, QuoteBlockView } from "../notebook/NbBlocks";
import "./share.css";

/**
 * The parts of a shared paper that only the people it is shared with, or its comments, need (docs/design/paper-share.md, sections 4 and 5): a chunk of its own ("shared"), fetched when
 * sharing is on for the paper. The comments (a thread on a highlight or a notebook block, its replies, edit and delete of one's own, resolve by the owner and Editors, and the Comments filter
 * that lists them), and the read-only Notes of a Viewer or a Commenter.
 */

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export type CommentsPanelProps = {
  api: CommentsApi;
  /** The role of the person reading: a Commenter up writes, the owner and Editors resolve, the owner deletes any. */
  role: "owner" | "editor" | "commenter" | "viewer";
  /** One thing's threads (a highlight, a block), with a box to start one; null: the Comments filter, every thread. */
  anchor: CommentAnchor | null;
  /** What a thread hangs on, in words ("Highlight on p. 3: “…”"). */
  describe: (anchor: CommentAnchor) => string;
  /** Show it: the highlight in the paper, the block in the notes. */
  onShow: (anchor: CommentAnchor) => void;
  onClose: () => void;
  announce: (s: string) => void;
  signedIn: boolean;
};

function Writer({ label, onSend, autoFocus, initial = "", onCancel }: { label: string; onSend: (body: string) => Promise<boolean>; autoFocus?: boolean; initial?: string; onCancel?: () => void }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    if (await onSend(text)) setText("");
    setBusy(false);
  };
  return (
    <form
      className="cm-write"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <textarea
        aria-label={label}
        ref={ref}
        value={text}
        maxLength={MAX_COMMENT_CHARS}
        placeholder={label}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void send();
          } else if (e.key === "Escape" && onCancel) {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <div className="cm-write-row">
        <span className="cm-count" aria-hidden="true">{text.length > MAX_COMMENT_CHARS - 200 ? `${text.length} / ${MAX_COMMENT_CHARS}` : ""}</span>
        {onCancel && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !text.trim()}>
          {initial ? "Save" : "Comment"}
        </button>
      </div>
    </form>
  );
}

function Item({ c, api, role, announce }: { c: DocComment; api: CommentsApi; role: CommentsPanelProps["role"]; announce: (s: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canDelete = c.mine || role === "owner";
  return (
    <div className="cm-item" data-comment={c.id}>
      <span className="cm-by">
        <strong>{c.author ?? "A former member"}</strong>
        {c.mine ? " (you)" : ""} · <time dateTime={c.createdAt}>{when(c.createdAt)}</time>
        {c.updatedAt !== c.createdAt ? " · edited" : ""}
      </span>
      {editing ? (
        <Writer
          label="Edit your comment"
          initial={c.body}
          autoFocus
          onCancel={() => setEditing(false)}
          onSend={async (body) => {
            try {
              await api.edit(c.id, body);
              setEditing(false);
              announce("Comment saved");
              return true;
            } catch (e) {
              setError(e instanceof Error ? e.message : "It could not be saved");
              return false;
            }
          }}
        />
      ) : (
        <p className="cm-body">{c.body}</p>
      )}
      {error && <p className="notes-error" role="alert">{error}</p>}
      {!editing && (c.mine || canDelete) && (
        <div className="cm-acts">
          {c.mine && (
            <button type="button" className="link-btn" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="link-btn"
              onClick={() =>
                void api.remove(c.id).then(
                  () => announce(c.parentId ? "Reply deleted" : "Comment deleted"),
                  (e) => setError(e instanceof Error ? e.message : "It could not be deleted"),
                )
              }
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Thread({ root, replies, api, role, describe, onShow, announce, showAnchor, canWrite }: { root: DocComment; replies: DocComment[]; api: CommentsApi; role: CommentsPanelProps["role"]; describe: CommentsPanelProps["describe"]; onShow: CommentsPanelProps["onShow"]; announce: (s: string) => void; showAnchor: boolean; canWrite: boolean }) {
  const [replying, setReplying] = useState(false);
  const canResolve = role === "owner" || role === "editor";
  return (
    <article className="cm-thread" data-resolved={root.resolved} aria-label={`Comment by ${root.author ?? "a former member"}${root.resolved ? ", resolved" : ""}`}>
      {showAnchor && (
        <p className="cm-on">
          <button type="button" onClick={() => onShow(root.anchor)}>{describe(root.anchor)}</button>
        </p>
      )}
      <Item c={root} api={api} role={role} announce={announce} />
      {replies.map((r) => (
        <Item key={r.id} c={r} api={api} role={role} announce={announce} />
      ))}
      {replying ? (
        <Writer
          label="Reply"
          autoFocus
          onCancel={() => setReplying(false)}
          onSend={async (body) => {
            try {
              await api.add({ parentId: root.id, body });
              setReplying(false);
              announce("Reply added");
              return true;
            } catch {
              announce("The reply could not be added");
              return false;
            }
          }}
        />
      ) : (
        <div className="cm-acts">
          {canWrite && (
            <button type="button" className="link-btn" onClick={() => setReplying(true)}>
              Reply
            </button>
          )}
          {canResolve && (
            <button type="button" className="link-btn" onClick={() => void api.resolve(root.id, !root.resolved).then(() => announce(root.resolved ? "Thread opened again" : "Thread resolved"))}>
              {root.resolved ? "Open again" : "Resolve"}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export function CommentsPanel({ api, role, anchor, describe, onShow, onClose, announce, signedIn }: CommentsPanelProps) {
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");
  const [error, setError] = useState<string | null>(null);
  const canWrite = role !== "viewer";
  const threads = useMemo(() => {
    const roots = api.comments.filter((c) => !c.parentId && (anchor ? c.anchor === anchor : true));
    const shown = anchor ? roots : roots.filter((c) => (filter === "all" ? true : filter === "open" ? !c.resolved : c.resolved));
    return shown.map((root) => ({ root, replies: api.comments.filter((c) => c.parentId === root.id) }));
  }, [api.comments, anchor, filter]);
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    head.current?.focus({ preventScroll: true });
  }, [anchor]);

  return (
    <section className="cm" aria-labelledby="cm-h">
      <div className="cm-head">
        <h3 id="cm-h" ref={head} tabIndex={-1} className="cm-h">
          {anchor ? describe(anchor) : "Comments"}
        </h3>
        {!anchor && (
          <div className="seg cm-filter" role="group" aria-label="Show">
            {(["open", "resolved", "all"] as const).map((f) => (
              <button key={f} type="button" className="chip-btn" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === "open" ? "Open" : f === "resolved" ? "Resolved" : "All"}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          {anchor ? "All comments" : "Back to notes"}
        </button>
      </div>
      {api.status === "loading" && <p className="cm-empty" role="status">Loading the comments…</p>}
      {api.status === "error" && (
        <p className="notes-error" role="alert">
          The comments could not be loaded.{" "}
          <button type="button" className="link-btn" onClick={() => void api.reload()}>Try again</button>
        </p>
      )}
      {api.status === "ready" && threads.length === 0 && <p className="cm-empty">{anchor ? "No comments here yet." : filter === "open" ? "No open comments." : "No comments."}</p>}
      {threads.map((t) => (
        <Thread key={t.root.id} root={t.root} replies={t.replies} api={api} role={role} describe={describe} onShow={onShow} announce={announce} showAnchor={!anchor} canWrite={canWrite} />
      ))}
      {anchor && canWrite && (
        <>
          {error && <p className="notes-error" role="alert">{error}</p>}
          <Writer
            label="Add a comment"
            autoFocus={threads.length === 0}
            onSend={async (body) => {
              try {
                await api.add({ anchor, body });
                setError(null);
                announce("Comment added");
                return true;
              } catch (e) {
                setError(e instanceof Error ? e.message : "The comment could not be added");
                return false;
              }
            }}
          />
        </>
      )}
      {anchor && !canWrite && <p className="cm-empty">{signedIn ? "You can view this paper; commenting is for the people it is shared with as Commenter or Editor." : "Sign in to comment, if the link lets you."}</p>}
    </section>
  );
}

/* ---------------------------------------------------------------- the read-only Notes */

export type ReadNotebookProps = {
  docId: string;
  notes: DocNote[];
  meanings: Record<NoteColor, Meaning>;
  onGoTo: (page: number, quote: string) => void;
  /** Open threads on a block, and the way to them (a Commenter up writes; a Viewer reads). */
  comments: { openOn: (a: CommentAnchor) => number; show: (a: CommentAnchor) => void; canWrite: boolean } | null;
  /** The block to bring into view and flash (a comment's "Show"). */
  focus: { pageId: string; blockId: string; tick: number } | null;
};

/** A Viewer's or a Commenter's Notes: the owner's pages, as they are, with a page picker and, on each block, its comments. Nothing here can be changed. */
export function ReadNotebook({ docId, notes, meanings, onGoTo, comments, focus }: ReadNotebookProps) {
  const [pages, setPages] = useState<NotebookPage[] | null>(null);
  const [error, setError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    fetch(`/api/v1/documents/${docId}/notebook`, { credentials: "same-origin" })
      .then((r) => (r.ok ? (r.json() as Promise<{ pages: NotebookPage[] }>) : Promise.reject(new Error(String(r.status)))))
      .then((j) => !gone && setPages(j.pages), () => !gone && setError(true));
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
  return (
    <div className="nbr nb">
      {pages.length > 1 && (
        <div className="nbr-pages" role="group" aria-label="Pages of notes">
          {pages.map((p) => (
            <button key={p.id} type="button" className="chip-btn" aria-pressed={p.id === page.id} onClick={() => setOpenId(p.id)}>
              {p.title || "Untitled page"}
            </button>
          ))}
        </div>
      )}
      <h3 className="nbr-title">{page.title || "Untitled page"}</h3>
      <ol className="nbr-blocks" aria-label={`Blocks of ${page.title || "Untitled page"}`}>
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
