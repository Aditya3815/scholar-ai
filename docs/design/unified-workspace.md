# Plan: one workspace with a prompt box (redesign)

Date: 2026-10-24. Status: **proposal, waiting for approval of the POC**. Nothing in the real app has been changed.
POC to look at: [`docs/design/poc/unified-workspace.html`](poc/unified-workspace.html), one file, open it in a browser (double-click). All data in it is sample data
(DOIs `10.0000/sample.*`); the checks that ran on it are in `apps/web/e2e/poc.mjs` (walkthrough, axe in light, dark and read, phone width, reduced motion).

## 1. What changes, in one paragraph

Today the product is a set of pages (Search, Verify, Idea Check, My papers, Library). The proposal is **one screen with a prompt box**, like Claude or ChatGPT: you write or paste something,
the product works out what you want, shows a short "I understood this as: Search papers · Change", streams an answer in plain words and lists the real papers under it.
Search, Verify references, Idea Check and Ask a paper become **tools in a dropdown** (and tiles on the empty screen); Auto is the default. **My papers, Library and the paper
preview stay separate sections**, and **Settings becomes its own page**. Idea Check keeps its own structured workspace inside the same screen, because it is a process
(approve a plan, see closest papers, a coverage map, gaps, a report), not a chat.

What does **not** change: every paper listed is a real record that was looked up; every quote is checked against the text; no model-written citations; your idea, files and pasted references are
never sent to public services (only a plan you approved, or a cleaned query, goes out); no pilot items are touched.

## 2. Information architecture

| Place | What it is | Notes |
| --- | --- | --- |
| **Workspace** (home) | prompt box, mode dropdown, streamed answer, paper cards, Idea Check workspace | the only place where work is started |
| **My papers** | uploaded and saved papers, reader, notes, references, Q&A | exists today, restyled, no behaviour change |
| **Library** | saved search results | exists today |
| **Paper preview** | sheet over any list | exists today |
| **Settings** | account, reading options, theme, privacy, data export and deletion | moves out of the dialog to a page |
| Left rail | New chat, My papers, Library, Recent, Settings, theme switch | a drawer on a phone |

Old URLs (`/verify`, `/idea`, `/papers`) keep working and redirect into the workspace with the mode preset, so no bookmark and no email link breaks.

## 3. Interaction model

- **Prompt box**: multi-line, Enter sends, Shift+Enter new line, a paperclip for a file (PDF/Word/LaTeX/text; the file is read in the browser as it is today), rotating example placeholders (not shown to screen readers as content), a mode button.
- **Mode dropdown**: Auto, Search papers, Check references, Idea Check, Ask a paper. It is a menu of radio items (arrow keys, Escape returns focus). A chosen mode is a hard override; Auto lets the router decide.
- **"I understood this as X · Change"**: always shown above an answer. This is the safety net for a wrong guess: one click re-runs under another mode, no retyping.
- **Progress**: a short step list in plain words ("Searching the literature", "Checking that each paper is a real record", "Looking for retractions"), a small status pill (the Dynamic-Island idea). **No source is named while searching**, as you asked.
- **Answer**: streamed word by word, citations are buttons that scroll to and highlight the paper they point at, paper cards below (DOI checked, open-access badge, retraction banner, Save to My papers, Ask this paper).
- **Idea Check**: its own six-step rail (Your idea, Closest papers, Coverage map, Gaps, Read the papers, Report). The plan approval step stays: **you approve the four parts before any search runs**.
- **Ask any paper**: see section 5.

### Honesty while not naming sources

Hiding the names is fine; hiding that something failed is not. Proposal: during the search show nothing about sources; in the answer, if one or more sources did not answer, show one plain line,
"Some of the places we search did not answer, so this list may be incomplete. Search again" (no names). The Idea Check report keeps "what was searched" as **the queries**, and lists the sources there
(a report is a record, and a supervisor will ask). *This is the one assumption I need you to confirm.*

## 4. The agent: understanding intent and using tools

### What I took from [building-claude-from-scratch](https://github.com/FareedKhan-dev/building-claude-from-scratch)

