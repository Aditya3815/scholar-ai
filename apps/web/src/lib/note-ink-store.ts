import { mergeNoteInk, type NotebookBlock, type NotebookInk, type NoteStroke } from "@scholar/shared";
import type { NbState } from "./notebook";
import { inkPlainOf, reattachOrphans, remapStrokes } from "./note-ink";

/**
 * The ink on the pages of notes in the page (docs/design/paper-reader.md, 25.5 and 25.6): each page's strokes, changed here at once and saved a moment after the last change, one save at a
 * time per page, with the revision it started from (the page's own blocks are saved apart, so typing and drawing never conflict). When another window saved first (409) the two are merged by
 * stroke id. What is not saved yet waits in IndexedDB ("nbink:<paper>") and is sent when the connection is back. Undo and Redo keep 200 steps a page. When a block's text changes, the
 * strokes on it are carried through the edit; when a block is gone (another window), its strokes are attached to the block before it and the page says so.
 * A plain object with its network, storage and clock handed in (a test drives it in node), fed by the notebook store it sits beside (`host`).
 */

export type InkHost = {
  docId: string;
  get: () => NbState;
  subscribe: (l: () => void) => () => void;
  serverInk: () => readonly NotebookInk[];
  keep: (pageId: string) => void;
};
export type InkDeps = {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  idb: { get: <T>(key: string) => Promise<T | null>; set: (key: string, v: unknown) => Promise<boolean>; delete: (key: string) => Promise<boolean> };
  timers: { set: (fn: () => void, ms: number) => number; clear: (id: number) => void };
  /** Said to the person (a refusal, a stroke attached elsewhere). */
  notice: (s: string) => void;
};
/** A step of Undo: strokes added and removed (each with its place), and the page's blocks before and after (a space made or made taller). */
type Step = { add: NoteStroke[]; remove: { s: NoteStroke; at: number }[]; blocks?: { before: NotebookBlock[]; after: NotebookBlock[] } };
type Slot = { strokes: NoteStroke[]; base: NoteStroke[]; rev: number; dirty: boolean; saving: boolean; timer: number; failures: number; stuck: boolean; done: Step[]; undone: Step[] };
export type InkState = { pages: ReadonlyMap<string, readonly NoteStroke[]>; tick: number };

export const INK_SAVE_AFTER_MS = 1200;
const HISTORY = 200;
const KEY = (docId: string) => `nbink:${docId}`;

export type NoteInkStore = ReturnType<typeof createNoteInkStore>;

