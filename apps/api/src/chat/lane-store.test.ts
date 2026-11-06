import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ChatMsg, type Paper } from "@scholar/shared";

/**
 * R4, the store rule of the safety lane (docs/design/intent-and-state.md, 4.5, "What the chat remembers of it"), run on the page's own store (apps/web/src/lib/chat.ts) the way web-store.test.ts runs it: in node,
 * against a fake localStorage, a fake IndexedDB and a fake network. A finished reply that is an urgent or a crisis reply must leave no trace of the words on the device: a chat of one message pair is made
 * private at once (its record and its place in the list are taken away and nothing is listed), and in a longer chat the title stays and the words are left out of the words the chat is found by.
 */
const CHAT_PATH = "/@fs" + decodeURIComponent(new URL("../../../web/src/lib/" + "chat.ts", import.meta.url).pathname);

const fake = vi.hoisted(() => ({
  /** "store/key" to what is kept. */
  records: new Map<string, unknown>(),
  /** How many of the next reads fail (the browser's storage said no). */
  failReads: 0,
  /** What was written, in order: "chats/<id>". */
  writes: [] as string[],
}));

vi.mock("../../../web/src/lib/idb", () => {
  const k = (store: string, key: string) => `${store}/${key}`;
  const read = (key: string, store: string): { ok: boolean; value: unknown } => {
    if (fake.failReads > 0) {
      fake.failReads--;
      return { ok: false, value: null };
    }
    const v = fake.records.get(k(store, key));
    return { ok: true, value: v === undefined ? null : structuredClone(v) };
  };
  return {
    idbGet: async (key: string, store = "pendingInk") => read(key, store).value,
    idbRead: async (key: string, store = "pendingInk") => {
      const r = read(key, store);
      return r.ok ? { ok: true, value: r.value } : { ok: false };
    },
    idbSet: async (key: string, value: unknown, store = "pendingInk") => {
      fake.records.set(k(store, key), structuredClone(value));
      fake.writes.push(k(store, key));
      return true;
    },
    // a write that is made only if the record is the one that was read (its `rev` is the one the writer saw)
    idbSwap: async (key: string, make: (rev: number) => unknown, expected: number, store = "pendingInk") => {
      const have = (fake.records.get(k(store, key)) as { rev?: unknown } | undefined)?.rev;
      if ((typeof have === "number" ? have : 0) !== expected) return { status: "conflict" };
      fake.records.set(k(store, key), structuredClone(make(expected + 1)));
      fake.writes.push(k(store, key));
      return { status: "saved", rev: expected + 1 };
    },
    idbDelete: async (key: string, store = "pendingInk") => {
      fake.records.delete(k(store, key));
      return true;
    },
    idbKeys: async (store = "pendingInk") => [...fake.records.keys()].filter((x) => x.startsWith(`${store}/`)).map((x) => x.slice(store.length + 1)),
    idbClear: async (store = "pendingInk") => {
      for (const x of [...fake.records.keys()]) if (x.startsWith(`${store}/`)) fake.records.delete(x);
      return true;
    },
  };
});
vi.mock("react", () => ({ useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get() }));
const notices: string[] = [];
vi.mock("../../../web/src/lib/notice", () => ({ showNotice: (t: string) => notices.push(t), clearNotice: () => {}, useNotice: () => null }));

/* ---------------------------------------------------------------- what the browser gives the page */

type Handlers = Record<string, ((e: unknown) => void)[]>;
const target = () => {
  const handlers: Handlers = {};
  return {
    handlers,
    addEventListener: (type: string, f: (e: unknown) => void) => void (handlers[type] ??= []).push(f),
    removeEventListener: () => {},
    fire: (type: string, e: unknown = {}) => (handlers[type] ?? []).forEach((f) => f(e)),
  };
};
const storage = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() };
};
let local = storage();
let session = storage();
const g = globalThis as unknown as Record<string, unknown>;

