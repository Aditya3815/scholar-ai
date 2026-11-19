import { AnimatePresence, m } from "motion/react";
import { Check, CircleCheck, Copy, Download, Highlighter, MessageSquare, NotebookPen, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MAX_NOTE_CHARS, NOTE_COLORS, notesMarkdown, type DocNote, type DocumentInfo, type NoteColor } from "@scholar/shared";
import { easeOut, spring } from "../../lib/motion";
import { useLegend } from "../../lib/legend";
import { type NotesApi } from "../../lib/notes";
import { PARKED } from "../../lib/workspace";
import { ColourFilter, LegendEditor } from "./HighlightsTools";

/** The new reader's Notebook, for a card: is the highlight quoted on a page of notes ("In notes"), and the two ways there (phase 2; today's reader passes nothing and the card is as it was). */
export type CardNotebook = { inNotes: (id: string) => boolean; add: (n: DocNote) => void; open: (n: DocNote) => void };
/** A shared paper's comments on a highlight (docs/design/paper-share.md, 5): how many open threads it has, and the way to its thread. Absent: no comments (today's reader, sharing off). */
export type CardComments = { open: (id: string) => number; show: (n: DocNote) => void; canWrite: boolean };

function NoteItem({ n, api, autoFocus, focusTick, onGo, onFocusDone, notebook, readOnly = false, comments }: { n: DocNote; api: NotesApi; autoFocus: boolean; focusTick: number; onGo: (n: DocNote) => void; onFocusDone?: (id: string) => void; notebook?: CardNotebook; readOnly?: boolean; comments?: CardComments }) {
  const [text, setText] = useState(n.note);
  const legend = useLegend();
  const area = useRef<HTMLTextAreaElement>(null);
  const item = useRef<HTMLLIElement>(null);
  useEffect(() => setText(n.note), [n.note]);
  // asked for (a new note, or the icon on the page was pressed): bring it into view in the list and put the cursor in it
  useEffect(() => {
    if (!autoFocus) return;
    item.current?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    area.current?.focus({ preventScroll: true });
  }, [autoFocus, focusTick]);
  const save = () => {
    if (text.trim() !== n.note) void api.update(n.id, { note: text });
    onFocusDone?.(n.id);
  };
  return (
    <m.li ref={item} className="note" data-color={n.color} data-note={n.id} layout="position" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -16 }} transition={spring}>
      <div className="note-head">
        <button type="button" className="note-page" onClick={() => onGo(n)} aria-label={`Go to page ${n.page}`}>p. {n.page}</button>
        {readOnly ? (
          <span className="note-dot note-dot-only" data-color={n.color} role="img" aria-label={legend[n.color]} />
        ) : (
          <>
            <div className="note-colors" role="group" aria-label="Colour">
              {NOTE_COLORS.map((c) => (
                <button key={c} type="button" className="note-dot" data-color={c} aria-pressed={n.color === c} aria-label={`${legend[c]} (${c})`} onClick={() => n.color !== c && void api.update(n.id, { color: c })} />
              ))}
            </div>
            <button type="button" className="icon-btn icon-btn-sm" aria-label={`Delete the note on page ${n.page}`} onClick={() => void api.remove(n.id)}>
              <Trash2 size={15} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
      <button type="button" className="note-quote" onClick={() => onGo(n)}>
        “{n.quote}”
      </button>
      {readOnly ? (
        n.note ? <p className="note-text note-text-read">{n.note}</p> : null
      ) : (<>
      <label className="sr-only" htmlFor={`note-${n.id}`}>Your note on page {n.page}</label>
      <textarea
        id={`note-${n.id}`}
        ref={area}
        className="note-text"
        rows={n.note || autoFocus ? 3 : 1}
        maxLength={MAX_NOTE_CHARS}
        placeholder="Add a note…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
      />
      </>)}
      {(notebook || comments) && (
        <div className="note-nb">
          {!notebook || readOnly ? null : notebook.inNotes(n.id) ? (
            <button type="button" className="btn btn-ghost btn-sm note-innotes" onClick={() => notebook.open(n)} aria-label={`In notes: open the quote of the highlight on page ${n.page}`}>
              <CircleCheck size={14} aria-hidden="true" />
              <span>In notes</span>
            </button>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => notebook.add(n)} aria-label={`Add the highlight on page ${n.page} to your notes`}>
              <NotebookPen size={14} aria-hidden="true" />
              <span>Add to notes</span>
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onGo(n)} aria-label={`Show the highlight on page ${n.page} in the paper`}>
            <span>Show in paper</span>
          </button>
          {comments && (comments.open(n.id) > 0 || comments.canWrite) && (
            <button type="button" className="btn btn-ghost btn-sm note-comments" data-open={comments.open(n.id) > 0 || undefined} onClick={() => comments.show(n)} aria-label={comments.open(n.id) > 0 ? `${comments.open(n.id)} open ${comments.open(n.id) === 1 ? "comment" : "comments"} on the highlight on page ${n.page}` : `Comment on the highlight on page ${n.page}`}>
              <MessageSquare size={14} aria-hidden="true" />
              <span>{comments.open(n.id) > 0 ? comments.open(n.id) : "Comment"}</span>
            </button>
          )}
        </div>
      )}
    </m.li>
  );
}

