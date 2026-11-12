import { useEffect, type RefObject } from "react";

/**
 * The engine of the intro film (docs/design/cinematic-story.md, the mock docs/design/poc/scroll-v3.html): each scene is a tall section with a sticky full-screen frame; one passive
 * scroll listener asks for one animation frame; in it every scene near the screen turns its progress p (0..1) into a few CSS variables. Nothing here causes a React render: the variables
 * are written on the elements, and their defaults in the CSS are the finished state, so the stacked layout (reduced motion) needs none of this.
 */

export const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Where p is between a and b, from 0 to 1. */
export const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
/** Decelerating into place. */
export const out = (t: number) => 1 - Math.pow(1 - t, 3);
/** Accelerating, then decelerating. */
export const inOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const setVar = (el: HTMLElement, k: string, v: number | string) => el.style.setProperty(k, typeof v === "number" ? v.toFixed(4) : v);

/** A scene's updater: its element and its progress. */
export type Updater = (el: HTMLElement, p: number) => void;

type FilmHooks = {
  /** Geometry that depends on layout and fonts (the iris centre, the dust's letters): measured on start, after fonts load and on resize. */
  measure?: () => void;
  /** The scene on screen changed (its index), for the strip of scenes. */
  onActive?: (i: number) => void;
  /** Every frame: the scene on screen, its progress, and the whole page's progress. */
  onFrame?: (i: number, p: number, page: number) => void;
};

/** The least a scene's content is scaled to, so that a very small window shrinks it but never to something nobody can read. */
const FIT_FLOOR = 0.62;

/**
 * What a scene shows must be in the frame whatever the window: the content marked `data-fit` is scaled down (never up) to the room the frame has left after its own padding, which
 * is the screen less the header and the bars. It is measured at its natural size, from its layout box, which neither this scale nor the film's own movement changes.
 */
export function fitScenes(root: HTMLElement) {
  for (const el of root.querySelectorAll<HTMLElement>("[data-fit]")) {
    const frame = el.closest<HTMLElement>(".fm-frame");
    if (!frame) continue;
    el.style.setProperty("--fit", "1");
    const cs = getComputedStyle(frame);
    const room = frame.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const wide = frame.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const k = Math.min(1, room / Math.max(1, el.offsetHeight), wide / Math.max(1, el.scrollWidth));
    el.style.setProperty("--fit", Math.max(FIT_FLOOR, k).toFixed(3));
  }
}

/** A scene's progress: 0 when its top reaches the top of the screen, 1 when its bottom reaches the bottom. */
function sceneProgress(top: number, height: number, viewport: number): number {
  const span = height - viewport;
  return span > 0 ? clamp(-top / span) : top <= 0 ? 1 : 0;
}

export function useFilm(root: RefObject<HTMLElement | null>, enabled: boolean, updaters: Record<string, Updater>, hooks: FilmHooks = {}) {
  useEffect(() => {
    const el = root.current;
    if (!enabled || !el) return;
    const scenes = [...el.querySelectorAll<HTMLElement>("[data-scene]")];
    const last = new Map<HTMLElement, number>();
    let queued = false;
    let active = -1;
    const frame = () => {
      queued = false;
      const vh = window.innerHeight;
      let now = -1;
      let nowP = 0;
      scenes.forEach((s, i) => {
        const r = s.getBoundingClientRect();
        const p = sceneProgress(r.top, r.height, vh);
        if (r.top <= vh * 0.5 && r.bottom >= vh * 0.5) {
          now = i;
          nowP = p;
        }
        if (r.bottom < -vh || r.top > vh * 2) return; // far from the screen: nothing to draw
        if (Math.abs((last.get(s) ?? -1) - p) < 0.0004) return;
        last.set(s, p);
        updaters[s.dataset.scene!]?.(s, p);
      });
      if (now !== active) {
        active = now;
        hooks.onActive?.(now);
      }
      const page = clamp(window.scrollY / Math.max(1, document.documentElement.scrollHeight - vh));
      hooks.onFrame?.(now, nowP, page);
    };
    const request = () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(frame);
      }
    };
    const remeasure = () => {
      hooks.measure?.();
      last.clear();
      request();
    };
    // A phone's address bar coming and going changes the window's height by a few dozen pixels in the middle of a scroll: that must not measure everything again (the dust is sampled
    // from the page's letters). A change of width, or a large change of height, is a real resize, and it waits until the resizing has stopped.
    let size = { w: window.innerWidth, h: window.innerHeight };
    let settle = 0;
    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const barOnly = w === size.w && Math.abs(h - size.h) < 160 && matchMedia("(pointer: coarse)").matches;
      if (barOnly) {
        request();
        return;
      }
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        size = { w: window.innerWidth, h: window.innerHeight };
        remeasure();
      }, 120);
    };
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", onResize);
    // a theme chosen while a scene is on screen redraws it at once (the dust is drawn in the theme's colours, not by CSS)
    const themeWatch = new MutationObserver(() => {
      last.clear();
      request();
    });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    remeasure();
    void document.fonts?.ready.then(remeasure);
    return () => {
      window.removeEventListener("scroll", request);
      window.removeEventListener("resize", onResize);
      window.clearTimeout(settle);
      themeWatch.disconnect();
    };
    // the updaters and hooks are made once by the page
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
