import { beforeEach, describe, expect, it, vi } from "vitest";
import { startAssistant, type AssistantMsg, type ChatMsg, type Paper } from "@scholar/shared";

/**
 * The page's own store of conversations (apps/web/src/lib/chat.ts), run in node against a fake localStorage, a fake IndexedDB and a fake network. The store is one module with state of its own and
 * no React in it besides `useSyncExternalStore`, so it is loaded the way the page loads it; only the browser's storage and the network are stood in for. Every case here is a failure that was found
 * in review and that no pure function could show: the whole path from a press to what is kept, what is sent and what is left on the screen. (The real IndexedDB, the real focus and the real
 * layout are checked in the browser suite, apps/web/e2e/chat.mjs.)
 *
 * The module is loaded by a path that is not a literal, so that this workspace's type check (no DOM) does not follow it into the web workspace.
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
  useChatState: () => { index: { id: string; title: string; updatedAt: number; owner?: string; kw?: string }[]; active: string | null; chats: ReadonlyMap<string, ChatMsg[]>; running: ReadonlySet<string>; from: ReadonlyMap<string, { source: string; title: string }>; privateChats: ReadonlySet<string>; pendingPrivate: boolean; kept: boolean };
  setChatOwner: (o: string | null) => void;
  sendMessage: (text: string, mode?: "search" | "auto", scope?: "all" | "india") => string;
  retryReply: (id: string, as?: "search" | "anyway", words?: string, earlier?: { question: string; searchQuery?: string }[]) => string;
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
const chatBodies = () => net.calls.filter((c) => c.url === "/api/v1/chat").map((c) => c.body);
const stored = <T = unknown>(id: string): T | undefined => fake.records.get(`chats/${id}`) as T | undefined;
const listed = (): { id: string; owner?: string }[] => JSON.parse(local.getItem("scholar.chats.v1") ?? "[]");
const user = (id: string, text: string): ChatMsg => ({ id, role: "user", text, at: 1 });
const reply = (id: string, over: Partial<AssistantMsg> = {}): AssistantMsg => ({ ...startAssistant(id, "a question", 2), status: "done", step: null, papersFinal: true, ...over });
/** A chat kept earlier: its entry in the list and its record. */
function seed(id: string, title: string, messages: ChatMsg[], entry: Record<string, unknown> = {}, rev?: number) {
  const list = JSON.parse(local.getItem("scholar.chats.v1") ?? "[]");
  list.push({ id, title, updatedAt: Date.now() - list.length * 1000, ...entry });
  local.setItem("scholar.chats.v1", JSON.stringify(list));
  fake.records.set(`chats/${id}`, { id, messages, ...(rev === undefined ? {} : { rev }) });
}
/** A finished answer from two papers that can be checked strictly. */
const answered = (id: string): AssistantMsg =>
  reply(id, {
    query: "metformin hba1c",
    papers: [paper("p1"), paper("p2")],
    answer: {
      text: "Metformin lowered HbA1c in adults [1].",
      grounded: true,
      checked: true,
      leftOut: 0,
      citations: [{ n: 1, paperId: "p1", sentenceNo: 2, sentence: "Second sentence says metformin lowered HbA1c in adults." }],
    },
  });
const TIGHT = { changed: false, answer: { text: "Metformin lowered HbA1c in adults [1].", grounded: true, checked: true, strict: true, leftOut: 0, citations: [{ n: 1, paperId: "x", sentenceNo: 2, sentence: "Second sentence says metformin lowered HbA1c in adults." }] } };
const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });

/* ================================================================ whose chats they are */

