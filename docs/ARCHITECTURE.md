# Sodhsetu: architecture (branch `understand-mcp`, 7 Nov 2026: live main `dbae530` plus M1 to M8 of the plan "Sodhsetu understanding, follow-ups and MCP", which are NOT live yet)

Sodhsetu (formerly Scholar AI), https://sodhsetu.in, is a research assistant for scholars: it finds real papers, checks
references, tests an idea against the literature, reads a person's own papers, and writes short answers in which every claim is
tied to a sentence of a paper. This page says how the system is built. What each feature does for a person is in
[FEATURES.md](FEATURES.md).

## 1. The shape in one picture

```
 Browser (React app, served by the same Worker)        AI apps (Claude, ChatGPT, Cursor): /mcp, OAuth 2.1
   |  same-origin fetch / SSE streams, one session cookie
   v
 Cloudflare Worker "scholar" (Hono)  ---- sodhsetu.in (custom domain)
   |-- D1  scholar-db         accounts, library, papers, notes, scans, counts, jobs
   |-- R2  scholar-files      uploaded PDFs, covers, open-access paper files
   |-- KV  CACHE              public search cache, Trending file, kill switches
   |-- KV  OAUTH_KV           the MCP server's OAuth clients, grants, tokens (bound 9 Nov; MCP is off until its switch)
   |-- Workers AI (AI)        the private model lane (text never leaves Cloudflare)
   |-- Durable Objects        S2_THROTTLE (Semantic Scholar pacing), API_GATE (shared lanes: Crossref, CORE, DOAJ, arXiv)
   |-- Workflows              OA_INGEST (read an open-access paper), LITSCAN (run a literature scan)
   |-- Queue producer JOBS    scholar-jobs
   |-- Rate limiters          search 60/min, verify 120/min, ask 20/min, general API 240/min per address
   |-- Cron 03:17 UTC         maintenance, retraction re-check, Trending (switched off)
   v
 Public sources: OpenAlex, Semantic Scholar, Crossref, PubMed, DOAJ, arXiv, CORE, Europe PMC, doi.org
 Optional public-only model: Gemini (never sees private text)
 Errors: Sentry (scrubbed)
```

A second copy, `scholar-staging`, has its own database, bucket, KV, queue and limiters, no cron and no custom route.

## 2. Repository

| Path | What |
|---|---|
| `apps/api` | The Worker: Hono routes, search, chat, documents, jobs. Tests: vitest (`src/**/*.test.ts`), the eval (`eval/`), integration and browser runners (`scripts/integration.mjs`). D1 migrations in `migrations/` (0001 to 0027). Config: `wrangler.jsonc`. |
| `apps/web` | React 19 + Vite + TypeScript. Pages in `src/workspace` and `src/components`, styles in `src/styles` (three themes: Light, Dark, Read), Playwright suites in `e2e/`, the size budget in `scripts/budget.mjs`. |
| `packages/shared` | Types and pure logic used by both sides: chat state and reducer, the router's rules, reference parsing, Trending, the Reading, the state fold, limits. |
| `docs/` | Runbook, roadmap, how we work, design notes (`docs/design`), spikes, eval data and gates (`docs/eval`), ADRs. |

Node 22. `npm run typecheck`, `npm test`, `npm run test:scripts`, `npm run eval`, `npm run build`, `npm run budget -w apps/web`,
`npm run integration -w apps/api` (add `-- --browser` for every browser suite).

## 3. The server (apps/api/src)

`index.ts` mounts the routes, the middleware (request log, the shared lane gate, the cache meter, security headers, rate limits)
and the scheduled handler.

