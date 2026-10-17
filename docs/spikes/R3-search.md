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

## Addendum: Semantic Scholar added as 4th provider (same day)

Re-ran the 50 queries with `s2` in the mix (other providers served from cache, so S2 is the cold column):

| Metric | Before (3 providers) | After (4 providers) |
| --- | --- | --- |
| Results deduplicated across >1 source | 169 / 991 (17%) | **404 / 991 (41%)** |
| S2 reliability | n/a | 49/50 ok (1 HTTP 429 even after one retry, serial requests) |
| S2 cold latency p95 | n/a | 3.7 s (slowest provider now) |
| DOI validity sample | 40/40 | 40/40 |

Why it matters: landmark papers now rank first because OpenAlex and S2 independently agree on them
(reciprocal-rank fusion rewards consensus). `graph neural networks` now starts with the 12k-citation survey, the 10k-citation GIN paper, etc.
S2 also supplies `openAccessPdf` links. Caveats: the key is 1 req/s, and 429s still occur at well under 1 req/s, so S2 must stay
optional (partial results) and cached; a Durable Object limiter + queue is a Phase 1 item.

## OpenAIRE Graph API assessment (verdict: not needed for MVP search)

Tested `https://api.openaire.eu/graph/v1/researchProducts` without any key; no login or password is needed to use it.

- **Access:** works unauthenticated. Docs say 60 req/hour unauthenticated vs 7,200/hour authenticated, but the live `x-ratelimit-limit` header showed 7199 on unauthenticated calls (the 60/h rule appears planned, not enforced). Plan for it anyway: before launch, register a *service* (Basic client-credentials: `POST https://aai.openaire.eu/oidc/token`, up to 5 services per account) and fetch/refresh a bearer token server-side.
- **Terms:** CC-BY, commercial reuse allowed, only requirement is to acknowledge OpenAIRE as a data source.
- **Speed/quality:** 0.2-1.5 s per query; relevance is mixed (surfaces Zenodo/repository items and Indian journals that the big indexes rank low, but also noisy). It is not a good primary ranker.
- **What is unique (why we may still add it):** `bestAccessRight`, `openAccessColor`, `isGreen`, `isInDiamondJournal`, per-instance `license` and `refereed` status and URLs, funding/project links, datasets and software records, and BIP citation indicators (their citation counts differ from OpenAlex, e.g. 397 vs 459).
- **Where it fits:** Phase 2 (open-access full-text links for the similarity corpus) and Phase 3 (the Journal Credibility Checker: diamond-OA and refereed signals). Add it then as an enrichment provider, not a ranked search source.

## Findings that change the design

1. **Cold p95 is 3.5 s, just over target.** PubMed (3.3 s p95) and OpenAlex (2.1 s) dominate. Phase 1: stream results per source over SSE so the first results show in ~1 s (Crossref) instead of waiting for the slowest source.
2. **OpenAlex costs money per call:** every response reports `cost_usd: 0.001`; the free budget is $1/day, i.e. about 1,000 uncached searches/day. The cache is mandatory, not an optimisation. Watch D1 writes too (100k rows/day free).
3. **OpenAlex `search=` is now full-text and noisy.** `filter=title_and_abstract.search:` gives much better relevance and is what we use.
4. **Crossref is weak as a ranked search** (returns preprint versions and book chapters). Its real value here is DOI-verified metadata and the Retraction Watch check. We filter to journal articles, proceedings and chapters.
5. **Retraction check:** one call with `updates:<doi>` repeated (OR) plus `update-type:retraction` checks a whole page of DOIs. DOIs containing a comma are skipped (unknown, not "clean").
6. **Ranking is not yet evaluated.** Plain RRF treats rank 1 from Crossref like rank 1 from OpenAlex, so a low-citation book chapter can outrank a landmark paper. Next: provider weights plus a citation-count boost, measured on the eval set (relevance was not measured in this spike, only reliability and speed).
7. **Not covered yet:** arXiv, CORE, OpenAIRE enrichment, PubMed abstracts (needs efetch XML), per-source token bucket and circuit breaker, expired-cache cleanup job, CPU measurement under real load.
