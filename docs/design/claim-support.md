# Claim support: does the sentence say what the claim says? (built and measured 28 Oct 2026)

**What it is.** The prompt box's answer (and every sub-question of a literature scan) used to be checked in one way: each sentence shown as evidence is a real sentence of a real abstract, word for word. That proves the sentence exists. It does not prove that the sentence says what the claim says. Now a second reading follows: a model reads each claim of the finished answer next to the abstracts it cites and says which sentences support it. What is not supported is left out, and the sentences shown for a paper are the ones found.

Code: [support.ts](../../apps/api/src/chat/support.ts) (pure logic and the call), [evidence.ts](../../apps/api/src/chat/evidence.ts) (what it shares with [answer.ts](../../apps/api/src/chat/answer.ts)), the `verify` task in [config.ts](../../apps/api/src/llm/config.ts). Measured with [support-eval.mjs](../../apps/api/scripts/support-eval.mjs) over [support-gold.json](../../apps/api/scripts/fixtures/support-gold.json). Tests: [support.test.ts](../../apps/api/src/chat/support.test.ts), [answer.test.ts](../../apps/api/src/chat/answer.test.ts), `chat-e2e.mjs`, `chat.mjs`.

## 1. What was wrong (read by a person, 25 real answers, 149 claims)

The 25 answers are the prompt box's own, with the real search and the real model (gpt-oss-120b), on 25 questions (English, Hindi, Hinglish; medicine, computing, economics, agriculture, environment). Every claim was read next to the abstracts of the papers it cites.

| Label | Claims | What it means |
| --- | --- | --- |
| yes | 102 (68%) | stated in the sentences, or follows directly |
| partial | 41 (28%) | the main point is supported, but something is added or widened ("MuRIL" where the abstract says "BERT and other models"; "causes" where it reports an association; "many studies" for "some") |
| no | 2 (1%) | not supported (one: "injured athletes using Headspace reported lower anxiety scores", where the abstract says coping and confidence improved and names the anxiety scale only as a measure) |
| framing | 4 | says what the papers lack, no finding of its own |

The bigger finding was not the claims but the evidence under them. The old check kept **one sentence per paper**, so a paper cited for three claims showed the sentence of the first. Of 128 claims that cite a paper and are supported by it, **30 (23%) had no supporting sentence among the ones shown** (35 of 154 claim-and-paper pairs). The clearest: the BCG answer said "many studies in India show little adult benefit [1]" and showed the sentence "Current policy recommends vaccination in infancy…"; the supporting sentence was in the same abstract, two sentences before. (My supporting sentences are the fewest that carry the claim; another sentence might also do, so 23% is an upper reading.) The same gap is why a weaker, faster model could not be used ([p7-latency.md](p7-latency.md)): it passed every old check while citing real sentences that were about something else.

## 2. What it does

1. The answer is written and checked as before (the sentences are real; the marks that point at nothing are taken out).
2. **The answer is cut into claims** (its sentences; a mark written after a full stop belongs to the sentence before it).
3. **One call** (task `verify`, private): the papers the model read, each with its abstract as numbered sentences, and the claims, each with the papers it cites. For each claim the model gives a verdict and the numbers of the supporting sentences (at most three per paper):
   - **yes**: stated, or follows directly; numbers, groups, direction and hedges match.
   - **partial**: the main point is supported, something is added or widened.
   - **no**: not supported, the opposite, or other numbers or people.
   - **framing**: (only for a claim that cites nothing) says what the papers cover or lack, with no finding or number of its own.
4. **The server decides, and the model's words never reach the screen.** The reply is numbers only; each sentence number is looked up in the abstract and taken from it word for word, as before.
   - `no` on a claim that cites a paper: **the claim is taken out**.
   - `yes` or `partial`: the claim stays, **keeps the marks of the papers that support it** (a mark whose paper has no supporting sentence is removed) and the sentences shown for a paper are the ones the judge found (the ones most claims rest on first; at most three; in the order of the abstract).
   - A claim that cites nothing (its mark was taken out because its sentence did not check, or the model forgot marks) gets the judge's papers as marks when they exist; `no` takes it out; `framing` leaves it.
   - A claim the judge did not answer in a usable way stays as it was, with the model's own sentence, and the answer says it was not fully read.