| Route | Module | Purpose |
|---|---|---|
| `/api/v1/auth` | `auth/` | Google and ORCID sign-in (PKCE, state, replay and CSRF checks), `/me`, `/logout`. Session cookie, 30 days, stored hashed. |
| `/api/v1/account` | `account/` | export all my data, privacy acknowledgement, delete account. |
| `/api/v1/library` | `library/` | saved papers, import, retraction alerts. |
| `/api/v1/search`, `/search/stream` | `search/` | the five-source search (JSON and SSE with a snapshot after each source). |
| `/api/v1/chat` | `chat/` | the prompt box: `POST /` (SSE answer), `/route`, `/judge`, `/tighten` (Check strictly). |
| `/api/v1/references` | `references/` | `POST /verify`: check a reference against Crossref and OpenAlex. |
| `/api/v1/documents` | `docs/` | uploaded papers: file, cover, pages, scan (OCR), ask, ask-highlights, notes, ink, progress, metadata. |
| `/api/v1/idea` | `idea/` | Idea Check: plan, search, compare, insights. |
| `/api/v1/papers/oa` | `oa/` | Ask this paper (open access): status, ask. |
| `/api/v1/litscan` | `litscan/` | literature scan: plan, start, list, events, cancel, share, delete. |
| `/api/v1/home/trending` | `trending/` | the Trending file (answers `disabled` while switched off). |
| `/api/v1/feedback` | `feedback/` | Report a problem. |
| `/api/v1/admin` | `admin/` | overview, integrity, erase account, re-apply deletions, monitoring test (admins only). |
| `/api/v1/monitoring` | `monitoring/` | browser error reports to Sentry. |
| `/api/v1/health`, `/health/jobs` | `index.ts`, `jobs.ts` | liveness and migrated database; the scheduled jobs' heartbeats (503 if one failed or is late). |
| `/api/v1/chat/config` | `chat/` | tells the page whether to send the turn ledger (only while `CHAT_UNDERSTAND` reads it). |
| `/api/v1/connected-apps` | `mcp/apps.ts` | Settings, Connected apps: the AI apps a person allowed, and disconnect. |
| `/mcp`, `/oauth/*`, `/.well-known/oauth-*` | `mcp/` | the MCP server and its OAuth 2.1 endpoints (section 3.6). With `MCP` off these paths answer 404 as before. |
| `/api/v1/dev/*` | `index.ts` | development only (`ENABLE_DEV_ROUTES=1`): stand-ins for tests. Never on in production. |

Other server folders: `llm/` (the model gateway), `cache/` (KV cache and its meter), `gate/` (shared lanes), `ocr/`,
`understand/` (the understanding releases, see 6), `trending/`, `jobs.ts` and `maintenance.ts` (cron work), `ratelimit.ts`,
`idempotency.ts` (a retried upload or report is not stored twice), `sse.ts`, `outcomes.ts` (counts of how answers ended), `mcp/`
(the MCP server, 3.6).

**Service layer (M6).** The work behind the routes is in plain functions that the web routes, the chat and the MCP tools all
call, never one another over HTTP: `search/service.ts` (`searchService.run`), `references/service.ts` (`referenceService.verify`),
`search/retraction-service.ts` (`retractionService.check`), `oa/service.ts` (`oaService.ask`), `library/service.ts`, and the strict
claim reading in `chat/claim-check.ts`. A request is checked against the same rules whichever door it came in by. With
`CHAT_TOOLS` on, the chat route calls the same functions to run a tool in the reply (`chat/tools.ts`: which tool, by rules and by
what the router or the Understand step decided; the results go out as `tool`, `tool_ref`, `tool_retractions` and `tool_ask` events).

### 3.1 Search (`search/`)

`runSearch` asks **OpenAlex, Semantic Scholar, Crossref, PubMed and DOAJ** in parallel (with **Indian sources** on: OpenAlex
filtered to Indian institutions and Shodhganga theses, and DOAJ journals published in India). Each provider's answer is cached
in KV, cleaned to plain text at the adapter boundary (HTML codes, tabs and line breaks removed), merged by DOI and normalised
title with reciprocal-rank fusion, every DOI is checked at doi.org, and the list is checked against Crossref's retraction data
(Retraction Watch). Semantic Scholar is paced by a Durable Object; Crossref, CORE, DOAJ and arXiv go through shared lanes
(`API_GATE`) so that many visitors do not exceed a source's polite rate.

### 3.2 The model gateway (`llm/`)

One gateway, a routing table **task x sensitivity -> ordered fallback chain** (`llm/config.ts`).

- **Private** chains contain only Workers AI models: a person's question, paper text, ideas and highlights go only there
  (`@cf/openai/gpt-oss-120b` for writing and routing; `@cf/meta/llama-3.3-70b-instruct-fp8-fast` and Mistral Small for the claim
  judge; `@cf/baai/bge-m3` for embeddings; vision models for OCR).
- **Public** chains may use Gemini 3.5 Flash-Lite, for public text only.
- Every call is logged as counts only (tokens, model, call name, time, success) in D1, priced from `llm/pricing.ts`, and held to
  a daily allowance per person (60,000 tokens). Malformed JSON is retried once; refusals and timeouts fall back down the chain.

