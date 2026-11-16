/**
 * Just enough of React's hooks to run a hook of the page in node (useState, useRef, useCallback, useEffect, useSyncExternalStore), for the request tests of hooks such as useVerify, useScan
 * and useNotes. `vi.mock("react", () => hooks.react)` with `const hooks = vi.hoisted(...)` is not possible across files, so a test does
 * `vi.mock("react", async () => (await import("../test/fake-react")).react)` and drives renders with `render(() => useThing(...))`.
 */
type Effect = { deps: unknown[] | undefined; cleanup?: void | (() => void) };

let slots: unknown[] = [];
let at = 0;
let pending: (() => void)[] = [];

const same = (a: unknown[] | undefined, b: unknown[] | undefined) => !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

export const react = {
  useState<T>(init: T | (() => T)) {
    const k = at++;
    if (!(k in slots)) slots[k] = typeof init === "function" ? (init as () => T)() : init;
    const set = (v: T | ((old: T) => T)) => {
      slots[k] = typeof v === "function" ? (v as (old: T) => T)(slots[k] as T) : v;
    };
    return [slots[k] as T, set] as const;
  },
  useRef<T>(init: T) {
    const k = at++;
    if (!(k in slots)) slots[k] = { current: init };
    return slots[k] as { current: T };
  },
  useCallback<F>(fn: F) {
    at++;
    return fn;
  },
  useEffect(fn: () => void | (() => void), deps?: unknown[]) {
    const k = at++;
    const old = slots[k] as Effect | undefined;
    if (old && same(old.deps, deps)) return;
    const effect: Effect = { deps };
    slots[k] = effect;
    pending.push(() => {
      if (typeof old?.cleanup === "function") old.cleanup();
      effect.cleanup = fn();
    });
  },
  useSyncExternalStore<T>(_subscribe: unknown, get: () => T) {
    return get();
  },
};

/** Renders the hook (its effects run after it, as React runs them) and returns what it returned. */
export function render<T>(hook: () => T): T {
  at = 0;
  const out = hook();
  const run = pending;
  pending = [];
  run.forEach((f) => f());
  return out;
}

/** Unmounts: every effect's cleanup runs, and the next render starts afresh. */
export function unmount() {
  for (const s of slots) if (s && typeof s === "object" && "cleanup" in s && typeof (s as Effect).cleanup === "function") ((s as Effect).cleanup as () => void)();
  slots = [];
  pending = [];
}
