import { afterEach, describe, expect, it, vi } from "vitest";
import { TOMBSTONE_PREFIX, eraseAccount, existingUsers, listTombstones, reapplyDeletions } from "./erase";

const U1 = "11111111-aaaa-bbbb-cccc-000000000001";
const U2 = "22222222-aaaa-bbbb-cccc-000000000002";

/** An R2 stand-in with a few pages of keys, and the calls it received. */
function fakeBucket(pages: string[][], opts: { putFails?: boolean } = {}) {
  const puts: { key: string; meta?: unknown }[] = [];
  const deletes: string[] = [];
  return {
    puts,
    deletes,
    put: async (key: string, _body: unknown, o?: { customMetadata?: unknown }) => {
      if (opts.putFails) throw new Error("R2 is down");
      puts.push({ key, meta: o?.customMetadata });
    },
    delete: async (key: string) => void deletes.push(key),
    list: async (o: { prefix?: string; cursor?: string }) => {
      const i = o.cursor ? Number(o.cursor) : 0;
      return { objects: (pages[i] ?? []).map((key) => ({ key })), truncated: i + 1 < pages.length, cursor: String(i + 1) };
    },
  } as unknown as R2Bucket & { puts: typeof puts; deletes: string[] };
}

/** D1 stand-in: records statements in order; `users` says which ids exist; `docs` is what the owner has. */
function fakeDb(opts: { users?: string[]; docs?: Record<string, string[]>; failBatchFor?: string } = {}) {
  const log: string[] = [];
  const db = {
    prepare(sql: string) {
      return {
        sql,
        args: [] as unknown[],
        bind: (...args: unknown[]) => ({
          sql,
          args,
          all: async () => {
            log.push(`all: ${sql.slice(0, 30)} ${args.length}`);
            if (/FROM documents WHERE user_id/.test(sql)) return { results: (opts.docs?.[String(args[0])] ?? []).map((id) => ({ id })) };
            if (/FROM users WHERE id IN/.test(sql)) return { results: (args as string[]).filter((a) => opts.users?.includes(a)).map((id) => ({ id })) };
            return { results: [] };
          },
        }),
      };
    },
    batch: async (stmts: { sql: string; args: unknown[] }[]) => {
      const who = String(stmts.find((s) => /DELETE FROM users/.test(s.sql))?.args[0] ?? stmts[0]?.args[0]);
      if (who === opts.failBatchFor) throw new Error("D1 batch failed");
      log.push(`batch: ${stmts.map((s) => s.sql.replace(/^DELETE FROM (\w+).*$/, "del $1").replace(/^INSERT INTO (\w+).*$/, "ins $1")).join(", ")}`);
      return [];
    },
  } as unknown as D1Database;
  return { db, log };
}

afterEach(() => vi.restoreAllMocks());

describe("eraseAccount", () => {
  it("writes the deletion marker first, then deletes files and rows, ending with the account itself", async () => {
    const files = fakeBucket([[]]);
    const { db, log } = fakeDb({ docs: { [U1]: ["d1", "d2"] } });
    await eraseAccount({ DB: db, FILES: files }, U1);
    expect(files.puts).toHaveLength(1);
    expect(files.puts[0]!.key).toBe(`${TOMBSTONE_PREFIX}${U1}`);
    expect(files.deletes.sort()).toEqual([`docs/${U1}/d1.cover.jpg`, `docs/${U1}/d1.pdf`, `docs/${U1}/d2.cover.jpg`, `docs/${U1}/d2.pdf`]);
    const last = log.filter((l) => l.startsWith("batch")).at(-1)!;
    expect(last).toContain("del users");
    expect(last.indexOf("del users")).toBeLessThan(last.indexOf("ins audit_log"));
  });

  it("the marker holds no personal data: an empty file with a time", async () => {
    const files = fakeBucket([[]]);
    await eraseAccount({ DB: fakeDb().db, FILES: files }, U1);
    expect(Object.keys(files.puts[0]!.meta as object)).toEqual(["at"]);
  });

  it("still erases when the marker cannot be written: nobody's deletion waits on a bookkeeping failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const files = fakeBucket([[]], { putFails: true });
    const { db, log } = fakeDb();
    await eraseAccount({ DB: db, FILES: files }, U1);
    expect(log.some((l) => l.startsWith("batch") && l.includes("del users"))).toBe(true);
  });

  it("does not write a marker for something that is not shaped like an account id, and writes none when told not to", async () => {
    const files = fakeBucket([[]]);
    await eraseAccount({ DB: fakeDb().db, FILES: files }, "../../etc/passwd");
    await eraseAccount({ DB: fakeDb().db, FILES: files }, U1, { tombstone: false });
    expect(files.puts).toHaveLength(0);
  });

  it("an account with no papers is erased without touching storage for papers", async () => {
    const files = fakeBucket([[]]);
    await eraseAccount({ DB: fakeDb().db, FILES: files }, U1);
    expect(files.deletes).toHaveLength(0);
  });
});

