import { describe, expect, it } from "vitest";
import type { NotebookBlock, NotebookInk, NoteStroke } from "@scholar/shared";
import type { NbState } from "./notebook";
import { createNoteInkStore, INK_SAVE_AFTER_MS, type InkHost } from "./note-ink-store";

/** The ink store (docs/design/paper-reader.md, 25.6) in node: a fake clock, network and IndexedDB, and a notebook that is a plain object. */
const stroke = (id: string, b = "t1", at = 2): NoteStroke => ({ id, tool: "pen", color: "ink", w: 14, a: { k: "text", b, at, q: "llo world".slice(0, 16) }, pts: [0, 0, 50] });

function rig(serverInk: NotebookInk[] = [], blocks: NotebookBlock[] = [{ id: "t1", kind: "text", md: "Hello world" }]) {
  let now = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let next = 1;
  const run = async (ms: number) => {
    now += ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      due[1].fn();
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  let state: NbState = { status: "ready", pages: [{ id: "p1", title: "P", style: "plain", position: 1, blocks, rev: 1, saved: true }], openId: "p1", save: "idle", error: "", quoted: new Set() };
  const listeners = new Set<() => void>();
  const kept: string[] = [];
  const host: InkHost = { docId: "d1", get: () => state, subscribe: (l) => (listeners.add(l), () => listeners.delete(l)), serverInk: () => serverInk, keep: (id) => void kept.push(id) };
  const setBlocks = (b: NotebookBlock[]) => {
    state = { ...state, pages: [{ ...state.pages[0]!, blocks: b }] };
    listeners.forEach((l) => l());
  };
  const sent: { rev: number; strokes: NoteStroke[] }[] = [];
  let answer: (body: { rev: number; strokes: NoteStroke[] }) => Response = (b) => new Response(JSON.stringify({ ink: { pageId: "p1", rev: b.rev + 1, strokes: b.strokes, updatedAt: 0 } }), { status: 200 });
  const notices: string[] = [];
  const store = createNoteInkStore(
    host,
    {
      fetch: async (_u, init) => {
        const body = JSON.parse(String(init?.body)) as { rev: number; strokes: NoteStroke[] };
        sent.push(body);
        return answer(body);
      },
      idb: { get: async () => null, set: async () => true, delete: async () => true },
      timers: { set: (fn, ms) => (timers.set(next, { at: now + ms, fn }), next++), clear: (id) => void timers.delete(id) },
      notice: (s) => void notices.push(s),
    },
    (_p, b) => setBlocks(b),
  );
  return { store, run, sent, setBlocks, notices, kept, setAnswer: (f: typeof answer) => (answer = f), setState: (f: (s: NbState) => NbState) => ((state = f(state)), listeners.forEach((l) => l())) };
}

describe("the ink store", () => {
  it("live updates: another person's newer drawing comes in on a page not drawn on here; a page drawn on here keeps its strokes for its save", async () => {
    const server: NotebookInk[] = [{ pageId: "p1", strokes: [stroke("a")], rev: 3, updatedAt: 0 }];
    const r = rig(server);
    await r.store.load();
    server[0] = { pageId: "p1", strokes: [stroke("a"), stroke("theirs")], rev: 4, updatedAt: 0 };
    r.store.takeServer();
    expect(r.store.strokes("p1").map((s) => s.id)).toEqual(["a", "theirs"]);
    r.store.commit("p1", [stroke("mine")], []);
    server[0] = { pageId: "p1", strokes: [stroke("a"), stroke("theirs"), stroke("later")], rev: 5, updatedAt: 0 };
    r.store.takeServer();
    expect(r.store.strokes("p1").map((s) => s.id)).toEqual(["a", "theirs", "mine"]);
  });

  it("saves a page's strokes a moment after the last change, with the revision it started from", async () => {
    const r = rig([{ pageId: "p1", strokes: [stroke("a")], rev: 3, updatedAt: 0 }]);
    await r.store.load();
    expect(r.store.strokes("p1").map((s) => s.id)).toEqual(["a"]);
    r.store.commit("p1", [stroke("b")], []);
    await r.run(INK_SAVE_AFTER_MS - 1);
    expect(r.sent).toEqual([]);
    await r.run(1);
    expect(r.sent).toEqual([{ rev: 3, strokes: [stroke("a"), stroke("b")] }]);
  });
  it("Undo and Redo: a step of strokes added and erased, and the blocks it changed", async () => {
    const r = rig();
    await r.store.load();
    const before: NotebookBlock[] = [{ id: "t1", kind: "text", md: "Hello world" }];
    const after: NotebookBlock[] = [...before, { id: "sp", kind: "space", h: 900 }];
    r.setBlocks(after);
    r.store.commit("p1", [stroke("s", "sp")], [], { before, after });
    r.store.commit("p1", [stroke("x")], []);
    r.store.commit("p1", [], ["x"]);
    expect(r.store.strokes("p1").map((s) => s.id)).toEqual(["s"]);
    r.store.undo("p1");
    expect(r.store.strokes("p1").map((s) => s.id)).toEqual(["s", "x"]);
    r.store.undo("p1");
    r.store.undo("p1");
    expect(r.store.strokes("p1")).toEqual([]);
    expect(r.store.canUndo("p1")).toBe(false);
    r.store.redo("p1");
    expect(r.store.strokes("p1").map((s) => s.id)).toEqual(["s"]);
  });
  it("409: the server's strokes merged with this window's by stroke id", async () => {
    const r = rig([{ pageId: "p1", strokes: [stroke("a")], rev: 1, updatedAt: 0 }]);
    await r.store.load();
    r.setAnswer((b) =>
      b.rev === 1
        ? new Response(JSON.stringify({ ink: { pageId: "p1", rev: 2, strokes: [stroke("a"), stroke("there")], updatedAt: 0 } }), { status: 409 })
        : new Response(JSON.stringify({ ink: { pageId: "p1", rev: b.rev + 1, strokes: b.strokes, updatedAt: 0 } }), { status: 200 }),
    );
    r.store.commit("p1", [stroke("here")], []);
    await r.run(INK_SAVE_AFTER_MS);
    await r.run(300);
    expect(r.store.strokes("p1").map((s) => s.id)).toEqual(["a", "there", "here"]);
    expect(r.sent.at(-1)).toEqual({ rev: 2, strokes: [stroke("a"), stroke("there"), stroke("here")] });
  });
  it("a block deleted takes its strokes; its Undo brings them back", async () => {
    const r = rig([{ pageId: "p1", strokes: [stroke("a"), stroke("b", "t2")], rev: 1, updatedAt: 0 }], [{ id: "t1", kind: "text", md: "Hello world" }, { id: "t2", kind: "text", md: "Second" }]);
    await r.store.load();
    const back = r.store.dropBlock("p1", "t1");
    r.setBlocks([{ id: "t2", kind: "text", md: "Second" }]);
    expect(r.store.strokes("p1").map((s) => s.id)).toEqual(["b"]);
    expect(r.notices).toEqual([]);
    r.setBlocks([{ id: "t1", kind: "text", md: "Hello world" }, { id: "t2", kind: "text", md: "Second" }]);
    back();
    expect(r.store.strokes("p1").map((s) => s.id)).toEqual(["a", "b"]);
  });
  it("text typed before a stroke's word carries its anchor; a block gone elsewhere moves its strokes and says so", async () => {
    const r = rig([{ pageId: "p1", strokes: [stroke("a", "t2", 3)], rev: 1, updatedAt: 0 }], [{ id: "t1", kind: "text", md: "First" }, { id: "t2", kind: "text", md: "Second line" }]);
    await r.store.load();
    r.setBlocks([{ id: "t1", kind: "text", md: "First" }, { id: "t2", kind: "text", md: "New. Second line" }]);
    expect((r.store.strokes("p1")[0]!.a as { at: number }).at).toBe(8);
    r.setBlocks([{ id: "t1", kind: "text", md: "First" }]);
    expect(r.store.strokes("p1")[0]!.a).toMatchObject({ k: "text", b: "t1" });
    expect(r.notices).toEqual(["Some drawing moved: its text was deleted in another window."]);
  });
  it("a page not on the server yet: its ink waits, and the starter page is kept so it is made", async () => {
    const r = rig();
    await r.store.load();
    r.setState((s) => ({ ...s, pages: [{ ...s.pages[0]!, saved: false }] }));
    r.store.commit("p1", [stroke("a")], []);
    await r.run(INK_SAVE_AFTER_MS);
    expect(r.sent).toEqual([]);
    expect(r.kept).toEqual(["p1"]);
    r.setState((s) => ({ ...s, pages: [{ ...s.pages[0]!, saved: true }] }));
    await r.run(1500);
    expect(r.sent.length).toBe(1);
  });
});
