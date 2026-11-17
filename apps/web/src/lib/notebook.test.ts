import { describe, expect, it, vi } from "vitest";
import type { NotebookBlock, NotebookPage } from "@scholar/shared";

vi.mock("./idb", () => ({ idbGet: async () => null, idbSet: async () => true, idbDelete: async () => true }));
vi.mock("react", () => ({ useSyncExternalStore: (_s: unknown, get: () => unknown) => get() }));

const { createNotebookStore, mergeBlocks, SAVE_AFTER_MS, STARTER_TITLE } = await import("./notebook");
type Store = ReturnType<typeof createNotebookStore>;

const text = (id: string, md: string): NotebookBlock => ({ id, kind: "text", md });
const quote = (id: string, noteId: string | null = "n1"): NotebookBlock => ({ id, kind: "quote", noteId, page: 1, quote: `quote ${id}`, color: "yellow" });
const ids = (bs: readonly NotebookBlock[]) => bs.map((b) => b.id);

/* ================================================================ the merge: each of its four rules */

describe("mergeBlocks: another window saved first", () => {
  const base = [text("a", "A"), text("b", "B"), text("c", "C")];

  it("1. the server's blocks are the base: what the other window added or changed is kept", () => {
    const server = [text("a", "A changed there"), text("b", "B"), text("x", "added there"), text("c", "C")];
    const { blocks, clash } = mergeBlocks(server, base, base);
    expect(blocks).toEqual(server);
    expect(clash).toBe(false);
  });

  it("2. blocks this window changed are put over them; the same block changed in both: this window's text wins, and it is a clash", () => {
    const mine = [text("a", "A changed here"), text("b", "B"), text("c", "C")];
    const calm = mergeBlocks([text("a", "A"), text("b", "B changed there"), text("c", "C")], base, mine);
    expect(calm.blocks).toEqual([text("a", "A changed here"), text("b", "B changed there"), text("c", "C")]);
    expect(calm.clash).toBe(false);
    const both = mergeBlocks([text("a", "A changed there"), text("b", "B"), text("c", "C")], base, mine);
    expect(both.blocks[0]).toEqual(text("a", "A changed here"));
    expect(both.clash).toBe(true);
  });

  it("3. blocks this window added go after their neighbours (the top when there is none before them)", () => {
    const server = [text("a", "A"), text("x", "there"), text("b", "B"), text("c", "C")];
    const mine = [text("top", "new first"), text("a", "A"), text("b", "B"), text("n", "new after b"), text("c", "C"), text("end", "new last")];
    expect(ids(mergeBlocks(server, base, mine).blocks)).toEqual(["top", "a", "x", "b", "n", "c", "end"]);
  });

  it("4. blocks this window deleted stay deleted, even when the other window changed them; one deleted there and untouched here stays deleted too", () => {
    const server = [text("a", "A"), text("b", "B changed there")];
    const mine = [text("a", "A"), text("c", "C")];
    expect(ids(mergeBlocks(server, base, mine).blocks)).toEqual(["a"]);
  });

  it("a block changed here that the other window deleted comes back (what was typed is never lost), as a clash", () => {
    const { blocks, clash } = mergeBlocks([text("a", "A"), text("c", "C")], base, [text("a", "A"), text("b", "B typed here"), text("c", "C")]);
    expect(ids(blocks)).toEqual(["a", "b", "c"]);
    expect(clash).toBe(true);
  });

  it("a page made here and on the server too (a save whose answer was lost): this window's copy", () => {
    const mine = [text("a", "mine"), quote("q")];
    expect(mergeBlocks([text("a", "older")], [], mine).blocks).toEqual(mine);
  });
});

/* ================================================================ the store, against a stand-in server, clock and IndexedDB */

