import { AnimatePresence, m } from "motion/react";
import { Check, Copy, Download, Highlighter, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MAX_NOTE_CHARS, NOTE_COLORS, type DocNote, type DocumentInfo, type NoteColor } from "@scholar/shared";
import { easeOut, spring } from "../../lib/motion";
import { useLegend } from "../../lib/legend";
import { notesToMarkdown, type NotesApi } from "../../lib/notes";
import { PARKED } from "../../lib/workspace";
import { ColourFilter, LegendEditor } from "./HighlightsTools";

function NoteItem({ n, api, autoFocus, focusTick, onGo, onFocusDone }: { n: DocNote; api: NotesApi; autoFocus: boolean; focusTick: number; onGo: (n: DocNote) => void; onFocusDone?: (id: string) => void }) {
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
        <div className="note-colors" role="group" aria-label="Colour">
          {NOTE_COLORS.map((c) => (
            <button key={c} type="button" className="note-dot" data-color={c} aria-pressed={n.color === c} aria-label={`${legend[c]} (${c})`} onClick={() => n.color !== c && void api.update(n.id, { color: c })} />
          ))}
        </div>
        <button type="button" className="icon-btn icon-btn-sm" aria-label={`Delete the note on page ${n.page}`} onClick={() => void api.remove(n.id)}>
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </div>
      <button type="button" className="note-quote" onClick={() => onGo(n)}>
        “{n.quote}”
      </button>
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
    </m.li>
  );
}

/** Highlights and notes for the open paper, in page order: click one to jump to it, edit the words, change the colour, export them all. */
export function NotesPanel({ doc, api, focusId, focusTick = 0, onGo, onFocusDone }: { doc: DocumentInfo; api: NotesApi; focusId: string | null; focusTick?: number; onGo: (n: DocNote) => void; onFocusDone?: (id: string) => void }) {
  const [copied, setCopied] = useState(false);
  const legend = useLegend();
  // the list can show one colour, or group the list by colour; the Markdown follows what is on screen
  const [colour, setColour] = useState<NoteColor | "all">("all");
  const [group, setGroup] = useState<"page" | "colour">("page");
  const shown = colour === "all" ? api.notes : api.notes.filter((n) => n.color === colour);
  const md = () => notesToMarkdown(doc.title, shown, { legend, groupBy: group, ...(colour === "all" ? {} : { colours: [colour] }) });
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
        <p className="notes-count" role="status">{api.status === "loading" ? "Loading…" : api.notes.length === 0 ? "No highlights yet" : `${api.notes.length} ${api.notes.length === 1 ? "highlight or note" : "highlights and notes"}`}</p>
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
            <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
              {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              <span>{copied ? "Copied" : "Copy as Markdown"}</span>
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={download}>
              <Download size={14} aria-hidden="true" />
              <span>Download</span>
            </button>
          </div>
        )}
      </div>
      {api.notes.length > 0 && (
        <div className="hl-tools">
          <ColourFilter notes={api.notes} value={colour} onChange={setColour} />
          {PARKED.colourNames && <LegendEditor />}
        </div>
      )}
      <div className="notes-body">
      {api.error && <p className="notes-error" role="alert">{api.error}</p>}
      {api.status !== "loading" && api.notes.length === 0 && (
        <m.div className="notes-empty" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: easeOut }}>
          <Highlighter size={22} aria-hidden="true" />
          <p>Select any text in the paper to highlight it in a colour, or to add a note. They are kept with this paper, private to you, and listed here.</p>
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
                  <NoteItem key={n.id} n={n} api={api} autoFocus={focusId === n.id} focusTick={focusTick} onGo={onGo} onFocusDone={onFocusDone} />
                ))}
              </AnimatePresence>
            </ul>
          </section>
        ))
      ) : (
        <ul className="notes-list" aria-label="Highlights and notes">
          <AnimatePresence initial={false}>
            {shown.map((n) => (
              <NoteItem key={n.id} n={n} api={api} autoFocus={focusId === n.id} focusTick={focusTick} onGo={onGo} onFocusDone={onFocusDone} />
            ))}
          </AnimatePresence>
        </ul>
      )}
      </div>
    </div>
  );
}