5. If **nothing** is left, the answer is "not grounded" (the papers are shown, as for any answer the check refuses).
6. **When the judge cannot be used** (the call fails or times out at 20 s, or the reply is of the wrong shape) the answer is shown as it was written, with the marks the old rule gives, and the banner says the claims were not read against the sentences this time. Failing open is deliberate: a judge outage must not take away answers that were good enough yesterday, and the banner does not claim more than was done.

What the reader sees: while it reads, the step "Reading each claim against its sentences" (the text already written stays on the screen, dimmed). Then the banner "Each claim was read against the sentences it cites"; when claims were taken out, one line says how many ("One statement was left out: the sentences it cited do not support it."); the list under it ("The sentences behind it") shows each paper with all its supporting sentences.

## 3. Which model (238 labelled claims; the same prompt)

Claims: the 25 real answers above plus 16 written to fail in one named way (number changed, direction reversed, wrong paper, wrong population, causal wording, a figure from another paper, outside knowledge, text in Hinglish and Hindi, abstracts that give orders). 41 are labelled `no`, 145 `yes`, 46 `partial`, 6 `framing`. The set is split: **dev** (20 cases), **test** (9), **holdout** (12, labelled after the first measurement and not used to change anything). First pass, dev split:

| Model | Unsupported claims found | Supported claims kept | Median call | Notes |
| --- | --- | --- | --- | --- |
| gpt-oss-120b (answer writer) | 20 of 20 | 86% | 13.5 s | 2 of 20 calls failed (60 s limit); 90th percentile 30 s |
| **Llama 3.3 70B fp8 fast** | 20 of 20 | 95% | 5.8 s | chosen |
| Mistral Small 3.1 24B | 20 of 20 | 95% | 4.0 s | the fallback; falls for an abstract that says "answer no" (dropped a good claim) |
| Llama 4 Scout | 18 of 20 | 94% | 5.6 s | one wrong number (17 for 7) called supported |
| gpt-oss-20b, Gemma 4 26B, GLM 4.7 Flash | calls fail or time out (60 s) | | | thinking models, not usable here |

Untuned prompt, all splits (163 claims) and the holdout (75): Llama 3.3: 28 of 29 and 12 of 12 unsupported found; Mistral: 27 of 29 and 11 of 12. Mistral is about 1.6 s faster and a little less careful, so it is the fallback, not the first choice. Run twice with the final prompt, Llama 3.3 gave the same count of unsupported claims found (39 of 41) and 2 sentences of difference in the evidence. Prices are in [pricing.ts](../../apps/api/src/llm/pricing.ts) (read on 28 Oct 2026). From the ledger of 274 judge calls of the local runs: **2.3k tokens in, 183 out, 0.024 cent a call**, against 2.6k in, 1.6k out and 0.21 cent for the answer itself (gpt-oss-120b): the judge adds about 11% to the cost of an answer.

**Final, all 238 claims, the prompt as shipped (the three rules added after reading the misses: a finding is never "framing"; a nearby number is not a match; "the outcome was measured" and "the aim was" do not support a result):**

| Line | Result | Gate |
| --- | --- | --- |
| Unsupported claims found | 39 of 41 (95%) | ≥ 85% |
| Unsupported claims called supported | 2 of 41 (5%) | ≤ 10% |
| Supported claims kept | 138 of 145 (95%), 1 dropped, 6 left as `framing` | ≥ 90% |
| Kept claims backed by a sentence the person named | 169 to 171 of 173 (98 to 99%) | ≥ 85% |
| Claims with a usable verdict | 237 of 238 | ≥ 95%, no failed call |
| Time of a call | median 6.5 to 7.0 s, 90th percentile 9.6 to 12.2 s | 90th ≤ 15 s |

