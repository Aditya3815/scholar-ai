# Search, AI reliability and Literature scan: review of 25 Nov 2026

Not tested against sodhsetu.in or the live indexes: the session's network allowed neither. Everything below is from the code, the 3,856 API tests, 292 web tests and the recorded citation eval (all green after these changes).

## Why a search did not give the answer people expected
1. **No relevance step.** `search/merge.ts` only added up how high each of the five sources ranked a paper (RRF). Nothing asked whether the title/abstract is about the words typed, so an off-topic paper three sources liked beat the exact paper one source found.
2. **OpenAlex** is asked with `title_and_abstract.search` and no sort, so its 20 are in no stated relevance order (it carries the same weight as S2, which does rank by relevance).
3. **Year / author / sort** existed only as a chat follow-up ("only after 2020"); a person looking at a list of papers had nothing to click.

## Changed
- `search/rank.ts`: after the DOI and retraction checks, the list is ordered by 40% fusion + 50% match (title counts most; whole phrase and word pairs count extra; stub records and zero-match papers are cut down) + 10% citations/recency (a nudge only). No model, no network, same answer every time; abstains on Devanagari queries. 10 tests.
- **Sort and filter bar** over each reply's papers: Best match / Most cited / Newest / Oldest, year range, author (any order, initials, accents), "Free to read". Instant, no new search; card numbers stay those the answer's [n] marks use (`lib/refine.ts`, 6 tests).
- **AI allowance ring** in the menu (signed in): fills as tokens are used (green, amber at 75%, red at 90%), refreshes after every reply, on return to the tab and each minute. New `GET /api/v1/account/allowance` (numbers only; its row is in the route-guard table).

## Not changed on purpose (needs you or the network)
- **Wider candidate pool.** The rerank only orders the papers the fusion already chose. Letting it pull a paper from fusion rank 25 into the top 20 is the bigger recall win, but it changes which DOIs are checked, so `npm run eval:record -w apps/api` (needs network) must be run first. `mergeAndRank(..., pool)` is ready for it.
- **Server-side year / author in the sources** (OpenAlex `from_publication_date`, S2 `year=`): documented parameters, but I could not test them, and they need the cache keys changed.

## "The AI works sometimes" - most likely causes (to confirm on the live site)
1. `llm/config.ts` says free Workers AI is **10k neurons/day for the whole account**. If the account is on the free plan, every AI feature fails for everyone after that is used, until midnight UTC. Check Cloudflare > Workers AI usage, and Admin > "how answers ended" (quota / timeout / down counts).
2. `qa`, `classify`, `summarize`, `review` have a **single private model** (gpt-oss-120b, which "thinks for 10 s or more" per the code's own note) and a 25 s per-call timeout: one slow call is a failure. A second private fallback exists in the repo's benchmarks (Llama 3.3 70B, Mistral Small 3.1, Qwen3 30B) but the rule in config.ts says to benchmark it for that task first. I did not swap models for grounded-citation answers without that.
3. Literature scan: each sub-question is one Workflow step with 2 retries; one that still fails becomes a "gap" section. Six themes at once against a 60k/day allowance (6,600 tokens each) means a second scan the same day often cannot start.

## Literature scan: what I would change next (not built)
Problems in the flow: it asks only a topic, then 3-6 model-written sub-questions, then a per-theme answer from abstracts, kept 24 hours, 4 a day. No year range, study-type or "how many papers" choice; no overall synthesis or research gap section across themes; no way to re-run one theme; results vanish.
Plan: (1) year range + "open access only" + papers-per-theme on the plan step; (2) a cross-theme "what the literature agrees / disputes / is missing" section built only from the checked answers; (3) re-run a single theme; (4) save the review into My Workspace instead of deleting at 24 h; (5) a PRISMA-style count line ("182 found, 61 relevant, 24 read").

## Competitors (public-web search returned only third-party comparisons; check before relying)
Elicit (Semantic Scholar corpus, structured extraction table, filters on year/study type/citations), Consensus (hybrid keyword + semantic, multi-stage ranking), Undermind (agentic iterative search, LLM relevance judge), Semantic Scholar (year / field / author / venue / has-PDF filters, citation graph). What they share and this site lacked: visible filters over results, relevance ranking that reads the abstract, and a table view of papers. The first two are now in; a table view is the next cheap one.
