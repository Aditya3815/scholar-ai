# R5: where the tokens and the money go, and what can be cut

Date: 2026-10-23. Question: what does one unit of work cost (a question, an Idea Check, a scanned page), is the number we had right, and which of the usual savings
(a cheaper model, less thinking, shorter prompts, caching) are worth doing without making the answers worse? Everything below was measured on the real models through the real
routes unless it says otherwise. Prices are Cloudflare's, read on 2026-10-23 from <https://developers.cloudflare.com/workers-ai/platform/pricing/>.

## Short answer

1. **Our own metering was wrong.** Every streamed answer (all of Idea Check, all Q&A in the app) was counted with **twice** its output tokens, and cost was never written
   (`cost_cents` was 0 for every call). Fixed. This changes what the daily allowance means: 60,000 tokens is now about **5 whole Idea Checks, not 2 or 3**.
2. **Money is not the problem at pilot size.** One question costs about **$0.0008**, one Idea Check about **$0.007**, one scanned page about **$0.002**. An active scholar costs
   roughly **5 to 35 cents a month** (a heavy scanned-thesis user about a dollar); the $5 Workers Paid base fee is larger than all the AI use of the first hundred people.
3. **The one place with real waste was quality, not cost:** asking the model to copy a sentence word for word made the app throw away 1 to 13 correct matches per Idea Check (a
   changed hyphen fails the check). Asking for the sentence's **number** instead drops that to 0, shows more verified matches, and is a little cheaper. Shipped.
4. **No cheaper model passed.** For Q&A the cheaper models either ignore the answer format (gpt-oss-20b, Gemma 4) or fail the quality gate (Qwen3: 3.5 times cheaper, 6 of 35
   questions failed, one unanswerable question answered). For Idea Check the cheaper models (Llama 4 Scout, Mistral, Llama 3.1 8B) are 50 to 85% cheaper but **a third of the
   matches they show are ones gpt-oss-120b does not see**. Not worth it for a tool that must not mislead.
5. **Thinking is most of the output.** For gpt-oss-120b about 70% of the output tokens of an Idea Check step are hidden reasoning, and "low" is already the lowest setting.

## 1. What things cost (measured)

Tokens are in / out. Neurons are Cloudflare's billing unit ($0.011 per 1,000 above the free 10,000 a day); for gpt-oss-120b one thousand input tokens are about 32 neurons and one thousand output
tokens about 68.

| Unit of work | Tokens in / out | Cost | How measured |
| --- | --- | --- | --- |
| A question about a paper (gpt-oss-120b, top 6 passages) | 1,569 / 276 | **$0.00076** (about 69 neurons) | 35 gold questions on 5 papers, `scripts/qa-eval.mjs`; 100% correct, 100% unanswerable declined, 100% verified |
| An Idea Check, whole (plan + comparison + second reading) | 6,800 / 6,300 | **$0.0071** (about 650 neurons) | 3 real ideas, `scripts/idea-live.mjs`. Plan 0.07 cents, comparison 0.29, second reading 0.34 |
| A scanned page, read by two models | about 600 to 2,400 in (the picture counts as input), 200 to 1,000 out, for each of the two | **about $0.002** (about 180 neurons) | 6 real pages, see [../ocr.md](../ocr.md) |
| Indexing a 30-page paper (embeddings, bge-m3, $0.012 per million tokens) | about 21,000 | **$0.0003** | calculated from the price |

The free allowance of 10,000 neurons a day (the whole account, tests and CI included) is worth about 145 questions, or 15 Idea Checks, or 55 scanned pages.

### Per person, per month (calculated from the table, not measured over time)

| Kind of use | What | Cost |
| --- | --- | --- |
| Light | 5 papers, 40 questions, 2 Idea Checks | about $0.05 |
| Heavy text | 20 papers, 300 questions, 15 Idea Checks | about $0.35 |
| Scanned thesis | 100 pages read, 50 questions | about $0.25 |
| Heavy scanned | 600 pages, 100 questions | about $1.30 |
| **Worst case at today's limits, every day** | 60,000 tokens + 60 scanned pages a day | about $0.15 a day, **$4.50 a month** |

The pilot will show the real mix. The admin page now has the numbers to compare against (section 4).

## 2. The metering bug

Workers AI sends usage twice in a stream: a small amount with nearly every chunk and, in the last chunk, the totals for the whole call. Measured on a 66-token answer: the pieces added up to 66
and the last chunk said 66. `readChatStream` added both. Streamed output was counted twice; input was right (it is only in one chunk). The replay of the same prompts without streaming reported
2,700 output tokens for the comparison step while the app's ledger said 5,000. Effects: the daily allowance used up twice as fast as it should, any cost estimate from the ledger was about 70% too high
for Idea Check (1.29 cents measured, 0.77 cents once counted correctly, same code), and the numbers in the roadmap and the Idea Check design doc ("19,000 to 24,000 tokens a check") were doubled
on the output side. Fix: when a chunk has both counts it is the totals and replaces the sum; tested with the real chunk shape. Non-streaming calls were always right.

