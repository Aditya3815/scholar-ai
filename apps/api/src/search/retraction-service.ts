import { cacheStore, type CacheEnv } from "../cache";
import { stubCrossrefFetch } from "../library/retraction-stub";
import { normalizeDoi } from "./normalize";
import { findRetractionNotices, retractedDois } from "./retraction";

/**
 * Is a paper retracted, as a service (docs/design: "service layer"): "Ask this paper" and the MCP tool `check_retractions` call it. Crossref's retraction data (which carries the Retraction
 * Watch database) through the public cache, which keeps each DOI's answer for a day. A lookup that fails says "unknown", never "not retracted".
 */

export type RetractionServiceEnv = CacheEnv & { CROSSREF_MAILTO: string; ENABLE_DEV_ROUTES?: string; QA_STUB?: string };

export type RetractionCheck = {
  /** The DOIs as they were read (lower case, without a resolver prefix), in the order given, each once. */
  checked: { doi: string; status: "retracted" | "not_retracted" | "unknown"; notices: string[] }[];
  /** What was given but is not a DOI. */
  invalid: string[];
};

/** Only in a local test run (the same switch src/index.ts uses for the nightly job): Crossref's answers are made up from the DOI (src/library/retraction-stub.ts). */
const fetchFor = (env: RetractionServiceEnv) => (env.ENABLE_DEV_ROUTES === "1" && env.QA_STUB === "1" ? { fetch: stubCrossrefFetch } : {});

/** Is one DOI retracted? `false` also when that could not be found out: for a screen that marks retracted papers and stays quiet otherwise. */
export async function isRetracted(env: RetractionServiceEnv, doi: string, timeoutMs = 4000): Promise<boolean> {
  const d = doi.toLowerCase();
  try {
    const r = await retractedDois(cacheStore(env), [d], { CROSSREF_MAILTO: env.CROSSREF_MAILTO, ...fetchFor(env) }, AbortSignal.timeout(timeoutMs));
    return r.retracted.has(d);
  } catch {
    return false;
  }
}

/**
 * Checks a list of DOIs. Each is answered retracted, not retracted or unknown (Crossref could not be asked, or a DOI with a comma, which its filter cannot take); a retracted one comes with
 * the DOIs of its retraction notices when Crossref names them (one more call, made only when something is retracted).
 */
export async function checkRetractions(env: RetractionServiceEnv, given: string[], timeoutMs = 8000): Promise<RetractionCheck> {
  const dois: string[] = [];
  const invalid: string[] = [];
  for (const g of given) {
    const d = normalizeDoi(g);
    if (!d) invalid.push(g);
    else if (!dois.includes(d)) dois.push(d);
  }
  if (dois.length === 0) return { checked: [], invalid };
  const crossref = { CROSSREF_MAILTO: env.CROSSREF_MAILTO, ...fetchFor(env) };
  const store = cacheStore(env);
  // Crossref takes the DOIs as one filter in the address: 40 at a time, as the nightly re-check does (src/library/retraction.ts); a batch that fails leaves only its own DOIs unknown
  const known = new Map<string, boolean>();
  for (let i = 0; i < dois.length; i += RETRACTION_BATCH) {
    const batch = dois.slice(i, i + RETRACTION_BATCH);
    try {
      const { retracted } = await retractedDois(store, batch, crossref, AbortSignal.timeout(timeoutMs));
      for (const d of batch) if (!d.includes(",")) known.set(d, retracted.has(d));
    } catch {
      /* this batch stays unknown */
    }
  }
  const retracted = dois.filter((d) => known.get(d) === true);
  let notices = new Map<string, string[]>();
  if (retracted.length > 0) {
    notices = await findRetractionNotices(retracted.slice(0, RETRACTION_BATCH), crossref, AbortSignal.timeout(timeoutMs)).catch(() => new Map<string, string[]>());
  }
  return {
    checked: dois.map((doi) => ({
      doi,
      status: !known.has(doi) ? "unknown" : known.get(doi) ? "retracted" : "not_retracted",
      notices: notices.get(doi) ?? [],
    })),
    invalid,
  };
}

/** How many DOIs go to Crossref in one call. */
export const RETRACTION_BATCH = 40;

export const retractionService = { check: checkRetractions, isRetracted };
