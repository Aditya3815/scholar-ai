import { useSyncExternalStore } from "react";
import { NOTEBOOK_LIMITS, type NotebookBlock, type NotebookPage, type NotebookStyle, type QuoteBlock, type QuoteColor, type TextBlock } from "@scholar/shared";
import { idbDelete, idbGet, idbSet } from "./idb";

/**
 * A paper's Notebook in the page (docs/design/paper-reader.md, 19.4): its pages, changed here at once and saved a moment after the last change, one save at a time per page, each with the
 * revision it started from, the way a drawing is (lib/ink.ts). A page that is not saved yet waits in IndexedDB (the store lib/idb.ts has for drawings, under "nb:<paper>"), and is sent when
 * the connection is back. When another window saved first (409), the server's page and this window's are merged by block id (`mergeBlocks`). A rename, a style or a move is a PATCH that
 * never conflicts. A plain object with its network, storage and clock handed in, so a test drives it in node; `useNotebook` reads it in React.
 */

export type NbSave = "idle" | "saving" | "saved" | "offline" | "error" | "conflict";
/** A page as this window has it. `saved`: the server has it (a page made here and never saved, like the first "Notes" page of a paper, has not). */
export type NbPage = { id: string; title: string; style: NotebookStyle; position: number; blocks: NotebookBlock[]; rev: number; saved: boolean };
export type NbState = {
  status: "loading" | "ready" | "error";
  pages: NbPage[];
  /** The page that is open (and that "Add to notes" adds to). */
  openId: string | null;
  save: NbSave;
  /** What went wrong with the last save, when it was refused (too big): said under the save line. */
  error: string;
  /** Every highlight id quoted on any page (the Highlights list's "In notes"). */
  quoted: ReadonlySet<string>;
};

/* ---------------------------------------------------------------- the merge on a conflict (four rules, tested one by one) */

const same = (a: NotebookBlock | undefined, b: NotebookBlock | undefined) => JSON.stringify(a) === JSON.stringify(b);
const byId = (list: readonly NotebookBlock[]) => new Map(list.map((b) => [b.id, b]));

/**
 * Another window saved this page first. `server` is its page now, `base` what this window last had from the server, `mine` what this window has. The result, by block id:
 *   1. the server's blocks are the base of the result (what the other window added or changed is kept);
 *   2. blocks this window changed since `base` are put over them (this window's text wins; `clash` says the other window had changed the same block);
 *   3. blocks this window added go after their neighbour in this window's order (the nearest block before them that is in the result; the top when there is none);
 *   4. blocks this window deleted stay deleted.
 * A block this window changed that the other window deleted comes back (what was typed is never lost), and counts as a clash.
 */
export function mergeBlocks(server: readonly NotebookBlock[], base: readonly NotebookBlock[], mine: readonly NotebookBlock[]): { blocks: NotebookBlock[]; clash: boolean } {
  const baseMap = byId(base);
  const mineIds = new Set(mine.map((b) => b.id));
  const serverMap = byId(server);
  const changed = new Map(mine.filter((b) => baseMap.has(b.id) && !same(baseMap.get(b.id), b)).map((b) => [b.id, b]));
  let clash = false;
  // rules 1, 2 and 4
  const out: NotebookBlock[] = [];
  for (const b of server) {
    if (baseMap.has(b.id) && !mineIds.has(b.id)) continue; // 4: deleted here
    const m = changed.get(b.id);
    if (m) {
      if (!same(baseMap.get(b.id), b)) clash = true;
      out.push(m);
    } else if (!baseMap.has(b.id) && mineIds.has(b.id)) {
      // made here and on the server too (a save whose answer was lost): this window's copy
      out.push(mine.find((x) => x.id === b.id)!);
    } else out.push(b);
  }
  // rule 3 (and a changed block the other window deleted)
  for (let i = 0; i < mine.length; i++) {
    const b = mine[i]!;
    if (serverMap.has(b.id)) continue;
    if (baseMap.has(b.id) && !changed.has(b.id)) continue; // unchanged here, deleted there: stays deleted
    if (changed.has(b.id)) clash = true;
    let at = 0;
    for (let k = i - 1; k >= 0; k--) {
      const idx = out.findIndex((x) => x.id === mine[k]!.id);
      if (idx >= 0) {
        at = idx + 1;
        break;
      }
    }
    out.splice(at, 0, b);
  }
  return { blocks: out, clash };
}