Also found: Workers AI does **not** report how many output tokens were reasoning, and reports 0 cached input tokens for every model we use, so those cannot be metered; the thinking share below
comes from the size of the reasoning text in the replay.

## 3. Options measured

### 3.1 Thinking (gpt-oss-120b)

Replay of the comparison step on three real ideas, same prompt, "low" against "medium": output 2,726 and 2,940 tokens, i.e. no saving from low to medium, and the results differ as much between two
runs of the same setting as between settings (below). "Low" is the lowest the model has. The visible JSON is about 30% of the output; the rest is thinking (10,000 characters of reasoning against
4,000 of answer). **Conclusion: nothing to cut by setting; the only ways down are a model that does not think (3.4) or a smaller answer (3.2).**

### 3.2 Evidence by sentence number (shipped)

The comparison and the second reading used to ask the model to copy a sentence of the abstract exactly, then checked it. Two things were found:

- **The model does not copy reliably, and it varies by itself.** Same prompt, temperature 0, run twice: 19 and 22 verified matches on one idea, 2 and 5 on another; 1 to 13 claims per check were dropped
  because a quote did not match (a hyphen, a space, a changed word). Correct judgements were thrown away.
- Asking for the **sentence number** (the prompt numbers each abstract's sentences) gives the evidence by construction: it is part of the abstract word for word.

| Comparison step, 3 ideas, 2 to 3 runs each | Tokens out | Cents | Matches shown | Claims dropped |
| --- | --- | --- | --- | --- |
| Copy the sentence (before) | 2,824 | 0.318 | 9.3 | **6.3** |
| Give the sentence number (now) | 2,427 | 0.289 | **15.8** | **0.0** |

Second reading: claims dropped 4.8 to 0.5 a check, answer statements 4.8 a check against 3.0 (the evidence of an answer no longer fails the copy check), cost 0.394 to 0.375 cents. In the real app (3 ideas, whole check): **comparison 0 dropped (before 9, 10, 2), second
reading 0 to 1 dropped (before 2 to 5), 0.71 cents a check**. The method and data phrases are still copied (short, and they were not the main loss). A number that is not one of the abstract's sentences
is a dropped claim, counted like a quote that is not there. `packages/shared/src/sentences.ts`, `apps/api/src/idea/sentence-refs.ts`.

Honest limit: this is a quality and robustness gain with a small cost gain (5 to 10%). Whether the shown sentences are the *right* ones is as good as the model's judgement; measured against
the majority of its own runs (which includes the run being scored, so an upper bound) it agrees on 96% of the cells it shows and 92% of the cells the majority shows.

### 3.3 Cheaper models for Idea Check (not adopted)

Comparison step, sentence-number prompt, 3 ideas, 3 runs each. A cell (paper × part) counts as agreed when at least half of gpt-oss-120b's runs show it.

| Model | Tokens out | Seconds | Cents | Shown | Precision | Recall |
| --- | --- | --- | --- | --- | --- | --- |
| gpt-oss-120b (reference) | 2,385 | 31 | 0.289 | 14.6 | 96% | 92% |
| Llama 4 Scout | 593 | 31 | 0.134 | 20.0 | **68%** | 83% |
| Mistral Small 3.1 | 704 | 13 | 0.154 | 15.3 | **75%** | 70% |
| Llama 3.1 8B (fp8) | 715 | 6 | 0.042 | 14.4 | **66%** | 62% |

They do not think, so they are cheap and fast, but each shows about a third more "this paper does the same" than the reference model, which is a false lead for a researcher. The reference model is itself
the yardstick here (there is no human-labelled set), so the real gap could be smaller or larger; with that doubt, a tool whose promise is "never mislead" should not take the 50 to 85% saving. Revisit with a
labelled set (roadmap I5).

### 3.4 Cheaper models for questions about a paper (not adopted)

Same 35 questions through the real pipeline. Baseline gpt-oss-120b: 100% / 100% / 100% verified, 0.0756 cents.

| Setting | Result | Cents |
| --- | --- | --- |
| gpt-oss-20b | **fails**: it does not follow the answer format (returns other keys) or returns nothing; 35 of 35 requests failed the JSON check | n/a |
| Gemma 4 26B | **fails**: no JSON in its output, 35 of 35 (the R2 spike saw the same) | n/a |
| Qwen3 30B-A3B | 95% answerable, **90% unanswerable declined (one wrong answer)**, 6 of 35 requests failed | 0.0217 (3.5× cheaper) |
| gpt-oss-120b, 4 passages instead of 6 | same gate (100 / 100 / 100), supporting passage cited 92% instead of 96% | 0.0560 (−26%) |

A question costs a thousandth of a dollar; Qwen3 would save three hundredths of a cent for a worse answer. Four passages instead of six would save 0.02 cents a question for a small, possibly real, loss in
how often the right passage is cited (35 questions cannot tell): **not changed**. If Q&A ever becomes a material cost, the order to try is: four passages, then Qwen3 first with gpt-oss-120b as the fallback for
the requests it cannot parse (the gateway already supports a chain), each against the full gate.

### 3.5 Caching, batches, the free allowance

- **Prompt caching:** Cloudflare lists a cached-input price only for some other models; the usage of every model we use reports 0 cached tokens, and our prompts differ in most of their length (the passages) anyway. Nothing to gain.
- **Batch (asynchronous) API:** the documentation names no discount. Nothing to gain.
- **Repeated questions:** the same question on the same paper is rare outside the five suggested chips; a cache would save almost nothing and add private data to store. Not done.
- **The free 10,000 neurons a day** are shared by the whole account, tests and the weekly evals included, so they cannot be counted on for users.

### 3.6 Scanned pages

- Cost per page: Llama 4 Scout 50 to 119 neurons, Mistral Small 3.1 56 to 166 (the 166 was a page where it looped to the 2,500-token limit). The checking model costs as much as the reader.
- **Gemma 4 cannot be the checker**: through Workers AI it saw the picture as about 330 tokens (the text prompt only) and wrote 2,500 tokens that never ended, for all six pages.
- **Resolution (150 dpi, 1,240 px wide): not concluded.** The model's image tokens fall with size (one page: 1,948 tokens at full size, 1,078 at 65%, 788 at 50%), but Llama 4 Scout through the research
  Workers failed most calls that hour with Workers AI errors (HTTP 499 and error 3045), so no quality comparison could be made; the spike's finding that enlarging and sharpening makes reading worse stands, and
  reducing size is untested for quality. Redo when Scout is stable, on pilot scans.
- Dropping the checking model would halve the cost but remove the gate that caught a model inventing a whole document (see R4): not done.

## 4. What shipped from this research

- The streaming usage fix (section 2) and a test with the real chunk shape.
- A price table (`apps/api/src/llm/pricing.ts`, with the source and the date; a test fails if a model that can be routed to has no price) and `cost_cents` written for every call.
- `llm_usage.label` (document question, Idea Check plan, comparison, second reading) and `tokens_cached` (migration 0012).
- **Admin page**: cost by model and by feature for the last 7 days, the 14-day total, and the scanned pages' cost (neurons × $0.011 per 1,000).
- Evidence by sentence number for Idea Check (3.2).
- The weekly Q&A workflow had been failing since the privacy note was added (the harness never agreed to it; the upload got a 403): fixed in `scripts/qa-eval.mjs`.
- Tools to repeat this: `scripts/qa-eval.mjs` and `scripts/idea-live.mjs` now print tokens and cost per answer or per step (`--tag=` names a result file), `scripts/r5-replay.mjs` replays the Idea Check steps with
  other models or prompts and measures agreement with a model's own majority, `scripts/r5-ocr.mjs` compares page readers and sizes. Dev-only knobs (`LLM_QA_MODEL`, `LLM_REASONING`, `QA_TOP_K`) exist only with
  `ENABLE_DEV_ROUTES=1`.

## 5. What I would do next (in this order)

1. **Watch the admin cost table for a week of the pilot** and compare it with section 1; the scenarios there are assumptions.
2. Leave the daily allowance at 60,000 tokens for the pilot (about 5 checks, a worst case of 3 cents a day in tokens); raise it if people hit it (roadmap D6). The scanned-page limit (60 a day, at most 12 cents) stays.
3. Put the Cloudflare billing alert at, say, $20 a month (yours, L8): at these prices it will not fire in a pilot, and if it does, something is wrong.
4. Re-run section 3.3 and 3.4 when a labelled set exists (I5) or a new model arrives; the scripts take one command.
5. When Llama 4 Scout is stable again, run the resolution comparison on scanned pages from the pilot.
6. Not worth doing now: caching, batches, a cascade for Q&A, fewer passages.

## Reproduce

```
node scripts/qa-eval.mjs <folder with the five R2 papers as .pdf and .txt> --tag=baseline        # the Worker needs ENABLE_DEV_ROUTES=1; for other settings add --var LLM_QA_MODEL:@cf/... or QA_TOP_K:4
node scripts/idea-live.mjs --tag=baseline --dump=<folder outside the repository>                  # real search keys in apps/api/.dev.vars; dumps the plan and abstracts for replay
node scripts/r5-replay.mjs <that folder> --step=compare --runs=3 --variants=idx:120b:low,idx:scout:low    # needs the forwarding Worker (generic: {model, body} -> env.AI.run)
node scripts/r5-ocr.mjs <folder of page JPEGs> --models=scout,mistral
```
