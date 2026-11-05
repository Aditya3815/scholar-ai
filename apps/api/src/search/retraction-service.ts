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
  let retracted: Set<string> | null = null;
  try {
    retracted = (await retractedDois(cacheStore(env), dois, crossref, AbortSignal.timeout(timeoutMs))).retracted;
  } catch {
    retracted = null;
  }
  let notices = new Map<string, string[]>();
  if (retracted && retracted.size > 0) {
    notices = await findRetractionNotices([...retracted], crossref, AbortSignal.timeout(timeoutMs)).catch(() => new Map<string, string[]>());
  }
  return {
    checked: dois.map((doi) => ({
      doi,
      status: retracted === null || doi.includes(",") ? "unknown" : retracted.has(doi) ? "retracted" : "not_retracted",
      notices: notices.get(doi) ?? [],
    })),
    invalid,
  };
}

export const retractionService = { check: checkRetractions, isRetracted };