/* ---------------------------------------------------------------- the store */

type Pending = { at: number; pages: { id: string; rev: number; saved: boolean; base: NotebookBlock[]; blocks: NotebookBlock[]; title: string; style: NotebookStyle; position: number; blocksDirty: boolean; metaDirty: boolean }[]; deleted: string[] };

type Slot = {
  page: NbPage;
  /** The blocks as the server has them at `page.rev`: what this window's changes are measured from. */
  base: NotebookBlock[];
  blocksDirty: boolean;
  metaDirty: boolean;
  /** A starter page ("Notes", one empty text block): made on the server only when something is written in it. */
  starter: boolean;
  saving: boolean;
  timer: number;
  retry: number;
  failures: number;
  /** A save was refused for good (too big): no retry until the next change, or Retry. */
  stuck: boolean;
};

export type NbDeps = {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  idb: { get: <T>(key: string) => Promise<T | null>; set: (key: string, v: unknown) => Promise<boolean>; delete: (key: string) => Promise<boolean> };
  timers: { set: (fn: () => void, ms: number) => number; clear: (id: number) => void; now: () => number };
  online: () => boolean;
  newId: () => string;
  /** The last page used in this paper, kept on this device (scholar.notebook.<paper>). */
  store: { get: (k: string) => string | null; set: (k: string, v: string) => void };
  /** Told when a merge kept this window's text over another window's (the toast "Updated from another window"). */
  onClash?: () => void;
};

export const SAVE_AFTER_MS = 1200;
const KEEPALIVE_LIMIT = 60_000;
const PERSIST_AFTER_MS = 400;
const CONFLICT_SHOWN_MS = 6000;
export const STARTER_TITLE = "Notes";
export const NEW_PAGE_TITLE = "Untitled page";
const OPEN_KEY = (docId: string) => `scholar.notebook.${docId}`;
const PENDING_KEY = (docId: string) => `nb:${docId}`;

export const newNotebookId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "").slice(0, 20) : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** A page with nothing written in it (only empty text blocks). */
const isEmpty = (blocks: readonly NotebookBlock[]) => blocks.every((b) => b.kind === "text" && !b.md.trim());

export type NotebookStore = ReturnType<typeof createNotebookStore>;

