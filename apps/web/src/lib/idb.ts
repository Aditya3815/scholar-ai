/**
 * A very small key-value store on IndexedDB, for what is too big for localStorage (a drawing that could not be sent yet). Every call can fail (private windows, a full disk, a
 * blocked database) and says so by resolving to `null` / `false` instead of throwing: what is kept here is a safety net and the app works without it.
 */
const DB = "scholar";
const STORE = "pendingInk";

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
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

export const idbGet = <T>(key: string): Promise<T | null> => run<T>("readonly", (s) => s.get(key) as IDBRequest<T>).then((v) => (v === undefined ? null : v));
export const idbSet = (key: string, value: unknown): Promise<boolean> => run("readwrite", (s) => s.put(value, key)).then((v) => v !== null);
export const idbDelete = (key: string): Promise<boolean> => run("readwrite", (s) => s.delete(key) as IDBRequest<undefined>).then((v) => v !== null);
export const idbKeys = (): Promise<string[]> => run<IDBValidKey[]>("readonly", (s) => s.getAllKeys()).then((v) => (v ?? []).map(String));
export const idbClear = (): Promise<boolean> => run("readwrite", (s) => s.clear() as IDBRequest<undefined>).then((v) => v !== null);