describe("a session that ends does not delete anybody's chats", () => {
  it("nobody signed in: the chats of the person who was stay in the browser, are not shown or drawn on, and come back when the same person signs in; another person removes them", async () => {
    const t = await openTab();
    t.lib.setChatOwner("u1");
    t.lib.sendMessage("glaucoma screening", "search");
    await idle(t);
    const id = t.st().index[0]!.id;
    expect(listed()).toEqual([expect.objectContaining({ id, owner: "u1" })]);
    expect(stored(id)).toBeDefined();

    t.lib.setChatOwner(null); // the cookie ran out: the page asked and nobody is there
    expect(listed().map((e) => e.id)).toEqual([id]);
    expect(stored(id)).toBeDefined();
    expect(t.st().index).toEqual([]);
    expect(t.st().active).toBeNull();
    expect(t.st().chats.size).toBe(0);

    t.lib.setChatOwner("u1"); // the same person signs in again
    expect(t.st().index.map((e) => e.id)).toEqual([id]);
    await t.lib.openChat(id);
    expect(t.st().chats.get(id)).toHaveLength(2);

    t.lib.setChatOwner("u2"); // somebody else: that is the shared-computer case
    expect(t.st().index).toEqual([]);
    expect(listed()).toEqual([]);
    expect(stored(id)).toBeUndefined();
  });

  it("a visitor who makes a chat while the owned ones are kept does not lose them: the list is written whole", async () => {
    seed("mine", "diabetes in children", [user("u", "diabetes in children"), reply("a")], { owner: "u1" });
    const t = await openTab();
    t.lib.setChatOwner(null);
    expect(t.st().index).toEqual([]);
    t.lib.sendMessage("glaucoma screening", "search");
    await idle(t);
    expect(listed().map((e) => e.id).sort()).toEqual([t.st().index[0]!.id, "mine"].sort());
    expect(stored("mine")).toBeDefined();
    expect(t.st().index.map((e) => e.id)).not.toContain("mine");
  });

  it("a held chat is never offered to continue from, and nothing of it is sent, while nobody is signed in", async () => {
    seed("mine", "diabetes in children", [user("u", "diabetes in children"), reply("a")], { owner: "u1", kw: "diabetes children" });
    const t = await openTab();
    t.lib.setChatOwner(null);
    expect(t.lib.continueFromChat("mine")).toBe(false);
    t.lib.sendMessage("and in children?", "auto");
    await idle(t);
    expect(JSON.stringify(chatBodies())).not.toContain("diabetes");
  });

  it("while it is not yet known who is here nothing is removed or hidden", async () => {
    seed("mine", "diabetes in children", [user("u", "diabetes in children"), reply("a")], { owner: "u1" });
    const t = await openTab();
    expect(t.st().index.map((e) => e.id)).toEqual(["mine"]);
  });

  it("a chat kept by a visitor (no owner) is adopted by the first signed-in person who opens it", async () => {
    seed("old", "migraine in children", [user("u", "migraine in children"), reply("a")]);
    const t = await openTab();
    t.lib.setChatOwner("u1");
    await t.lib.openChat("old");
    expect(listed()[0]).toMatchObject({ id: "old", owner: "u1" });
  });

  it("when the list is full, the chats that are held are the ones to go, the oldest first, with their records", async () => {
    for (let i = 0; i < 30; i++) seed(`h${i}`, `held ${i}`, [user("u", `held ${i} words`), reply("a")], { owner: "u1" });
    const t = await openTab();
    t.lib.setChatOwner(null);
    t.lib.sendMessage("glaucoma screening", "search");
    await idle(t);
    const ids = listed().map((e) => e.id);
    expect(ids).toHaveLength(30);
    expect(ids).toContain(t.st().index[0]!.id);
    expect(ids).not.toContain("h29");
    expect(stored("h29")).toBeUndefined();
    expect(stored("h0")).toBeDefined();
  });
});

describe("explicit sign-out", () => {
  it("clears every chat and its record, and leaves nothing marked behind", async () => {
    const t = await openTab();
    t.lib.setChatOwner("u1");
    t.lib.sendMessage("glaucoma screening", "search");
    await idle(t);
    t.lib.beginWipe();
    expect(local.getItem("scholar.wipe")).toBe("1");
    await t.lib.clearChats();
    expect(local.getItem("scholar.wipe")).toBeNull();
    expect(listed()).toEqual([]);
    expect([...fake.records.keys()].filter((x) => x.startsWith("chats/"))).toEqual([]);
  });

  it("a page that finds the mark (the tab was closed in the middle of a sign-out) finishes the job on load", async () => {
    seed("mine", "diabetes in children", [user("u", "diabetes in children"), reply("a")], { owner: "u1" });
    local.setItem("scholar.wipe", "1");
    const t = await openTab();
    await vi.waitFor(() => expect(stored("mine")).toBeUndefined());
    expect(listed()).toEqual([]);
    expect(local.getItem("scholar.wipe")).toBeNull();
    expect(t.st().index).toEqual([]);
  });
});

