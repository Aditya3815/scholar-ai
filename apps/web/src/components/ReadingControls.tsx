import { Type } from "lucide-react";
import { readingStore, type ReadingPrefs } from "../lib/prefs";
import { Pop } from "./Pop";

const WIDTHS: { id: ReadingPrefs["width"]; label: string }[] = [
  { id: "narrow", label: "Narrow" },
  { id: "medium", label: "Medium" },
  { id: "wide", label: "Wide" },
];
const FONTS: { id: ReadingPrefs["font"]; label: string }[] = [
  { id: "serif", label: "Serif" },
  { id: "sans", label: "Sans" },
  { id: "easy", label: "Easy-read" },
];

export function ReadingControls() {
  const prefs = readingStore.use();
  const set = (patch: Partial<ReadingPrefs>) => readingStore.set({ ...prefs, ...patch });

  return (
    <Pop
      label="Reading settings"
      align="end"
      trigger={(open) => (
        <button type="button" className="icon-btn" aria-label="Reading settings" aria-expanded={open}>
          <Type size={18} aria-hidden="true" />
        </button>
      )}
    >
      <div className="rc">
        <h2 className="pop-title">Reading settings</h2>

        <label className="rc-row" htmlFor="rc-size">
          <span>Text size</span>
          <output>{prefs.size}px</output>
        </label>
        <input
          id="rc-size"
          type="range"
          min={15}
          max={24}
          step={1}
          value={prefs.size}
          onChange={(e) => set({ size: Number(e.target.value) })}
        />

        <fieldset className="rc-group">
          <legend>Line width</legend>
          {WIDTHS.map((w) => (
            <button key={w.id} type="button" className="chip-btn" aria-pressed={prefs.width === w.id} onClick={() => set({ width: w.id })}>
              {w.label}
            </button>
          ))}
        </fieldset>

        <fieldset className="rc-group">
          <legend>Font</legend>
          {FONTS.map((f) => (
            <button key={f.id} type="button" className="chip-btn" aria-pressed={prefs.font === f.id} onClick={() => set({ font: f.id })}>
              {f.label}
            </button>
          ))}
        </fieldset>

        <p className="reading rc-preview">
          The quick brown fox jumps over the lazy dog. हिंदी पाठ भी इसी सेटिंग के अनुसार बदलता है।
        </p>
      </div>
    </Pop>
  );
}