function world() {
  const pages = new Map<string, NotebookPage>();
  const calls: string[] = [];
  let offline = false;
  let now = 1000;
  let seq = 0;
  let nextTimer = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const idb = new Map<string, unknown>();
  const local = new Map<string, string>();
  const clashes: number[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const server = {
    pages,
    calls,
    idb,
    clashes,
    setOffline: (v: boolean) => (offline = v),
    async fetch(url: string, init: RequestInit = {}): Promise<Response> {
      const method = init.method ?? "GET";
      calls.push(`${method} ${url.replace(/^\/api\/v1\/documents\/d1\/notebook/, "")}`);
      if (offline) throw new TypeError("Failed to fetch");
      const id = decodeURIComponent(/\/pages\/([^/]+)$/.exec(url)?.[1] ?? "");
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, any>) : {};
      if (method === "GET") return json({ pages: [...pages.values()].sort((a, b) => a.position - b.position) });
      const have = pages.get(id);
      if (method === "DELETE") return have ? (pages.delete(id), new Response(null, { status: 204 })) : json({ type: "page_gone" }, 404);
      if (method === "PATCH") {
        if (!have) return json({ type: "page_gone" }, 404);
        const page = { ...have, ...("title" in body ? { title: body.title } : {}), ...("style" in body ? { style: body.style } : {}), ...("position" in body ? { position: body.position } : {}) };
        pages.set(id, page);
        return json({ page });
      }
      // PUT
      if (!body.rev) {
        if (have) return json({ type: "conflict", page: have }, 409);
        const page: NotebookPage = { id, title: body.title ?? "", style: body.style ?? "plain", position: body.position ?? pages.size + 1, blocks: body.blocks, rev: 1, updatedAt: ++seq };
        pages.set(id, page);
        return json({ page }, 201);
      }
      if (!have) return json({ type: "page_gone" }, 404);
      if (have.rev !== body.rev) return json({ type: "conflict", page: have }, 409);
      const page = { ...have, blocks: body.blocks, rev: have.rev + 1 };
      pages.set(id, page);
      return json({ page });
    },
    /** Moves the clock and runs what is due, letting the promises it starts finish. */
    async tick(ms = 0) {
      now += ms;
      for (let round = 0; round < 40; round++) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at);
        for (const [k, t] of due) {
          timers.delete(k);
          t.fn();
        }
        for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
        if (!due.length) break;
      }
    },
    store(): Store {
      let n = 0;
      return createNotebookStore("d1", {
        fetch: (u, i) => server.fetch(u, i),
        idb: { get: async <T,>(k: string) => (idb.has(k) ? (structuredClone(idb.get(k)) as T) : null), set: async (k, v) => (idb.set(k, structuredClone(v)), true), delete: async (k) => idb.delete(k) },
        timers: { set: (fn, ms) => (timers.set(nextTimer, { at: now + ms, fn }), nextTimer++), clear: (id) => void timers.delete(id), now: () => now },
        online: () => !offline,
        newId: () => `id${++n}${Math.random().toString(36).slice(2, 6)}`,
        store: { get: (k) => local.get(k) ?? null, set: (k, v) => void local.set(k, v) },
        onClash: () => clashes.push(now),
      });
    },
  };
  return server;
}

const open = (s: Store) => s.get().pages.find((p) => p.id === s.get().openId)!;

