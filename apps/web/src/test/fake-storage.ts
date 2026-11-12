/**
 * What the browser gives the page, for the unit tests that run its stores in node (docs/design/untangle.md, F1): an event target (`window`,
 * `document`) whose listeners a test can fire, and a Storage (`localStorage`, `sessionStorage`) kept in a Map.
 */
type Handlers = Record<string, ((e: unknown) => void)[]>;

export const target = () => {
  const handlers: Handlers = {};
  return {
    handlers,
    addEventListener: (type: string, f: (e: unknown) => void) => void (handlers[type] ??= []).push(f),
    removeEventListener: () => {},
    fire: (type: string, e: unknown = {}) => (handlers[type] ?? []).forEach((f) => f(e)),
  };
};

export const storage = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() };
};
