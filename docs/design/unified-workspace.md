# Plan: one workspace with a prompt box (redesign)

Date: 2026-10-24 (version 2, after your answers). Status: **approved in principle; building starts after V5 and I4, which are done**. Look at the POC:
[`docs/design/poc/unified-workspace.html`](poc/unified-workspace.html), one file, open it in a browser (double-click). It opens on the **intro screen** (signed out); **Sign in** leads to the **home**.
All data in it is sample data (DOIs `10.0000/sample.*`). Checks that ran on it: `apps/web/e2e/poc.mjs` (walkthrough, axe in three themes, phone width, reduced motion).

## 0. What you decided, and what I did with it

| You said | What it became |
| --- | --- |
| My Papers stays as it is; remove the "Open and ask" button | **Updated 24 Oct (later):** the page and the cards are exactly as today. The only change is that the "Open and ask" button is gone; the cover opens the paper as before, and Ask lives in the reader as before. **No Cite, no Notes, no new badges** (I had proposed them in the POC; you said no) |
| Liked the features | Kept: prompt box with modes, "I understood this as… Change", streamed answer, Idea Check workspace, Settings page |
| Design the home and the intro, the most important part, with the same logo, no change | Both are in the POC, see section 2. The logo is the product's own file (`Logo.tsx`), drawn exactly the same, with its hover. **The intro is now a scroll-animated story** (research and decisions: [scroll-site.md](scroll-site.md)), built in the real app in W1 behind `?ws=1` |
| Nothing to buy | Skiper premium and Animmaster are out; no new design dependency at all |
| Hinglish from the first release | In the router, in the answers, in the eval set and in the demo: section 4.4 |
| Idea Check may list its sources | The report keeps "what was searched" (already built, and CORE joins it) |
| Server-side open-access fetch in the first release; redo the system design if needed | Yes, and **my first S1 approach was not efficient**: section 5 says why and replaces it. The system design is redone in section 6 |
| Every edge case in the assumptions | Section 9 is the register |
| First V5 and I4, then the phases | Done (R7). Phases in section 10 |

## 1. What changes, in one paragraph

Today the product is a set of pages (Search, Verify, Idea Check, My papers, Library). The proposal is **one screen with a prompt box**, like Claude or ChatGPT: you write or paste something,
the product works out what you want, shows "I understood this as: Search papers · Change", streams an answer in plain words and lists the real papers under it. Search, Verify references, Idea Check and Ask a paper become
**tools** (pills under the box, and a menu inside it); Auto is the default. **My papers, Library and the paper preview stay separate sections**, and **Settings becomes its own page**.
Idea Check keeps its own structured workspace inside the same screen, because it is a process (approve a plan, closest papers, a coverage map, gaps, a report), not a chat.

What does **not** change: every paper listed is a real record that was looked up; every quote is checked against the text; no model-written citations; your idea, files and pasted references are never
sent to public services (only a plan you approved, or a cleaned query, goes out); no pilot items are touched.

## 2. The intro and the home

### 2.1 Intro (signed out). The first thing a new person sees

