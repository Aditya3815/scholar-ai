import { useSyncExternalStore } from "react";

/**
 * Toasts of the new Paper Reader (docs/design/paper-reader.md, section 11): a small queue, one shown at a time, each for 4 seconds, the clock stopped while it is pointed at or has the focus,
 * and an optional action (Undo) that is a real button. Errors are not toasts: they stay in the notice banner (lib/notice.ts, role="alert"), so a toast is never the only place an error is said.
 * The queue is a plain object with its timers handed in, so a test drives it with a fake clock.
 */
export type ToastAction = { label: string; run: () => void };
export type Toast = { id: number; text: string; action?: ToastAction };

export const TOAST_MS = 4000;
/** More than this many waiting and the oldest waiting ones are dropped: a burst of actions must not keep the line busy for a minute. */
export const TOAST_MAX_WAITING = 3;

type Timers = { set: (fn: () => void, ms: number) => number; clear: (id: number) => void; now: () => number };

export function createToastQueue(timers: Timers, ms = TOAST_MS) {
  let shown: Toast | null = null;
  let waiting: Toast[] = [];
  let next = 1;
  let timer = 0;
  /** What is left of the shown toast's time, and when its clock was last started; the clock stands still while paused. */
  let left = ms;
  let startedAt = 0;
  let paused = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  const startClock = () => {
    timers.clear(timer);
    if (!shown || paused) return;
    startedAt = timers.now();
    const id = shown.id;
    timer = timers.set(() => dismiss(id), left);
  };
  const showNext = () => {
    shown = waiting.shift() ?? null;
    left = ms;
    startClock();
    emit();
  };
  function dismiss(id?: number) {
    if (!shown || (id !== undefined && shown.id !== id)) {
      // a toast that is still waiting is simply taken out of the line
      if (id !== undefined && waiting.some((t) => t.id === id)) {
        waiting = waiting.filter((t) => t.id !== id);
        emit();
      }
      return;
    }
    timers.clear(timer);
    showNext();
  }
  return {
    /** Adds a toast; it is shown at once when nothing else is. Returns its id. */
    push(text: string, action?: ToastAction): number {
      const t: Toast = { id: next++, text, ...(action ? { action } : {}) };
      waiting.push(t);
      if (waiting.length > TOAST_MAX_WAITING) waiting = waiting.slice(-TOAST_MAX_WAITING);
      if (!shown) showNext();
      else emit();
      return t.id;
    },
    dismiss,
    /** The toast's action, then the toast goes (Undo is done once). */
    act(id: number) {
      if (shown?.id !== id) return;
      const run = shown.action?.run;
      dismiss(id);
      run?.();
    },
    /** Pointer over it, or the focus in it: its clock stops; pause(false) starts it again with the time it had left. */
    pause(on: boolean) {
      if (paused === on) return;
      paused = on;
      if (on) {
        timers.clear(timer);
        if (shown) left = Math.max(0, left - (timers.now() - startedAt));
      } else startClock();
    },
    current: (): Toast | null => shown,
    waitingCount: (): number => waiting.length,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    /** Empties the line (the reader is left). */
    clear() {
      timers.clear(timer);
      waiting = [];
      shown = null;
      paused = false;
      emit();
    },
  };
}
export type ToastQueue = ReturnType<typeof createToastQueue>;

/** The page's one queue. */
export const toasts: ToastQueue = createToastQueue({
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (id) => window.clearTimeout(id),
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
});
export const toast = (text: string, action?: ToastAction): number => toasts.push(text, action);
export const useToast = (): Toast | null => useSyncExternalStore(toasts.subscribe, toasts.current, () => null);
