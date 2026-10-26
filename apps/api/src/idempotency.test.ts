import { describe, expect, it } from "vitest";
import { IN_FLIGHT_TIMEOUT_MS, fingerprintOf, readKey, runIdempotent, type KeyStore, type Scope, type Stored } from "./idempotency";

/** The same rules as the D1 store, in memory (every method is atomic here because nothing awaits inside it). */
function memoryStore(): KeyStore & { rows: Map<string, Stored> } {
  const rows = new Map<string, Stored>();
  const id = (s: Scope, k: string) => `${s.userId}|${s.route}|${k}`;
  return {
    rows,
    async claim(s, k, fingerprint, now) {
      if (rows.has(id(s, k))) return false;
      rows.set(id(s, k), { fingerprint, status: null, body: null, startedAt: now });
      return true;
    },
    async get(s, k) {
      return rows.get(id(s, k)) ?? null;
    },
    async takeOver(s, k, fingerprint, now, staleBefore) {
      const r = rows.get(id(s, k));
      if (!r || r.status !== null || r.startedAt >= staleBefore) return false;
      rows.set(id(s, k), { fingerprint, status: null, body: null, startedAt: now });
      return true;
    },
    async finish(s, k, status, body) {
      const r = rows.get(id(s, k));
      if (r) rows.set(id(s, k), { ...r, status, body });
    },
    async release(s, k) {
      if (rows.get(id(s, k))?.status === null) rows.delete(id(s, k));
    },
  };
}

const ME: Scope = { userId: "u1", route: "documents" };
const KEY = "0b9f6c1e-aaaa-4bbb-8ccc-123456789abc";
const created = (n: number) => () => Promise.resolve(new Response(JSON.stringify({ id: `doc${n}` }), { status: 201, headers: { "Content-Type": "application/json" } }));
const NOW = Date.parse("2026-10-26T12:00:00Z");

describe("readKey", () => {
  it("is undefined without a header, null for one that is not acceptable, the key otherwise", () => {
    expect(readKey(undefined)).toBeUndefined();
    expect(readKey(null)).toBeUndefined();
    expect(readKey("")).toBeUndefined();
    expect(readKey(KEY)).toBe(KEY);
    for (const bad of ["short", "x".repeat(101), "has space in the key 123", "semi;colon;1234567890", "emoji-😀-12345678901234", "../../etc/passwd-0000"]) expect(readKey(bad)).toBeNull();
  });
});

