# Agent and streaming concepts: where they fit Scholar AI (research of 26 Oct 2026)

Asked: A2UI, AG-UI, SSE, checkpointing, delta events, token streaming, multi-agent delegation, idempotency. For each: what it is, whether this application has a use for it, whether it is reliable and efficient, and the decision. Facts about the protocols come from their own documentation (linked at the end); facts about our app come from the code and from one measurement made today. Where something is my inference it says so.

## The short answer

| Concept | Verdict | Where it matters here |
| --- | --- | --- |
| **SSE** | **Keep, harden** | Already carries chat, Idea Check and paper Q&A. Add a keep-alive line and a "still working" hint |
| **Token streaming** | **Keep** (already built) | The written answer; the reason the box feels alive. Words are provisional until checked |
| **Delta events** | **Borrow the idea, not the format** | 82% of a search stream is full snapshots of the paper list. Cut that, but with lighter snapshots, not JSON Patch |
| **Checkpointing** | **Adopt in W4** | Ingest of a shared open-access paper is the first job that must survive a closed tab, a retry and a deploy |
| **Idempotency** | **Adopt, by natural keys** | Queue/Workflow steps run more than once by design; most of our endpoints are already safe, three are not |
| **AG-UI** | **Borrow three ideas, do not adopt the library** | Terminal-event guarantee, interrupts for approvals (Idea Check in W5), snapshot-after-reconnect |
| **Multi-agent delegation** | **Not now** | Our answers are one checked call over at most eight abstracts. A literature-review feature could use fixed fan-out later, with a token budget |
| **A2UI** | **Skip** | Solves "an agent we do not control draws UI in our app". We have no such agent, and generated UI would fight our accessibility gates |

## 1. SSE (server-sent events)

**What.** A response that stays open and sends `event:`/`data:` blocks. The HTML standard adds `id` and `retry` fields, `Last-Event-ID` on reconnect, comment lines (a line starting with a colon, suggested about every 15 s) to stop proxies from dropping an idle connection, and a 204 to tell the client to stop reconnecting.

**Here.** `POST /chat`, `/idea/search|compare|insights`, `/documents/:id/ask`. One-way, same-origin, cookie auth, no extra infrastructure. The browser's `EventSource` cannot be used (it cannot send a POST body); `lib/sse.ts` reads the stream with `fetch`, which also means **no automatic reconnect and no `Last-Event-ID`**: a dropped stream is an error line with "Search again".

