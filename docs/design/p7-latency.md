# P7: time to the first words of an answer (measured and decided, 28 Oct 2026)

The target of the plan was "Q&A first answer text under 2.5 s". This measures where the time goes with the real model and the real sources, tries the obvious lever (a faster model), and records what was **not** done and why. Scripts: [latency-live.mjs](../../apps/api/scripts/latency-live.mjs) (deployed staging, real network), [chat-eval.mjs](../../apps/api/scripts/chat-eval.mjs) (now with first-word times and `--dump` of every answer), [qa-eval.mjs](../../apps/api/scripts/qa-eval.mjs), [router-eval.mjs](../../apps/api/scripts/router-eval.mjs).

## 1. What a person waits for today

| Path | Time to the papers | First word of the answer | Whole answer | Where |
| --- | --- | --- | --- | --- |
| A question about a paper of your own (12 questions, 3 papers) | passages 0.2 to 1.4 s (median 1.0) | **median 4.2 s, slowest 13.7 s** | median 7.7 s, slowest 17.3 s | deployed staging |
| A search in the prompt box (5 questions) | 2.3 to 9.1 s (the search, the DOI and retraction checks) | **median 13.3 s, 5.8 to 25.2 s** | median 16.3 s, 7.9 to 28.7 s | deployed staging |
| The same, 12 questions, with the model's share cut out | median 4.1 s | **17.7 s (13.9 s after the papers)** | 26.6 s | a local Worker, real model and sources |
| The 35 gold questions, all answers | n/a | n/a | **median 3.2 s** (1.5 to 7.9 s) | a local Worker |

So the roadmap's "1.5 to 3.3 s" was the best case of one measurement, not the usual. **A question about a paper is usually answered in 3 to 8 s; the prompt box takes 13 to 18 s to its first word**, and of that about 14 s is the model.

**Why the prompt box is slow.** gpt-oss-120b reasons silently before it writes. R5 already found that "low" is the lowest setting it has. For a question about one paper it thinks a few seconds; for "what do these eight abstracts say about this topic" it has to read, compare and decide, and thinks for 10 s or more. Nothing in our code waits: the papers are on the screen at 2 to 9 s with the step "Reading the papers" lit, and the first word comes when the model's thinking ends.

## 2. The lever tried: a model that does not think first

The same 12 prompt-box questions (and two nonsense controls), then the 35 gold questions about papers, with the private `qa` task sent to other Workers AI models through the development switch `LLM_QA_MODEL` (a local Worker, real search, real model, 27 to 28 Oct 2026):

| Model | First word after the papers | Whole reply | Answered of 12 | Gold questions: correct / declined / sources verified / supporting passage cited |
| --- | --- | --- | --- | --- |
| **gpt-oss-120b** (now) | **13.9 s** | 26.6 s | **12** | **100% / 100% / 100% / 92%** (median 3.2 s) |
| Llama 4 Scout | 0.8 s | 10.6 s | 11 | 100% / **89%** / **88%** / **72%** |
| Mistral Small 3.1 | 0.9 s | 8.6 s | 10 | 89% / 100% / 100% / **68%**, 6 of 35 failed to answer |
| Llama 3.3 70B fast | 1.5 s | 11.0 s | 11 | 100% / **80%** / 92% / **77%**, 3 failed |

(The whole-reply column is not a fair comparison of the models: the later runs found the searches in the public cache. The "after the papers" column is.)

**They are 10 to 15 times faster to the first word, and all three are worse.** The checks of the prompt-box gate (every sentence shown is in its abstract, no retracted paper cited, clean marks, nonsense gets no answer) passed for every model, because those checks look at the sentence that is cited, not at whether the claim is supported by it. Reading the answers is what shows the difference. On the first five questions the fast model (Scout):

