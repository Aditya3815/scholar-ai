import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The "Use my earlier chats" switch (apps/web/src/lib/memory.ts), run in node against a fake localStorage. What it answers decides whether up to three earlier questions of the person's OTHER
 * chats are sent with a message, so it must say what the browser's storage says NOW, not what this page last wrote: a second tab that turned it off, or another person's sign-in that replaced the
 * value, has to take effect in a tab that is open and never heard the storage event (no Settings page open there, so nothing was listening).
 *
 * The module is loaded by a path that is not a literal, so that this workspace's type check (no DOM) does not follow it into the web workspace.
 */
const MEMORY_PATH = "/@fs" + decodeURIComponent(new URL("../../../web/src/lib/" + "memory.ts", import.meta.url).pathname);

vi.mock("react", () => ({ useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get() }));

type Mem = { earlierChatsOn: (who: string | null | undefined) => boolean; setEarlierChats: (on: boolean, who: string) => boolean };

const g = globalThis as unknown as Record<string, unknown>;
const KEY = "scholar.earlier";

/** A storage that can be told to refuse: reads, writes or removals. */
function storage(refuse: { get?: boolean; set?: boolean; remove?: boolean; drop?: boolean } = {}) {
  const m = new Map<string, string>();
  return {
    refuse,
    raw: m,
    getItem: (k: string) => {
      if (refuse.get) throw new Error("blocked");
      return m.has(k) ? m.get(k)! : null;
    },
    setItem: (k: string, v: string) => {
      if (refuse.set) throw new Error("quota");
      if (!refuse.drop) m.set(k, String(v));
    },
    removeItem: (k: string) => {
      if (refuse.remove) throw new Error("blocked");
      m.delete(k);
    },
  };
}

async function load(): Promise<Mem> {
  vi.resetModules();
  g.window = { addEventListener: () => {}, removeEventListener: () => {} };
  return (await import(/* @vite-ignore */ MEMORY_PATH)) as Mem;
}

let local: ReturnType<typeof storage>;
beforeEach(() => {
  local = storage();
  g.localStorage = local;
});

describe("the switch says what the browser's storage says now", () => {
  it("is off until the person turns it on, and on for that person only", async () => {
    const m = await load();
    expect(m.earlierChatsOn("u-A")).toBe(false);
    expect(m.setEarlierChats(true, "u-A")).toBe(true);
    expect(m.earlierChatsOn("u-A")).toBe(true);
    expect(m.earlierChatsOn("u-B")).toBe(false);
    expect(m.earlierChatsOn(null)).toBe(false);
    expect(m.earlierChatsOn(undefined)).toBe(false);
  });

  it("is off in a tab that turned it on after another tab turned it off (no storage event was heard)", async () => {
    const m = await load();
    m.setEarlierChats(true, "u-A");
    local.raw.delete(KEY); // the other tab: Settings, switch off
    expect(m.earlierChatsOn("u-A")).toBe(false);
  });

  it("is off in a tab that turned it on after another person signed in on the same computer and turned it on for themselves", async () => {
    const m = await load();
    m.setEarlierChats(true, "u-A");
    local.raw.set(KEY, "u-B");
    expect(m.earlierChatsOn("u-A")).toBe(false);
    expect(m.earlierChatsOn("u-B")).toBe(true);
  });

  it("takes up a choice made in another tab after this tab turned it off (nothing stale holds it off)", async () => {
    const m = await load();
    m.setEarlierChats(true, "u-A");
    m.setEarlierChats(false, "u-A");
    expect(m.earlierChatsOn("u-A")).toBe(false);
    local.raw.set(KEY, "u-A"); // the person turns it on in another tab
    expect(m.earlierChatsOn("u-A")).toBe(true);
  });
});

describe("what it does when the browser will not keep the choice", () => {
  it("stays off, and says so, when the browser drops the write", async () => {
    local = storage({ drop: true });
    g.localStorage = local;
    const m = await load();
    expect(m.setEarlierChats(true, "u-A")).toBe(false);
    expect(m.earlierChatsOn("u-A")).toBe(false);
  });

  it("stays off, and says so, when the write throws (blocked storage)", async () => {
    local = storage({ set: true });
    g.localStorage = local;
    const m = await load();
    expect(m.setEarlierChats(true, "u-A")).toBe(false);
    expect(m.earlierChatsOn("u-A")).toBe(false);
  });

  it("turning it off always takes effect here, even when the removal could not be stored", async () => {
    const m = await load();
    expect(m.setEarlierChats(true, "u-A")).toBe(true);
    local.refuse.remove = true;
    expect(m.setEarlierChats(false, "u-A")).toBe(true);
    expect(m.earlierChatsOn("u-A")).toBe(false); // the value is still in storage, but the person said off
  });

  it("is off when storage cannot be read at all", async () => {
    const m = await load();
    m.setEarlierChats(true, "u-A");
    local.refuse.get = true;
    expect(m.earlierChatsOn("u-A")).toBe(false);
  });
});
