import { describe, expect, it } from "vitest";
import { LIVE_CLOSE, type LivePerson } from "@scholar/shared";
import { backoffMs, createLiveClient, liveUrl, type WsLike } from "./live";

/** A clock and timers that run only when told, and sockets the test opens, feeds and closes. */
function world() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const sockets: (WsLike & { sent: string[]; open: () => void; feed: (m: unknown) => void; drop: (code: number) => void })[] = [];
  let hidden = false;
  const deps = {
    socket: () => {
      const s = {
        readyState: 0,
        sent: [] as string[],
        send(d: string) {
          s.sent.push(d);
        },
        close() {
          s.readyState = 3;
        },
        onopen: null as WsLike["onopen"],
        onmessage: null as WsLike["onmessage"],
        onclose: null as WsLike["onclose"],
        onerror: null as WsLike["onerror"],
        open() {
          s.readyState = 1;
          s.onopen?.({});
        },
        feed(m: unknown) {
          s.onmessage?.({ data: JSON.stringify(m) });
        },
        drop(code: number) {
          s.readyState = 3;
          s.onclose?.({ code });
        },
      };
      sockets.push(s);
      return s;
    },
    timers: {
      set: (fn: () => void, ms: number) => (timers.set(next, { at: now + ms, fn }), next++),
      clear: (id: number) => void timers.delete(id),
      now: () => now,
    },
    hidden: () => hidden,
    random: () => 0,
  };
  const tick = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  return { deps, sockets, tick, setHidden: (h: boolean) => (hidden = h) };
}

const person = (id: string, name: string): LivePerson => ({ id, name, initial: name[0]!, colour: 1, role: "editor", view: "paper", page: 3, notesPage: null, editingBlock: null, active: true, idle: false });