**Reliable?** Mostly, for what we do:
- A Worker streaming a response has no wall-clock limit while the client is connected (Cloudflare limits page). When the client leaves, outstanding work may be cancelled; `ctx.waitUntil` extends it up to 30 s. Our handlers already abort the model call on disconnect.
- Runtime updates give running requests up to 20 minutes. Crashes and pressure can cut sooner; the docs say to design for disconnects and safe retries.
- Weak point 1, measured today: the **longest silence in a real search was 12.3 s** (the model thinks before its first word; first word at 9 to 12 s). Nothing is sent meanwhile. No proxy of ours cuts at 12 s, but a mobile network or a corporate proxy that does (the standard's own note) would cut every answer exactly there.
- Weak point 2: a stream that ends without `done` is reported as "cut off" (W2 handles it) but not repaired.
- Not a problem: the six-connections-per-host limit (that is HTTP/1.1; the site is served over HTTP/2 or 3, and we hold one stream at a time).

**Efficient?** Yes: no handshake per event, plain text over the same HTTP request, no second protocol. WebSockets would add state and a Durable Object for nothing: we never need the server to listen mid-stream (Stop is an abort).

**Do.** (a) Send `: keep-alive` every 15 s while waiting (a comment line, ignored by `readSse` already), and say "Still working…" in the UI after 15 s of silence (this was listed as not done in W2). (b) Keep `Last-Event-ID` unsupported for chat (a repeat is cheap: searches come from the cache, an answer costs about $0.001). (c) For anything longer than half a minute, **the job's state lives in the database and the stream is only a view of it** (section 4).

## 2. Token streaming

**What.** Sending the model's words as they are produced.

**Here.** Built in W2: `token` events (about 270 to 450 per answer, 14 to 23 KB), then one `answer` event with the **checked** text. The tokens are provisional on purpose: the server checks every claim against a sentence of an abstract only at the end, so the final text can differ from what streamed (marks removed, claims dropped).

**Reliable?** The risk is not the transport but the trust: for a few seconds the reader sees words that have not been checked. The screen labels the phase "Writing" and replaces the text with the checked answer ("Every claim points at a sentence of an abstract"). I think that is acceptable and honest; the alternative (show nothing until the check) would make the 9 to 12 s silence look like a hang. Decision stays; revisit if real readers quote the provisional text.

**Efficient?** It does not make the answer faster (about 12 s in total); it makes the wait readable. Most of that time is the model's own reasoning before the first word, which we do not show.

## 3. Delta events

**What.** Instead of resending the whole state, send what changed. AG-UI uses `STATE_SNAPSHOT` (replace everything) and `STATE_DELTA` (an array of JSON Patch, RFC 6902, applied in order), and says to ask for a fresh snapshot when a patch does not apply. Text is a delta stream in the same sense (`TEXT_MESSAGE_CONTENT` carries `delta`).

**Here, measured today** (live search, real sources, two questions):

| Event | Count | Bytes | Share |
| --- | --- | --- | --- |
| `papers` (a full snapshot of the list, one per source and a final) | 5 | 125 KB and 108 KB | **82% and 87%** of the stream |
| `token` | 449 and 271 | 23 KB and 14 KB | 15% and 11% |
| everything else | 7 | under 4 KB | about 3% |

So a search sends **about 110 to 125 KB** of which almost all is the same twenty papers with their abstracts (about 1.25 KB each) sent five times. The words are already deltas; the list is not.

**Reliable?** The current way is the most robust one: every `papers` event replaces the list, so a lost or repeated event cannot corrupt it. JSON Patch would add the failure AG-UI itself documents (a patch that does not apply leaves the client drifted until a snapshot arrives), and a list that **re-ranks** as sources answer produces patches as large as the list.

**Do.** Not JSON Patch. Send interim snapshots **without the abstracts** (about 0.3 KB a paper, about 6 KB a snapshot) and the abstracts once, in the final list: about 75% less on the wire, still replace-everything, no new failure mode. Needs a check that the cards show nothing from the abstract before the final list (to be verified; if they do, truncate instead). Small, separate from W4.

## 4. Checkpointing

**What.** Saving a job's progress after each step so that a restart continues instead of starting over.

**Here today.** We already checkpoint in three places without the name: the browser keeps chats and marks a half-answered one "interrupted"; Idea Check is four separate requests with the browser holding the state between them (nothing stored on the server); scanned-paper reading keeps the list of pages still to read, so it can stop and continue on another day.

**Where it becomes necessary: W4.** Ingesting a shared open-access paper is *queued → fetching → reading → embedding → ready*, takes tens of seconds, must survive the person closing the tab (the main complaint about the first design) and must never leave a half-index that answers are built on (P-8). That is exactly a checkpointed job.

**Two ways to build it on Cloudflare** (both documented by Cloudflare):

| | Queue consumer (`oa-ingest`) | Workflows |
| --- | --- | --- |
| Delivery | at least once; duplicates "in rare occasions"; message 128 KB; 100 retries; consumer 15 min wall, CPU 30 s default up to 5 min | each step is memoised; a restart skips finished steps; per-step retries and timeouts |
| Progress | you write the state machine in D1 | the engine keeps it (1 MiB result per step, 1 GB per instance on Paid, kept 30 days) |
| Dedupe of "two people ask at once" | you write it (a row with a unique key) | instance ID must be unique per Workflow: the paper key *is* the instance ID, a second request joins |
| Cost of being wrong | duplicated work, a stuck row | the same, but the rules are stricter: steps must be idempotent, side effects inside steps, no `Date.now()` outside steps |
| Already in the repo | a producer binding (`JOBS`), no consumer yet | nothing |

My inference, to be proved when building: **Workflows fit the ingest better** (named steps, retries, dedupe by instance ID, state kept for us), as long as `wrangler dev` can run them in the integration harness. Whichever is chosen, the **D1 `oa_papers.status` row remains the thing the screen reads**, so the progress line and "join the running ingest" never depend on one connection or on one engine.

Design rules taken from the docs: a paper becomes *ready* only when every chunk is stored; each step writes under a key it can overwrite (`(paper_id, idx)`), so a repeated step is harmless; big payloads go to R2 and the step returns a key (the 1 MiB step limit); text extraction is the heavy step and is **restarted from its beginning** on failure, so it is its own step and bounded by the page and size caps.

## 5. Idempotency

**What.** Doing the same operation twice gives the same result as doing it once. Needed because retries are normal: a client that did not see the answer, a queue that delivers twice, a Workflow step that restarts.

**Standards note.** The `Idempotency-Key` header is an IETF **draft** (`draft-ietf-httpapi-idempotency-key-header-07`, October 2025, a work in progress; the document marks itself as not for citation as a reference). It is a useful pattern, not a standard to depend on.

**Here: what is already safe** (natural keys, no header needed): saving to the library (`ON CONFLICT (user_id, paper_id)`), library import (`INSERT OR IGNORE`), finishing a paper (`/finish` recomputes status from the chunk count), scanned-page bookkeeping (`INSERT OR IGNORE`), the daily OCR counter (`ON CONFLICT … WHERE pages < limit`), ink history.

**Where it is not**, by reading the code: `POST /feedback` (a double click is two reports; limited only by the per-day cap), `POST /documents` (a double click on upload may create two rows, bounded by the 30-paper limit), a chat message (a retried message is charged twice in tokens: harmless, small).

**Do.**
1. In W4, the natural key everywhere: paper key (DOI, else file hash), `(paper_id, chunk idx)`, `(user_id, paper_id)` for "save". Queue messages and Workflow instances carry that key, as Cloudflare advises for at-least-once delivery.
2. An `Idempotency-Key` (a UUID made in the browser per form submit) only on the two non-safe creates above, stored for 24 hours with the response; not everywhere.
3. A test per endpoint that a repeat leaves the same rows.

## 6. AG-UI

**What.** An open, event-based protocol (CopilotKit and partners) between an agent backend and a front end. Events: lifecycle (`RunStarted`, `RunFinished` with an `outcome` of success or interrupt, `RunError`, `StepStarted/Finished`), text messages (Start, Content with `delta`, End), tool calls, state (`STATE_SNAPSHOT`, `STATE_DELTA`), activity, reasoning, sub-agent events, `CUSTOM`/`RAW`. Over HTTP (SSE) or WebSockets. The rules: a run starts with `RunStarted` and ends with `RunFinished` or `RunError`; deltas apply in order; **interrupts**: a run ends with outcome *interrupt*, the client resumes by starting a new run with a `resume` array answering each open interrupt. First-party support in Microsoft, Google, AWS, Mastra and others; **Cloudflare Agents** and the Claude Agent SDK are listed as community integrations. Some parts are still moving (the docs list `THINKING_*` events "removed in 1.0.0" and replaced by `REASONING_*`, and some fields are marked draft).

**Here.** We have three hand-made event vocabularies (chat, Idea Check ×3, paper Q&A) that already look like a subset: `step`/`stage` ≈ `StepStarted`, `token` ≈ `TextMessageContent`, `papers` ≈ a snapshot, `done`/`error` ≈ `RunFinished`/`RunError`. Our flows are **deterministic pipelines** (router, search, answer, check), not autonomous agent loops with tools.

**Would adopting it pay?** Not now. It would add a dependency and a client model built for agent loops, rename events we already test, and follow a spec that is still changing, for no new capability. (My inference: the benefit grows only if third parties build clients for us, or we host many different agents.)

**Borrow:**
1. **A guaranteed terminal event** on every stream (`done` or `error`), with a test: our client already treats a stream without one as cut off.
2. **Interrupt and resume** for **Idea Check inside the workspace (W5)**: today the person approves the search plan on a separate page. In one conversation it is "the run ends with *needs approval*; the next message resumes it", which is the AG-UI interrupt model and needs no library.
3. **Snapshot after reconnect**: if a stream is cut, the next request can begin with the current state (our "Search again" does this, from cache).

## 7. Multi-agent delegation

**What.** A lead agent splits a task and hands parts to sub-agents with their own context windows (Anthropic's research system; AG-UI has sub-agent events for showing it).

**Evidence.** Anthropic reports that a lead on Opus 4 with Sonnet 4 sub-agents beat a single Opus 4 agent by 90.2% on its internal research evaluation, cut research time by up to 90% on complex queries, and used **about 4× the tokens of a chat (single agent) and about 15× (multi-agent)**. Token use alone explained 80% of the performance variance on BrowseComp. They say it fits breadth-first, parallelizable work and not tasks where agents share one context; their agents compounded errors, so they built resume-from-failure, retries plus checkpoints, tracing, and rainbow deployments so running agents survive a release. A secondary source cites a 2026 review where a single agent given the same compute often matches a team on reasoning tasks (not verified at the source).

**Here.** Every feature is one question over a small, fixed evidence set: the answer reads at most 8 abstracts in one call (about 1,850 tokens) and is **checked by the server**. Splitting that across agents would multiply cost and make the checking harder, not easier. The budget is also a hard fact: **60,000 tokens a day per person, one private model**. One 15× run of a 1,850-token question is about 28,000 tokens: half a day's allowance.

**Where it could fit later.** A "Literature scan" (many sub-topics, each searched and summarised from its own papers) is breadth-first, so it is the case Anthropic describes. If built: a **fixed fan-out** (a plan, N parallel workers that each reuse `answerFromResults` on their own sub-topic and return only `(paper, sentence)` evidence, a server-side merge), not an autonomous agent; a token budget shown before it starts; the same sentence-level check on every claim; failures of one worker shown as a gap, not hidden. That is a W5-or-later decision for you, with the cost shown first.

## 8. A2UI

**What.** Google's open (Apache 2) **declarative UI format** for agents: JSON messages (`createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface` in v0.9) naming components from a **catalog the client trusts**; the client renders them natively. The point, in Google's words: agents often run remotely, in other organisations, and a UI from an untrusted source should be "safe like data, but expressive like code" instead of HTML in an iframe. Versions: v0.9.1 current, v1.0 candidate, v0.8 the first public one; early client libraries for Flutter, Web Components and Angular; messages can travel over A2A, AG-UI, SSE, WebSockets. The project itself says it is a protocol and not a styling system.

**Here.** We have **one agent, ours, and one UI, ours**: nothing crosses a trust boundary. The pieces that look like generated UI (the "offer" card for Check references, the notice lines, the paper cards) are **typed events rendered by our own components**, which is already "data, not code".

**Would adopting it pay?** No, and it would cost: a model composing the screen can invent layout and wording, which collides with our rule that nothing is shown that the server did not check, and with the axe and contrast gates that every screen passes today; we use React (the documented renderers are not), and the format is still changing.

**When to revisit.** If Scholar AI ever accepts agents or tools from other people and has to show their results, or exposes itself as an agent others embed.

## Done so far (26 Oct)

- **One stream helper for every endpoint** (`apps/api/src/sse.ts`): a keep-alive comment every 15 s, a guaranteed single terminal event (a stream that ends without one gets a plain error event, a second terminal event is dropped), the model call aborted when the reader leaves. Chat, the three Idea Check streams and paper Q&A use it; 7 unit tests, plus an end-to-end check that the keep-alive arrives and that the stream ends with `done`.
- **"Still working…"** after 15 s without any event (a polite status line, gone when the server speaks again; browser test).
- **Lighter interim lists**: until the final list each paper carries the first 280 characters of its abstract (`slimForInterim`); the answer is still made from the full abstracts. Measured on the stand-in data in the end-to-end test; the saving on a live search is to be measured after deploy (expected: about 40% of the stream, less than the 75% first estimated, because the folded card shows three lines and a jump when the full abstract arrives would be worse than the bytes).
- **Idempotency keys** (`apps/api/src/idempotency.ts`, migration 0016) on `POST /documents` and `POST /feedback`: a repeat with the same key returns the first reply (`Idempotent-Replayed`), a different request under the same key is refused (422), two at once run once (409 for the other), errors are not kept, keys live a day. The browser sends one key per upload and per report and tries again once or twice on a lost connection. 13 unit tests, 14 end-to-end checks. Privacy text lists the record (version `2026-10-draft-7`).
- **Spike R9** ([R9-workflows.md](../spikes/R9-workflows.md)): a Workflow works locally with the one-instance-per-key rule, retries and checkpoints; it is the engine for the W4 ingest.

## What I would do, in order

1. **Now, small:** SSE keep-alive comment plus a "Still working…" line; interim paper snapshots without abstracts (after checking the cards); tests that every stream ends with `done` or `error` and that a repeat of the two unsafe POSTs is harmless. About a day.
2. **W4:** the ingest as a checkpointed job with the D1 row as the truth, idempotent steps, a join for simultaneous requests, progress shown from the row; Workflows versus Queue consumer decided by a spike (below).
3. **W5:** Idea Check inside the conversation using the interrupt-and-resume shape.
4. **Not planned:** A2UI, the AG-UI library, autonomous multi-agent. A fixed-fan-out literature scan only if you ask for it, with its cost shown.

## Sources

- AG-UI: [introduction](https://docs.ag-ui.com/introduction), [events](https://docs.ag-ui.com/concepts/events), [state](https://docs.ag-ui.com/concepts/state)
- A2UI: [what is A2UI](https://a2ui.org/introduction/what-is-a2ui/), [Google Developers Blog](https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/), [CopilotKit on v0.9](https://www.copilotkit.ai/blog/a2ui-whats-new-in-google-generative-ui-spec)
- Server-sent events: [HTML standard](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- Cloudflare: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workflows rules](https://developers.cloudflare.com/workflows/build/rules-of-workflows/), [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/), [Queues delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/), [Queues limits](https://developers.cloudflare.com/queues/platform/limits/)
- Anthropic: [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- Idempotency-Key: [IETF draft](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header)
- Measured today in this repository: a live search through `POST /api/v1/chat` with the real sources and model, counting bytes and gaps per event type.