describe("listTombstones", () => {
  it("collects ids across pages and ignores keys that are not account ids", async () => {
    const files = fakeBucket([[`${TOMBSTONE_PREFIX}${U1}`, `${TOMBSTONE_PREFIX}`], [`${TOMBSTONE_PREFIX}${U2}`, `${TOMBSTONE_PREFIX}x`, `${TOMBSTONE_PREFIX}a/b-c-d-e-f-g-h`]]);
    expect(await listTombstones(files)).toEqual([U1, U2]);
  });
  it("no markers is an empty list", async () => {
    expect(await listTombstones(fakeBucket([[]]))).toEqual([]);
  });
});

describe("existingUsers", () => {
  it("asks in chunks of 50 (D1 allows 100 parameters) with one placeholder per id, and returns those that exist", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `id-${String(i).padStart(8, "0")}`);
    const { db, log } = fakeDb({ users: [ids[3]!, ids[60]!, ids[119]!] });
    expect(await existingUsers(db, ids)).toEqual([ids[3], ids[60], ids[119]]);
    expect(log).toHaveLength(3);
    expect(log.map((l) => l.split(" ").pop())).toEqual(["50", "50", "20"]);
  });
  it("no ids means no query", async () => {
    const { db, log } = fakeDb();
    expect(await existingUsers(db, [])).toEqual([]);
    expect(log).toHaveLength(0);
  });
});

describe("reapplyDeletions", () => {
  it("erases the accounts that have a marker and a row again, and only those", async () => {
    const files = fakeBucket([[`${TOMBSTONE_PREFIX}${U1}`, `${TOMBSTONE_PREFIX}${U2}`]]);
    const { db, log } = fakeDb({ users: [U1] }); // U2 was not brought back by the restore
    expect(await reapplyDeletions({ DB: db, FILES: files })).toEqual({ markers: 2, erased: 1, failed: 0 });
    expect(log.filter((l) => l.startsWith("batch"))).toHaveLength(1);
    expect(files.puts).toHaveLength(0); // the marker is already there
  });

  it("with no markers it does nothing, and a second run after a first finds nothing to do", async () => {
    expect(await reapplyDeletions({ DB: fakeDb().db, FILES: fakeBucket([[]]) })).toEqual({ markers: 0, erased: 0, failed: 0 });
    const files = fakeBucket([[`${TOMBSTONE_PREFIX}${U1}`]]);
    expect(await reapplyDeletions({ DB: fakeDb({ users: [] }).db, FILES: files })).toEqual({ markers: 1, erased: 0, failed: 0 });
  });

  it("one account that cannot be erased is counted and does not stop the others", async () => {
    const files = fakeBucket([[`${TOMBSTONE_PREFIX}${U1}`, `${TOMBSTONE_PREFIX}${U2}`]]);
    const { db } = fakeDb({ users: [U1, U2], failBatchFor: U1 });
    expect(await reapplyDeletions({ DB: db, FILES: files })).toEqual({ markers: 2, erased: 1, failed: 1 });
  });
});
