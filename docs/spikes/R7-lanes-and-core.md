# R7: one lane to Crossref and CORE (roadmap V5), and CORE as a source for Idea Check (I4)

Date: 2026-10-24. Two questions. (1) Crossref allows a few requests a second; the product had a limiter inside each Worker process, which cannot be exact when several run. How should the whole product keep to the limit?
(2) Can CORE (core.ac.uk, open-access papers in university repositories) be a source for Idea Check, with a key that allows only a handful of requests a minute?

## Short answer

1. **A Durable Object `ApiGate` is the one lane** every isolate asks before calling Crossref or CORE. Not a Queue, which the roadmap first suggested: a Queue delivers work later and in the background, and a reference check is a question a person is waiting on; a lane that hands out turns in order is what that needs (and the Semantic Scholar throttle already worked this way).
2. **Three Crossref calls were not behind any limiter** (the Search provider, the DOI batch check, and the retraction check was, the lookups were): all Crossref calls now go through the lane.
3. **The lane protects Crossref and makes bursts slower, it does not make anything faster.** Measured: at the load the page really sends (three references at a time) no difference (median 3.0 s per reference both ways); under a burst of 15 at a time, 40 references took 18.5 s without the lane and 25.8 s with it, and none was lost.
4. **CORE is in Idea Check** (first two keyword searches, ten records kept from each). It adds **about 9 records per check that no other source found** (theses, repository copies, working papers). It does **not** improve "does it find the papers a paper cites": 85% / 48% / 7.4% with and without (the eval measures cited references, which is not what a repository index is for).
5. Found on the way, and fixed: CORE reads `and`, `or`, `not` as operators **in any case** (every title with "and" in it returned nothing); Hindi vowel signs were stripped from queries; the privacy text did not name arXiv as a recipient of search words (added with CORE; `PRIVACY_VERSION` is now `2026-10-draft-3`, so everyone is asked once more).

## 1. Crossref: what it says and what we measured

- Response headers (24 Oct 2026): with a `mailto` ("polite pool") `x-rate-limit-limit: 3`, `x-rate-limit-interval: 1s`, `x-concurrency-limit: 3`. Without one ("public pool") 5 a second but **one at a time**. We always send the `mailto`.
- From one address: 3 requests a second for 8 s: 24 of 24 answered. 6 a second for 8 s: 43 answered, **4 refused with 429** (8%). So the limit is enforced, a little loosely.
- Before: `crossref-gate.ts` allowed two calls at once **per isolate** and retried a 429. With several isolates the product as a whole could pass 3 a second; the retry absorbed it. Search's Crossref provider and the DOI batch check did not use even that.

## 2. The lane

`src/gate/`: `core.ts` (a scheduler that is pure, time is passed to it: spacing, calls in flight, a count per window, a daily allowance, "closed until"; and `GateCore`, which makes callers wait in order and turns a caller away at once when its wait cannot end in time), `api-gate.ts` (the Durable Object: state kept in storage), `index.ts` (`withGate(name, maxWaitMs, fn)`, settings in `GATES`).

| | Crossref | CORE |
| --- | --- | --- |
| What the service says | 3 a second, 3 at once | 10 a minute; the 11th gets a 429 with `x-ratelimit-retry-after`; 1,000 a day in CORE's documentation (could not be fetched, 403; nothing in the answers shows it) |
| Lane | a start every 340 ms, 3 at once | 9 starts in any 60 s, 1 a second at most, 1 at once, 800 a day |
| A caller waits at most | Search 2.5 s (then goes on without Crossref), reference check 15 s | 5 s |

Rules that matter:

