import { ArrowLeft, MessageSquare, MoreHorizontal, Reply, RotateCcw } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MAX_COMMENT_CHARS, mdPlainText, pageLabel, type CommentAnchor, type DocComment, type DocNote, type NoteColor, type NotebookPage } from "@scholar/shared";
import type { CommentsApi } from "../../../../lib/comments";
import type { Meaning } from "../../../../lib/meanings";
import { readPages } from "./read-pages";
import "./comments.css";

/**
 * The comments of a shared paper (docs/design/paper-share.md, 5; redrawn in the notes polish of 19 Nov, docs/design/paper-reader.md, 23): a chunk of its own, fetched when the comments
 * are first opened. The list of every thread (one card a thread, Open, Resolved and All with their counts), and one thing's thread: the quote it hangs on, each comment with its ⋯ menu
 * (Edit, Delete, which asks first), the replies on a thin line, Resolve in the head, and the box to write in at the bottom.
 */

/* ---------------------------------------------------------------- the comments (the notes polish of 19 Nov: a calm list of cards, and a thread as in a document's comments) */

/** "Just now", "5 min ago", "3 h ago", "Yesterday", "12 Nov"; the full date is the title of the <time>. */
const ago = (iso: string, now: number) => {
  const t = new Date(iso).getTime();
  const s = Math.max(0, (now - t) / 1000);
  if (s < 45) return "Just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  const d = new Date(t);
  const today = new Date(now);
  if (s < 86400 && d.getDate() === today.getDate()) return `${Math.floor(s / 3600)} h ago`;
  const y = new Date(now - 86400000);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
};
const full = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
/** The clock the relative times read; it moves once a minute while the comments are open. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}
// a tick drawn here (lucide's path): imported, it would become a chunk of its own that the first load preloads
const Check = () => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
const nameOf = (c: DocComment) => c.author ?? "A former member";
const Avatar = ({ c }: { c: Pick<DocComment, "author"> }) => (
  <span className="cm-av" aria-hidden="true">
    {(c.author ?? "?").trim().charAt(0).toUpperCase() || "?"}
  </span>
);

type PageLike = { id: string; title: string; blocks: NotebookPage["blocks"] };
/** What a thread hangs on, drawn as a quote: the words, the meaning's colour, and where it is (p. N of the paper, or the page of notes). */
type On = { text: string; color: NoteColor | null; where: string; whereLabel: string; gone: boolean };
function anchorOn(a: CommentAnchor, notes: DocNote[], pages: PageLike[] | null, docId: string): On {
  if (a.startsWith("note:")) {
    const n = notes.find((x) => x.id === a.slice(5));
    return n ? { text: n.quote.replace(/\s+/g, " "), color: n.color, where: `p. ${n.page}`, whereLabel: `Show it on page ${n.page} of the paper`, gone: false } : { text: "A highlight that was removed", color: null, where: "", whereLabel: "", gone: true };
  }
  const [, pageId, blockId] = a.split(":");
  const ps = pages ?? readPages.get(docId) ?? [];
  const k = ps.findIndex((p) => p.id === pageId);
  const b = ps[k]?.blocks.find((x) => x.id === blockId);
  if (!b) return { text: "A block of the notes", color: null, where: "", whereLabel: "", gone: !!pages };
  const text = b.kind === "text" ? mdPlainText(b.md) : b.kind === "quote" ? b.quote : b.kind === "capture" ? b.caption || `A part of page ${b.page}` : b.kind === "image" ? b.alt || "A picture" : b.kind === "sketch" ? "A sketch" : mdPlainText(b.text);
  const page = pageLabel(ps[k]!.title, k);
  return { text: text.replace(/\s+/g, " ").trim() || "An empty block", color: b.kind === "quote" ? b.color : null, where: page, whereLabel: `Show it in the notes, on ${page}`, gone: false };
}

export type CommentsPanelProps = {
  api: CommentsApi;
  /** The role of the person reading: a Commenter up writes, the owner and Editors resolve, the owner deletes any. */
  role: "owner" | "editor" | "commenter" | "viewer";
  /** One thing's thread (a highlight, a block), with a box to write in; null: the list of every thread. */
  anchor: CommentAnchor | null;
  docId: string;
  /** The paper's highlights and (for those who edit) the pages of notes: what a thread hangs on, drawn as a quote. */
  notes: DocNote[];
  pages: PageLike[] | null;
  meanings: Record<NoteColor, Meaning>;
  /** Show it: the highlight in the paper, the block in the notes. */
  onShow: (anchor: CommentAnchor) => void;
  /** A card of the list opens its thread. */
  onOpen: (anchor: CommentAnchor) => void;
  /** Back: from a thread to the list, from the list to the notes. */
  onClose: () => void;
  announce: (s: string) => void;
  signedIn: boolean;
};

