import { Pencil } from "lucide-react";
import { useState } from "react";
import { MAX_LEGEND_CHARS, NOTE_COLORS, type DocNote, type NoteColor } from "@scholar/shared";
import { currentLegend, setLegendName, useLegend } from "../../lib/legend";

/** Show all, or one colour. Each chip carries the reader's own name for the colour and how many highlights have it. */
export function ColourFilter({ notes, value, onChange }: { notes: DocNote[]; value: NoteColor | "all"; onChange: (c: NoteColor | "all") => void }) {
  const legend = useLegend();
  const count = (c: NoteColor) => notes.filter((n) => n.color === c).length;
  return (
    <div className="hl-filter" role="group" aria-label="Show highlights by colour">
      <button type="button" className="chip-btn" aria-pressed={value === "all"} onClick={() => onChange("all")}>
        All <span className="wfilters-n">{notes.length}</span>
      </button>
      {NOTE_COLORS.map((c) => (
        <button key={c} type="button" className="chip-btn hl-chip" aria-pressed={value === c} disabled={count(c) === 0 && value !== c} onClick={() => onChange(value === c ? "all" : c)}>
          <span className="sres-dot" data-color={c} aria-hidden="true" />
          {legend[c]} <span className="wfilters-n">{count(c)}</span>
        </button>
      ))}
    </div>
  );
}

/** The four colour names, editable: yellow can mean "Important" to one reader and "Result" to another. Kept on this device. */
export function LegendEditor() {
  const legend = useLegend();
  const [open, setOpen] = useState(false);
  return (
    <div className="hl-legend">
      <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Pencil size={13} aria-hidden="true" /> {open ? "Done naming colours" : "Name the colours"}
      </button>
      {open && (
        <div className="hl-legend-grid">
          {NOTE_COLORS.map((c) => (
            <label key={c} className="hl-legend-row">
              <span className="sres-dot" data-color={c} aria-hidden="true" />
              <span className="sr-only">What {c} means</span>
              <input
                className="meta-input"
                defaultValue={legend[c]}
                maxLength={MAX_LEGEND_CHARS}
                aria-label={`What ${c} means`}
                // saved when the field is left, so a half-typed name is never what the filters show
                onBlur={(e) => {
                  setLegendName(c, e.target.value);
                  e.target.value = currentLegend()[c];
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())}
              />
            </label>
          ))}
          <p className="meta-fine">These names stay on this device. They name the sections of the Markdown you copy, and are sent with a question about your highlights so the answer uses your words.</p>
        </div>
      )}
    </div>
  );
}
