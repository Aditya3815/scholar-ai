# Golden sets (27 Nov 2026)

| File | Size | What it measures | Needs network |
|---|---|---|---|
| `queries.json` | 200 | search: known item in top 5, relevant-in-top-5 (term proxy), off-topic gets no papers | yes (record once) |
| `references.json` | 100 | verifier precision and recall of "problem" (year_mismatch, not_found) | yes (record once) |
| `answer-intent.json` | 60 | the guard around the intent `answer` | no, runs in `npm test` |

The Understand sets (`docs/eval/understand/`) stay as they are; their recorded run predates the intent `answer`, so a re-record is pending.
nDCG@10 needs graded relevance from pooled human judgements; it comes after the first live run (the term proxy is only a floor).
Tests: `apps/api/src/understand/golden-sets.test.ts`.

## First live run of references.json (27 Nov 2026)

Against the deployed verifier, 100 references: clean 29/30 verified (the miss: the GAN paper, answered "a similar title exists: Conditional GAN"), tolerated 10/10 verified, three or more years off 10/10 flagged, fake 20/20 not found, reprints 9/10 verified. DOI-only: 4/10 verified, 6 wrongly called "a different paper" (capital letters in the DOI defeated the DOI-only check; fixed). Books: 4/10 find the right record, the rest are not in Crossref/OpenAlex or match an older edition (not a verifier bug, shown as mismatch/not found).
