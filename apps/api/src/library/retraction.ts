import { LOOKUP_GATE_WAIT_MS } from "../references/crossref-gate";
import { findRetracted } from "../search/retraction";

/**
 * S3: papers that were saved in a library are looked at again for retractions. A paper is retracted after people have saved it; the search that found it only knew what was true that day.
 *
 * A daily job (`retraction_check`, in the same cron as the clean-up) takes the DOIs of saved papers that have not been checked for a week (never-checked first) and asks Crossref, a few dozen
 * at a time through the same gated lane every search uses. What it learns goes to `paper_retraction` (shared, no person in it). When a DOI turns out to be retracted, every person who saved it
 * gets one notice in `library_alerts`. Nothing is sent to anyone: the notice is shown in the app, where it stays until it is dismissed or the paper is removed.
 *
 * Careful about what it does NOT do: it never changes a saved paper, and it does not look at a library that lives only in a browser (nothing about it reaches the server; sign in to have it checked).
 * A paper without a DOI cannot be checked this way.
 */
export const RECHECK_AFTER_DAYS = 7;
/** At most this many DOIs a run: the rest wait for tomorrow. At 40 a call and Crossref's 3 a second this is a few seconds, far inside what a scheduled Worker may use. */
export const MAX_DOIS_PER_RUN = 400;
export const BATCH = 40;

type Env = { CROSSREF_MAILTO: string; fetch?: typeof fetch };
export type RecheckResult = { checked: number; retracted: number; unknown: number; alerts: number };

/** DOIs saved by someone and not looked at within a week; never-checked first, then the one waiting longest. A DOI already known to be retracted is not asked again. */
export async function dueDois(db: D1Database, limit = MAX_DOIS_PER_RUN): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT d.doi AS doi
         FROM (SELECT DISTINCT lower(json_extract(data, '$.doi')) AS doi FROM library_items WHERE coalesce(json_extract(data, '$.retracted'), 0) = 0) d
         LEFT JOIN paper_retraction r ON r.doi = d.doi
        WHERE d.doi IS NOT NULL AND d.doi <> '' AND instr(d.doi, ',') = 0
          AND (r.doi IS NULL OR (r.state <> 'retracted' AND r.checked_at < datetime('now', ?2)))
        ORDER BY r.checked_at IS NOT NULL, r.checked_at, d.doi
        LIMIT ?1`,
    )
    .bind(limit, `-${RECHECK_AFTER_DAYS} days`)
    .all<{ doi: string }>();
  return rows.results.map((r) => r.doi);
}

/** A request the service rejected as such (400 and the like), not a service that is down or slow: that DOI is the problem, and waiting a week is the right answer. */
const isRejection = (e: unknown) => {
  const m = /HTTP (\d{3})/.exec(e instanceof Error ? e.message : "");
  return !!m && Number(m[1]) >= 400 && Number(m[1]) < 500 && Number(m[1]) !== 429 && Number(m[1]) !== 408;
};

/** Which of `dois` are retracted. A batch the service rejects is split in halves until the one DOI at fault stands alone and is marked unknown; any other failure stops the run (tomorrow's run continues). */
async function ask(dois: string[], env: Env): Promise<{ retracted: Set<string>; unknown: Set<string> }> {
  try {
    return { retracted: new Set(await findRetracted(dois, env, AbortSignal.timeout(30_000), LOOKUP_GATE_WAIT_MS)), unknown: new Set() };
  } catch (e) {
    if (!isRejection(e)) throw e;
    if (dois.length === 1) return { retracted: new Set(), unknown: new Set(dois) };
    const mid = Math.ceil(dois.length / 2);
    const [a, b] = [await ask(dois.slice(0, mid), env), await ask(dois.slice(mid), env)];
    return { retracted: new Set([...a.retracted, ...b.retracted]), unknown: new Set([...a.unknown, ...b.unknown]) };
  }
}

export async function recheckRetractions(db: D1Database, env: Env, opts: { max?: number } = {}): Promise<RecheckResult> {
  const result: RecheckResult = { checked: 0, retracted: 0, unknown: 0, alerts: 0 };
  const due = await dueDois(db, opts.max ?? MAX_DOIS_PER_RUN);
  for (let i = 0; i < due.length; i += BATCH) {
    const batch = due.slice(i, i + BATCH);
    const { retracted, unknown } = await ask(batch, env);
    const statements: D1PreparedStatement[] = [];
    const alertAt = new Set<number>(); // which statements make notices, to count them
    for (const doi of batch) {
      const state = retracted.has(doi) ? "retracted" : unknown.has(doi) ? "unknown" : "clear";
      statements.push(
        db
          .prepare(
            `INSERT INTO paper_retraction (doi, state, checked_at, retracted_at) VALUES (?1, ?2, datetime('now'), CASE WHEN ?2 = 'retracted' THEN datetime('now') END)
             ON CONFLICT (doi) DO UPDATE SET state = excluded.state, checked_at = excluded.checked_at,
               retracted_at = CASE WHEN excluded.state <> 'retracted' THEN NULL WHEN paper_retraction.state = 'retracted' THEN paper_retraction.retracted_at ELSE datetime('now') END`,
          )
          .bind(doi, state),
      );
      if (state === "retracted") {
        alertAt.add(statements.length);
        // one notice for each person who saved it, whatever the spelling of the DOI in what they saved; a person who saved it already marked as retracted has seen that and gets none
        statements.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO library_alerts (user_id, paper_id, kind, title)
               SELECT user_id, paper_id, 'retracted', coalesce(json_extract(data, '$.title'), paper_id) FROM library_items
                WHERE lower(json_extract(data, '$.doi')) = ?1 AND coalesce(json_extract(data, '$.retracted'), 0) = 0`,
            )
            .bind(doi),
        );
      }
      result.checked++;
      if (state === "retracted") result.retracted++;
      if (state === "unknown") result.unknown++;
    }
    const out = await db.batch(statements);
    result.alerts += out.reduce((n, r, k) => n + (alertAt.has(k) ? (r.meta?.changes ?? 0) : 0), 0);
  }
  return result;
}