It is a Jupyter notebook (62 components in 8 phases), a teaching walk-through, not a library; nothing is installed from it. The ideas worth taking, and where they land:

| Idea in the notebook | Our use |
| --- | --- |
| Classify the problem type first | the **router** (below) |
| Orchestrator and workers, each worker returns a short, disciplined result | the orchestrator runs **fixed tools**; a tool returns a small structured result, never a transcript |
| Plan and execute with a task graph | only for Idea Check (it already is one: plan, search, compare, gaps). No open-ended planner |
| Compact tool results before the next step | search results reach the model as numbered short records (title, year, sentence-numbered abstract), not full JSON |
| Cache-friendly prompt order (stable part first) | system prompt and tool list first, user content last, so the provider's prompt cache applies (measured in R5) |
| Definition of done per task | each tool has a check before it may answer: search needs at least one verified record or says so; Q&A needs a checked quote or says it did not find one |
| Memory tiers | only two: this chat (browser) and saved papers (My papers). No long-term "memory" of the person |

What I leave out: a free-running agent loop that decides its own steps. It is costly, hard to test, and the failure ("it searched for something else and answered confidently") is exactly what this
product must not do.

### The router

1. **Rules first, free and instant**: a pasted list that the existing splitter reads as 3 or more references means *Check references*; an attached file means *Idea Check* (or *Ask a paper* if a paper is open); a bare DOI or a paper link means *Ask a paper*; a question about "this paper" with a paper open means *Ask a paper*.
2. **Then a small model call** returning JSON against a schema: `{ mode, confidence, query }`, where `query` is the cleaned search query. Temperature 0; text that does not fit the schema is treated as *Search*.
3. **Below a confidence limit, do not guess silently**: run the cheap safe default (Search) and show "I understood this as Search papers · Change".
4. Idea Check is only ever chosen **by the person** (tile or dropdown) or after the router asks "This looks like an idea to check. Check it?", because it reads the whole text and costs more.

Privacy: free text goes to the **private** model lane only (Workers AI). Only the model-cleaned `query` is allowed to go to public search APIs, and it goes through the scrubbing the Idea Check plan already uses.
Cost: a router call is a few hundred tokens, about $0.0001 (R5 price table). The router gets an **eval set** (about 100 labelled prompts in English and Hinglish) with a gate in CI like the others; I will not ship a router I could not measure.

### Tools (fixed list, each is existing code)

| Tool | Exists | Behind |
| --- | --- | --- |
| `search_papers(query)` | yes | `/api/v1/search/stream` and its cache (V6) |
| `verify_references(text)` | yes | `/api/v1/references/verify` |
| `idea_check(...)` | yes | `/api/v1/idea/*` |
| `ask_paper(id, question)` | yes | `/api/v1/documents/:id/ask` |
| `save_paper(doi)` | new | section 5 |
| `answer_general(question)` | new | section 6 |

"Sub-agents" in practice: the orchestrator calls a tool, and where work is independent it calls tools in parallel (references already go three at a time). A tool may use a model inside, but a
tool never calls the router or another tool by itself. Limits per turn: at most 4 tool calls, a time cap, and an "abort" that the reader's Stop button reaches (the stream already supports abort).

### One streaming endpoint

`POST /api/v1/chat` (Server-Sent Events, same-origin, signed-in, rate-limited) with events: `understood`, `step`, `token`, `papers`, `cite`, `notice` (partial results), `done`, `error`.
Search and Q&A streaming already exist and are reused. Idea Check stays on its own routes, because it has the approval step in the middle.

### Safety rules for an agent that reads untrusted text

- Abstracts, PDFs and web text are **data**. They can never add tools, change the mode, or ask for a request to be made.
- Nothing is written without a click: *Save to My papers* is a button, never something the model does.
- The model never outputs a DOI, title or reference that goes on screen as a fact. Papers shown come from lookups; the model refers to them by number (as Idea Check does with sentence numbers).
- A fetched PDF is never executed, only parsed as a PDF.

## 5. Ask any paper (S1): "save to My papers first"

Question: can every paper in the results be asked about? Answer: **yes for open-access papers, abstract-only otherwise**, and the person is told which.