describe("useNotebook's store", () => {
  it("a paper with no notebook shows one page, Notes, with an empty text block; opening it makes nothing on the server", async () => {
    const w = world();
    const s = w.store();
    await s.load();
    await w.tick(5000);
    expect(s.get().pages.map((p) => [p.title, p.saved, p.blocks.length])).toEqual([[STARTER_TITLE, false, 1]]);
    expect(w.calls).toEqual(["GET "]);
    expect(s.get().save).toBe("idle");
  });

  it("writing makes the page 1.2 s after the last change, then replaces it with its revision; the save line follows", async () => {
    const w = world();
    const s = w.store();
    await s.load();
    const p = open(s);
    s.setText(p.id, p.blocks[0]!.id, "first words");
    expect(s.get().save).toBe("saving");
    await w.tick(SAVE_AFTER_MS - 100);
    expect(w.pages.size).toBe(0);
    await w.tick(200);
    expect(w.pages.get(p.id)).toMatchObject({ title: STARTER_TITLE, rev: 1, blocks: [{ md: "first words" }] });
    expect(s.get().save).toBe("saved");
    s.setText(p.id, p.blocks[0]!.id, "second words");
    await w.tick(SAVE_AFTER_MS + 10);
    expect(w.pages.get(p.id)).toMatchObject({ rev: 2, blocks: [{ md: "second words" }] });
    expect(w.calls.filter((c) => c.startsWith("PUT"))).toHaveLength(2);
  });

  it("on a 409 the pages are merged by block id and saved again; the same block changed in both windows is said once (Updated from another window)", async () => {
    const w = world();
    w.pages.set("p1", { id: "p1", title: "Methods", style: "plain", position: 1, blocks: [text("a", "A"), text("b", "B")], rev: 1, updatedAt: 1 });
    const s = w.store();
    await s.load();
    // another window: changes b and adds x
    w.pages.set("p1", { ...w.pages.get("p1")!, blocks: [text("a", "A"), text("b", "B there"), text("x", "X there")], rev: 2 });
    // this window: changes a, adds n after a
    s.setBlocks("p1", [text("a", "A here"), text("n", "new"), text("b", "B")]);
    await w.tick(SAVE_AFTER_MS + 10);
    await w.tick(300);
    expect(ids(w.pages.get("p1")!.blocks)).toEqual(["a", "n", "b", "x"]);
    expect(w.pages.get("p1")!.blocks.map((b) => (b.kind === "text" ? b.md : ""))).toEqual(["A here", "new", "B there", "X there"]);
    expect(w.pages.get("p1")!.rev).toBe(3);
    expect(s.get().save).toBe("conflict");
    expect(w.clashes).toHaveLength(0);
    // now both change b
    w.pages.set("p1", { ...w.pages.get("p1")!, blocks: w.pages.get("p1")!.blocks.map((b) => (b.id === "b" ? text("b", "B there again") : b)), rev: 4 });
    s.setText("p1", "b", "B here");
    await w.tick(SAVE_AFTER_MS + 10);
    await w.tick(300);
    expect((w.pages.get("p1")!.blocks.find((b) => b.id === "b") as { md: string }).md).toBe("B here");
    expect(w.clashes).toHaveLength(1);
    await w.tick(7000);
    expect(s.get().save).toBe("saved");
  });

  it("offline: kept on this device and said so; a new window (a reload) takes it up and sends it when the connection is back", async () => {
    const w = world();
    const s = w.store();
    await s.load();
    const p = open(s);
    w.setOffline(true);
    s.setText(p.id, p.blocks[0]!.id, "written on a train");
    await w.tick(SAVE_AFTER_MS + 10);
    expect(s.get().save).toBe("offline");
    expect(w.idb.has("nb:d1")).toBe(true);
    expect(s.unsafe()).toBe(false);
    s.destroy();
    // the reload: still offline, then the connection comes back
    const again = w.store();
    w.setOffline(false);
    await again.load();
    await w.tick(500);
    expect([...w.pages.values()].map((x) => x.blocks)).toEqual([[{ id: p.blocks[0]!.id, kind: "text", md: "written on a train" }]]);
    await w.tick(1000);
    expect(w.idb.has("nb:d1")).toBe(false);
    expect(again.get().save).toBe("saved");
  });

  it("a page made on the server meanwhile and an offline edit on an older revision are merged when they meet", async () => {
    const w = world();
    w.pages.set("p1", { id: "p1", title: "P", style: "plain", position: 1, blocks: [text("a", "A")], rev: 1, updatedAt: 1 });
    const s = w.store();
    await s.load();
    w.setOffline(true);
    s.setBlocks("p1", [text("a", "A"), text("off", "offline line")]);
    await w.tick(SAVE_AFTER_MS + 10);
    s.destroy();
    w.pages.set("p1", { ...w.pages.get("p1")!, blocks: [text("a", "A"), text("on", "online elsewhere")], rev: 2 });
    w.setOffline(false);
    const again = w.store();
    await again.load();
    await w.tick(1000);
    expect(ids(w.pages.get("p1")!.blocks)).toEqual(["a", "off", "on"]);
  });

  it("Undo of a deleted page brings it back, blocks and all, after the delete has gone", async () => {
    const w = world();
    w.pages.set("p1", { id: "p1", title: "Keep", style: "grid", position: 1, blocks: [text("a", "A"), quote("q")], rev: 3, updatedAt: 1 });
    w.pages.set("p2", { id: "p2", title: "Other", style: "plain", position: 2, blocks: [], rev: 1, updatedAt: 1 });
    const s = w.store();
    await s.load();
    s.open("p1");
    const undo = s.deletePage("p1")!;
    expect(s.get().pages.map((p) => p.id)).toEqual(["p2"]);
    expect(s.get().openId).toBe("p2");
    undo();
    // Undo waits for the delete that is on its way, then makes the page again
    await w.tick(0);
    await w.tick(SAVE_AFTER_MS + 10);
    await w.tick(100);
    expect(w.calls.filter((c) => !c.startsWith("GET"))).toEqual(["DELETE /pages/p1", "PUT /pages/p1"]);
    expect(w.pages.get("p1")).toMatchObject({ title: "Keep", style: "grid", position: 1, blocks: [text("a", "A"), quote("q")], rev: 1 });
    expect(s.get().pages.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("Undo of a deleted block puts it back where it was", async () => {
    const w = world();
    w.pages.set("p1", { id: "p1", title: "P", style: "plain", position: 1, blocks: [text("a", "A"), text("b", "B"), text("c", "C")], rev: 1, updatedAt: 1 });
    const s = w.store();
    await s.load();
    const undo = s.removeBlock("p1", "b")!;
    expect(ids(open(s).blocks)).toEqual(["a", "c"]);
    undo();
    await w.tick(SAVE_AFTER_MS + 10);
    expect(ids(w.pages.get("p1")!.blocks)).toEqual(["a", "b", "c"]);
  });

  it("Add to notes: a quote on the open page (the starter page's empty block is replaced), a text block after it; In notes knows it; moves and renames are PATCHes", async () => {
    const w = world();
    const s = w.store();
    await s.load();
    const at = s.addQuote({ noteId: "n7", page: 3, quote: "  a passage\n of the paper ", color: "blue" })!;
    expect(at.title).toBe(STARTER_TITLE);
    expect(open(s).blocks.map((b) => b.kind)).toEqual(["quote", "text"]);
    expect(s.get().quoted.has("n7")).toBe(true);
    expect(s.findQuote("n7")).toEqual({ pageId: at.pageId, blockId: at.blockId });
    await w.tick(SAVE_AFTER_MS + 10);
    expect(w.pages.get(at.pageId)!.blocks[0]).toMatchObject({ kind: "quote", noteId: "n7", page: 3, quote: "a passage of the paper", color: "blue" });
    const second = s.addPage()!;
    await w.tick(SAVE_AFTER_MS + 10);
    expect(s.movePage(second, -1)).toBe(true);
    s.rename(second, "Results");
    await w.tick(SAVE_AFTER_MS + 10);
    expect(w.calls.filter((c) => c.startsWith("PATCH"))).toEqual([`PATCH /pages/${second}`]);
    expect([...w.pages.values()].sort((a, b) => a.position - b.position).map((p) => p.title)).toEqual(["Results", STARTER_TITLE]);
  });

  it("Undo of Add to notes takes the quote and the empty block it brought; the starter page gets its empty block back", async () => {
    const w = world();
    w.pages.set("p1", { id: "p1", title: "P", style: "plain", position: 1, blocks: [text("a", "A")], rev: 1, updatedAt: 1 });
    const s = w.store();
    await s.load();
    const at = s.addQuote({ noteId: "n1", page: 2, quote: "q", color: "yellow" })!;
    expect(open(s).blocks.map((b) => b.kind)).toEqual(["text", "quote", "text"]);
    at.undo();
    expect(ids(open(s).blocks)).toEqual(["a"]);
    expect(s.get().quoted.has("n1")).toBe(false);
    // a block written after the quote stays: only an empty one goes with it
    const again = s.addQuote({ noteId: "n2", page: 2, quote: "q", color: "yellow" })!;
    s.setText("p1", open(s).blocks[2]!.id, "kept");
    again.undo();
    expect(open(s).blocks.map((b) => (b.kind === "text" ? b.md : b.kind))).toEqual(["A", "kept"]);
    await w.tick(SAVE_AFTER_MS + 10);
    expect(w.pages.get("p1")!.blocks.map((b) => b.kind)).toEqual(["text", "text"]);
    // the starter page (nothing on the server): its one empty block comes back
    const w2 = world();
    const s2 = w2.store();
    await s2.load();
    const first = ids(open(s2).blocks);
    s2.addQuote({ noteId: "n3", page: 1, quote: "q", color: "blue" })!.undo();
    expect(ids(open(s2).blocks)).toEqual(first);
  });

  it("a quote of a highlight that was removed loses its highlight id on the next save", async () => {
    const w = world();
    w.pages.set("p1", { id: "p1", title: "P", style: "plain", position: 1, blocks: [quote("q1", "gone"), quote("q2", "here"), text("t", "")], rev: 1, updatedAt: 1 });
    const s = w.store();
    await s.load();
    s.setKnownNotes(new Set(["here"]));
    s.setText("p1", "t", "next save");
    await w.tick(SAVE_AFTER_MS + 10);
    expect(w.pages.get("p1")!.blocks.map((b) => (b.kind === "quote" ? b.noteId : "text"))).toEqual([null, "here", "text"]);
    await w.tick(SAVE_AFTER_MS * 3);
    expect(w.calls.filter((c) => c.startsWith("PUT"))).toHaveLength(1);
  });

  it("a save refused for good (too big) is said, and not tried again until the next change or Retry", async () => {
    const w = world();
    w.pages.set("p1", { id: "p1", title: "P", style: "plain", position: 1, blocks: [text("t", "x")], rev: 1, updatedAt: 1 });
    const s = w.store();
    await s.load();
    const real = w.fetch;
    w.fetch = async (u, i) => (i?.method === "PUT" ? new Response(JSON.stringify({ type: "too_big", title: "That page of notes is too big to save" }), { status: 413 }) : real(u, i));
    s.setText("p1", "t", "y".repeat(10));
    await w.tick(SAVE_AFTER_MS + 10);
    await w.tick(60_000);
    expect(s.get().save).toBe("error");
    expect(s.get().error).toMatch(/too big/);
    expect(w.calls.filter((c) => c.startsWith("PUT"))).toHaveLength(0);
    w.fetch = real;
    s.retry();
    await w.tick(100);
    expect(s.get().save).toBe("saved");
  });
});
