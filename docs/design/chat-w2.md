# W2: the prompt box as a conversation (as built, 26 Oct 2026)

Part of [unified-workspace.md](unified-workspace.md). This page says what W2 does, how, what was measured with the real model, and what it does not do yet.

## What a person sees

On Home, with "Search papers" chosen and signed in or not, Enter does not leave the page. The question appears as a message, the box glides to the bottom, and under the question a reply builds up:

1. **"I understood this as Search papers · Change"** (Change hands the same text to Check references or Idea Check).
2. **Steps in plain words** (Searching, Reading the papers, Writing, Checking the sources) with the one that is running marked. A person who is not signed in sees only Searching: no written answer is promised to them.
3. **The papers**, numbered 1, 2, 3 ... as soon as the first source answers, the list re-ordering as more arrive. They are the same cards as before (DOI check, open access, retraction banner, Save, Cite, Preview).
4. **A short answer** (signed in): at most about 120 words, in the language of the question, every claim marked with the number of the paper it comes from. A mark is a button that scrolls to that paper and marks it for a moment; "The sentences behind it" lists, for each mark, the sentence of the abstract it rests on, word for word.
5. **Plain lines** when something is missing: "Some of the places we search did not answer, so this list may be incomplete. Search again" (no source is named), "Nothing was found for that", "The papers found do not seem to answer this directly", "An answer could not be checked against these papers, so none is shown", the retraction line (a retracted paper is never used for the answer), "You have used today's AI allowance", "Sign in to get a short written answer".
6. **Stop**: the send button becomes a Stop button while a reply is being made. Stop keeps the papers found so far and drops the half-written answer; the model call is aborted, so nothing is billed for what was thrown away.

Conversations are kept **only in this browser** (list in localStorage, each conversation in IndexedDB). The rail has **New chat** and **Recent** (the six latest, each with a delete button); a second tab starts its own empty conversation but sees the same Recent list at once; a reload brings the conversation back, and a reply found "working" is marked **interrupted** with "Search again". If the browser refuses to keep them, the conversation works and a notice says it will not be kept. Signing out and "Delete all chats" in Settings remove everything; they are not in the data export because the server never had them.

## How it works

`POST /api/v1/chat` (same-origin, `mode: "search"` in W2, 2 to 300 characters; W3 adds `"auto"`) answers with server-sent events: `understood`, `step`, `papers` (a snapshot after each source; the last marked final), `notice`, `token` (the answer as it is written, provisional), `answer` (checked), `done` (with the reason when there is no written answer), `error`. It shares the search rate limit. The server keeps nothing: no chat table (a test asserts it).

The written answer (`apps/api/src/chat/answer.ts`):

- The model reads up to 8 of the first 20 papers that have an abstract and are not retracted. Each paper keeps its **place in the list as its number**, so the marks in the answer are the numbers on the cards.
- Abstracts are split into sentences labelled S1, S2 ... The model names its evidence by **paper number and sentence number**; the server turns each pair into the sentence itself. A pair that is not a real sentence of a real abstract gives nothing; a mark `[n]` that points at nothing checked is removed. If no claim has a sentence behind it, no answer is shown (`not_grounded`), and if the model says none of the papers is about the subject, a plain line says so (`not_answered`).
- The text goes to the **private** model lane only (Workers AI), with `label: "chat_search"` in the ledger, so cost shows per feature on `/admin`.
- The papers' text is data: the system message says so, and what the model returns is only ever used through the checks above.

## What the real model taught (measured, `scripts/chat-live.mjs`, Workers AI, real sources)

| Finding | What was done |
| --- | --- |
| With a long list of rules the model said "the papers do not answer" about papers that plainly did (glaucoma detection from fundus photographs for a question about smartphones in rural India), 4 times in 4 | the system message is now short; it also asks for `coverage` (full, partial, none) instead of a yes/no `enough`; a partial answer must say what the papers do not settle. The same abstracts then gave an answer in 2 of 3 runs |
| It still says "none" now and then for the same papers (it varies from run to run) | **one retry**, only when the answer is none and at least two papers use two of the question's key words, with a plain reminder. The retry is checked the same way. Never a second try otherwise |
| It writes marks in many styles: `[1]`, `[1 (4)]`, `[1] (4)`, `(1) (4)`, `【1】(9)`, `【12†S1-S7】`, `[1]S4`, `[1](S2)`, `(1 S2-S4)`, `[1, 6]` | sentences are labelled `S1` (not `(1)`), the instruction says square brackets and the paper number only, and `normaliseMarks` (tested with every style above) turns what is left into `[n]` |
| `maxTokens` 600 or 2000 was too little for a reasoning model: "no JSON in output", "unterminated JSON" | 3500, with a 60 s limit; a model failure is `unavailable`, never an invented answer |
| A topic (not a question) was treated as a question the papers do not answer | the instruction says a topic gets "what these papers report about it" |
| First run, six questions in English, Hindi and Hinglish: 4 answered with checked sources (23 marks), 1 correctly "papers do not answer" (the Hindi query found Hindi papers on other subjects), 1 "no abstracts" (the Hinglish query found one paper with an abstract) | the last two are search-quality problems, not answer problems: the query is not translated yet. That is the router's job in W3 |
| Time | papers first after about 30 ms (cache) to 2 s (cold); the whole reply 6 to 18 s, median about 12 s |