/* ================================================================ what leaves the device */

describe("a visitor sends no earlier messages at all", () => {
  const follow = async (owner: string | null | undefined) => {
    const t = await openTab();
    if (owner !== undefined) t.lib.setChatOwner(owner);
    net.chat = () => finish([paper("p1")], []);
    t.lib.sendMessage("glaucoma screening", "auto");
    await idle(t);
    t.lib.sendMessage("only after 2020", "auto");
    await idle(t);
    return chatBodies();
  };

  it("not signed in: the second message is exactly the message", async () => {
    const bodies = await follow(null);
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[1])).toBe('{"mode":"auto","message":"only after 2020"}');
  });

  it("not yet known who is here: nothing is sent either (less, never more)", async () => {
    const bodies = await follow(undefined);
    expect(JSON.stringify(bodies[1])).toBe('{"mode":"auto","message":"only after 2020"}');
  });

  it("signed in: the earlier turn goes with it", async () => {
    const bodies = await follow("u1");
    expect(Object.keys(bodies[1]!).join()).toBe("mode,message,history");
  });

  it("a visitor's Search again on an older reply sends no history either", async () => {
    const t = await openTab();
    t.lib.sendMessage("glaucoma screening", "auto");
    await idle(t);
    t.lib.sendMessage("only after 2020", "auto");
    await idle(t);
    const second = [...t.st().chats.values()][0]!.filter((m) => m.role === "assistant")[1]!;
    t.lib.retryReply(second.id);
    await idle(t);
    expect(JSON.stringify(chatBodies()[2])).toBe('{"mode":"auto","message":"only after 2020"}');
  });
});

/* ================================================================ Check strictly and Search again */

describe("Search again while Check strictly runs", () => {
  /** A strict check that is under way on a finished answer, and the way to answer it. */
  async function strictUnderWay(honoursAbort: boolean) {
    seed("c1", "metformin", [user("u1", "metformin hba1c"), answered("r1")], { owner: "u" });
    const t = await openTab();
    t.lib.setChatOwner("u");
    await t.lib.openChat("c1");
    let answer: (r: Response) => void = () => {};
    let aborted = false;
    net.tighten = (_b, signal) =>
      new Promise<Response>((resolve, reject) => {
        answer = resolve;
        signal?.addEventListener("abort", () => {
          aborted = true;
          if (honoursAbort) reject(new DOMException("aborted", "AbortError"));
        });
      });
    const strict = t.lib.tightenReply("r1");
    await vi.waitFor(() => expect(net.calls.some((c) => c.url.endsWith("/tighten"))).toBe(true));
    return { t, strict, answer: (r: Response) => answer(r), wasAborted: () => aborted };
  }
  const theReply = (t: Tab) => t.st().chats.get("c1")!.find((m) => m.id === "r1") as AssistantMsg;

  it("the new reply is not given the old strict answer (the papers differ)", async () => {
    const x = await strictUnderWay(true);
    net.chat = () => finish([paper("q9", "A paper about smoking"), paper("p1")]);
    expect(x.t.lib.retryReply("r1")).toBe("sent");
    await idle(x.t);
    x.answer(json(TIGHT));
    await x.strict;
    const r = theReply(x.t);
    expect(r.papers.map((p) => p.id)).toEqual(["q9", "p1"]);
    expect(r.answer).toBeNull();
    expect(r.strict).toBeUndefined();
    expect(x.wasAborted()).toBe(true);
  });

  it("even when the strict answer still arrives (it was not stopped in time), it changes nothing of the new reply", async () => {
    const x = await strictUnderWay(false);
    net.chat = () => finish([paper("q9", "A paper about smoking"), paper("p1")]);
    x.t.lib.retryReply("r1");
    await idle(x.t);
    x.answer(json(TIGHT));
    await x.strict;
    const r = theReply(x.t);
    expect(r.answer).toBeNull();
    expect(r.strict).toBeUndefined();
    expect(r.status).toBe("done");
  });

  it("a strict answer that arrives while the new reply is still being written does not mark it failed", async () => {
    const x = await strictUnderWay(false);
    let release: () => void = () => {};
    net.chat = () => new Promise<Response>((resolve) => (release = () => resolve(finish([paper("q9")]))));
    x.t.lib.retryReply("r1");
    x.answer(new Response("not json", { status: 200 }));
    await x.strict;
    expect(theReply(x.t).strict).toBeUndefined();
    release();
    await idle(x.t);
  });
});