### 3.3 The chat route (`chat/routes.ts`)

One SSE stream per message: `understood` (which tool, the search words), `step` events, `papers` (interim and final), `notice`
lines, `answer` tokens, the support judge's result, `done` with a reason. In order:

1. Clean and size-check the message (300 characters for a search, 20,000 for a pasted list); read `history` (follow-up context,
   signed-in only), `sinceYear` (a Trending chip) and, only while the Understand step reads it, `ledger` (the turn record of this
   chat, untrusted). `earlier` (other chats) is ignored since M1.
2. Small talk is answered by the page itself (sent nowhere).
3. **Route**: the rules in `packages/shared/src/route.ts` first (a reference list goes to Check references, a DOI or arXiv number
   is searched as written, a plain one-line English question is a search); otherwise the private model router (signed-in
   only), with follow-up context when the message cannot stand alone. Another tool is only offered, never started.
4. **Search** (above), with a year range if one was asked.
5. **Write** (signed-in): the private model writes a short answer from the abstracts (first 3,000 characters each); every
   sentence must cite a paper; `support.ts` judges each claim against the cited sentences; unsupported claims are dropped or
   rewritten. If the papers do not answer, a labelled "general background" may be written, which never cites a paper.
6. Count how it ended (`answer_outcomes`, counts only).

**With `CHAT_UNDERSTAND` on** (M5, [design/understand-wiring.md](design/understand-wiring.md)) steps 2 and 3 are the Understand step: fixed guards (greeting, DOI,
reference list, hand-picked mode), then one private model call (`understand/understand.ts`, task `understand`: Qwen3 30B, then
gpt-oss-120b) that returns one JSON reading (intent, language, status line, standalone question, 1 to 3 English queries, years,
Indian sources, the earlier turn and papers it refers to, a tool, a question back, confidence), checked by code. It acts per intent:
a short checked conversation reply; a search or refined search; an answer from papers already in the chat, looked up again by DOI
(`chat/understand-wire.ts`); an offer card; or a question back. When the model cannot be used the rules decide. In shadow it only
runs beside the rules on `waitUntil` and counts. `GET /api/v1/chat/config` tells the page whether to send the ledger. With
`CHAT_THINK` on, a `think` event carries each stage's status line from real counts (M2).

The server keeps **no chat**: chats live in the browser (IndexedDB), and the judge never receives history.

### 3.4 Uploaded papers (`docs/`), open-access papers (`oa/`), scans (`ocr/`)

- **Uploads**: pdf.js reads the PDF in the browser; the file and a cover go to R2; the page text is cut into passages
  (about 1,000 characters, sentence-aware) and embedded; questions retrieve passages and every quote in an answer is checked
  against the paper's own text. Up to 30 papers of 25 MB per person.
- **Scans**: pages are drawn in the browser and read by two vision models; only pages they agree on are used (60 pages a day).
- **Open access** (`OA_INGEST` Workflow): the paper is fetched once for everyone (Europe PMC XML, arXiv, or the free PDF OpenAlex
  lists, through a hardened fetch), cut into passages and kept in a shared index (`oa_papers`, `oa_chunks`); 20 new papers a day
  per person, 300 for everyone.

### 3.5 Background work

| Job | When | What |
|---|---|---|
| `maintenance` | daily 03:17 UTC | deletes expired cache, sessions, OAuth states, old usage and count rows (90 days), within a time budget |
| `retraction_check` | daily, each DOI at most weekly | re-checks saved papers' DOIs at Crossref; makes a notice for each person who saved a retracted one |
| `trending` | daily, scan weekly | builds the Trending list from OpenAlex keywords, checked on arXiv and verified with the product's own search. **Off** (`TRENDING=off`) |
| `LITSCAN` Workflow | on demand | runs a literature scan's sub-questions on the server; kept 24 hours |
| `OA_INGEST` Workflow | on demand | reads an open-access paper into the shared index |

The scheduled handler awaits its three jobs; each writes a heartbeat (`job_runs`) read by `/api/v1/health/jobs`, the admin page
and the hourly Watchdog workflow (which opens a GitHub issue on failure).

### 3.6 The MCP server (`mcp/`, M7 and M8)