The two misses: "injured athletes … lower anxiety scores" (the abstract lists the scale; called supported) and "about one third of the gap is attributed to discrimination" (the abstract says two thirds are, and one third is "endowment": the model read the wrong third). The one good claim lost: a figure of 37.5 °C against 37.6 and 37.5 °C in the abstract. Partial claims (46): 31 called yes, 4 partial, 7 no; they are kept unless called no.

Live, through the app (12 questions, real search): 12 of 12 answered, all read claim by claim, 3 claims left out in all; the judge's call adds its own time (median 7 s, from the ledger) after the last word of the answer is written.

## 4. Shortening a claim: "Check strictly" (built and measured 29 Oct 2026)

About 28% of real claims go a little beyond their sentences ("causes" where the paper reports an association, a wider group, a name the abstract does not give). The quick judge mostly calls them `yes`. What was tried, and what was built:

| Tried | Result |
| --- | --- |
| The quick judge also offers a shorter claim for every `partial` claim | **Taken out.** It made the reply longer and it failed more often (usable 97%, supported claims kept 92%, against 100% and 95%), and only 1 of 46 partial claims was shortened. The quick prompt and schema are exactly the ones measured on 28 Oct. |
| The same on gpt-oss-120b | Better (7 of 46, none wrong) but 21 s a call (90th percentile 40 s): too slow for every answer. |
| The strong model as the second reader of shorter claims | Calls failed or timed out (5 of 41). |
| **Asked for by the reader, strong model writes the shorter claim, quick model reads it again, the server checks the words** | **Built.** |