- **A call the lane cannot place in time is not made**, and looks like a 429 to the caller. Every caller already says "could not check" for that, never "not found" (a test per caller family keeps it so).
- A **429 from the service closes the lane** for the time it asked (CORE: its reset time, never more than a day), so the others do not walk into the same wall.
- **The timeout of a call starts when the lane lets it go**, not when it joined the line. First version: a fixed 5 s wait with the timeout already running: at 15 at a time **20 of 40 references came back "could not check"**. That is the lesson that shaped the final design (15 s wait for references, timeout after the turn).
- **If the Durable Object cannot be reached**, the isolate uses its own lane (one log line) instead of failing everything.
- The lane's **lease** frees a place by itself after 20 s if a Worker died mid-call.
- The state survives a restart of the object (the count of the day, the starts of the last minute, "closed until").
- Unit tests 14 + 8 (the scheduler's rules, the waiting, the client), Crossref call tests, and `scripts/gate-e2e.mjs` on the real local Durable Object (10 calls at once start 340 ms apart; 5 slow calls never more than three together; a caller that cannot wait is refused and does not keep its place).

### Measured on deployed Workers (production still ran the old code, staging the new)

`node apps/api/scripts/crossref-burst.mjs <url> refs <count> <parallel> <offset>`: real references (title only, from the prior-art data), each needing fresh lookups.

| | at a time | references | in all | median per reference | 90th percentile | "could not check" |
| --- | --- | --- | --- | --- | --- | --- |
| production, old | 15 | 40 | 18.5 s | 5.9 s | 10.3 s | 1 |
| staging, lane | 15 | 40 | 25.8 s | 7.7 s | 10.9 s | 0 |
| production, old | 3 | 30 | 32.4 s | 3.1 s | 4.3 s | 0 |
| staging, lane | 3 | 30 | 31.2 s | 3.0 s | 4.2 s | 0 |

Four cold searches (new queries each) took 3.7 to 7.0 s on staging and 6.2 to 11.7 s on production: no sign that the lane slows Search. **Plainly: today the lane buys safety for when there are many people, not speed.** Capacity of the lane is the limit itself: about 3 calls a second, 40 references (about 120 calls) in 40 s if nobody else is checking.

## 3. CORE

- `GET https://api.core.ac.uk/v3/search/works/?q=...&limit=20&exclude=fullText` with `Authorization: Bearer <key>`. **The slash before `?` matters**: without it CORE answers with an HTML redirect page.
- 0.9 to 2.8 s a call. 10 requests in 14 seconds all answered; the 11th: 429, `x-ratelimit-retry-after` a minute after the first.
- Records: title, abstract, authors ("Family, Given", sometimes with `; id_orcid`), `doi` (about 40% have one), `downloadUrl`, `documentType` (mostly null; "thesis" 14%), journals. The same work comes back several times (one thesis seven times in one answer), so records with the same title and year are joined before ranking.
- A free-text query is **OR** (millions of hits, ranked by relevance); `AND` between words is exact. **`and`, `or`, `not` are operators in any case**: "…Sensing and Communications…" returned 1 record, 12 of the first 40 searches returned **none**. The words are now dropped from the query. After the fix: no search of 40 returned fewer than 5.
- The query is cleaned of everything CORE reads as syntax (quotes, fields, brackets); Devanagari and other Indic text is kept (a first version removed the vowel signs, which are Unicode "marks", not letters).
- **What it adds, measured** (prior-art eval, 40 recent papers, 20 with an Indian author, closest 30 kept, no AI re-rank in this eval):

| | at least one cited reference | three or more | mean share of references | records only that source found, per check |
| --- | --- | --- | --- | --- |
| OpenAlex + Semantic Scholar | 85% | 48% | 7.4% | |
| + CORE, all 20 records | 83% | 48% | 6.8% | 11.8 |
| **+ CORE, first 10 records (shipped)** | **85%** | **48%** | **7.1%** | **8.9** |
| + CORE, first 5 | 85% | 45% | 7.1% | 4.4 |

  Reading it: a repository index returns theses and working papers that a paper rarely cites, so the "does it find what a paper cites" measure cannot show its value; keeping all twenty even costs two points of hit rate (the tail is loosely related), ten costs none. The real product re-ranks by meaning with an embedding, which this eval does not run, so the cost of the extra records there is probably smaller; **not measured**.
  The measure that would show CORE's worth is whether scholars find prior art in a thesis that nothing else shows. That is for the pilot (I5), not for a script.
- Allowance arithmetic: two CORE calls per check, nine a minute for everyone: at most four checks a minute that reach CORE; a repeated search comes from the cache (a day). 800 a day is 400 checks. A check that cannot get its turn in 5 s reports "CORE is busy, try again in a minute" in the list of searches that did not answer, and goes on without it.
- Privacy: only the approved keyword search goes to CORE, like to OpenAlex and the others. The privacy text now lists **arXiv and CORE** (arXiv had been missing since 22 Oct) and the version moved to `2026-10-draft-3`.
- The Idea Check search step no longer names services while searching ("Searching the literature…"); the list of searches that were run stays in the report, as the report is a record.

## 4. Not done, on purpose

- **CORE in the main Search page**: the allowance (10 a minute for all) would be gone in a minute of normal use.
- **CORE's full text** (`fullText`, `downloadUrl`): not used. CORE's terms for reusing it were not readable (documentation blocked 403) and the Q&A for open-access papers (S1) is being designed on its own; whether CORE copies may be fetched and stored is a question for that design.
- **A page for the lanes on `/admin`** (calls, refusals, closings): the logs have `gate_unreachable` only. Worth adding when the pilot starts if refusals ever matter; the cache table has no place for it yet.
- **A paid Crossref plan or a second key**: a lane at 3 a second is enough for the pilot (a reference check is mostly one to three calls and cached for a week).
- Old CORE-less fixture entries stay in the recording file (the recording grew from about 440 KB to 540 KB).