describe("runIdempotent", () => {
  it("without a key the work simply runs, every time, and nothing is stored", async () => {
    const store = memoryStore();
    let n = 0;
    const work = async () => created(++n)();
    expect(((await (await runIdempotent(store, ME, undefined, "f", NOW, work)).json()) as { id: string }).id).toBe("doc1");
    expect(((await (await runIdempotent(store, ME, undefined, "f", NOW, work)).json()) as { id: string }).id).toBe("doc2");
    expect(store.rows.size).toBe(0);
  });

  it("an unacceptable key is refused before any work is done", async () => {
    let ran = false;
    const res = await runIdempotent(memoryStore(), ME, null, "f", NOW, async () => ((ran = true), created(1)()));
    expect(res.status).toBe(400);
    expect(((await res.json()) as Record<string, string>).type).toBe("invalid_idempotency_key");
    expect(ran).toBe(false);
  });

  it("the first request runs and a repeat with the same key gets the same reply without running again", async () => {
    const store = memoryStore();
    let n = 0;
    const work = async () => created(++n)();
    const first = await runIdempotent(store, ME, KEY, "file-a:123", NOW, work);
    const again = await runIdempotent(store, ME, KEY, "file-a:123", NOW + 5000, work);
    expect(first.status).toBe(201);
    expect(first.headers.get("Idempotent-Replayed")).toBeNull();
    expect(again.status).toBe(201);
    expect(again.headers.get("Idempotent-Replayed")).toBe("true");
    expect((await again.json()) as Record<string, string>).toEqual({ id: "doc1" });
    expect(n).toBe(1);
  });

  it("two requests at the same moment with one key run the work once; the other is told to wait", async () => {
    const store = memoryStore();
    let n = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = async () => {
      n++;
      await gate;
      return created(1)();
    };
    const a = runIdempotent(store, ME, KEY, "f", NOW, slow);
    const b = await runIdempotent(store, ME, KEY, "f", NOW + 10, slow);
    expect(b.status).toBe(409);
    expect(b.headers.get("Retry-After")).toBe("1");
    expect(((await b.json()) as Record<string, string>).type).toBe("idempotency_in_progress");
    release();
    expect((await a).status).toBe(201);
    expect(n).toBe(1);
  });

  it("a request that has been running for more than a minute is taken to be dead and is replaced", async () => {
    const store = memoryStore();
    await store.claim(ME, KEY, "f", NOW - IN_FLIGHT_TIMEOUT_MS - 1);
    let n = 0;
    const res = await runIdempotent(store, ME, KEY, "f", NOW, async () => created(++n)());
    expect(res.status).toBe(201);
    expect(n).toBe(1);
    const fresh = memoryStore();
    await fresh.claim(ME, KEY, "f", NOW - IN_FLIGHT_TIMEOUT_MS + 5000);
    expect((await runIdempotent(fresh, ME, KEY, "f", NOW, created(1))).status).toBe(409);
  });

  it("the same key with a different request is refused (a bug must not return another file's result)", async () => {
    const store = memoryStore();
    await runIdempotent(store, ME, KEY, "file-a:123", NOW, created(1));
    const res = await runIdempotent(store, ME, KEY, "file-b:999", NOW, created(2));
    expect(res.status).toBe(422);
    expect(((await res.json()) as Record<string, string>).type).toBe("idempotency_key_reused");
  });

  it("an error reply is not kept: the key is free and the next try runs again", async () => {
    const store = memoryStore();
    const refused = await runIdempotent(store, ME, KEY, "f", NOW, async () => new Response(JSON.stringify({ type: "library_full" }), { status: 409 }));
    expect(refused.status).toBe(409);
    expect(store.rows.size).toBe(0);
    let n = 0;
    const ok = await runIdempotent(store, ME, KEY, "f", NOW + 1, async () => created(++n)());
    expect(ok.status).toBe(201);
    expect(n).toBe(1);
  });

  it("work that throws frees the key and the error carries on", async () => {
    const store = memoryStore();
    await expect(runIdempotent(store, ME, KEY, "f", NOW, async () => { throw new Error("storage down"); })).rejects.toThrow("storage down");
    expect(store.rows.size).toBe(0);
    expect((await runIdempotent(store, ME, KEY, "f", NOW + 1, created(1))).status).toBe(201);
  });

  it("a finished reply is never freed by a later error", async () => {
    const store = memoryStore();
    await runIdempotent(store, ME, KEY, "f", NOW, created(1));
    await store.release(ME, KEY);
    expect(store.rows.get("u1|documents|" + KEY)?.status).toBe(201);
  });

  it("keys are scoped to the person and to the endpoint", async () => {
    const store = memoryStore();
    let n = 0;
    const work = async () => created(++n)();
    await runIdempotent(store, ME, KEY, "f", NOW, work);
    await runIdempotent(store, { userId: "u2", route: "documents" }, KEY, "f", NOW, work);
    await runIdempotent(store, { userId: "u1", route: "feedback" }, KEY, "f", NOW, work);
    expect(n).toBe(3);
  });

  it("if keeping the reply fails, the work is still reported as done and the key is freed", async () => {
    const store = memoryStore();
    store.finish = async () => { throw new Error("db"); };
    const res = await runIdempotent(store, ME, KEY, "f", NOW, created(1));
    expect(res.status).toBe(201);
    expect(store.rows.size).toBe(0);
  });
});

describe("fingerprintOf", () => {
  it("is the same for the same text, differs for another, and is short", async () => {
    expect(await fingerprintOf("a report")).toBe(await fingerprintOf("a report"));
    expect(await fingerprintOf("a report")).not.toBe(await fingerprintOf("another report"));
    expect((await fingerprintOf("x")).length).toBe(32);
  });
});
