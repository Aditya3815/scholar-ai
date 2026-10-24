import { useCallback, useEffect, useRef, useState } from "react";
import { eraseStrokes, emptyHistory, mergeItems, record, redo as redoStep, replaceItems, undo as undoStep, type InkHistory, type InkItem } from "@scholar/shared";
import { idbDelete, idbGet, idbSet } from "./idb";
import { showNotice } from "./notice";

export type InkStatus = "loading" | "ready" | "saving" | "saved" | "error" | "conflict" | "offline";

/** A drawing that has not reached the server, kept on this device (IndexedDB) so a closed tab or a dead connection loses nothing. `rev` is the server revision it was drawn on. */
type Pending = { rev: number; strokes: InkItem[]; /** the ids the server had at `rev`: what is not among them was drawn here */ known: string[]; at: number };

export type InkApi = {
  status: InkStatus;
  /** Everything drawn or written on the paper: pen and highlighter strokes, shapes, text boxes and sticky notes (still called strokes: that is the name the saved data has). */
  strokes: InkItem[];
  /** Drawing is possible once the strokes that were saved before have been loaded (otherwise a first stroke could overwrite them). */
  ready: boolean;
  add: (s: InkItem) => void;
  erase: (ids: string[]) => void;
  /** Items changed (moved, a text edited): the new versions, matched by id. One undo step, whatever the number of items. */
  edit: (changed: InkItem[]) => void;
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
  const [strokes, setStrokes] = useState<InkItem[]>([]);
  const [status, setStatus] = useState<InkStatus>("loading");
  const [loaded, setLoaded] = useState(false);
  const [history, setHistory] = useState<InkHistory>(emptyHistory);
  const strokesRef = useRef<InkItem[]>([]);
  const historyRef = useRef<InkHistory>(history);
  const rev = useRef(0);
  const dirty = useRef(false);
  const saving = useRef(false);
  const timer = useRef(0);
  const retryTimer = useRef(0);
  const failures = useRef(0);
  const alive = useRef(true);
  const persisted = useRef(false);
  /** The ids of the drawing as the server last had it (when it was loaded, or last saved): what is not among them is new here. */
  const known = useRef<Set<string>>(new Set());
  const persistTimer = useRef(0);
  const changedRef = useRef<() => void>(() => {});

  const set = useCallback((next: InkItem[], h?: InkHistory) => {
    strokesRef.current = next;
    setStrokes(next);
    if (h) {
      historyRef.current = h;
      setHistory(h);
    }
  }, []);

  const persistNow = useCallback(async () => {
    window.clearTimeout(persistTimer.current);
    persisted.current = await idbSet(docId, { rev: rev.current, strokes: strokesRef.current, known: [...known.current], at: Date.now() } satisfies Pending);
  }, [docId]);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const r = await fetch(url(docId), { credentials: "same-origin" });
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { strokes: InkItem[]; rev: number };
      if (!alive.current) return;
      rev.current = j.rev;
      known.current = new Set(j.strokes.map((s) => s.id));
      set(j.strokes, emptyHistory());
      // a drawing made when there was no connection (or in a tab that was closed too soon) is still here: take it up again
      const p = await idbGet<Pending>(docId);
      if (p && alive.current) {
        const same = JSON.stringify(p.strokes) === JSON.stringify(j.strokes);
        // drawn on the revision the server has now: it is the newest. Drawn on an older one: what was drawn here is added to what the server has.
        const next = same ? j.strokes : p.rev === j.rev ? p.strokes : mergeItems(j.strokes, p.strokes, p.known ?? []);
        if (!same && JSON.stringify(next) !== JSON.stringify(j.strokes)) {
          set(next, emptyHistory());
          dirty.current = true;
          showNotice(p.rev === j.rev ? "Your drawing from when you were offline was kept and is being sent." : "What you drew offline was added to this paper's drawing, which had been changed elsewhere.");
          changedRef.current();
        } else void idbDelete(docId);
      }
      setLoaded(true);
      setStatus((s) => (s === "saving" || s === "offline" ? s : "ready"));
    } catch {
      if (alive.current) setStatus("error");
    }
  }, [docId, set]);

  const save = useCallback(async (keepalive = false): Promise<void> => {
    if (saving.current || !dirty.current || !alive.current) return;
    window.clearTimeout(timer.current);
    saving.current = true;
    const sending = strokesRef.current;
    const body = JSON.stringify({ strokes: sending, rev: rev.current });
    dirty.current = false;
    setStatus("saving");
    try {
      const res = await fetch(url(docId), { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body, keepalive: keepalive && body.length < KEEPALIVE_LIMIT });
      if (res.status === 409) {
        const j = (await res.json()) as { strokes: InkItem[]; rev: number };
        rev.current = j.rev;
        dirty.current = false;
        // another window saved first: its drawing is shown, and what was drawn here since the reader last saw the server's drawing is added to it (never what another window erased)
        const merged = mergeItems(j.strokes, sending, known.current);
        known.current = new Set(j.strokes.map((s) => s.id));
        if (alive.current) {
          set(merged.length > j.strokes.length ? merged : j.strokes, emptyHistory());
          if (merged.length > j.strokes.length) {
            dirty.current = true;
            changedRef.current();
          }
          setStatus("conflict");
        }
        if (!dirty.current) {
          window.clearTimeout(persistTimer.current);
          void idbDelete(docId);
        }
      } else if (res.ok) {
        rev.current = ((await res.json()) as { rev: number }).rev;
        failures.current = 0;
        known.current = new Set(sending.map((s) => s.id));
        if (!dirty.current) {
          window.clearTimeout(persistTimer.current);
          persisted.current = false;
          void idbDelete(docId);
        }
        if (alive.current) setStatus(dirty.current ? "saving" : "saved");
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch {
      dirty.current = true; // not saved: keep it, and try again
      failures.current += 1;
      void persistNow(); // and keep it on this device too, in case the tab is closed before the connection is back
      if (alive.current) {
        setStatus(navigator.onLine ? "error" : "offline");
        window.clearTimeout(retryTimer.current);
        retryTimer.current = window.setTimeout(() => void save(), Math.min(30_000, 2000 * 2 ** Math.min(failures.current, 4)));
      }
    } finally {
      saving.current = false;
      if (dirty.current && alive.current && failures.current === 0) timer.current = window.setTimeout(() => void save(), 200);
    }
  }, [docId, set, persistNow]);

  const changed = useCallback(() => {
    dirty.current = true;
    setStatus((s) => (s === "loading" ? s : navigator.onLine ? "saving" : "offline"));
    window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => void persistNow(), 400);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), SAVE_AFTER_MS);
  }, [save, persistNow]);
  changedRef.current = changed;

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
      if (dirty.current) {
        void persistNow();
        void save(true);
      }
    };
    const onHide = () => document.visibilityState === "hidden" && flush();
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current && !persisted.current) e.preventDefault(); // not saved, and not kept on this device either: the browser asks before the page is closed
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
  }, [docId, enabled, save, set, load, persistNow]);

  const add = useCallback(
    (s: InkItem) => {
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
  const edit = useCallback(
    (items: InkItem[]) => {
      const before = items.map((c) => strokesRef.current.find((s) => s.id === c.id)).filter((s): s is InkItem => !!s);
      const after = items.filter((c) => before.some((b) => b.id === c.id));
      // nothing to record when nothing is different (a text box left as it was)
      if (after.length === 0 || before.every((b) => JSON.stringify(b) === JSON.stringify(after.find((x) => x.id === b.id)))) return;
      set(replaceItems(strokesRef.current, after), record(historyRef.current, { type: "edit", before, after }));
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

  return { status, strokes, ready: loaded, add, erase, edit, undo, redo, canUndo: history.done.length > 0, canRedo: history.undone.length > 0, retry };
}