Flow when someone presses *Ask this paper* on a search result:

1. **Already in My papers** (same DOI): open the panel, done.
2. **Open access with a PDF link** (OpenAlex/Unpaywall style `oa_url`, which search results already carry): a dialog says the paper is open access and will be **saved to My papers first**, then the question can be asked. One click.
3. The **server fetches the PDF** (never the browser, no CORS, no tracking of the person by the publisher): HTTPS only; host must resolve to a public address (blocks private and link-local ranges, checked again after each redirect, at most 3); a hard timeout; a size cap (the same as uploads); `Content-Type` must be a PDF **and** the first bytes must be `%PDF-`; stored in R2 as a document with `source = doi:…`. A paywalled or HTML landing page is not a PDF and is reported as "this publisher did not give a PDF".
4. **Indexing** reuses what exists (the browser reads the saved file and sends the pages, as for any upload); a scanned PDF goes through the OCR path with its daily page allowance. The panel shows "Reading the paper… 40%", and the question box is usable once it is ready.
5. **Not open access / no PDF**: the panel offers (a) questions about the **abstract only**, labelled "Based on the abstract only", answered with the same quote checking, and (b) "Upload the PDF you have access to", which attaches it to the same record.

Why save first and not answer from a temporary copy: the answer needs the pages to be indexed once, notes and highlights need a home, and a second question must not re-download. Cost of the extra step: one click; it makes the saved paper count toward the person's storage, so the dialog says so and lets them remove it from My papers at any time.

Copyright note: only open-access copies the publisher itself offers are fetched; the person is told the licence shown in the record. Pilot-owned legal text is not touched.

## 6. Answers that are not about one paper

A question like "what is federated learning?" or "how do I choose a sample size?" is not about a paper. Rule: **papers first, then general knowledge, never mixed up**.

1. Search quietly for papers on the question (same cache).
2. If the top records support an answer, answer from those, with numbered citations to the records (sentence numbers, checked).
3. If not, answer from general knowledge under a visible label: "General background, not from a paper in your results", with no citations, and offer "Search papers on this".
4. Never present a general statement as if a paper said it. This is checked by the same grounding gate used for Q&A, extended with the label.

This needs a small eval (groundedness of the paper-based part, and a test that general answers carry the label) before it ships.

## 7. UI system and where each library idea is used

Base: the existing tokens and rules in [UI-direction.md](UI-direction.md): Source Serif 4 and Inter, three themes (Light, Dark, Read), `lib/motion.ts` springs, `MotionConfig reducedMotion="user"`, AA contrast checked by `npm run contrast`, axe clean in every theme, nothing scrolls sideways at 375 px.

