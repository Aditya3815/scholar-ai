# Citation-accuracy eval

The product promise is that **no citation is ever made up**. This eval checks it against real data on every push, and again against the live
APIs every week. It runs the real code (`src/search`, `src/references`), not a copy.

```bash
npm run eval                     # replay recorded API responses: offline, deterministic, seconds (this is what CI runs)
npm run eval:record -w apps/api  # refresh recordings from the live APIs (~30 min, ~$0.15 OpenAlex); commits a new fixtures file
npm run eval:live -w apps/api    # live APIs, nothing saved (weekly GitHub Action: .github/workflows/eval-live.yml)
```
Latest recorded run: [REPORT.md](REPORT.md).

If a replay reports a few recordings as missing (the code now asks for a request that was never recorded), you do not have to re-record everything (about an hour, a large
part of the day's OpenAlex budget): list them with `npm run eval 2>&1 | grep "^  GET "` and add just those with `node eval/patch-fixtures.mjs "GET https://..." ...`.

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

## Reference extraction from real PDFs

`node apps/api/scripts/refs-check.mjs <folder or file.pdf> [--dump <folder>]` runs the browser's own extraction (pdf.js text, then `analyzePaper`) in Node on real PDFs and prints, for each, how many references it found against the highest number the list itself prints
("printed up to"), how many look merged (very long) or cut (very short), and flags a disagreement. `--dump` writes the reference block and the entries for reading. Use it on any paper that shows too few or too many references (22 Oct: it found the two
bugs fixed that day). The unit tests in `apps/api/src/docs/paperinfo.test.ts` cover each style (numbered, hanging indent, two columns, appendix straight after the list, wrapped lines that begin with a year or a dash).

## References of real PDFs against the live services
(2 Nov 2026, 35 open-access papers, 1,325 references, the first 60 of each: Indian and global medicine, physics, astronomy, economics, mathematics, machine learning, HCI. The same services' answers kept on disk for the before and the after.
**Before: 71.9% verified (953), 366 under Needs attention. After: 86.0% verified (1,164 of 1,354), 184 under Needs attention.** Per paper, for example: GW150914 0 of 60 to 36, an astronomy paper 0 to 47 of 60, DETR 36 to 50 of 53, a 20-reference manuscript 13 to 20. About 50 of the 184 that are left are not papers (web pages, patents, reports, books).
Read the other way too: 100 references that were verified without a title, deliberately corrupted (volume, page, first author, year moved), gave 100 non-verified. A random 40 of the 83 verified without a title, and every one verified by a shortened title, a year note or a cut DOI, were read by a person: all were the right paper.)

The eval above uses clean records written out in five formats. A reference taken from a PDF is not clean, and that is where real papers were called "Needs attention" (2 Nov 2026, see the roadmap log).
`node apps/api/scripts/refs-live.mjs <folder or file.pdf> [--limit=60] [--out=results.json] [--cache=<folder>] [--all]` runs the browser's extraction and then the real verifier against the live Crossref, OpenAlex
and doi.org, and lists every reference that is not verified, with the record it came closest to. Read that list as a person would: each line is either a real paper (a defect to fix), or something the
registries do not hold (a web page, software, a patent, a report, a book: not a defect). `--cache` keeps every answer by URL, so a run before and a run after a change see the same world; `--out` writes the results for diffing.
Use it on any paper that shows real references under "Needs attention", and add what it finds as a test (the cases of 2 Nov 2026 are in `match.test.ts`, `verify.test.ts` and `paperinfo.test.ts`, each with the reference text as it was printed).
What it is not: a number to tune on. It has no ground truth beyond a person reading the list, so it finds defects; the gates above (fakes 0, genuine and held-out rates) are what stops a fix from blessing a fake.

## Prior-art recall (Idea Check)

`eval/prior-art.eval.ts` asks: if a researcher's idea were as clear as a paper's abstract, does Idea Check find the papers that paper itself cites? 40 recent papers (`data/prior_art.json`,
built by `node eval/build-prior-art.mjs`), the paper hidden from the results, recall measured among the 30 closest papers returned. It has its own recording (`fixtures-prior-art.json.gz`, recorded 22 Oct: 85% of papers get at least one of their references, 48% get three or more, on average 7% of a paper's references are among the 30 closest results; gates 80% and 6%). Since 22 Oct (evening) it runs the same 40 papers with four sets of sources (OpenAlex + Semantic Scholar only; + PubMed; + arXiv; all) and prints a table. Result: all four give 85% / 48% / about 7.4% (arXiv 7.3%), so PubMed and arXiv do not raise reference recall; each puts about 0.8 papers per check into the closest 30 that no other search found. They are kept because they carry recent preprints and papers that a benchmark built from already-published references cannot see; the gates stay on the shipped set (all sources). The eval sends no NCBI key (a made-up key is refused by PubMed). Record it with `EVAL_MODE=record npx vitest run -c vitest.eval.config.ts eval/prior-art.eval.ts` (about 10 minutes, needs `OPENALEX_API_KEY` and `S2_API_KEY`).
It measures retrieval only: not the AI step that writes the search plan, and not the meaning re-rank (which needs the embedding model).

## How the Reference Verifier decides (`src/references/`)
Deterministic, no LLM. `verified` needs the record's title covered by the reference text (>= 85%, >= 95% plus author and year for very short generic titles)
**and** a confirming author or year, with nothing contradicting it. A real title with invented authors is `mismatch`, a DOI that does not resolve is
`not_found`, and network errors are `unverifiable`, never `verified` or `not_found`.

How a reference is read before it is compared (all of it added on 2 Nov 2026, from real PDFs; each rule has a test with the reference as printed, and each can only help a reference that
the record agrees with, never one it contradicts):
- **The title is found before it is searched for.** "Bahdanau, D., Cho, K., Bengio, Y.: Neural machine translation ... In: ICLR (2015)" (Springer's proceedings style) and "Vaswani A, Shazeer N et al (2017) Attention is all you need." used to
  be searched with the authors glued to the title, and OpenAlex's title search needs every word to be in the title: 0 records. The title ends at its own full stop (not at an acronym such as "HCI.", and not after the venue).
- **A word the PDF broke is read the way the record writes it.** "attention- based" (a real hyphen) and "ma- chine" (a soft one) look the same; rejoining every break guessed wrong for the real ones. Two neighbouring words that make one
  word of the record's title are that word ("im- age", "Under water"); one word that makes two of its title's words is those two ("attentionbased", "filtersimultaneous"). The words around a break are left out of the OpenAlex search.
- **A title the reference shortened** ("A decomposable attention model" for "... for Natural Language Inference") verifies when it is the beginning of the record's title, at least three words, and author **and** year agree.
- **A year two off** (a paper first printed online or at a conference, dated by the later issue) verifies when the whole title and an author agree, and the answer says "Check the year: the reference says 2019, the record says 2021". Three or more stays a difference.
  A year that is part of the title ("during 2006-2015") is never taken for the reference's own (the eval found this: a moved year passed for the real one).
- **A DOI a PDF wrapped** ("doi:10.1145/3498361. 3538933", "...I3DA48870. 2021.9610916") is read whole first and as printed second; a DOI is called nonexistent only when none of its readings is. A DOI that was cut short
  (it names the proceedings) verifies when the reference's own title finds the paper and the printed DOI is the beginning of the paper's. The digits that finish a wrapped DOI used to be deleted by the page-number filter
  (they looked like "a number that repeats on every page"), which made a real DOI name a different paper.
- **A reference that gives no title** ("Abdo, A. A., et al. 2009a, ApJ, 699, 976", "D. Finkelstein, Phys. Rev. 110, 965 (1958)": the style of physics, astronomy and much of chemistry) used to be "not found" every time, a whole
  paper's list at once. It is now told by where it was printed: Crossref is asked for the records of the years around the printed one whose authors include the first author's name, ranked by **the numbers alone** (with
  the whole reference as the query, the paper was not among the first fifteen of the many by authors called Abdo; with "699 976" it is the first), and a record counts only when its first author, a year within one of its,
  its volume and its first page (or article number) are all in the reference **and the reference has no words of its own besides** (the record's authors and the words of its journal's name, an abbreviation being the start of
  one, are taken away; at most the journal's acronym may remain). That last rule is what keeps a made-up title on a real page from passing. It is tried for any reference that title did not verify, because a journal named in full reads like
  a title. An arXiv id with no title is told the same way (id, first author, year). A "not found" for such a reference says it gave no title and what could be compared.
- **A letter after a surname** that a manuscript printed for the author's affiliation ("Lia", "Wangc", "Zhanga,1") does not hide the author.
- **A patent** ("U.S. Patent No. ...") is not in either registry and is said to be a patent, not "a real paper with a similar title".

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

Re-measured on 2 Nov 2026 after those changes (replay): genuine 100/100, fabricated verified 0/30, held-out genuine **58/60 (97%)** (it was 57/60), held-out fabricated verified 0/40. The eval caught one thing on the way:
the year rule above first let two altered-year fakes through because of the years inside their titles; that is fixed and has a test.

## Limits worth knowing
- The tuned set's 100% is optimistic; the held-out set above (93%) is the number to quote. 60 + 40 items is still small: a few more misses move it by points.
- 100 + 30 + 20 items is a regression net, not a statistical estimate of real-world accuracy. Grow it with real user-reported cases.
- Fabrications here were written by us; real LLM fabrications may differ. Add real ones (from the "wrong citation" button) as they arrive.
- Replay protects against code regressions, not upstream drift (that is what the weekly live run is for).
- Recordings are trimmed (abstracts and unused fields dropped) and contain no API keys or email addresses.

## Understanding eval (Phase 0 of docs/design/intent-and-state.md)

This is the measuring tape for the work that turns what a person types into what the search does (the plan's releases R1 to R23). It was built before any of that work, so that every later release is judged against numbers that were written down first. Nothing in it changes what the product does.

**What exists now**
- **Cases** (`apps/api/eval/data/`): `intent-cases.json` is the DEV set, 187 messages from the five studies (the plan's 185 plus the 2 probe controls the studies carry), every original field kept under `source.record` and only the labels a study states turned into gold labels (a field that is absent means "not labelled"). `intent-controls.json` is 355 messages that must come back unchanged (14 router cases, 30 G5 titles, 20 G6 queries, 45 messages with the plan's trap tokens, and 246 clean messages drafted by an assistant, 15 of them Hindi and 15 Hinglish that a native reader still has to check). `intent-manifest.json` counts every set against the plan's target and pins each study file by hash. The schema and its validator (it refuses e-mail addresses, links, phone numbers and invisible characters) are in `eval/lib/intent-schema.ts`. `eval/build-intent-cases.mjs` is the mapping from the study files; rerun it with no argument to rebuild the manifest after editing the controls.
- **Gates** (`docs/eval/intent-gates.json`): the numbers of plan section 8.5 as data, 112 gates (78 `proposed`, 34 `needs_owner` because the plan gives no number, no n or an ambiguous rule; a `needs_owner` gate can never pass until the owner settles it in writing). `eval/lib/metrics.ts` reads them: exact binomial bounds, the one-sided sign test, Clopper-Pearson and Wilson intervals, Cohen's kappa, a clustered bootstrap, and `evaluateGate`, which answers pass, fail, insufficient_n, needs_owner or report_only and never passes a gate that has too few cases.
- **Hash**: `node apps/api/scripts/intent-gates-hash.mjs` prints the canonical SHA-256 of the gates file (keys sorted, two-space indent, one line feed). It is not what `sha256sum` gives for the file's bytes. The commit that freezes the gates carries this hash in its message, written as "canonical SHA-256".
- **Hold-out seal**: `node apps/api/scripts/intent-holdout.mjs` with `keygen`, `check`, `seal`, `verify`, `aggregate` and `reveal`. The sealed file (`apps/api/eval/data/intent-holdout.enc`, AES-256-GCM, header authenticated) is opened only with a key that stays outside the repository; `check` tests plain files against the schema with no key; only `reveal`, which the owner alone may run, prints a case, and that case then moves to DEV. The file does not exist yet.
- **Replay plan**: `node apps/api/scripts/intent-replay-plan.mjs` prints, with no network call, which searches a recording of the cases would need (raw, read and oracle forms), how many requests that is per source, and what it costs in OpenAlex calls. It records nothing. `docs/eval/openalex-budget.md` is the budget page for it.
- **Guides**: `docs/eval/intent-writing-guide.md` (how the people who write the sets work, the 80 hold-out scenarios in four sheets, the draft safety brief for the clinician, the owner's checklist).
- **Tests**: `eval/intent-data.eval.ts` (the data), `eval/metrics.eval.ts` (the statistics), `eval/intent-gates.eval.ts` (the gates file against a second, independent transcription of the plan table), and `.node-test.mjs` files for the hold-out seal, the replay plan and the canonical hash.

**What is NOT built yet**
- The scoring layers that need the product (L1 to L5 of plan 8.3: `eval/intent.eval.ts`, the replay recordings, the human-label layer, the real-model layer): each comes with the release that has something to measure.
- The sets that people write: SAFETY dev (395), NOT-A-SEARCH (460), IDS and CUES (390), ASK/TYPO/YEARS/TRAPS (330), RARE VALID (100), CHAINS (25). The manifest lists them with count 0.
- The sealed HOLD-OUT (120 messages, written from scenarios by people who have not seen the phrase lists) and its hash.
- The recording itself (about 600 to 1,100 searches through the real code), which needs the OpenAlex key's budget read first, and `eval/patch-fixtures.mjs` stopping at a 429, which it does not do today.

**Commands**
```bash
cd apps/api
npx vitest run -c vitest.eval.config.ts eval/intent-data.eval.ts eval/metrics.eval.ts eval/intent-gates.eval.ts   # also part of npm run eval
INTENT_STUDY_DIR=<folder of the five study files> npx vitest run -c vitest.eval.config.ts eval/intent-data.eval.ts   # also compares every DEV record with the study files on disk
node scripts/intent-gates-hash.mjs                      # the hash for the commit message
node scripts/intent-replay-plan.mjs                     # dry run, no network
node scripts/intent-holdout.mjs check <plain files>     # before sealing
cd ../.. && npm run test:scripts                        # the node tests of the seal, the plan and the hash
```

**The rule.** The gates file is frozen at the commit that carries its hash (its `frozen` field is `true` there; set it first, because it changes the hash). After that a number is loosened only by the owner, in writing, and never by the engineer whose release missed it: a change to a number is a new commit whose message says the owner allowed it and gives the new hash. A gate that fails is reported as failed; it is not edited to pass.
