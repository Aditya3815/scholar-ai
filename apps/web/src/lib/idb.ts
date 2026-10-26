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
export const idbSet = (key: string, value: unknown, store: Store = "pendingInk"): Promise<boolean> => run(store, "readwrite", (s) => s.put(value, key)).then((v) => v !== null);
export const idbDelete = (key: string, store: Store = "pendingInk"): Promise<boolean> => run(store, "readwrite", (s) => s.delete(key) as IDBRequest<undefined>).then((v) => v !== null);
export const idbKeys = (store: Store = "pendingInk"): Promise<string[]> => run<IDBValidKey[]>(store, "readonly", (s) => s.getAllKeys()).then((v) => (v ?? []).map(String));
export const idbClear = (store: Store = "pendingInk"): Promise<boolean> => run(store, "readwrite", (s) => s.clear() as IDBRequest<undefined>).then((v) => v !== null);
