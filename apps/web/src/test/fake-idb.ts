/**
 * A stand-in for lib/idb.ts (the browser's IndexedDB), for the unit tests that run the page's stores in node. One copy for every such test
 * (docs/design/untangle.md, F1). The state lives in the test, made with `vi.hoisted`, so that it is the same object however often the module is
 * loaded afresh (`vi.resetModules()`):
 *
 *   const fake = vi.hoisted(() => ({ records: new Map<string, unknown>(), writes: [] as string[], failReads: 0 }));
 *   vi.mock("./idb", async () => (await import("../test/fake-idb")).fakeIdb(fake));
 */
export type FakeIdbState = {
  /** "store/key" to what is kept. */
  records: Map<string, unknown>;
  /** What was written, in order: "chats/<id>". */
  writes: string[];
  /** How many of the next reads fail (the browser's storage said no). Left out: none do. */
  failReads?: number;
};

export function fakeIdb(fake: FakeIdbState) {
  const k = (store: string, key: string) => `${store}/${key}`;
  const read = (key: string, store: string): { ok: boolean; value: unknown } => {
    if ((fake.failReads ?? 0) > 0) {
      fake.failReads!--;
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
}
