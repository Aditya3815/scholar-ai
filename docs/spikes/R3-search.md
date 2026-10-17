# Spike R3: multi-source search, DOI verification, retraction flag, cache

Date: 2026-10-17 · Verdict: **GO** (gate: 0 fabricated citations, p95 < 3 s with cache)

## What was built
`GET /api/v1/search?q=&limit=` in `apps/api/src/search/`:
OpenAlex + Crossref + PubMed in parallel (6 s timeout each, partial failure tolerated), DOI/PMID/title dedup,
reciprocal-rank-fusion ranking, one batched Crossref/Retraction Watch call for retraction flags, D1 read-through cache (24 h).
Harness: `apps/api/scripts/spike-r3.mjs` (50 queries across CS, medicine, social science, engineering, integrity topics, edge cases).

## Results (local worker + real APIs, 50 queries)

| Metric | Cold (cache miss) | Warm (cache hit) |
| --- | --- | --- |
| Requests ok | 50/50 | 50/50 |
| Latency p50 / p95 / max | 2710 / **3528** / 4545 ms | 21 / **36** / 37 ms |
| OpenAlex ok, p95 | 50/50, 2141 ms | cache 50/50 |
| Crossref ok, p95 | 50/50, 892 ms | cache 50/50 |
| PubMed ok, p95 | 50/50, 3267 ms (slowest) | cache 50/50 |
| Retraction check | 50/50 | cache 50/50 |

- 991 results (19.8/query); **96% carry a DOI** (the rest are PubMed-only records); 169 results (17%) were deduplicated across >1 source.
- **DOI validity: 40/40** random DOIs resolve via the doi.org handle API. Every result comes from an API record, never from an LLM.
- **Retraction:** Wakefield 1998 (10.1016/s0140-6736(97)11096-0) flagged by both OpenAlex and Crossref/Retraction Watch. 6 retracted papers flagged across the 50 queries.
- **Production (Cloudflare Workers Free, 10 ms CPU):** 3 cold searches succeeded (1.7-2.7 s server time), no CPU-limit errors; a repeat query took ~100 ms.

## Findings that change the design

1. **Cold p95 is 3.5 s, just over target.** PubMed (3.3 s p95) and OpenAlex (2.1 s) dominate. Phase 1: stream results per source over SSE so the first results show in ~1 s (Crossref) instead of waiting for the slowest source.
2. **OpenAlex costs money per call:** every response reports `cost_usd: 0.001`; the free budget is $1/day, i.e. about 1,000 uncached searches/day. The cache is mandatory, not an optimisation. Watch D1 writes too (100k rows/day free).
3. **OpenAlex `search=` is now full-text and noisy.** `filter=title_and_abstract.search:` gives much better relevance and is what we use.
4. **Crossref is weak as a ranked search** (returns preprint versions and book chapters). Its real value here is DOI-verified metadata and the Retraction Watch check. We filter to journal articles, proceedings and chapters.
5. **Retraction check:** one call with `updates:<doi>` repeated (OR) plus `update-type:retraction` checks a whole page of DOIs. DOIs containing a comma are skipped (unknown, not "clean").
6. **Ranking is not yet evaluated.** Plain RRF treats rank 1 from Crossref like rank 1 from OpenAlex, so a low-citation book chapter can outrank a landmark paper. Next: provider weights plus a citation-count boost, measured on the eval set (relevance was not measured in this spike, only reliability and speed).
7. **Not covered yet:** Semantic Scholar (key pending), arXiv, CORE, PubMed abstracts (needs efetch XML), per-source token bucket and circuit breaker, expired-cache cleanup job, CPU measurement under real load.