type Net = {
  /** Every request, in order: the url and the parsed body. */
  calls: { url: string; body: Record<string, unknown> }[];
  /** What the server says to /api/v1/chat. */
  chat: (body: Record<string, unknown>) => Response | Promise<Response>;
  /** What it says to /api/v1/chat/tighten: a promise the case resolves when it likes. */
  tighten: (body: Record<string, unknown>, signal: AbortSignal | undefined) => Promise<Response>;
};
let net: Net;
const sse = (events: unknown[]) =>
  new Response(
    new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        c.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
const ABSTRACT = "First sentence of the paper is here. Second sentence says metformin lowered HbA1c in adults. Third sentence is a limitation.";
const paper = (id: string, title = `Paper ${id}`): Paper => ({ id, doi: null, pmid: null, title, authors: ["A. B"], year: 2020, venue: "J", abstract: ABSTRACT, citationCount: 1, oaUrl: null, retracted: false, retractionSources: [], sources: ["openalex"], score: 1 });
const understood = (over: Record<string, unknown> = {}) => ({ type: "understood", mode: "search", query: "q", language: "en", auto: true, how: "rules", confidence: 1, ...over });
const finish = (papers: Paper[] = [paper("p1")], extra: unknown[] = []) => sse([understood(), { type: "papers", results: papers, final: true }, ...extra, { type: "done", answered: false, reason: "not_answered", tookMs: 1 }]);

type Lib = {
  useChatState: () => { index: { id: string; title: string; updatedAt: number; owner?: string; kw?: string }[]; active: string | null; chats: ReadonlyMap<string, ChatMsg[]>; running: ReadonlySet<string>; privateChats: ReadonlySet<string>; pendingPrivate: boolean; kept: boolean };
  setChatOwner: (o: string | null) => void;
  sendMessage: (text: string, mode?: "search" | "auto", scope?: "all" | "india") => string;
  retryReply: (id: string, as?: "search" | "anyway", words?: string) => string;
  editMessage: (id: string, text: string) => string;
  tightenReply: (id: string) => Promise<void>;
  openChat: (id: string) => Promise<void>;
  resumeChat: () => void;
  startNewChat: () => void;
  startPrivateChat: () => void;
  continueFromChat: (id: string) => boolean;
  deleteChat: (id: string) => void;
  clearChats: () => Promise<void>;
  beginWipe: () => void;
};
type Tab = { lib: Lib; win: ReturnType<typeof target>; doc: ReturnType<typeof target> & { visibilityState: string }; st: () => ReturnType<Lib["useChatState"]> };

/** A page: the module loaded fresh (its own state), on the browser's storage as it is now. */
async function openTab(): Promise<Tab> {
  vi.resetModules();
  const win = target();
  const doc = Object.assign(target(), { visibilityState: "visible" });
  Object.assign(win, { setTimeout: (...a: Parameters<typeof setTimeout>) => setTimeout(...a), clearTimeout: (t: Parameters<typeof clearTimeout>[0]) => clearTimeout(t) });
  g.window = win;
  g.document = doc;
  const lib = (await import(/* @vite-ignore */ CHAT_PATH)) as Lib;
  return { lib, win, doc, st: () => lib.useChatState() };
}

beforeEach(() => {
  local = storage();
  session = storage();
  fake.records.clear();
  fake.failReads = 0;
  fake.writes.length = 0;
  notices.length = 0;
  g.localStorage = local;
  g.sessionStorage = session;
  g.requestAnimationFrame = (f: () => void) => setTimeout(f, 0);
  g.cancelAnimationFrame = (t: ReturnType<typeof setTimeout>) => clearTimeout(t);
  net = {
    calls: [],
    chat: () => finish(),
    tighten: async () => new Response("{}", { status: 500 }),
  };
  g.fetch = async (url: string, init?: { body?: string; signal?: AbortSignal }) => {
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    net.calls.push({ url, body });
    return url.endsWith("/tighten") ? net.tighten(body, init?.signal) : net.chat(body);
  };
});

const idle = (t: Tab) => vi.waitFor(() => expect(t.st().running.size).toBe(0), { timeout: 3000 });
const stored = <T = unknown>(id: string): T | undefined => fake.records.get(`chats/${id}`) as T | undefined;
const listed = (): { id: string; owner?: string }[] => JSON.parse(local.getItem("scholar.chats.v1") ?? "[]");
const LANE = (reason: "urgent" | "safety", extra: unknown[] = []) => [
  understood(),
  { type: "general", kind: "not_research", text: "If you or someone with you is in danger now, call your local emergency number." },
  ...extra,
  { type: "done", answered: false, reason, tookMs: 1 },
];
const WORDS = "my wife has severe wheezing right now zebrafish";
const quiet = (ms = 1000) => new Promise((r) => setTimeout(r, ms));
const idLeft = (t: Tab) => t.st().active!;

describe("a chat of one message pair that ends urgent or safety leaves no trace on the device", () => {
  for (const reason of ["urgent", "safety"] as const) {
    it(`reason ${reason}: no record, no place in the list, no title, no words; the messages stay on the screen until the chat is left, as a private chat's do`, async () => {
      net.chat = () => sse(LANE(reason));
      const t = await openTab();
      t.lib.setChatOwner("u1");
      expect(t.lib.sendMessage(WORDS, "auto")).toBe("sent");
      await idle(t);
      const id = idLeft(t);
      await quiet(); // past the 800 ms of a delayed save
      expect(stored(id)).toBeUndefined();
      expect(listed()).toEqual([]);
      expect(t.st().index).toEqual([]);
      expect(String(local.getItem("scholar.chats.v1"))).not.toMatch(/wheezing|zebrafish/);
      expect(t.st().privateChats.has(id)).toBe(true);
      expect(t.st().chats.get(id)).toHaveLength(2);
      expect(JSON.stringify([...fake.records.values()])).not.toMatch(/wheezing|zebrafish/);
    });
  }

  it("a second message in that chat is not kept either (it is a private chat from then on)", async () => {
    net.chat = () => sse(LANE("safety"));
    const t = await openTab();
    t.lib.setChatOwner("u1");
    t.lib.sendMessage(WORDS, "auto");
    await idle(t);
    net.chat = () => finish();
    t.lib.sendMessage("glaucoma screening", "search");
    await idle(t);
    await quiet();
    expect(listed()).toEqual([]);
    expect([...fake.records.keys()].filter((k) => k.startsWith("chats/"))).toEqual([]);
  });

  it("leaving it forgets it, as for any private chat; and 'Delete this chat' (deleteChat) removes it at once", async () => {
    net.chat = () => sse(LANE("urgent"));
    const t = await openTab();
    t.lib.setChatOwner("u1");
    t.lib.sendMessage(WORDS, "auto");
    await idle(t);
    const id = idLeft(t);
    t.lib.deleteChat(id);
    expect(t.st().chats.has(id)).toBe(false);
    expect(t.st().active).toBeNull();
    expect(t.st().privateChats.has(id)).toBe(false);
  });

  it("a search chosen by hand whose reply carries the crisis line or the urgent line is a chat of one pair too, and leaves none", async () => {
    for (const kind of ["safety_crisis", "safety_urgent"]) {
      net.chat = () => finish([paper("p1")], [{ type: "notice", kind, text: "If you might hurt yourself, call." }]);
      const t = await openTab();
      t.lib.setChatOwner("u1");
      t.lib.sendMessage(WORDS, "search");
      await idle(t);
      await quiet();
      expect(listed(), kind).toEqual([]);
      expect(t.st().privateChats.has(idLeft(t)), kind).toBe(true);
      fake.records.clear();
      local.clear();
    }
  });
});

describe("in a longer chat the title stays and the words are kept nowhere in the list", () => {
  it("the chat keeps its record and its place in the list, with the title it had; the list holds no words of the message (and no `kw` at all since the earlier-chats feature was removed)", async () => {
    const t = await openTab();
    t.lib.setChatOwner("u1");
    t.lib.sendMessage("glaucoma screening in rural India", "search");
    await idle(t);
    const id = idLeft(t);
    const title = t.st().index.find((e) => e.id === id)!.title;
    net.chat = () => sse(LANE("urgent"));
    t.lib.sendMessage(WORDS, "auto");
    await idle(t);
    await quiet();
    const entry = t.st().index.find((e) => e.id === id)!;
    expect(entry.title).toBe(title);
    expect(entry.kw).toBeUndefined();
    expect(JSON.stringify(listed())).not.toMatch(/wheezing|zebrafish/);
    expect(stored(id)).toBeDefined();
    expect(t.st().privateChats.has(id)).toBe(false);
  });
});

describe("everything else is kept as it was", () => {
  it("a reply that carries only the care line (or the decision line) leaves the chat in the list with its title and its words, as any chat is kept", async () => {
    net.chat = () => finish([paper("p1")], [{ type: "notice", kind: "safety_care", text: "This list is research." }]);
    const t = await openTab();
    t.lib.setChatOwner("u1");
    t.lib.sendMessage("pregnant caffeine miscarriage research", "auto");
    await idle(t);
    await quiet();
    expect(t.st().index).toHaveLength(1);
    expect(t.st().index[0]!.title).toMatch(/pregnant/);
    expect(listed()).toHaveLength(1);
    expect(stored(idLeft(t))).toBeDefined();
    expect(t.st().privateChats.size).toBe(0);
  });

  it("a private chat that was already private stays so, and a chat the person started as private is not touched twice", async () => {
    net.chat = () => sse(LANE("safety"));
    const t = await openTab();
    t.lib.setChatOwner("u1");
    t.lib.startPrivateChat();
    t.lib.sendMessage(WORDS, "auto");
    await idle(t);
    expect(listed()).toEqual([]);
    expect(t.st().privateChats.has(idLeft(t))).toBe(true);
    expect(t.st().chats.get(idLeft(t))).toHaveLength(2);
  });
});