`https://sodhsetu.in/mcp`: a remote MCP server (Streamable HTTP) in the same Worker, built on `@modelcontextprotocol/server` 2.3.1
(its stateless `createMcpHandler`, a fresh server per request, no Durable Object) and `@cloudflare/workers-oauth-provider` 1.2.4
(loaded only on the MCP paths). Sodhsetu is the OAuth 2.1 authorization server (PKCE, dynamic client registration); a person signs
in with the website's own Google or ORCID sign-in and allows the app on a consent page. Scopes: `papers:read`, `references:verify`
(the default), `library:read`, `library:write` (only when an app asks). Tokens last an hour; a grant ends after 30 days unused.

| Tool | Scope | What |
|---|---|---|
| `search_papers` | papers:read | the five-source search, 1 to 20 papers, DOIs checked, retractions marked |
| `verify_references` | references:verify | up to 60 references: verified / mismatch / not_found / not_checkable with differences |
| `check_retractions` | papers:read | which DOIs are retracted, with the notice |
| `ask_paper` | papers:read | Ask this paper by DOI or arXiv id: answer, checked quote, section or page; abstract only when not open access, said so |
| `get_library`, `save_paper` | library:read / library:write | the person's library; a save only with the person's yes |
| `check_claim` | papers:read | a claim against the abstracts of up to five DOIs: supported / partly / not_supported / cannot_check, with the evidence sentence. Behind its own switch `MCP_CHECK_CLAIM` |

Every tool has a strict input schema, returns structured JSON plus a short text summary (under about 8,000 tokens, `next_cursor` for
more) and says in its description that abstracts are third-party data. Limits: 300 tool calls per account a day plus the website's
per-minute limiters; `ask_paper` and `check_claim` count against the daily AI allowance. Counts only in `mcp_calls` (tool, app,
time, outcome). Switch `MCP`: off (unset) / beta (the ids in `MCP_BETA_USERS`) / on.

## 4. The web app (apps/web)

- One React app served by the Worker. Pages: `/` and `/home` (Home with the prompt box and the conversation), `/papers`
  (My Workspace and the reader), `/library`, `/verify` (Check references), `/idea` (Idea Check), `/literature-scan`,
  `/settings`, `/how-we-verify`, `/privacy`, `/terms`, `/admin`. A first-visit intro film, a command palette (Ctrl+K), a left
  rail.
- Heavy parts are lazy chunks: the conversation view (`ChatView`), the PDF reader, Idea Check, literature scan, admin, the legal
  pages, Rive animations. **Size budget** (CI fails above it): first-load script 250 KB gzip (now about 244), first-load style
  sheet 26 KB gzip (about 24), fonts 185 KB, PDF reader 66 KB.
- **Citation cards in the reader** (docs/design/reader-citations.md):
  - **Parser:** `packages/shared/src/citations.ts` finds and links in-text citations (pure; tested on fixtures and, with `CITE_PDFS`, on real PDFs).
  - **Labels:** `labelledReferenceEntries` in `paperinfo.ts` keeps each entry's printed label.
  - **Chunks:** the map, the boxes and the card (`lib/citations.ts`, `CitationCard.tsx`) are their own chunks, about 8.5 KB gzip, fetched by the reader in idle time after its first pages.
  - **Verdicts:** read from the same `useVerify` run as the References tab (lifted to `DocWorkspace`), so no entry is checked twice.
- State: chats in IndexedDB (`scholar`/`chats`) with an index in localStorage, owned by the signed-in account; settings and theme
  in localStorage; offline papers (if switched on) in the browser's storage. Settings has **Connected apps** (the MCP apps a person
  allowed), shown only while `MCP` lets the account in.
- The browser calls only its own API (the CSP forbids other origins), streams answers by SSE, and reports errors through the API.
- Accessibility: axe in every browser suite, contrast checked for the three themes, one polite status line for screen readers,
  keyboard paths tested.

## 5. Data (D1, migrations 0001 to 0025; 0026 and 0027 on this branch)

