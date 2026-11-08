# Understanding, follow-ups and MCP: M1 and M2 as built

The plan is the owner's design PDF "Sodhsetu understanding, follow-ups and MCP (design)" (6 Nov 2026). This note says what M1 and M2 of its work plan became in the code, what was decided on the way, and what
is left for M4 (the Understand step). Status: built on the branches `und-m1` and `und-m2`, committed locally, **not pushed, not live**.

## M1: the earlier-chats feature is removed

What went:

- The box menu's group "Continue from an earlier chat", its chip "Continuing from: ...", the rail's per-chat menu ("Continue in a new chat", "Do not use this chat as memory"), the Settings switch
  "Use my earlier chats", the line "Used from your earlier chat: ..." with its "Do not use it and search again".
- The on-device matcher (`packages/shared/src/chat-memory.ts`: the words of each chat, recall, pick, fit) and `apps/web/src/lib/memory.ts`. `chat-memory.ts` now holds only the list of chats and whose they are.
- The `earlier` field of `POST /api/v1/chat` and of the development route `/chat/route`, the router's EARLIER_CHATS block and its prompt sentences, `readEarlier`, the context count `earlier`,
  the eval class `earlier_chat` (7 labelled cases of `router-followup-cases.mjs`, which measured a feature that no longer exists).

Decisions:

- **`earlier` from an old open tab is ignored, not refused.** A tab opened before the release still sends it; refusing it (400) would break that tab's messages. The server never reads it: no model and no log
  sees it, and the request is answered byte for byte as the same message without it (pinned in `since-year.test.ts`; the golden entry "follow-up, earlier chats" was recorded again for this reason).
- **What the old feature left in the browser is removed when the page loads**: the key `scholar.earlier` (it held the account id of whoever turned the switch on), the `kw` words and the `nomem` mark on
  each entry of the chat list (`parseIndex` drops them and the list is written back at once), and a reply's stored `earlier` questions the next time its chat is saved (`trimForStorage`).
- **Private chat** stays in the box menu; its note now says "not kept" (the "not used as memory" half meant the removed feature).
- **The privacy text changed and the version moved: `2026-11-draft-15`** (`draft-14` is retired in `legal-text.test.ts`; no newer draft was on `intent-text-p1` or `trending-privacy-text`). Removed: the
  "Earlier chats" bullet, the words and the reply copies in the retention table, the earlier-chats choice in the paragraph on cookies. Added: "Nothing from another chat is ever sent with a message: each
  chat leans only on its own earlier messages." and a dated "Latest change (6 November 2026)" line. Settings says "Nothing of one chat is sent with a message in another." **The owner reads the text before it
  goes live.**

## M2: the turn ledger and the Thinking block (without the Understand step)

**The turn ledger** (`packages/shared/src/ledger.ts`): one record per turn of ONE chat, as the PDF shapes it (`turn`, `user`, `intent`, `standalone`, `reply` (first 300 characters, null when the reply did not
finish), `papers` (the first ten, numbered as the cards, with `id`, `doi`, `title`, `year`, `first_author`)). Built from the chat's own messages, along the versions being read, from the last "New topic" on;
never a safety-lane reply; an Idea Check is a turn of intent `offer_tool` without the idea's text. The intent is read from what the reply already says (no model): small talk is `chat`, a same-papers
follow-up `ask_results`, a refinement `refine_search`, another tool `offer_tool` or `ask_paper`. It is written with the chat's record in IndexedDB (`lib/chat.ts`, `write`), and a private chat's exists only
in memory (`chatLedger`). **Nothing of it is sent** (M2): the request still carries `history` exactly as before, and the browser suite reads the body to hold that. `ledgerForSend` (the six latest turns
whole, older ones as their standalone question, about 3,000 tokens at most with the oldest going first, a visitor's three latest) is built and tested for M4 to wire.

**The `think` event and the Thinking block.** A new Worker variable, `CHAT_THINK` (`off` | `on`, read through `understand/flags.ts`: unset is off, a KV override can only lower it). With it off nothing
is sent and every stream is the golden, byte for byte. With it on, `routes.ts` adds lines from the real counts of each stage (`chat/think.ts`): understood, searched, found (updated in place while the
sources answer), reading (only when the reader runs), writing (the answer, or the labelled background), checked (only when the judge gave verdicts), and a note when the rules were not sure. Only the
understood line can carry words a model wrote (a restated question); the page labels it "I understood:". The person's words and the search words are always inside “ ” quotes, so a year in them is never
one of the line's numbers. Tests: every number of every line of every request of the differential list (with the cleaner, the floor and the counters too) is one of its counts; the lines are only ADDED
(the stream without them is the stream without the flag, byte for byte); no line reaches a log; the lines of each request are pinned in `since-year.think.golden.json`.

The page (`workspace/ThinkBlock.tsx`, in the lazy conversation chunk): open while the reply works, with the steps as a thin bar inside it and no row of steps; folded when done into "Thought for 14 s ·
1 search · 20 papers"; a button opens and closes it (`aria-expanded`); the understood line carries Change and "Use my exact words", so the reply does not say "I understood this as" and "I searched for" a
second time; a greeting's block says it was taken for a conversation, with Change. A screen reader hears the stage once when it changes, never each line. A reply with no lines looks exactly as before.
The browser suite `e2e/think.mjs` (registered in the integration run) holds all of that, with axe in light, dark and read.

**Before switching CHAT_THINK on:** a page built before M2 has no place for an event it does not know (its reducer returned nothing for it); this build keeps the reply as it was for any unknown event. Leave
the switch off for at least a day after this build is live, so that no old tab meets a `think` event.

## Left for later milestones

- M3 (eval sets, two labellers), M4 (the Understand step in shadow, sending `ledgerForSend`, resolving the ledger's papers again on the server), M5 (on, visitors after their privacy sentence).
- The Thinking block's lines are English templates plus Hindi and Hinglish ones chosen by the message's language; the page's own label and summary are English.
