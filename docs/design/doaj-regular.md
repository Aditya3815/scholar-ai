# DOAJ in the regular search (built and measured 28 Oct 2026)

**What it is.** The regular search (the prompt box, the old search page, and every sub-question of a literature scan) asked four sources: OpenAlex, Semantic Scholar, Crossref, PubMed. It now asks a fifth: **DOAJ** (the Directory of Open Access Journals), every journal, no country. The Indian-sources switch is unchanged (it still asks DOAJ for journals published in India, with the other two Indian sources). Why it was held back: [india-sources.md](india-sources.md) said it needed the search eval re-recorded and a check that the first page does not get worse. Both are done below.

Code: `doajAll` in [india.ts](../../apps/api/src/search/india.ts) (named `doaj-all`, because the cache keeps what a provider answered under its name and the Indian one asks something else), `SCOPES.all` in [search/index.ts](../../apps/api/src/search/index.ts), `searchComplete` in [chat/complete.ts](../../apps/api/src/chat/complete.ts). Measured with [doaj-live.mjs](../../apps/api/scripts/doaj-live.mjs) and the replay eval (`npm run eval -w apps/api`).

## 1. Was it worth it? (34 topics, real services, written before the first run)

12 of the prompt box's own test questions and 22 from other fields (education, economics, ecology, public health, social media). "On topic" is a rough word check; "new" means not among the regular first twenty. DOAJ asked three ways:

| Way of asking | Records | With abstract | On topic | New | Topics with nothing |
| --- | --- | --- | --- | --- | --- |
| **every word must be in the record (AND)** | 578 | **100%** | **94%** | 96% | 2 |
| the same words with OR | 680 | 96% | **1%** | 100% | 0 |
| the first three with AND, the rest optional | 666 | 100% | 82% | 99% | 0 |

OR is useless (it returns anything with one common word). AND is the same as the Indian scope's, which was already tested; the two topics with nothing are long questions. **Chosen: AND**, up to eight words, nothing of the query syntax gets through, and the word "India" is kept here (the Indian scope leaves it out because the scope says it).

What it adds to the **merged first twenty** (the list the answer is written from):

| | Without DOAJ | With DOAJ (AND) |
| --- | --- | --- |
| Papers with an abstract (of 680 places) | 400 | **470** (+17%) |
| First ten on topic | 93% | 95% |
| The regular first ten still in the first ten | | 90% |
| Places that are DOAJ's | 0 | 129 (19%) |

So a search now has about 14 papers with an abstract in its twenty instead of 12: more papers an answer can be written from. DOAJ answers in about 0.4 to 0.7 s.

## 2. Did the first page get worse? (the replay eval, 12 gates)

The eval replays recorded answers of the sources for 100 known papers, 60 held-out papers, 20 topical landmarks, 30 + 40 fabricated references and 20 retracted papers. DOAJ's answers to its (about 140) queries were recorded (`eval/patch-fixtures.mjs`, which now waits between DOAJ requests; `eval/lib/trim.mjs` keeps what the code reads and no abstract), and so were the 380 DOI and retraction batches whose DOIs changed because DOAJ brought new ones. All 12 gates pass:

| | Before | After |
| --- | --- | --- |
| Known-item recall at 10 / at 20 | 99% / 99% | 99% / 99% |
| Mean reciprocal rank | 0.89 | 0.87 |
| Held-out known-item recall at 10 | 97% | 97% |
| Topical landmarks in the top 10 | 20 of 20 | 20 of 20 |
| DOIs returned that do not resolve / disagree with Crossref | 0 / 0 | 0 / 0 |
| Retractions found / false positives | 20 of 20 / 0 | 20 of 20 / 0 |
| Fabricated references verified | 0 | 0 |

The one thing that moved is the rank of the right paper (0.89 to 0.87): a DOAJ article sometimes takes a place near the top. Nothing is lost at ten or at twenty.

On the way, the first replay reported 3 DOIs returned that do not resolve: they were results of DOAJ whose DOI check had not been recorded yet; the pipeline removes such DOIs (as it does for every source), and with the recordings in place none is returned.

## 3. Things that changed with it

- **A search that DOAJ alone failed is not "incomplete".** If one of the four fails the reader is still told the list may be incomplete; if only DOAJ does (it answers from a lane of two requests a second for everyone, so a busy minute can make a search wait or fail) nothing is said, and the failure is in the response's `providers` and the logs. The Indian scope's DOAJ is a core source of that scope and still counts.
- **Cache**: `search:doaj-all` is separate from `search:doaj`, so the two never answer for each other (tested).
- **The old search page** lists the five regular sources, not every source the app knows (it used to show chips for arXiv and the Indian ones, which it never asks).
- **Privacy text** `2026-10-draft-13`: DOAJ is one of the sources every search words go to; and the AI service also reads the finished answer ([claim-support.md](claim-support.md)). Everyone who needs the privacy text (uploading a paper, checking an idea) is asked again.
- **"Cross-checked"** badges: a paper that DOAJ and another index both list now counts two sources; they are independent records, so that is fair.

## 4. Not done

- Idea Check does not ask DOAJ (it asks the sources one by one with its own queries; its prior-art eval was not re-recorded).
- DOAJ is asked with English words (Auto translates Hindi and Hinglish first, as for the other sources).
- A way of asking that is not "every word": a long question gives DOAJ nothing (2 of 34 topics); the other sources fill the list.