/** The box to write in: one line that grows (to about six), a light border, and a primary button that is plainly off while it is empty. Ctrl/Cmd+Enter sends, Esc cancels. */
function Composer({ label, placeholder, action, onSend, onCancel, initial = "", autoFocus, boxRef }: { label: string; placeholder: string; action: string; onSend: (body: string) => Promise<boolean>; onCancel?: () => void; initial?: string; autoFocus?: boolean; boxRef?: React.RefObject<HTMLTextAreaElement | null> }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = boxRef ?? own;
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  };
  useLayoutEffect(fit, [text]);
  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    el?.focus({ preventScroll: true });
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus, ref]);
  const empty = !text.trim();
  const send = async () => {
    if (empty || busy) return;
    setBusy(true);
    if (await onSend(text.trim())) setText("");
    setBusy(false);
  };
  // a keyboard (a fine pointer): Enter sends and Shift+Enter makes a new line, as in a chat or a document's comments; a touch screen's keyboard: Enter makes a new line and the button sends
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  return (
    <form
      className="cm-compose"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <textarea
        ref={ref}
        rows={1}
        aria-label={label}
        value={text}
        maxLength={MAX_COMMENT_CHARS}
        placeholder={placeholder}
        enterKeyHint={touch ? "enter" : "send"}
        aria-keyshortcuts={touch ? "Control+Enter" : "Enter Control+Enter"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // a letter still being composed (an IME, as for Hindi) is never sent by its Enter
          if (e.key === "Enter" && !e.nativeEvent.isComposing && (e.ctrlKey || e.metaKey || (!touch && !e.shiftKey && !e.altKey))) {
            e.preventDefault();
            void send();
          } else if (e.key === "Escape" && (text || onCancel)) {
            e.preventDefault();
            e.stopPropagation();
            setText(initial);
            if (onCancel) onCancel();
            else e.currentTarget.blur();
          }
        }}
      />
      <div className="cm-compose-row">
        <span className="cm-hint" aria-hidden="true">
          {text.length > MAX_COMMENT_CHARS - 200 ? `${text.length} / ${MAX_COMMENT_CHARS}` : "Enter to send · Shift+Enter for a new line"}
        </span>
        {onCancel && (
          <button type="button" className="cm-btn" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="cm-btn cm-primary" disabled={empty || busy}>
          {action}
        </button>
      </div>
    </form>
  );
}

