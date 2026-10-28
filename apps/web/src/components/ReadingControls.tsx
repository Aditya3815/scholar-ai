import { readingStore, type ReadingPrefs } from "../lib/prefs";

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

/** Text size, line width and font for abstracts and the paper reader. On the Settings page. */
export function ReadingForm({ heading = true, idPrefix = "rc" }: { heading?: boolean; idPrefix?: string }) {
  const prefs = readingStore.use();
  const set = (patch: Partial<ReadingPrefs>) => readingStore.set({ ...prefs, ...patch });
  return (
      <div className="rc">
        {heading && <h2 className="pop-title">Reading settings</h2>}

        <label className="rc-row" htmlFor={`${idPrefix}-size`}>
          <span>Text size</span>
          <output>{prefs.size}px</output>
        </label>
        <input
          id={`${idPrefix}-size`}
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
  );
}
