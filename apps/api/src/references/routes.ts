import { Hono } from "hono";
import { MAX_REFERENCE_CHARS } from "@scholar/shared";
import { sameOrigin } from "../auth/http";
import { cacheKey } from "../search/cache";
import { cacheStore } from "../cache";
import type { CacheStore } from "../cache/store";
import type { LookupEnv } from "./lookup";
import { verifyReference, type RefResult } from "./verify";

export { MAX_REFERENCE_CHARS };

type Env = { DB: D1Database; CACHE?: KVNamespace; CROSSREF_MAILTO: string; OPENALEX_API_KEY?: string };

/** Verified/mismatch answers change slowly; "not found" is re-checked sooner because Crossref keeps indexing new papers. */
const TTL_SECONDS: Partial<Record<RefResult["status"], number>> = { verified: 86_400, mismatch: 86_400, not_found: 3_600 };

/**
 * Checks ONE reference per request. The client sends a bibliography one entry at a time (a few in parallel): each request
 * stays far below the Worker's per-invocation subrequest limit, a slow entry never blocks the others, and results can be
 * shown as they arrive. `unverifiable` (a database was unreachable) and `unparsed` are never cached.
 */
export async function verifyCached(store: CacheStore, text: string, env: LookupEnv): Promise<{ result: RefResult; cached: boolean }> {
  const clean = text.replace(/\s+/g, " ").trim();
  const key = await cacheKey("refverify", clean.toLowerCase());
  try {
    const hit = await store.get(key);
    if (hit) return { result: { ...(JSON.parse(hit) as RefResult), input: clean }, cached: true };
  } catch (err) {
    console.warn("reference cache read failed", err);
  }
  const result = await verifyReference(clean, env);
  const ttl = TTL_SECONDS[result.status];
  if (ttl) {
    // The reference text itself is not stored (only a hash of it as the key): a bibliography can reveal an unpublished thesis.
    await store.set(key, JSON.stringify({ ...result, input: "" }), ttl, "refverify").catch((err) => console.warn("reference cache write failed", err));
  }
  return { result, cached: false };
}

export const referenceRoutes = new Hono<{ Bindings: Env }>();

referenceRoutes.post("/verify", async (c) => {
  if (!sameOrigin(c)) return c.json({ type: "forbidden", title: "Cross-origin request blocked" }, 403);
  const body = await c.req.json<{ reference?: unknown }>().catch(() => null);
  const text = typeof body?.reference === "string" ? body.reference.replace(/\s+/g, " ").trim() : "";
  if (!text) return c.json({ type: "invalid_reference", title: "Invalid reference", detail: "Send { reference: string }." }, 400);
  if (text.length > MAX_REFERENCE_CHARS) {
    return c.json({ type: "invalid_reference", title: "Reference too long", detail: `A single reference can be at most ${MAX_REFERENCE_CHARS} characters. Split the list into separate entries.` }, 413);
  }
  // the same public cache keeps the final verdict and every answer the databases gave on the way to it
  const store = cacheStore(c.env);
  const { result, cached } = await verifyCached(store, text, { ...c.env, store });
  c.header("Cache-Control", "no-store");
  return c.json({ ...result, cached });
});
