import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { mountRive, readThemeColors, type RiveColorMap, type RiveScene } from "../lib/rive";
import { riveAllowed } from "../lib/rive-env";

/**
 * A picture drawn by a Rive file (docs/design/setu-rive.md): decoration over text that stays on the page. It shows nothing at all (not even an empty box) when the person asked for less motion
 * or to save data, when WebAssembly is missing, or when the runtime or the file cannot be loaded (the box then goes); the page then looks as it did before. The box has its final shape from the
 * first paint, so nothing moves when the picture arrives. The page writes `numbers` and `booleans` to the file's view model; the colours come from the page's own tokens (`colors`, by the name of the
 * property of the file) and are set again when the theme changes.
 *
 * `fallback` is what the page shows when there is no picture: instead of it when the picture is not allowed or cannot load, and under it until it has been drawn (it fades out as the picture
 * fades in). It is for decoration too (an icon), so it is hidden from screen readers like the picture.
 */
export type RivePieceProps = {
  src: string;
  artboard: string;
  stateMachine: string;
  /** The artboard's own size: gives the box its shape. */
  width: number;
  height: number;
  numbers?: Record<string, number>;
  booleans?: Record<string, boolean>;
  /** Something keeps moving: keep drawing. Otherwise drawing stops once a change has settled. */
  loop?: boolean;
  /** Property of the file to the name of a CSS custom property of the page, such as `{ accent: "--accent" }`. */
  colors?: RiveColorMap;
  className?: string;
  fallback?: ReactNode;
};

export function RivePiece({ src, artboard, stateMachine, width, height, numbers, booleans, loop = false, colors, className, fallback }: RivePieceProps) {
  const [allowed] = useState(riveAllowed);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<RiveScene | null>(null);
  const [ready, setReady] = useState(false);
  // the runtime or the file did not load: the box goes, and the page is as it was
  const [failed, setFailed] = useState(false);
  // what to write, kept in a ref so that the effect that mounts the file always writes the latest
  const latest = useRef({ numbers, booleans, loop });
  latest.current = { numbers, booleans, loop };
  const colorKey = useMemo(() => JSON.stringify(colors ?? {}), [colors]);

  useEffect(() => {
    if (!allowed || !canvas.current) return;
    let alive = true;
    void mountRive({ canvas: canvas.current, src, artboard, stateMachine }).then((s) => {
      if (!alive) { s?.destroy(); return; }
      if (!s) { setFailed(true); return; }
      scene.current = s;
      s.set({ numbers: latest.current.numbers, booleans: latest.current.booleans, colors: colors ? readThemeColors(colors) : undefined }, latest.current.loop);
      setReady(true);
    });
    return () => {
      alive = false;
      scene.current?.destroy();
      scene.current = null;
      setReady(false);
    };
    // the file is mounted again only when it is another file or another artboard; values and colours are written below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, src, artboard, stateMachine]);

  // the numbers and booleans of the page
  const valueKey = JSON.stringify([numbers, booleans, loop]);
  useEffect(() => {
    scene.current?.set({ numbers, booleans }, loop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueKey, ready]);

  // the colours, now and whenever the theme changes
  useEffect(() => {
    if (!allowed || !colors) return;
    const write = () => scene.current?.set({ colors: readThemeColors(colors) }, latest.current.loop);
    write();
    const watch = new MutationObserver(write);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => watch.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, colorKey, ready]);

  if (!allowed || failed) return <>{fallback ?? null}</>;
  return (
    <div className={`rive-piece${className ? ` ${className}` : ""}`} data-ready={ready} data-state={JSON.stringify({ ...numbers, ...booleans })} style={{ aspectRatio: `${width} / ${height}` }} aria-hidden="true">
      {fallback ? <div className="rive-piece-fallback">{fallback}</div> : null}
      <canvas ref={canvas} />
    </div>
  );
}
