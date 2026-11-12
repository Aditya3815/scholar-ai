import { beforeEach, describe, expect, it, vi } from "vitest";
import { DID_NOT_FINISH_NOTICE, DID_NOT_FINISH_NOTICE_HINGLISH, startAssistant, type AssistantMsg, type ChatContextInfo, type ChatMsg, type Paper, type UserMsg } from "@scholar/shared";
import { storage, target } from "../test/fake-storage";

/**
 * "New topic" and the line "did not finish" in the page's own store of conversations (apps/web/src/lib/chat.ts), run in node against a fake localStorage and sessionStorage, a fake IndexedDB and a fake network,
 * the way chat-store.test.ts runs it: the whole path from a press to what is kept and what is sent (docs/design/intent-and-state.md, 4.19 R22). The real IndexedDB, the real focus and the real layout are checked in the
 * browser suite (apps/web/e2e/new-topic.mjs).
 */

const fake = vi.hoisted(() => ({ records: new Map<string, unknown>(), writes: [] as string[] }));

vi.mock("./idb", async () => (await import("../test/fake-idb")).fakeIdb(fake));
vi.mock("react", () => ({ useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get() }));
vi.mock("./notice", () => ({ showNotice: () => {}, clearNotice: () => {}, useNotice: () => null }));

let local = storage();
let session = storage();
const g = globalThis as unknown as Record<string, unknown>;

