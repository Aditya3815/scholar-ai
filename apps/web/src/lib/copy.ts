import { useCallback, useEffect, useRef, useState } from "react";
import { copyThrough } from "@scholar/shared";

/**
 * Putting text on the clipboard, for every button that does it. Two ways, tried in turn (`copyThrough`, which is tested): the clipboard API, and then a text field that is selected and copied
 * the old way. The second runs also when the first REJECTS (a permission that was refused, a page that is not secure, a browser that wants the press that asked for it): a copy button that
 * does nothing and says nothing is the failure to avoid. The caller says "Press Ctrl+C" when both fail.
 * It must be called straight from the click: Safari and Firefox take a clipboard write only inside the press that asked for it, so the text is built before the click and nothing is awaited first.
 * Plain text only: a pasted answer is read in an editor, a message box or a note, and the formatted kind pastes differently in each.
 */
export const copyText = (text: string): Promise<boolean> => copyThrough([viaClipboard, viaSelection], text);

async function viaClipboard(text: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false;
  await navigator.clipboard.writeText(text);
  return true;
}

/** The text in a field that is out of sight and selected, copied with the page's own copy command; the focus goes back to where it was (selecting moves it). */
function viaSelection(text: string): boolean {
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  // out of the layout and out of sight, so that it cannot scroll the page or show for a moment
  Object.assign(field.style, { position: "fixed", top: "0", left: "0", width: "1px", height: "1px", opacity: "0", pointerEvents: "none" });
  const was = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.appendChild(field);
  field.focus({ preventScroll: true });
  field.select();
  field.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  field.remove();
  was?.focus({ preventScroll: true });
  return ok;
}

/** How long "copied" stays on a button, and how long a failure stays (it carries words to read, so it stays longer). */
const COPIED_MS = 1800;
const FAILED_MS = 4000;

/**
 * A copy button's state: `copy(text)` starts at once (inside the click) and, when it is over, `state` is "copied" or "failed" for a moment and then "idle" again. `tick` goes up every time an
 * attempt ends, so that a second press says its message again. The timer is cleared when the button goes.
 */
export function useCopy(): { state: "idle" | "copied" | "failed"; tick: number; copy: (text: string) => void } {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const [tick, setTick] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      window.clearTimeout(timer.current);
    };
  }, []);
  const copy = useCallback((text: string) => {
    void copyText(text).then((ok) => {
      if (!alive.current) return;
      setState(ok ? "copied" : "failed");
      setTick((t) => t + 1);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState("idle"), ok ? COPIED_MS : FAILED_MS);
    });
  }, []);
  return { state, tick, copy };
}
