# The Understand step: core module (M4, not wired)

From the design of 6 Nov 2026, "Sodhsetu: understanding, follow-ups and MCP" (pages 3 to 9, 13 and 14). This page covers what exists on branch `und-core` and what the wiring step must do. The eval sets and their numbers are in [docs/eval/understand](../eval/understand/GUIDE.md).

**Status: built and tested, called by nothing.** No route reads `CHAT_UNDERSTAND`, so production is unchanged.

## Files (apps/api/src/understand/)

| File | What |
|---|---|
| `understanding.ts` | The one output shape (page 4), `UNDERSTAND_SCHEMA` for the model, and `parseUnderstanding`: strict, refuses a wrong field instead of repairing it |
| `ledger-input.ts` | The turn ledger as the server reads it (untrusted): `readLedger` (strict), `capLedger` (6 full turns, older by standalone, about 3,000 tokens, visitor 3), `renderLedger`, `paperRefsToResolve` |
| `greeting.ts` | The greeting list with a normaliser: `isGreeting`, `normaliseGreeting`, `greetingKind` |
| `guards.ts` | Stage 1, pure: `guards()` gives refuse, safety, chosen, identifier, reference_list, greeting or understand. The R11 scrub is a hook (`Scrub`, default identity) |
| `understand.ts` | Stage 2: `understandTurn()` runs the guards, one model call (one retry with a fixed hint on an invalid reading), `checkReading()` and the confidence and fail policies. `fallbackUnderstanding()` holds today's rules |
| `chat-reply.ts` | The `chat` intent's reply: `writeChatReply()` (at most about 80 words, the person's language, post-check), `chatReplyLeaks()`, `templateChatReply()` for a reply with no model |
| `understand-flag.ts` | `understandFlag(env)`: `CHAT_UNDERSTAND` off, shadow or on, read through `flagOf` (unset is off; KV can only lower it) |
| `understand-counters.ts` | The closed counter names (`und_*`) and `understandCounters(decision, old?)`: counts only, never text |
| `src/llm` | New private task `understand`, Workers AI only in both chains (`UNDERSTAND_CHAIN` in config.ts) |

## The public API

```ts
guards(input: { text: string; mode: "auto" | RouteMode; safety?: boolean; scrub?: Scrub }): GuardDecision
understandTurn(guard: GuardInput, input: { ledger: LedgerTurn[]; visitor?: boolean; year: number },
               deps: { complete: Complete | null; scrub?: Scrub; timeoutMs?: number; now?: () => number }): Promise<UnderstandDecision>
  // UnderstandDecision = { source: "guard"|"greeting"|"model"|"fallback", guard, understanding: Understanding | null, confirm: boolean,
  //                        fallback: { reason: "timeout"|"invalid"|"down"|"quota"|"no_model", route } | null, corrections: Correction[], invalid: ParseFailure[], model, ms }
checkReading(u: Understanding, input: UnderstandInput, scrub?): { value; corrections; confirm }
fallbackUnderstanding(message: string): { understanding: Understanding; route: Route }
readLedger(raw: unknown): { ok: true; turns: LedgerTurn[] } | { ok: false; detail: string }
capLedger(turns, { visitor? }): LedgerView[];  renderLedger(views): string;  paperRefsToResolve(turns, refersTo): LedgerPaper[]
isGreeting(text): boolean;  greetingKind(text): "hello"|"thanks"|"bye"|"how_are_you"|"about"
writeChatReply(message, language, complete): Promise<ChatReplyResult>;  chatReplyLeaks(text): ChatLeak[];  templateChatReply(kind, language): string
understandFlag(env): Promise<FlagReading>
understandCounters(decision, old?: OldDecision): UnderstandCounterName[];  oldIntentOf(old): UnderstandIntent
FALLBACK_NOTICE, CONFIRM_TEXT: Record<"en"|"hi"|"hinglish", string>
```

## What the wiring step must do (after M2 lands)

1. **Body.** Read `ledger` from the chat body with `readLedger` (400 on a bad shape, as `history` is today). Send it only when `CHAT_UNDERSTAND` is not off. The browser needs to know the switch: the server must say so; a browser that always sends the ledger would be a privacy change.
2. **Off.** Do not call anything here. The stream stays byte-identical, and the golden tests hold it.
3. **Shadow.** After today's decision, call `understandTurn` (on the response's `waitUntil`, so the person does not wait). Count `understandCounters(decision, old)` with the R3 counter writer. Nothing else.
4. **On.** Act on `decision.understanding`:
   - `search` and `refine_search`: today's search, with `search.queries` (the person's exact words when "Use my exact words" is pressed), the years and `indian_sources` (null means the person's own toggle).
   - `ask_results`: re-resolve `paperRefsToResolve(...)` (KV or an OpenAlex DOI lookup) before any paper is used. The writer and the judge get only `standalone` and the re-resolved papers, never the ledger.
   - `chat`: `writeChatReply`. When it says `discarded`, treat the message as a search; on any other failure, use `templateChatReply`. A greeting is never searched.
   - `offer_tool`: the card, never started. `clarify`: one question with its choices plus "Search anyway". `confirm`: the prominent "Did you want this? Change".
   - `fallback`: the rules' decision, plus `FALLBACK_NOTICE` in the Thinking block.
5. **The model.** Build a `Complete` on the task `understand` (private), counted in the 60,000 daily allowance for a signed-in person. A visitor needs a separate per-address cap (about 40 calls a day) and the privacy sentence first.
6. **Thinking block.** The `understood` think line is `understanding.status`, labelled "I understood". It is the only model-written line.
7. **R11.** Pass R11's scrub as `scrub` once R11 is on main.

## Known gaps, measured (see the results in docs/eval/understand/GUIDE.md)

- **Latency.** Recorded through wrangler's remote proxy from a laptop (about 0.35 to 1 s of round trip of its own), no model tried meets p50 under 1.2 s or p95 under 2.5 s. The in-Worker number must come from shadow.
- **Labels.** The sets are a development set written by the builder. A second labeller and a hold-out written by others are still needed.
