# Tools run in the reply (`CHAT_TOOLS`), 9 Nov 2026

## The request

The owner asked on 9 Nov 2026: "Workers AI khud iss right MCP tool ko call karen understand karke prompt ko". The chat on Home
should understand the prompt and then run the right tool itself, instead of only offering it as a card.

The owner chose "sasta tool khud, mehenga pooche": a cheap tool runs by itself, and an expensive one still asks.

| Runs in the reply, no click | Still a card (one click), as before |
|---|---|
| Check references: a pasted list, checked at Crossref and OpenAlex (no AI) | Idea Check: it has a plan to approve before anything is searched |
| Retraction check: DOIs, with a word that asks about retraction | Literature scan: four a day, and a plan to approve |
| A question about ONE paper of the chat's results: Ask this paper, from its full text | |
| A question about ONE of the person's own uploaded papers: that paper's own ask | |

## How the tool is chosen

The code is in `apps/api/src/chat/tools.ts` (`planTool`, `pickDoc`). It reads what already decides a message, so it works with
the Understand step off:

- **The rules.**
  - `looksLikeReferenceList`, or one or two entries that each pass `looksLikeReference` (newly exported from
    `packages/shared/src/route.ts`).
  - DOIs in the text together with `RETRACT_CUE`. The cue works in English, Hinglish and Hindi.
- **The private router for a signed-in person.** When it says Check references or Ask a paper, the rules above still decide
  whether there is a list, or which paper is meant.
- **The Understand step, when on.**
  - `offer_tool` with `verify` behaves like the router's verify.
  - `ask_paper` means the person's own paper.
  - `ask_results` about exactly one paper, looked up again by DOI, runs Ask this paper. The page's copy of the paper is never
    used.

Two cases keep the card:
- a request with no list ("check my references"): the card's page takes the list;
- a question about own papers where the paper cannot be told apart (several papers, none named by two title words or more):
  the card's page lets the person choose.

**Workers AI function calling was not used.**
- Every decision above is already made by the rules, the router or the Understand step, which is one private call that returns
  a fixed JSON shape. A second call that picks a function would add a model call to every message, and the recorded Understand
  latency is already over budget (p50 3.6 s against 1.2 s).
- It would also add a new way to be wrong: a made-up argument such as a DOI the person never wrote.
- If it is wanted later, it belongs inside the Understand step's schema (one more enum), not as a second call.

## How it runs

`runPlan` in `apps/api/src/chat/routes.ts` calls the same service functions the pages and the MCP tools call (M6), never the MCP
protocol:

| Tool | Service | Limits |
|---|---|---|
| verify | `referenceService.verify`, 6 at a time | `VERIFY_LIMITER`, one unit per reference as on the page; at most 60 references, and the rest is said |
| retractions | `retractionService.check` | at most 200 DOIs; a check that could not run is "unknown", never "not retracted" |
| ask_paper | `oaService.ask` | signed in, `ASK_LIMITER`, 20 new papers a day per person (the service's own count), the daily AI allowance |
| ask_doc | `answerQuestionStream` over the paper's chunks | as on the paper's page: the answer is kept in `doc_qa` with the paper's own questions |

## What the reply carries

The new events are in `packages/shared/src/chat-tools.ts`:

| Event | Meaning |
|---|---|
| `tool` | the start: how many references, how many DOIs, or which paper and which question |
| `tool_ref` | one verdict, as it arrives |
| `tool_retractions` | all the DOIs at once |
| `tool_ask` | one event of the Ask this paper stream, as it is |

- **Understood line.** The `understood` event says the mode (Check references, or Ask a paper) and `confirm: true`, so the page
  shows "Did you want this? Change". The page names a retraction check "Check retractions".
- **Ending.** The reply ends with `done` and reason `tool`: there is no written chat answer.
- **Counted outcome.** `chat:tool_verify`, `tool_retractions`, `tool_ask_paper` or `tool_ask_doc`, with `_failed` added when an
  ask ended without an answer. Counts only.
- **Thinking block.** The lines are `understood` ("Check references, run here" · Change), `confirm`, `tool` (what it is doing) and
  `tool_result` (what it came to). Every number in a line is one of its counts.
- **Old pages.** An open tab that does not know the events keeps its reply as it was (the reducer's default). The server sends
  them only with the switch on.

## The page

`apps/web/src/workspace/ChatTool.tsx` is a lazy chunk, fetched only for a reply that has a tool.

- **Verify.** A compact row per reference with the Check references page's words and styles (`verify.css`), "Open DOI", "Check
  again" for one that could not be checked, the summary line, and "Open on the Check references page".
- **Retractions.** One row per DOI, with the notice's DOI.
- **A paper's answer.** Ask this paper's own pieces (`Basis`, `Reading`, `AnswerCard`, exported from `OaAskSheet.tsx`).

**Why not the Check references page's own card (`RefCard`):**
- Importing it, or `lib/refStatus.ts`, or any lucide icon that the conversation's chunk did not already use, made the bundler move
  that module out of the first-load chunk into a small chunk that the first load still preloads. That cost 3.2 KB (RefCard) and
  2.4 KB (refStatus), measured on 9 Nov 2026.
- With the compact row and the icons the chat already uses, the first load is 241.6 KB, against 241.4 KB on main. The limit is
  250 KB and was not raised.
- The words of each verdict are the same as the page's.

## Privacy

The sentence is in `FLAG_SENTENCES` (`apps/api/src/legal-match.test.ts`, flag `CHAT_TOOLS`, at `on`). It is **not on the page**.
The commit that sets `"CHAT_TOOLS": "on"` puts it under "Your papers and ideas" with the next `PRIVACY_VERSION`, after the
owner reads it. The test fails if the switch is on without it.

## Tests

| Kind | What |
|---|---|
| Unit | `chat/tools.test.ts`: the plan, the doc pick, DOIs in text, verify with failures and limits, the ask relay, the reducer |
| Route | `chat/tools-route.test.ts`: off byte-identical, each tool on, a failure, limits, the Thinking lines honest, never for a search by hand |
| Golden | `chat/since-year.test.ts`, "CHAT_TOOLS": off, shadow and a typo are the golden byte for byte; with on, no request of the list changes, with the rules or with the Understand step |
| Integration | `scripts/chat-tools-e2e.mjs`: the real Worker; run it with `INTEGRATION_VARS="CHAT_TOOLS:on"` and with `CHAT_UNDERSTAND:on` too |
| Browser | `e2e/chat-tools.mjs`: before and after pictures, axe, 320 px, kept after a reload |

## Open

- With the Understand step off, a question about one result ("the second paper") is not run: the old router's history carries
  titles, not DOIs. It runs only with `CHAT_UNDERSTAND` on.
- A list of DOIs with no retraction word is searched as before. Whether a bare list of DOIs should be checked for retractions is
  the owner's call.
- The compact verify row has no Preview, Cite or Report: they are on the full page, one click away.
