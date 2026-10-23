import { crossrefHeaders } from "./crossref";
import { normalizeDoi } from "./normalize";
import { crossrefFetch, SEARCH_GATE_WAIT_MS } from "../references/crossref-gate";
import { getMany, type CacheStore } from "../cache/store";
import { cacheKey } from "./cache";
type RetractionEnv = { CROSSREF_MAILTO: string; fetch?: typeof fetch };

type NoticeItem = { "update-to"?: { DOI?: string; type?: string }[] };

/**
 * Ek Crossref call mein sab DOIs ka retraction check (Retraction Watch data Crossref mein hai).
 * `updates:<doi>` ek hi naam ke filters OR hote hain, `update-type:retraction` se AND.
 * Result: retraction notices; unke `update-to` mein retracted paper ka DOI hota hai.
 */
export async function findRetracted(
  dois: string[],
  env: RetractionEnv,
  signal: AbortSignal,
): Promise<string[]> {
  // DOI mein comma ho toh filter syntax toot jaata hai; aise rare DOIs skip (unknown rahenge).
  const usable = [...new Set(dois)].filter((d) => !d.includes(","));
  if (usable.length === 0) return [];

  const filter = [...usable.map((d) => `updates:${d}`), "update-type:retraction"].join(",");
  const params = new URLSearchParams({
    filter,
    rows: "100",
    select: "DOI,update-to",
    mailto: env.CROSSREF_MAILTO,
  });
  const res = await crossrefFetch(env.fetch ?? fetch, `https://api.crossref.org/works?${params}`, { signal, headers: crossrefHeaders(env) }, SEARCH_GATE_WAIT_MS);
  if (!res.ok) throw new Error(`Crossref retraction HTTP ${res.status}`);
  const body = (await res.json()) as { message?: { items?: NoticeItem[] } };

  const retracted = new Set<string>();
  for (const notice of body.message?.items ?? []) {
    for (const u of notice["update-to"] ?? []) {
      const doi = normalizeDoi(u.DOI);
      if (doi && u.type === "retraction" && usable.includes(doi)) retracted.add(doi);
    }
  }
  return [...retracted];
}

/** A retraction can be announced at any time, so what was found is kept for a day. */
const RETRACTION_TTL_S = 24 * 3600;

/**
 * `findRetracted` with one cache entry per DOI ("1" retracted, "0" not): the DOIs already known are read in one operation and only the others are sent to Crossref. A DOI that
 * `findRetracted` cannot ask about (one with a comma) is not in the answer and is not cached. Throws when Crossref could not be asked; nothing is kept then.
 */
export async function retractedDois(store: CacheStore | undefined, dois: string[], env: RetractionEnv, signal: AbortSignal): Promise<{ retracted: Set<string>; fromCache: boolean }> {
  const usable = [...new Set(dois)].filter((d) => d && !d.includes(","));
  if (!store) return { retracted: new Set(await findRetracted(usable, env, signal)), fromCache: false };
  if (usable.length === 0) return { retracted: new Set(), fromCache: true };

  const keys = await Promise.all(usable.map((d) => cacheKey("retraction", d)));
  const kept = await getMany(store, keys).catch(() => new Map<string, string | null>());
  const retracted = new Set<string>();
  const missing: string[] = [];
  usable.forEach((d, i) => {
    const v = kept.get(keys[i]!);
    if (v === "1") retracted.add(d);
    else if (v !== "0") missing.push(d);
  });
  if (missing.length === 0) return { retracted, fromCache: true };

  const found = new Set(await findRetracted(missing, env, signal));
  await Promise.all(
    missing.map((d) => {
      if (found.has(d)) retracted.add(d);
      return store.set(keys[usable.indexOf(d)]!, found.has(d) ? "1" : "0", RETRACTION_TTL_S, "retraction").catch((e) => console.warn("cache write failed", e));
    }),
  );
  return { retracted, fromCache: false };
}
