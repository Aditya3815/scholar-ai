import { AnimatePresence, m } from "motion/react";
import { ArrowUpRight, Check, Circle, CloudOff, Eraser, Hand, Highlighter, LassoSelect, Loader2, Minus, MousePointer2, Pen, Redo2, Square, StickyNote, Type, Undo2, X } from "lucide-react";
import { COLORS, INK_SIZES, ERASER_RADIUS, TEXT_SIZES, widthFor, type InkSize } from "@scholar/shared";
import type { InkApi } from "../../lib/ink";
import { spring } from "../../lib/motion";
import type { DrawTool } from "./InkLayer";
import "../../styles/ink.css";

type ToolDef = { id: DrawTool; label: string; key: string; Icon: typeof Pen };
const GROUPS: { name: string; tools: ToolDef[] }[] = [
  { name: "Read", tools: [{ id: "hand", label: "Select and read", key: "V", Icon: MousePointer2 }] },
  {
    name: "Draw",
    tools: [
      { id: "pen", label: "Pen", key: "P", Icon: Pen },
      { id: "highlighter", label: "Highlighter", key: "H", Icon: Highlighter },
      { id: "eraser", label: "Eraser", key: "E", Icon: Eraser },
    ],
  },
  {
    name: "Shapes",
    tools: [
      { id: "line", label: "Line", key: "L", Icon: Minus },
      { id: "arrow", label: "Arrow", key: "A", Icon: ArrowUpRight },
      { id: "rect", label: "Rectangle", key: "R", Icon: Square },
      { id: "ellipse", label: "Ellipse", key: "O", Icon: Circle },
    ],
  },
  {
    name: "Write",
    tools: [
      { id: "text", label: "Text box", key: "T", Icon: Type },
      { id: "sticky", label: "Sticky note", key: "N", Icon: StickyNote },
    ],
  },
  { name: "Select", tools: [{ id: "lasso", label: "Lasso: select, move, delete", key: "S", Icon: LassoSelect }] },
];
/** key to tool, for the keyboard (the viewer uses it) */
export const TOOL_KEYS: Record<string, DrawTool> = Object.fromEntries(GROUPS.flatMap((g) => g.tools.map((t) => [t.key.toLowerCase(), t.id])));

const SIZE_NAME: Record<InkSize, string> = { s: "Thin", m: "Medium", l: "Thick", xl: "Extra thick" };
const TEXT_NAME: Record<InkSize, string> = { s: "Small text", m: "Medium text", l: "Large text", xl: "Extra large text" };

/** Which palette a tool uses (null: none), and which size setting (null: none). Shapes draw like the pen; sticky notes are coloured like the highlighter. */
export const paletteOf = (t: DrawTool): "pen" | "highlighter" | null => (t === "highlighter" || t === "sticky" ? "highlighter" : t === "hand" || t === "eraser" || t === "lasso" ? null : "pen");
export const sizeOf = (t: DrawTool): "pen" | "highlighter" | "eraser" | "text" | null => (t === "highlighter" ? "highlighter" : t === "eraser" ? "eraser" : t === "text" ? "text" : t === "hand" || t === "lasso" || t === "sticky" ? null : "pen");

/** How big the sample dot of a size button is: the line it makes at a typical page width (about 700 px), kept between 4 and 18 px. */
const dot = (kind: "pen" | "highlighter" | "eraser", s: InkSize) => {
  const px = (kind === "eraser" ? ERASER_RADIUS[s] * 2 : widthFor(kind, s)) * 700;
  return Math.min(18, Math.max(4, px));
};

export type InkPrefs = { tool: DrawTool; color: Record<"pen" | "highlighter", string>; size: Record<"pen" | "highlighter" | "eraser" | "text", InkSize>; finger: boolean };

const STATUS: Record<InkApi["status"], { text: string; tone: "ok" | "wait" | "bad" | "info" }> = {
  loading: { text: "Loading your drawing", tone: "wait" },
  ready: { text: "Saved", tone: "ok" },
  saved: { text: "Saved", tone: "ok" },
  saving: { text: "Saving", tone: "wait" },
  error: { text: "Not saved yet", tone: "bad" },
  conflict: { text: "Updated from another window", tone: "info" },
  offline: { text: "Offline: kept on this device", tone: "info" },
};

/**
 * The drawing tools of My Workspace: select, pen, highlighter, eraser, shapes, text box, sticky note and lasso; size and colour; undo and redo; whether a finger draws; and
 * whether the drawing is saved. Drawing needs a pointer; marking text from the keyboard is the highlight of the Notes tab (select text, then choose a colour).
 */
export function InkToolbar({ open, prefs, onPrefs, ink, canTouch, onClose }: { open: boolean; prefs: InkPrefs; onPrefs: (p: InkPrefs) => void; ink: InkApi; canTouch: boolean; onClose: () => void }) {
  const t = prefs.tool;
  const pal = paletteOf(t);
  const sk = sizeOf(t);
  const st = STATUS[ink.status];
  const set = (patch: Partial<InkPrefs>) => onPrefs({ ...prefs, ...patch });
  return (
    <AnimatePresence initial={false}>
      {open && (
        <m.div className="inkbar-wrap" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring}>
          <div className="inkbar" role="toolbar" aria-label="Draw on the paper">
            {GROUPS.map((g, gi) => (
              <div key={g.name} className="inkbar-set">
                {gi > 0 && <div className="inkbar-sep" aria-hidden="true" />}
                <div className="inkbar-group" role="group" aria-label={g.name}>
                  {g.tools.map(({ id, label, key, Icon }) => (
                    <button key={id} type="button" className="inkbar-tool" aria-pressed={t === id} title={`${label} (${key})`} aria-keyshortcuts={key} onClick={() => set({ tool: id })}>
                      {t === id && <m.span layoutId="ink-tool-pill" className="inkbar-pill" transition={spring} />}
                      <Icon size={17} aria-hidden="true" />
                      <span className="inkbar-lab">{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <div className="inkbar-sep" aria-hidden="true" />

            <div className="inkbar-group" role="radiogroup" aria-label={t === "eraser" ? "Eraser size" : t === "text" ? "Text size" : "Line thickness"} data-off={!sk}>
              {INK_SIZES.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={!!sk && prefs.size[sk] === s}
                  className="inkbar-size"
                  disabled={!sk}
                  title={t === "text" ? TEXT_NAME[s] : SIZE_NAME[s]}
                  aria-label={t === "text" ? TEXT_NAME[s] : SIZE_NAME[s]}
                  onClick={() => sk && set({ size: { ...prefs.size, [sk]: s } })}
                >
                  {t === "text" ? (
                    <span className="inkbar-aa" style={{ fontSize: 9 + TEXT_SIZES[s] * 520 }} aria-hidden="true">A</span>
                  ) : (
                    <span style={{ width: dot(sk && sk !== "text" ? sk : "pen", s), height: dot(sk && sk !== "text" ? sk : "pen", s) }} data-eraser={t === "eraser"} />
                  )}
                </button>
              ))}
            </div>

            <div className="inkbar-group inkbar-colors" role="radiogroup" aria-label="Colour" data-off={!pal}>
              {COLORS[pal ?? "pen"].map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={!!pal && prefs.color[pal] === c.id} className="inkbar-color" disabled={!pal} title={c.label} aria-label={c.label} style={{ ["--c" as string]: c.hex }} onClick={() => pal && set({ color: { ...prefs.color, [pal]: c.id } })} />
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