/* ================================================================ a chat that could not be read */

describe("a read of a chat that fails", () => {
  const four = (): ChatMsg[] => [user("u1", "cardiovascular metformin"), reply("a1"), user("u2", "type 2 diabetes"), reply("a2")];

  it("does not open it as an empty chat, says so, and the next send in another chat cannot overwrite it", async () => {
    seed("c1", "cardiovascular metformin", four(), { owner: "u", kw: "cardiovascular metformin diabetes" }, 3);
    const t = await openTab();
    t.lib.setChatOwner("u");
    fake.failReads = 1;
    await t.lib.openChat("c1");
    expect(t.st().chats.has("c1")).toBe(false);
    expect(t.st().active).toBeNull();
    expect(notices.join(" ")).toMatch(/could not be read/i);
    t.lib.sendMessage("glaucoma screening", "search");
    await idle(t);
    const rec = stored<{ messages: ChatMsg[]; rev: number }>("c1")!;
    expect(rec.messages).toHaveLength(4);
    expect(rec.rev).toBe(3);
    expect(listed().find((e) => e.id === "c1")).toMatchObject({ kw: "cardiovascular metformin diabetes" });
  });

  it("the next open tries again and gets the chat", async () => {
    seed("c1", "cardiovascular metformin", four(), { owner: "u" }, 3);
    const t = await openTab();
    t.lib.setChatOwner("u");
    fake.failReads = 1;
    await t.lib.openChat("c1");
    await t.lib.openChat("c1");
    expect(t.st().chats.get("c1")).toHaveLength(4);
    expect(t.st().active).toBe("c1");
  });

  it("a chat whose record is simply not there opens empty, as before (nothing is lost by writing it)", async () => {
    seed("c1", "cardiovascular metformin", four(), { owner: "u" });
    fake.records.delete("chats/c1");
    const t = await openTab();
    t.lib.setChatOwner("u");
    await t.lib.openChat("c1");
    expect(t.st().chats.get("c1")).toEqual([]);
  });
});

/* ================================================================ two tabs */