/**
 * Highlights and notes for the open paper, in page order: click one to jump to it, edit the words, change the colour, export them all. `compact` (the new reader): the head is one tidy row (the
 * count, By page | By colour, and the reader's one Export menu for Copy and Download, `exportMenu`), and the colour chips stay on one line with no empty colour.
 */
export function NotesPanel({ doc, api, focusId, focusTick = 0, onGo, onFocusDone, notebook, compact = false, exportMenu, readOnly = false, comments }: { doc: DocumentInfo; api: NotesApi; focusId: string | null; focusTick?: number; onGo: (n: DocNote) => void; onFocusDone?: (id: string) => void; notebook?: CardNotebook; compact?: boolean; exportMenu?: (a: { copy: () => void; download: () => void; copied: boolean }) => ReactNode; /** a paper shared with this person as Viewer or Commenter */ readOnly?: boolean; comments?: CardComments }) {
  const [copied, setCopied] = useState(false);
  const legend = useLegend();
  // the list can show one colour, or group the list by colour; the Markdown follows what is on screen
  const [colour, setColour] = useState<NoteColor | "all">("all");
  const [group, setGroup] = useState<"page" | "colour">("page");
  const shown = colour === "all" ? api.notes : api.notes.filter((n) => n.color === colour);
  const md = () => notesMarkdown(doc.title, shown, { legend, groupBy: group, ...(colour === "all" ? {} : { colours: [colour] }) });
  const copy = () => navigator.clipboard?.writeText(md()).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }, () => {});
  const download = () => {
    const url = URL.createObjectURL(new Blob([md()], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.title.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 60) || "notes"}-notes.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="notes">
      <div className="notes-head">
        <p className={compact && api.status !== "loading" && api.notes.length > 0 ? "notes-count sr-only" : "notes-count"} role="status">{api.status === "loading" ? "Loading…" : api.notes.length === 0 ? "No highlights yet" : `${api.notes.length} ${compact ? (api.notes.length === 1 ? "highlight" : "highlights") : api.notes.length === 1 ? "highlight or note" : "highlights and notes"}`}</p>
        {api.notes.length > 0 && (
          <div className="notes-actions">
            <div className="seg hl-group" role="group" aria-label="Order of the list">
              {(["page", "colour"] as const).map((g) => (
                <button key={g} type="button" className="seg-btn" aria-pressed={group === g} onClick={() => setGroup(g)}>
                  {group === g && <m.span layoutId="hl-group-pill" className="seg-pill" transition={spring} />}
                  <span className="seg-label hl-seg-label">{g === "page" ? "By page" : "By colour"}</span>
                </button>
              ))}
            </div>
            {exportMenu ? (
              exportMenu({ copy: () => void copy(), download, copied })
            ) : (
              <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
                  {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  <span>{copied ? "Copied" : "Copy as Markdown"}</span>
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={download}>
                  <Download size={14} aria-hidden="true" />
                  <span>Download</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {api.notes.length > 0 && (
        <div className="hl-tools">
          <ColourFilter notes={api.notes} value={colour} onChange={setColour} oneRow={compact} />
          {PARKED.colourNames && <LegendEditor />}
        </div>
      )}
      <div className="notes-body">
      {api.error && <p className="notes-error" role="alert">{api.error}</p>}
      {api.status !== "loading" && api.notes.length === 0 && (
        <m.div className="notes-empty" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: easeOut }}>
          <Highlighter size={22} aria-hidden="true" />
          <p>{readOnly ? "No highlights in this paper yet." : "Select any text in the paper to highlight it in a colour, or to add a note. They are kept with this paper, private to you, and listed here."}</p>
        </m.div>
      )}
      {api.notes.length > 0 && shown.length === 0 && <p className="sres-empty" role="status">No highlights in this colour.</p>}
      {group === "colour" ? (
        NOTE_COLORS.filter((c) => shown.some((n) => n.color === c)).map((c) => (
          <section key={c} className="hl-group-sec" aria-labelledby={`hl-g-${c}`}>
            <h3 id={`hl-g-${c}`} className="sres-h"><span className="sres-dot" data-color={c} aria-hidden="true" /> {legend[c]} <span className="wfilters-n">{shown.filter((n) => n.color === c).length}</span></h3>
            <ul className="notes-list" aria-label={`Highlights: ${legend[c]}`}>
              <AnimatePresence initial={false}>
                {shown.filter((n) => n.color === c).map((n) => (
                  <NoteItem key={n.id} n={n} api={api} autoFocus={focusId === n.id} focusTick={focusTick} onGo={onGo} onFocusDone={onFocusDone} notebook={notebook} readOnly={readOnly} comments={comments} />
                ))}
              </AnimatePresence>
            </ul>
          </section>
        ))
      ) : (
        <ul className="notes-list" aria-label="Highlights and notes">
          <AnimatePresence initial={false}>
            {shown.map((n) => (
              <NoteItem key={n.id} n={n} api={api} autoFocus={focusId === n.id} focusTick={focusTick} onGo={onGo} onFocusDone={onFocusDone} notebook={notebook} readOnly={readOnly} comments={comments} />
            ))}
          </AnimatePresence>
        </ul>
      )}
      </div>
    </div>
  );
}
