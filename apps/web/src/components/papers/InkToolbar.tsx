import { AnimatePresence, m } from "motion/react";
import { Check, CloudOff, Eraser, Hand, Highlighter, Loader2, MousePointer2, Pen, Redo2, Undo2, X } from "lucide-react";
import { COLORS, INK_SIZES, ERASER_RADIUS, widthFor, type InkSize } from "@scholar/shared";
import type { InkApi } from "../../lib/ink";
import { spring } from "../../lib/motion";
import type { DrawTool } from "./InkLayer";
import "../../styles/ink.css";

const TOOLS: { id: DrawTool; label: string; key: string; Icon: typeof Pen }[] = [
  { id: "hand", label: "Select and read", key: "V", Icon: MousePointer2 },
  { id: "pen", label: "Pen", key: "P", Icon: Pen },
  { id: "highlighter", label: "Highlighter", key: "H", Icon: Highlighter },
  { id: "eraser", label: "Eraser", key: "E", Icon: Eraser },
];
const SIZE_NAME: Record<InkSize, string> = { s: "Thin", m: "Medium", l: "Thick", xl: "Extra thick" };

/** How big the sample dot of a size button is: the line it makes at a typical page width (about 700 px), kept between 4 and 18 px. */
const dot = (tool: DrawTool, s: InkSize) => {
  const px = (tool === "eraser" ? ERASER_RADIUS[s] * 2 : widthFor(tool === "highlighter" ? "highlighter" : "pen", s)) * 700;
  return Math.min(18, Math.max(4, px));
};

export type InkPrefs = { tool: DrawTool; color: Record<"pen" | "highlighter", string>; size: Record<"pen" | "highlighter" | "eraser", InkSize>; finger: boolean };

const STATUS: Record<InkApi["status"], { text: string; tone: "ok" | "wait" | "bad" | "info" }> = {
  loading: { text: "Loading your drawing", tone: "wait" },
  ready: { text: "Saved", tone: "ok" },
  saved: { text: "Saved", tone: "ok" },
  saving: { text: "Saving", tone: "wait" },
  error: { text: "Not saved yet", tone: "bad" },
  conflict: { text: "Updated from another window", tone: "info" },
};

/**
 * The drawing tools of My Workspace: select, pen, highlighter, eraser; size and colour; undo and redo; whether a finger draws; and whether the drawing is saved.
 * Drawing needs a pointer; marking text from the keyboard is the highlight of the Notes tab (select text, then choose a colour).
 */
export function InkToolbar({ open, prefs, onPrefs, ink, canTouch, onClose }: { open: boolean; prefs: InkPrefs; onPrefs: (p: InkPrefs) => void; ink: InkApi; canTouch: boolean; onClose: () => void }) {
  const t = prefs.tool;
  const colored = t === "pen" || t === "highlighter";
  const st = STATUS[ink.status];
  const set = (patch: Partial<InkPrefs>) => onPrefs({ ...prefs, ...patch });
  const sizeKey = t === "hand" ? "pen" : t;
  return (
    <AnimatePresence initial={false}>
      {open && (
        <m.div className="inkbar-wrap" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring}>
          <div className="inkbar" role="toolbar" aria-label="Draw on the paper">
            <div className="inkbar-group" role="group" aria-label="Tool">
              {TOOLS.map(({ id, label, key, Icon }) => (
                <button key={id} type="button" className="inkbar-tool" aria-pressed={t === id} title={`${label} (${key})`} aria-keyshortcuts={key} onClick={() => set({ tool: id })}>
                  {t === id && <m.span layoutId="ink-tool-pill" className="inkbar-pill" transition={spring} />}
                  <Icon size={17} aria-hidden="true" />
                  <span className="inkbar-lab">{label}</span>
                </button>
              ))}
            </div>

            <div className="inkbar-sep" aria-hidden="true" />

            <div className="inkbar-group" role="radiogroup" aria-label={t === "eraser" ? "Eraser size" : "Line thickness"} data-off={t === "hand"}>
              {INK_SIZES.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={prefs.size[sizeKey] === s} className="inkbar-size" disabled={t === "hand"} title={SIZE_NAME[s]} aria-label={SIZE_NAME[s]} onClick={() => set({ size: { ...prefs.size, [sizeKey]: s } })}>
                  <span style={{ width: dot(t, s), height: dot(t, s) }} data-eraser={t === "eraser"} />
                </button>
              ))}
            </div>

            <div className="inkbar-group inkbar-colors" role="radiogroup" aria-label="Colour" data-off={!colored}>
              {(colored ? COLORS[t] : COLORS.pen).map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={colored && prefs.color[t] === c.id} className="inkbar-color" disabled={!colored} title={c.label} aria-label={c.label} style={{ ["--c" as string]: c.hex }} onClick={() => colored && set({ color: { ...prefs.color, [t]: c.id } })} />
              ))}
            </div>

            <div className="inkbar-sep" aria-hidden="true" />

            <div className="inkbar-group">
              <button type="button" className="inkbar-icon" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!ink.canUndo} onClick={ink.undo}>
                <Undo2 size={17} aria-hidden="true" />
              </button>
              <button type="button" className="inkbar-icon" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!ink.canRedo} onClick={ink.redo}>
                <Redo2 size={17} aria-hidden="true" />
              </button>
              {canTouch && (
                <button type="button" className="inkbar-icon" aria-pressed={prefs.finger} title="Draw with a finger. A stylus always draws; with this off a finger scrolls." aria-label="Draw with a finger" onClick={() => set({ finger: !prefs.finger })}>
                  <Hand size={17} aria-hidden="true" />
                </button>
              )}
            </div>

            <div className="inkbar-end">
              {ink.status === "error" ? (
                <button type="button" className="inkbar-status" data-tone="bad" onClick={ink.retry}>
                  <CloudOff size={14} aria-hidden="true" />
                  <span>Not saved. Retry</span>
                </button>
              ) : (
                <span className="inkbar-status" data-tone={st.tone} role="status" aria-live="polite">
                  {st.tone === "wait" ? <Loader2 className="spin" size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
                  <span>{st.text}</span>
                </span>
              )}
              <button type="button" className="inkbar-icon" aria-label="Close the drawing tools" title="Close (Esc)" onClick={onClose}>
                <X size={17} aria-hidden="true" />
              </button>
            </div>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