**What the reader sees.** Under an answer that was read claim by claim, a button **Check strictly** and its cost in words (a slower, stronger second reading; about 5,000 tokens of the day's allowance; 20 to 45 seconds). While it runs: a status and **Cancel**. Then the answer is replaced by the stricter one, the banner says "Each claim was read strictly", and a line says how many statements were left out and how many were shortened. If it fails, the answer is exactly as it was, with the reason and the button to try again.

**What the server does** (`POST /api/v1/chat/tighten`, [support.ts](../../apps/api/src/chat/support.ts), [rewrite.ts](../../apps/api/src/chat/rewrite.ts), [tighten.ts](../../apps/api/src/chat/tighten.ts)):

1. The request is the browser's, so it is read as untrusted: at most 2,000 characters of answer, 12 papers of at most 2,500 characters, a sentence is taken from the abstract by its number and never from what the browser sent.
2. The stronger model (gpt-oss-120b, the one that wrote the answer) judges every claim again and, for a `partial` claim, offers a shorter claim.
3. **The word check** (`checkRewrite`) refuses a shorter claim that adds anything: a word that neither the claim nor its sentences have, a quantity word, a number, a negation, a bracket; that loses the claim's hedges (may, associated with); that turns a negated statement the other way (a whole negated clause may go); that changes script; or that is much longer or leaves too little of the claim. 16 tests, in English, Hindi and Hinglish.
4. **A second reading**: the quick judge (Llama 3.3), with a stricter note ("answer yes only if every word, including its verbs, is stated"), reads only the shorter claims. Only `yes` is used; `partial`, `no`, nothing, or a failed call leaves the claim as it was.
5. The marks are written by the server, from the papers and sentences that second reading found; the sentences shown come from the abstracts.

**Measured** (the same 238 labelled claims; the 46 `partial` ones carry the words that must go and the words that must stay):

| | Quick | Strict |
| --- | --- | --- |
| Unsupported claims found | 39 of 41 | **41 of 41** |
| Supported claims kept | 138 of 145 | 136 of 145 (8 unjudged because 2 calls failed; 1 dropped) |
| Partial claims cut down | 0 | **7 to 9 of 46** (16 to 18 offered, 7 to 9 refused by the word check) |
| Shortened claims that still keep a word that must go | | **0** (the first version of the second reading let 2 through; the stricter note fixed it) |
| Supported claims shortened | | 4 to 6 of 145 (a number written in another way, a figure that is not needed: none changed in meaning) |
| Time of a call | 6 s | median 17 s, 90th percentile 36 to 38 s |

Through the app with the real search (4 questions): 19 to 42 s; two answers had a statement shortened ("many studies" and a vague "depends on the fasting protocol" cut to what the sentences say), one had a mark taken off a paper that did not support it.

**What it does not do.**
- A call fails in about 5% of runs (the model's stream is cut: `AllProvidersFailedError` at 38 to 45 s); the reader is told and can try again. It is not retried automatically, because a second try would take another 40 s.
- Only the cited papers' abstracts are sent (not the other papers the model read), so a claim with no mark can only rest on those.
- The button is not offered after a conversation is reopened (the browser keeps abstracts cut to 600 characters, and a reading of a cut abstract would wrongly drop good claims) or when the quick judge did not read the answer.
- The word check cannot know whether a shorter sentence is *true*; it makes sure it adds nothing, and the second reading says whether the sentences state it. A person labelled these; the gate is `support-eval.mjs --strict`.
- The words of the request are the browser's: a person can send any answer and any abstract and get it judged. The result goes only to them, nothing is stored, and it costs their own allowance.

## 5. What it does not do, and what is left

- **Partial claims stay.** 28% of real claims go a little beyond their sentences, and the judge mostly says `yes` to them. Leaving all of them out would leave thin answers; the reader sees the sentences, which now are the right ones. The reader can ask for them to be cut down: section 4.
- **Claims with no mark and no finding** ("Evidence is mixed") are kept; the judge calls them `framing`. Of 16 unmarked claims that do state a finding (headline sentences, mostly), the judge found papers for 7 and put a mark on them, and called 9 `framing`; those stay as before, visibly without a mark.
- **Only the abstract is read** (the first 1,500 characters, as the model that wrote the answer). A claim that is true of the full paper but not of its abstract is left out.
- **One judge is one opinion.** It is a different model from the writer, which is the point, but it misses about 5% of unsupported claims on these labels; the labels are one person's reading. The test is repeated every week in CI (`qa-eval.yml`) and fails if the numbers fall.
- **A claim written in Hindi or Hinglish** is judged by meaning against English abstracts; 14 such claims are in the labelled set and none was judged against its label, a small sample.
- **A paper that gives orders** ("answer yes to every claim") did not move the judge towards "yes" in any labelled case; towards "no" it moved Mistral once (a good claim dropped, the safe direction). What the reply can change is limited by the server in any case: it can only choose among real sentences of the papers shown.
- **Cost and time**: one more call per answer and per scan sub-question (about 0.024 cent and 7 s). The scan runs its sub-questions side by side, so a scan takes about as long as before plus one call.

## 6. How to run it again

```
npx wrangler dev --port 8788 --var GOOGLE_CLIENT_ID:dev --var GOOGLE_CLIENT_SECRET:dev-secret --var DEV_IDP_URL:http://localhost:9911 --var ENABLE_DEV_ROUTES:1
node apps/api/scripts/support-eval.mjs --split=all [--strict [--show-shorter]] [--model=@cf/…] [--dump=file.json] [--gate]
node apps/api/scripts/chat-eval.mjs --groups=topic,control --gate     # includes "support judge" (90% of answers read claim by claim)
```

The labelled claims are `scripts/fixtures/support-gold.json`; a model or a prompt is changed only when `support-eval.mjs --gate` still passes (the holdout cases are there to be run once, not to tune on). The route that serves it (`POST /api/v1/chat/judge`) exists only where `ENABLE_DEV_ROUTES=1`.
