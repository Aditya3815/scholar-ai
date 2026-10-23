# R6: the public cache in Workers KV (roadmap V6)

Date: 2026-10-24. Question: Search, the DOI and retraction checks and the Reference Verifier keep asking OpenAlex, Crossref, PubMed and doi.org the same things. OpenAlex has a daily budget, Crossref a
request rate and every call is slow (a first reference check took 14 to 22 s today). What should remember the answers, and for how long? Docs read 2026-10-24: Workers KV
[pricing](https://developers.cloudflare.com/kv/platform/pricing/), [limits](https://developers.cloudflare.com/kv/platform/limits/), [how it works](https://developers.cloudflare.com/kv/concepts/how-kv-works/),
[Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

## Short answer

1. **The public cache now lives in Workers KV** (one namespace for production, one for staging), with the database table as the fallback when KV is not bound. Only public data is ever put there.
2. **More is cached than before, and at the right grain:** a DOI check and a retraction check per DOI (one entry each, read together in one operation), and every answer Crossref, OpenAlex and doi.org gave on the way to a verdict
   (a DOI's record, a title search, "does this DOI resolve"), not only the final verdict.
3. **The same lookup made twice at the same moment is made once** (a bibliography is checked several references at a time and the same DOI or title turns up in more than one).
4. **Hits and misses are counted** and shown on `/admin` ("Public lookups kept"), so the saving is measured, not assumed.
5. **Honest limit:** two different searches share only about **6%** of their DOIs (measured below), so the per-DOI grain does not make search much cheaper by itself. What it does: a changed result list no longer throws away every
   known DOI, and a hiccup is no longer remembered for a week. The real saving is for what people repeat: the same query, and the same famous papers in many bibliographies. How much that is, only the pilot can say; the admin table will.
6. What is measurable today, on the real Cloudflare KV (staging): a PubMed search that took **2,979 ms** the first time took **9 ms** the second time.

## 1. What was there

`api_cache` in D1, behind a `CacheStore` interface, used by: each search provider's results (key: provider, query), the DOI check (key: **the whole sorted set of DOIs of that search**), the retraction check (same, whole set),
the final verdict of a reference (key: hash of its text) and the Idea Check's searches. The Reference Verifier asked Crossref and OpenAlex afresh for everything under a verdict, and the retraction check once more per verified reference.

Production's table held, on 23 Oct (before this change): reference verdicts (93 entries, about 0.6 KB each), five Idea Check searches of **59 KB each (largest 91 KB)**, provider results of 4 to 14 KB, and seven DOI checks.
Expired rows stay until the daily clean-up. Every miss was a D1 write of up to 91 KB, in the same database (one region, APAC) that serves people's papers, notes and sign-ins.

## 2. The choices

| | Workers KV | D1 `api_cache` (before) | Cache API (`caches.default`) | Durable Object |
| --- | --- | --- | --- | --- |
| Where a read is served | the place near the person, after the first read there | the database's region | the data centre that served it | one place, for one key |
| Shared across places | yes | yes | **no** (the page: entries "do not replicate outside of the originating data center") | yes |
| Consistency | eventual: a write can take about 60 s to show elsewhere, and a miss is cached too | strong | n/a | strong |
| Write limits | **1 write per second to the same key**; TTL at least 60 s | none that matters | GET responses only | n/a |
| Value size | 25 MiB | about 2 MB a row | not stated | n/a |
| Expiry | built in | a clean-up job | built in | by code |
| Cost (Workers Paid) | 10 M reads, 1 M writes a month included; then $0.50 per M reads and $5 per M writes | 25 G rows read, 50 M written included | free | per request and duration |
| Bulk read | **100 keys in one operation** | `IN (...)`, 90 parameters a statement | one lookup per key | n/a |

Why KV for this: the data is public, read far more than it is written, loses nothing when it is gone, and an entry that is a minute out of date costs one extra call at worst. It also takes the large payloads
and the write traffic out of the database that holds people's data, and a cache restored by a database restore can no longer bring old entries back (KV is not part of D1 Time Travel). Why not the others: D1 is strongly
consistent, which a cache does not need, and one region; the Cache API is per data centre, so a result read in Mumbai is not there when the next person is served in Singapore; a Durable Object would
serialise a cache that must not wait.

Prices at this size do not decide anything: a search reads about 6 keys, a reference check about 5, so even a thousand users doing fifty things a day stay inside the included 10 million reads, and writes are a small share of the reads. KV is the right tool because of speed, isolation and expiry, not because it is cheaper.

## 3. What was built

- `cache/kv.ts`: the store. Keys are versioned (`v1:`; to invalidate everything, change the version, nothing needs deleting), at most a source name and a hash (far under the 512-byte limit). A TTL is never below the 60 seconds
  KV accepts. Reads ask the place to keep what it read for 60 s. A value over a million characters is not kept. The source is kept as metadata, so `wrangler kv key list` says what each entry is.
- `cache/store.ts`: `getMany` (KV bulk read; the D1 fallback does `IN (...)` in chunks of 90) so a search that checks 30 DOIs makes one read.
- `search/cache.ts` `cached()`: a failing store is a miss and a failing write is logged; **only answers are kept, never errors**; identical misses at the same moment share one call (the key is written once, which KV needs); the TTL
  may depend on the answer.
- Per-DOI entries for the DOI check (a registered or resolving DOI is kept a week; one that does not resolve six hours, because it may be registered tomorrow; a doi.org hiccup not at all, where before the whole batch,
  hiccups included, was kept a week) and for the retraction check (a day).
- Lookup entries in `references/lookup.ts`: Crossref by DOI, Crossref and OpenAlex searches, OpenAlex by DOI, doi.org handle, a paper's deposited reference list. Found: a week. Absent (`null`, `false`, empty list): six hours. The
  harness that replays recorded answers (the eval) passes no store and is unchanged.
- `cache/meter.ts` and migration 0013: hits and misses per source per day, counted in memory and written in one batch at most every 1.5 s after the response (`waitUntil`). `/admin` shows them.
- The same store also holds the gateway's cache of **public** model answers (Gemini, for public tasks). Private answers never reach it.
- Dev-only `POST /api/v1/dev/cache` to test the real binding.

## 4. Measured

- **Real KV, staging, 24 Oct:** after the deploy, keys with the expected lifetimes were in the namespace: `doicheck` 168 h, `lk-openalex-doi` 168 h, `lk-crossref-doi` (Crossref did not have an arXiv DOI) 6 h, `refverify` 24 h,
  `search:pubmed` 24 h, each with its source as metadata. PubMed: **2,979 ms, then 9 ms**.
- **Production, after the deploy (24 Oct), the same search four times in a row:** 6,460 ms the first time (providers 1.5 to 2.4 s, then DOI and retraction checks); the second time every provider that had answered came back in
  **4 to 10 ms** (the one that had failed was asked again, as it should be); the third time the whole search took **77 ms** and the fourth **16 ms**, with the DOI check (20 DOIs, one bulk read) in 5 ms and the retraction check in 6 ms.
  The namespace then held 60 keys: 28 DOI checks, 28 retraction checks and four provider results, each labelled with its source.
- **DOI overlap between different searches, production, 4 pairs of related queries:** 5 of 77 DOIs (**6%**) in common. Per-DOI entries therefore matter little across different searches; they matter when the same search comes back after its
  provider entry has expired, or when one provider's list changes.
- Tests: 51 new unit tests (the KV store against a fake KV with a clock, the meter, `cached()` including concurrent misses and failures, per-DOI DOI and retraction checks, every lookup's lifetimes and "errors are not kept"),
  and 19 checks of the real local KV through the Worker (values, a million characters, 250 keys at once, the counts reaching the database and the admin page).

## 4b. The eval gates (found by CI, not by me locally)

The citation and prior-art evals replay recorded Crossref and OpenAlex answers, and a replay fails on any request that was not recorded. With one cache shared by the whole eval run, the new per-DOI
entries made later searches ask Crossref about fewer DOIs than were recorded (and an old whole-set entry had hidden that two searches asked about the same DOIs in a different order). Fix: each
search in the eval gets a store of its own (so it asks about its whole set of DOIs, exactly as recorded), the lookups in the eval have no store (as recorded), and the two Crossref requests that were
new in order only were added to the prior-art recording with `node eval/patch-fixtures.mjs --prior-art "GET ..."` (Crossref only, no OpenAlex budget). Results are unchanged: known-item recall 99/100
at 10, held-out 58/60, 0 of 40 fabricated verified. **Run `npm run eval -w apps/api` before pushing a change to search or lookups**; it is a step of CI and I skipped it this time.

## 5. Not done, on purpose

- **Staleness refresh** ("serve the old value and refresh in the background"): the Cache API cannot do it and KV does it only for hot keys by itself; at these lifetimes (a day to a week) it buys nothing.
- **Caching Idea Check results by idea:** the key would be derived from a person's idea. Only the *searches* (public results of an approved query) are kept, as before.
- **Deleting `api_cache`:** it is the fallback and still holds a few rows; the daily job keeps cleaning it. Remove the table when KV has run for a month without a fallback.
- **Crossref's global rate gate** (V5, a Queue lane): a cache lowers how many calls are made; it does not make the per-isolate gate global. Still open.
- **A hit-rate target.** Unknown until real use; the admin table is the instrument.

## 6. How to look at it, and how to undo it

- `/admin`, "Public lookups kept": per source, hits, misses and hit rate for the last 7 days. Sources: `search:openalex` and the other providers, `doicheck`, `retraction`, `refverify` (the verdict), `lk-...` (the lookups under it),
  `llm` (public model answers).
- What is in the namespace: `wrangler kv key list --namespace-id <id> --remote` (ids in `apps/api/wrangler.jsonc`).
- Throw everything away: change `KV_VERSION` in `cache/kv.ts` and deploy. Back to the database table: remove the `kv_namespaces` block and deploy (the code falls back by itself when `CACHE` is not bound).
- A new kind of lookup: wrap it in `remembered(...)` (`references/lookup.ts`), say how long a found and an absent answer stay true, and never keep a failure.