export function createNoteInkStore(host: InkHost, deps: InkDeps, blocksOf: (pageId: string, blocks: NotebookBlock[]) => void) {
  const slots = new Map<string, Slot>();
  const url = (pageId: string) => `/api/v1/documents/${host.docId}/notebook/pages/${encodeURIComponent(pageId)}/ink`;
  const listeners = new Set<() => void>();
  let tick = 0;
  let snapshot: InkState = { pages: new Map(), tick };
  let alive = true;
  /** Each page's blocks' plain text and order as last seen (what an edit is measured from). */
  const seen = new Map<string, { texts: Map<string, string>; order: string[] }>();
  /** Blocks whose strokes this window took away on purpose (Delete block): never treated as orphans. */
  const dropped = new Set<string>();
  /** A block's plain text, once per version of the block (blocks are never changed in place). */
  const plain = new WeakMap<NotebookBlock, string | null>();
  const plainOf = (b: NotebookBlock) => {
    if (!plain.has(b)) plain.set(b, inkPlainOf(b));
    return plain.get(b)!;
  };

  const slotFor = (pageId: string): Slot => {
    let s = slots.get(pageId);
    if (!s) slots.set(pageId, (s = { strokes: [], base: [], rev: 0, dirty: false, saving: false, timer: 0, failures: 0, stuck: false, done: [], undone: [] }));
    return s;
  };
  const emit = () => {
    snapshot = { pages: new Map([...slots].map(([k, v]) => [k, v.strokes])), tick: ++tick };
    listeners.forEach((l) => l());
  };
  const pageOf = (id: string) => host.get().pages.find((p) => p.id === id);

  /* ---- kept on this device until the server has it ---- */
  let persistTimer = 0;
  const persistNow = async () => {
    deps.timers.clear(persistTimer);
    const waiting = [...slots].filter(([, s]) => s.dirty).map(([id, s]) => ({ id, rev: s.rev, base: s.base, strokes: s.strokes }));
    if (waiting.length) await deps.idb.set(KEY(host.docId), { pages: waiting });
    else await deps.idb.delete(KEY(host.docId));
  };
  const persistSoon = () => {
    deps.timers.clear(persistTimer);
    persistTimer = deps.timers.set(() => void persistNow(), 400);
  };

  /* ---- saving one page ---- */
  async function save(pageId: string, keepalive = false): Promise<void> {
    const s = slots.get(pageId);
    if (!s || !alive || s.saving || !s.dirty || s.stuck) return;
    deps.timers.clear(s.timer);
    const page = pageOf(pageId);
    if (!page) return; // deleted: kept in case Undo brings the page back
    if (!page.saved) {
      // a page made here and not on the server yet (a starter page only drawn on is made now): its ink waits for it
      host.keep(pageId);
      s.timer = deps.timers.set(() => void save(pageId), 1500);
      return;
    }
    s.saving = true;
    const sending = s.strokes;
    s.dirty = false;
    try {
      const body = JSON.stringify({ rev: s.rev, strokes: sending });
      const res = await deps.fetch(url(pageId), { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body, keepalive: keepalive && body.length < 60_000 });
      if (res.ok || res.status === 409) {
        const ink = ((await res.json()) as { ink: NotebookInk }).ink;
        if (res.ok) {
          s.base = sending;
          s.rev = ink.rev;
          if (s.strokes !== sending) s.dirty = true;
        } else {
          s.strokes = mergeNoteInk(ink.strokes, s.base, s.strokes);
          s.base = ink.strokes;
          s.rev = ink.rev;
          s.dirty = JSON.stringify(s.strokes) !== JSON.stringify(ink.strokes);
        }
        s.failures = 0;
      } else if (res.status === 404) {
        // the page is gone on the server (deleted in another window, or being made again by Undo): tried again while this window still has the page
        s.dirty = true;
        s.rev = 0;
        s.failures++;
      } else if (res.status >= 500 || res.status === 429) throw new Error(String(res.status));
      else {
        const j = (await res.json().catch(() => null)) as { title?: string; detail?: string } | null;
        deps.notice([j?.title ?? "The drawing could not be saved", j?.detail].filter(Boolean).join(". "));
        s.dirty = true;
        s.stuck = true;
      }
    } catch {
      s.dirty = true;
      s.failures++;
      void persistNow();
    } finally {
      s.saving = false;
      if (alive) {
        if (s.dirty && !s.stuck) s.timer = deps.timers.set(() => void save(pageId), s.failures ? Math.min(30_000, 2000 * 2 ** Math.min(s.failures, 4)) : 200);
        if ([...slots.values()].some((x) => x.dirty)) persistSoon();
        else void persistNow();
      }
      emit();
    }
  }
  const changed = (pageId: string, s: Slot) => {
    s.dirty = true;
    s.stuck = false;
    deps.timers.clear(s.timer);
    s.timer = deps.timers.set(() => void save(pageId), INK_SAVE_AFTER_MS);
    persistSoon();
    emit();
  };

  /* ---- the pages' text and blocks, followed ---- */
  const follow = () => {
    const st = host.get();
    if (st.status !== "ready") return;
    let moved = 0;
    for (const p of st.pages) {
      const texts = new Map<string, string>();
      for (const b of p.blocks) {
        const t = plainOf(b);
        if (t !== null) texts.set(b.id, t);
      }
      const order = p.blocks.map((b) => b.id);
      const was = seen.get(p.id);
      seen.set(p.id, { texts, order });
      const s = slots.get(p.id);
      if (!s || !s.strokes.length || !was) {
        // a page brought back by Undo is made again with no revision: its ink is sent again after it
        if (s && s.strokes.length && !p.saved && s.rev !== 0) {
          s.rev = 0;
          changed(p.id, s);
        }
        continue;
      }
      let next = remapStrokes(s.strokes, was.texts, texts) ?? s.strokes;
      const ids = new Set(order);
      if (next.some((x) => !ids.has(x.a.b) && !dropped.has(x.a.b))) {
        const r = reattachOrphans(
          next.filter((x) => !dropped.has(x.a.b) || ids.has(x.a.b)),
          was.order,
          p.blocks,
        );
        moved += r.moved;
        next = r.strokes;
      }
      if (next !== s.strokes) {
        s.strokes = next;
        changed(p.id, s);
      }
    }
    if (moved) deps.notice("Some drawing moved: its text was deleted in another window.");
  };

  /* ---- loading ---- */
  async function load() {
    for (const ink of host.serverInk()) {
      const s = slotFor(ink.pageId);
      s.strokes = ink.strokes;
      s.base = ink.strokes;
      s.rev = ink.rev;
    }
    const p = await deps.idb.get<{ pages: { id: string; rev: number; base: NoteStroke[]; strokes: NoteStroke[] }[] }>(KEY(host.docId));
    for (const w of p?.pages ?? []) {
      const s = slotFor(w.id);
      s.strokes = w.rev === s.rev ? w.strokes : mergeNoteInk(s.strokes, w.base, w.strokes);
      changed(w.id, s);
    }
    follow();
    emit();
  }
  const stop = host.subscribe(follow);

  const record = (pageId: string, step: Step) => {
    const s = slotFor(pageId);
    s.done = [...s.done, step].slice(-HISTORY);
    s.undone = [];
  };
  /** Apply a step forward or back. */
  const run = (pageId: string, step: Step, dir: "do" | "undo") => {
    const s = slotFor(pageId);
    let list = [...s.strokes];
    const add = dir === "do" ? step.add : step.remove.map((r) => r.s);
    const remove = new Set((dir === "do" ? step.remove.map((r) => r.s) : step.add).map((x) => x.id));
    list = list.filter((x) => !remove.has(x.id));
    if (dir === "undo") for (const r of [...step.remove].sort((a, b) => a.at - b.at)) list.splice(Math.min(r.at, list.length), 0, r.s);
    else list.push(...add.filter((x) => !list.some((y) => y.id === x.id)));
    if (step.blocks) blocksOf(pageId, dir === "do" ? step.blocks.after : step.blocks.before);
    s.strokes = list;
    changed(pageId, s);
  };

  const api = {
    get: (): InkState => snapshot,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    load,
    strokes: (pageId: string): readonly NoteStroke[] => slots.get(pageId)?.strokes ?? [],
    /** How many strokes are attached to each block of a page. */
    counts(pageId: string): Map<string, number> {
      const m = new Map<string, number>();
      for (const s of slots.get(pageId)?.strokes ?? []) m.set(s.a.b, (m.get(s.a.b) ?? 0) + 1);
      return m;
    },
    /** A change drawn on a page: strokes added or erased, and the blocks it changed (a space), as one step of Undo. */
    commit(pageId: string, add: NoteStroke[], removeIds: readonly string[], blocks?: { before: NotebookBlock[]; after: NotebookBlock[] }) {
      const s = slotFor(pageId);
      const remove = s.strokes.flatMap((x, at) => (removeIds.includes(x.id) ? [{ s: x, at }] : []));
      if (!add.length && !remove.length && !blocks) return;
      const step: Step = { add, remove, ...(blocks ? { blocks } : {}) };
      record(pageId, step);
      run(pageId, { ...step, blocks: undefined }, "do");
    },
    canUndo: (pageId: string) => (slots.get(pageId)?.done.length ?? 0) > 0,
    canRedo: (pageId: string) => (slots.get(pageId)?.undone.length ?? 0) > 0,
    undo(pageId: string): boolean {
      const s = slots.get(pageId);
      const step = s?.done.pop();
      if (!s || !step) return false;
      s.undone.push(step);
      run(pageId, step, "undo");
      return true;
    },
    redo(pageId: string): boolean {
      const s = slots.get(pageId);
      const step = s?.undone.pop();
      if (!s || !step) return false;
      s.done.push(step);
      run(pageId, step, "do");
      return true;
    },
    /** A block is being deleted: its strokes go with it; the returned function (the block's Undo) brings them back. */
    dropBlock(pageId: string, blockId: string): () => void {
      const s = slots.get(pageId);
      const gone = s?.strokes.flatMap((x, at) => (x.a.b === blockId ? [{ s: x, at }] : [])) ?? [];
      if (!s || !gone.length) return () => {};
      dropped.add(blockId);
      s.strokes = s.strokes.filter((x) => x.a.b !== blockId);
      changed(pageId, s);
      return () => {
        dropped.delete(blockId);
        run(pageId, { add: [], remove: gone }, "undo");
      };
    },
    /** "Remove drawing on this block" (a keyboard way to clear ink): one step of Undo; the returned function takes it back. */
    clearBlock(pageId: string, blockId: string): () => void {
      const ids = (slots.get(pageId)?.strokes ?? []).filter((x) => x.a.b === blockId).map((x) => x.id);
      api.commit(pageId, [], ids);
      return () => void api.undo(pageId);
    },
    /** Strokes put on a page as they are (an old sketch turned into page drawing): one step. */
    put(pageId: string, strokes: NoteStroke[], blocks?: { before: NotebookBlock[]; after: NotebookBlock[] }) {
      api.commit(pageId, strokes, [], blocks);
    },
    flush(keepalive = true) {
      for (const [id, s] of slots) if (s.dirty) void save(id, keepalive);
      void persistNow();
    },
    destroy() {
      api.flush();
      alive = false;
      stop();
      for (const s of slots.values()) deps.timers.clear(s.timer);
      deps.timers.clear(persistTimer);
      listeners.clear();
    },
  };
  return api;
}
