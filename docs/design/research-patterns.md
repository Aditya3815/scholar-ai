# Dynamic response rendering, evaluator-optimizer, async multi-agent orchestration: how they could be built here (research of 27 Oct 2026)

Asked: for each of the three concepts, how we could implement it in this application, with one rule fixed by the user: **progress events and text chunks are different event types.** Token streaming shows generated text as it is written; progress events tell the reader that long work is moving. They are never mixed in one event.

Facts about the patterns come from their own sources (linked at the end). Facts about our app come from the code and from spike R10 ([R10-fan-out.md](../spikes/R10-fan-out.md)). Where something is my inference it says so. **Nothing in this note is built yet**; section 5 says in what order it could be, and section 6 what is the user's decision.

## The short answer

| Concept | Verdict | Why, for this app |
| --- | --- | --- |
| **Event taxonomy** (progress ≠ text) | **Adopt now, as a written rule plus a check** | Our streams already follow it by habit (table in section 1). Writing it down and testing it keeps the next stream from breaking it |
| **Dynamic response rendering** | **Adopt in a narrow form: the server picks typed parts from checked data; the page renders each part by its type** | We already do this by hand (answer, cards, background, offers). A part registry removes the if-chains in `ChatView` and is what a long report would need. The model never chooses the layout |
| **Evaluator-optimizer** | **Adopt only as "verify and repair" with our own deterministic checker, and only after we measure how often it would fire** | Research shows a model correcting itself without outside feedback does not help. Our checker (the quote must be in the abstract) is outside feedback. One repair try is cheap; an open-ended loop is not |
| **Async multi-agent orchestration** | **Possible for one feature, "Literature scan"; not before the user decides about cost and storing the result** | R10 shows the Cloudflare mechanics work (parallel, failure-isolated, replayable). The open questions are cost (about 15× the tokens of one answer, against a 60,000-token daily allowance) and whether a report may be kept on the server |

## 1. Event taxonomy: progress and text are separate

Four kinds of thing travel on a stream. Each gets its own event type, and **one event type never carries two kinds**:

| Kind | Event type (proposed name) | Carries | Rules |
| --- | --- | --- | --- |
| Progress | `progress` | phase id, `done`, `total` (optional), worker id (optional), a short plain label | `done` only increases (this is MCP's rule for progress; a reader can then drop out-of-order repeats). Never contains answer text. Coalesced: at most about 4 a second per stream |
| State | `status` | one of `submitted`, `working`, `input_required`, `completed`, `failed`, `canceled` (A2A's list, trimmed) | One current state; `input_required` is the interrupt we already use for the Idea Check plan approval |
| Content | `part` (a typed block of the result), `token` (words of text still being written) | `part`: id, type, data, `append`, `last`; `token`: only text | `token` text is provisional and replaced by the checked `answer` part; a `part` with `last: true` is final |
| Notice / error | `notice`, `error` | code and a short plain sentence | `error` is terminal |
| End | `done` | outcome | **Exactly one** terminal event per stream (already enforced in `sse.ts`). Keep-alive stays an SSE comment line, not an event |

How the streams we have already line up (read from the code, not new work):

| Stream | Progress / state | Text | Result | Fits the rule? |
| --- | --- | --- | --- | --- |
| Chat (`/chat`) | `step`, `understood` | `token`, `general_token` | `papers`, `answer`, `general` | Yes |
| Open-access Q&A | `ingest` | `delta` | `answer` | Yes |
| Document Q&A | `stage` | `delta` | `answer` | Yes |
| Idea Check | `stage` | (none) | plan, papers, compare, insights | Yes |

So nothing has to be rewritten to keep the user's rule. What is missing is: (a) the rule written where the next developer reads it (this note, then a short section in the runbook); (b) `progress` with a `done`/`total` count, which today's `step` events do not have (a step says "searching", not "3 of 5"); (c) a shared test that feeds every stream through one checker: no text-bearing field on a progress or status event, no progress field on a text event, one terminal event, `done` never decreasing.

A second rule that matters for long work, taken from A2A: **a stream is a view, not the delivery mechanism.** A2A says events arrive in the order they were generated, that a client can re-subscribe to a task and gets the current snapshot first, and that streams are not guaranteed delivery (it offers polling and webhooks for that). For jobs longer than about half a minute the state lives in the database, events get a sequence number, and a reader that comes back asks for "events after N" (R10 tested exactly this).

## 2. Dynamic response rendering

**What it is.** The shape of the answer on the screen depends on what the answer turned out to be: a short checked answer with citations, a list of papers, a comparison table, a "not answered" note, a plan to approve, a general-background section under its label. In its strong form (A2UI, Vercel's generative UI) the *model* chooses the components. In its weak form the *program* chooses them from the kind of result.

**What we do now.** The weak form, by hand. `ChatView` decides from fields of the message (`answer`, `papers`, `general`, `offer`, idea) which block to draw, and each new feature added an `if`. It works and is tested (axe in light, dark and phone width), but every new block touches the same large component.

**Decision: stay with the weak form.** The model never picks components, because (1) every block on our screen has rules about what it may contain (a citation only from a checked sentence; background only under its label, never with a mark), and a model-chosen layout could break them; (2) our accessibility gate tests known blocks, not generated ones; (3) this was already the verdict on A2UI in [agent-concepts.md](agent-concepts.md).

**How to build it (when a second feature needs it, not before).**

1. **A typed `part`.** A closed list, defined in `packages/shared`: `answer` (checked text and marks), `papers` (cards), `background` (label, kind, text), `plan` (to approve), `offer`, `table` (compare), `notice`, later `section` (one block of a long report). Each has a `type`, an `id`, and data. The server builds parts only from checked data; the model fills only text fields inside them.
2. **A registry in the page.** `const RENDER: Record<PartType, Component>`; an unknown type renders nothing and logs one line (so an older page does not break on a newer server).
3. **Parts have ids and may be sent in pieces**, copying A2A's artifact events: `{ id, append, last }`. A long text part can grow by `append` events with `last: true` at the end. This is also where `token` ends: a live text is a part being appended to, marked provisional until `last`.
4. **Partial structured streaming only for the one text field.** The Vercel AI SDK can stream a partially built object (`partialObjectStream`), and we already do the narrow version: `AnswerFieldStreamer` pulls out only the `answer` string from half-written JSON. Streaming other fields of half-written JSON (a table filling cell by cell) is hard to make accessible (a screen reader would announce a half table) and is not needed: send a table whole, when it is checked.
5. **Accessibility rules stay with the registry**: each renderer owns its `aria-live` behaviour; progress text goes in one polite live region, answer text is not announced word by word.

**Cost.** About two days of refactor with the existing tests as the safety net (the browser suites already pin the behaviour). No new service, no new tokens. Risk: low, as long as the parts stay a closed list.

## 3. Evaluator-optimizer

**What it is.** One model call produces, a second judges it against criteria and says what is wrong, the first revises, and this repeats until the judge is satisfied or a limit is reached. Anthropic's guidance ("Building effective agents") says it is worth it when (a) there are clear evaluation criteria and (b) iteration measurably improves the result; both must be true.

**What the research says about when it fails.** Huang et al. (ICLR 2024), "Large Language Models Cannot Self-Correct Reasoning Yet": without outside feedback, a model asked to review its own answer does not improve it, and often makes it worse. Self-Refine (Madaan et al., 2023) reports about 20% absolute gains on average, but on tasks where the feedback can be specific (code readability, sentiment rewriting, dialogue). The pattern is therefore not "ask the model if it is sure": it needs a judge with something real to check against.

**Where we already have such a judge.** After the model writes the answer, the server checks each claim: the quoted words must be found in a sentence of the cited abstract (see [chat-w2.md](chat-w2.md)). That is external, deterministic and cannot be argued with. It also has a measured failure mode: sometimes the answer fails the check and the person sees "the papers found did not support a checked answer" (`not_grounded`). A tiny evaluator-optimizer exists already: `answerFromResults.ask` tries once more when the model's reply is malformed (W5), only if no words reached the screen.

**Proposal: verify-and-repair, one try.**

1. The checker already knows *which* claims failed and why (quote not found, mark points at nothing, sentence limit). Pass exactly that back to the model once: "These statements could not be found in the abstracts: … Rewrite the answer using only statements the abstracts support, or say that they do not answer." No general "improve this".
2. At most **one** repair call. Stop conditions: the check passes, or the repair is no better (fewer supported claims), or one try is used. The first answer's streamed words are already on screen, so the repair must run before the answer is declared final and show as `progress` ("checking again"), never as more `token`s that rewrite what was read.
3. Whatever remains unsupported after the repair is dropped, as now. The repaired text passes the **same** checker; nothing that fails is ever shown. So the optimizer cannot lower the guarantee, only raise the share of answered questions.
4. **Not for judging quality or novelty.** A model judging another model's "is this a good answer" has no outside check, which is exactly what Huang et al. found does not work. That includes anything that sounds like the Idea Check's "is this idea new": we do not claim novelty and do not add a judge for it.

**Measure before building.** Today we do not count *why* answers fail. Add counters (reason code and number, no text, no person; where they would live, for example a small daily table beside the admin page's other numbers, is part of P0): how many answers had every claim supported, how many lost some claims, how many were `not_grounded`, and for the last two how many claims were dropped. Then the eval (`chat-eval.mjs`, 12 questions that should be answered) tells how many a repair would turn into answers. In the last live runs the answered count was 10 to 12 of 12 with variance, so the possible gain is at most two questions of twelve, and it costs another model call (about $0.001) on the failed ones only. If the real-world `not_grounded` rate is under about 5%, **do not build it**.

## 4. Async multi-agent orchestration

**What it is.** A coordinating program (the orchestrator) splits a job into parts at run time, hands the parts to several workers (each a model call with its own instructions and tools) that run at the same time, then merges and checks the results. Anthropic calls the two relevant shapes *orchestrator-workers* (the subtasks are decided at run time, not fixed in code) and *parallelization* (sectioning: independent parts at once; voting: the same task several times). "Async" means the person does not wait with a connection open: the job runs on its own and the person may leave and return.

**Is it useful for us?** For today's questions, no: one answer is one call over at most eight abstracts, and splitting it would multiply tokens for nothing (the earlier verdict in [agent-concepts.md](agent-concepts.md): about 15× the tokens of one chat, as Anthropic reports for its research system, against a 60,000-token daily allowance). It would be useful for **one new kind of job that really is large and splits cleanly: a literature scan** ("what is known about X": five to eight sub-topics, each searched and read separately, merged into a short report in which every statement carries a checked citation).

**What the Cloudflare mechanics look like** (spike R10, measured on local `wrangler`):

```
Workflow "Scan" (one instance per scan id)
  step plan        model: split the question into 3-6 sub-questions        → shown to the person for approval (input_required)
  steps worker-1…n Promise.allSettled(step.do …): search + read + checked answer for one sub-question
  step merge       combine the sections, record the gaps
  step verify      same sentence check as chat, on the merged report
  step finish      write the report, emit done
```

What R10 showed: the five workers started within 15 ms and finished together (≈0.4 s for work that takes ≈2 s one after the other); a worker that failed for good was tried three times (first try plus two retries), then rejected, and the other four and the merge were unaffected; the merge received four sections and a record of the one gap; events with a `seq` could be replayed from any point. Not shown: the event list in D1, the deployed Worker, real model calls, `terminate()`.

**How progress reaches the screen (and why it is not token streaming).**

- Each step writes one row to an append-only `scan_events` table (scan id, `seq`, type, small JSON). **Rows never carry answer text except in `part` events**; progress rows carry phase, `done`/`total`, worker number and a label.
- `GET /scans/:id/events?after=N` is an SSE stream that first sends a **snapshot** (state, `done`/`total`, parts so far), then the rows after `N`, with the keep-alive comment and one terminal event; the browser keeps the last `seq` and re-asks after a drop (this is what `Last-Event-ID` would do; our `fetch`-based reader sets it by hand). `GET /scans/:id` is the polling fallback and the page after a reload.
- What the person sees: "Reading 3 of 5 sub-topics" with a bar (`progress`), a line per worker as it finishes (`progress` with worker id), sections appearing as they are checked (`part`, appended in order, each with its own citations), a gap card for a worker that failed ("sub-topic 3 could not be read; try it alone"), and at the end `done`. No word-by-word text for the merged report: a worker's text would arrive after the check, not before, because an unchecked sentence must not be shown as if it were a finding.

**Limits that must exist before it is switched on** (all from our own rules):

1. **Cost shown first.** The plan step costs one small call; the approval screen states "this will use about N of your M tokens today" before any worker starts. A budget is enforced in code (stop dispatching when the day's allowance is gone), not only displayed.
2. **At most 6 workers, one scan per person at a time, one retry level (2 retries) per worker.** A cancel button calls `terminate()` and marks the scan `canceled`.
3. **No background answer in a scan.** Workers use the checked answer only; "general background" (W5) is not used for scans.
4. **Signed-in only** and the same privacy acknowledgement as Idea Check.
5. **Time-limited storage.** Progress needs the job's state on the server while it runs (this part is not a choice). Whether the finished report is kept (so the person can return tomorrow) or only handed to the browser and then erased is **the user's decision** (section 6); the privacy text must say which.

**What could go wrong (my inference, to test before building).** Workers racing for the same free search services: each service has a gate with a rate limit, so five workers searching at once will queue behind the gate and the scan will not be five times faster; measure this with the real gates, not the spike's fake workers. A scan with a gap is a finished scan that says what is missing; the page must not call it a failure.

## 5. Order of work, if the user says go

| Step | What | Size | Needs a decision? |
| --- | --- | --- | --- |
| P0 | Write the event rule into the runbook; add the shared stream-shape check to the tests (no text on progress/status events, one terminal event, `done` monotonic); add reason counters for failed answers | about 1 day | No |
| P1 | Spike R11: the same five workers with the real model and the real search gates on a Worker: tokens, time, how much the gates serialize | about 1 day | No (uses the free daily quota; stays well under it) |
| P2 | Part registry in `ChatView` (refactor only, no new feature) | about 2 days | No |
| P3 | Verify-and-repair, **only if** the P0 counters show a real `not_grounded` rate (about 5% or more) | about 1 day | No |
| P4 | Literature scan feature behind `?ws=1`: tables (`scans`, `scan_events`), the Workflow, the page, limits, tests (unit, endpoint with Workflows running, browser with axe) | about 1 to 2 weeks | **Yes** (below) |

## 6. Decisions that are the user's

1. **Literature scan at all?** It is the only feature here that would spend many tokens per use. If yes, which daily allowance applies to it (the same 60,000 as chat, or a separate small one)?
2. **Keep the finished report on the server (for up to 24 hours or so) or only in the browser?** On the server it survives a closed tab and works across devices; it also means storing a person's question and a text derived from papers, which the privacy text then has to state.
3. **Hinglish scan reports from the first release?** The standing rule says yes for the interface; the sub-questions and the merged text would need the same language handling as chat (the checked answer already follows the question's language).

## Sources

- Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents): evaluator-optimizer ("clear evaluation criteria" and "iterative refinement provides measurable value"), orchestrator-workers, parallelization (sectioning and voting).
- Huang et al., [Large Language Models Cannot Self-Correct Reasoning Yet](https://arxiv.org/abs/2310.01798), ICLR 2024.
- Madaan et al., [Self-Refine](https://arxiv.org/abs/2303.17651), 2023.
- [A2A protocol](https://a2a-protocol.org): task states; `TaskStatusUpdateEvent` and `TaskArtifactUpdateEvent` (artifact id, `append`, `lastChunk`); re-subscribing to a task; polling and push notifications; events in generation order.
- [MCP specification, progress](https://modelcontextprotocol.io/specification) (2025-11-25): `notifications/progress`, `progressToken`, `progress` must increase, optional `total` and `message`, rate limiting, stop at a terminal state.
- Cloudflare [Workflows](https://developers.cloudflare.com/workflows/): concurrent steps, `step.waitForEvent`, instance control (`pause`, `resume`, `terminate`), `NonRetryableError`.
- Vercel [AI SDK](https://ai-sdk.dev), `streamObject` and `partialObjectStream`.
- Spike R10: [R10-fan-out.md](../spikes/R10-fan-out.md); earlier verdicts: [agent-concepts.md](agent-concepts.md).
