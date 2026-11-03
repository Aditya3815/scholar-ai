/**
 * A very small key-value store on IndexedDB, for what is too big for localStorage: a drawing that could not be sent yet ("pendingInk") and the conversations of the prompt
 * box ("chats"). Every call can fail (private windows, a full disk, a blocked database) and says so by resolving to `null` / `false` instead of throwing: what is kept here
 * is a safety net or a convenience, and the app works without it.
 */
const DB = "scholar";
const VERSION = 2;
export type Store = "pendingInk" | "chats";
const STORES: Store[] = ["pendingInk", "chats"];

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
      tx.onabort = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export const idbGet = <T>(key: string, store: Store = "pendingInk"): Promise<T | null> => run<T>(store, "readonly", (s) => s.get(key) as IDBRequest<T>).then((v) => (v === undefined ? null : v));
/**
 * A read that tells "there is no such record" (`ok`, `value: null`) from "the browser could not read" (`ok: false`): `idbGet` says null for both, which is right for a convenience but wrong for a
 * conversation, where reading nothing and then writing the empty chat back would delete what the person kept. A stored value is never `null`, so `run` returning null can only be a failure.
 */
export type Read<T> = { ok: true; value: T | null } | { ok: false };
export const idbRead = <T>(key: string, store: Store = "pendingInk"): Promise<Read<T>> =>
  run<T | undefined>(store, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>).then((v): Read<T> => (v === null ? { ok: false } : { ok: true, value: v === undefined ? null : v }));
/** What `idbSwap` did: the record was the one the writer had read and was replaced (`rev` is its new revision), or another writer had changed it since (nothing was written), or the browser would not. */
export type Swap = { status: "saved"; rev: number } | { status: "conflict" } | { status: "failed" };
/**
 * Replace a record only if it is still the one that was read: in ONE read-write transaction, the stored `rev` (none counts as 0, which is also what a record that does not exist yet has) is compared with
 * `expected`, and when they are equal `make(expected + 1)` is written. Two tabs that hold the same conversation each read it at a revision, and the second to write finds the first one's change instead of
 * writing the whole of its older copy over it.
 */
export async function idbSwap(key: string, make: (rev: number) => unknown, expected: number, store: Store = "pendingInk"): Promise<Swap> {
  const db = await open();
  if (!db) return { status: "failed" };
  return new Promise<Swap>((resolve) => {
    let out: Swap = { status: "failed" };
    try {
      const tx = db.transaction(store, "readwrite");
      const os = tx.objectStore(store);
      const get = os.get(key);
      get.onsuccess = () => {
        const have = (get.result as { rev?: unknown } | undefined)?.rev;
        if ((typeof have === "number" ? have : 0) !== expected) {
          out = { status: "conflict" };
          return;
        }
        os.put(make(expected + 1), key);
        out = { status: "saved", rev: expected + 1 };
      };
      tx.oncomplete = () => {
        db.close();
        resolve(out);
      };
      tx.onabort = tx.onerror = () => {
        db.close();
        resolve({ status: "failed" });
      };
    } catch {
      db.close();
      resolve({ status: "failed" });
    }
  });
}
export const idbSet = (key: string, value: unknown, store: Store = "pendingInk"): Promise<boolean> => run(store, "readwrite", (s) => s.put(value, key)).then((v) => v !== null);
export const idbDelete = (key: string, store: Store = "pendingInk"): Promise<boolean> => run(store, "readwrite", (s) => s.delete(key) as IDBRequest<undefined>).then((v) => v !== null);
export const idbKeys = (store: Store = "pendingInk"): Promise<string[]> => run<IDBValidKey[]>(store, "readonly", (s) => s.getAllKeys()).then((v) => (v ?? []).map(String));
export const idbClear = (store: Store = "pendingInk"): Promise<boolean> => run(store, "readwrite", (s) => s.clear() as IDBRequest<undefined>).then((v) => v !== null);
