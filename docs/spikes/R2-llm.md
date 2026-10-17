# Spike R2: can a free/cheap LLM do grounded paper Q&A?

Date: 2026-10-17 · Verdict: **GO, with conditions** (gate: grounded >= 80% and correct refusal >= 90% on a private-eligible model)

## Setup
- 5 open-access arXiv papers from different fields (Attention Is All You Need, a Haryana dairy RCT, a cholera model, a physics-education survey, pilot-study sample size). 35 questions: 20 English answerable, 5 Hindi answerable (Hindi question, English paper), 10 unanswerable (verified absent from the paper).
- Retrieval is the same for every model: top 6 passages of ~220 words (hybrid = BM25 + bge-m3 dense, rank fusion). Prompt asks for JSON `{answerable, answer, citations[{passage, quote}]}`.
- **Scoring is deterministic, no LLM judge:** answer must match gold regexes; every quote must appear in the cited passage (fragments split on "...", ignoring spacing/hyphens/punctuation because PDF text is messy); unanswerable questions must come back `answerable:false`. "Grounded & correct" needs both.
- Reproduce: `apps/api/scripts/r2/README.md`.

## Results

**Retrieval (recall@6 on the 25 answerable questions)**

| Method | All | Hindi questions |
| --- | --- | --- |
| BM25 | 88% | 4/5 |
| bge-m3 dense | 92% | 5/5 |
| **Hybrid (rank fusion)** | **96%** | 5/5 |

bge-m3 retrieves English passages for Hindi questions; plan hybrid retrieval.

**Models (35 questions)**

| Model | Where | Private OK | Grounded & correct | Quotes verbatim | Correct refusals | Hindi | p50 / p95 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **gpt-oss-120b** (schema-enforced) | Workers AI | **yes** | **22/25 (88%)** | 22/25 | **10/10** | 5/5 | 3.8 s / 13 s |
| gpt-oss-120b (no schema)* | Workers AI | yes | 15/25 (60%) | 18/25 | 10/10 | 4/5 | 1.8 s / 9 s |
| Gemini 3.8-flash | AI Studio | **no** | 25/25 (100%) | 25/25 | 10/10 | 5/5 | 3.5 s / 8.3 s |
| Gemini 3.5-flash-lite | AI Studio | **no** | 25/25 (100%) | 25/25 | 10/10 | 5/5 | 1.3 s / 1.7 s |
| qwen3.8-27b | Workers AI | yes | incomplete (24/35 answered, 48% of 25) | | | | 26 s / 91 s |
| gemma-4-26b-a4b | Workers AI | yes | incomplete (23/35 answered, 36%), 9 invalid JSON | | | | 19 s / 37 s |
| llama-4-scout | Workers AI | yes | not run (quota) | | | | |

\* Scored on the question set before the three gold-answer corrections in finding 8 (its two affected questions were not re-run); the schema-enforced row above is the fully re-scored one.

qwen, gemma and llama-scout are **inconclusive**: the free 10,000-neuron daily allocation ran out mid-run, and the partial runs were also very slow. Retest after the quota resets (00:00 UTC = 05:30 IST) or on the paid plan before ruling them in or out. Gemini is only valid for public data (see below), so it cannot be the private path whatever its score.

Hallucinated answers to unanswerable questions: 0 for every completed model.

## Findings

1. **Private path works: Workers AI gpt-oss-120b clears the gate** (88% grounded, 100% correct refusal, Hindi 5/5). Remaining misses: 2 empty/invalid JSON replies (retry/fallback) and 1 quote that merged two sentences. Sample is small (35 questions, 5 papers): treat the percentages as +-15 points.
2. **Structured output must be enforced.** Without `response_format` json_schema, gpt-oss on Workers AI emitted raw Harmony tokens (`<|channel|>final answerable=true ...`): 6 of 35 unparseable and grounded fell from 88% to 60%. The gateway always sends the schema, and treats unparseable output as a failed attempt.
3. **Quote verification must be fragment-wise and typography-tolerant.** Strict substring matching wrongly failed correct answers (PDF hyphenation, "..." joins). The same deterministic check will guard production answers; every quote is machine-checked, never judged by another LLM. Clean GROBID text should improve it further.
4. **The free Workers AI quota is tiny.** 10,000 neurons/day for the whole account was exhausted by about 120 answer calls (all models plus embeddings), so roughly **100 grounded answers per day for the entire product**. That is a pilot-of-a-few-people budget, not a beta budget.
5. **Cost on the paid plan (estimate):** ~80-90 neurons per answer at 2.2k input / 0.26k output tokens, i.e. about $0.001 (about 8 paise) per answer at $0.011 per 1,000 neurons. 100 active users x 10 answers/day = 1,000 answers/day = roughly **$27/month (about Rs 2,400)**. Verify on the Workers AI pricing page before budgeting.
6. **Latency:** reasoning models take 3-4 s median and 13 s p95. Phase 1 UX needs a visible "reading the paper" progress state; streaming plain answer text and checking quotes afterwards is an option to evaluate (schema mode does not stream partial JSON nicely).
7. **Gemini's quality is excellent but its unpaid tier is public-only** (Google may use prompts for training; humans may read them). It is routed only for public tasks (query classification, public abstract summaries). Its free per-day limit is not published; the unpaid key must not receive manuscript text.
8. **Benchmark hygiene:** three gold answers were corrected after reviewing disagreements (cholera model is named both SITRV and SITRVB in the paper; "May 6, 2018" is a valid date format; the physics paper has 16- and 18-student cohorts in different years, so the question was disambiguated). Corrections apply to every model equally and the already-cached answers were re-scored.

## Decisions
- Private tasks (`qa`, `review`, anything touching a manuscript): Workers AI `gpt-oss-120b`, schema-enforced, single model until a second one is benchmarked.
- Public tasks (`classify`, `summarize_public`): Gemini 3.5-flash-lite first (fast, 100% on this set), Workers AI as fallback.
- Retrieval: hybrid BM25 + bge-m3, top 6 passages.
- Budget: pilot (10 users) fits the free tier only if usage is light; plan for **Workers Paid (~$5/month base) plus about $30/month of inference** for the 100-user beta.
- Anthropic/other paid APIs were not benchmarked (no key); revisit if Workers AI quality or limits become a problem.

## Next
Retest gpt-oss-20b (cheaper), llama-4-scout, qwen and gemma after the quota resets; enlarge the question set to 100 across 10 papers (including tables, figures captions and multi-passage questions) before the Phase 1 exit gate; move this harness into CI with a small fixed subset.