describe("two tabs", () => {
  it("a tab that was left behind does not write its old copy over what the other tab saved", async () => {
    seed("c1", "metformin", [user("u1", "metformin hba1c"), answered("r1")], { owner: "u" }, 1);
    const one = await openTab();
    one.lib.setChatOwner("u");
    await one.lib.openChat("c1");
    const two = await openTab();
    two.lib.setChatOwner("u");
    await two.lib.openChat("c1");
    expect(two.lib.editMessage("u1", "metformin hba1c in elderly")).toBe("sent");
    await idle(two);
    const afterEdit = stored<{ messages: ChatMsg[]; rev: number }>("c1")!;
    expect((afterEdit.messages[0] as { versions?: unknown[] }).versions).toHaveLength(2);
    // the first tab, still holding the old copy, does something that is saved
    notices.length = 0;
    await new Promise((r) => setTimeout(r, 1000)); // (the other tab's own saves, including the one after its answer, are done)
    const writesBefore = fake.writes.length;
    one.lib.sendMessage("another question about it", "search");
    await idle(one);
    await new Promise((r) => setTimeout(r, 1000)); // (a save that waits its 800 ms has had its time)
    // and it writes nothing at all: not its old copy, and not the other tab's copy back again with a revision of its own (which would make the other tab, in turn, the one that is behind)
    expect(fake.writes.length).toBe(writesBefore);
    const rec = stored<{ messages: ChatMsg[]; rev: number }>("c1")!;
    expect((rec.messages[0] as { text: string; versions?: unknown[] }).versions).toHaveLength(2);
    expect((rec.messages[0] as { text: string }).text).toBe("metformin hba1c in elderly");
    expect(rec.messages.some((m) => m.role === "user" && m.text === "another question about it")).toBe(false);
    expect(notices.join(" ")).toMatch(/another tab/i);
    // and what that tab shows is what is kept
    expect((one.st().chats.get("c1")![0] as { text: string }).text).toBe("metformin hba1c in elderly");
  });

  it("a tab that is brought back to the front takes up what the other tab saved, without a word", async () => {
    seed("c1", "metformin", [user("u1", "metformin hba1c"), answered("r1")], { owner: "u" }, 1);
    const one = await openTab();
    one.lib.setChatOwner("u");
    await one.lib.openChat("c1");
    const two = await openTab();
    two.lib.setChatOwner("u");
    await two.lib.openChat("c1");
    two.lib.editMessage("u1", "metformin hba1c in elderly");
    await idle(two);
    notices.length = 0;
    one.doc.visibilityState = "visible";
    one.doc.fire("visibilitychange");
    await vi.waitFor(() => expect((one.st().chats.get("c1")![0] as { text: string }).text).toBe("metformin hba1c in elderly"));
    expect(notices).toEqual([]);
  });

  it("a chat held in memory is checked against what is kept when it is opened again", async () => {
    seed("c1", "metformin", [user("u1", "metformin hba1c"), answered("r1")], { owner: "u" }, 1);
    seed("c2", "other", [user("u3", "other topic words"), reply("r3")], { owner: "u" }, 1);
    const one = await openTab();
    one.lib.setChatOwner("u");
    await one.lib.openChat("c1");
    await one.lib.openChat("c2");
    const two = await openTab();
    two.lib.setChatOwner("u");
    await two.lib.openChat("c1");
    two.lib.editMessage("u1", "metformin hba1c in elderly");
    await idle(two);
    await one.lib.openChat("c1");
    await vi.waitFor(() => expect((one.st().chats.get("c1")![0] as { text: string }).text).toBe("metformin hba1c in elderly"));
  });

  it("a stale tab of the first person does not drop the second person's chats from the list when it writes", async () => {
    const one = await openTab();
    one.lib.setChatOwner("A");
    const two = await openTab();
    two.lib.setChatOwner("B"); // the second tab is now somebody else's (the first did not hear of it)
    two.lib.sendMessage("quokka habitat research", "search");
    await idle(two);
    const bId = two.st().index[0]!.id;
    one.lib.sendMessage("glaucoma screening", "search");
    await idle(one);
    expect(listed().map((e) => e.id)).toContain(bId);
    expect(listed()).toHaveLength(2);
    expect(stored(bId)).toBeDefined();
  });
});

/* ================================================================ a private chat, a chip, and leaving the page */

describe("a private chat", () => {
  it("is not let go of by going to another page and coming back", async () => {
    const t = await openTab();
    t.lib.startPrivateChat();
    let release: () => void = () => {};
    net.chat = () => new Promise<Response>((resolve) => (release = () => resolve(finish())));
    t.lib.sendMessage("a question that is private", "search");
    const id = t.st().active!;
    expect(t.st().privateChats.has(id)).toBe(true);
    await vi.waitFor(() => expect(net.calls.length).toBe(1)); // the request is on its way
    t.lib.resumeChat(); // Home mounts again after another page
    expect(t.st().active).toBe(id);
    expect(t.st().chats.get(id)).toHaveLength(2);
    expect(t.st().running.has(id)).toBe(true);
    release();
    await idle(t);
    expect(t.st().chats.get(id)![1]).toMatchObject({ status: "done" });
    expect(listed()).toEqual([]);
  });

  it("a private id left over from before a reload is still dropped", async () => {
    session.setItem("scholar.chat.active", "gone");
    const t = await openTab();
    t.lib.resumeChat();
    expect(t.st().active).toBeNull();
  });
});

