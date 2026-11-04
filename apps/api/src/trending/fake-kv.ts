/**
 * Workers KV for tests, with the rules of the real one that matter here: a value is text, an expirationTtl under 60 seconds is refused, a key may be written at most once a second,
 * a read of several keys is one operation and answers a Map, and a clock the test moves. It counts what was done, and it can be made to fail. Tests only; never imported by the Worker.
 */
export type FakeKvOptions = {
  now?: () => number;
  /** Called before every operation; throw to make it fail. */
  fail?: (op: "get" | "put" | "delete", key: string) => void;
  /** Whether to refuse a second write of a key inside one second (the real limit). On by default. */
  writeLimit?: boolean;
};

export function fakeKv(opts: FakeKvOptions = {}) {
  const now = opts.now ?? (() => 0);
  const data = new Map<string, { value: string; expires: number | null; wroteAt: number }>();
  const log = { gets: [] as string[][], puts: [] as { key: string; value: string; ttl: number | undefined }[], deletes: [] as string[], getOptions: [] as unknown[] };
  const live = (key: string): string | null => {
    const e = data.get(key);
    return e && (e.expires === null || e.expires > now()) ? e.value : null;
  };
  const kv = {
    async get(key: string | string[], options?: unknown) {
      log.getOptions.push(options);
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) opts.fail?.("get", k);
      log.gets.push(keys);
      if (Array.isArray(key)) {
        if (key.length > 100) throw new Error("KV: at most 100 keys in one read");
        return new Map(key.map((k) => [k, live(k)] as const));
      }
      return live(key);
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }) {
      opts.fail?.("put", key);
      if (options?.expirationTtl !== undefined && options.expirationTtl < 60) throw new Error("KV: expirationTtl must be at least 60 seconds");
      if (key.length > 512) throw new Error("KV: key over 512 bytes");
      const before = data.get(key);
      if (opts.writeLimit !== false && before && now() - before.wroteAt < 1000) throw new Error("KV: 429, at most 1 write per second to the same key");
      log.puts.push({ key, value, ttl: options?.expirationTtl });
      data.set(key, { value, expires: options?.expirationTtl ? now() + options.expirationTtl * 1000 : null, wroteAt: now() });
    },
    async delete(key: string) {
      opts.fail?.("delete", key);
      log.deletes.push(key);
      data.delete(key);
    },
  };
  return {
    kv: kv as unknown as KVNamespace,
    /** Puts a value in without counting it as a write by the code under test. */
    seed(key: string, value: string, ttlSeconds?: number) {
      data.set(key, { value, expires: ttlSeconds ? now() + ttlSeconds * 1000 : null, wroteAt: -Infinity });
    },
    read: (key: string) => live(key),
    keys: () => [...data.keys()].filter((k) => live(k) !== null),
    log,
    /** Every operation so far: reads (a bulk read is one), writes and deletes. */
    get ops() {
      return log.gets.length + log.puts.length + log.deletes.length;
    },
  };
}