- writes about the papers instead of from them: "The coverage is full, as all papers address transformer models…", "The papers provide partial coverage of the topic…" inside the answer;
- lists what each paper is about where gpt-oss writes what they found (for intermittent fasting gpt-oss gave HOMA-IR figures from two meta-analyses; Scout gave no answer at all);
- in one answer cites mark [1] for "70-80% efficacy against severe childhood tuberculosis" with a sentence about the incidence of tuberculosis in the UK: a real sentence, so the check passes, and not the one that supports the claim.

That last one is the real cost: **a weaker model uses the check's blind spot** (it proves the sentence exists, not that it supports the claim). A faster answer that is more often wrong in a way the program cannot see is not a better answer for a tool whose promise is that you can check it.

## 3. Decisions

1. **Questions about a paper (own PDFs and "Ask this paper"): no change.** The gate (R5) already ruled out the other models; Scout, Mistral and Llama 3.3 70B fail it too (table above), and the median answer is 3 to 4 s.
2. **The prompt box's answer and a literature scan's answers: no model swap.** A "fast first, strong when the check fails" design was built and measured on the way (the common case would have been 1 s to the first word), and **taken out again** because the common case would then have shown the weaker answers. Nothing of it is in the code.
3. **What would help without lowering the answer, and is not done:** starting the model before the DOI and retraction checks finish (saves 2 to 4 s of the wait, but the evidence must exclude a retracted paper, so it needs the check first); fewer or shorter abstracts for the model (it would shorten its thinking, and costs the answer detail; to be tried with the gate, not assumed); a smaller question for the model to think about. None changes the order of magnitude: the thinking is the wait.
4. **What is honest to say now:** the target "answer text under 2.5 s" cannot be met with a reasoning model, and is met by a model that is worse. The roadmap line is rewritten: questions about a paper 3 to 8 s, the prompt box 13 to 18 s with the papers on screen after 2 to 9 s.

## 4. The router of Auto mode: a faster model works, and gains almost nothing

The router (rules, then a small model for what the rules cannot settle) is the one place where a fast model is safe: its output is a tool name and English search words, and the rules around it check them. The same 203 labelled messages (163 tuned, 40 held out; English, Hinglish, Hindi) through `LLM_CLASSIFY_MODEL` (a development switch, never set in a deployed Worker):

| Classify model | Overall | Language | Translated | Safe | 203 messages took |
| --- | --- | --- | --- | --- | --- |
| gpt-oss-120b (now) | 100% | 98.5% | 100% | 100% | 131 s |
| Mistral Small 3.1 | 100% | 98.5% | 100% | 100% | 44 s |
| Llama 3.3 70B fast | 100% | 98.5% | 100% | 100% | 60 s |
| Llama 4 Scout | 99.5% | 98.5% | 100% | **92.3%** | 45 s (4 fell back to a search) |

So Mistral and Llama 3.3 pass the router's gate as well as gpt-oss. **But the router is not where the time goes**: 169 messages needed the model, in 131 s one after another, so about **0.8 s a message** with the model we use, and about 0.3 s with Mistral. A saving of half a second on a message that needs the model (not on English questions, which the rules settle) is not worth a second model in the router's path. **Not changed.** (If the router ever becomes slow, Mistral Small 3.1 is the one to try: it passed.)

## 5. What was added instead, and what this leaves open

- **A line that says what to expect.** While the model reads the abstracts the prompt box now says that it takes about 10 to 20 seconds (the measured range), under the step it is on. The wait is the same; not knowing how long it is was part of what made it feel long.

- **A better judge of "supported by the sentence": built the same day, see [claim-support.md](claim-support.md).** (What this section said before it was built:) The blind spot above is general (gpt-oss has it too, less often). A deterministic check cannot prove support; a second model reading claim and sentence could flag the worst cases. It would cost a call per answer; it is the idea behind the "verify and repair" step of [research-patterns.md](research-patterns.md) and should be measured with the answer counters before it is built.
- **Perceived time.** The prompt box shows the papers first and the step it is on; what could be added at no risk to the answer is the first sentence of the *abstracts* of the top papers while the model thinks (they are real text from real records). Not built.