export function createNotebookStore(docId: string, deps: NbDeps) {
  const url = `/api/v1/documents/${docId}/notebook`;
  const pageUrl = (id: string) => `${url}/pages/${encodeURIComponent(id)}`;
  let slots: Slot[] = [];
  let status: NbState["status"] = "loading";
  let openId: string | null = null;
  let error = "";
  let conflictAt = -Infinity;
  let conflictTimer = 0;
  let persistTimer = 0;
  let persisted = false;
  let alive = true;
  /** Deletes not yet sent (offline), by page id. */
  let deleted: string[] = [];
  /** A delete on its way: Undo waits for it, so the page is made again after it went, not before. */
  const deleting = new Map<string, Promise<void>>();
  /** The highlights the paper has (null until they are loaded): a quote of one that is gone is saved with no highlight id. */
  let known: ReadonlySet<string> | null = null;
  let snapshot: NbState;
  const listeners = new Set<() => void>();

  const slotOf = (id: string) => slots.find((s) => s.page.id === id);
  const sorted = () => slots.sort((a, b) => a.page.position - b.page.position);
  const dirty = (s: Slot) => s.blocksDirty || s.metaDirty || (!s.page.saved && !s.starter);
  const anyDirty = () => slots.some(dirty) || deleted.length > 0;

  const line = (): NbSave => {
    if (error) return "error";
    if (anyDirty() || slots.some((s) => s.saving)) return deps.online() ? (slots.some((s) => s.failures > 0) ? "error" : "saving") : "offline";
    if (deps.timers.now() - conflictAt < CONFLICT_SHOWN_MS) return "conflict";
    return slots.some((s) => s.page.saved) ? "saved" : "idle";
  };
  const build = (): NbState => {
    const quoted = new Set<string>();
    for (const s of slots) for (const b of s.page.blocks) if (b.kind === "quote" && b.noteId) quoted.add(b.noteId);
    return { status, pages: slots.map((s) => s.page), openId, save: line(), error, quoted };
  };
  snapshot = build();
  const emit = () => {
    snapshot = build();
    listeners.forEach((l) => l());
  };

  /* ---- kept on this device until the server has it ---- */
  const persistNow = async () => {
    deps.timers.clear(persistTimer);
    const waiting = slots.filter(dirty);
    if (!waiting.length && !deleted.length) {
      persisted = false;
      await deps.idb.delete(PENDING_KEY(docId));
      return;
    }
    const p: Pending = {
      at: deps.timers.now(),
      pages: waiting.map((s) => ({ id: s.page.id, rev: s.page.rev, saved: s.page.saved, base: s.base, blocks: s.page.blocks, title: s.page.title, style: s.page.style, position: s.page.position, blocksDirty: s.blocksDirty || !s.page.saved, metaDirty: s.metaDirty })),
      deleted,
    };
    persisted = await deps.idb.set(PENDING_KEY(docId), p);
  };
  const persistSoon = () => {
    deps.timers.clear(persistTimer);
    persistTimer = deps.timers.set(() => void persistNow(), PERSIST_AFTER_MS);
  };

  /** A quote of a highlight that is gone is saved with no highlight id (it stays, as plain text marked "highlight removed"). */
  const outgoing = (blocks: NotebookBlock[]): NotebookBlock[] => (known ? blocks.map((b) => (b.kind === "quote" && b.noteId && !known!.has(b.noteId) ? { ...b, noteId: null } : b)) : blocks);

  const send = (method: string, target: string, body: unknown, keepalive = false) => {
    const text = body === undefined ? undefined : JSON.stringify(body);
    return deps.fetch(target, { method, credentials: "same-origin", headers: text ? { "Content-Type": "application/json" } : undefined, body: text, keepalive: keepalive && (text?.length ?? 0) < KEEPALIVE_LIMIT });
  };

  const fromServer = (p: NotebookPage): NbPage => ({ id: p.id, title: p.title, style: p.style, position: p.position, blocks: p.blocks, rev: p.rev, saved: true });
  const slotFor = (page: NbPage, base: NotebookBlock[] = page.blocks): Slot => ({ page, base, blocksDirty: false, metaDirty: false, starter: false, saving: false, timer: 0, retry: 0, failures: 0, stuck: false });

  /* ---- saving one page ---- */
  async function save(id: string, keepalive = false): Promise<void> {
    const s = slotOf(id);
    if (!s || !alive || s.saving || !dirty(s) || s.stuck) return;
    deps.timers.clear(s.timer);
    s.saving = true;
    emit();
    let again = false;
    /** What is on its way: put back as unsaved when the connection fails. */
    let inFlight: "blocks" | "meta" | null = null;
    try {
      if (!s.page.saved) {
        // a quote of a highlight that is gone loses its highlight id here too, so what is shown is what is saved
        s.page = { ...s.page, blocks: outgoing(s.page.blocks) };
        const sending = s.page.blocks;
        const meta = { title: s.page.title, style: s.page.style, position: s.page.position };
        const res = await send("PUT", pageUrl(id), { rev: 0, ...meta, blocks: sending }, keepalive);
        if (res.status === 201 || res.status === 409) {
          const page = ((await res.json()) as { page: NotebookPage }).page;
          if (res.status === 201) {
            s.page = { ...s.page, rev: page.rev, saved: true, position: page.position };
            s.base = page.blocks;
            s.blocksDirty = JSON.stringify(s.page.blocks) !== JSON.stringify(sending);
            s.metaDirty = s.page.title !== meta.title || s.page.style !== meta.style;
          } else {
            // it is there already (a save whose answer was lost, or another window made it): merge into the server's
            merged(s, page);
          }
          s.failures = 0;
        } else await refused(s, res);
      } else {
        if (s.blocksDirty) {
          s.page = { ...s.page, blocks: outgoing(s.page.blocks) };
          const sending = s.page.blocks;
          s.blocksDirty = false;
          inFlight = "blocks";
          const res = await send("PUT", pageUrl(id), { rev: s.page.rev, blocks: sending }, keepalive);
          if (res.ok) {
            const page = ((await res.json()) as { page: NotebookPage }).page;
            s.page = { ...s.page, rev: page.rev };
            s.base = page.blocks;
            if (JSON.stringify(sending) !== JSON.stringify(s.page.blocks)) s.blocksDirty = true;
            s.failures = 0;
          } else if (res.status === 409) {
            merged(s, ((await res.json()) as { page: NotebookPage }).page);
            s.failures = 0;
          } else if (res.status === 404) {
            // deleted in another window while this one wrote in it: made again, with what is written here
            s.page = { ...s.page, saved: false, rev: 0 };
            s.base = [];
            again = true;
          } else {
            s.blocksDirty = true;
            await refused(s, res);
          }
        }
        if (s.metaDirty && s.page.saved && !s.stuck) {
          const meta = { title: s.page.title, style: s.page.style, position: s.page.position };
          s.metaDirty = false;
          inFlight = "meta";
          const res = await send("PATCH", pageUrl(id), meta, keepalive);
          if (res.status === 404) {
            s.page = { ...s.page, saved: false, rev: 0 };
            s.base = [];
            again = true;
          } else if (!res.ok) {
            s.metaDirty = true;
            await refused(s, res);
          } else {
            s.failures = 0;
            const now = slotOf(id);
            if (now && (now.page.title !== meta.title || now.page.style !== meta.style || now.page.position !== meta.position)) now.metaDirty = true;
          }
        }
      }
    } catch {
      // no connection: kept here and on this device, and tried again
      s.failures += 1;
      if (!s.page.saved || inFlight === "blocks") s.blocksDirty = true;
      if (inFlight === "meta") s.metaDirty = true;
      void persistNow();
      deps.timers.clear(s.retry);
      if (alive) s.retry = deps.timers.set(() => void save(id), Math.min(30_000, 2000 * 2 ** Math.min(s.failures, 4)));
    } finally {
      s.saving = false;
      if (alive && slotOf(id) === s) {
        if (!slots.some(dirty) && !deleted.length) {
          deps.timers.clear(persistTimer);
          persisted = false;
          void deps.idb.delete(PENDING_KEY(docId));
        } else persistSoon();
        if (dirty(s) && !s.stuck && (s.failures === 0 || again)) s.timer = deps.timers.set(() => void save(id), again ? 0 : 200);
      }
      emit();
    }
  }

  /** A refusal that will not change by trying again (too big, not valid): said once, and the page waits for the next change or Retry. */
  async function refused(s: Slot, res: Response) {
    if (res.status >= 500 || res.status === 429) throw new Error(String(res.status));
    const j = (await res.json().catch(() => null)) as { title?: string; detail?: string } | null;
    error = [j?.title ?? "Your notes could not be saved", j?.detail].filter(Boolean).join(". ");
    s.stuck = true;
  }

  function merged(s: Slot, server: NotebookPage) {
    const { blocks, clash } = mergeBlocks(server.blocks, s.base, s.page.blocks);
    s.page = { ...s.page, rev: server.rev, saved: true, blocks };
    s.base = server.blocks;
    s.blocksDirty = JSON.stringify(blocks) !== JSON.stringify(server.blocks);
    // the title, style and place are last-write-wins: the server's, unless this window changed them and has not sent them yet
    if (!s.metaDirty) s.page = { ...s.page, title: server.title, style: server.style, position: server.position };
    conflictAt = deps.timers.now();
    deps.timers.clear(conflictTimer);
    conflictTimer = deps.timers.set(emit, CONFLICT_SHOWN_MS + 50);
    if (clash) deps.onClash?.();
    sorted();
  }

  async function sendDeletes(keepalive = false) {
    for (const id of [...deleted]) {
      if (deleting.has(id)) continue;
      const p = send("DELETE", pageUrl(id), undefined, keepalive)
        .then((res) => {
          if (res.ok || res.status === 404) deleted = deleted.filter((x) => x !== id);
          else if (res.status >= 500) throw new Error(String(res.status));
          else deleted = deleted.filter((x) => x !== id);
        })
        .catch(() => {
          void persistNow();
        })
        .finally(() => {
          deleting.delete(id);
          if (!anyDirty()) void persistNow();
          emit();
        });
      deleting.set(id, p);
    }
  }

  /** Something changed on a page: saved 1.2 s after the last change. */
  function changed(s: Slot, what: "blocks" | "meta") {
    if (what === "blocks") s.blocksDirty = true;
    else s.metaDirty = true;
    if (s.starter && !isEmpty(s.page.blocks)) s.starter = false;
    s.stuck = false;
    error = "";
    conflictAt = -Infinity;
    persistSoon();
    deps.timers.clear(s.timer);
    s.timer = deps.timers.set(() => void save(s.page.id), SAVE_AFTER_MS);
    emit();
  }

  const starterPage = (): Slot => {
    const page: NbPage = { id: deps.newId(), title: STARTER_TITLE, style: "plain", position: 1, blocks: [{ id: deps.newId(), kind: "text", md: "" }], rev: 0, saved: false };
    return { ...slotFor(page, []), starter: true };
  };

  /* ---- loading ---- */
  async function load() {
    status = "loading";
    emit();
    try {
      const res = await deps.fetch(url, { credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      const pages = ((await res.json()) as { pages: NotebookPage[] }).pages;
      if (!alive) return;
      slots = pages.map((p) => slotFor(fromServer(p)));
      // what was written here and not sent (offline, or a tab closed too soon) is taken up again
      const p = await deps.idb.get<Pending>(PENDING_KEY(docId));
      if (p && alive) {
        deleted = p.deleted.filter((id) => slots.some((s) => s.page.id === id));
        slots = slots.filter((s) => !deleted.includes(s.page.id));
        for (const w of p.pages) {
          const s = slotOf(w.id);
          if (s) {
            if (w.blocksDirty) {
              const blocks = w.rev === s.page.rev ? w.blocks : mergeBlocks(s.page.blocks, w.saved ? w.base : [], w.blocks).blocks;
              if (JSON.stringify(blocks) !== JSON.stringify(s.page.blocks)) {
                s.page = { ...s.page, blocks };
                s.blocksDirty = true;
              }
            }
            if (w.metaDirty) {
              s.page = { ...s.page, title: w.title, style: w.style, position: w.position };
              s.metaDirty = true;
            }
          } else if (!isEmpty(w.blocks) || !w.saved) {
            // made here and not sent, or deleted elsewhere while this window still had writing in it: made (again)
            slots.push({ ...slotFor({ id: w.id, title: w.title, style: w.style, position: w.position, blocks: w.blocks, rev: 0, saved: false }, []), blocksDirty: true });
          }
        }
        sorted();
      }
      if (!slots.length) slots = [starterPage()];
      const kept = deps.store.get(OPEN_KEY(docId));
      openId = slots.find((s) => s.page.id === kept)?.page.id ?? slots[0]!.page.id;
      status = "ready";
      emit();
      if (anyDirty()) saveAll();
    } catch {
      if (!alive) return;
      status = "error";
      emit();
    }
  }

  function saveAll(keepalive = false) {
    for (const s of slots) if (dirty(s)) void save(s.page.id, keepalive);
    void sendDeletes(keepalive);
  }

  /* ---- what the page does ---- */
  const page = (id: string | null | undefined) => (id ? slotOf(id) : undefined);
  const openSlot = () => page(openId) ?? slots[0];
  const setBlocks = (s: Slot, blocks: NotebookBlock[]) => {
    s.page = { ...s.page, blocks };
    changed(s, "blocks");
  };

  const api = {
    get: (): NbState => snapshot,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    load,
    /** The page shown, and the one "Add to notes" adds to; kept on this device for this paper. */
    open(id: string) {
      if (!slotOf(id) || openId === id) return;
      openId = id;
      deps.store.set(OPEN_KEY(docId), id);
      emit();
    },
    /** A new page at the end, named "Untitled page", made on the server at once. Returns its id, or null when the paper has as many pages as it can hold. */
    addPage(title = NEW_PAGE_TITLE): string | null {
      if (slots.length >= NOTEBOOK_LIMITS.pages) {
        error = `A paper can have ${NOTEBOOK_LIMITS.pages} pages of notes.`;
        emit();
        return null;
      }
      const last = slots[slots.length - 1];
      const s = slotFor({ id: deps.newId(), title, style: "plain", position: (last?.page.position ?? 0) + 1, blocks: [{ id: deps.newId(), kind: "text", md: "" }], rev: 0, saved: false }, []);
      slots.push(s);
      openId = s.page.id;
      deps.store.set(OPEN_KEY(docId), s.page.id);
      changed(s, "blocks");
      return s.page.id;
    },
    rename(id: string, title: string) {
      const s = slotOf(id);
      if (!s || s.page.title === title) return;
      s.page = { ...s.page, title: title.slice(0, NOTEBOOK_LIMITS.title) };
      if (s.starter) s.starter = false;
      changed(s, "meta");
    },
    setStyle(id: string, style: NotebookStyle) {
      const s = slotOf(id);
      if (!s || s.page.style === style) return;
      s.page = { ...s.page, style };
      changed(s, "meta");
    },
    /** One place up or down: the page takes the midpoint between its new neighbours (nothing is renumbered). */
    movePage(id: string, dir: -1 | 1): boolean {
      sorted();
      const i = slots.findIndex((s) => s.page.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= slots.length) return false;
      const beyond = slots[j + dir];
      const target = slots[j]!.page.position;
      const position = beyond ? (target + beyond.page.position) / 2 : target + dir;
      const s = slots[i]!;
      s.page = { ...s.page, position };
      sorted();
      changed(s, "meta");
      return true;
    },
    /** Deletes a page; the returned function (the toast's Undo) brings it back with all its blocks. */
    deletePage(id: string): (() => void) | null {
      const s = slotOf(id);
      if (!s) return null;
      deps.timers.clear(s.timer);
      deps.timers.clear(s.retry);
      const i = sorted().indexOf(s);
      slots = slots.filter((x) => x !== s);
      if (s.page.saved) {
        deleted.push(id);
        void sendDeletes();
      }
      if (!slots.length) slots = [starterPage()];
      // the page after it opens (or the one before, when it was the last)
      if (openId === id) openId = slots[Math.min(i, slots.length - 1)]!.page.id;
      persistSoon();
      emit();
      const gone = s.page;
      return () => {
        void (async () => {
          if (deleted.includes(id) && !deleting.has(id)) deleted = deleted.filter((x) => x !== id);
          else await deleting.get(id);
          if (!alive || slotOf(id)) return;
          // the starter page made in its place goes again if nothing was written in it
          slots = slots.filter((x) => !(x.starter && isEmpty(x.page.blocks)));
          const back = slotFor({ ...gone, rev: 0, saved: false }, []);
          slots.push(back);
          sorted();
          openId = id;
          changed(back, "blocks");
        })();
      };
    },
    /** The blocks of a page, as the editor changed them. */
    setBlocks(id: string, blocks: NotebookBlock[]) {
      const s = slotOf(id);
      if (s) setBlocks(s, blocks);
    },
    setText(id: string, blockId: string, md: string) {
      const s = slotOf(id);
      if (!s) return;
      setBlocks(s, s.page.blocks.map((b) => (b.id === blockId && b.kind === "text" ? { ...b, md } : b)));
    },
    /** A new text block after `afterId` (or at the end); returns its id. */
    addText(id: string, afterId?: string | null, md = ""): string | null {
      const s = slotOf(id);
      if (!s || s.page.blocks.length >= NOTEBOOK_LIMITS.blocks) return null;
      const b: TextBlock = { id: deps.newId(), kind: "text", md };
      const at = afterId ? s.page.blocks.findIndex((x) => x.id === afterId) + 1 : s.page.blocks.length;
      setBlocks(s, [...s.page.blocks.slice(0, at || s.page.blocks.length), b, ...s.page.blocks.slice(at || s.page.blocks.length)]);
      return b.id;
    },
    /** Moves a block one place (Alt+arrow) or to an index (a drag). Returns its new index, or -1. */
    moveBlock(id: string, blockId: string, to: number): number {
      const s = slotOf(id);
      if (!s) return -1;
      const from = s.page.blocks.findIndex((b) => b.id === blockId);
      const dest = Math.max(0, Math.min(s.page.blocks.length - 1, to));
      if (from < 0 || from === dest) return -1;
      const list = [...s.page.blocks];
      const [b] = list.splice(from, 1);
      list.splice(dest, 0, b!);
      setBlocks(s, list);
      return dest;
    },
    /** Deletes a block; the returned function (Undo) puts it back where it was. */
    removeBlock(id: string, blockId: string): (() => void) | null {
      const s = slotOf(id);
      const at = s?.page.blocks.findIndex((b) => b.id === blockId) ?? -1;
      if (!s || at < 0) return null;
      const b = s.page.blocks[at]!;
      setBlocks(s, s.page.blocks.filter((x) => x.id !== blockId));
      return () => {
        const now = slotOf(id);
        if (!now || now.page.blocks.some((x) => x.id === b.id)) return;
        const list = [...now.page.blocks];
        list.splice(Math.min(at, list.length), 0, b);
        setBlocks(now, list);
      };
    },
    /**
     * A highlight as a quote block on the open page (or `pageId`), at `index` (the end when left out; a page whose only block is an empty text block has it replaced). With no page at all, a
     * page "Notes" is made. Returns where it went, for the toast and its Undo.
     */
    addQuote(q: { noteId: string | null; page: number; quote: string; color: QuoteColor }, where: { pageId?: string; index?: number } = {}): { pageId: string; blockId: string; title: string } | null {
      const s = page(where.pageId) ?? openSlot();
      if (!s) return null;
      if (s.page.blocks.length >= NOTEBOOK_LIMITS.blocks) {
        error = `A page holds at most ${NOTEBOOK_LIMITS.blocks} blocks. Add a page for more.`;
        emit();
        return null;
      }
      const b: QuoteBlock = { id: deps.newId(), kind: "quote", noteId: q.noteId, page: q.page, quote: q.quote.replace(/\s+/g, " ").trim().slice(0, NOTEBOOK_LIMITS.quote), color: q.color };
      const only = s.page.blocks.length === 1 && isEmpty(s.page.blocks);
      const list = only ? [] : [...s.page.blocks];
      const at = where.index === undefined || only ? list.length : Math.max(0, Math.min(list.length, where.index));
      list.splice(at, 0, b);
      // a quote after the last block leaves a text block to write in after it
      if (at === list.length - 1) list.push({ id: deps.newId(), kind: "text", md: "" });
      setBlocks(s, list);
      return { pageId: s.page.id, blockId: b.id, title: s.page.title || NEW_PAGE_TITLE };
    },
    /** Where a highlight is quoted: the first page and block, or null. */
    findQuote(noteId: string): { pageId: string; blockId: string } | null {
      for (const s of sorted()) for (const b of s.page.blocks) if (b.kind === "quote" && b.noteId === noteId) return { pageId: s.page.id, blockId: b.id };
      return null;
    },
    /** The paper's highlights, once loaded: a quote of one that is gone is saved with no highlight id. */
    setKnownNotes(ids: ReadonlySet<string> | null) {
      known = ids;
    },
    retry() {
      error = "";
      for (const s of slots) {
        s.stuck = false;
        s.failures = 0;
      }
      if (status === "error") void load();
      else saveAll();
      emit();
    },
    /** Leaving the page or the paper: what is unsaved is kept on this device and sent now. */
    flush() {
      if (!anyDirty()) return;
      void persistNow();
      saveAll(true);
    },
    online() {
      if (anyDirty()) {
        for (const s of slots) s.failures = 0;
        saveAll();
      }
      emit();
    },
    /** True when closing the page now would lose writing (not saved, and not kept on this device either). */
    unsafe: () => anyDirty() && !persisted,
    destroy() {
      api.flush();
      alive = false;
      for (const s of slots) {
        deps.timers.clear(s.timer);
        deps.timers.clear(s.retry);
      }
      deps.timers.clear(persistTimer);
      deps.timers.clear(conflictTimer);
      listeners.clear();
    },
  };
  return api;
}

/** The browser's network, IndexedDB, clock and storage. */
export function browserNotebookDeps(onClash?: () => void): NbDeps {
  return {
    fetch: (u, init) => fetch(u, init),
    idb: { get: (k) => idbGet(k), set: (k, v) => idbSet(k, v), delete: (k) => idbDelete(k) },
    timers: { set: (fn, ms) => window.setTimeout(fn, ms), clear: (id) => window.clearTimeout(id), now: () => Date.now() },
    online: () => navigator.onLine,
    newId: newNotebookId,
    store: {
      get: (k) => {
        try {
          return localStorage.getItem(k);
        } catch {
          return null;
        }
      },
      set: (k, v) => {
        try {
          localStorage.setItem(k, v);
        } catch {
          /* private mode: only for this visit */
        }
      },
    },
    onClash,
  };
}

/**
 * The store for one paper, with the page's events: leaving the page sends what is unsaved (and keeps it on this device), the browser asks before closing a page with writing that is
 * neither saved nor kept, and coming back online sends what waited. Returns the stop function.
 */
export function attachNotebook(store: NotebookStore): () => void {
  const onHide = () => document.visibilityState === "hidden" && store.flush();
  const flush = () => store.flush();
  const warn = (e: BeforeUnloadEvent) => {
    if (store.unsafe()) e.preventDefault();
  };
  const online = () => store.online();
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", flush);
  window.addEventListener("beforeunload", warn);
  window.addEventListener("online", online);
  window.addEventListener("offline", online);
  return () => {
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", flush);
    window.removeEventListener("beforeunload", warn);
    window.removeEventListener("online", online);
    window.removeEventListener("offline", online);
    store.destroy();
  };
}

const NOTHING: NbState = { status: "loading", pages: [], openId: null, save: "idle", error: "", quoted: new Set() };
const noop = () => () => {};
/** The Notebook's state in React; null store (not loaded yet) reads as loading. */
export function useNotebook(store: NotebookStore | null): NbState {
  return useSyncExternalStore(store?.subscribe ?? noop, store?.get ?? (() => NOTHING), () => NOTHING);
}
