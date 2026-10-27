# Literature scan: a topic, split into sub-questions, each answered from abstracts, kept as one report (built 27 Oct 2026)

The first feature that spends many AI tokens in one go. It follows [research-patterns.md](research-patterns.md) (section 4), the cost spike [R11](../spikes/R11-scan-cost.md) and the Workflow spike [R10](../spikes/R10-fan-out.md). The decisions below were the user's on 27 Oct 2026; where I chose a number the reason is given.

## What the person does

1. **Rail → Literature scan** (or the command palette). Signed in, privacy note read (a new one: topics and scans, version `2026-10-draft-11`).
2. Writes a topic (8 to 400 characters; English, Hindi or Hinglish) and may choose the language of the answers: *same as my topic* (default), English, Hinglish, Hindi.
3. **Plan.** A private model proposes 3 to 6 sub-questions, each with the **English search words** that would be sent to the paper indexes. The person edits, removes, adds (2 to 6 stay). The page says that only those search words leave for public services, and what the scan is expected to use of today's allowance.
4. **Start.** The scan runs on the server. The page shows "N of M sub-questions finished", where each unfinished one is (searching, reading) and can stop it. The page can be closed.
5. **Report.** One section per sub-question: the checked answer with source marks, "The sentences behind it" (the abstract's sentence for each source, word for word), or a plain gap with its reason. One numbered list of sources (real records, DOI link). Markdown download, print, delete.
6. Kept **24 hours** (list of "your scans of the last day" on the page, also from another device), then removed.

## Decisions (the user's, 27 Oct 2026)

| Question | Decision | Why / how it is kept |
| --- | --- | --- |
| A literature scan at all? | **Yes** | One feature, behind the left rail (new look only); not in the old look |
| Allowance | **The same 60,000 a day as everything else; no separate pool** (my choice of number) | A separate pool would raise what one person can spend; the Workers AI free quota is account-wide. The approval screen shows "about N of your 60,000 tokens (K left)"; the server refuses to start a scan the day's allowance cannot cover (N = 3,000 per sub-question: measured 1,800 to 2,300 in English and 3,000 to 3,200 in Hinglish, so the screen under-promises); at most **6 sub-questions** (18,000), **4 scans a day**, **one at a time**. The day's allowance is what really limits it: three six-question scans use it up, which the start check says before anything runs |
| Where the finished report lives | **On the server, 24 hours** | It survives a closed tab and works across devices. Stored: the topic, the approved plan, the checked answers and the (public) source records. In the privacy text (table row, "Your papers and ideas" bullet, "Literature scan" in How we verify), in the data export (`literatureScans`), erased with the account, and removed by the daily clean-up |
| Language | **Hinglish (and Hindi) supported, and a choice** | Default follows the topic (`detectLanguage`); the person can change it on the plan screen. The answers use the same language handling as chat (`chatSystem`). The sub-question headings follow the language the plan was written in; the search words are always English |

## Rules that stay (and how they are kept here)

- **No citation is ever written by a model.** A section is the prompt box's checked answer: the model names (paper number, sentence number), the server turns each pair into the abstract's own sentence, and a mark that points at nothing checked is removed. Sources are the search's own records.
- **The report is not written by a model.** The merge is a program (`assembleReport`, `packages/shared/src/litscan.ts`): sections in the plan's order, each section's marks renumbered into one list of sources (the same paper has one number). No summary paragraph, no "overview", no model call after the checks. So a scan costs its answers and nothing more, and every sentence on the page is a checked one.
- **No "general background" in a scan** (the chat's labelled background is not used): a gap stays a gap.
- **No claim of novelty or completeness.** The page and the file say: abstracts only, the first papers a search returns, "a map of what the papers found say, not a systematic review".
- **Gaps are normal.** R11 measured two or three of five sub-questions ending without an answer. A gap shows its reason (no papers found, no paper about it, no abstracts, the papers do not answer, an answer that could not be checked, too slow, allowance used, the AI service or the paper sources did not answer). A scan with gaps is a finished scan.
- **The topic never reaches a public service.** It goes to the private Workers AI model only (the plan, and nothing else). The approved search words go to the paper indexes.
- **Event rule.** Progress events carry no words (`worker`: place and stage; `progress`: done and total); the words arrive only in `part` events, already checked. There is no word-by-word text. `stream-shape.ts` classifies the `litscan` stream (a `progress.done` that goes back is a problem) and the endpoint test checks every stream it reads.

## How it works

```
POST /api/v1/litscan/plan      topic → sub-questions (private model; nothing stored)
POST /api/v1/litscan           the approved plan → a row in `litscans` + a Workflow instance
Workflow LitscanRun            load → worker-0 … worker-n (all at once, each its own step) → finish
GET  /api/v1/litscan/:id       the scan as it stands (a page reload, a second device, the fallback)
GET  /api/v1/litscan/:id/events?after=N   a stream: progress so far, the stored events after N, new ones until the end
POST /api/v1/litscan/:id/cancel, DELETE /api/v1/litscan/:id, GET /api/v1/litscan (the last day's scans)
```

- **One row for the scan, a list of events for what happened** (`litscans`, `litscan_events`, migration 0020). The page's view is the events folded (`reduceView`), so a reload, a second tab and the stream agree. A write carries a `key` and is stored once, so a retried step repeats nothing; nothing is stored after the scan has ended (a cancel wins over a worker that is still writing).
- **A worker** (`src/litscan/worker.ts`) is the prompt box's search and answer for one sub-question: the same search, then **only the papers that are about the sub-question** (`relevance.ts`: at least half of the search words' content words, and two, in the title or abstract), `pickEvidencePapers`, `answerFromResults` and check. It returns an answer or a reason and writes nothing; the Workflow stores it. **The searches of a scan go through a shared lane** (`GATES.litscan`: two at a time, a start every two seconds, in the same Durable Object as the Crossref and CORE lanes), and a search that found nothing because the sources did not answer is thrown, not called "nothing found". A failure that waiting could cure (the model service, the sources) and the engine tries the step again (2 more tries, 6 s and longer); a sub-question that still fails is a gap `unavailable`. A model that has not answered **75 s after it started** is a gap `too_slow` (R11 saw 17 to 24 s usually, 62 s once).
- **The stream is a view, not the delivery.** `progress` is worked out by the stream from the parts it has sent (never down); a reader that comes back asks for events `after` the last one it saw and first gets the progress so far; a finished scan asked after its last event still gets its end, so a page never waits for nothing. The page reads the scan, follows the stream, and if the stream is cut waits, reads the scan again and goes on (`useScan`).
- **A scan that stops moving is over.** Every event moves `updated_at`; a running scan quiet for 12 minutes is ended as `failed` the next time anyone reads it (and no longer counts as "the one that is running").
- **Cancel** ends the scan (one `done: canceled`, the finished parts stay) and asks the engine to terminate the instance.
- **Counts.** Each sub-question is counted once in `answer_outcomes` (feature `litscan`: answered, nothing_found, no_abstracts, not_answered, not_grounded, too_slow, quota, unavailable; shown on the admin page, 90 days). One log line a scan (`litscan_done`: how many, how many answered, language, time: no text, no person). The model's tokens are in `llm_usage` with the labels `litscan_plan` and `litscan_worker`.

## Limits

| What | Value |
| --- | --- |
| Topic | 8 to 400 characters |
| Sub-questions | 2 to 6 (the plan proposes 3 to 6); question at most 200 characters, search words at most 160 |
| Scans | one running at a time; 4 started a day (UTC; a counter that deleting a scan does not reset; refunded if the start fails) |
| Allowance | same 60,000 tokens a day; start refused if the plan's estimate (3,000 each) is more than what is left |
| One worker | search, then the model: 75 s for the model; step limit 4 minutes |
| Kept | 24 hours, then removed (daily clean-up); delete at any time |
| Who | signed in, privacy note of this version read |

## Tests

- **Unit** (`src/litscan/*.test.ts`, 68): the report assembly (one source list, renumbered marks, gaps, nothing added), the view fold (repeat-safe, never back), the event rule for the new stream, the Markdown file, the plan (scrubbing, limits, the approved plan cleaned again), the relevance check, the search words, the worker (every outcome, papers that are not about the question, sources that did not answer, the language, a failure that is retried, titles cleaned), the store on a real SQLite (once-only events, nothing after the end, cancel against finish, five writes at once, stale, ownership, the clean-up, the daily counter).
- **Endpoint** (`scripts/litscan-e2e.mjs`, 68 checks, real Worker with local Workflows and the offline stand-ins): access, validation, the plan, a five-sub-question scan with every kind of gap (the stream, the snapshot, a reconnect, after the end), the counters, ownership, one at a time, cancel (nothing added afterwards), the daily limit, the allowance, a lost workflow, delete, export, erasing the account.
- **Browser** (`e2e/litscan.mjs`, 52 checks, axe in light and dark, phone width): sign-in gate, the rail, the privacy note, editing the plan, the running scan (progress, stages, stop), the report (marks, evidence, gaps, one source list), reload, a second tab, the file, delete.
- **Live** (`scripts/litscan-live.mjs`, deployed staging, real model and search): see "Measured".

## Measured (deployed staging, real model and real search, 27 Oct 2026)

Scripts: [litscan-live.mjs](../../apps/api/scripts/litscan-live.mjs) (staging only, throwaway accounts, erased after). Two topics at once, an English one (air pollution and childhood asthma, 5 sub-questions) and a Hinglish one (mobile phones and children's eyes, 5 to 6), then a cancel and a reconnect.

| | First run | After the three fixes below |
| --- | --- | --- |
| English, 5 sub-questions | 41 s; **2 answered, 3 gaps** (two of them "0 papers") | 52 s (with the other scan running at the same time); **3 answered, 2 gaps** (one "no paper is about it", one "papers without abstracts") |
| Hinglish | 86 s; 3 of 6 answered, 3 gaps: two "0 papers", one "too slow" (the 75 s limit fired); **eight sources cited to say that none was about the question** (a phone battery blast, an HIV text-message programme, a screen-protector study) | 73 s; **4 of 5 answered**, 1 gap ("no paper is about it"); every source is about children's eyes |
| Tokens | 10,002 (English, 5), 13,708 (Hinglish, 6; **over** the 13,200 shown) | 8,399 (English, 4 calls), 15,220 (Hinglish, 5 calls) against 15,000 and 18,000 shown |
| Per model call | about 1,100 to 2,300 (English), 3,000 to 3,200 (Hinglish) | the same |
| Plan | 7.6 s and 9 s | 11 to 15 s (two scans planning at once) |

**What the first live run found, and what was done** (all three would have shipped, because the offline stand-ins cannot show them):

1. **"Nothing found" that was not.** The searches of a scan ran five or six at once, and OpenAlex, PubMed and Crossref answered **HTTP 429** (too many requests) to all of them; the same words searched one at a time give 20 papers. The page said "no papers were found". Now: the scan's searches take turns in a shared lane (two at a time), a search that found nothing while a source refused is thrown and the engine tries it again (6 s, then 12 s), and only after that is it a gap, in words that say the sources did not answer. One log line (`litscan_search`) records the sources' states when a search finds nothing or a source fails. The search phase of a scan is about 25 s instead of 10.
2. **Papers that share a word and nothing else.** A loose search returns twenty papers; the model, told to read them, cited eight of them to say that none was about the question. Nothing was false, and the report was noise. Now only papers that use at least half of the search words' own terms are read (plain word matching, no model); if none does, the gap says so ("none of them is about this sub-question").
3. **The plan's search words** were 8 to 12 words long with typographic hyphens ("land‑use", "meta‑analysis"). Now at most 7 words, plain hyphens, no punctuation, and the prompt asks for 3 to 6 specific terms. The person still sees and can change them; what they approve is what is sent.

Also: the estimate went from 2,200 to 3,000 a sub-question (the Hinglish scan used more than it said); escaped markup in a title (`&lt;b&gt;…`) is cleaned; the page and the file now say that **a sentence without a source number is wording, not a finding** (the model sometimes ends an answer with a conclusion that has no mark, as in the prompt box; the claims carry the marks, and the label "every claim" replaces "every statement").

**Cancel and come back, on the real Workflow:** a stream closed after the first part and opened again replays and goes on; `cancel` answered in 2.4 to 2.9 s; the instance showed **Terminated**; the parts at the cancel and 25 s later were the same (nothing added after it). The event rule held on all 8 streams read.

**Still true:** one or two of five sub-questions end without a written answer, as R11 said (now with honest reasons); one answer once took longer than 75 s; the model's Hinglish is good but long. A scan costs about 8,000 to 15,000 tokens, 14 to 25% of a day.

## Added 28 Oct 2026: a read-only link, a notice when it finishes, a way out of a gap

- **Share a link** (migration 0021, `litscan_shares`; `src/litscan/share.ts`). For a scan that has ended, the owner presses "Share a link"; the dialog says first who can read it, until when (the scan's own day) and that it shows the topic, the sub-questions and the report but not a name or an e-mail; "Create the link" makes it. The token is 32 random bytes (43 characters), the whole credential, like any shared link; one link a scan, at most 5 at a time a person; "Stop sharing" kills it at once and turning it on again makes a new one. **Anyone with the link reads `/literature-scan/shared/<token>` without signing in**: the topic, the plan, the sections and the sources (`LitscanPublic`: no id, no allowance, nothing about the person), with no way to change anything; the page says it is not to be indexed (a `robots` meta, `X-Robots-Tag` on the API reply and, for the page, `public/_headers`: `noindex`, `no-store`, `Referrer-Policy: no-referrer`). A wrong, turned-off or expired link is one plain 404. The link goes when the scan is deleted, expires with it, is removed by the daily clean-up and with the account. The privacy text lists it (the Literature scan row and bullet) without a new version number: it is something a person does on purpose, with the consequence shown before they press, as with offline reading.
- **A notice when it finishes** (`lib/notify.ts`). A running scan offers "Notify me when it finishes": the browser's own notification, asked for with a click. It is shown only for a scan that was seen running on this page and only when the page is in the background, once, and carries counts only (**not the topic**). It works while the tab stays open; closing the tab ends it (the scan is in the list of the last day's scans). The choice is kept in this browser. **E-mail is not done**: it needs a mail service and a verified sender, and a person's address held for it; a browser notice needs none of that.
- **A gap points at the papers.** A sub-question without a written answer has "Look at the papers for these search words yourself": the prompt box's search page for the sub-question's own search words, in a new tab.
- Tests: 9 more unit tests (share on a real SQLite), 11 more endpoint checks, 15 more browser checks (the dialog, the link, the clipboard, a signed-out visitor reading it with axe in light and dark, turning it off, the notice).

## Not done, and why

- **Full papers are not read** (the Ask-this-paper path takes 20 to 25 s a new paper; a different, much slower worker). Abstracts only, said on the page.
- **No e-mail when it finishes** (a browser notice exists; e-mail needs a mail service, a sender and a stored address).
- **A shared link is read-only and shows the topic**: it cannot be limited to certain people (anyone who has it can read it).
- **More than 6 sub-questions** (the Crossref lane at higher fan-out was not measured, R11).
- **The part registry (P2)** is still not needed: the scan has its own components and uses the chat's styles for marks and evidence.
- **Verify-and-repair (P3)** waits for `answer_outcomes` data. The scan makes it more interesting (a repaired sub-question is one fewer gap) and the counters now include the scan's own `not_grounded`.
- **Old look:** the page exists in the new look only (the old look is going away: [w6.md](w6.md)).
