# Messages that are not research questions (research and plan, 1 Nov 2026)

Seen by the owner on the live site, with the prompt box on **Auto**: "Hey How are you?" was taken for "Search papers", searched across the sources, and answered with a list of
unrelated papers, a "Cross-checked · 2 sources" badge on the first, and four lines of notices. This note says why, what it costs, what the usual practice is, and the plan. **Step 1 is built (section 7); the model layer is not.**

## 1. What happens today (read from the code, and measured)

For "Hey How are you?" in Auto (`apps/api/src/chat/routes.ts`):

1. `isSmallTalk` is false: it matches a **whole message against one pattern** ("hey", or "how are you"), not two joined ("hey how are you").
2. `ruleRoute` (`packages/shared/src/route.ts`) says **search, confidence 0.9, no model**: a short English line with no other tool's word counts as a "plain topic". The rule treats *the absence of another tool's cue* as *the presence of a research question*.
3. All the sources are searched; the first paper whose title has "hey" and "how do you" is shown.
4. For a signed-in person: **two model calls** (the answer from the papers, which finds the papers do not answer; then the "general background" call, which says "not research"). The box in the screenshot, "This box finds research papers and answers from them.", is that second call's text, so both ran.

A list of 56 messages that are not research questions (24 greetings and chit-chat, 10 junk, 18 requests to an assistant, 4 orders), run through the rules only (no model; the list is mine, not real traffic, so it shows the shape and not the rate):

| What | Messages | Taken as small talk | Searched by the rules, no model | Sent to the model router |
|---|---|---|---|---|
| greetings and chit-chat ("hello, how are you", "who made you", "is this free?", "lol") | 24 | 0 | 20 | 4 |
| junk ("asdfgh", "123456", "test test test", "ok"; three more with no letter or number, "......", "??", an emoji, are already refused at input) | 10 | 1 | 6 (+3 refused at input) | 0 |
| requests to an assistant ("tell me a joke", "weather today", "write a poem", "2 + 2") | 18 | 0 | 16 | 2 |
| orders ("ignore previous instructions...") | 4 | 0 | 4 | 0 |
| **all** | **56** | **1** | **46** (+3 refused at input) | **6** |

