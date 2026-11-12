import { MAX_REFERENCE_CHARS } from "@scholar/shared";
import { cacheKey } from "../search/cache";
import { cacheStore, type CacheEnv } from "../cache";
import type { CacheStore } from "../cache/store";
import type { LookupEnv } from "./lookup";
import { verifyReference, type RefResult } from "./verify";
import type { Env } from "../platform/env";

/**
 * Checking a reference as a service (docs/design: "service layer"): the page's /api/v1/references/verify and the MCP tool `verify_references` both call `referenceService.verify`, so a
 * reference sent from an AI assistant gets exactly the verdict, the cache and the rules a reference pasted on the page gets.
 */

export type ReferenceEnv = CacheEnv & Pick<Env, "CROSSREF_MAILTO" | "OPENALEX_API_KEY">;

/** Verified/mismatch answers change slowly; "not found" is re-checked sooner because Crossref keeps indexing new papers. */
const TTL_SECONDS: Partial<Record<RefResult["status"], number>> = { verified: 86_400, mismatch: 86_400, not_found: 3_600 };

/** A reference as it is checked: white space joined, ends trimmed. */
export const cleanReference = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Is this text a reference that can be checked? Empty, or longer than one reference may be, is refused (a list must be sent one entry at a time). */
export function readReference(raw: unknown): { ok: true; text: string } | { ok: false; why: "empty" | "too_long" } {
  const text = typeof raw === "string" ? cleanReference(raw) : "";
  if (!text) return { ok: false, why: "empty" };
  if (text.length > MAX_REFERENCE_CHARS) return { ok: false, why: "too_long" };
  return { ok: true, text };
}

/**
 * Checks ONE reference. A bibliography is checked one entry at a time (a few in parallel): each call stays far below the Worker's per-invocation subrequest limit, a slow entry never
 * blocks the others, and results can be shown as they arrive. `unverifiable` (a database was unreachable) and `unparsed` are never cached.
 */
export async function verifyCached(store: CacheStore, text: string, env: LookupEnv): Promise<{ result: RefResult; cached: boolean }> {
  const clean = cleanReference(text);
  // "refverify2": the answers kept under "refverify" (up to a day) were given before the verifier read titles, DOIs and years as it does now (2 Nov 2026); a reference that was wrongly called
  // "not found" or "different" would have kept that answer. Change the name again whenever the same text should get a new answer.
  const key = await cacheKey("refverify2", clean.toLowerCase());
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

/** One reference checked against Crossref and OpenAlex through the public cache, which keeps the final verdict and every answer the databases gave on the way to it. */
export async function verifyReferenceService(env: ReferenceEnv, text: string): Promise<{ result: RefResult; cached: boolean }> {
  const store = cacheStore(env);
  return verifyCached(store, text, { ...env, store });
}

export const referenceService = { read: readReference, verify: verifyReferenceService };