describe("a choice made for the next chat", () => {
  it("'private chat' does not survive opening another chat, and deleting that one does not bring it back", async () => {
    seed("x", "diabetes in children", [user("u", "diabetes in children"), reply("a")], { owner: "u" });
    const t = await openTab();
    t.lib.setChatOwner("u");
    t.lib.startPrivateChat();
    expect(t.st().pendingPrivate).toBe(true);
    await t.lib.openChat("x");
    expect(t.st().pendingPrivate).toBe(false);
    t.lib.deleteChat("x");
    t.lib.sendMessage("glaucoma screening", "search");
    await idle(t);
    expect(t.st().index).toHaveLength(1);
    expect(listed()).toHaveLength(1);
  });

  it("'continuing from' does not survive opening another chat either", async () => {
    seed("x", "diabetes in children", [user("u", "diabetes in children"), reply("a")], { owner: "u" });
    seed("y", "asthma in children", [user("u2", "asthma in children"), reply("b")], { owner: "u" });
    const t = await openTab();
    t.lib.setChatOwner("u");
    expect(t.lib.continueFromChat("x")).toBe(true);
    expect(t.st().from.size).toBe(1);
    await t.lib.openChat("y");
    expect(t.st().from.size).toBe(0);
    t.lib.deleteChat("y");
    t.lib.sendMessage("and in men?", "auto");
    await idle(t);
    expect(chatBodies().every((b) => !("earlier" in b))).toBe(true);
  });
});

/* ================================================================ Search again after Remove */

describe("what an answer is asked again with from other chats", () => {
  const withTwoEarlier = async () => {
    seed("s1", "diabetes in children", [user("a", "diabetes in children"), reply("b", { query: "diabetes in children" })], { owner: "u", kw: "diabetes children" });
    seed("s2", "asthma in children", [user("c", "asthma in children"), reply("d", { query: "asthma in children" })], { owner: "u", kw: "asthma children" });
    local.setItem("scholar.earlier", "u");
    const t = await openTab();
    t.lib.setChatOwner("u");
    net.chat = () => finish([paper("p1")], []);
    t.lib.startNewChat();
    t.lib.sendMessage("and in children?", "auto");
    await idle(t);
    const first = chatBodies()[0]!;
    expect((first.earlier as unknown[]).length).toBe(2);
    const replyId = () => (t.st().chats.get(t.st().active!)!.find((m) => m.role === "assistant") as AssistantMsg).id;
    return { t, replyId, first };
  };

  it("after Remove, Search again with the switch turned off sends nothing of other chats", async () => {
    const { t, replyId } = await withTwoEarlier();
    t.lib.retryReply(replyId(), undefined, undefined, [{ question: "asthma in children" }]);
    await idle(t);
    expect((chatBodies()[1]!.earlier as unknown[]).length).toBe(1);
    local.removeItem("scholar.earlier"); // the person turned the switch off in Settings
    t.lib.retryReply(replyId());
    await idle(t);
    expect(chatBodies()[2]).not.toHaveProperty("earlier");
  });

  it("after Remove, pressing Remove again with the switch off sends nothing either", async () => {
    const { t, replyId } = await withTwoEarlier();
    local.removeItem("scholar.earlier");
    t.lib.retryReply(replyId(), undefined, undefined, [{ question: "asthma in children" }]);
    await idle(t);
    expect(chatBodies()[1]).not.toHaveProperty("earlier");
  });

  it("after Remove, Search again with the switch on sends only what is left, never the one that was removed", async () => {
    const { t, replyId } = await withTwoEarlier();
    t.lib.retryReply(replyId(), undefined, undefined, [{ question: "asthma in children" }]);
    await idle(t);
    t.lib.retryReply(replyId());
    await idle(t);
    expect(chatBodies()[2]!.earlier).toEqual([{ question: "asthma in children" }]);
  });

  it("after Remove, Search again when the chat the question came from is gone sends nothing of it", async () => {
    const { t, replyId } = await withTwoEarlier();
    t.lib.retryReply(replyId(), undefined, undefined, [{ question: "asthma in children" }]);
    await idle(t);
    t.lib.deleteChat("s2");
    t.lib.retryReply(replyId());
    await idle(t);
    expect(chatBodies()[2]).not.toHaveProperty("earlier");
    expect(JSON.stringify(chatBodies()[2])).not.toContain("asthma");
  });
});