/** A comment's ⋯ menu (Edit, Delete): shown on hover or focus, always on touch. Opens upwards near the bottom of the panel. */
function ItemMenu({ label, items }: { label: string; items: { name: string; danger?: boolean; run: () => void }[] }) {
  const [open, setOpen] = useState<"down" | "up" | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const close = (refocus = true) => {
    setOpen(null);
    if (refocus) btn.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);
  return (
    <div className="cm-menuwrap">
      <button
        ref={btn}
        type="button"
        className="cm-more"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={!!open}
        onClick={() => {
          if (open) return close(false);
          const r = btn.current!.getBoundingClientRect();
          const panel = btn.current!.closest(".cm-body-scroll")?.getBoundingClientRect();
          setOpen(panel && r.bottom + 96 > panel.bottom ? "up" : "down");
        }}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={box}
          role="menu"
          aria-label={label}
          className="cm-menu"
          data-up={open === "up" || undefined}
          onKeyDown={(e) => {
            const all = [...(box.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
            const k = all.indexOf(document.activeElement as HTMLElement);
            if (e.key === "Escape" || e.key === "Tab") {
              if (e.key === "Escape") e.preventDefault();
              e.stopPropagation();
              return close(e.key === "Escape");
            }
            const to = e.key === "ArrowDown" ? (k + 1) % all.length : e.key === "ArrowUp" ? (k - 1 + all.length) % all.length : e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : -1;
            if (to < 0) return;
            e.preventDefault();
            all[to]?.focus();
          }}
        >
          {items.map((it) => (
            <button
              key={it.name}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="cm-menu-item"
              data-danger={it.danger || undefined}
              onClick={() => {
                close(false);
                it.run();
              }}
            >
              {it.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One comment: avatar, name (and "you"), when, the words; Edit and Delete in its ⋯ menu; Delete asks first, in place. */
function Item({ c, api, role, announce, now, replies }: { c: DocComment; api: CommentsApi; role: CommentsPanelProps["role"]; announce: (s: string) => void; now: number; replies: number }) {
  const [mode, setMode] = useState<"read" | "edit" | "delete">("read");
  const [error, setError] = useState<string | null>(null);
  const canDelete = c.mine || role === "owner";
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (mode === "delete") keep.current?.focus({ preventScroll: true });
  }, [mode]);
  const items = [...(c.mine ? [{ name: "Edit", run: () => setMode("edit") }] : []), ...(canDelete ? [{ name: "Delete", danger: true, run: () => setMode("delete") }] : [])];
  return (
    <article className="cm-c" data-comment={c.id} aria-label={`${nameOf(c)}${c.mine ? " (you)" : ""}, ${ago(c.createdAt, now)}`}>
      <Avatar c={c} />
      <div className="cm-main">
        <p className="cm-meta">
          <b>{nameOf(c)}</b>
          {c.mine && <span className="cm-you">you</span>}
          <time dateTime={c.createdAt} title={full(c.createdAt)}>
            {ago(c.createdAt, now)}
          </time>
          {c.updatedAt !== c.createdAt && <span className="cm-edited">edited</span>}
        </p>
        {mode === "edit" ? (
          <Composer
            label="Edit your comment"
            placeholder="Edit your comment…"
            action="Save"
            initial={c.body}
            autoFocus
            onCancel={() => setMode("read")}
            onSend={async (body) => {
              try {
                await api.edit(c.id, body);
                setMode("read");
                setError(null);
                announce("Comment saved");
                return true;
              } catch (e) {
                setError(e instanceof Error ? e.message : "It could not be saved");
                return false;
              }
            }}
          />
        ) : (
          <p className="cm-text">{c.body}</p>
        )}
        {mode === "delete" && (
          <div className="cm-confirm" role="group" aria-label="Delete this comment?">
            <span>{!c.parentId && replies > 0 ? "Delete this comment and its replies?" : "Delete this comment?"}</span>
            <button
              type="button"
              className="cm-btn cm-danger"
              onClick={() =>
                void api.remove(c.id).then(
                  () => announce(c.parentId ? "Reply deleted" : "Comment deleted"),
                  (e) => (setError(e instanceof Error ? e.message : "It could not be deleted"), setMode("read")),
                )
              }
            >
              Delete
            </button>
            <button ref={keep} type="button" className="cm-btn" onClick={() => setMode("read")}>
              Cancel
            </button>
          </div>
        )}
        {error && (
          <p className="notes-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {mode === "read" && items.length > 0 && <ItemMenu label={`Actions of ${c.mine ? "your comment" : `the comment by ${nameOf(c)}`}`} items={items} />}
    </article>
  );
}

/** The quote a thread hangs on: a bar in the meaning's colour, the words (muted, two lines), and "p. N ↗" that goes there. */
function AnchorQuote({ on, meanings, onShow }: { on: On; meanings: Record<NoteColor, Meaning>; onShow: () => void }) {
  return (
    <figure className="cm-quote" data-color={on.color ?? undefined} data-gone={on.gone || undefined}>
      <blockquote>
        {on.color && <span className="sr-only">{meanings[on.color].name}: </span>}
        {on.text}
      </blockquote>
      {on.where && (
        <button type="button" className="cm-chip cm-go" aria-label={on.whereLabel} title={on.whereLabel} onClick={onShow}>
          {on.where} <span aria-hidden="true">↗</span>
        </button>
      )}
    </figure>
  );
}

export function CommentsPanel({ api, role, anchor, docId, notes, pages, meanings, onShow, onOpen, onClose, announce, signedIn }: CommentsPanelProps) {
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const started = useRef(false);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
  const now = useNow();
  const canWrite = role !== "viewer";
  const canResolve = role === "owner" || role === "editor";
  const roots = useMemo(() => api.comments.filter((c) => !c.parentId), [api.comments]);
  const repliesOf = (id: string) => api.comments.filter((c) => c.parentId === id).sort((x, y) => (x.createdAt < y.createdAt ? -1 : x.createdAt > y.createdAt ? 1 : 0));
  const counts = { open: roots.filter((c) => !c.resolved).length, resolved: roots.filter((c) => c.resolved).length, all: roots.length };
  const here = anchor ? roots.filter((c) => c.anchor === anchor) : [];
  // the thread's head acts on its first open thread (or its first); a thing with more than one thread (made before 19 Nov) shows each, with its own Resolve
  const main = here.find((c) => !c.resolved) ?? here[0] ?? null;
  const target = here.find((c) => c.id === replyTo) ?? main;
  const head = useRef<HTMLHeadingElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setReplyTo(null);
    setError(null);
    started.current = false;
    // a thread with nothing in it yet: the box takes the cursor; otherwise the heading does, so a screen reader hears where it is
    if (anchor && canWrite && here.length === 0) box.current?.focus({ preventScroll: true });
    else head.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);
  const resolve = (root: DocComment) => void api.resolve(root.id, !root.resolved).then(() => announce(root.resolved ? "Thread opened again" : "Thread resolved"));

  const status =
    api.status === "loading" ? (
      <p className="cm-empty" role="status">
        Loading the comments…
      </p>
    ) : api.status === "error" ? (
      <p className="notes-error" role="alert">
        The comments could not be loaded.{" "}
        <button type="button" className="link-btn" onClick={() => void api.reload()}>
          Try again
        </button>
      </p>
    ) : null;

  if (!anchor) {
    const shown = roots.filter((c) => (filter === "all" ? true : filter === "open" ? !c.resolved : c.resolved));
    return (
      <section className="cm" aria-labelledby="cm-h">
        <div className="cm-head">
          <button type="button" className="cm-back" aria-label="Back to notes" onClick={onClose}>
            <ArrowLeft size={16} aria-hidden="true" />
            <span>Notes</span>
          </button>
          <h3 id="cm-h" ref={head} tabIndex={-1} className="cm-title">
            Comments
          </h3>
          <div className="cm-seg" role="group" aria-label="Show">
            {(["open", "resolved", "all"] as const).map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === "open" ? "Open" : f === "resolved" ? "Resolved" : "All"} <span className="cm-n">{counts[f]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="cm-body-scroll">
          {status}
          {api.status === "ready" && shown.length === 0 && (
            <div className="cm-none">
              <MessageSquare size={20} aria-hidden="true" />
              <p className="cm-none-h">{filter === "open" ? "No open comments" : filter === "resolved" ? "No resolved comments" : "No comments yet"}</p>
              <p>{canWrite ? "To add one, choose Comment on a highlight's card, in the pop-up on the paper, or beside a block of the notes." : "Comments from the people this paper is shared with show here."}</p>
            </div>
          )}
          {shown.length > 0 && (
            <ul className="cm-cards" aria-label={`${filter === "open" ? "Open" : filter === "resolved" ? "Resolved" : "All"} comments`}>
              {shown.map((root) => {
                const rs = repliesOf(root.id);
                const on = anchorOn(root.anchor, notes, pages, docId);
                const last = [root, ...rs].reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
                const people = [...new Map([root, ...rs].map((c) => [c.author ?? "?", c])).values()].slice(0, 3);
                return (
                  <li key={root.id}>
                    <button type="button" className="cm-card" data-resolved={root.resolved || undefined} onClick={() => onOpen(root.anchor)}>
                      <span className="cm-card-on">
                        <span className="cm-dotc" data-color={on.color ?? undefined} aria-hidden="true" />
                        {on.where && <span className="cm-chip">{on.where}</span>}
                        <span className="cm-card-q">
                          {on.color && <span className="sr-only">{meanings[on.color].name}: </span>}
                          {on.text}
                        </span>
                      </span>
                      <span className="cm-card-body">{root.body}</span>
                      <span className="cm-card-meta">
                        <span className="cm-stack" aria-hidden="true">
                          {people.map((c, k) => (
                            <Avatar key={k} c={c} />
                          ))}
                        </span>
                        <span className="cm-card-who">{nameOf(root)}</span>
                        <time dateTime={last.createdAt} title={full(last.createdAt)}>
                          {ago(last.createdAt, now)}
                        </time>
                        {rs.length > 0 && <span>{rs.length === 1 ? "1 reply" : `${rs.length} replies`}</span>}
                        {root.resolved && <span className="cm-badge">Resolved</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    );
  }

  const on = anchorOn(anchor, notes, pages, docId);
  /** The box: "Add a comment" (a new thread, at the bottom of the panel) or "Reply" (at the end of the thread it answers). */
  const writeBox = (to: DocComment | null) => (
    <Composer
      key={to?.id ?? "new"}
      autoFocus={!!to && started.current}
      boxRef={box}
      label={to ? "Reply" : "Add a comment"}
      placeholder={to ? "Reply…" : "Add a comment…"}
      action={to ? "Reply" : "Comment"}
      onSend={async (body) => {
        try {
          if (to) await api.add({ parentId: to.id, body });
          else {
            await api.add({ anchor, body });
            // the thread is made: the box moves to its end as Reply, and keeps the cursor
            started.current = true;
          }
          setError(null);
          announce(to ? "Reply added" : "Comment added");
          return true;
        } catch (e) {
          setError(e instanceof Error ? e.message : to ? "The reply could not be added" : "The comment could not be added");
          return false;
        }
      }}
    />
  );
  return (
    <section className="cm" aria-labelledby="cm-h">
      <div className="cm-head">
        <button type="button" className="cm-back" aria-label="All comments" onClick={onClose}>
          <ArrowLeft size={16} aria-hidden="true" />
          <span>Comments</span>
        </button>
        <h3 id="cm-h" ref={head} tabIndex={-1} className="sr-only">
          Comments on {anchor.startsWith("note:") ? `the highlight${on.where ? ` on ${on.where}` : ""}` : `a block of the notes${on.where ? `, ${on.where}` : ""}`}
        </h3>
        {main && <span className="cm-status" data-resolved={main.resolved || undefined}>{main.resolved ? "Resolved" : "Open"}</span>}
        {main && canResolve && (
          <button type="button" className="cm-btn cm-resolve" onClick={() => resolve(main)}>
            {main.resolved ? <RotateCcw size={15} aria-hidden="true" /> : <Check />}
            <span>{main.resolved ? "Reopen" : "Resolve"}</span>
          </button>
        )}
      </div>
      <div className="cm-body-scroll">
        <AnchorQuote on={on} meanings={meanings} onShow={() => onShow(anchor)} />
        {status}
        {api.status === "ready" && here.length === 0 && <p className="cm-empty">{canWrite ? "No comments here yet. Write the first one below." : "No comments here yet."}</p>}
        {here.map((root) => {
          const rs = repliesOf(root.id);
          // a long thread shows its last two replies, with the earlier ones behind "Show N earlier replies"
          const folded = rs.length > 3 && !unfolded.has(root.id);
          const shown = folded ? rs.slice(-2) : rs;
          const replying = canWrite && root === target;
          return (
            <article key={root.id} className="cm-thread" data-resolved={root.resolved || undefined} aria-label={`Thread by ${nameOf(root)}, ${rs.length === 1 ? "1 reply" : `${rs.length} replies`}`}>
              <Item c={root} api={api} role={role} announce={announce} now={now} replies={rs.length} />
              {rs.length > 0 && (
                <div className="cm-replies">
                  {rs.length > 3 && (
                    <button type="button" className="cm-fold" aria-expanded={!folded} onClick={() => setUnfolded((u) => { const n = new Set(u); if (n.has(root.id)) n.delete(root.id); else n.add(root.id); return n; })}>
                      {folded ? `Show ${rs.length - 2} earlier ${rs.length - 2 === 1 ? "reply" : "replies"}` : "Show fewer replies"}
                    </button>
                  )}
                  <ol aria-label={rs.length === 1 ? "1 reply" : `${rs.length} replies`}>
                    {shown.map((r) => (
                      <li key={r.id}>
                        <Item c={r} api={api} role={role} announce={announce} now={now} replies={0} />
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {replying ? (
                <div className="cm-thread-reply">
                  {error && (
                    <p className="notes-error" role="alert">
                      {error}
                    </p>
                  )}
                  {writeBox(root)}
                </div>
              ) : (
                (canWrite || (canResolve && root !== main)) && (
                  <div className="cm-thread-acts">
                    {canWrite && (
                      <button
                        type="button"
                        className="cm-btn"
                        onClick={() => {
                          setReplyTo(root.id);
                          window.setTimeout(() => box.current?.focus(), 0);
                        }}
                      >
                        <Reply size={15} aria-hidden="true" />
                        <span>Reply</span>
                      </button>
                    )}
                    {canResolve && root !== main && (
                      <button type="button" className="cm-btn" onClick={() => resolve(root)}>
                        {root.resolved ? "Reopen" : "Resolve"}
                      </button>
                    )}
                  </div>
                )
              )}
            </article>
          );
        })}
      </div>
      {canWrite && !target && (
        <div className="cm-foot">
          {error && (
            <p className="notes-error" role="alert">
              {error}
            </p>
          )}
          {writeBox(null)}
        </div>
      )}
      {!canWrite && <p className="cm-empty cm-foot">{signedIn ? "You can view this paper; commenting is for the people it is shared with as Commenter or Editor." : "Sign in to comment, if the link lets you."}</p>}
    </section>
  );
}

