# R11: what would a "literature scan" cost, and does running its workers at the same time help? (spike, 27 Oct 2026)

Question for the scan sketched in [research-patterns.md](../design/research-patterns.md) (section 4): a plan of sub-questions, one worker for each (search, then a checked answer), a merge. R10 ([R10-fan-out.md](R10-fan-out.md)) showed that Cloudflare can run such workers at once and survive a failed one. This measures what each worker costs **with the real thing**: the prompt box's own search-and-answer (`POST /api/v1/chat`: the real search providers, the real model, the real checks) on the **deployed staging Worker**. Script: [scan-spike.mjs](../../apps/api/scripts/scan-spike.mjs) (staging only: it refuses any other address; throwaway accounts from `staging-session.mjs`, erased afterwards).

It does **not** build the scan, and does not measure the planning and merging calls (small; estimated below), a scan under production load, or how good a merged report would be.

## What was run

Five sub-questions of one topic ("set A": air pollution and childhood asthma) one after the other; five sub-questions of a different topic ("set B": tuberculosis vaccines) all at the same moment from one account; then set A again, all at once. Two topics so that neither of the first two runs is helped by the public cache (search results are kept in Workers KV; the first attempt, which used the same questions twice, showed exactly that, see "A mistake in the first attempt").

## What came out

| | One after the other (A) | All at once (B) | All at once, searches already kept (A again) |
| --- | --- | --- | --- |
| **Wall time for five** | 99.8 s | **67.1 s** (1.5× faster) | **18.7 s** |
| Time to the papers, median | 10.0 s | 10.7 s | 1.4 s |
| Written answers within | 13.5 to 31 s each | 17 to 24 s, **one 62 s** | 5.8 to 18.7 s |
| Questions answered / not answered | 3 / 2 | 4 / 1 | 3 / 2 |
| Model tokens (in + out) | 7,518 (about 1,500 an answer) | 7,623 | (cached searches; the model is asked as before) |
| Errors | none | none | none |

Reading it:

1. **Running the workers at the same time does help, but much less than "five times".** 1.5× when nothing is cached: the wall time of a parallel scan is the time of its **slowest** worker, and the model's time to write an answer has a long tail (22 s for four of the five, **62 s** for the fifth). Parallel does not make each worker faster, it only stops them waiting for each other.
2. **The shared Crossref lane did not become the bottleneck at five.** The time to the papers with four others running (10.7 s) is the same as alone (10.0 s). I had listed this as the main thing that could go wrong; at five workers it did not. It is not shown for eight or twenty, and not under other people's traffic.
3. **A scan costs about what its answers cost, not a multiple.** About **1,500 tokens an answer**. Five workers: about 7.5 thousand tokens, plus a plan (about 500) and a merge (reading five short answers and writing a short report: about 1,500 to 2,000): **roughly 10 thousand tokens, 17% of one person's daily allowance of 60,000.** Eight workers: about 15 thousand, 25%. (The "15 times the tokens" in the first research note was Anthropic's figure for its own research system; ours is a fixed small fan-out of single answers, and it measures lower. A person who runs six scans a day uses the whole allowance.)
4. **Related questions share their searches.** The second time the same questions were asked, the papers came in 1.4 s instead of 10 s and the whole five took 18.7 s. A scan whose sub-questions overlap, or that is run again, is much cheaper in time than the first.
5. **Gaps are normal, not rare.** In all three runs two of five, one of five and two of five sub-questions ended **without a written answer** (the papers found do not answer it, or they had no abstracts). A scan's merged report would have a gap for a sizeable share of its sub-questions on a topic like these, so "a section that could not be answered, and why" is part of the report, not an error case (it matches the failed-worker gap of R10).
6. **A deployed run is not quick.** One after the other the five took 100 s; in parallel, 67 s in the cold case. A scan is something a person starts and comes back to (progress shown, resumable), which is the design in section 4, not something they wait for on a screen.

## A mistake in the first attempt

The first run used the **same** five questions for both runs. The parallel run then showed "papers in 2 s" and "5.1× faster": the sequential run had filled the search cache, so the parallel run skipped the slow part. That is a comparison of cold against warm, not of sequence against parallel, and it would have overstated the case by a factor of three. The numbers above come from the second attempt with two different topics. (The first attempt did give the 1,500-tokens-an-answer figure too: 2,217 and 2,081 an answer, which included a background call that the second attempt's questions needed less.)

## What it means for the decisions

- **Cost per scan is moderate and knowable up front** (about 10 thousand tokens for five sub-questions), which is what the approval screen of the design needs ("this will use about N of your M tokens today"). The plan step can show N before anything runs.
- **Parallel is worth it for time, not for cost**, and mostly for the slow tail: with a per-worker time limit (say 45 s) and "this part could not be answered in time" as an ordinary gap, the wall time would be about 25 s instead of 67 s here.
- **Not measured, still open:** the merge and plan calls; eight or more workers (the Crossref lane at higher fan-out); concurrent scans by several people; reading full papers instead of abstracts (the Ask-this-paper path takes 20 to 25 s a new paper, see [oa-w4.md](../design/oa-w4.md)), which would be a different, much slower worker.
