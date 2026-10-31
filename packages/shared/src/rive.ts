import { LITSCAN_MAX_ITEMS, LITSCAN_MIN_ITEMS, type LitscanView } from "./litscan";

/**
 * The decisions behind the Rive pieces (docs/design/setu-rive.md, rive-ideas.md), kept apart from the browser so that they can be tested: whether a piece is shown at all, the page's colours as a
 * Rive file takes them, and what the bridge is told about a scan.
 */

export type RiveBlock = "reduced-motion" | "save-data" | "slow-network" | "no-wasm";

/**
 * Why the page should not show a Rive piece, or null when it may. The picture is an enhancement and the page is complete without it, so any doubt is a reason to leave it out: a person who asked for
 * less motion, a person who asked to save data, a connection too slow for 450 KB that nobody asked for (2g), a browser without WebAssembly. The first reason in that order is the one named.
 */
export function riveBlockedBy(env: { reducedMotion: boolean; saveData: boolean; effectiveType?: string; wasm: boolean }): RiveBlock | null {
  if (env.reducedMotion) return "reduced-motion";
  if (env.saveData) return "save-data";
  if (env.effectiveType === "slow-2g" || env.effectiveType === "2g") return "slow-network";
  if (!env.wasm) return "no-wasm";
  return null;
}

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC = /^rgba?\(([^)]*)\)$/i;

/** A channel as 0 to 255, from a number or a percentage; NaN when it is neither. */
function channel(token: string): number {
  const pct = token.endsWith("%");
  const n = Number(pct ? token.slice(0, -1) : token);
  if (!Number.isFinite(n) || token === "") return Number.NaN;
  return Math.min(255, Math.max(0, Math.round(pct ? (n / 100) * 255 : n)));
}

/**
 * A CSS colour as a Rive file takes it, 0xAARRGGBB (never negative), or null when it cannot be read. It reads the forms the app's tokens are written in (#rgb, #rgba, #rrggbb, #rrggbbaa) and the
 * forms a browser gives back for a computed colour (rgb() and rgba(), with commas or spaces, and an alpha after a comma or a slash). A channel out of range is held to the range. It never throws.
 */
export function cssColorToArgb(color: string): number | null {
  if (typeof color !== "string") return null;
  const text = color.trim();
  const hex = HEX.exec(text);
  if (hex) {
    let h = hex[1]!;
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    const rgb = h.slice(0, 6);
    const a = h.length === 8 ? h.slice(6) : "ff";
    return Number.parseInt(a + rgb, 16) >>> 0;
  }
  const fn = FUNC.exec(text);
  if (!fn) return null;
  const parts = fn[1]!.split(/[\s,/]+/).filter(Boolean);
  if (parts.length !== 3 && parts.length !== 4) return null;
  const [r, g, b] = parts.slice(0, 3).map(channel) as [number, number, number];
  let a = 255;
  if (parts.length === 4) {
    const t = parts[3]!;
    const v = t.endsWith("%") ? Number(t.slice(0, -1)) / 100 : Number(t);
    if (!Number.isFinite(v)) return null;
    a = Math.round(Math.min(1, Math.max(0, v)) * 255);
  }
  if ([r, g, b].some(Number.isNaN)) return null;
  return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
}

/** What the bridge shows for one theme: the number the page writes to `p1` to `p6` of the Rive file. */
export const SETU_STATE = { waiting: 0, searching: 1, reading: 2, answered: 3, gap: 4 } as const;

export type SetuPose = {
  /** The artboard with one plank for each theme: `Setu2` to `Setu6`. */
  artboard: string;
  /** The six numbers `p1` to `p6`; those beyond the number of themes are 0 and not drawn. */
  p: number[];
  /** True when the question may cross: the scan is completed and every theme is answered. */
  cross: boolean;
};

/**
 * What the bridge is told about a scan, from the view of it the page already keeps. The picture decides nothing: a plank is answered or a gap only when that theme's section is stored as such,
 * searching or reading only while the scan is running, and the question crosses only when the scan has ended with every theme answered (with a gap it stays on its bank). Null for a number of
 * themes that a plan cannot have, and then the page shows no bridge.
 */
export function setuPose(view: Pick<LitscanView, "state" | "total" | "stages" | "parts">): SetuPose | null {
  const n = view.total;
  if (!Number.isInteger(n) || n < LITSCAN_MIN_ITEMS || n > LITSCAN_MAX_ITEMS) return null;
  const running = view.state === "running";
  const p = new Array<number>(LITSCAN_MAX_ITEMS).fill(SETU_STATE.waiting);
  for (let i = 0; i < n; i++) {
    const part = view.parts[i];
    if (part?.status === "answered") p[i] = SETU_STATE.answered;
    else if (part?.status === "gap") p[i] = SETU_STATE.gap;
    else if (running) p[i] = view.stages[i] === "searching" ? SETU_STATE.searching : view.stages[i] === "reading" ? SETU_STATE.reading : SETU_STATE.waiting;
  }
  const cross = view.state === "completed" && p.slice(0, n).every((x) => x === SETU_STATE.answered);
  return { artboard: `Setu${n}`, p, cross };
}

/** What the reading scene shows for an upload: 0 the PDF is being read in the browser, 1 it is being uploaded, 2 it is being indexed (or, for page pictures, its pages are being read), 3 done, 4 paused. */
export type ReadingMode = 0 | 1 | 2 | 3 | 4;
export type ReadingPose = { mode: ReadingMode; /** How far along the whole job is, 0 to 1. */ progress: number };

// where each step of an upload stands: its mode, and how many of the three steps are behind it (as the bar under the scene counts them)
const READING_STEPS = new Map<string, { mode: ReadingMode; behind: number }>([
  ["reading", { mode: 0, behind: 0 }],
  ["uploading", { mode: 1, behind: 1 }],
  ["indexing", { mode: 2, behind: 2 }],
  ["scanning", { mode: 2, behind: 2 }],
  ["paused", { mode: 4, behind: 2 }],
  ["done", { mode: 3, behind: 3 }],
]);

/**
 * What the reading scene is told about an upload (the step and the progress inside it that the page already keeps): the mode, and the ring's fill, a third for each of the three steps. An error has
 * no scene (the page keeps its own sign for it), and neither has a step this does not know. Progress is held between 0 and 1, and a number that is not one counts as 0.
 */
export function readingPose(job: { step: string; progress: number }): ReadingPose | null {
  const at = READING_STEPS.get(job.step);
  if (!at) return null;
  const within = at.mode === 3 || Number.isNaN(job.progress) ? 0 : Math.min(1, Math.max(0, job.progress));
  return { mode: at.mode, progress: (at.behind + within) / 3 };
}
