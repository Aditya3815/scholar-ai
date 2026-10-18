# Citation-accuracy eval

The product promise is that **no citation is ever made up**. This eval checks it against real data on every push, and again against the live
APIs every week. It runs the real code (`src/search`, `src/references`), not a copy.

```bash
npm run eval                     # replay recorded API responses: offline, deterministic, seconds (this is what CI runs)
npm run eval:record -w apps/api  # refresh recordings from the live APIs (~30 min, ~$0.15 OpenAlex); commits a new fixtures file
npm run eval:live -w apps/api    # live APIs, nothing saved (weekly GitHub Action: .github/workflows/eval-live.yml)
```
Latest recorded run: [REPORT.md](REPORT.md).

## What is measured

| Dataset (`apps/api/eval/data/`) | Size | How it was made |
| --- | --- | --- |
| `papers.json` | 100 real papers | 25 topics (CS, medicine, materials, education, India-themed, ...) x top 4 most-cited 2008-2022 articles from OpenAlex; each must exist in Crossref with authors and year, have a 4-24 word title, and not be retracted. `topic` is the search used to collect the paper, not a classification. |
| `retracted.json` | 20 retracted papers | Highest-cited papers that OpenAlex flags as retracted **and** that Crossref lists in Retraction Watch (two independent sources). |
| `fake_refs.json` | 30 fabricated references | 10 wholly invented, 8 real title + invented authors, 4 real first author + invented title, 4 invented DOIs (verified not to resolve at doi.org), 4 correct reference text carrying another paper's DOI. Invented titles were checked against Crossref. |
| `heldout_papers.json` | 60 real papers (HELD-OUT) | A seeded **random** sample from OpenAlex, never used while tuning: 30 with an Indian institution (1995-2024, 3-60 citations: regional journals, one-word surnames, lower-quality metadata) and 30 global (3-200 citations). Same checks as above except a 3-40 word title. |
| `heldout_fakes.json` | 40 fabricated references | Built mechanically from the held-out papers: real title with invented authors and journal, or the genuine reference with the year moved 4-6 years. No hand tuning. |
| `topical.json` | 20 landmark queries | Hand-written topical queries with the DOI of the famous paper that must appear in the top 10 (every DOI verified to resolve). |

## Gates (hard failures; thresholds at the top of `eval/eval.eval.ts`)

| Gate | Requirement | Why |
| --- | --- | --- |
| G1 | Every DOI any search RETURNS (all ~140 searches, after the pipeline's own DOI check removed bad ones) is re-checked independently, one by one: it resolves at doi.org and its title agrees with Crossref's | the core "no fabricated citation" promise; also catches wrongly merged records |
| G2 | All 20 retracted papers detected (Retraction Watch via Crossref); 0 false positives on the 100 ordinary papers | users must never cite a retracted paper unknowingly |
| G3 | **0 of 30 fabricated references verified** | the Reference Verifier must never bless a fake |
| G4 | >= 90% of the 100 genuine references verified (5 formats: APA +/- DOI, IEEE with DOI, Vancouver, messy) | a verifier that rejects real citations is useless |
| G5 | Known-item recall@10 >= 90% (search by title) | basic search quality |
| G6 | >= 85% of landmark topical queries show the landmark paper in the top 10 | discovery quality |
| - | Provider failures <= 5%; in replay, every request has a recording | health and determinism |

## How the Reference Verifier decides (`src/references/`)
Deterministic, no LLM. `verified` needs the record's title covered by the reference text (>= 85%, >= 95% plus author and year for very short generic titles)
**and** a confirming author or year, with nothing contradicting it. A real title with invented authors is `mismatch`, a DOI that does not resolve is
`not_found`, and network errors are `unverifiable`, never `verified` or `not_found`.

## What the eval has already caught (real bugs, fixed)
The first run against live data failed three gates and exposed problems no unit test had found:

| Finding | Fix |
| --- | --- |
| Crossref rejects `select=` on the single-work endpoint (HTTP 400); our fake-network unit tests could not see it | removed; found by the dataset builder hitting the real API |
| **8 of 2,619 DOIs the search returned do not exist** (bogus `10.63544/*`, `10.7759/cureus.81858`, ...) and one carried a link artefact (`.../pdf`) | `src/search/doi-check.ts` checks every returned DOI (one Crossref call + capped doi.org lookups) and removes nonexistent ones; `normalizeDoi` strips `/pdf`, `/full`, ... |
| Semantic Scholar attached a **commentary's DOI to the paper it comments on**, and a garbled title to another record | a registered DOI whose title contradicts the record is removed too |
| **A fabricated reference was verified**: real title + invented authors, matched to an authorless NEJM correspondence record with the same title and year | a record without authors can never verify (`no_authors` -> `unverifiable`); organisation authors are matched by name |
| Genuine references rejected because the right paper was not in Crossref's top 5 for the whole pasted string | second, title-focused Crossref query merged with the first |
| When one of two searches failed, a missing match was reported as `not_found` | a missing match after a failed search is `unverifiable` ("not found" is a claim) |
| Merge result depended on which provider answered first | merge in fixed provider order |

## Held-out results (the honest numbers)

`papers.json` was used while the verifier was being tuned, so its 100% is optimistic. The held-out set was built afterwards and the
matcher is **not** to be changed to fix its misses; they are reported as they are (recorded 2026-10-18):

| | Tuned set | Held-out |
| --- | --- | --- |
| Genuine references verified | 100/100 | **56/60 (93%)**: India 28/30, global 28/30 |
| Fabricated references verified | 0/30 | **0/40** |
| Paper found by its title, top 10 | 99/100 | **58/60 (97%)** |

The four misses: three references the matcher called "not found" or "mismatch" because the title in the record contains markup
or unusual typography (`<mml:math ...>` in a physics title, a hyphenated chemistry title, a botanical name) so fewer than 85% of
the title words line up; one is also a title Crossref spells differently. None is a fabricated reference being blessed, which is
the failure that matters; they are false alarms. Gates H1-H3 guard against getting worse (fakes 0, genuine >= 88%, known-item
>= 92%); do not raise them by tuning on this set.

## Limits worth knowing
- The tuned set's 100% is optimistic; the held-out set above (93%) is the number to quote. 60 + 40 items is still small: a few more misses move it by points.
- 100 + 30 + 20 items is a regression net, not a statistical estimate of real-world accuracy. Grow it with real user-reported cases.
- Fabrications here were written by us; real LLM fabrications may differ. Add real ones (from the "wrong citation" button) as they arrive.
- Replay protects against code regressions, not upstream drift (that is what the weekly live run is for).
- Recordings are trimmed (abstracts and unused fields dropped) and contain no API keys or email addresses.
