import { useCallback, useEffect, useRef, useState } from "react";
import { eraseStrokes, emptyHistory, record, redo as redoStep, undo as undoStep, type InkHistory, type InkStroke } from "@scholar/shared";

export type InkStatus = "loading" | "ready" | "saving" | "saved" | "error" | "conflict";

export type InkApi = {
  status: InkStatus;
  strokes: InkStroke[];
  /** Drawing is possible once the strokes that were saved before have been loaded (otherwise a first stroke could overwrite them). */
  ready: boolean;
  add: (s: InkStroke) => void;
  erase: (ids: string[]) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  retry: () => void;
};

export const newStrokeId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "").slice(0, 20) : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

const url = (docId: string) => `/api/v1/documents/${docId}/ink`;
const SAVE_AFTER_MS = 1200;
const KEEPALIVE_LIMIT = 60_000; // a request that may outlive the page can carry at most about 64 KB

/**
 * The drawing on one paper: loaded once, changed in the browser at once (so drawing never waits for the network), and saved a moment after the last change.
 * Saves go out one at a time with the revision they started from; if another window saved in between, the server's drawing is shown instead and the reader is told.
 * Undo and redo are kept for this visit only.
 */
export function useInk(docId: string, enabled = true): InkApi {
  const [strokes, setStrokes] = useState<InkStroke[]>([]);
  const [status, setStatus] = useState<InkStatus>("loading");
  const [loaded, setLoaded] = useState(false);
  const [history, setHistory] = useState<InkHistory>(emptyHistory);
  const strokesRef = useRef<InkStroke[]>([]);
  const historyRef = useRef<InkHistory>(history);
  const rev = useRef(0);
  const dirty = useRef(false);
  const saving = useRef(false);
  const timer = useRef(0);
  const retryTimer = useRef(0);
  const failures = useRef(0);
  const alive = useRef(true);

  const set = useCallback((next: InkStroke[], h?: InkHistory) => {
    strokesRef.current = next;
    setStrokes(next);
    if (h) {
      historyRef.current = h;
      setHistory(h);
    }
  }, []);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const r = await fetch(url(docId), { credentials: "same-origin" });
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { strokes: InkStroke[]; rev: number };
      if (!alive.current) return;
      rev.current = j.rev;
      set(j.strokes, emptyHistory());
      setLoaded(true);
      setStatus("ready");
    } catch {
      if (alive.current) setStatus("error");
    }
  }, [docId, set]);

  const save = useCallback(async (keepalive = false): Promise<void> => {
    if (saving.current || !dirty.current || !alive.current) return;
    window.clearTimeout(timer.current);
    saving.current = true;
    const body = JSON.stringify({ strokes: strokesRef.current, rev: rev.current });
    dirty.current = false;
    setStatus("saving");
    try {
      const res = await fetch(url(docId), { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body, keepalive: keepalive && body.length < KEEPALIVE_LIMIT });
      if (res.status === 409) {
        const j = (await res.json()) as { strokes: InkStroke[]; rev: number };
        rev.current = j.rev;
        dirty.current = false;
        if (alive.current) {
          set(j.strokes, emptyHistory());
          setStatus("conflict");
        }
      } else if (res.ok) {
        rev.current = ((await res.json()) as { rev: number }).rev;
        failures.current = 0;
        if (alive.current) setStatus(dirty.current ? "saving" : "saved");
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch {
      dirty.current = true; // not saved: keep it, and try again
      failures.current += 1;
      if (alive.current) {
        setStatus("error");
        window.clearTimeout(retryTimer.current);
        retryTimer.current = window.setTimeout(() => void save(), Math.min(30_000, 2000 * 2 ** Math.min(failures.current, 4)));
      }
    } finally {
      saving.current = false;
      if (dirty.current && alive.current && failures.current === 0) timer.current = window.setTimeout(() => void save(), 200);
    }
  }, [docId, set]);

  const changed = useCallback(() => {
    dirty.current = true;
    setStatus((s) => (s === "loading" ? s : "saving"));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), SAVE_AFTER_MS);
  }, [save]);

  useEffect(() => {
    if (!enabled) return;
    alive.current = true;
    rev.current = 0;
    dirty.current = false;
    failures.current = 0;
    set([], emptyHistory());
    setLoaded(false);
    void load();
    // leaving the paper or the page: send what is unsaved now
    const flush = () => {
      if (dirty.current) void save(true);
    };
    const onHide = () => document.visibilityState === "hidden" && flush();
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault(); // something is not saved yet (the network was down): the browser asks before the page is closed
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", warn);
    const online = () => dirty.current && void save();
    window.addEventListener("online", online);
    return () => {
      flush();
      alive.current = false;
      window.clearTimeout(timer.current);
      window.clearTimeout(retryTimer.current);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("online", online);
    };
  }, [docId, enabled, save, set, load]);

  const add = useCallback(
    (s: InkStroke) => {
      set([...strokesRef.current, s], record(historyRef.current, { type: "add", stroke: s }));
      changed();
    },
    [set, changed],
  );
  const erase = useCallback(
    (ids: string[]) => {
      const { strokes: next, items } = eraseStrokes(strokesRef.current, new Set(ids));
      if (items.length === 0) return;
      set(next, record(historyRef.current, { type: "erase", items }));
      changed();
    },
    [set, changed],
  );
  const undo = useCallback(() => {
    const r = undoStep(historyRef.current, strokesRef.current);
    if (!r) return;
    set(r.strokes, r.history);
    changed();
  }, [set, changed]);
  const redo = useCallback(() => {
    const r = redoStep(historyRef.current, strokesRef.current);
    if (!r) return;
    set(r.strokes, r.history);
    changed();
  }, [set, changed]);
  const retry = useCallback(() => {
    failures.current = 0;
    if (!loaded) void load();
    else void save();
  }, [loaded, load, save]);

  return { status, strokes, ready: loaded, add, erase, undo, redo, canUndo: history.done.length > 0, canRedo: history.undone.length > 0, retry };
}
