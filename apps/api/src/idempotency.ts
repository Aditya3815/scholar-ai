/**
 * Idempotency for requests that create something. The browser sends a random `Idempotency-Key` with the request and repeats the SAME key when it tries again (a reply that
 * never arrived, a double click). The first request does the work and its successful reply is kept for a day; a repeat gets that reply back (`Idempotent-Replayed: true`)
 * and creates nothing. The rules follow the IETF draft "The Idempotency-Key HTTP Header Field" (still a draft: this is the pattern, not a standard we depend on):
 *
 *  - no key: the request is handled as before (nothing changes for a client that does not send one);
 *  - same key, same request, first one finished with success: its reply again;
 *  - same key, first one still running: 409 with `Retry-After`, nothing is run twice at once (a run that has been going for more than a minute is taken to be dead and is replaced);
 *  - same key, a different request (another file, another report): 422, so a client bug cannot silently get someone else's result;
 *  - an error reply is NOT kept: the key is released and the next try runs again (a refused upload can be tried once the cause is fixed);
 *  - a request that throws releases its key and the error carries on.
 * Keys are scoped to the person and the endpoint. The store is an interface, so the rules are tested without a database.
 */

import { sqlTime } from "./sql-time";

export const KEY_PATTERN = /^[A-Za-z0-9_.:-]{16,100}$/;
export const IN_FLIGHT_TIMEOUT_MS = 60_000;

export type Scope = { userId: string; route: string };
export type Stored = { fingerprint: string; status: number | null; body: string | null; startedAt: number };

export interface KeyStore {
  /** Writes the key as "running" if nobody has it. True if this caller now owns it. Must be atomic. */
  claim(scope: Scope, key: string, fingerprint: string, now: number): Promise<boolean>;
  get(scope: Scope, key: string): Promise<Stored | null>;
  /** Replaces a "running" record that started before `staleBefore`. True if this caller now owns it. Must be atomic. */
  takeOver(scope: Scope, key: string, fingerprint: string, now: number, staleBefore: number): Promise<boolean>;
  finish(scope: Scope, key: string, status: number, body: string): Promise<void>;
  release(scope: Scope, key: string): Promise<void>;
}

/** The key from a header: undefined when there is none, null when there is one that is not acceptable. */
export function readKey(header: string | null | undefined): string | null | undefined {
  if (header === undefined || header === null || header === "") return undefined;
  return KEY_PATTERN.test(header) ? header : null;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

export async function runIdempotent(store: KeyStore, scope: Scope, key: string | null | undefined, fingerprint: string, now: number, work: () => Promise<Response>): Promise<Response> {
  if (key === undefined) return work();
  if (key === null) return json(400, { type: "invalid_idempotency_key", title: "That Idempotency-Key is not valid", detail: "Use 16 to 100 letters, digits, dots, dashes or underscores, for example a random UUID." });

  let owned = await store.claim(scope, key, fingerprint, now);
  if (!owned) {
    const seen = await store.get(scope, key);
    if (seen) {
      if (seen.fingerprint !== fingerprint) return json(422, { type: "idempotency_key_reused", title: "That key was used for a different request", detail: "Use a new Idempotency-Key for a new request." });
      if (seen.status !== null && seen.body !== null) return new Response(seen.body, { status: seen.status, headers: { "Content-Type": "application/json", "Idempotent-Replayed": "true" } });
      owned = await store.takeOver(scope, key, fingerprint, now, now - IN_FLIGHT_TIMEOUT_MS);
      if (!owned) return json(409, { type: "idempotency_in_progress", title: "The first request is still being handled", detail: "Wait a moment and try again." }, { "Retry-After": "1" });
    } else {
      // the record vanished between the two calls (cleared by the daily clean-up): claim again once
      owned = await store.claim(scope, key, fingerprint, now);
      if (!owned) return json(409, { type: "idempotency_in_progress", title: "The first request is still being handled", detail: "Wait a moment and try again." }, { "Retry-After": "1" });
    }
  }

  let res: Response;
  try {
    res = await work();
  } catch (e) {
    await store.release(scope, key).catch(() => {});
    throw e;
  }
  if (res.status >= 200 && res.status < 300) {
    await store.finish(scope, key, res.status, await res.clone().text()).catch(() => store.release(scope, key).catch(() => {}));
  } else {
    await store.release(scope, key).catch(() => {});
  }
  return res;
}

/** The store on D1 (migration 0016). `claim` and `takeOver` are single statements, so two requests with one key cannot both own it. */
export function d1KeyStore(db: D1Database): KeyStore {
  return {
    async claim(s, key, fingerprint, now) {
      const r = await db.prepare("INSERT OR IGNORE INTO idempotency_keys (user_id, route, key, fingerprint, created_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(s.userId, s.route, key, fingerprint, sqlTime(now)).run();
      return (r.meta?.changes ?? 0) === 1;
    },
    async get(s, key) {
      const r = await db.prepare("SELECT fingerprint, status, body, created_at FROM idempotency_keys WHERE user_id = ?1 AND route = ?2 AND key = ?3").bind(s.userId, s.route, key).first<{ fingerprint: string; status: number | null; body: string | null; created_at: string }>();
      return r ? { fingerprint: r.fingerprint, status: r.status, body: r.body, startedAt: Date.parse(`${r.created_at.replace(" ", "T")}Z`) } : null;
    },
    async takeOver(s, key, fingerprint, now, staleBefore) {
      const r = await db.prepare("UPDATE idempotency_keys SET created_at = ?4, fingerprint = ?5 WHERE user_id = ?1 AND route = ?2 AND key = ?3 AND status IS NULL AND created_at < ?6").bind(s.userId, s.route, key, sqlTime(now), fingerprint, sqlTime(staleBefore)).run();
      return (r.meta?.changes ?? 0) === 1;
    },
    async finish(s, key, status, body) {
      await db.prepare("UPDATE idempotency_keys SET status = ?4, body = ?5 WHERE user_id = ?1 AND route = ?2 AND key = ?3").bind(s.userId, s.route, key, status, body).run();
    },
    async release(s, key) {
      await db.prepare("DELETE FROM idempotency_keys WHERE user_id = ?1 AND route = ?2 AND key = ?3 AND status IS NULL").bind(s.userId, s.route, key).run();
    },
  };
}

/** A short fingerprint of a text (a report). */
export async function fingerprintOf(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}
