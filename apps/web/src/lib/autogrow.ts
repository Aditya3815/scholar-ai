import { useEffect, useLayoutEffect, type RefObject } from "react";

/**
 * Sets a text field's height to its text, up to `max` pixels. Past `max` the field stops growing and scrolls (by wheel, touch and keyboard: the browser's own scroll bar is not shown, see the rule for the
 * chat boxes in shell.css).
 * A field that cannot be measured (it is not on the screen: a tab that is not open has no width, and its text measures 0) keeps the height it had, instead of being set to 0 px and left too small for its
 * text when it is shown: the question box of the Ask tab of a paper was shorter than its own line and showed a scroll bar for that reason.
 */
export function fitField(el: HTMLTextAreaElement, max: number): void {
  if (el.clientWidth === 0) return;
  el.style.height = "auto";
  const cs = getComputedStyle(el);
  const edges = cs.boxSizing === "border-box" ? parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth) : 0;
  let h = Math.min(el.scrollHeight + edges, max);
  el.style.height = `${h}px`;
  // `scrollHeight` is a whole number: a text of 36.4 px is read as 36, and a field of 36 px cannot hold it
  if (h < max && el.scrollHeight > el.clientHeight) {
    h = Math.min(h + 1, max);
    el.style.height = `${h}px`;
  }
}

/**
 * Keeps a text field as high as its text (`fitField`): when the text changes, when the field's width changes (a tab that is opened, a window that is resized: the lines wrap differently) and when the fonts
 * have arrived (they are wider or narrower than the ones the page started with). The fit after a change of width is made a frame later, never inside the observer's own callback (the field's height is what
 * it changes: that is how a "ResizeObserver loop" is made). `shown` is anything that changes when the field comes into the page after the component did (a sheet that is opened).
 */
export function useGrowingField(ref: RefObject<HTMLTextAreaElement | null>, value: string, max: number, shown: unknown = true, after = false): void {
  const fit = after ? useEffect : useLayoutEffect;
  fit(() => {
    if (ref.current) fitField(ref.current, max);
  }, [ref, value, max, shown]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let width = el.clientWidth;
    let frame = 0;
    const refit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fitField(el, max));
    };
    const watch = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (el.clientWidth !== width) { width = el.clientWidth; refit(); } }) : null;
    watch?.observe(el);
    void document.fonts?.ready.then(refit);
    return () => {
      watch?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [ref, max, shown]);
}
