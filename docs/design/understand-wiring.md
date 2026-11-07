# The Understand step in the chat: M4 (shadow) and M5 (on), as wired

From the owner's design PDF "Sodhsetu understanding, follow-ups and MCP" (6 Nov 2026), pages 3 to 9 and 13 to 15. The step itself is described in [understand-core.md](understand-core.md); the turn ledger and the Thinking block in [understand-m1-m2.md](understand-m1-m2.md). Status: built on branch `und-m4`, committed locally, **not pushed, not live, switched off**.

## Switches

| Variable | Positions | What it does |
|---|---|---|
| `CHAT_UNDERSTAND` | off (unset) / shadow / on | off: nothing is called, the ledger is not read, the stream is the golden byte for byte. shadow: the step runs after the rules decided, on `waitUntil`, and only counts are kept. on: the step decides. |
| `CHAT_UNDERSTAND_VISITORS` | off (unset) / on | on: the step reads a visitor's message too (40 calls a day per address), in whatever position `CHAT_UNDERSTAND` is. |

Both are gate flags read through `understand/flags.ts` (unset is off, a KV override can only lower).

## The ledger leaves the browser only when it is read

`GET /api/v1/chat/config` answers `{ "ledger": true }` only while the step reads it for this requester (shadow or on; for a visitor, the visitors' switch too). The page asks once, keeps the answer five minutes, waits at most 1.5 s for it, and sends no ledger when it could not ask. Shadow needs the ledger to measure agreement on follow-ups, so the ledger is sent from shadow on, and the privacy sentence of `CHAT_UNDERSTAND` is required from shadow on (legal-match.test.ts, `at: ["shadow", "on"]`).

The server reads the ledger as untrusted data (`readLedger`: strict; a bad ledger is a 400 `invalid_ledger` only where it would be read, and the page sends the message again without it). It now accepts what the browser really sends: older turns as `{turn, standalone}` only, and paper ids as the search makes them (`doi:`, `pmid:`, `t:`).

## The pipeline when on (routes.ts)

1. The safety lane (R4), when its switch acts, first.
2. The guards (no model): a greeting is conversation (a fixed reply in the person's language, `templateChatReply`), a bare DOI or arXiv number is searched as written, a pasted reference list is offered to Check references, a hand-picked mode never meets the step.
3. A visitor's call is counted (`understand_visitors`, migration 0027) only when the model would really be asked; past 40, the rules decide and the Thinking block says "Sign in for more".
4. One model call (`understandTurn`, task `understand`, private, Workers AI only, counted in the 60,000-token daily allowance of the person, or of the visitor's code of the day).
5. Act:
   - **chat**: a short reply written by the model and checked (`writeChatReply`); a reply that cites anything is thrown away (`und_chat_leak`) and the message is searched; any other failure gets the fixed reply. No search, no papers.
   - **search**: today's search with the step's first English query, its years (a year chip) and its Indian-sources choice when the person stated one.
   - **refine_search**: the same, with the year chip and "Using your earlier question: ..." (`context.intent: "refine"`).
   - **ask_results**: the ledger papers it names (or the whole turn for "explain that simpler", "Hindi mein batao") are looked up again by DOI (OpenAlex, one request, cached 24 hours; then the DOI and retraction checks). A paper with no DOI, or one OpenAlex does not know, is never used. No new search; the answer is written from those papers' abstracts and the reply says so (notice `abstracts`). With nothing found, the message is searched instead.
   - **ask_paper** and **offer_tool** (verify, idea): the existing offer cards, never started. **litscan**: a card of its own (`offer: "litscan"`) that opens the literature scan page.
   - **clarify**: one question and its 2 or 3 choices; the page adds "Search anyway". A choice sends the message again with the choice beside it.
6. The writer and the judge get the standalone question and the papers looked up again, never the ledger (understand-route.test.ts holds this with a canary in the ledger).
7. Confidence 0.45 to 0.75: `confirm` ("Did you want this?" with Change, prominently). Fallback: `fallback` ("I could not understand this well, so I searched for papers"), and the rules' path runs as today.

The `understood` event carries the step's fields only when it decided: `intent`, `statusLine` (its one checked line), `confirm`, `fallback`, `clarify`, `offer`. Each is optional, so a page that does not know them ignores them, and with the step off or in shadow none is sent.

## Counting

Feature `chat_understand` of `answer_outcomes`, names from the closed list of `understand-counters.ts` only (any other name is not written). /admin shows them under "The Understand step", with the share of each name taken over `und_turn`.

## Tests

- `chat/understand-route.test.ts`: config, off (ledger ignored), shadow (the same bytes as off, and counts), each intent, the ledger's trust rules, the fail policy, visitors and their cap.
- `chat/since-year.test.ts`: off, a typo, shadow and the visitors' switch alone leave every request of the differential list the golden's; on is pinned in `since-year.understand.golden.json`, and the requests the step cannot reach stay the base golden's.
- `e2e/understand.mjs`: what the page draws (always), and with `INTEGRATION_VARS="CHAT_UNDERSTAND:on,CHAT_THINK:on"` the design's examples through the real Worker.

## Not done, on purpose

- Only the first of the step's 1 to 3 queries is searched. Merging several searches needs its own measurement.
- ask_results answers from abstracts, not from the full text: the Ask-this-paper reader takes up to a minute per paper and runs as its own job. The reply points to "Ask this paper" on the card.
- The literature scan opens empty (it has no hand-off of a topic yet).
- `und_change` (how often Change is pressed) has a name and a label but no writer.
- Latency is measured only by the recording (p50 3.6 s through the proxy); the in-Worker numbers come from shadow.
