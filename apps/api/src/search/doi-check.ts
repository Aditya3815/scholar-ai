import type { Paper } from "@scholar/shared";
import type { CacheStore } from "../cache/store";
import { doiResolves } from "../references/lookup";
import { tokenize } from "../references/match";
import { cacheKey, cached } from "./cache";
import { crossrefHeaders } from "./crossref";
import { normalizeTitle } from "./normalize";

/**
 * Citation integrity for search results. Indexes do contain DOIs that do not exist (spike/eval findings: bogus `10.63544/*`
 * records, `.../pdf` link artefacts) and DOIs attached to the wrong record (a commentary's DOI on the paper it comments on).
 * Showing such a DOI lets a scholar cite something that is not there, so every returned DOI is checked:
 *   1. one Crossref call for all DOIs (`filter=doi:a,doi:b,...`): registered DOIs come back with the official title;
 *   2. the rest are looked up at doi.org (DataCite, mEDRA, ... or nothing at all), capped to protect the subrequest budget.
 * A DOI that does not exist, or whose registered title contradicts the record's title, is REMOVED from the result (the paper
 * can still be shown, but without a DOI it cannot be cited by DOI).
 */
export type DoiCheck = { status: "registered" | "resolves" | "unresolvable" | "unchecked"; title?: string };

type Env = { store: CacheStore; CROSSREF_MAILTO: string };
const MAX_HANDLE_CHECKS = 12;
const TTL_S = 7 * 24 * 3600;

const containment = (a: string, b: string) => {
  const A = new Set(tokenize(a)), B = new Set(tokenize(b));
  const inter = [...A].filter((t) => B.has(t)).length;
  return A.size && B.size ? Math.max(inter / A.size, inter / B.size) : 0;
};

async function crossrefBatch(dois: string[], env: Env, signal: AbortSignal): Promise<Map<string, string>> {
  const params = new URLSearchParams({
    filter: dois.map((d) => `doi:${d}`).join(","),
    rows: String(Math.min(dois.length, 100)),
    select: "DOI,title",
    mailto: env.CROSSREF_MAILTO,
  });
  const res = await fetch(`https://api.crossref.org/works?${params}`, { signal, headers: crossrefHeaders(env) });
  if (!res.ok) throw new Error(`Crossref DOI batch HTTP ${res.status}`);
  const body = (await res.json()) as { message?: { items?: { DOI?: string; title?: string[] }[] } };
  return new Map((body.message?.items ?? []).filter((i) => i.DOI).map((i) => [i.DOI!.toLowerCase(), i.title?.[0] ?? ""]));
}

export async function checkDois(dois: string[], env: Env, signal: AbortSignal): Promise<Record<string, DoiCheck>> {
  const usable = [...new Set(dois)].filter((d) => d && !d.includes(",")).sort();
  const out: Record<string, DoiCheck> = {};
  if (usable.length === 0) return out;

  const key = await cacheKey("doicheck", usable.join("|"));
  const { value } = await cached<Record<string, DoiCheck>>(env.store, "doicheck", key, TTL_S, async () => {
    const result: Record<string, DoiCheck> = {};
    const registered = await crossrefBatch(usable, env, signal);
    const rest: string[] = [];
    for (const d of usable) {
      if (registered.has(d)) result[d] = { status: "registered", title: registered.get(d) };
      else rest.push(d);
    }
    await Promise.all(
      rest.map(async (d, i) => {
        if (i >= MAX_HANDLE_CHECKS) return void (result[d] = { status: "unchecked" });
        try {
          result[d] = { status: (await doiResolves(d, { CROSSREF_MAILTO: env.CROSSREF_MAILTO })) ? "resolves" : "unresolvable" };
        } catch {
          result[d] = { status: "unchecked" }; // doi.org hiccup: never drop a DOI on an error
        }
      }),
    );
    return result;
  });
  return Object.assign(out, value);
}

/** Applies the checks in place. Returns how many DOIs were removed. */
export function applyDoiChecks(results: Paper[], checks: Record<string, DoiCheck>): number {
  let dropped = 0;
  for (const p of results) {
    if (!p.doi) continue;
    const c = checks[p.doi];
    if (!c) continue;
    let reason: Paper["doiStatus"] | null = null;
    if (c.status === "unresolvable") reason = "dropped_unresolvable";
    else if (c.status === "registered" && c.title && containment(p.title, c.title) < 0.6) reason = "dropped_conflict";

    if (reason) {
      dropped++;
      p.doiStatus = reason;
      p.doi = null;
      p.id = `t:${normalizeTitle(p.title)}|${p.year ?? ""}`; // the old id embedded the bad DOI
      p.retractionSources = p.retractionSources.filter((s) => s !== "crossref-retraction-watch");
      if (p.retractionSources.length === 0) p.retracted = false;
    } else {
      p.doiStatus = c.status === "unchecked" ? "unchecked" : "verified";
    }
  }
  return dropped;
}