| Source | Used for | Decision |
| --- | --- | --- |
| Framer X Claude guide + Motion Sites | big serif headline with one emphasised word, staggered entrance, quiet ambient background | already used; kept, the empty state is the only place |
| UI UX Pro Max (offline) | checklist: icons are SVG, visible focus, reduced motion, 375/768/1024/1440 test, skeletons with `aria-busy` | used as the test list |
| Motion (`motion/react`) | springs for menu, pill, slide-over, card reorder; `layout` for streamed lists | used |
| [Aceternity UI](https://ui.aceternity.com) (free components; React + Tailwind + Motion) | **Placeholders & Vanish Input** (prompt box), **Multi Step Loader** (progress steps), **Bento Grid** (tool tiles), **Sidebar** (rail), Tabs | take the *patterns*, re-written in our CSS: our web app has no Tailwind, and adding it for five components would restyle everything. The POC does this already |
| Aceternity **Text Generate Effect** | none | rejected: our text really streams from the model; a fake reveal would lie about speed and breaks down when the stream stalls |
| Aceternity **Link Preview** | none | rejected: it fetches third-party pages for previews, which tells publishers what a person looks at |
| [Skiper UI](https://skiper-ui.com) (shadcn registry; Tailwind + Next; some premium at $129) | Dynamic-Island style status pill, tooltips | idea only. I did not copy code; if you want the real component, the licence and the Tailwind dependency need a decision from you |
| Animmaster Lib (WebGL + GSAP, paid) | none | **not used**: heavy for low-bandwidth Indian networks, decorative on a page people read, and I could only find a promotional page for it, not its licence or docs. If you have a link to its documentation I will re-check |

In short: the feel of Aceternity and Skiper, built on our own tokens, no new design dependency, no WebGL.

## 8. Streaming improvements (part of the build)

- First tokens and first paper cards appear as soon as they exist; a slower source reorders cards with a `layout` animation instead of a jump.
- **Stop** button during any stream (aborts the request; the server stops the model call, so the person is not billed for a thrown-away answer).
- A stalled stream (no event for 15 s) shows "Still working…" and a retry, never a blank wait.
- A dropped connection keeps what has arrived and offers "Continue"; for answers that means asking again (the same question hits the KV cache for searches).
- Reduced motion: text appears in chunks, every final state identical.
- Screen readers: one polite live region says "Answer ready, 4 papers", the text is not announced word by word.

## 9. Where chats are kept

Chat threads in the rail ("Recent") need storage. Options: **(a) only in this browser** (nothing on our servers; lost if the browser data is cleared; consistent with "reference text is never stored"), or (b) in our database
(works across devices; the person's questions and ideas would be stored). Recommendation: **(a) for the first release**, with a clear note, and ask the pilot whether (b) matters. Saved *papers*, notes and Q&A on papers stay on the server as today.

## 10. Phases

| Phase | What ships | Gate to leave |
| --- | --- | --- |
| 0 | **You review the POC** and answer the questions in section 12 | your approval |
| 1 | Shell: rail, workspace route, Settings page, old URLs redirect; My papers/Library/Preview restyled into the new frame; **no new behaviour** | all current unit, integration and browser suites pass; axe clean in 3 themes; phone check |
| 2 | Prompt box with modes (explicit modes only, no router yet), streamed search answer with citations, partial-results line | e2e on staging; the existing eval gate unchanged |
| 3 | Router (rules, then model) with its eval set; "I understood this as · Change" | router accuracy gate in CI (target set after the first measurement, not before) |
| 4 | Ask any paper: save-first, OA fetch, abstract-only fallback | SSRF tests (private IP, redirect to private IP, oversized, not-a-PDF, slow server), Q&A eval on saved OA papers |
| 5 | General answers with the label; Idea Check embedded in the workspace | groundedness eval; Idea Check suites unchanged |
| 6 | Polish, performance (bundle size budget, first paint), docs, roadmap | pilot-ready checklist stays the user's |

Each phase is shippable on its own and can be rolled back by a switch (`workspace` flag) so the old pages stay as the fallback until Phase 5 is stable. Every phase updates `docs/roadmap.md`.

## 11. Risks

| Risk | What reduces it |
| --- | --- |
| Router guesses wrong, and a person trusts the wrong answer | the "Change" line is always visible; low confidence falls back to Search; router eval gate |
| One prompt box hides what the product can do | tiles on the empty screen, the mode menu, rotating examples |
| Publisher PDF fetch abused to reach internal addresses or huge files | the checks in section 5, tested, plus a per-person daily cap of saved-from-link papers |
| Cost grows because every turn now includes a router and a search | rules first; search cache; measured per turn in the admin cost view (R5) |
| General answers sound like paper answers | visible label, no citations on them, eval |
| Animation hurts slow phones | no WebGL, springs on transform/opacity only, reduced-motion path, bundle budget |
| Big rewrite breaks the working product | Phase 1 changes no behaviour; flag keeps old pages |
| Hiding sources reads as hiding failures | the plain partial-results line; the report keeps the record |

## 12. Questions for you (answers decide Phase 1 and 2)

1. Is the POC the right look and flow? What would you change before real work starts?
2. Not naming sources during search, but a plain "some places did not answer" line and sources listed in the Idea Check report: OK?
3. Chats kept only in the browser for the first release: OK?
4. Ask any paper: fetch open-access PDFs server-side and save them to My papers first, abstract-only otherwise: OK? (It changes storage use per person.)
5. Skiper UI premium or Animmaster: do you want either bought? My recommendation is no for both.
6. Hinglish prompts: should the router and answers handle them from the first release? (The eval set would include them.)