**Built as a scroll-animated story in W1** (see [scroll-site.md](scroll-site.md) for why and how: Motion's scroll timelines, native scrolling, a pinned four-chapter tour whose product window is scrubbed by the scroll, a stacked static version for phones and reduced motion). The table below is the original POC outline; the real page follows scroll-site.md section 3.

Goal: in ten seconds a scholar understands what it does and why to trust it, without reading a paragraph. Built on the Framer guide (oversized serif headline with one emphasised word, staggered entrance, a quiet ambient background), UI UX Pro Max rules and our springs.

| Part | What it does |
| --- | --- |
| Header | the logo, four section links, the theme switch (Light, Dark, Read), **Sign in**. On a phone: logo and Sign in only; the theme switch moves to the footer |
| Hero, left | "Research you can *trust*." (words arrive one by one, the underline draws itself), one sentence of what it does, **Continue with Google / ORCID**, "your papers and ideas stay private", four things that are checked |
| Hero, right | **a live demo of the prompt box**: it types a question, the mode chip changes, "I understood this as… Change" appears, steps tick, an answer streams with citation chips, real-looking cards. Four short scenes in a loop (a search, a reference check in Hinglish, Idea Check with its coverage map, a question to a paper in Hinglish). It has a **pause button**, shows its finished state at once with reduced motion, and names no source |
| "One box. Four things you do every week." | four tiles (bento) with a small animation each: DOI ticks and a retraction, verdicts per reference, the coverage map filling, a quote highlighted with its page |
| "Built so you can check the checker" | three rules shown, not told: a DOI that resolves, a quote that is highlighted, a red retraction banner; and a plain box about limits ("not found does not mean made up", "never says an idea is new") |
| "Ask the way you think" | a Hinglish exchange, with the "I understood this as" line |
| "Your work stays yours" | private to the account, only an approved search leaves, delete everything |
| Final band, footer | one more sign-in button; legal links and the attribution of the record sources |

Honesty rules for this page: no number, logo, testimonial or "used by" claim that is not real; the demo says it is sample data; every sentence about what the product does is something that exists or is in this plan.
Performance: no video, no WebGL, no library; fonts are the ones we already self-host; animation is transform and opacity; the only script is the demo and a scroll reveal.

### 2.2 Home (signed in). What the person sees every day

| Part | What it does |
| --- | --- |
| Greeting | a small line by time of day and name |
| Headline | "What would you like to *look into*?" in the same voice as the intro |
| **The prompt box in the middle** | it is the page. After the first message it **glides to the bottom** (and returns with New chat). Rotating placeholders, a mode menu, an attach button, Enter to send, a stop button while it works |
| Tool pills | Search papers · Check references · Idea Check · Ask a paper. A click only chooses the mode (a second click returns to Auto); a line below says what the tool does |
| Pick up where you left off | three cards: the last chat, "3 papers ready to ask" (a stack of covers), an Idea Check plan not yet searched. Only things that exist: chats from this browser, the real papers, a real draft |
| Starters | four example prompts, two of them in Hinglish |
| Left rail | New chat, My papers, Library, Recent, then the account (name, Sign out), Settings and the theme switch. A drawer on a phone (Escape closes it) |

### 2.3 My papers

**Exactly as today**: the hero, the drop zone, the cards (cover, title with its rename pencil, pages and size, the "Scan" mark, delete). Inside the new frame (the rail), nothing else changes, except that the "Open and ask" button is removed: the cover opens the paper, as it always did. **Renamed "My Workspace" on 24 Oct**: a paper opens on the whole window (no rail, no footer) and can be drawn on; see [my-workspace.md](my-workspace.md).
(The POC card with Cite, Notes and "Ready to ask" badges was a proposal you rejected.) Open-access papers saved from search (W4) will appear here as ordinary papers.

## 3. Interaction model

- **Prompt box**: multi-line, Enter sends, Shift+Enter new line, a paperclip for a file (PDF, Word, LaTeX, text, .bib; read in the browser as today), a mode menu (radio items; arrow keys, Escape returns focus), a **Stop** button during any answer.
- **"I understood this as X · Change"**: always above an answer; one click re-runs under another mode without retyping. A mode chosen by hand is never overridden.
- **Progress**: a short list of steps in plain words and a small status pill. **No source is named while searching.**
- **Answer**: streamed; citations are buttons that scroll to and highlight the paper they point at; paper cards below (DOI checked, open access, retraction banner, Save to My papers, Ask this paper).
- **Idea Check**: its own six-step workspace; **you approve the four parts before any search runs**.
- **Ask any paper**: section 5.

### Not naming sources, and staying honest

During the search nothing says where we look. If one or more places did not answer, the answer carries one plain line, "Some of the places we search did not answer, so this list may be incomplete. Search again" (no names, **and never hidden**).
The Idea Check report keeps the list of what was searched (a report is a record; a supervisor will ask), and the footer keeps the attribution the sources' terms ask for.

## 4. The agent

### 4.1 What I took from [building-claude-from-scratch](https://github.com/FareedKhan-dev/building-claude-from-scratch)

A teaching notebook (62 components in 8 phases), not a library; nothing is installed from it.

| Idea | Our use |
| --- | --- |
| Classify the problem type first | the **router** |
| Orchestrator and workers, workers return short disciplined results | the orchestrator runs **fixed tools**; a tool returns a small structured result, never a transcript |
| Plan and execute with a task graph | only Idea Check (plan, search, compare, gaps), which already is one |
| Compact tool results | search results reach the model as numbered short records (title, year, sentence-numbered abstract) |
| Cache-friendly prompt order | system prompt and tools first, the person's text last, so the provider's prompt cache applies (measured in R5) |
| Definition of done per task | every tool has a check before it may answer (search: at least one verified record or it says so; paper Q&A: a checked quote or it says it found none) |
| Memory tiers | two only: this chat (browser) and saved papers. No memory of the person |

Left out: a free-running loop that decides its own steps. It is costly, hard to test, and its failure ("it searched for something else and answered confidently") is exactly what this product must not do.

### 4.2 The router

1. **Rules first, free and instant**: a pasted list that the existing splitter reads as 3 or more references means *Check references*; an attached file means *Idea Check* (or *Ask a paper* if a paper is open); a bare DOI or a paper link means *Ask a paper*; a question about "this paper" with a paper open means *Ask a paper*.
2. **Then a small model call** returning JSON against a schema: `{ mode, confidence, query, language }`. Temperature 0; anything that does not fit the schema is treated as *Search*.
3. **Below a confidence limit it does not guess silently**: it runs the cheap safe default (Search) and shows "I understood this as Search papers · Change".
4. Idea Check is chosen **by the person** (pill or menu) or after the router asks "This looks like an idea to check. Check it?", because it reads the whole text and costs more.

Privacy: free text goes to the **private** model lane only (Workers AI). Only the model-cleaned `query` may go to public search APIs, through the scrubbing Idea Check's plan already uses. A router call is a few hundred tokens (about $0.0001).
The router gets an **eval set of about 150 labelled prompts** (English, Hindi in Devanagari, Hinglish in Roman letters, with typos and mixed intent) and a gate in CI; I will not ship a router I could not measure.

### 4.3 Tools (a fixed list)

| Tool | Exists | Behind |
| --- | --- | --- |
| `search_papers(query)` | yes | the search and its cache (V6), Crossref lane (V5) |
| `verify_references(text)` | yes | the Reference Verifier |
| `idea_check(...)` | yes | the Idea Check routes (CORE now a source) |
| `ask_paper(ref, question)` | partly | `/documents/:id/ask` today; new for any open-access paper (section 5) |
| `save_paper(ref)` | new | section 5 |
| `answer_general(question)` | new | section 4.5 |

"Sub-agents" in practice: the orchestrator calls a tool, and calls independent tools in parallel (references already go three at a time). A tool may use a model inside, but never calls the router or another tool.
Limits per turn: at most 4 tool calls, a time cap, and a Stop that reaches the model call (the stream already supports abort, so a thrown-away answer is not billed).

### 4.4 Hinglish, Hindi and the language of the answer

- The router, the mode names and the "I understood" line work for Roman-letter Hinglish ("Mere thesis ke references check kar do"), Devanagari Hindi and English, and mixes of them in one message.
- **The answer follows the language of the question**: a Hinglish question gets a Hinglish answer in Roman letters, Hindi gets Hindi, English gets English; the quotes from papers stay in the paper's own language and are never translated inside the quote box (a translation, if given, comes after it and is labelled).
- The query sent to the public indexes is always English (cleaned and translated by the model), because the indexes are; the person sees it ("I searched for: …") so a bad translation can be corrected.
- Measured before it ships: the router eval has a Hinglish slice with its own gate; the paper Q&A eval gets a Hinglish slice (questions in Hinglish about English papers) with the same groundedness and refusal gates; the model that fails the Hinglish slice is not used for Hinglish (the answer then says it is answering in English).
- UI strings stay English in the first release; the Settings page lists हिन्दी as "soon", honestly.

### 4.5 Answers that are not about one paper

Rule: **papers first, then general knowledge, never mixed up.** (1) Search quietly for papers on the question (same cache). (2) If the top records support an answer, answer from them with numbered citations (sentence numbers, checked).
(3) If not, answer from general knowledge under a visible label, "General background, not from a paper in your results", **with no citations**, and offer "Search papers on this". (4) A general statement is never presented as something a paper said.
This needs its own small eval (the paper-based part must pass the grounding gate; the general part must always carry the label) before it ships.

### 4.6 Safety rules for an agent that reads untrusted text

Abstracts, PDFs and web text are **data**: they cannot add tools, change the mode or cause a request. Nothing is written without a click (saving a paper is a button). The model never outputs a DOI, title or reference that goes on screen as a fact;
papers shown come from lookups and the model refers to them by number. A fetched file is only parsed as a PDF.

### 4.7 One streaming endpoint

`POST /api/v1/chat` (Server-Sent Events, same-origin, signed in, rate limited): events `understood`, `step`, `token`, `papers`, `cite`, `notice` (partial results), `done`, `error`. The browser sends the last six messages of the chat (the server keeps no chat).
Search and Q&A streaming already exist and are reused. Idea Check stays on its own routes (it has the approval step in the middle).

## 5. Ask any paper (S1): what I first proposed, why it was not efficient, and the design that replaces it

### 5.1 My first approach, honestly

*Press "Ask this paper" → a dialog says "saved to My papers first" → the **server** downloads the open-access PDF → stores a copy in that person's R2 space → the **browser** reads the stored file and indexes it (extracts text, makes chunks and embeddings) into that person's tables → then the question can be asked.*

It would have worked. It was **not efficient**, for five reasons:

1. **The same public paper is fetched, stored and embedded once per person.** Fifty people asking about the same famous paper means fifty downloads from the publisher, fifty copies and fifty embedding runs. Public papers are shared data; it should be done once.
2. **The browser has to finish the job.** Indexing runs in pdf.js in the tab. A person on a phone who locks the screen, or closes the tab, is left with a half-saved paper; the server cannot complete it.
3. **"Save first" is friction for a one-off question**, and it fills My papers (and the 30-paper limit) with papers people only wanted to glance at.
4. **The first answer waits for download plus indexing** (tens of seconds) even for a paper that thousands have asked about.
5. **A private copy per person does not remove the licence question.** Serving a publisher's PDF back is redistribution whatever way it is stored; only some licences allow it.

### 5.2 The design that replaces it: a shared index of open-access papers

- **One public, shared copy per paper**, keyed by DOI (or by the hash of the file when there is none): the PDF in R2 (kept only to re-read it; not served back unless the licence allows), and its **text chunks and embeddings in shared tables** (`oa_papers`, `oa_chunks`). It holds **no personal data**: nobody is recorded as having asked.
- **Ingest on the server, in a queue** (`oa-ingest`), not in the browser: *queued → fetching → reading → embedding → ready*, or *unreadable* with a reason. The question box shows "Reading the paper… 40%" over the stream; leaving the tab does not stop it.
- **Asking needs no saving.** "Ask this paper" works at once on any open-access paper whose index exists (instant), and on the first request waits only for the one-time ingest. The answer carries the page and the exact quote, as for your own papers.
- **"Save to My papers" is now light and optional**: a row that points at the shared paper (no file copy, no second index), so notes, highlights and the history of your questions have a private home. It counts as one paper in the list, and removing it removes only your row.
- **Reading the PDF itself** (the reader with highlights) opens the shared file **only when the licence is permissive** (for example CC BY, taken from the record's licence field). Otherwise the reader shows the extracted text with page numbers and a link to the publisher, and answers quote only short passages. (Assumption for you or a lawyer to confirm: section 9, row S1-L.)
- **Not open access, or no readable PDF**: the panel says so, answers from the **abstract only** (labelled "Based on the abstract only", same quote checking), and offers "Upload the PDF you have access to", which becomes one of *your* private papers.
- **Your own uploads stay private and separate**, even when they have the same DOI as a shared paper.

### 5.3 Fetching safely (SSRF, size, content)

HTTPS only, no IP literals, no non-standard ports, a hostname with a dot, internal-looking names refused, **every redirect re-checked** (at most 3), a hard timeout (25 s), a size cap (25 MB, counted while streaming, aborted beyond it),
`Content-Type` must be a PDF **and** the first bytes must be `%PDF-`; a landing page (HTML) is searched once for the standard `citation_pdf_url` tag and that link is tried with the same checks; page and file-size limits (120 pages, extracted text size) protect the Worker's memory.
A scanned PDF with no text layer is reported as "scanned, cannot be read here" (the OCR path stays for your own uploads). Politeness: one request per host at a time, arXiv one every three seconds, a contact `mailto` in the User-Agent, a per-person cap of new papers per day (cached papers are free).

### 5.4 Cost and limits (to be measured, not assumed)

A first ingest is a download, text extraction in the queue consumer and embeddings of about 60 to 200 chunks (cents at most); a question is about $0.0008 (R5). A shared paper is paid for once. Spike R8 (below) measures extraction time and memory on 20 real open-access PDFs before the design is fixed.

## 6. System design (redone)

```
Browser (React)  ──SSE──▶  Worker API (Hono)
  • intro, home, pages        ├─ /chat            router (rules → small model) → tools, one stream
  • chats kept locally        ├─ /search /references /idea/*   (as today, behind the tools)
  • reads files, makes        ├─ /papers/oa/:ref/ask|status|save   shared open-access index
    scans' page pictures      ├─ /documents/*     your own papers (as today)
                              ▼
        D1: users, documents, doc_chunks, oa_papers, oa_chunks, usage, ledger, cache_stats
        R2: users' files and covers; shared open-access PDFs (private bucket)
        KV: public cache (V6)      Queues: scan/index jobs, oa-ingest (new)
        Durable Objects: ApiGate (Crossref, CORE), S2Throttle      Workers AI: model, embeddings, vision
```

| Piece | Decision | Why |
| --- | --- | --- |
| Chat state | none on the server; the browser sends the last six messages | no stored chats means nothing new to protect or delete; decision for the first release (section 9, CH-1) |
| Router | `routeIntent(text, context)`: pure rules first, then one model call with a JSON schema; result is data (`mode`, `confidence`, `query`, `language`), never an action | testable without a model for the rules; the model part has an eval |
| Tools | plain functions with a typed result; the chat route only maps events to SSE | the existing routes keep working and keep their tests |
| Open-access index | new tables `oa_papers(id, doi, title, source_url, license, content_sha, pages, status, error, chunk_count, r2_key, created_at, checked_at)` and `oa_chunks(paper_id, idx, page, text, embedding)`; `documents` gets `oa_paper_id` | one shared public copy; saving is a pointer |
| Ingest | queue consumer `oa-ingest`, idempotent (a paper that is *ready* is a no-op; a paper *fetching* is joined, not started twice), retries with backoff, a dead-letter state with the reason | many people can press the button at once |
| Text extraction on the server | a serverless build of pdf.js (candidate: `unpdf`), page and size caps; **to be proved by spike R8** before it is relied on; the fallback is the browser path that exists today | Workers have a 128 MB memory limit |
| Refresh | an indexed paper is looked at again after 180 days, and when a retraction check says it was retracted the answers carry the banner | files change; retractions happen |
| Streaming | SSE with `Last-Event-ID` ignored (a dropped answer is asked again; searches come from the cache) | simple; the cost of a repeat is small |
| Limits | per-person: questions and tokens as now; **new papers ingested per day**; per-host politeness; a global ingest concurrency of 3 | protects the publishers and the bill |
| Observability | counters for router mode and confidence, ingest outcomes, partial-result notices, refusals; shown on `/admin` | the numbers that say whether it works |
| Rollback | a `WORKSPACE` flag per phase keeps the old pages until Phase 6 is stable | the working product is never at risk |

## 7. UI system and where each library idea is used

Base: the existing tokens and rules in [UI-direction.md](UI-direction.md): Source Serif 4 and Inter (self-hosted), Light, Dark and Read, `lib/motion.ts` springs, `MotionConfig reducedMotion="user"`, AA contrast checked by `npm run contrast`, axe clean in every theme, nothing scrolls sideways at 375 px.

| Source | Used for | Decision |
| --- | --- | --- |
| Framer guide, Motion Sites | oversized serif headline with one emphasised word, staggered entrance, ambient background | the intro and home headline |
| UI UX Pro Max (offline) | checklist: SVG icons, visible focus, reduced motion, 375/768/1024/1440, skeletons with `aria-busy` | the test list |
| Motion (`motion/react`) | springs for menu, pill, slide-over, card reorder; `layout` for streamed lists; the prompt box gliding down | used in the app (the POC uses CSS equivalents) |
| Aceternity UI (free; React + Tailwind + Motion) | Placeholders & Vanish Input, Multi Step Loader, Bento Grid, Sidebar, Spotlight, Focus Cards | the **patterns**, rewritten in our CSS (our web app has no Tailwind; adding it for six components would restyle everything). Already in the POC |
| Aceternity Text Generate Effect, Link Preview | none | rejected: our text really streams (a fake reveal lies about speed); Link Preview fetches third-party pages, which tells publishers what a person looks at |
| Skiper UI | the status pill and the tool tooltips (idea only) | no code copied, nothing bought |
| Animmaster Lib (WebGL + GSAP, paid) | none | not used: heavy for slow networks, decorative on a page people read; I found only a promotional page for it, no documentation or licence |

## 8. Streaming improvements (part of the build)

First tokens and first paper cards appear as soon as they exist; a slower source reorders cards with a `layout` animation, not a jump. **Stop** during any stream. No event for 15 s shows "Still working…" and a retry, never a blank wait.
A dropped connection keeps what arrived and offers "Ask again". Reduced motion: text arrives in chunks, final states identical. Screen readers: one polite live region says "Answer ready, 4 papers"; the text is not read word by word.

## 9. Assumptions and edge cases (the register)

Each row is something I assumed or a case that can happen, what the product does, and where it is tested. "Confirm" means it is a decision for you.

### Router and chat

| # | Case or assumption | What happens | Test |
| --- | --- | --- | --- |
| R-1 | Empty, one-word or only-punctuation message | not sent; the box keeps focus | unit + browser |
| R-2 | Very long paste (more than 20,000 characters) | refused with the limit shown; nothing is truncated silently | unit |
| R-3 | A message that fits two tools ("check this idea and its references") | the more specific rule wins; the "Change" line is the way out; Idea Check never starts without a click | router eval |
| R-4 | The router model fails, times out or returns text that is not the schema | falls back to Search (the cheapest safe tool) and says so | unit |
| R-5 | Prompt injection in a paper or pasted text ("ignore your rules and…") | text from papers is data; the router sees only the person's own message; a pasted block is classified, never obeyed | eval cases + unit |
| R-6 | Hinglish in Roman letters, Devanagari Hindi, mixed scripts, typos | routed by meaning; the Hinglish slice of the eval has its own gate | router eval |
| R-7 | The person writes in a language we do not support | answered in English, saying so | unit |
| R-8 | A DOI or paper link is pasted alone | opens that paper's Ask panel (open access), or says it is abstract-only | rules test |
| R-9 | A file is attached with a question | the file becomes the context: a reference list → Check references; a paper → Ask a paper (saved first, your own private copy); a manuscript or idea file → Idea Check (asks first) | browser |
| R-10 | Two messages sent quickly | the second waits until the first finishes or is stopped | browser |
| R-11 | The person presses Stop | the stream ends, the model call is aborted, nothing half-written is saved | unit + browser |
| R-12 | The page is reloaded mid-answer | the chat is restored from the browser, the unfinished answer is marked "interrupted" with Ask again | browser |
| R-13 | Rate limit or daily AI allowance reached | a clear message with when it resets; tools that need no model (rules, search) still work | integration |

### Search, references, Idea Check

| # | Case | What happens | Test |
| --- | --- | --- | --- |
| S-1 | Some sources fail | the answer shows the plain "some places did not answer" line; the rest is shown | unit |
| S-2 | No result at all | "nothing found" with suggestions, never an invented paper | unit |
| S-3 | A retracted paper in the list | red banner everywhere, also in the summary text | existing + browser |
| S-4 | The summary mentions a paper that is not in the list | impossible by construction: the model refers by number; a number with no record is dropped | unit |
| S-5 | Reference list with 100+ entries | processed three at a time with progress; the Crossref lane queues them (V5); "could not check" is never "not found" | existing + lane tests |
| S-6 | Crossref or CORE busy or closed | the call is not made; the answer says it could not check | R7 tests |
| S-7 | Idea text contains an e-mail, a name or a URL | removed from the plan before any public search (existing scrubbing) | existing |
| S-8 | Idea Check abandoned half way | nothing is stored (confirm I7 later); the plan stays in the browser tab | browser |
| S-9 | Sources named in the report, not while searching | as decided | browser |

### Open-access papers (S1)

| # | Case | What happens | Test |
| --- | --- | --- | --- |
| P-1 | The paper has a DOI and an open-access PDF link | shared ingest, then Q&A | integration |
| P-2 | The link is a landing page, not a PDF | the `citation_pdf_url` tag is tried once; otherwise "this publisher did not give a PDF" and abstract-only | unit |
| P-3 | The link redirects to a private address, a non-HTTPS URL, an IP literal, a strange port | refused | SSRF tests |
| P-4 | Huge file, endless stream, or a server that sends nothing | aborted at the size cap or the timeout; marked *unreadable* with the reason; not retried for an hour | unit |
| P-5 | The file is not a PDF though it says so | refused by the magic bytes | unit |
| P-6 | A scanned PDF (no text layer) | "scanned, cannot be read here"; the person may upload it to get the OCR path | unit |
| P-7 | Two people ask the same new paper at once | one ingest; the second joins and sees the same progress | integration |
| P-8 | Ingest fails half way | the state is *failed* with a reason; asking again retries once; no half-index is ever used (the paper becomes *ready* only when all chunks are stored) | integration |
| P-9 | The same paper under a different URL or version | joined by DOI; without a DOI, by the hash of the file | unit |
| P-10 | The paper is retracted later | answers carry the red banner (checked when asked) | unit |
| P-11 | A non-open-access paper | abstract-only Q&A, labelled; upload offered | unit |
| P-12 | Preprint and published version differ | the DOI decides which; the answer names the record it used | unit |
| P-13 | Save, then remove from My papers | only the person's pointer, notes and history go; the shared paper stays | integration |
| P-14 | Per-day cap of new papers reached | cached papers still work; the message says when new ones can be added | integration |
| P-15 | Questions about a table, figure or equation | answered from the text only; the answer says when the answer is in a figure it cannot read | Q&A eval |
| P-16 | Non-English paper | answered in the question's language; the quote stays in the paper's language | Q&A eval |
| S1-L | **Licence (confirm)**: the shared index keeps text and embeddings for answering; the PDF is shown only for permissive licences; answers quote short passages | recorded in the privacy and terms text when it ships | legal read (yours) |

### Chats, privacy, cost, interface

| # | Case or assumption | What happens | Test |
| --- | --- | --- | --- |
| CH-1 | **Chats are kept only in this browser (confirm)** | no server copy; cleared with the browser's data; a note says so in Settings; Export covers papers, notes and questions on papers, not chats | browser |
| CH-2 | Two tabs open | each has its own current chat; the list of recent chats is shared (storage event) | browser |
| CH-3 | Browser storage full or blocked | the chat works for the session; a notice says it will not be kept | browser |
| PR-1 | The question about an open-access paper reveals interest in a topic | the question goes to the private model lane only; nothing about the person is added to the shared index | unit |
| PR-2 | Privacy text lists every service that receives a query | updated with this release (arXiv and CORE already added); version bumped | unit |
| C-1 | Router + search + answer cost on every message | rules first; the router costs about $0.0001; a measured per-turn cost goes on `/admin` | integration |
| C-2 | A person tries to loop the tools | at most 4 tool calls and a time cap per turn | unit |
| U-1 | Reduced motion | no looping animation, final states at once; the demo has a pause button either way | browser |
| U-2 | Phone | no sideways scroll at 375 to 390 px; the rail is a drawer; the prompt box never hides behind the keyboard (visual viewport) | browser |
| U-3 | Screen reader | one live region per answer, steps announced politely, mode menu with correct roles, the demo is a labelled picture | axe + manual |
| U-4 | Slow network | the intro shows its text first (no blocked fonts), skeletons while data loads | browser |
| U-5 | JavaScript failure | the error boundary shows a way back; the old pages stay reachable by URL until Phase 6 | browser |
| U-6 | Old links (`/verify`, `/idea`, `/papers`, `/library`) | open the workspace with that tool chosen | browser |
| D-1 | Time zone, language and number formats | dates in the person's locale; "today" for limits is UTC, said in Settings | unit |

## 10. Phases (the order after V5 and I4)

| Phase | What ships | Gate to leave |
| --- | --- | --- |
| 1 | **Shell and look**: the new frame (rail, Settings page, My papers cards without "Open and ask"), the **intro** and the **home** in the real app with the real logo; old URLs redirect; **no new behaviour** | all current unit, integration and browser suites pass; axe clean in three themes; phone check; the new screens match the POC |
| 2 | **Prompt box with explicit modes**: streamed search answer with citations, partial-results line, Stop, chats kept in the browser | e2e on staging; the eval gates unchanged |
| 3 | **Router** (rules, then model) with English, Hindi and Hinglish; "I understood this as · Change" | router eval gate in CI (target set after the first measurement) |
| 4 | **Ask any open-access paper**: spike R8 (server extraction), shared index, queue ingest, safe fetch, abstract-only fallback, optional light save | SSRF and edge-case tests (section 9, P-1 to P-16), Q&A eval on shared papers incl. a Hinglish slice |
| 5 | **General answers** with the label; **Idea Check inside the workspace** | groundedness eval; Idea Check suites unchanged |
| 6 | Polish, bundle and first-paint budget, docs, remove the flag | pilot-ready checklist stays yours |

Each phase is shippable alone and updates `docs/roadmap.md`. The `WORKSPACE` flag keeps the old pages until Phase 6 is stable.

## 11. Risks

| Risk | What reduces it |
| --- | --- |
| The router guesses wrong and a person trusts the wrong answer | the "Change" line is always visible; low confidence falls back to Search; router eval gate |
| One prompt box hides what the product can do | pills under the box, the menu, the intro's four tiles, starters |
| Server extraction of PDFs does not fit a Worker | spike R8 first; the browser path stays as the fallback |
| Publisher PDFs fetched in a way a host dislikes | one request per host, polite User-Agent, per-person cap, cache; a shared index means each paper is fetched once |
| Licence of stored open-access text | answers quote short passages; the PDF is shown only for permissive licences; your or a lawyer's read before launch |
| Cost grows because every turn includes a router and a search | rules first; search cache; per-turn cost on `/admin` |
| A general answer sounds like a paper answer | visible label, no citations on it, eval |
| Animation hurts slow phones | no WebGL, transform and opacity only, reduced-motion path, a bundle budget |
| A big rewrite breaks the working product | Phase 1 changes no behaviour; the flag keeps the old pages |

## 12. Still yours to decide (everything else I assumed above and you can overrule)

1. **Chats only in the browser** for the first release (CH-1). Your earlier answer was "not now", so I kept it.
2. **The licence stance** for the shared open-access index (S1-L): text and embeddings shared, PDF shown only when the licence is permissive.
3. The **per-person daily cap of new open-access papers** (I propose 20) and the **size caps** (25 MB, 120 pages).
