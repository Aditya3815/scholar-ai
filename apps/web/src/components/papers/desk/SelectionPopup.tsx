import { m } from "motion/react";
import { CircleCheck, Copy, MessageCircleQuestion, MessageSquarePlus, NotebookPen, Trash2 } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { NOTE_COLORS, type DocNote, type NoteColor } from "@scholar/shared";
import { MEANINGS } from "../../../lib/meanings";
import { springPop } from "../../../lib/motion";
import type { DeskPopup } from "../PdfViewer";
import { MeaningDot, useReportRect } from "./DeskBits";

export type PopupActions = {
  /** The meaning a new selection's note is made in (the Highlight picker's). */
  meaning: NoteColor;
  explain: (quote: string, page: number) => void;
  copy: (quote: string) => void;
  recolor: (note: DocNote, color: NoteColor) => void;
  remove: (note: DocNote) => void;
  /** Add to notes (phase 2): a quote of the highlight on the open notebook page; a new selection is highlighted first, in the meaning chosen. */
  addToNotes: (p: { page: number; quote: string; note: DocNote | null }) => void;
  /** Is this highlight quoted on a page of notes already ("In notes")? */
  inNotes: (note: DocNote) => boolean;
  showInNotes: (note: DocNote) => void;
  /** A paper shared with this person (docs/design/paper-share.md, 4): only what their role allows. `readOnly`: no meanings, no Add to notes, no Remove (a Viewer or a Commenter). */
  readOnly?: boolean;
  /** No Explain (a Viewer: Ask runs on the owner's index). */
  noExplain?: boolean;
  /** Comment on a highlight (a Commenter up, with sharing on). */
  comment?: (note: DocNote) => void;
};

/**
 * The pop-up of a selection, or of a highlight that was clicked (docs/design/paper-reader.md, section 4). It follows the selection on a wide screen and is a fixed pill at the bottom on a phone.
 * A toolbar: the arrows move inside it (Home and End to its ends), Esc closes it and gives the focus back to the pages; Tab from the pages comes into it (PdfViewer).
 * New selection: the four meanings, Add to notes, Explain, Copy. A highlight: the four meanings to recolour it (a ring on its own), Add to notes (or In notes, which opens the block), Explain,
 * Copy, Remove (section 4; until phase 2 it was "Add note", which opened the highlight's own note: that note is written in the Highlights list).
 */
export function SelectionPopup({ p, wide, actions, onRect }: { p: DeskPopup; wide: boolean; actions: PopupActions; onRect: (r: DOMRect | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useReportRect(box, onRect, [p.left, p.top, p.note?.id, wide]);
  const note = p.note;
  // a pop-up that the keyboard opened keeps the focus where it was until Tab brings it in; one that closes with the focus inside gives it back to the pages
  useEffect(() => () => {
    if (box.current?.contains(document.activeElement)) document.querySelector<HTMLElement>(".pdfv-scroll")?.focus({ preventScroll: true });
  }, []);
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(box.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    let to = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") to = (i + 1) % items.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") to = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = items.length - 1;
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      return p.close(true);
    }
    if (to < 0) return;
    e.preventDefault();
    items[to]?.focus();
  };
  const done = (fn: () => void) => () => {
    fn();
    p.close(false);
  };
  return (
    <m.div
      ref={box}
      className="desk-pop"
      data-wide={wide}
      data-kind={note ? "highlight" : "selection"}
      role="toolbar"
      aria-label={note ? `Highlight on page ${note.page}: ${MEANINGS[note.color].name}` : "The selected text"}
      style={wide ? { left: p.left, top: p.top } : undefined}
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={springPop}
      onMouseDown={(e) => e.preventDefault()}
      onKeyDown={keys}
    >
      {!actions.readOnly && (<><div className="desk-pop-dots" role="group" aria-label={note ? "Change the meaning" : "Highlight as"}>
        {NOTE_COLORS.map((c) => {
          const mean = MEANINGS[c];
          const current = note?.color === c;
          const label = note ? (current ? `${mean.name} (its meaning now)` : `Change to ${mean.name}`) : `Highlight as ${mean.name}`;
          return (
            <button
              key={c}
              type="button"
              className="desk-pop-dot"
              data-color={c}
              data-current={current || undefined}
              aria-pressed={note ? current : undefined}
              aria-label={label}
              title={label}
              onClick={done(() => (note ? !current && actions.recolor(note, c) : p.create(c, false)))}
            >
              <MeaningDot color={c} />
            </button>
          );
        })}
      </div>
      <span className="pdfv-sel-sep" aria-hidden="true" /></>)}
      {actions.readOnly ? null : note && actions.inNotes(note) ? (
        <button type="button" className="desk-pop-btn desk-pop-innotes" onClick={done(() => actions.showInNotes(note))} title="This highlight is in your notes: open it there">
          <CircleCheck size={14} aria-hidden="true" />
          <span>In notes</span>
        </button>
      ) : (
        <button type="button" className="desk-pop-btn" onClick={done(() => actions.addToNotes({ page: p.page, quote: p.quote, note }))} title={note ? "Put this highlight into your notes, as a quote" : `Highlight as ${MEANINGS[actions.meaning].name} and put it into your notes, as a quote`}>
          <NotebookPen size={14} aria-hidden="true" />
          <span>Add to notes</span>
        </button>
      )}
      {!actions.noExplain && (
        <button type="button" className="desk-pop-btn" onClick={done(() => actions.explain(p.quote, p.page))} title="Explain this in plain words, in the Agents">
          <MessageCircleQuestion size={14} aria-hidden="true" />
          <span>Explain</span>
        </button>
      )}
      {note && actions.comment && (
        <button type="button" className="desk-pop-btn" onClick={done(() => actions.comment!(note))} title="Comment on this highlight">
          <MessageSquarePlus size={14} aria-hidden="true" />
          <span>Comment</span>
        </button>
      )}
      <button type="button" className="desk-pop-btn" onClick={done(() => actions.copy(p.quote))} title="Copy the text">
        <Copy size={14} aria-hidden="true" />
        <span>Copy</span>
      </button>
      {note && !actions.readOnly && (
        <button type="button" className="desk-pop-btn desk-pop-remove" onClick={done(() => actions.remove(note))} title="Remove this highlight (you can undo it)">
          <Trash2 size={14} aria-hidden="true" />
          <span>Remove</span>
        </button>
      )}
    </m.div>
  );
}