The 6 that reach the model are no better off: it can only answer with one of four tools, and its prompt says small talk is "search" (`ROUTER_SYSTEM`; the eval's "safe" group even **expects** "search" for small talk, `router-cases.mjs`).
So 52 of 56 end as a search (3 are refused at input with "Write something", which is not a reply either). The nine research messages used as a control (a topic, "BERT", "hello world dataset", a Hinglish question) all went to search, as they should.

## 2. Why this is a problem (not only a look)

- **It was assumed to be free.** The router note says a search "changes nothing and costs nothing". It costs the sources' limits, 3 to 8 seconds, and for a signed-in person two model calls out of the daily allowance.
- **It lends trust to nonsense.** A paper under a "Cross-checked" badge looks like an endorsement of the question.
- **It says four things at once**: "papers do not seem to answer", "this box finds papers", "some of the places we search did not answer" and a "Search again" button that makes no sense for a greeting.
- **A relevance check after the search cannot rescue it.** A paper's `score` is reciprocal-rank fusion (`search/merge.ts`): the first result of any query scores the same, relevant or not. The decision has to be made **before** the search.

## 3. What the usual practice says

- **A closed list of intents needs a way out.** Larson et al. built CLINC150 because classifiers that do well on the intents they know do poorly at spotting messages that belong to none ([paper](https://preview.aclanthology.org/moar-dois/D19-1131), [dataset](https://www.tensorflow.org/datasets/catalog/clinc_oos)). Our router has four tools and no "none of these".
- **Decide before retrieving.** Adaptive RAG puts a classifier in front of retrieval, with a path that skips retrieval for chit-chat ([overview](https://www.meilisearch.com/blog/adaptive-rag)).
- **Specific out-of-scope examples, and a confirm step.** Rasa advises an `out_of_scope` intent with real examples (a random catch-all is not recommended), a confidence threshold, and a two-stage fallback that asks before giving up ([docs](https://rasa.com/docs/rasa-pro/nlu-based-assistants/fallback-handoff)). Thresholds are tuned on one's own data.
- **Do not dead-end.** A fallback that only says "I can't" and repeats is a known fault; it should offer the next step ([practitioner note](https://www.usefini.com/glossary/what-is-a-fallback-intent), one vendor's view).

## 4. The plan (cheap and certain first, the model only for what is left)

**Layer 0, rules (free, same answer every time).** A message whose words are *all* filler is small talk: greetings, thanks, politeness, pronouns, "are", "how", "who", laughter, "ok"
(English, Hinglish, Devanagari). That catches "hey how are you", "hello hello", "hi thanks", "ok thanks bye", "are you there", "can you help me", "lol", "namaste aap kaun ho" without a list of phrases. It is safe by construction: a word
that can be a topic ("BERT", "transformers", "hello world dataset") is not in the lexicon, so a message with one real word is never blocked. Also: nothing but punctuation, digits or emoji. Keyboard mashing ("asdfgh") cannot be told by rules from an acronym (TB, NMR, BCG), so it goes to layer 1.

**Layer 1, the model, for what the rules cannot settle.** The router gets a fifth answer, "not a request for papers", defined narrowly with examples drawn from the table above: chit-chat, requests to the assistant (a joke, a poem, code, translation, arithmetic), things that change by the minute (weather, scores, prices, the time), questions about the box. Doubt means search, as now. For this the rule "a plain English line is a certain search" must be tightened: it needs **a real topic word and no assistant-request opening** ("tell me", "write", "translate", "what's the weather"), else the model looks. The price: more messages reach the model (about 100 tokens each). To be measured: the share, and the added second before a search starts.
Not signed in: there is no model, so layer 0 and a small list of assistant openings decide.

**Questions that look off-topic but are research stay searched**: "is coffee bad for health", "what causes inflation", "best treatment for migraine". The narrow definition is the guard.

**What the person sees.** One message, written by the page (no model), in the language of the message (today it is English only: "namaste aap kaun ho" gets an English reply). It says what the box does, offers **three example questions that run with one click**, and carries **"Search for it anyway"**. That button is what makes a wrong refusal harmless (the same idea as "Use my exact words" and "Change"). A hand-chosen "Search papers" gets the same reply for small talk (it already does for plain greetings) and the same button.

**How it is proved (tests first, as in [how-we-work.md](../how-we-work.md)).** New cases in `router-cases.mjs`: the greetings and junk above, assistant requests, real-time questions, orders, and **borderline research messages that must still be searched**. The "safe" group's expectation changes from "search" to "none of the tools". Two gates, one for each direction (CLINC150 reports both): non-research caught at least 90%, **research wrongly refused at most 1%** (a refused topic costs the person a search, so the gate is stricter on that side). Part of the cases written *before* the rules are tuned and kept as held-out (the W3 note's own lesson).

**How it is watched.** The outcome count already has `small_talk`; add `not_research` split by layer (rules or model) and a count of "Search for it anyway" (the nearest thing to a wrong-refusal rate). Counts only, never text, as the privacy text promises.

## 5. Decisions for the owner

1. Refuse with the page's message and a "Search for it anyway" button (recommended), or search quietly as now and only tidy the notices?
2. The borderline general questions above stay searched (recommended)?
3. More model calls for signed-in people (about 100 tokens each and maybe a second's wait) in return for catching the long tail. The speed trade can be softened by starting layer 1 only when layer 0 is unsure. Acceptable?
4. The wording of the reply and the three example questions (the voice is the owner's).

## 6. Not done, and not checked

- Nothing is built. The 56 messages are my list, not what real people typed; the live rate is not known (the outcome count would give it).
- "Some of the places we search did not answer" appeared on the owner's screenshot. That may be a source that was down for a moment and is a separate question from this one; I have not looked at the source health for that time.
- A short, non-English, non-Hindi message (Tamil, Bengali) is not covered by the filler lexicon.

## 7. Step 1, built (1 Nov 2026): what needs no decision from the owner

Done, with tests first (`router.test.ts`, `chat-e2e.mjs`, `e2e/chat.mjs`):

- **The filler gate** (`isSmallTalk` in `packages/shared/src/route.ts`): a message is small talk when every word is a greeting, a politeness, a chit-chat word or a little word of them (English, Hinglish, Devanagari); one real word makes it a search; an all-capitals word in a mixed-case message is an acronym ("WHO guidelines"); digits or more than 8 words make it a search. The same 56 messages: **small talk 1 of 56 before, 21 of 56 after** (greetings and chit-chat 0 of 24 before, 19 of 24 after); of the nine research messages used as a control, **none** is taken for small talk (and look-alike topics in `router.test.ts` that must stay searches: "BERT", "WHO", "Hi-C sequencing", "ME/CFS", "how are you doing metrics for student engagement" ...).
- **A reply that suits the message, in its language, written by the page** (`smallTalkReply`): a hello, a "how are you", a thanks, a goodbye; English, Hinglish, Hindi; then what the box is for. No model, nothing sent anywhere, so the privacy text ("A greeting or a thanks is answered by the page itself and sent nowhere") is true again for "hey how are you", which until now went to the five sources and the AI service. It makes no claim about the world.
- **No dead end**: under the reply, the four example searches (one click sends one) and "Not small talk? Search for these words anyway" (`anyway: true` in the request, only valid for a search chosen by hand). The line "I understood this as Search papers" is no longer shown for small talk, because it was not true (reason `small_talk` on the `done` event, which is also what the outcome count already called it).

Not done: the model layer (section 4), so "tell me a joke", "weather today" and "asdfgh" still go to a search; a model-written reply (see below).

### The question of a model-written reply (as ChatGPT or Claude do)

Asked by the owner on 1 Nov. It can be done, and it is the owner's call because of what it sends: the privacy text promises that a greeting is **sent nowhere**; a model-written reply sends it to the AI service, so the text changes and `PRIVACY_VERSION` goes up (everyone is asked to read it again). Other costs and risks: about 150 tokens of the daily allowance for each hello (the answer to a question is about 6,000), nothing for a person who is not signed in (so the page's line stays for them), and the model must be held to one or two warm sentences with no fact and no paper named (the same rules as `general.ts`), or the box becomes a general chatbot whose claims cannot be checked, which is what the product is not. The page's reply above covers the common cases without any of that. If the owner wants it: a signed-in-only call with a short system message, a cap on length and on the number a day, the page's line as the fallback, and the privacy text and version updated in the same change.
