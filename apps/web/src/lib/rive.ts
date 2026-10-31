import { cssColorToArgb } from "@scholar/shared";
import wasmUrl from "@rive-app/canvas-lite/rive.wasm?url";

/**
 * The Rive pieces of the page (docs/design/setu-rive.md, rive-ideas.md). The picture is an enhancement: the page is complete without it, so everything here fails by showing nothing.
 *  - The runtime (about 450 KB, gzip) is a chunk of its own, loaded the first time a piece is wanted, from our own origin (the CSP allows nothing else); never in the first load.
 *  - The page tells the file what to show by writing properties of the file's view model; the file decides nothing.
 *  - Nothing is drawn when nothing moves: after a change has settled the render loop is stopped, and it stops while the picture is scrolled out of view (the runtime also stops when the tab is hidden).
 */

type Runtime = typeof import("@rive-app/canvas-lite");
let runtime: Promise<Runtime> | null = null;
/** The runtime, loaded once; a failed load is forgotten so that a later piece can try again. */
function loadRuntime(): Promise<Runtime> {
  runtime ??= import("@rive-app/canvas-lite")
    .then((mod) => {
      mod.RuntimeLoader.setWasmUrl(wasmUrl);
      return mod;
    })
    .catch((e) => {
      runtime = null;
      throw e;
    });
  return runtime;
}

export type RiveValues = { numbers?: Record<string, number>; booleans?: Record<string, boolean>; colors?: Record<string, number> };

export type RiveScene = {
  /**
   * Writes properties of the file's view model (a name the file does not have is ignored). The picture is drawn until the change has settled, then the render loop stops; `loop` says
   * that something keeps moving (a plank being worked on), so it keeps drawing.
   */
  set(values: RiveValues, loop?: boolean): void;
  destroy(): void;
};

export type MountOptions = {
  canvas: HTMLCanvasElement;
  /** The address of the `.riv` file (a hashed asset of our own origin). */
  src: string;
  artboard: string;
  stateMachine: string;
  /** How long a change is drawn before the loop stops, in ms. */
  settleMs?: number;
  /** How long to wait for the runtime and the file before giving up, in ms. */
  timeoutMs?: number;
};

/**
 * Loads a file into a canvas and returns what the page needs to drive it, or null when anything fails (no runtime, no file, a name the file does not have, too slow): the page then shows
 * what it showed before. The canvas is sized by CSS; its drawing surface follows its size.
 */
export async function mountRive(opts: MountOptions): Promise<RiveScene | null> {
  const { canvas, settleMs = 3000, timeoutMs = 15000 } = opts;
  let mod: Runtime;
  try {
    mod = await Promise.race([loadRuntime(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("rive: the runtime did not load in time")), timeoutMs))]);
  } catch {
    return null;
  }
  return new Promise<RiveScene | null>((resolve) => {
    let settled = false;
    let rive: InstanceType<Runtime["Rive"]> | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let loop = false;
    let visible = true;
    let destroyed = false;
    const finish = (scene: RiveScene | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(giveUp);
      resolve(scene);
    };
    const giveUp = setTimeout(() => {
      try { rive?.cleanup(); } catch { /* it never started */ }
      finish(null);
    }, timeoutMs);

    /** Draw while something moves; stop the loop once it has settled, and while the picture is out of view. */
    const keepDrawing = () => {
      clearTimeout(timer);
      if (destroyed || !rive) return;
      if (!visible) { rive.stopRendering(); return; }
      rive.startRendering();
      if (!loop) timer = setTimeout(() => rive?.stopRendering(), settleMs);
    };

    let resize: ResizeObserver | null = null;
    let seen: IntersectionObserver | null = null;
    try {
      rive = new mod.Rive({
        src: opts.src,
        canvas,
        artboard: opts.artboard,
        stateMachine: opts.stateMachine,
        autoplay: true,
        autoBind: true,
        shouldDisableRiveListeners: true, // the page's own elements take the pointer and the keyboard
        isTouchScrollEnabled: true,
        onLoad: () => {
          if (!rive) return;
          // it loaded after the page had given up on it (too slow): let it go, nothing is waiting for it
          if (settled) {
            try { rive.cleanup(); } catch { /* already gone */ }
            rive = null;
            return;
          }
          rive.resizeDrawingSurfaceToCanvas();
          resize = new ResizeObserver(() => rive?.resizeDrawingSurfaceToCanvas());
          resize.observe(canvas);
          seen = new IntersectionObserver((entries) => {
            visible = entries.some((e) => e.isIntersecting);
            keepDrawing();
          });
          seen.observe(canvas);
          // the runtime starts drawing again by itself when the tab comes back: stop again once it has settled
          document.addEventListener("visibilitychange", keepDrawing);
          finish({
            set(values, wantsLoop = false) {
              const vm = rive?.viewModelInstance;
              if (!vm || destroyed) return;
              loop = wantsLoop;
              for (const [k, v] of Object.entries(values.numbers ?? {})) { const p = vm.number(k); if (p && p.value !== v) p.value = v; }
              for (const [k, v] of Object.entries(values.booleans ?? {})) { const p = vm.boolean(k); if (p && p.value !== v) p.value = v; }
              for (const [k, v] of Object.entries(values.colors ?? {})) { const p = vm.color(k); if (p && p.value !== v) p.value = v; }
              keepDrawing();
            },
            destroy() {
              destroyed = true;
              clearTimeout(timer);
              resize?.disconnect();
              seen?.disconnect();
              document.removeEventListener("visibilitychange", keepDrawing);
              try { rive?.cleanup(); } catch { /* already gone */ }
              rive = null;
            },
          });
        },
        onLoadError: () => finish(null),
      });
    } catch {
      finish(null);
    }
  });
}

/** The names of the page's colour tokens a piece wants, by the name of the property of the file that takes them. */
export type RiveColorMap = Record<string, string>;

/** The page's colours now, as the file takes them: a token that cannot be read is left out, and the file keeps the colour it was drawn with. */
export function readThemeColors(map: RiveColorMap, root: Element = document.documentElement): Record<string, number> {
  const style = getComputedStyle(root);
  const out: Record<string, number> = {};
  for (const [name, token] of Object.entries(map)) {
    const argb = cssColorToArgb(style.getPropertyValue(token));
    if (argb !== null) out[name] = argb;
  }
  return out;
}
