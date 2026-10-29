# Scalability and efficiency pass (29 Oct 2026)

The question: what gets slower, or costs more, when there are many more people and many more rows than today? Method: read the query plans SQLite chooses (D1 is SQLite) against the real
migrations, find what reads a whole table, fix it test-first, and keep a test that fails if it comes back. Nothing here changes what a person sees.

## What was found and fixed

| Finding | Why it grows | Fix | Test |
|---|---|---|---|
| The 90-day purge of `llm_usage` and the admin page's "last 14 days" read the whole table | one row for every model call | migration 0024: `idx_llm_usage_ts` | [scale.test.ts](../../apps/api/src/scale.test.ts) |
| The purges of `ocr_usage`, `oa_daily`, `litscan_daily` read the whole table | one row per person per day | migration 0024: an index on `day` for each | scale.test.ts |
| The nightly retraction re-check parsed the JSON of **every saved paper of every person** to find DOIs | rows of `library_items` grow with people × papers | `library_items.doi` column (lower case; backfilled in the migration; set on every write by `doiColumn`) with a partial index; the list of DOIs to check is two bounded reads (never checked, due again) | [retraction.test.ts](../../apps/api/src/library/retraction.test.ts): backfill, index use, "a night's list does not grow with the library" |
| One purge that deletes millions of rows in a single statement can run past D1's limits and stop the whole job | tables are only ever purged once a night | [maintenance.ts](../../apps/api/src/maintenance.ts): every purge runs in pieces of 5,000 rows, one job's failure does not stop the others (the run then fails and names it, so the health check says so), and a 25-second budget leaves the rest for the next night | [maintenance.test.ts](../../apps/api/src/maintenance.test.ts): 12,000 rows in pieces, exact multiples, failure isolation, budget stop and resume |
| The session check made two queries on **every request** of a signed-in person | requests | one query (the sign-in methods come from a sub-select) | [session.test.ts](../../apps/api/src/auth/session.test.ts) counts the statements |
| The literature-scan stream read the scan's state and then its events on every tick, and every second even when nothing was happening | open streams × ticks | one query per tick ([tickOf](../../apps/api/src/litscan/store.ts), at most 200 events), and a quiet stream waits 1.2, 1.2, 2.5, then 4 seconds | store.test.ts, scale.test.ts |
| "Remember this" loaded every highlight the person ever made to show one | highlights per person | a count, then one row at the place | [remember.test.ts](../../apps/api/src/docs/remember.test.ts) |
| The same search in another case or spacing missed the cache | repeated searches | one normalised key ([normalisedQuery](../../apps/api/src/search/index.ts)) | normalised.test.ts |

`scale.test.ts` reads the plan of every nightly purge and of the queries that run on every request or on big tables, and fails when one has to read a whole table. A new query, or a dropped
index, is noticed in review and not in production.

## Cleanup done on the way

One copy each of the search environment ([search/env.ts](../../apps/api/src/search/env.ts), was four copies), the error reply ([problem.ts](../../apps/api/src/problem.ts), was eight), SHA-256
([hash.ts](../../apps/api/src/hash.ts), was three) and the database time format ([sql-time.ts](../../apps/api/src/sql-time.ts), was two). A stale comment about a plan limit that no longer applies
(Workers Paid is active) was reworded.

## Looked at and left, with the reason

- **Atomic reservation of the daily AI quota.** Two calls of the same person at the same moment can both pass the check and together go a little over the daily quota. A reservation would write a
  second row for every model call (the busiest write of the database, doubled) and add a failure mode (a reservation that is never settled). The overshoot is bounded by the number of calls in
  flight times their token cap, which is small next to the quota. A global spend ceiling (below) is the better protection. Revisit if the quota becomes a hard billing line.
- **`llm_usage` rollup.** The 14-day admin ranges are now index reads, and the table is purged at 90 days. A daily rollup table is worth it only when the admin page becomes slow; the plan test will say.
- **Paper vectors in D1.** Passages of uploaded papers are stored with their vectors in D1 and compared in the Worker. That works for hundreds of papers per person and has a wall at the 10 GB of one
  D1 database. The way out is a vector index (Vectorize) with two-phase retrieval; it is a change of storage and not a tuning, so it is a decision for when the numbers say so. Not started.
- **Library ETag, ink debounce.** Less data over the wire for people with big libraries and many pen strokes. Real, but they cut bandwidth and not database load, so they wait for a measurement.
- **A global spend ceiling** (stop AI calls for everyone past a daily cost) and **upstream lane limits** (more lanes than Crossref and CORE) are not built; the per-person quota and the shared lanes hold today.
- **`Cache-Control` on `/api/v1/search`.** A cached reply could keep an incomplete answer (a source down) for a minute. The server-side cache already answers repeats.
- **The `JOBS` queue binding** has no consumer. Removing a deployed binding is a configuration change with no gain; it stays until the queue has a use or is deleted on purpose.
- **Splitting `docs/routes.ts`** (about 780 lines). Route order matters there (`/search` and `/remember` before `/:id`) and the helpers would have to move first; the file is in clear sections. Deferred.
- A correction to an earlier note: the cache writes to KV are already made in parallel; there was nothing to fix there.

## Numbers to watch

`/admin` shows the model calls and the nightly job's heartbeat; the `maintenance` log line shows the rows deleted per table. If a purge ever reports the budget message
(`maintenance_budget`) on several nights in a row, the table is growing faster than it is emptied.
