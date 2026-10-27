# W5: general background under a label, small talk, Idea Check inside the conversation (built 27 Oct 2026, behind `?ws=1`)

Plan: section 4.5 of [unified-workspace.md](unified-workspace.md). Gate: the paper-based answers keep passing the groundedness eval, and the general part always carries its label and never looks like a paper.

## What a person sees

1. **Papers first, as before.** The checked answer with sentence-level citations does not change.
2. **When the papers do not answer** (nothing found, papers without abstracts, or the model says coverage is none) a second step, "Writing background", runs and a **separate section** appears under the label **"General background, not from a paper in your results"**. It has no citations, no marks, and a note: "No paper is cited here, so check it before you rely on it", with a button, "Edit the question and search again".
3. **When it is not shown at all:** the model had an answer but it failed our checks (`not_grounded`: the person is told so, no background is offered in its place), quota used, model unavailable, signed-out visitors, and subjects the model does not recognise (kind `unsure`: nothing is written rather than a guess).
4. **Greetings and thanks** ("hi", "thanks", "namaste", "kya kar sakte ho?", emoji, Devanagari) are answered by the page itself in about 20 ms: no router call, no search, no model, also for visitors who are not signed in. Before, "hello" was sent to search and answered from random papers.
5. **A message that is not a research question** (kind `not_research`) gets one plain sentence saying what the box does.
6. **Idea Check inside the conversation.** Choosing Idea Check (the pill, Enter in that mode, "Change" on the understood line, or "Check it here" on the offer card) puts the Idea Check workspace under the message. Signed in and privacy acknowledged: the plan is proposed at once (the click that asked is the consent). **The search still waits for the person's approval of the plan.** The old Idea Check page remains ("Open the Idea Check page"). Only the idea's text is kept in the browser's chat; the plan and papers are not, so after a reload the card says it was run in an earlier visit and offers "Run it again".

## Rules the code enforces (not left to the prompt)

- The background is its own model call (task `qa`, private lane, label `chat_general`) with its own JSON, `{ kind, answer }`. It can never be inside the checked answer.
- `checkGeneral` removes source marks like `[1]`, and **throws the whole background away** if it contains a DOI, an address, "et al.", an author-and-year citation or "in a 2019 study". The person then sees only that the papers do not answer.
- Length is limited (1,500 characters; 300 for the one-sentence `not_research`).
- Greeting detection is a whole-message match of at most 40 characters, so "hi, what is known about sleep and memory?" is a question, not a greeting.
- A reply that is not valid JSON is asked for again once, in the router, the paper answer and the background, **only if no words have been shown yet** (a second try would repeat them).
- Events: `step general`, `general_token` (the words, provisional) and `general` (kind and checked text) are separate from progress `step`s, which keeps the rule in [research-patterns.md](research-patterns.md): progress and text are different event types.

## Tests

- Unit (1,283 in the repository at the time): `general.test.ts` (22: marks, every citing pattern, kinds, length, capitalising), `malformed.test.ts` (retry rules, including "never after words were streamed"), router tests for `isSmallTalk` (positive and negative lists in three languages), reducer tests for the new events, normaliser tests for the label-after-mark and square-bracket marks the real model produced.
- Endpoint (`chat-e2e.mjs`, stub model): event order, steps `search,general` and `search,read,check,general`, no background for answered questions, hallucinated answers or signed-out visitors, gibberish gives `unsure`, a greeting gives `not_research`, a background that names a paper is dropped, a background with marks has them removed, small talk has no search and no model call, Auto.
- Browser (`e2e/chat.mjs`, `e2e/workspace.mjs`, new `e2e/idea-chat.mjs`): the background section with axe in light and dark, "Edit and search again", Idea Check in place (privacy note, plan at once, approve, compare, axe in light, dark and phone width, reload, "Run it again", too-short idea, the page link, signed-out gate).
- Live model (`chat-eval.mjs`, Workers AI, real sources): answered 10 to 12 of 12 (the model varies between runs), controls (questions the papers cannot answer) answered 0, **no invented background: pass**, **background rules: pass** (label present, no marks, no citation pattern, nothing for answered questions), greetings answered by the page in about 20 ms.

## What the real model taught

- It sometimes replies with text that is not JSON; the guarded single retry fixed the visible cases.
- It sometimes writes the label after a mark (`[2], S11-13`); once in one live run, not reproduced in six repeats. The normaliser now removes a label after a mark even with invisible characters between. Trade-off, documented in the tests: a legitimate "S1" directly after a mark is also removed.
- One question timed out at 60 s on the model side and was reported as unavailable, as designed.

## Privacy

The background call sends the question alone to the private AI service (no papers). Greetings are handled in the page and send nothing. Idea text is kept in the browser's chats. Text updated in the privacy page; version `2026-10-draft-9`.

## Not done

- A background that a person can "turn off" (a setting): not asked for.
- Follow-up questions still do not use earlier messages.
- The Idea Check report is not kept in the chat after a reload (by design: papers and plan are not stored in the browser).
- Real-tablet testing remains with the user.