let net: { calls: { url: string; body: Record<string, unknown> }[]; chat: (body: Record<string, unknown>) => Response | Promise<Response> };
const sse = (events: unknown[]) =>
  new Response(new ReadableStream({ start(c) { const enc = new TextEncoder(); for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); c.close(); } }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
const paper = (id: string): Paper => ({ id, doi: null, pmid: null, title: `Paper ${id}`, authors: ["A. B"], year: 2020, venue: "J", abstract: "First sentence is here. Second sentence follows.", citationCount: 1, oaUrl: null, retracted: false, retractionSources: [], sources: ["openalex"], score: 1 });
const understood = (over: Record<string, unknown> = {}) => ({ type: "understood", mode: "search", query: "q", language: "en", auto: true, how: "rules", confidence: 1, ...over });
const finish = (over: Record<string, unknown> = {}) => sse([understood(over), { type: "papers", results: [paper("p1")], final: true }, { type: "done", answered: false, reason: "not_answered", tookMs: 1 }]);
const followed = (over: Partial<ChatContextInfo> = {}, extra: Record<string, unknown> = {}) => finish({ context: { turns: 1, intent: "refine", rewrote: true, question: "glaucoma screening only after 2020", ...over }, ...extra });

type State = { index: { id: string }[]; active: string | null; chats: ReadonlyMap<string, ChatMsg[]>; running: ReadonlySet<string>; newTopic: ReadonlySet<string>; privateChats: ReadonlySet<string> };
type Lib = {
  useChatState: () => State;
  setChatOwner: (o: string | null) => void;
  sendMessage: (text: string, mode?: "search" | "auto", scope?: "all" | "india") => string;
  retryReply: (id: string, as?: "search" | "anyway", words?: string) => string;
  editMessage: (id: string, text: string) => string;
  openChat: (id: string) => Promise<void>;
  startNewChat: () => void;
  startPrivateChat: () => void;
  startNewTopic: () => boolean;
  cancelNewTopic: () => void;
  stopReply: () => void;
  deleteChat: (id: string) => void;
  clearChats: () => Promise<void>;
};
type Tab = { lib: Lib; st: () => State };
async function openTab(): Promise<Tab> {
  vi.resetModules();
  const win = target();
  const doc = Object.assign(target(), { visibilityState: "visible" });
  Object.assign(win, { setTimeout: (...a: Parameters<typeof setTimeout>) => setTimeout(...a), clearTimeout: (t: Parameters<typeof clearTimeout>[0]) => clearTimeout(t) });
  g.window = win;
  g.document = doc;
  const lib = (await import("./chat")) as Lib;
  return { lib, st: () => lib.useChatState() };
}

beforeEach(() => {
  local = storage();
  session = storage();
  fake.records.clear();
  fake.writes.length = 0;
  g.localStorage = local;
  g.sessionStorage = session;
  g.requestAnimationFrame = (f: () => void) => setTimeout(f, 0);
  g.cancelAnimationFrame = (t: ReturnType<typeof setTimeout>) => clearTimeout(t);
  net = { calls: [], chat: () => finish() };
  g.fetch = async (url: string, init?: { body?: string }) => {
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    net.calls.push({ url, body });
    return net.chat(body);
  };
});

const idle = (t: Tab) => vi.waitFor(() => expect(t.st().running.size).toBe(0), { timeout: 3000 });
const bodies = () => net.calls.filter((c) => c.url === "/api/v1/chat").map((c) => c.body);
const raw = (i: number) => JSON.stringify(bodies()[i]);
const stored = (id: string) => fake.records.get(`chats/${id}`) as { messages: ChatMsg[] } | undefined;
const user = (id: string, text: string): UserMsg => ({ id, role: "user", text, at: 1 });
const reply = (id: string, over: Partial<AssistantMsg> = {}): AssistantMsg => ({ ...startAssistant(id, "a question", 2, true), status: "done", step: null, papersFinal: true, papers: [paper("p1")], ...over });
/** A chat kept earlier. `owner` null: a chat with no owner (a visitor's), which every page may open. */
function seed(id: string, title: string, messages: ChatMsg[], owner: string | null = "u1") {
  const list = JSON.parse(local.getItem("scholar.chats.v1") ?? "[]");
  list.push({ id, title, updatedAt: Date.now(), ...(owner === null ? {} : { owner }) });
  local.setItem("scholar.chats.v1", JSON.stringify(list));
  fake.records.set(`chats/${id}`, { id, messages, rev: 1 });
}
/** A signed-in tab with a chat of one finished search in Auto. */
async function withOneSearch(text = "glaucoma screening") {
  const t = await openTab();
  t.lib.setChatOwner("u1");
  t.lib.sendMessage(text, "auto");
  await idle(t);
  return t;
}
const msgsOf = (t: Tab) => t.st().chats.get(t.st().active!)!;
const asks = (b: Record<string, unknown> | undefined) => ((b?.history as { role: string; text?: string }[] | undefined) ?? []).flatMap((e) => (e.role === "user" ? [e.text!] : []));

describe("pressing New topic", () => {
  it("is possible only in a chat that has a finished search", async () => {
    const t = await openTab();
    t.lib.setChatOwner("u1");
    expect(t.lib.startNewTopic()).toBe(false); // no chat at all
    expect(t.st().newTopic.size).toBe(0);
    net.chat = () => new Promise<Response>(() => {}); // a reply that is never finished
    t.lib.sendMessage("glaucoma screening", "auto");
    expect(t.lib.startNewTopic()).toBe(false); // the only search has not finished
    expect(t.st().newTopic.size).toBe(0);
  });

  it("marks the NEXT message, whatever mode it is sent in, and says so once: the pending state is gone after the send", async () => {
    const t = await withOneSearch();
    const id = t.st().active!;
    expect(t.lib.startNewTopic()).toBe(true);
    expect(t.st().newTopic.has(id)).toBe(true);
    expect(t.lib.startNewTopic()).toBe(false); // already pressed
    t.lib.sendMessage("rural clinics only", "auto");
    await idle(t);
    expect(t.st().newTopic.size).toBe(0);
    expect(msgsOf(t).filter((m) => m.role === "user").map((m) => (m as UserMsg).newTopic)).toEqual([undefined, true]);
    expect(stored(id)!.messages.find((m) => m.role === "user" && m.text === "rural clinics only")).toMatchObject({ newTopic: true });
  });

  it("the message after it goes out with no earlier turn at all: exactly the body of a first message", async () => {
    const t = await withOneSearch("glaucoma screening in India");
    t.lib.startNewTopic();
    t.lib.sendMessage("tuberculosis treatment", "auto");
    await idle(t);
    expect(raw(1)).toBe('{"mode":"auto","message":"tuberculosis treatment"}');
    expect(raw(1)).not.toMatch(/glaucoma|history/);
  });

  it("and the next after that leans on the new topic only: the marked turn, and none of the earlier ones", async () => {
    const t = await withOneSearch("glaucoma screening in India");
    t.lib.startNewTopic();
    t.lib.sendMessage("tuberculosis treatment", "auto");
    await idle(t);
    t.lib.sendMessage("only after 2020", "auto");
    await idle(t);
    expect(asks(bodies()[2])).toEqual(["tuberculosis treatment"]);
    expect(Object.keys(bodies()[2]!).join()).toBe("mode,message,history");
    expect(raw(2)).not.toMatch(/glaucoma/);
    // a fourth carries two turns of the new topic, still none of the first
    t.lib.sendMessage("and in children?", "auto");
    await idle(t);
    expect(asks(bodies()[3])).toEqual(["tuberculosis treatment", "only after 2020"]);
  });

  it("the earlier messages stay in the chat (on the page and in the record): they are only not carried", async () => {
    const t = await withOneSearch();
    const id = t.st().active!;
    t.lib.startNewTopic();
    t.lib.sendMessage("tuberculosis treatment", "auto");
    await idle(t);
    expect(msgsOf(t).filter((m) => m.role === "user").map((m) => (m as UserMsg).text)).toEqual(["glaucoma screening", "tuberculosis treatment"]);
    expect(stored(id)!.messages).toHaveLength(4);
  });

  it("cancelling it brings the earlier turns back for the next message (the chip's X)", async () => {
    const t = await withOneSearch();
    t.lib.startNewTopic();
    t.lib.cancelNewTopic();
    expect(t.st().newTopic.size).toBe(0);
    t.lib.sendMessage("only after 2020", "auto");
    await idle(t);
    expect(asks(bodies()[1])).toEqual(["glaucoma screening"]);
    expect(msgsOf(t).some((m) => m.role === "user" && m.newTopic)).toBe(false);
  });

  it("a message sent in Search papers (a search chosen by hand, which never carries history) is marked too, so that a later Auto message does not reach back over it", async () => {
    const t = await withOneSearch("glaucoma screening");
    t.lib.startNewTopic();
    t.lib.sendMessage("tuberculosis treatment", "search");
    await idle(t);
    expect(raw(1)).toBe('{"mode":"search","message":"tuberculosis treatment"}');
    t.lib.sendMessage("only after 2020", "auto");
    await idle(t);
    expect(asks(bodies()[2])).toEqual(["tuberculosis treatment"]);
  });

  it("a visitor still sends nothing: the marker changes only what a signed-in person sends, and never adds", async () => {
    const t = await openTab();
    t.lib.setChatOwner(null);
    t.lib.sendMessage("glaucoma screening", "auto");
    await idle(t);
    expect(t.lib.startNewTopic()).toBe(true);
    t.lib.sendMessage("tuberculosis treatment", "auto");
    await idle(t);
    t.lib.sendMessage("only after 2020", "auto");
    await idle(t);
    for (let i = 0; i < 3; i++) expect(Object.keys(bodies()[i]!).join()).toBe("mode,message");
  });

  it("is kept when the page is reloaded before the message is sent: the person said not to use the earlier messages, and a reload must not bring them back", async () => {
    const t = await withOneSearch("glaucoma screening");
    const id = t.st().active!;
    t.lib.startNewTopic();
    expect(JSON.parse(session.getItem("scholar.chat.topic") ?? "[]")).toEqual([id]);
    const t2 = await openTab(); // the same tab, loaded again: the session's storage is what it was
    t2.lib.setChatOwner("u1");
    expect(t2.st().newTopic.has(id)).toBe(true);
    await t2.lib.openChat(id);
    t2.lib.sendMessage("tuberculosis treatment", "auto");
    await idle(t2);
    expect(raw(1)).toBe('{"mode":"auto","message":"tuberculosis treatment"}');
    expect(JSON.parse(session.getItem("scholar.chat.topic") ?? "[]")).toEqual([]);
  });

  it("is dropped with the chat: deleting the chat, clearing every chat, and a person signing in who is not the owner", async () => {
    const t = await withOneSearch();
    const id = t.st().active!;
    t.lib.startNewTopic();
    t.lib.deleteChat(id);
    expect(t.st().newTopic.size).toBe(0);
    expect(JSON.parse(session.getItem("scholar.chat.topic") ?? "[]")).toEqual([]);

    const t2 = await withOneSearch("diabetic retinopathy");
    t2.lib.startNewTopic();
    await t2.lib.clearChats();
    expect(t2.st().newTopic.size).toBe(0);
    expect(JSON.parse(session.getItem("scholar.chat.topic") ?? "[]")).toEqual([]);

    const t3 = await withOneSearch("asthma in children");
    t3.lib.startNewTopic();
    t3.lib.setChatOwner("u2"); // somebody else is at this browser: the chats of the first person are removed
    expect(t3.st().newTopic.size).toBe(0);
    expect(JSON.parse(session.getItem("scholar.chat.topic") ?? "[]")).toEqual([]);
  });

  it("a storage that will not take it still works for this visit (the page is not broken by a blocked sessionStorage)", async () => {
    const t = await withOneSearch();
    (g.sessionStorage as { setItem: () => void }).setItem = () => {
      throw new Error("blocked");
    };
    expect(t.lib.startNewTopic()).toBe(true);
    t.lib.sendMessage("tuberculosis treatment", "auto");
    await idle(t);
    expect(raw(1)).toBe('{"mode":"auto","message":"tuberculosis treatment"}');
  });

  it("in a private chat it works as in any other: nothing is carried, and still nothing is kept", async () => {
    const t = await openTab();
    t.lib.setChatOwner("u1");
    t.lib.startPrivateChat();
    t.lib.sendMessage("glaucoma screening", "auto");
    await idle(t);
    expect(t.lib.startNewTopic()).toBe(true);
    t.lib.sendMessage("tuberculosis treatment", "auto");
    await idle(t);
    t.lib.sendMessage("only after 2020", "auto");
    await idle(t);
    expect(raw(1)).toBe('{"mode":"auto","message":"tuberculosis treatment"}');
    expect(asks(bodies()[2])).toEqual(["tuberculosis treatment"]);
    expect([...fake.records.keys()].filter((k) => k.startsWith("chats/"))).toEqual([]);
    expect(JSON.parse(local.getItem("scholar.chats.v1") ?? "[]")).toEqual([]);
  });
});

describe("an edit, Search again and a chat that is opened again, with a marker in it", () => {
  /** Three finished searches, the marker on the second message (stored as a chat the person made earlier). */
  const marked = (): ChatMsg[] => [user("u1", "glaucoma screening"), reply("a1", { query: "glaucoma screening" }), { ...user("u2", "tuberculosis treatment"), newTopic: true }, reply("a2", { query: "tuberculosis treatment" }), user("u3", "only after 2020"), reply("a3", { query: "only after 2020" })];

  it("a chat opened again keeps its marker and carries on from it", async () => {
    seed("c1", "glaucoma screening", marked());
    const t = await openTab();
    t.lib.setChatOwner("u1");
    await t.lib.openChat("c1");
    t.lib.sendMessage("and in children?", "auto");
    await idle(t);
    expect(asks(bodies()[0])).toEqual(["tuberculosis treatment", "only after 2020"]);
    expect(raw(0)).not.toMatch(/glaucoma/);
  });

  it("an edit of the message after the marker is sent with the marked turn only", async () => {
    seed("c1", "glaucoma screening", marked());
    const t = await openTab();
    t.lib.setChatOwner("u1");
    await t.lib.openChat("c1");
    t.lib.editMessage("u3", "only after 2021");
    await idle(t);
    expect(asks(bodies()[0])).toEqual(["tuberculosis treatment"]);
    expect(raw(0)).not.toMatch(/glaucoma/);
  });

  it("an edit of the marked message is sent with nothing, and the marker stays on it", async () => {
    seed("c1", "glaucoma screening", marked());
    const t = await openTab();
    t.lib.setChatOwner("u1");
    await t.lib.openChat("c1");
    t.lib.editMessage("u2", "tuberculosis in India");
    await idle(t);
    expect(raw(0)).toBe('{"mode":"auto","message":"tuberculosis in India"}');
    expect(msgsOf(t).find((m) => m.id === "u2")).toMatchObject({ newTopic: true, text: "tuberculosis in India" });
    expect(stored("c1")!.messages.find((m) => m.id === "u2")).toMatchObject({ newTopic: true });
  });

  it("an edit of a message before the marker puts the marker away with the turns after it, and the edited message is sent with nothing", async () => {
    seed("c1", "glaucoma screening", marked());
    const t = await openTab();
    t.lib.setChatOwner("u1");
    await t.lib.openChat("c1");
    t.lib.editMessage("u1", "glaucoma in India");
    await idle(t);
    expect(raw(0)).toBe('{"mode":"auto","message":"glaucoma in India"}');
    expect(msgsOf(t)).toHaveLength(2);
    expect(msgsOf(t).some((m) => m.role === "user" && m.newTopic)).toBe(false);
    // the message after it leans on the edited one only: the marker is not in this version
    t.lib.sendMessage("only after 2020", "auto");
    await idle(t);
    expect(asks(bodies()[1])).toEqual(["glaucoma in India"]);
  });

  it("Search again on the reply to the marked message is sent with nothing; on the reply after it, with the marked turn", async () => {
    seed("c1", "glaucoma screening", marked());
    const t = await openTab();
    t.lib.setChatOwner("u1");
    await t.lib.openChat("c1");
    t.lib.retryReply("a2");
    await idle(t);
    expect(raw(0)).toBe('{"mode":"auto","message":"tuberculosis treatment"}');
    t.lib.retryReply("a3");
    await idle(t);
    expect(asks(bodies()[1])).toEqual(["tuberculosis treatment"]);
  });
});

describe("the line 'did not finish'", () => {
  /** A chat whose second message did not finish (stopped, failed, or found interrupted after a reload). */
  const brokenSecond = (status: "stopped" | "error" | "interrupted" = "stopped"): ChatMsg[] => [user("u1", "glaucoma screening"), reply("a1", { query: "glaucoma screening" }), user("u2", "tuberculosis treatment"), reply("a2", { query: "tuberculosis treatment", status, papers: [] })];
  const notesOf = (t: Tab, id: string) => (msgsOf(t).find((m) => m.id === id) as AssistantMsg).notices;
  const lastReply = (t: Tab) => msgsOf(t).filter((m): m is AssistantMsg => m.role === "assistant").at(-1)!;

  async function openBroken(status?: "stopped" | "error" | "interrupted") {
    seed("c1", "glaucoma screening", brokenSecond(status));
    const t = await openTab();
    t.lib.setChatOwner("u1");
    await t.lib.openChat("c1");
    return t;
  }

  it("a follow-up after a reply that did not finish says so, in one line, and leans on the search before it", async () => {
    for (const status of ["stopped", "error", "interrupted"] as const) {
      fake.records.clear();
      local.clear();
      net.calls.length = 0;
      net.chat = () => followed();
      const t = await openBroken(status);
      t.lib.sendMessage("only after 2020", "auto");
      await idle(t);
      expect(asks(bodies()[0]), status).toEqual(["glaucoma screening"]); // the failed one is still not carried
      expect(lastReply(t).notices.filter((n) => n.kind === "unfinished"), status).toEqual([{ kind: "unfinished", text: DID_NOT_FINISH_NOTICE }]);
    }
  });

  it("it is kept with the reply (a reload shows it again) and is the notice's own kind: one notice of a kind, none of the server's replaced", async () => {
    net.chat = () => sse([understood({ context: { turns: 1, intent: "refine", rewrote: true, question: "q?" } }), { type: "notice", kind: "weak", text: "A line of the server's" }, { type: "papers", results: [paper("p1")], final: true }, { type: "done", answered: false, reason: "not_answered", tookMs: 1 }]);
    const t = await openBroken();
    t.lib.sendMessage("only after 2020", "auto");
    await idle(t);
    const kinds = lastReply(t).notices.map((n) => n.kind).sort();
    expect(kinds).toEqual(["unfinished", "weak"]);
    expect((stored("c1")!.messages.at(-1) as AssistantMsg).notices.map((n) => n.kind).sort()).toEqual(["unfinished", "weak"]);
  });

  it("in Hinglish for a message that is Hinglish", async () => {
    net.chat = () => followed({}, { language: "hinglish" });
    const t = await openBroken();
    t.lib.sendMessage("2019 ke baad ke papers", "auto");
    await idle(t);
    expect(lastReply(t).notices.find((n) => n.kind === "unfinished")?.text).toBe(DID_NOT_FINISH_NOTICE_HINGLISH);
  });

  it("not when the server did not lean on the turns: it read the message as a new subject, could not use its reading, read nothing, or stood alone", async () => {
    const cases: [string, Record<string, unknown>][] = [
      ["a new subject", { context: { turns: 1, intent: "new", rewrote: false } }],
      ["a reading it could not use", { context: { turns: 1, intent: "refine", rewrote: false, fellBack: true } }],
      ["only a year chip", { context: { turns: 0, intent: "new", rewrote: false, yearFrom: 2020 } }],
      ["nothing read at all", {}],
    ];
    for (const [name, over] of cases) {
      fake.records.clear();
      local.clear();
      net.chat = () => finish(over);
      const t = await openBroken();
      t.lib.sendMessage("tuberculosis in children", "auto");
      await idle(t);
      expect(lastReply(t).notices.some((n) => n.kind === "unfinished"), name).toBe(false);
    }
  });

  it("not for a visitor (nothing is sent to lean on), not for a search chosen by hand, and not for the first message of a chat", async () => {
    net.chat = () => followed();
    // a chat kept with no owner (a visitor's), whose second message did not finish
    seed("v1", "glaucoma screening", brokenSecond(), null);
    const v = await openTab();
    v.lib.setChatOwner(null);
    await v.lib.openChat("v1");
    v.lib.sendMessage("only after 2020", "auto");
    await idle(v);
    expect(raw(0)).toBe('{"mode":"auto","message":"only after 2020"}');
    expect(lastReply(v).notices.some((n) => n.kind === "unfinished")).toBe(false);

    const h = await openBroken();
    h.lib.sendMessage("only after 2020", "search");
    await idle(h);
    expect(lastReply(h).notices.some((n) => n.kind === "unfinished")).toBe(false);

    h.lib.startNewChat();
    h.lib.sendMessage("only after 2020", "auto");
    await idle(h);
    expect(lastReply(h).notices.some((n) => n.kind === "unfinished")).toBe(false);
  });

  it("only on the reply that followed it: the next reply, and the one after, do not say it", async () => {
    net.chat = () => followed();
    const t = await openBroken();
    t.lib.sendMessage("only after 2020", "auto");
    await idle(t);
    expect(lastReply(t).notices.some((n) => n.kind === "unfinished")).toBe(true);
    t.lib.sendMessage("and in children?", "auto");
    await idle(t);
    expect(lastReply(t).notices.some((n) => n.kind === "unfinished")).toBe(false);
    t.lib.sendMessage("and in men?", "auto");
    await idle(t);
    expect(lastReply(t).notices.some((n) => n.kind === "unfinished")).toBe(false);
  });

  it("not when something that finished came after the failed reply: the person's last message was that one", async () => {
    net.chat = () => followed();
    const t = await openBroken();
    net.chat = () => sse([understood(), { type: "general", kind: "not_research", text: "You are welcome." }, { type: "done", answered: false, reason: "small_talk", tookMs: 1 }]);
    t.lib.sendMessage("thanks a lot", "auto");
    await idle(t);
    net.chat = () => followed();
    t.lib.sendMessage("only after 2020", "auto");
    await idle(t);
    expect(asks(bodies().at(-1))).toEqual(["glaucoma screening"]);
    expect(lastReply(t).notices.some((n) => n.kind === "unfinished")).toBe(false);
  });

  it("after New topic nothing follows the failure: a marked message follows nothing, and so says nothing", async () => {
    net.chat = () => followed();
    const t = await openBroken();
    expect(t.lib.startNewTopic()).toBe(true);
    t.lib.sendMessage("tuberculosis in children", "auto");
    await idle(t);
    expect(raw(0)).toBe('{"mode":"auto","message":"tuberculosis in children"}');
    expect(lastReply(t).notices.some((n) => n.kind === "unfinished")).toBe(false);
  });

  it("Search again on the reply that followed the failure says it again (it is asked as of its own message), and an edit of that message too", async () => {
    net.chat = () => followed();
    const t = await openBroken();
    t.lib.sendMessage("only after 2020", "auto");
    await idle(t);
    const third = lastReply(t);
    t.lib.retryReply(third.id);
    await idle(t);
    expect(lastReply(t).notices.filter((n) => n.kind === "unfinished")).toHaveLength(1);
    t.lib.editMessage(msgsOf(t).filter((m) => m.role === "user").at(-1)!.id, "only after 2021");
    await idle(t);
    expect(lastReply(t).notices.filter((n) => n.kind === "unfinished")).toHaveLength(1);
    // while Search again on the stopped reply itself, which followed finished turns only, says nothing
    t.lib.retryReply("a2");
    await idle(t);
    expect(notesOf(t, "a2").some((n) => n.kind === "unfinished")).toBe(false);
  });
});