Accounts and sessions (hashed), OAuth states, privacy acknowledgements; the library and its retraction alerts
(`paper_retraction` holds no person); documents, their passages, notes, ink, reading progress and scans; open-access papers and
passages (shared, no person); literature scans (24 hours) and share tokens; feedback (one year); model usage (counts, 90 days);
cache statistics; idempotency keys (one day); `job_runs`; `answer_outcomes` (counts of how answers ended, 90 days; feature
`chat_understand` holds the Understand step's counts); `understand_visitors` (0027: a visitor's Understand calls of a day under a
one-way code of the day and the address, two days); `mcp_calls` and `mcp_daily` (0026: counts of MCP tool calls, 35 days, and
the daily quota). The MCP server's OAuth clients, grants and tokens are in KV `OAUTH_KV`, not D1; erasing an account revokes them. Chats are not in D1 (the browser keeps them, with each chat's turn ledger). Backups and erasure: `docs/runbook.md`.

## 6. The understanding work (`apps/api/src/understand`, plan `docs/design/intent-and-state.md`)

Built in releases, each behind its own switch read by `platform/switches.ts` (unset is off; a KV override can only lower a
switch). **Every switch below is unset (off) in production**; with a switch off the stream is byte-identical to before (golden
tests). Turning one on needs its privacy sentence read first.

| Release | Switch | What it does when on |
|---|---|---|
| R2 (live, no switch needed) | `SEARCH_PLAINTEXT` (rollback) | plain text at the provider boundary |
| R3 | `CHAT_COUNTERS` | counts the shape of a first message by closed names, never its text |
| R5 | `CHAT_FAILPOLICY` | a follow-up whose router call failed gets the papers and a plain line, no written answer |
| R4 | `CHAT_SAFETY` (off/shadow/core/on) | a fixed reply, no search and no model, for an emergency, a call for help or self-harm intent; recall gate not yet met |
| R8 | `CHAT_CLEAN` | takes the request frame off a message ("Can you search about ... all papers") and shows "Left out" |
| R9 | `CHAT_FLOOR` (off/shadow/writer/on) | strong/medium/weak papers; no answer written over a list with no strong paper; "No paper matches ... closely" |
| R19 | none | the state of a chat as a pure function (not sent yet) |
| R22 | none (live) | the **New topic** control: the next message carries no earlier turn |
| M1 | none | earlier chats removed: nothing of one chat goes with a message in another |
| M2 | `CHAT_THINK` | the Thinking block: `think` events from real counts; the turn ledger kept in the browser |
| M4/M5 | `CHAT_UNDERSTAND` (off/shadow/on) | the Understand step decides what a message is (above); needs its privacy sentence from shadow on |
| M5 | `CHAT_UNDERSTAND_VISITORS` | the step for visitors too, 40 a day per address |
| M6 | none | the service layer (no change a person sees) |
| M7/M8 | `MCP` (off/beta/on), `MCP_BETA_USERS` | the MCP server for AI apps; also needs the `OAUTH_KV` namespace |
| M8 | `MCP_CHECK_CLAIM` (off/beta/on) | the `check_claim` tool |
| Chat tools (9 Nov) | `CHAT_TOOLS` (off/on) | the cheap tools run in the reply instead of a card: a pasted list checked at Crossref and OpenAlex, DOIs that ask about retraction, a question about one result (Ask this paper) or one of your own papers; Idea Check and the literature scan stay a card (`chat/tools.ts`, `docs/design/chat-tools.md`) |

## 7. Privacy and safety by construction

- A person's text goes only to the private Workers AI lane and, for a search, the search words to the public indexes; the page
  `/privacy` says exactly what goes where, and `legal-text.test.ts` and `legal-match.test.ts` pin each sentence against the
  code (a switch that changes what is sent cannot be on without its sentence). Version on this branch `2026-11-draft-15` (M1, waits for the owner's read; live main has `2026-11-draft-14`).
- Nothing about a person reaches a log: logs and counts carry names and numbers only (tests send hostile canary strings).
- Abstracts, history and pasted text are untrusted data; orders inside them are never followed.

## 8. Build, test, deploy

- **CI** (`.github/workflows/ci.yml`) on every push and pull request: audit, typecheck, unit tests, script tests, the citation
  eval (recorded responses: 0 fabricated references verified, retractions detected), build, size budget, API integration (a
  real local Worker and D1 with a fake identity provider). On `main` only: D1 migrations, deploy, production health check.
- **Weekly and hourly**: browser suites and the live eval, the Trending contract check, the Watchdog, CodeQL.
- **Rollback**: a switch to off (most features), or `git revert` and push (about 15 minutes). Details: `docs/runbook.md`.