describe("the live client (docs/design/paper-live.md)", () => {
  it("builds the socket's address from the page's", () => {
    expect(liveUrl("d1", { protocol: "https:", host: "sodhsetu.in" })).toBe("wss://sodhsetu.in/api/v1/documents/d1/live");
    expect(liveUrl("d1", { protocol: "http:", host: "localhost:8788" })).toBe("ws://localhost:8788/api/v1/documents/d1/live");
  });

  it("says where it is on opening and on a change, and never shows the person themselves", () => {
    const w = world();
    const c = createLiveClient("ws://x", w.deps);
    c.setWhere({ view: "paper", page: 2 });
    c.start();
    const s = w.sockets[0]!;
    s.open();
    expect(JSON.parse(s.sent[0]!)).toEqual({ t: "here", view: "paper", page: 2, active: true, idle: false });
    s.feed({ t: "hello", you: "me", colour: 0, role: "owner" });
    s.feed({ t: "presence", people: [person("me", "Asha"), person("u2", "Ravi")] });
    expect(c.get().people.map((p) => p.id)).toEqual(["u2"]);
    c.setWhere({ view: "paper", page: 2 });
    expect(s.sent).toHaveLength(1);
    c.setWhere({ view: "notes", notesPage: "p1", editingBlock: "b1" });
    expect(JSON.parse(s.sent[1]!)).toMatchObject({ view: "notes", notesPage: "p1", editingBlock: "b1" });
  });

  it("sends a heartbeat every 20 s, and turns idle after 2 minutes of nothing (or a hidden tab)", () => {
    const w = world();
    const c = createLiveClient("ws://x", w.deps);
    c.start();
    const s = w.sockets[0]!;
    s.open();
    w.tick(20_000);
    expect(s.sent.length).toBe(2);
    w.tick(30_000);
    expect(s.sent.some((m) => JSON.parse(m).active === false && JSON.parse(m).idle === false)).toBe(true);
    w.tick(80_000);
    expect(JSON.parse(s.sent.at(-1)!)).toMatchObject({ idle: true, active: false });
    c.touch();
    expect(JSON.parse(s.sent.at(-1)!)).toMatchObject({ idle: false, active: true });
    w.setHidden(true);
    c.visibility();
    expect(JSON.parse(s.sent.at(-1)!)).toMatchObject({ idle: true });
  });

  it("passes changes on, as signals", () => {
    const w = world();
    const got: unknown[] = [];
    const c = createLiveClient("ws://x", w.deps, { onChanged: (x) => got.push(x) });
    c.start();
    w.sockets[0]!.open();
    w.sockets[0]!.feed({ t: "changed", kind: "notebook", id: "p1", rev: 3, by: "u2" });
    w.sockets[0]!.feed({ t: "something-newer" });
    expect(got).toEqual([{ kind: "notebook", id: "p1", rev: 3, by: "u2" }]);
  });

  it("reconnects with a growing wait, shows Reconnecting only after 5 s, and fetches what it missed when back", () => {
    const w = world();
    let back = 0;
    const c = createLiveClient("ws://x", w.deps, { onReconnected: () => back++ });
    c.start();
    w.sockets[0]!.open();
    w.sockets[0]!.drop(1006);
    expect(c.get()).toMatchObject({ status: "reconnecting", line: false });
    w.tick(1000);
    expect(w.sockets).toHaveLength(2);
    w.sockets[1]!.drop(1006);
    w.tick(1999);
    expect(w.sockets).toHaveLength(2);
    w.tick(1);
    expect(w.sockets).toHaveLength(3);
    expect(c.get().line).toBe(false);
    w.sockets[2]!.drop(1006);
    w.tick(2100);
    expect(c.get().line).toBe(true);
    w.tick(2000);
    w.sockets.at(-1)!.open();
    expect(c.get()).toMatchObject({ status: "open", line: false });
    expect(back).toBe(1);
    expect([1, 2, 3, 4, 5, 6, 9].map((n) => backoffMs(n, () => 0))).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it("a quick drop and return never shows the line", () => {
    const w = world();
    const c = createLiveClient("ws://x", w.deps);
    c.start();
    w.sockets[0]!.open();
    w.sockets[0]!.drop(1006);
    w.tick(1000);
    w.sockets[1]!.open();
    w.tick(10_000);
    expect(c.get().line).toBe(false);
  });

  it("4403: stops and asks the reader to check; 4001: straight back in", () => {
    const w = world();
    let ended = 0;
    const c = createLiveClient("ws://x", w.deps, { onAccessEnded: () => ended++ });
    c.start();
    w.sockets[0]!.open();
    w.sockets[0]!.drop(LIVE_CLOSE.reconnect);
    w.tick(0);
    expect(w.sockets).toHaveLength(2);
    w.sockets[1]!.open();
    w.sockets[1]!.drop(LIVE_CLOSE.noAccess);
    w.tick(60_000);
    expect(w.sockets).toHaveLength(2);
    expect(c.get().status).toBe("noaccess");
    expect(ended).toBe(1);
    c.restart();
    expect(w.sockets).toHaveLength(3);
  });

  it("sends the caret with the block typed in, at most every 120 ms, the last place always", () => {
    const w = world();
    const c = createLiveClient("ws://x", w.deps);
    c.start();
    const s = w.sockets[0]!;
    s.open();
    const last = () => JSON.parse(s.sent[s.sent.length - 1]!);
    // a caret for a block not (yet) said is not sent
    c.setCaret("b1", 4);
    expect(last()).not.toHaveProperty("caret");
    c.setWhere({ view: "notes", notesPage: "p1", editingBlock: "b1" });
    expect(last()).toMatchObject({ editingBlock: "b1", caret: 4 });
    const n = s.sent.length;
    w.tick(50);
    c.setCaret("b1", 5);
    c.setCaret("b1", 6);
    c.setCaret("b1", 7, 12);
    expect(s.sent.length).toBe(n);
    w.tick(80);
    expect(s.sent.length).toBe(n + 1);
    expect(last()).toMatchObject({ caret: 7, caretEnd: 12 });
    // kept inside a block's length; an empty selection is a caret
    w.tick(200);
    c.setCaret("b1", 99_999, 99_999);
    expect(last()).toMatchObject({ caret: 8000 });
    expect(last()).not.toHaveProperty("caretEnd");
    // another block: no caret until its own comes
    c.setWhere({ view: "notes", notesPage: "p1", editingBlock: "b2" });
    expect(last()).not.toHaveProperty("caret");
    c.setWhere({ view: "paper", page: 1 });
    expect(last()).not.toHaveProperty("caret");
    c.stop();
  });

  it("stop closes the socket and tries nothing more", () => {
    const w = world();
    const c = createLiveClient("ws://x", w.deps);
    c.start();
    w.sockets[0]!.open();
    c.stop();
    w.tick(60_000);
    expect(w.sockets).toHaveLength(1);
    expect(w.sockets[0]!.readyState).toBe(3);
  });
});