## The eval (`scripts/chat-eval.mjs`, weekly in `.github/workflows/qa-eval.yml`, gate with `--gate`)

Twelve questions on topics with plenty of literature (English, some with an Indian setting), two nonsense controls and two Hindi or Hinglish questions (not gated yet). It checks properties, not words, because the papers found change from week to week:

| Line | Limit | First gated run (26 Oct) |
| --- | --- | --- |
| answered (of the questions that found at least two abstracts) | at least 75% | **12 of 12** |
| every sentence shown as evidence is in that paper's abstract, no mark points at a retracted paper, every `[n]` in the words is a checked citation, no label (S3), round-bracket number or 【】 token is left | 0 problems | **0 in 13 answers** (the first runs found 3, then 4, then 2, then 2 of them: new mark styles every time, now all handled by `normaliseMarks` with a general clean-up for brackets that hold only paper numbers and sentence labels) |
| nonsense questions that got an answer | 0 | **0 of 2** |
| median reply | information | 14 to 17 s |

What the gate does not and cannot say: whether a checked sentence really supports the claim it is attached to (that is the model's judgement, as in Q&A on one paper; a reader sees the sentence and can judge), and how answers behave when the abstracts contain instructions (the system message says they are untrusted, and the server only ever uses the model's numbers; there is no fixture with an injected abstract yet).

## Decisions of 25 Oct that came with W2

- **Naming the highlight colours and two papers side by side are set aside**, not deleted: `PARKED` in `lib/workspace.ts`, switched on in a browser with `localStorage.setItem("scholar.parked", "names,split")`; `e2e/parked.mjs` keeps them working. Colours are just Yellow, Green, Blue and Pink (also in the Markdown and in what the model is told).
- **"Ask my highlights" is part of the Ask box of a paper**, not a second box. `classifyAskSource` (rules, no model, same answer every time, 35 tests in English, Hinglish and Hindi) decides: a question that names marking (highlight, underline, note, annotation) and speaks of the reader (my, I, mere, maine, मेरे) or names a colour of highlight is answered from the highlights; anything else from the paper. The answer says "From your highlights" and offers **"Ask the paper instead"**; a paper answer that found nothing offers **"Ask my highlights instead"**. With no highlights the reply is a plain line made without a model. Answers from highlights are kept only for the visit.

## Not done in W2 (on purpose)

- ~~The prompt box does not choose the tool~~ (done in W3: Auto, with Hinglish and Hindi and a translated query for the indexes; see [router-w3.md](router-w3.md)).
- Check references, Idea Check and Ask a paper still open their own pages: Idea Check inside the workspace is **W5**; Ask any open-access paper is **W4**.
- General answers (no paper) with the label: **W5**.
- Follow-up messages ("only after 2020") are new searches: the server does not use the earlier messages yet.
- The "Still working…" line after 15 s of silence and a retry on a dropped connection beyond "Search again": the stream has no heartbeat yet.

## Edge cases from the register that W2 covers

R-1 (too short or no letter: the button is disabled / refused with a line), R-2 (over 300: refused with the limit, nothing cut), R-10 (a second message waits: the first must finish or be stopped), R-11 (Stop), R-12 (reload mid-answer: interrupted, kept papers), R-13 (allowance: plain line, papers still shown), S-1 (a source did not answer), S-2 (nothing found), S-3 (retracted paper), CH-1, CH-2, CH-3, U-2 (phone, box on screen), U-3 (one polite message per reply). Tests: `src/chat/*.test.ts` (50), `scripts/chat-e2e.mjs` (about 30 checks on the endpoint), `e2e/chat.mjs` (about 60 browser checks including axe in three themes and on a phone).
