# Untangle: the plan and its decision log

Written 12 Nov 2026 (step 3 of the codebase untangle, which follows the untangle skill, UNTANGLE_CODE_SKILL.md). The owner accepted all 19 recommendations of section 6 on 12 Nov 2026; each fix follows the recommended answer.

This file is the decision log of the untangle: every wave updates it (what landed, what was kept against the plan and why, what is pending) under "Progress" at the end.

Starting point: main at 1c3b3db. Inputs: the eight step-2 audits, depgraph.txt, copies.txt, shared-work/imports.txt (kept with the audit scripts outside the repo), and the code where a design question had to be settled.
The owner chose both additions: **Comments** and **Tests** (section 4).

## Conventions in this file

Path prefixes (every path below is one of these):
- `api/` = `apps/api/src/`, `web/` = `apps/web/src/`, `shared/` = `packages/shared/src/`
- `scripts/` = `apps/api/scripts/`, `e2e/` = `apps/web/e2e/`, `eval/` = `apps/api/eval/`, `web-scripts/` = `apps/web/scripts/`, `public/` = `apps/web/public/`
- anything else is relative to the repo root (`apps/api/wrangler.jsonc`, `.github/...`).

Audit tags after each problem: **[chat]** api-chat-understand.md, **[svc]** api-services.md, **[feat]** api-features.md, **[sh]** shared.md, **[wc]** web-components.md, **[wl]** web-lib.md, **[ti]** test-infra.md, **[cc]** crosscut.md.

Rules every fix keeps:
- The switch pattern stays: unset is off, KV only lowers, and the off position is byte-identical (`api/chat/*.golden.json`).
- `api/legal-match.test.ts` keeps holding: (3) no module of `understand/` reaches a network client, (4) every privacy sentence is pinned to its switch.
- Anything that changes what a person sees, or what is sent to another service, is in section 6, not done silently. A fix that keeps today's words and today's requests is a fix; choosing new words is the owner's.

---

## 1. Target structure

### 1.1 Three packages, one direction

```
packages/shared   (most stable: the wire protocol and the words both apps must agree on)
      ^                     ^
apps/api                 apps/web
 platform/  <- features/ <- app/        lib/ <- components/ <- App
```

Nothing in `packages/shared` imports an app. Neither app imports the other (today 11 api tests and several scripts reach into `apps/web/src`; they move to web's own runner).

### 1.2 packages/shared: only the stable protocol and the domain vocabulary

```
packages/shared/
  package.json            ("sideEffects": false stays true by construction: a test checks no module has top-level statements)
  vitest.config.ts        (NEW: shared's own tests, moved from apps/api)
  src/
    index.ts              pure barrel: `export *` lines only, no definitions, nothing imports it from inside shared
    paper.ts              Paper, SearchScope, SearchResponse, ProviderKey (typed), PROVIDER_LABELS, REGULAR/OPTIONAL_SOURCES (moved out of index.ts)
    ids.ts                DOI (in text / whole), normalizeDoi, doiPath, ARXIV_NEW/OLD, arxivDoi, arxivIdFromDoi, PMID, ORCID,
                          citation marker [n] (named widths), SHARE_TOKEN, DOC_ID, EMAIL, LINK, ISO_DAY
    text.ts               CONTROLS, INVISIBLE (one list), oneLine/squash, cutWhole, sizeOf, stripMarks, isInt/isCount, isYear(range),
                          webUrl/safeLink, plainText (the one entity decoder), foldTitle/tokenize (Unicode), named stop-word lists,
                          numbersIn, negations, scriptOf, scrubText, citesSomething, findRun/words (exist today)
    vocab/
      languages.ts        Lang, AnswerLanguage, LITSCAN languages derived, LANGUAGE_NAMES, threeWay(lang) (Hindi falls back to Hinglish)
      intents.ts          UNDERSTAND/LEDGER intents (one list)
      lane.ts             LANE_REASONS {urgent, safety, decision}, NO_TRACE_REASONS {urgent, safety}
      reply-kinds.ts      per reply `reason`: why-line, actions row, counts as "no papers", shows "understood", announce words, counted
      steps.ts            ChatStep and STEP_ORDER
      notices.ts          SERVER_NOTICE_KINDS and PAGE_NOTICE_KINDS (the page-made `unfinished` kept apart)
      references.ts       RefStatus with label, tone, help (one table for refStatus, citeStatus, ChatTool, feedback)
      documents.ts        read states with labels
      sources.ts          source keys with display names (index PROVIDER_LABELS, idea-m3 SOURCE_NAME, IdeaResults, idea/search LABEL)
      idea.ts             idea kinds and facet labels
      outcomes.ts         every counted feature and its closed outcome names, with /admin labels; outcomes.ts, outcome-counts, AdminOps read it
      switches.ts?        (NOT here: switches are server-only; see platform/switches)
    protocol/
      problem.ts          Problem {type: ProblemType, title, detail?, ...extra}, ProblemType union, IDEMPOTENCY_HEADER
      streams.ts          per stream: event union, kind of every event, terminal set derived from kind "end", fallback error, progress fields
                          typed as keys of the event (replaces stream-shape.ts's hand copies; checker kept for tests)
      chat.ts             ChatEvent, request body types (history, ledger typed as LedgerTurn[], not unknown[])
      chat-context.ts     history request shape and the limits BOTH sides enforce (unenforced ones deleted)
      ledger.ts           LedgerPaper, LedgerTurn, the caps (one set)
      route-words.ts      RouteMode, ROUTE_NAMES, RouteHow, detectLanguage, cleanAutoMessage (split out of route.ts)
      documents.ts, oa.ts, idea.ts, litscan.ts, references.ts, feedback.ts, jobs.ts, ocr.ts, reading.ts, think.ts,
      trending-client.ts, legal.ts (PRIVACY_VERSION: the api checks the ack version), limits.ts (ABSTRACT_READ_CHARS and
      other limits the browser and server must share)
    both-apps logic       notes-md.ts, paperinfo.ts, sentences.ts, citations parsing used by both (only if both import it)
```

Leaves `shared` (moves with its tests): 21 web-only modules to `apps/web/src/lib/...` (ask-source, chat-copy, copy-through (deleted), chat-memory, chat-state, citations, docx, idea-m3, ideafile, ledger's browser half, litscan-docx, litscan-review, monitoring, outcome-counts, palette, quote-quads, rive, scan-info, script, trending-row, zoom); server-only code to `apps/api` (trending.ts ranking, subfield-policy.ts, the router's rules from route.ts, operational limits such as `MAX_OA_BYTES`, `OA_*`, `MAX_TOTAL_DOC_BYTES`, `MAX_COVER_BYTES`, `MAX_CHAT_BODY_BYTES`, `FOLLOW_UP_*`, `YEAR_FILTER_*`). `chat-fold.ts` and `stream-shape.ts` have no production importer: chat-fold is an owner decision (6.10); stream-shape's tables become `protocol/streams.ts` (production) and its checker stays as test support.

Shared's internal rule: `text.ts`, `ids.ts`, `vocab/*` import nothing; `protocol/*` import `vocab`, `ids`, `text` and each other's types; nothing imports `index.ts`; nobody outside imports `@scholar/shared/src/...` (a test fails on a deep import).

### 1.3 apps/api: platform, then features, then the composition root

```
apps/api/
  worker-configuration.d.ts   generated by `wrangler types` (npm run cf-typegen); CI fails if stale
  wrangler.jsonc
  src/
    index.ts                  composition root (Worker entry: fetch, scheduled, queue, Durable Object and Workflow exports); thin
    app/
      mount.ts                mounts each feature router with its guard defaults and its rate bucket
      dev-routes.ts           every /api/v1/dev/* route; mounted only when devMode(env)
      stand-ins.ts            the ONLY importer of every feature's testing/ module; builds Deps for test mode
      deps.ts                 builds Deps (real or stand-in) once per request / scheduled run / workflow step
      personal-data.ts        the list of every feature's PERSONAL_DATA (erase, export, retention, admin counts, test reset)
      maintenance.ts, jobs.ts, outcomes.ts (generic counter; names from shared/vocab/outcomes)
    platform/                 no feature imports; depends only on shared and lower platform modules
      env.ts                  Env (generated + documented secrets and dev vars); modules take Pick<Env, ...>
      switches.ts             SWITCHES registry (name, positions, kind gate|kill, KV key, privacy-sentence key) + flag(env, name)
      dev.ts                  devMode(env), standIns(env), DevOptions (keep-alive, top-k, poll, retry delays, raw-output hook)
      deps.ts                 the Deps type: fetch, clock/sleep, model(profile), embedder, pageReader, search, crossrefFetch, dev
      config.ts               publicBaseUrl(env) (one rule, ReDoS-safe), authStartUrl(provider)
      http/                   problem.ts (deny typed by ProblemType), sse.ts (sseStream(c, STREAMS.x, run)), guards.ts
                              (sameOrigin for writes, requireUser({ack, owns})), body.ts (readJson with byte limit),
                              ratelimit.ts (buckets; routes declare theirs at mount), middleware.ts, idempotency.ts
      llm/                    port.ts (binding-free types: Complete, StreamComplete, ModelProfile, ModelFailure),
                              profiles.ts, gateway.ts, providers/, failure.ts (classifyFailure, attemptsForLog, problemFor),
                              retry.ts (withMalformedRetry), workers-ai.ts (runWorkersAi: one cast, one usage read, privacy class),
                              embedder.ts, pricing.ts
      services/               polite-fetch.ts (timeout, Retry-After with one-day clamp, UpstreamError, retry policy, lane),
                              crossref.ts, openalex.ts, arxiv.ts, doi-org.ts, core.ts, doaj.ts, s2.ts, pubmed.ts, europepmc.ts
                              (each: base URL, identity, key, lane settings, record type and mapper, injected fetch)
      gate/                   one lane mechanism; lanes registered by services/*; built per entry by withPlatform(), no globals
      cache/                  remember(), rememberMany(), store.ts (CacheStore = llm ResponseCache), kv.ts, d1.ts, meter.ts
      db/                     rows.ts (insertRows chunked by D1's bound-value limit), allowance.ts (daily take/refund),
                              time.ts (sqlTime, fromSqlTime, clamp), ids.ts (randomId, newToken, sha256Hex, today), personal-data.ts (type)
      monitoring/             sentry.ts (release taken from env, not from callers), scrub.ts
      text.ts?                (none: text lives in shared)
    <feature>/                search, references, docs, ocr, oa, library, idea, litscan, trending, mcp, account, admin, auth, feedback,
                              answering, understand, chat. Each has, as it needs:
      routes.ts               HTTP only: parse, guard, call the service, reply
      service.ts              the ONLY thing other features may import (plus exported types)
      store.ts                its own tables (SQL lives here and nowhere else)
      personal-data.ts        its PERSONAL_DATA entries
      testing/                its stand-ins (imported by app/stand-ins.ts and tests only)
    search/                   api.ts (searchSources, byDois), sources.ts (registry: keys, lanes, scope sets), merge.ts,
                              doi-facts.ts (DOI check THEN retraction check, fixed order), relevance.ts (shared by tiers and litscan)
    answering/                evidence.ts (Picked, paperBlock, keepMarks, paperFromInput), writer.ts, judge.ts (judgeAnswer, judgeClaims)
    understand/               the whole Understand feature (reading, frame, lane, tiers, guards, visitor cap, counters names via shared);
                              network-free (legal-match rule 3): imports shared, platform/llm/port.ts and siblings only
    chat/                     routes.ts (HTTP shell), turn/ (Turn + one file per stage + runStage), prompts/ (builder + reader per prompt),
                              router-rules.ts (from shared route.ts), history.ts, think.ts, tools.ts, testing/
```

### 1.4 apps/web: lib, then components by feature, then App

```
apps/web/
  vitest.config.ts            NEW (environment node; jsdom only where a test needs the DOM)
  src/
    main.tsx                  calls startup() and renders App; nothing else runs at import anywhere
    App.tsx                   providers + router driven by routes.ts
    routes.ts                 the route and tool table: id, path pattern, view, title, rail label, short label, icon, keywords, help,
                              lazy page, params; used by App, Shell, palette, Home tools and cards, ChatView offers, legal links
    startup.ts                explicit startup (auth refresh, library listeners, chat listeners and wipe finishing, prefs, monitoring)
    test/                     fake-idb.ts, fake-storage.ts (one harness instead of three copies)
    lib/
      api/                    client.ts (api<T>(), ApiError from shared Problem), stream.ts (postStream, readSse, perFrame),
                              retry.ts (retry with Retry-After, abortable sleep); one endpoint module per feature
      state/                  store.ts (createStore), persisted.ts, keys.ts (every storage key + retired-key migrations + theme key used
                              by the inlined theme-init), person.ts (onPersonChange: sign-out and account deletion run one list),
                              flags.ts (PARKED, typed), sw-contract.ts (cache names with VERSION, message types, paper URL pattern)
      chat/ papers/ verify/ idea/ litscan/ admin/ rive/ ...   pure logic per feature, incl. the modules moved from shared
      ink/                    the ink model (TOOL_KEYS, paletteOf, sizeOf, InkPrefs, DrawTool, penOutline)
      pdf/                    readPages iterator (no pdf.js import), text-layer index (spans->words->Range->rects)
    components/
      ui/                     Modal, Sheet, Pop, CopyButton/useCopy, PageFrame (hero, gate, principles, loading, rise), Announcer
                              (one), lazyChunk, useTypingGuard, useModifierClick, useReturnFocus, menu.css
      shell/                  Shell, CommandPalette (from workspace/)
      home/                   HomePage, HomeChips, HomeExtras, starters, intro/ (from workspace/)
      chat/                   ChatView, ThinkBlock, ChatTool, AnswerView (one "answer with sources" view)
      paper/                  PaperSummary, RetractionBanner, ResultCard, PaperPreview, CiteMenu, LibraryList
      papers/                 PapersPage, DocWorkspace, reader/ (viewer, zoom, find, notes, ink, citations), panels
      verify/ idea/ litscan/ oa/ admin/ legal/ settings/
      each folder imports its own .css; styles/ keeps tokens and the first-screen sheet only
```

### 1.5 The dependency rule

Allowed imports (anything not listed is forbidden; "->" means "may import"):

| from | may import |
| --- | --- |
| `shared/text.ts`, `shared/ids.ts`, `shared/vocab/*` | nothing |
| `shared/protocol/*`, other shared modules | text, ids, vocab, protocol types |
| `api/platform/*` | shared; lower platform modules (env, switches, dev, deps <- db, cache, gate <- services <- llm <- http) |
| `api/<feature>/*` | shared; platform; its own files; another feature's `service.ts` and exported types only (never `routes.ts`, `store.ts`, `testing/`) |
| `api/understand/*` | shared; `platform/llm/port.ts`; `platform/switches.ts` types; its siblings (legal-match rule 3 stays the guard) |
| `api/<feature>/testing/*` | its feature, platform, shared; imported only by `app/stand-ins.ts` and tests |
| `api/app/*`, `api/index.ts` | everything |
| `web/lib/*` | shared; other lib modules; never `components/` |
| `web/components/ui/*` | lib, shared |
| `web/components/<feature>/*` | ui, lib, shared, another feature's `index.ts` |
| `web/App.tsx`, `web/routes.ts`, `web/main.tsx` | everything |
| tests | their own package only (an api test never reads apps/web) |

Stable things are depended on: shared (protocol, vocabulary) changes least, platform next, features, then the composition roots. Enforcement: a `layers.test.ts` in each app (built on depgraph.mjs's parser) that fails on a forbidden edge. It starts in wave 1 with an allowlist of today's violations; every wave shrinks the allowlist; the plan is done when the allowlist is empty.

---

## 2. Fixes

26 fixes (F0 to F25). Each fix: design, problems solved, special cases removed, risk and how behaviour stays identical, size (S under 1 day, M 1-3 days, L more).

Verification tools named below:
- **goldens**: `api/chat/since-year.test.ts` and `api/chat/route-context.test.ts` against `api/chat/*.golden.json` (off position byte-identical).
- **legal-match**: `api/legal-match.test.ts` (rule 3: understand/ network-free; rule 4: sentences pinned to switches) and `api/legal-text.test.ts`.
- **budget**: `npm run build && npm run budget -w apps/web`: first-load scripts 250 KB gzip, style 26 KB, fonts 185 KB, intro 15/7 KB, PDF reader 66 KB, Rive 64/365/10 KB, the forbidden-in-first-load list (`web-scripts/budget.mjs:71`) and the lazy-chunk list (C3, `:73` on).
- **integration**: `node apps/api/scripts/integration.mjs` (API suites) and `--browser` (browser suites); **switch matrix**: the same with `INTEGRATION_VARS="CHAT_UNDERSTAND:on,CHAT_FLOOR:on,CHAT_SAFETY:core,CHAT_CLEAN:on,CHAT_COUNTERS:on,CHAT_THINK:on,CHAT_TOOLS:on"` and `INTEGRATION_TRENDING=dark`, `INTEGRATION_MCP=off` (CI never runs these today, [ti] T2).
- **eval**: `npm run eval` (replay: a changed outgoing request shows up as a missing recording, which makes it the guard for "what is sent anywhere").

### F0. Delete what nothing uses

Design: remove every export, file, parameter and re-export that has no caller (verified by grep and depgraph section 5 "dead"); no redesign. Items whose removal needs a migration or a wrangler change are not here (section 6).

Problems:
- `api/understand/understand-flag.ts:13`, `:17` and its test `api/understand/understand-flag.test.ts:1-32` [chat][cc]
- `api/understand/understand.ts:404` FALLBACK_NOTICE, `:409` CONFIRM_TEXT [chat][cc]
- `api/chat/evidence.ts:9` MAX_ABSTRACT_CHARS (stale 1500) [chat][cc]
- `api/understand/understand-counters.ts:35` und_change (written by nothing), `:39` isUnderstandCounterName (test only) [chat]
- `api/chat/router.ts:431`, `api/chat/tools.ts:184-185` re-exports; `api/chat/claim-check.ts:37` claimOf export [chat]
- `api/chat/support.ts:316` dropUnmarkedNo and its test cases [chat]
- `api/understand/frame.ts:544` cleanRequest (move into `eval/frame.eval.ts` if the eval needs it) [chat]
- `api/llm/d1.ts:25-27` d1ResponseCache; `api/llm/gateway.ts:167` type Gateway; `api/llm/gateway.ts:168` double re-export with `api/llm/index.ts:52`; `api/mcp/calls.ts:13` McpTool [svc][cc]
- `api/oa/store.ts:36` fromSql; `api/oa/routes.ts:13` progressOf re-export; `api/oa/routes.ts:18-19` second installGates; `api/oa/service.ts:228` notice param; `api/oa/deps.ts:14` gate param; `api/oa/safe-fetch.ts:52` maxRedirects; `api/oa/sources.ts:163`, `:182` `.catch(() => null)` on null-returning lookups [svc]
- `api/references/routes.ts:6-7` re-exports for a test; `api/search/retraction.ts:15-23` findRetracted wrapper; `api/cache/kv.ts:20` cacheTtl; `api/ocr/process.ts:105` PageResult alias [svc]
- `api/auth/oauth.ts:10` re-export of sha256Hex (and `api/auth/session.ts:1` imports from `../hash`); `api/mcp/oauth.ts:23`; `api/docs/vector.ts:43`; `api/idea/insights.ts:64` alias; `api/trending/routes.ts:60-62` servedPayload; `api/mcp/scopes.ts:15` GRANTABLE; `api/admin/routes.ts:5`, `:9` duplicate import; `api/mcp/server.ts:172` arxivIdFromDoi twice [feat]
- `shared/chat-context.ts:15` MAX_HISTORY_QUERY_CHARS, `:83` ChatContextRequest; `shared/idea.ts:32` IdeaPlanRequest; `shared/litscan.ts:60` LITSCAN_END_STATES; `shared/chat-tools.ts:17` ChatToolKind; `shared/index.ts:12` Theme; `shared/chat.ts:184` MAX_TIGHTEN_ABSTRACT alias; `shared/idea.ts:182` IdeaInsightsRequest alias; `shared/chat-copy.ts:85-86` re-export; `shared/chat-state.ts:692` unused `text` param [sh]
- `web/components/papers/HighlightsTools.tsx:62-132` SUGGEST, AskHighlights and their CSS `web/styles/shell.css:323-328` [wc][cc]
- `web/components/oa/OaAskSheet.tsx:153-154` paperKey; `web/components/SettingsDialog.tsx:16` onDeleted and idPrefix default; `web/components/ReadingControls.tsx:15`, `:20` heading branch [wc]
- `web/components/papers/InkLayer.tsx:13`, `:67`, `:71`; `web/workspace/intro/engine.ts:31`, `:51`, FilmHooks; `web/workspace/intro/Film.tsx` SCENE_TITLES (drop `export`) [wc]
- Dead CSS: `web/styles/app.css:886`, `web/styles/idea.css:702`, `web/styles/litscan.css:9`, `:39`, `:41`, `:59`, `web/styles/shell.css:590`, `web/styles/verify.css:5`, `:10`, `web/styles/workspace.css:1012`, `:1022` [wc]
- `web/lib/documents.ts:25` askDocument; `web/lib/chat.ts:406` chatLedger; `web/lib/motion.ts:3` springSoft; `web/lib/notes.ts:88` notesToMarkdown; `web/lib/offline.ts:21` offlineSupported; `web/lib/offline.ts:45` "clear" message type; `web/lib/scan.ts:115`, `:178` parallel; `web/lib/rive.ts:44-47`, `:55` settleMs/timeoutMs; `web/App.tsx:271` no-op ternary [wl][cc]
- `.github/scripts/workflow-alert.mjs:89`, `:199` unused modes; root `package.json:17` deploy script [ti]

Special cases removed: none (no behaviour). Risk: none; a dynamic use is the only way to be wrong (the `fm-s-*` and `lucide-*` classes are built at run time and are NOT removed). Keep identical: `npm run typecheck`, `npm test`, `npm run build`, budget (must not grow). Size: **S**.

### F1. Each package tests itself; tests live next to their code; a layer rule test

Design: add vitest to `apps/web` (`vitest.config.ts`, environment node, `src/**/*.test.ts(x)`, a `web/test/` harness with one fake IndexedDB and one fake storage) and to `packages/shared`; the root `npm test` runs `npm test --workspaces --if-present`, so CI's existing `npm test` step covers all three. Move every misplaced test with `git mv` and import-path edits only (no assertion changes in this fix). The `/@fs` and `readFileSync` tricks go. Test fixtures used by unit tests and browser suites (make-pdf, labelled cases) move to one `test-support` workspace (`packages/test-support`), so src tests stop importing `apps/api/scripts`. The `.node-test.mjs` suffix goes (one runner per package). Add `layers.test.ts` to api and web (section 1.5) with an allowlist of today's violations taken from depgraph.txt.

Problems:
- apps/web has no test runner, so the browser's logic was put in shared or tested from api [sh][wl]
- api tests that load web source: `api/chat/web-store.test.ts:12`, `api/chat/lane-store.test.ts:9`, `api/chat/new-topic-store.test.ts:9`, `api/docs/cite-status.test.ts:8`, `:11`, `api/search/plain-text.test.ts:638-650`, `api/trending/starters.test.ts:20`, `api/trending/home-starters.test.ts:10`, `api/outcome-labels.test.ts:14` [sh][wl][wc]
- three copies of the fake IndexedDB, storage and path mocks: `api/chat/web-store.test.ts:13-65`, `api/chat/lane-store.test.ts:20-62`, `api/chat/new-topic-store.test.ts:13-39` [wl]
- shared/web code tested from `api/chat/`: chat-fold, chat-fold-walk, chat-fold-canary, chat-list, reducer, versions, copy, script, tighten-state, since-year-client, lane-state, ledger `.test.ts`, and `api/understand/reading.test.ts` [chat][sh]
- from `api/docs/`: ask-source, citations, citations.real, findall, highlight, ink-items, ink, notes-md, palette, paperinfo, quote-quads, text, zoom `.test.ts` [feat]
- from `api/trending/`: client, contract, home-row, home-starters, pipeline, policy, rank, select, starters, text, verify `.test.ts` (rank, policy, select, pipeline go to api/trending once F2 moves trending.ts there) [feat]
- `api/idea/ideafile`, `report`, `sentences`; `api/litscan/docx`, `report`, `review`; `api/monitoring/noise`; `api/shared-rive.test.ts`; `api/stream-shape.test.ts` [feat][sh]
- `api/ocr/gate.test.ts` (also collides with `gate/`), `api/ocr/scan-info.test.ts`, `api/oa/ref.test.ts`, `api/references/split.test.ts` [svc]
- tests in the wrong api folder: `api/services.test.ts` (search, references, retraction from the root) [feat]; `api/search/doi-check.test.ts:37` (normalizeDoi); `api/search/lookup-cache.test.ts:187-287` (references/lookup); `api/cache/kv.test.ts:101-232` (meter and store) [svc]
- src unit tests import the scripts folder: `api/docs/paperinfo.test.ts:25`, `api/oa/pdf-text.test.ts:2`, `api/chat/route-context.test.ts:7`, `api/chat/standalone-rule.test.ts:5-7`, `api/chat/followup-eval.test.ts:9-11`; browser suites import `../../api/scripts/fake-idp.mjs` and `lib/make-pdf.mjs` (`e2e/workspace.mjs:9-10`) [ti] N2
- three runners and suffixes (`package.json:15`, `apps/api/vitest.config.ts`, `scripts/lib/*.node-test.mjs`) [ti] N5
- `eval/metrics.eval.ts:41` on: deterministic unit tests inside the eval run (move to `npm test`) [ti] N4

Special cases removed: the `/@fs` and concatenated-path loading convention; `.node-test.mjs`; `shared/copy-through.ts:1-5` loses its only reason (deleted in F2).
Risk: losing tests silently. Keep identical: record the vitest JSON totals (files, tests, assertions) before; after the move, api + shared + web totals must equal the old api total (plus nothing). `npm run typecheck`, `npm test`, `npm run test:scripts`, `npm run eval`. Size: **M**.

### F2. Shared holds only the protocol and the vocabulary both apps need

Design: as in 1.2. `index.ts` becomes a pure barrel and `Paper` and friends move to `paper.ts`; shared modules import siblings, never `./index` (ends the 19-file type cycle). Web-only modules and their tests move into `web/lib/<area>/`; server-only modules move into `api/trending/` and `api/chat/router-rules.ts`. `route.ts` splits: protocol words to `protocol/route-words.ts`, rules to the api. `chat.ts` stops importing tuning knobs: `ABSTRACT_READ_CHARS` becomes a protocol limit in `protocol/limits.ts` (the browser sends that many characters, the server reads that many), and the `MAX_TIGHTEN_ABSTRACT` alias goes. `ChatMode` alias goes. `ocr.ts`'s `Reading` is renamed `OcrReading` so `reading.ts` can be `export *`-ed. A test fails on any deep `@scholar/shared/src/` import and on a shared module with a top-level statement (keeps the `sideEffects: false` promise of `apps/web/vite.config.ts:30-33` true). The one APA formatter and one family-name parser live in `web/lib/cite/` after the move.

Problems:
- `shared/index.ts:30` Paper, `:98` SearchScope defined in the barrel; 55 stable-to-volatile edges point at it (depgraph 7), e.g. `api/chat/claim-check.ts:1`, `api/chat/complete.ts:1`, `api/search/service.ts:1`, `web/lib/cite.ts:1`, `web/components/papers/CitationCard.tsx:5` [cc]
- `shared/chat-copy.ts:3`, `chat-fold.ts:1`, `chat-state.ts:1`, `chat.ts:1`, `idea.ts:1`, `litscan.ts:2`, `oa.ts:6` import from `./index`: the type SCC of 19 files (depgraph 2b) [cc]
- `shared/index.ts:124-173` one `export *` per web-only module (index changed in 44 of 67 shared commits) [sh]; `shared/index.ts:161-166` reading.ts exports listed by hand because of the `Reading` clash with `ocr.ts:52` [sh]
- web-only modules in shared (21; list in 1.2), e.g. `shared/chat-state.ts:10` ("pure so it is tested without a browser"), `shared/trending-row.ts:4`, `shared/copy-through.ts:1-5` [sh]
- `shared/chat-state.ts:787` chatRefusalShare (/admin maths in the reducer) [sh]
- server-only: `shared/trending.ts:3-4` (deep import rule), `shared/subfield-policy.ts:2`; `shared/route.ts:117` ruleRoute, `:133` offlineRoute, `:172` isSmallTalk, `:268` smallTalkReply, `:420` needsContext, `:444` languageWithContext, `:378` subjectWords, `:88` looksLikeReferenceList; `:104-106`, `:321`, `:326`, `:373`, `:401`, `:403` test-only exports; `:188`, `:334`, `:351`, `:434` `/* @__PURE__ */` marks [sh]
- operational limits in the protocol package: `shared/oa.ts:15`, `:36`, `:38-51`, `:130` (MAX_OA_ABSTRACT_CHARS stays: the browser uses it, see F9); `shared/chat-context.ts:28`, `:31-32`, `:42`, `:49`, `:51`, `:53`, `:59`; `shared/documents.ts:6-7` [sh]
- `shared/chat.ts:5`, `:184` wire module imports the tuning knob; `shared/chat.ts:1-7` the protocol sits on top of volatile modules; `shared/chat.ts:13` ChatMode alias [sh]
- `shared/chat.ts:4`, `chat-context.ts:1`, `litscan.ts:3`, `chat-state.ts:4` take wire types from the tuned word-list file `route.ts` [sh]
- sibling internals: `shared/ledger.ts:1` (activePath, cutWhole, oneLine, topicStart), `shared/chat-fold.ts:4` (answerWords, scanTurns, FinishedTurn) [sh]
- stable-to-volatile inside shared: `shared/trending.ts:17-18` -> chat.ts/route.ts; `shared/trending-row.ts:8` -> chat-state.ts (isSinceYear); `shared/chat-fold.ts:2`, `:4`; `shared/chat-copy.ts:1`, `:2`; `shared/chat-memory.ts:1`; `shared/ledger.ts:1` (depgraph 7: 15 edges to chat.ts, 8 to chat-state.ts) [cc]
- `shared/chat-copy.ts:4` "Copy the answer" depends on litscan-review (apaReference); APA written twice (`shared/litscan-review.ts:138`, `:107` and `web/lib/cite.ts:38`); family name three times (`shared/ledger.ts:59`, `web/lib/cite.ts:18`, `web/components/litscan/Review.tsx:28`, `web/lib/citeStatus.ts:63`) [sh][wl]
- deep imports (15 production): `api/trending/routes.ts:3`, `api/trending/job.ts:2`, `:21`, `api/trending/arxiv.ts:1`, `api/trending/openalex.ts:1`, `api/trending/scan.ts:1-2`, `web/App.tsx:27`, `web/workspace/HomePage.tsx:21`, `web/workspace/HomeChips.tsx:4`, `web/lib/trending.ts:2` [feat][sh][wl][cc]
- scripts that write deep paths as strings or import shared by relative `.ts`: `scripts/trending-live.mjs:72-73`, `scripts/trending-contract-live.mjs:129`, `scripts/litscan-live.mjs:11`, `scripts/lib/stream-rule.mjs:3` (and the "Node can strip it" rule in `shared/stream-shape.ts:18`) [sh]
- `apps/web/vite.config.ts:30-33` side-effect promise checked by nothing [wl]
- `web/workspace/starters.ts` loaded by api tests by path string; also imported by `e2e/trending.mjs` and `scripts/trending-contract-live.mjs` (stays in web; the tests move with F1; scripts load it through F25's one loader) [wc] F17

Special cases removed: "import trending as `@scholar/shared/src/trending`", the PURE marks, the hand list of reading exports, copy-through, the `chat-copy` re-export.
Risk: the bundle. Modules moved into web lose the package-level `sideEffects: false`; declare `"sideEffects": ["**/*.css"]` in `apps/web/package.json` so tree-shaking is unchanged. Keep identical: budget (every line equal within 0.2 KB; record before), typecheck, all three test runs, `npm run eval`, integration (trending suites with `INTEGRATION_TRENDING=dark`). Size: **L**.

### F3. One text and identifier toolkit in shared

Design: `shared/text.ts` and `shared/ids.ts` (1.2). Every copy imports them. Where copies disagree on purpose, the toolkit keeps one function with a named option, not a second function (year ranges `FILTER_YEARS` and `PUBLICATION_YEARS` keep today's bounds; marker widths `MARK` 1-2 digits and `MARK_WIDE` 1-3 digits; the restate and rewrite word lists stay two named lists until the follow-up eval shows the union changes nothing). `foldTitle` is Unicode-aware but gives exactly today's output for every title that has a Latin letter or digit, so stored ids `t:<key>` do not change; only titles that fold to "" today get a real key (bug B5). `plainText` is the strongest of the six decoders (search's, 207 entities). The `[n]`-mark stripper, the invisible list and `oneLine` are one each, so the browser and the server clean the same way.

Problems:
- DOI pattern written about 25 times, each a little different: `api/chat/tools.ts:25`, `api/understand/guards.ts:19` (byte copy of `shared/route.ts:84`), `api/understand/frame.ts:169`, `api/understand/ledger-input.ts:45-46` (= `api/docs/info.ts:5` without /i), `api/chat/history.ts:92`, `api/chat/general.ts:45`, `api/chat/restate.ts:56`, `api/understand/chat-reply.ts:41`, `api/understand/input-shape.ts:206`, `api/mcp/tools.ts:287`, `api/references/match.ts:61`, `:110`, `:324`, `:362`, `:398`, `api/search/normalize.ts:10`, `shared/oa.ts:56`, `shared/route.ts:84`, `:97`, `shared/paperinfo.ts:142`, `:310`, `shared/idea-m3.ts:90` [chat][sh][feat][cc]
- DOI normalisers (six): `api/search/normalize.ts:8`, `api/references/match.ts:53` (tidyDoi), shared `cleanDoi` (`shared/oa.ts:62`, used at `api/oa/sources.ts:43`, `api/oa/service.ts:41`, `api/chat/tools.ts:43`), `api/library/validate.ts:20`, `api/references/lookup.ts:162`, `api/search/retraction-service.ts:25`; by hand at `api/understand/ledger-input.ts:66` [svc][chat]
- DOI in a URL: `api/references/lookup.ts:85`, `:181`, `:215`, `:243` vs `api/oa/sources.ts:105`, `:129` (different escape; the encoding moves into each service client in F11 unchanged, the function lives here) [svc]
- "unique, no comma" DOI filters: `api/search/retraction.ts:28`, `:65`, `api/search/doi-check.ts:73`; in SQL `api/library/retraction.ts:30`, `:41` [svc]
- arXiv: `api/understand/guards.ts:20` = `shared/route.ts:85`; `api/docs/info.ts:6`; `api/understand/input-shape.ts:210-211` = `shared/oa.ts:57-58`; arXiv DOI built at `api/search/arxiv.ts:42`, `api/references/match.ts:99`, parsed at `:103`, also `shared/oa.ts:81`, `shared/paperinfo.ts:164` [svc][cc]
- citation marker `[n]` in 13 places, two widths: `api/chat/answer.ts:183`, `:185`, `api/chat/routes.ts:1021`, `api/chat/support.ts:18`, `:23`, `api/docs/qa.ts:108`, `:110`, `shared/chat-copy.ts:15`, `:29`, `shared/litscan.ts:187`, `shared/script.ts:53`, `shared/route.ts:319`, `web/components/papers/AskPanel.tsx:69`, `:179`, `web/workspace/ChatView.tsx:176`, `shared/chat-state.ts:455`, `shared/ledger.ts:70`; 3 digits: `api/chat/evidence.ts:45`, `shared/litscan-docx.ts:19` [cc][sh]
- invisible characters (five lists): `api/chat/history.ts:54`, `shared/chat-state.ts:390-391`, `shared/chat-copy.ts:22`, `api/search/normalize.ts:68-69`, `api/understand/lane.ts:53`; `api/understand/hostile-messages.ts` `cp` = `shared/chat-state.ts:385` [chat][sh][cc]
- controls to space / one line: `api/chat/history.ts:58`, `api/chat/router.ts:251`, `shared/chat.ts:157`, `shared/documents.ts:48`, `shared/litscan.ts:105`, `shared/notes-md.ts:13`, `:24`, `shared/chat-state.ts:392-394`, `shared/chat-copy.ts:17`, `api/understand/understanding.ts:89-91`, `api/oa/jats.ts:104`, `shared/paperinfo.ts:49`, `shared/references.ts:60` [chat][sh][cc]
- cutting: `api/chat/history.ts:66` (cutChars) vs `shared/chat-state.ts:399` (cutWhole); `api/chat/history.ts:137` sizeOf = `shared/chat-state.ts:496` [chat][cc]
- `isInt`/`isCount`: `api/chat/history.ts:129`, `api/chat/router.ts:253`, `api/chat/tighten.ts:11`, `api/understand/understanding.ts:116`, `api/trending/job.ts:167`, `api/trending/openalex.ts:53`, `api/trending/scan.ts:33`, `shared/trending.ts:590`, `shared/trending-client.ts:47` [chat][cc]
- year bounds: `api/chat/history.ts:147`, `api/understand/ledger-input.ts:72`, `api/understand/understanding.ts:23-24` (copy of shared MIN/MAX_FILTER_YEAR), `shared/chat-state.ts:437`, `:445` [chat][sh]
- ISO day: `api/trending/job.ts:164`, `:165`, `api/trending/openalex.ts:13`, `shared/trending-client.ts:40`, `shared/trending-row.ts:26`, `:30`, `shared/trending.ts:68`, `:74` [cc]
- web URL: `api/search/india.ts:24` = `api/library/validate.ts:74`, `shared/docx.ts:67` safeLink [svc][cc]
- entity decoders: `api/search/normalize.ts:117`, `api/search/arxiv.ts:12`, `api/oa/sources.ts:39`, `api/oa/jats.ts:22`, `api/references/lookup.ts:53-54`, `api/oa/safe-fetch.ts:147`, `api/litscan/worker.ts:24-29` [svc][feat]
- folds and tokenizers: `api/references/match.ts:49-51`, `api/oa/identity.ts:8`, `api/search/normalize.ts:18-25`, borrowed at `api/search/doi-check.ts:5`; `api/references/match.ts:115` locateRun = `shared/text.ts:9` findRun; `api/docs/routes.ts:179` = `web/components/papers/WorkspaceSearch.tsx:7` [svc][cc]
- stop lists: `api/search/arxiv.ts:10`, `api/search/india.ts:19`, `api/oa/identity.ts:6`, `api/references/match.ts:281`, `:346`; query builders `api/search/arxiv.ts:26` = `api/search/india.ts:38`; "India" removed two ways `api/search/india.ts:21`, `:179` [svc]
- numbers from text: `shared/ocr.ts:207`, `shared/think.ts:24`, `api/chat/restate.ts:31`, `api/chat/rewrite.ts:48`, `api/idea/insights.ts:91` [sh][chat]
- the "adds nothing" checker twice: `api/chat/restate.ts:26`, `:31`, `:33`, `:49` vs `api/chat/rewrite.ts:11`, `:48`, `:16`, `:43` [chat]
- citation detectors: `api/chat/general.ts:44`, `api/understand/chat-reply.ts:40`, `:43`, `api/chat/history.ts:91-97`, `shared/citations.ts:271` [chat]
- language three-way: `api/chat/think.ts:9`, `api/understand/lane-text.ts:80`, `api/understand/tiers-text.ts:26`, `api/understand/understand.ts:174`, `:276`, `:309` [chat]
- e-mail, ORCID, scrub: `api/idea/plan.ts:47`, `:51` (scrubText, imported by `api/litscan/plan.ts:3`, `api/feedback/routes.ts:5`), `api/monitoring/sentry.ts:25`, `api/admin/accounts.ts:7`, `:8` (= `api/auth/providers.ts:88`), `api/understand/input-shape.ts:226` [feat]
- text helpers imported from the wrong module: `api/chat/answer.ts:3` (from the history parser), `api/understand/ledger-input.ts:1`, `api/understand/chat-reply.ts:3` (from a schema module) [chat]
- copies.txt E: 19 regex groups (all of them are in the bullets above) [cc]

Special cases removed: `api/search/doi-check.ts:113` (re-decoding both titles); the pubmed trailing-stop strip (`api/search/pubmed.ts:46`) is no longer needed for the merge key (it stays for the displayed title).
Risk: titles and ids. Keep identical: a test over every title in `eval/fixtures.json.gz` and the trending/plain-text recordings asserting `foldTitle(t) === normalizeTitle(t)` whenever today's result is non-empty (then delete the test in the tests pass); goldens; `npm run eval` (plain-text, eval, prior-art gates); integration. Behaviour changes only at bugs B5, B19 and section 6.18/6.19. Size: **M**.

### F4. Closed lists, labels, limits and outcome names live once in shared/vocab and shared/protocol

Design: every closed list both apps use is one `as const` list in `shared/vocab/` with its labels next to it; derived types replace retyped unions; the server's checks import the same numbers (the server may be stricter in rules, never in numbers of its own). Counted outcome names become data per feature in `shared/vocab/outcomes.ts`; `api/outcomes.ts` is a generic counter that reads it and `web/components/admin/AdminOps.tsx` takes labels from it. The reply-kind table (per `reason`) is the one place the page and the counter ask "is this a no-papers reply, does it count". `ProblemType` lives in `protocol/problem.ts` (used by F9 and F10).

Problems:
- intents: `api/understand/understanding.ts:9` = `shared/ledger.ts:18`, retyped at `shared/chat.ts:75`, `shared/chat-state.ts:103` [chat][sh][cc]
- languages: `api/understand/understanding.ts:11` = `shared/chat-context.ts:63`; `shared/chat-fold.ts:28`; `shared/chat-state.ts:427` = `api/chat/history.ts:47`; `shared/litscan.ts:41`, `:42`; `api/understand/chat-reply.ts:31` [sh][cc]
- lane reasons written three ways: `shared/chat-state.ts:466` (two reasons, deliberate: no trace), `:478` and `shared/ledger.ts:41` (three); `api/chat/routes.ts:422` lists them by hand [sh][chat]
- steps: `shared/chat-state.ts:89` STEP_ORDER retypes `shared/chat.ts:23`; `web/workspace/ThinkBlock.tsx:18` copies it [sh][cc]
- notice kinds mix server and page kinds: `shared/chat.ts:99`, `:146-148`, `web/lib/chat.ts:699` [sh]
- reference verdicts: `web/lib/refStatus.ts:14-27`, `web/lib/citeStatus.ts:7`, `:13-21`, `:20-21`, `web/workspace/ChatTool.tsx:18`, `api/feedback/routes.ts:17`; prose `web/components/verify/VerifyPage.tsx:27-29`, `web/components/legal/LegalPages.tsx:66` (prose stays: it is the page) [wc][wl][sh][feat]
- read states: `shared/documents.ts:41` (no importer) = `web/components/papers/DocMeta.tsx:8`; `web/workspace/baseCommands.ts:29` re-derives "Done"/"Reading" [cc][wc]
- sources: `shared/index.ts:76`, `:89` (copy of `api/search/index.ts:19-22` SCOPES.all), `:91` typed `string[]`; `shared/idea-m3.ts:78`, `:79`; `web/components/idea/IdeaResults.tsx:13`, `:15`; `api/idea/search.ts:44`; `web/components/idea/PlanEditor.tsx:9` vs `shared/idea.ts:75` [sh][cc]
- note kinds: `api/understand/frame.ts:461` restates `shared/reading.ts:15` [cc]
- ledger and history numbers: `api/understand/ledger-input.ts:14-39`, `:35`, `:38` vs `shared/ledger.ts:22-35`, `:28`, `:31` (bug B20); `shared/chat-state.ts:641` ledger typed `unknown[]`; `shared/chat-context.ts:13` MAX_HISTORY_USER_CHARS enforces nothing (`api/chat/history.ts:175`, `shared/chat-state.ts:396` cut with MAX_CHAT_CHARS); `shared/chat-state.ts:630` `MAX_HISTORY_ENTRIES / 2`; `shared/chat-state.ts:181` vs `:707` (600 and 601) [sh]
- year words: `shared/chat-state.ts:424` yearRangeWords vs `api/chat/routes.ts:236` rangeWords; `shared/chat-state.ts:100-101` isSinceYear vs the server's check [sh]
- outcome names: `api/outcomes.ts:2-3` (stable root imports volatile understand/), `:13`, `:23-48`, `:85-97`; `api/understand/input-shape.ts:16` (R3's list carries names of R4, R8, R9), `:32` = `shared/outcome-counts.ts:2`; `shared/outcome-counts.ts:11-12`; `api/understand/understand-counters.ts:23`, `:31-32` (und_fix_* repeat the Correction union at `api/understand/understand.ts:110`), `:71` (0.75/0.45 copies `api/understand/understand.ts:21-22`); `shared/chat-state.ts:793-797`; `web/components/admin/AdminOps.tsx:14`, `:94`; `shared/feedback.ts:44` (feature/outcome typed string) [chat][feat][sh][cc]
- MCP tool names three lists: `api/mcp/server.ts:78-86`, `api/mcp/calls.ts:12`, the `registerTool` names at `api/mcp/server.ts:195-391` [feat]
- chat tool kinds: `shared/chat-tools.ts:16` read by nothing while `:36-50` retype the names [sh]
- the frozen R3 definition `api/understand/input-shape.ts:43`, `:56`, `:96` vs `api/understand/frame.ts:49`, `:56-57`, `:163`: stays frozen, named "R3 definition (frozen for the counter series)" so the link is explicit [chat]
- `web/lib/oa-ask.ts:112` literal 4000 = `shared/oa.ts:130` MAX_OA_ABSTRACT_CHARS [cc]
- `web/workspace/HomePage.tsx:350`, `:353`, `:360`, `:371`, `web/workspace/ChatView.tsx:816`, `:817` validation sentences (one module of sentences) [wc]

Special cases removed: `api/outcomes.ts:85`, `:93` and `shared/outcome-counts.ts:11-12` (an `if` per feature); `api/chat/routes.ts:422` (three reasons by hand); `shared/chat-state.ts:119` (`offer === "litscan"`) becomes a reply-kind row; the source-reading tests `api/outcome-labels.test.ts:14-30` and `api/docs/cite-status.test.ts:11-12` are deleted (nothing left to hold equal).
Risk: counter names and labels are frozen data. Keep identical: `api/outcomes.test.ts`, `api/chat/counters.test.ts`, `api/understand/input-shape.test.ts:34` (frozen names), goldens, legal-text; the /admin page in `e2e/admin.mjs`. Size: **M**.

### F5. One Env type

Design: `wrangler types` (the `cf-typegen` script exists) generates `apps/api/worker-configuration.d.ts`; `api/platform/env.ts` adds what wrangler cannot know (secrets and dev variables), with the one doc comment each variable has today moved from `api/index.ts:40-80` and `api/chat/routes.ts:51-130`. Every module takes `Pick<Env, ...>`; the Hono app is typed with it; `currentUser` is typed; the `as never` casts go. CI runs `cf-typegen` and fails on a diff.

Problems:
- `api/index.ts:40-80` misses `CHAT_JUDGE`, `OCR_PAGES_PER_DAY`, `QA_TOP_K`, `LLM_QA_MODEL`, `LLM_REASONING`, `LLM_CLASSIFY_MODEL`, `LLM_VERIFY_MODEL`, `SEARCH_PLAINTEXT`, `SSE_KEEPALIVE_MS` [feat]
- 46 hand-declared env types (`CROSSREF_MAILTO` declared 17 times): `api/docs/routes.ts:58-75`, `api/idea/routes.ts:17-31`, `api/litscan/model.ts:12-25`, `api/admin/routes.ts:16`, `api/account/routes.ts:10`, `api/auth/routes.ts:10`, `api/mcp/server.ts:75`, `api/chat/routes.ts:51-130` [feat][cc]
- two `OaEnv`: `api/oa/workflow.ts:17` and `api/oa/service.ts:19`, `:35`; padding at `api/oa/service.ts:32-33` [svc][cc]
- `api/account/routes.ts:10` types `{DB, FILES}` while `api/account/erase.ts:18` needs `OAUTH_KV`, `PUBLIC_BASE_URL`, `SENTRY_*` [feat]
- casts: `api/index.ts:366`, `api/mcp/server.ts:279`, `api/chat/routes.ts:457`, `:468`, `api/oa/service.ts:182`, `:202`, `api/oa/routes.ts:57` [feat][svc][chat]
- `api/auth/http.ts:23` takes `Context<any>` and casts `c.env` [feat]
- `api/search/arxiv.test.ts:61`, `:66` `store: undefined as never` [svc]

Special cases removed: none. Risk: none at run time (types only). Keep identical: `npm run typecheck`, `npm test`, a production `wrangler deploy --dry-run` bundle byte-equal. Size: **M**.

### F6. One switch registry, outside any feature

Design: `understand/flags.ts` moves to `api/platform/switches.ts`, with `SWITCHES` declaring every switch once: name, positions (`off`, `shadow`, `core`, `writer`, `beta`, `on`, `dark`), kind (`gate`: unset is off; `kill`: on unless "off"), KV key if any (`flag:<NAME>`, `trending:v1:off`), and the privacy-sentence key. `flag(env, "CHAT_FLOOR")` is typed by it; the per-flag `allow*` options are derived from the positions. CHAT_JUDGE, CHAT_CONTEXT and TRENDING (with "dark") are kill switches read through it. `legal-match.test.ts` keys its FLAG_SENTENCES by the registry (a typo stops compiling) and imports from the new place; integration (F24) reads the positions from the registry.

Problems:
- `api/understand/flags.ts:61-67` one option per flag; `api/chat/routes.ts:147` picks them by name; `api/chat/routes.ts:145` gate() wrapper [chat]
- raw reads: `api/chat/routes.ts:334`, `:933`, `:1058`, `api/litscan/workflow.ts:58` [chat][feat]
- `api/mcp/flag.ts:1` imports the reader from a feature folder; `api/legal-match.test.ts:6` too [feat][chat]
- `api/trending/routes.ts:26-28` ("off" or "dark") vs `api/trending/job.ts:275` ("off" only); `api/trending/routes.ts:38-44` a second KV switch read its own way [feat]
- every switch documented on the chat route's Bindings (`api/chat/routes.ts:51-130`) [chat]

Special cases removed: `allowCore: name === "CHAT_SAFETY", allowWriter: name === "CHAT_FLOOR"`; the hand "off" checks.
Risk: switch semantics. Keep identical: `api/understand/flags.test.ts` (moves, unchanged), goldens, legal-match, integration plus the switch matrix and `INTEGRATION_TRENDING=dark`. Size: **M**.

### F7. Dev mode and stand-ins decided in one place

Design: `api/platform/dev.ts` holds `devMode(env)` and `standIns(env)`; nothing else reads `ENABLE_DEV_ROUTES` or `QA_STUB`. The composition root builds a `Deps` object per entry (request, scheduled run, workflow step): `fetch`, `clock`/`sleep`, `model(profile)`, `embedder`, `pageReader`, `search`, `crossrefFetch`, retry delays, and `dev` (keep-alive interval, `QA_TOP_K` with its bound of 12, raw-output hook, poll interval), real or stand-in. Services receive deps. Every stand-in moves to `<feature>/testing/` and is imported only by `api/app/stand-ins.ts`. Every `/api/v1/dev/*` route moves to `api/app/dev-routes.ts`, mounted only when `devMode(env)`. Stub magic words and sleeps (the "stalled" 3.5 s) live inside the stand-in, never in a route. On the web, the e2e knob `scholar.quiet.ms` (`web/workspace/ChatView.tsx:94-101`) moves into one `web/lib/state/dev-knobs.ts`.

Problems:
- the two-flag expression copied 15 times: `api/chat/routes.ts:139`, `api/chat/claim-check.ts:68`, `api/docs/routes.ts:118`, `:133`, `:136`, `:146`, `api/idea/routes.ts:41`, `api/litscan/model.ts:27`, `api/mcp/server.ts:161`, `api/oa/deps.ts:15`, `api/oa/workflow.ts:30`, `:49`, `api/oa/service.ts:186`, `api/search/retraction-service.ts:21`, `api/trending/job.ts:622`, `api/index.ts:388`; taken as a parameter at `api/chat/understand-wire.ts:149`, `api/chat/stub.ts:134` [cc][feat][svc][chat]
- dev switch changing production code paths: `api/sse.ts:33`, `api/litscan/routes.ts:187`, `api/auth/providers.ts:43`, `api/docs/routes.ts:129`, `:579`, `api/idea/routes.ts:161`, `:207`, `api/chat/routes.ts:441`, `:933`, `api/oa/service.ts:153`, `:184` (QA_TOP_K without the bound of `api/docs/routes.ts:128-129`), `:186`, `api/oa/workflow.ts:49-50`, `api/litscan/workflow.ts:33`, `api/trending/job.ts:626` (STUB_FAULT_KEY), `api/trending/stub.ts:58` [feat][svc][chat]
- stand-in branches and sleeps in production routes: `api/chat/routes.ts:848`, `api/idea/routes.ts:118-124` [chat][feat]
- nine dev routes each guard themselves: `api/index.ts:196`, `:218`, `:224`, `:229`, `:240`, `:254`, `:273`, `:306`, `:334`; `:276`, `:291` hard-code `"trending:v1"` instead of `api/trending/store.ts:12-19`; `api/index.ts` 394 lines in 29 commits [feat]
- stand-ins imported into production modules across features: `api/search/retraction-service.ts:2` (-> library, a folder cycle), `api/chat/understand-wire.ts:12`, `api/chat/claim-check.ts:7`, `api/litscan/model.ts:2`, `api/litscan/stub.ts:4`, `api/mcp/server.ts:15` [cc][feat][chat]
- embedder chosen three times: `api/oa/workflow.ts:30`, `api/docs/routes.ts:132-133`, `api/idea/routes.ts:63` [svc][feat][cc]
- test-only parameters: `api/chat/routes.ts:170` timeoutMs, `:183` onUsage (dev routes /judge, /route) become dev profiles in F8 [chat]
- `web/workspace/ChatView.tsx:94-101` an e2e-only knob in production code [wc]

Special cases removed: the nine dev-route `if`s; the stub branch in routes; every per-service "1 second under the stand-in"; `stubbed()` helpers in route files.
Risk: production must never reach a stand-in; test mode must reach every stand-in it reaches today. Keep identical: a test that builds the app with a production env and asserts no `/api/v1/dev/*` route answers and no `testing/` module is in the call graph (static check on `app/stand-ins.ts` being the only importer); integration (every API suite runs on stand-ins, so they prove the stand-ins still fire) plus the switch matrix; `npm run eval`. Size: **L**.

### F8. One model port in platform/llm

Design: `api/platform/llm/port.ts` holds the binding-free contract (`Complete`, `StreamComplete`, `ModelProfile`, failure kinds) so `understand/` may import it under legal-match rule 3. `profiles.ts` names every model use once (`route`, `understand`, `chatReply`, `write`, `judge`, `strict`, `docsAsk`, `ideaPlan`, `ideaCompare`, `ideaInsights`, `litscanPlan`, `litscanJudge`, and the dev profiles of `/judge` and `/route`) with today's exact task, sensitivity, timeout and token numbers. `modelFor(deps, profile, subject, abort)` returns the real or stand-in model (from F7). `withMalformedRetry(call, {onlyIfNothingShown})` is the one "ask once more" loop. `failure.ts` holds `classifyFailure(e)` (malformed, timeout, quota, no route, down), `attemptsForLog(e)` and `problemFor(e, words)`, where each surface passes its own words so nothing a person reads changes. `workers-ai.ts` `runWorkersAi(model, body, signal, privacy)` is used by the provider and by OCR (privacy enforced by the call, not a comment). One embedder. Dev model overrides are one map. litscan asks the gateway for the remaining allowance instead of recomputing it.

Problems:
- the contract in a docs file: `api/docs/qa.ts:10-16`, imported by 24 production modules, e.g. `api/chat/routes.ts:5`, `api/chat/router.ts:24`, `api/chat/general.ts:2`, `api/chat/answer.ts:7`, `api/chat/support.ts:2`, `api/understand/understand.ts:2`, `api/understand/chat-reply.ts:1` [chat][feat]
- 14 adapters differing only in task/timeout/tokens: `api/chat/routes.ts:157`, `:161-187`, `:170`, `:183`, `:1034` (= `api/chat/claim-check.ts:67`), `api/chat/claim-check.ts:71`, `api/chat/understand-wire.ts:28`, `:31-40`, `:37`, `api/docs/routes.ts:135-153`, `api/idea/routes.ts:43-61`, `:53` (stub and timeoutMs for one caller `:196`), `api/litscan/model.ts:30-60` [chat][feat]
- five retry loops: `api/chat/router.ts:95`, `:415`, `api/chat/answer.ts:230`, `:243`, `api/chat/general.ts:97`, `api/understand/understand.ts:347` [chat]
- three error classifiers: `api/chat/malformed.ts:7-8`, `api/chat/history.ts:88`, `api/understand/understand.ts:292`, `:298`; three attempt logs `api/chat/router.ts:102`, `:421`, `api/chat/routes.ts:939`; `errorKind` imported from the history parser at `api/chat/router.ts:27`, `api/chat/routes.ts:18` [chat]
- five model-error mappings: `api/docs/routes.ts:156`, `api/idea/routes.ts:90-96`, `:165-173`, `:211-219`, `api/litscan/routes.ts:85-91`, `api/index.ts:211` [feat]
- model wiring exported from a route file: `api/docs/routes.ts:47`, imported by `api/chat/routes.ts:47`, `api/oa/service.ts:3`, `api/oa/routes.ts:4`, `api/mcp/server.ts:10` (depgraph 7: 2 flagged edges) [feat][svc][cc]
- one timeout and one read limit in two files: `api/chat/understand-wire.ts:23` / `api/understand/understand.ts:24`; `api/chat/router.ts:37` / `api/understand/understand.ts:26` [chat]
- `api/litscan/routes.ts:120-121` recomputes the daily quota from DEFAULT_CONFIG and d1Ledger [feat]
- Workers AI outside the gateway: `api/ocr/read.ts:3-6`, `:35-46`; casts and two usage reads `api/llm/providers/workersai.ts:130-131`, `:137-139`, `:144`, `:150` (bug B25) [svc]
- one override per feature: `api/llm/index.ts:14-24`, `:34-41`; `api/llm/types.ts:10` TaskKind names features [svc]
- two promise-vs-timer races: `api/understand/understand.ts:354`, `api/understand/flags.ts:113` (one `withTimeout` in platform) [chat]

Special cases removed: the `stub`/`timeoutMs`/`onUsage` parameters; `api/ocr/read.ts:46` own retry (kept as the OCR profile's policy, same numbers); three override blocks.
Risk: the prompt, model, timeout and tokens of every call must be identical. Keep identical: a table test that, for each profile, compares the gateway request built today and after (captured once before the change, deleted in the tests pass); goldens; legal-match (port.ts binding-free); `npm run eval` (claim and understand replays key on model+system+user, so any change is a missing recording); integration with the switch matrix. Size: **L**.

### F9. One wire contract: problem types, stream tables, and one browser client

Design: server and browser share `protocol/problem.ts` (`Problem`, `ProblemType`) and `protocol/streams.ts`: for each stream the event union, the kind of each event, the terminal set (derived from kind "end"), one error event type and the fallback, and progress fields typed as keys of the event. `sseStream(c, STREAMS.chat, run)` takes terminal and fallback from the table. The page-made `unfinished` notice is a page kind, not a server kind. On the web, `lib/api/client.ts` (`api<T>()`, one `ApiError` carrying the problem's fields), `lib/api/stream.ts` (`postStream`, `readSse` that skips only malformed JSON and lets a handler's throw reach the caller, `perFrame` batcher with the shared endings: cut_off, stopped, connection lost) and `lib/api/retry.ts` (retry honouring Retry-After, one abortable sleep). Each call site keeps today's retry numbers as a named policy. If the old `/?q=` page stays (6.1), its stream moves onto `sseStream` with its own table entry; if it goes, the stream goes.

Problems:
- terminal events and fallback restated per route: `api/chat/routes.ts:370`, `api/docs/routes.ts:558`, `api/idea/routes.ts:115`, `:153`, `:199`, `api/litscan/routes.ts:189`, `api/oa/routes.ts:61`; "Something went wrong" 14 times (`api/chat/routes.ts:370`, `:488`, `:956`, `api/docs/routes.ts:558`, `:569`, ...); `api/sse.ts:24` takes `terminal` untied to the table [sh][cc]
- `shared/stream-shape.ts:81-86` used only by tests, `:82` restates `:33-52`, `:83` hand copy of `shared/oa.ts:103-112`; `:112`, `:120` one-stream rules inside the checker [sh]
- error event retyped: `shared/chat.ts:130`, `shared/documents.ts:81`, `shared/idea.ts:68`, `:131`, `:187`, `shared/litscan.ts:100`, `shared/chat-tools.ts:33` [sh]
- adding a chat event touches 9 places, only one checked by the compiler (`shared/chat-state.ts:124` default case, `:175`, `api/chat/stub.ts`, `shared/chat-tools.ts:55`) [sh]
- the search stream skips the rules: `api/index.ts:168-189`; `web/lib/search.ts:52-93` the only EventSource, named events `:56`, `:67`, `:89`, `:92` unguarded parse [feat][wl]
- web terminal handling per stream: `web/lib/documents.ts:30-50`, `:41-42`, `web/lib/idea.ts:23-40`, `:31-32`, `:43-60`, `:52-53`, `:63-80`, `:72-73`, `web/lib/litscan.ts:127-129` [sh][wl]
- `web/lib/sse.ts:15-19` swallows handler errors (bug B1) [sh][wl]
- per-frame queues: `web/lib/oa-ask.ts:99-133`, `web/lib/chat.ts:664-712`; `web/lib/oa-ask.ts:70-81` reduceTurn untested [wl]
- request helpers and problem parsing: `web/lib/docs-api.ts:9-16`, `:10`, `:12-13`, `:18`, `web/lib/idea.ts:8`, `:10-13`, `web/lib/litscan.ts:7`, `:16-19`, `web/lib/library.ts:34-39`, `web/lib/feedback.ts:20-21`, `web/lib/legal.ts:37-39`, `web/lib/notes.ts:11-14`, `web/lib/documents.ts:32-35`, `:195-200`, `web/lib/oa-ask.ts:116-118` [wl]
- status words per module: `web/lib/chat.ts:690-693`, `:784-787`, `web/lib/verify.ts:39-42`, `web/lib/oa-ask.ts:117-118`, `web/lib/library.ts:151` [wl]
- `ApiError` from the upload module: `web/lib/documents.ts:12` re-export, imported by `web/lib/feedback.ts:2`, `web/lib/legal.ts:2`, `web/lib/idea.ts:2`, `web/lib/litscan.ts:3`, `web/lib/notes.ts:3`; `web/lib/scan.ts:13` another path [wl]
- problem types known only as literals: `web/lib/chat.ts:682-688` (`api/chat/routes.ts:343`, `:358`, `:991`), `web/lib/scan.ts:155` (`api/docs/routes.ts:522`), `web/lib/documents.ts:358` (`api/idempotency.ts:52`), `web/lib/litscan.ts:18` (`api/litscan/routes.ts:116`); `web/lib/litscan.ts:10-14` ScanRunningError [wl][cc]
- `web/lib/verify.ts:92` retry decided by message text (bug B2) [wl]
- sleeps and retries: `web/lib/litscan.ts:90`, `:148`, `web/lib/verify.ts:46-50`, `:78-98`, `web/lib/scan.ts:98-102`, `:155-167`, `web/lib/feedback.ts:11-17`, `web/lib/documents.ts:228-234`, `:241-245`, `:354-362`, `web/lib/ink.ts:152` [wl]
- contract literals: `web/lib/oa-ask.ts:118` words of `api/chat/routes.ts:525`, `api/ratelimit.ts:29`; `web/components/admin/AdminMcp.tsx:3` re-declares `api/mcp/calls.ts:32`; `web/components/admin/AdminOps.tsx:245`, `:255`, `:265`, `:343` vs `api/admin/routes.ts:91`, `:106`, `:132`; Idempotency-Key at `web/lib/documents.ts:191`, `web/lib/feedback.ts:13`, `api/docs/routes.ts:265`, `api/feedback/routes.ts:31` [cc]
- inline problem replies (47) instead of `deny`: `api/account/routes.ts:21`, `:119`, `:121`, `:123`, `:130`, `:132`, `:134`, `api/admin/routes.ts:101`, `:117`, `:121`, `:123`, `:125`, `:126`, `:127`, `:140`, `:152`, `api/auth/routes.ts:35`, `:43`, 17 in `api/index.ts`, `api/chat/routes.ts:1058` [feat]
- `workspace/ChatTool.tsx:59` its own fetch to /api/v1/references/verify (moves to the client; its words stay) [wc]
- the test scripts' SSE readers (H5) reuse `readSse` (done in F24) [ti]

Special cases removed: ScanRunningError; four 401/403/429 `if`s (one status-to-words map per surface, same words); the ingest and litscan `if`s in the checker (table entries); the retry `if`s.
Risk: the wire. Keep identical: every API and browser suite already runs the stream-shape check on what it reads; add a byte comparison of recorded streams before/after for chat (goldens), ask, idea, litscan; budget (lib/api is first-load: must not grow); browser suites (chat, litscan, idea, papers, oa). Behaviour changes only at bugs B1-B3. Size: **L**.

### F10. Request guards, body limits and rate buckets declared where routes mount

Design: Hono middleware in `api/platform/http/guards.ts`: same-origin is checked for every non-GET `/api/*` request by default, with an explicit list of the routes that skip it today (taken from the code before the change, so nothing that works now is refused); `requireUser({ack?, owns?})` returns the user (and the owned row) or answers with `deny`; `readJson(c, maxBytes)` for every JSON body (one size check, header and body); each router is mounted with its rate bucket (`api/app/mount.ts`), so `api/ratelimit.ts` keeps the mechanism and loses the path list; MCP uses the same limiter call. `deny()` is typed by `ProblemType`.

Problems:
- `sameOrigin(c)` called by hand 43 times in 14 files (a forgotten call is a CSRF hole) [feat]
- `api/docs/routes.ts:168-778` 27 routes repeat sameOrigin + currentUser + owned + three deny; `api/docs/routes.ts:262` privacy-ack rule [feat]
- `api/litscan/routes.ts:52-60` own requireUser/needsAck; `:161-163`, `:179-182`, `:228-231`, `:248-251`, `:264-266`, `:274-277` ID.test + getScan + 404 seven times [feat]
- `api/admin/routes.ts:26` admin() returns null; `api/idea/routes.ts:72-75`, `:75`, `:108-110`, `:141-144`, `:144`, `:186-189`, `:189` [feat]
- body limits: `api/chat/routes.ts:197` used by `/` and `/route`, not by `:1013` (/judge) and `:1059` (/tighten, bug B7); double size checks `api/docs/routes.ts:267`/`:273`, `:501`/`:503`, `:690`/`:692` [chat][feat]
- `api/ratelimit.ts:15-23` path list (7 of 8 commits add a route); `api/mcp/server.ts:101-114` own per-minute limiter [feat][cc]
- `api/mcp/oauth.ts:68-77` own security headers beside `api/middleware.ts:5-13` [feat]
- `api/auth/http.ts:23` untyped context (with F5) [feat]

Special cases removed: per-route guard lines; the path list.
Risk: security. Keep identical: before the change, write a route-guard table test from the current code (every non-GET route -> {sameOrigin, user, ack, owns}); it must hold after. `api/middleware.test.ts`, `api/ratelimit.test.ts`, integration (`scripts/auth-e2e.mjs` covers CSRF and PKCE), statuses and words unchanged. Size: **M**.

### F11. One client per external service, one polite-call policy, the gate passed in

Design: `api/platform/services/<name>.ts` for Crossref, OpenAlex, arXiv, doi.org, CORE, DOAJ, Semantic Scholar, PubMed and Europe PMC. Each owns its base URL, its identity (the User-Agent strings sent today are kept per purpose until 6.6 decides), key, lane settings (moved out of `GATES`), one record type and mapper, and `politeFetch` (timeout, Retry-After parsed once with the one-day clamp, a typed `UpstreamError {service, status, busy, retryAfterMs}`, the retry numbers it has today). `fetch` comes from deps (F7). The gate is built per entry by `withPlatform(env, ctx, run)` used by the Worker's fetch, scheduled and queue handlers and every Workflow, so there is no module global; the local lane applies the same wait cap as the Durable Object. Semantic Scholar becomes a lane (retiring its Durable Object is 6.7). litscan limits its own concurrency instead of owning a service lane. One `mapLimit` and one abortable `sleep` in platform. This ends the search <-> references folder cycle.

Problems:
- search and references import each other: `api/search/crossref.ts:1`, `api/search/retraction.ts:3`, `api/search/doi-check.ts:3-5` and `api/references/lookup.ts:4`, `api/references/service.ts:2`, `api/references/verify.ts:2`; git: `references/lookup.ts` changed with `search/retraction.ts` 4 times [svc][cc]
- `api/references/crossref-gate.ts` is everyone's Crossref lane; `api/library/retraction.ts:1` imports LOOKUP_GATE_WAIT_MS from it [svc]
- `api/oa/sources.ts:2`, `api/oa/service.ts:10` reach into search internals [svc]
- identities: `api/search/crossref.ts:8-10`, `api/references/lookup.ts:39`, `api/oa/deps.ts:18`, `api/trending/arxiv.ts:70` [svc][feat]
- CRItem twice (`api/search/crossref.ts:12`, `api/references/lookup.ts:41`), author join twice (`:50`, `:65`) [svc]
- four OpenAlex clients: `api/search/openalex.ts:10`, `:66`, `:81`, `:96`, `:109`; `api/search/india.ts:122`, `:184`, `:120` (SELECT copy of `api/search/openalex.ts:8`), `:150` (toIndiaPapers copy of `api/search/openalex.ts:24`); `api/references/lookup.ts:149`, `:178`, `:199`; `api/oa/sources.ts:101`, `:125` [svc]
- arXiv Atom parsed twice: `api/search/arxiv.ts:23`, `:33`, `api/oa/sources.ts:87-92` [svc]
- missing key means two things: `api/search/core.ts:120` vs `api/search/s2.ts:29` (kept, named per client) [svc]
- two limiters for one job: `api/search/env.ts:25`, `api/search/s2.ts:35-39`, `api/s2-throttle.ts`, `api/search/types.ts:18` [svc]
- retry-after read three times and the one-day clamp twice: `api/search/core.ts:129-133`, `:132`, `api/search/india.ts:86-88`, `api/references/crossref-gate.ts:26`, `api/gate/api-gate.ts:38` [svc]
- error text as protocol: `api/library/retraction.ts:51-53` / `api/search/retraction.ts:39`; `api/search/core.ts:137-141` / `api/idea/search.ts:122`; `api/references/crossref-gate.ts:32` fake 429; `api/litscan/worker.ts:49` `/not configured/`; `api/mcp/server.ts:388` `/allowance/` from `api/mcp/tools.ts:540` [svc][feat]
- fetch injected three ways: `api/search/doi-check.ts:39`, `api/search/retraction.ts:6`, `:38`, `api/references/lookup.ts:15`, `:37`; dropped at `api/references/verify.ts:51` (bug B9) [svc]
- retries: `api/search/s2.ts:44-46`, `api/references/crossref-gate.ts:56-58`, `api/idea/search.ts:117-126`, `api/trending/sources.ts:74-109`, `:92`, `:107`, `api/docs/embed.ts:15` [svc][feat]
- arXiv pacing in three places: `api/gate/index.ts:17`, `api/idea/search.ts:42`, `:211`, `api/trending/job.ts:123` [feat]
- bounded concurrency three times: `api/idea/search.ts:129`, `api/mcp/server.ts:130`, `api/trending/sources.ts:122`; `api/chat/tools.ts:129`, `:131` copy `api/mcp/server.ts:92`, `:130` [feat][chat]
- sleep defined seven times: `api/search/s2.ts:19`, `api/references/crossref-gate.ts:23`, `api/oa/service.ts:85`, `api/oa/stub.ts:19`, `api/gate/index.ts:41`, `api/gate/api-gate.ts:21`, `api/cache/meter.ts:22` [svc]
- the gate as module globals: `api/gate/index.ts:44-48`, `:51`; installGates at `api/index.ts:87`, `:363`, `:373`, `api/litscan/workflow.ts:30`, `api/oa/routes.ts:19`, `api/oa/workflow.ts:45`; `api/index.ts:92-96` swallowed context error [svc][feat]
- feature tuning in the stable gate: `api/gate/index.ts:10-24`, `:21` (a lane named after litscan) [svc]
- `api/gate/api-gate.ts:31` vs `api/gate/index.ts:87`, `:94` (bug B8); `api/gate/index.ts:88-95`, `:105` fallback and release swallow (kept, decided once) [svc]
- `api/oa/sources.ts:45`, `:67`, `:83`, `:104`, `:128`, `:155` `deps.gated ?? passThrough` six times [svc]
- `api/trending/job.ts:636` the illegal-invocation fetch wrapper (an outside-world workaround: kept with its comment, in one place) [feat]

Special cases removed: `api/search/s2.ts:44-46` sleep only without a gate; the fake 429 Response; four message-text regexes; six `?? passThrough`; the per-entry installGates calls.
Risk: what is sent to other services must not change (URL, headers, pacing). Keep identical: `npm run eval` in replay (any changed URL is a missing recording; add a check that recorded request headers match); a unit test per client with the request it builds for a fixed input (captured before); integration (gate-e2e, retraction-e2e, cache-e2e); production pacing numbers copied from `GATES`. Size: **L**.

### F12. Search as one API, with a fixed DOI-facts step and one cache primitive

Design: `api/platform/cache/remember.ts`: `remember(store, ns, parts, ttlOf(answer), load)` builds the key, the meter source and the stored label from one namespace (each namespace reproduces today's key string exactly, so nothing is invalidated), shares identical calls in flight, treats a failing store as a miss; `rememberMany(store, ns, ids, loadMissing)` is the per-DOI pattern. `api/search/doi-facts.ts` runs the DOI check THEN the retraction check, with one batch size (40) and one `RETRACTION_SOURCE` constant, for search, idea, the chat ledger resolver, MCP, references and the nightly library job. `api/search/api.ts`: `searchSources(deps, sources, queries, {perSource, verify})` returns merged, checked papers and the status of each source; `byDois(dois)` serves the chat ledger resolver. Sources declare their keys and lanes, so `SearchEnv` stops collecting callers' needs. Idea-only sources (CORE, arXiv, openalexForIdea, openalexSemantic) move to `api/idea/sources/`. The India scope is a source set that chat passes. Service objects export each function once.

Problems:
- the call order: `api/search/index.ts:152` says retraction after DOI check; `api/idea/search.ts:263-264` follows it; `api/chat/understand-wire.ts:163` runs both at once (bug B4) [svc]
- the workaround `api/search/doi-check.ts:120-121` and its test `api/search/doi-check.test.ts:56-65`, `:58` [svc]
- per-DOI cache twice: `api/search/retraction.ts:64-88`, `api/search/doi-check.ts:72-101` [svc]
- batch size 40 twice: `api/search/retraction-service.ts:49`, `:76`, `api/library/retraction.ts:17` [svc]
- "crossref-retraction-watch" written out: `api/search/index.ts:83-84`, `api/search/doi-check.ts:120`, `api/library/service.ts:13`; overlay `api/library/service.ts:16-17` [svc]
- retraction failures swallowed three ways: `api/search/retraction-service.ts:29-31`, `:56-58`, `:63`, `api/references/verify.ts:53-55` (one documented "unknown") [svc]
- `api/search/cache.ts` (generic) lives in search, used by `api/references/lookup.ts:4`, `api/references/service.ts:2`, `api/chat/understand-wire.ts:6` [svc]
- `api/references/service.ts:33-51` hand copy of cached() without in-flight sharing (bug B23) [svc]
- labels that disagree with keys: `api/references/service.ts:37` vs `:48`, `api/llm/gateway.ts:75`, `api/chat/understand-wire.ts:159-160`; `api/cache/meter.ts:11` parses the key shape of `api/search/cache.ts:13` (bug B24) [svc]
- `api/llm/types.ts:94-97` ResponseCache copies `api/cache/store.ts:6-12`; `api/cache/index.ts:5-7` re-exports everything (17 deep imports of `cache/store`) [svc]
- search internals used to build other pipelines: `api/search/index.ts:45`, `:61`, `:74` exported; `api/idea/search.ts:16-23`; `api/chat/understand-wire.ts:5-10`; `api/search/index.ts:25` PER_PROVIDER fixed; `api/search/service.ts:2`, `api/trending/job.ts:22` -> `search/index.ts` (depgraph 7: 6 edges); `api/search/types.ts` 12 flagged stable importers [svc][feat][chat][cc]
- `api/search/types.ts:10` (CORE key for Idea Check only), `:18` (s2Gate) in the general env [svc]
- Idea sources living in search: `api/search/openalex.ts:57-113`, `api/search/core.ts`, `api/search/arxiv.ts` (git: openalex.ts changes with idea/search.ts and idea/stub.ts) [svc]
- `api/search/india.ts` changes with `api/chat/answer.ts` 3 of 3; `:168` thesis option for one caller (`:197`), `:38` keepPlaces for one caller (`:114`) [svc]
- `api/search/index.ts:141` variant failure reported ok (bug B22); `:66` magic `+ 4000` [svc]
- doubled service exports: `api/search/service.ts:34`, `api/search/retraction-service.ts:78`, `api/references/service.ts:59`, `api/oa/service.ts:241`, `api/library/service.ts:59` [svc]
- `api/understand/tiers.ts:2` and litscan import the relevance rule from `api/litscan/relevance.ts` (moves to `api/search/relevance.ts`) [chat]
- `api/chat/complete.ts:7` a search rule (OPTIONAL_SOURCES) in a shallow chat module [chat]
- `api/understand/chat-reply.ts:19`, `:123` hard-code the source list (read from the source registry) [chat]
- `api/mcp/server.ts:172` and `api/chat/tools.ts:27` (MAX_CHAT_RETRACTION_DOIS copies the MCP limit by comment) [chat][feat]
- test stand-in globals: `api/library/retraction-stub.ts:8` `stubCrossrefCalls` read by `api/library/retraction.test.ts:29`, `:82-85`, `:134` [svc]

Special cases removed: the doi-check workaround and its test; the magic offset (a named per-source timeout with the same value); `findRetracted`; the two option parameters for one caller (a source set and a source flag).
Risk: search results and cache keys. Keep identical: `npm run eval` (eval, plain-text, prior-art, mcp gates: same numbers); goldens; a test pinning each namespace's key string to today's (deleted in the tests pass); integration (cache-e2e, retraction-e2e, idea, chat). Behaviour changes only at bugs B4, B22-B24. Size: **L**.

### F13. Feature services, storage helpers and one base URL

Design: every feature exposes `service.ts`; routes only mount handlers; SQL lives in each feature's `store.ts`. `docs/service.ts`: `listReady(userId)`, `ask(...)`, `deleteDocument`, the embed-and-retrieve step (once), "save the answer and count it" (once), and `docs/store.ts` functions that OCR uses to write chunks and document state. `platform/db`: `insertRows(db, table, cols, rows)` chunked by D1's bound-value limit; `dailyAllowance(db, table).take/refund`; `time.ts` the only SQLite time helper (both directions, the clamp variant); `ids.ts` (randomId, newToken, sha256Hex, today). Library SQL moves into `library/service.ts`. oa keeps the fetched format on its row (a migration adds `oa_papers.format`; reading falls back to today's rule for old rows), the 30-day constant is named, and one helper starts or joins a Workflow instance. `platform/config.ts` gives one public base URL and the auth start URL. Sentry takes `release` from the env.

Problems:
- docs SQL copied in chat: `api/chat/routes.ts:475-481` vs `api/docs/routes.ts:551-563`, `api/chat/routes.ts:681` [chat]
- docs internals used by other features through the route file: `api/docs/routes.ts:132`, `:145`, `:156`, `:344` imported by `api/chat/routes.ts:47`, `api/mcp/server.ts:10`, `api/oa/routes.ts:4`, `api/oa/service.ts:3`, `api/account/erase.ts:1` [cc][feat]
- docs internals copied: `api/docs/qa.ts:125-131` / `:154-161` (embed + retrieve), `api/docs/routes.ts:563-564` / `:586-587` (save + count) [feat]
- ocr writes docs tables: `api/ocr/process.ts:74`, `:88-90`, `:182-188`; ocr <-> docs folder cycle `api/ocr/process.ts:2-4` / `api/docs/routes.ts:51-54` [svc][cc]
- D1's limit by hand: `api/cache/store.ts:32`, `api/oa/store.ts:105`, `api/ocr/process.ts:67`, `:172`; copied insert `api/ocr/process.ts:172-181` / `api/oa/store.ts:104-117` [svc]
- daily allowance twice: `api/oa/store.ts:171-175`, `api/ocr/process.ts:96-103`; "today" at `api/oa/service.ts:86`, `api/ocr/process.ts:12`, `api/litscan/routes.ts:42`, `api/mcp/calls.ts:15`, `api/trending/job.ts:165`, `api/account/routes.ts:113` [svc][feat]
- SQLite time: `api/library/validate.ts:84`, `:89` imported by `api/jobs.ts:2`, `api/docs/routes.ts:43`, `api/account/routes.ts:6`, `api/litscan/routes.ts:27`, `api/litscan/store.ts:2`, `api/litscan/share.ts:2`; inline copies `api/idempotency.ts:84`, `api/admin/integrity.ts:97`, `api/admin/routes.ts:66`, `api/oa/store.ts:36`; `api/sql-time.ts:2` one direction; `api/oa/refresh.test.ts:12` [svc][feat][cc]
- ids and hashes: randomId at `api/docs/routes.ts:99`, `api/feedback/routes.ts:16`, `api/monitoring/sentry.ts:76`, `api/chat/routes.ts:477`; base64url token `api/auth/oauth.ts:3-8` = `api/litscan/share.ts:11-16`, `api/mcp/tools.ts:81`; SHA-256 `api/hash.ts:2`, `api/idempotency.ts:100-103`, `api/auth/oauth.ts:14`, `api/oa/ingest.ts:51`, `api/oa/store.ts:39` [feat][svc]
- library SQL in routes: `api/library/routes.ts:29-38`, `:54-65`, `:68-99`, `:77` (copies `api/library/service.ts:49`) [svc]
- oa: `api/oa/ingest.ts:90` format guessed from source name (known at `:61`, `:75`); `api/oa/store.ts:168` hard-coded 30; `api/oa/service.ts:66`, `:132` regex on "already exists" [svc]
- `api/oa/service.ts:11` imports `OaParams` from the Workflow entry (pulls `cloudflare:workers`) [svc]
- base URL three ways: `api/auth/routes.ts:14`, `api/mcp/scopes.ts:26-32`, `api/mcp/apps.ts:66` (bug B21); `api/mcp/oauth.ts:116` copies the auth start URL (`api/auth/routes.ts:15`, `:41`) [feat]
- root folder mixes leaves and composition: `api/maintenance.ts:1` -> `api/litscan/store.ts`; `api/library/routes.ts:5` -> `api/problem.ts`; `api/jobs.ts:2` -> library, `:3` -> monitoring (depgraph 2c pairs) [cc][feat]
- `api/admin/routes.ts:3`, `:65` prices OCR itself from `NEURON_CENTS` (ask llm/pricing) [feat]
- `api/admin/integrity.ts:13`, `:81` copy the R2 key layout of `api/docs/routes.ts:100-101`; `api/feedback/routes.ts:47` reads doc_qa/documents [feat]
- `api/references/service.ts:5` -> `references/lookup.ts` type (depgraph 7) [cc]
- `api/monitoring/sentry.ts:250` release from callers; `api/index.ts:346`, `:379` pass it, `api/account/erase.ts:28`, `api/admin/routes.ts:91`, `:106`, `:132` do not (bug B26, 6.9) [feat]
- `api/auth/oauth.ts:38` `if (def.id === "google")` adds `prompt=select_account` (a provider field) [feat]
- `api/auth/oauth.ts:1` <-> `api/auth/providers.ts:1` type cycle (types to one module) [cc]
- `api/mcp/pages.ts:19-20` copies web colour tokens (kept; the MCP page cannot load the web CSS; a comment says so, a test compares to `web/styles/tokens.css`) [feat]

Special cases removed: the google `if`; the two "already exists" regexes; the hard-coded 30; the hand batch sizes.
Risk: SQL and R2 keys. Keep identical: `api/scale.test.ts` (query plans) on the moved queries; `testD1`-based store tests; integration (docs-e2e, oa-e2e, scan-e2e, library-e2e, feedback-e2e, mcp-e2e); the migration is additive. Size: **L**.

### F14. One answering engine for chat and litscan

Design: `api/answering/` (from `chat/`): `evidence.ts` owns `Picked`, `paperBlock(picked)` (the format the writer and the judge must agree on), `keepMarks(text, set)`, `paperFromInput({n, title, year, abstract})`; `writer.ts` (answer.ts) and `judge.ts` (support.ts) import evidence and no longer import each other; `judgeClaims(claims, picked, profile)` is the judge's public entry, used by claim-check and /tighten; the mark policy is one object chosen by "judged or not". litscan and chat import `answering/`.

Problems:
- paper block twice: `api/chat/answer.ts:91` / `api/chat/support.ts:126` [chat]
- mark removal twice: `api/chat/answer.ts:183` / `api/chat/support.ts:182` [chat]
- type cycle: `api/chat/support.ts:3` <-> `api/chat/answer.ts:5` (depgraph 2b) [chat][cc]
- `Paper` literals: `api/chat/routes.ts:1019`, `api/chat/tighten.ts:31`, `api/chat/claim-check.ts:34` (also `web/components/verify/RefCard.tsx:13`, `web/lib/citeStatus.ts:38`: one `paperFrom(partial)` in shared, used by both apps) [chat][cc]
- `api/chat/claim-check.ts:4`, `:6` reassemble the judge from its parts; `api/chat/tighten.ts:2` imports writer types (depgraph 7) [chat][cc]
- `api/chat/answer.ts:70` keep param for R9, `:159` addMissingMarks, `:254` (the fallback stays as the policy's rule), `:153` re-export for a test [chat]
- `api/litscan/worker.ts:2` takes the engine from `chat/answer` [feat]

Special cases removed: the `addMissingMarks` and `keep` parameters (one policy object); the re-export.
Risk: prompts. Keep identical: goldens, `api/chat/support*.test.ts`, `api/chat/answer*.test.ts` (rewritten in the tests pass), `npm run eval` (claim gates), integration chat and litscan suites. Size: **M**.

### F15. One per-person data registry

Design: each feature declares `PERSONAL_DATA` in its `personal-data.ts`: table, the column that names the person, retention, erase order, export shape (built from the feature's own `store.ts` query), and an optional admin count. `api/app/personal-data.ts` lists them; account erasure, `/account/export`, maintenance retention, `/admin/overview` counts and the integration reset iterate the list. litscan's purges are named, not positional. A test reads `apps/api/migrations/*.sql`, finds every table with a person column (`user_id`, `subject`, `owner`) and fails unless it is in the registry or listed as kept on purpose with a reason (where `llm_usage` lands depends on 6.2).

Problems:
- `api/account/erase.ts:37-55` 16 tables of 7 features by hand (8 of 27 migration commits touched it); `api/account/erase.ts:1` imports `deleteDocument` from `api/docs/routes.ts` [feat]
- `api/account/routes.ts:19-115` export queries 12 tables of 5 features (12 of 27 migration commits); `:38` copies the tags sub-select of `api/docs/routes.ts:91` (COLS; `:90-91` leaves `info` out, so `:222-223` queries twice) [feat]
- `api/maintenance.ts:8-34` central retention list (12 of 27); `:30` litscan purges by array position vs `api/litscan/store.ts:172-177`; `:53-56` options for tests only [feat]
- `api/litscan/store.ts:160` (deleteScan) vs `api/account/erase.ts:40-42` [feat]
- `api/docs/routes.ts:344-355` knows the doc_* tables, so do `api/account/routes.ts:37-63`, `api/admin/integrity.ts:13` [feat]
- `api/admin/routes.ts:37-54` queries six features' tables; `:45` copies the oa ingest states; `:49`, `:52`, `:53` swallowed [feat]
- `api/auth/routes.ts:56` purges oauth_states like `api/maintenance.ts:11` [feat]
- `llm_usage.subject` (`apps/api/migrations/0002_llm_usage.sql:2`) not in the erase list, undocumented (6.2) [feat]
- `scripts/integration.mjs:99` hand list of 10 account tables [ti] H14
- `api/account/erase.test.ts:26-52` regex-on-SQL fake DB (rewritten on testD1 here: it is the regression net of this fix) [feat]

Special cases removed: the positional litscan purge; the per-feature branches in erase, export and admin.
Risk: privacy. Keep identical: before the change, a testD1 test seeds one person in every table and records (a) the rows left after erase, (b) the export JSON, (c) what each maintenance purge removes; all three must be identical after. legal-text; integration (account export and deletion in auth-e2e and ops-e2e). Size: **L**.

### F16. Understand in one folder; prompts own their readers; test doubles leave production source

Design: `chat/understand-wire.ts` is taken apart: model profiles to F8, the DOI resolver to `searchService.byDois` (F12), the visitor cap to `understand/visitor-cap.ts`, stand-ins to `understand/testing/`. `understandTurn` returns the guard verdict it computed. Intents and caps come from shared (F4); the confidence bands are exported once; the Thinking sentences live only in `chat/think.ts`. The unwired R11 `scrub` hook and the unreachable guard branches go. Each prompt module exports its builder and a matching reader (router message block and turns, ledger lines, judge claim lines, writer question/paper lines, reply language); stand-ins parse prompts only through those readers. Fixtures (`chat/clean-cases.ts`, `understand/hostile-messages.ts`, `trending/fake-kv.ts`) move beside the tests as `*.fixture.ts` (legal-match's NO_FUNCTION_TO_CALL entry follows).

Problems:
- `api/chat/understand-wire.ts:28-197` four concerns; `api/chat/routes.ts:568-670` orchestration in the route [chat]
- guards twice: `api/chat/routes.ts:577`, `:656`, `api/understand/understand.ts:336` [chat]
- callers repeat preconditions: `api/chat/routes.ts:550` (`api/understand/lane.ts:415`), `:696` and `:244` (`api/understand/frame.ts:494-495`) [chat]
- `api/understand/guards.ts:26-27`, `:36`, `:61`, `api/understand/understand.ts:127` unwired scrub; `api/understand/guards.ts:50-52` unreachable; their tests `api/understand/guards.test.ts:17-25`, `:40-44` [chat]
- Thinking sentences twice: `api/chat/think.ts:50`, `:57`, `:152` vs `api/understand/understand.ts:404`, `:409` [chat]
- `api/understand/` holds the general switch reader (done in F6) and five releases; `api/understand/input-shape.ts:16` names from other releases (done in F4) [chat]
- stand-ins parse prompts by hand: `api/chat/stub-route.ts:24`, `:45` (built at `api/chat/router.ts:71`, `:176`), `api/chat/understand-wire.ts:58` (`api/understand/ledger-input.ts:150-156`), `:129` (`api/understand/chat-reply.ts:34`), `api/chat/stub.ts:98-99` (`api/chat/answer.ts:92`), `:135`, `:154` (`api/chat/support.ts:127`) [chat]
- `failedWith` twice: `api/chat/stub-route.ts:5`, `api/chat/understand-wire.ts:47`; `api/chat/stub.ts:3` imports gateway internal `extractJson` [chat]
- stub sleeps: `api/chat/stub.ts:121`, `:124`, `:138`, `:157`, `api/chat/tools-stub.ts:11` (kept inside the stand-ins, out of production paths) [chat]
- fixtures in src: `api/chat/clean-cases.ts:1-2`, `api/understand/hostile-messages.ts:1`, `:7`, `api/trending/fake-kv.ts:1` (depgraph 4b) [chat][cc]
- `api/chat/routes.ts:5-9` (understand-wire) reaches into search internals (with F12) [chat]
- `api/understand/lane-text.ts:103`, `:113`, `:117-118` `searched` applied by regex surgery on the finished sentence (the lane builds the sentence from parts) [chat]
- `api/understand/understand.ts:202-203` Devanagari queries dropped then replaced (kept: a real requirement, named) [chat]

Special cases removed: the second guards call; the scrub hook; the regex surgery; the stand-ins' prompt parsing.
Risk: legal-match rule 3 (the moved modules stay network-free; visitor-cap uses storage, which the rule allows). Keep identical: goldens (`since-year.understand.golden.json`), `npm run eval` (understand, understand-route, frame, tiers), integration with `CHAT_UNDERSTAND:on`. Size: **M**.

### F17. A chat reply is a pipeline of stages over one Turn

Design: `api/chat/turn/` gets one file per stage (request, safety, understand, route, offer, clean, years, search, floor, write, judge, background, count), each owning its switch read, its counter names, its Thinking lines and its fail-open rule; one `runStage(turn, stage)` catches, logs and continues for optional stages. `chat/routes.ts` becomes the HTTP shell. The stage order reproduces today's event order exactly. A release then lands in its own stage file.

Problems:
- `api/chat/routes.ts:312-961` one 650-line handler; 24 commits; `api/chat/think.ts` changed with it 5 of 5 [chat]
- thirteen local try/catch: `api/chat/routes.ts:221`, `:230`, `:248`, `:287-292`, `:404`, `:456`, `:509`, `:555`, `:685`, `:705`, `:814`, `:826`, `:891` [chat]
- the confirm line on every path: `api/chat/routes.ts:759`, `:778`, `:782`, `:796` [chat]
- litscan special-cased four times: `api/chat/routes.ts:623`, `:677`, `:739`, `:771` (one `offer` stage) [chat]
- counting gated twice: `api/chat/routes.ts:399-407`, `:422-423` [chat]
- literals: `api/chat/routes.ts:603`, `:613`, `api/understand/understand.ts:202`, `:284` ("make it a plain search"), `api/chat/routes.ts:733-735` (three ChatContextInfo) [chat]
- one-value branches that become stage rules: `api/chat/routes.ts:364`, `:787`, `:856`, `:860`, `:909` [chat]
- `api/chat/routes.ts:236` rangeWords (uses the shared words from F4) [sh]
- swallowed: `api/chat/understand-wire.ts:166`, `:193`, `api/chat/history.ts:240`, `api/chat/support.ts:349`, `:358`, `api/chat/claim-check.ts:51` (each stage's documented fail-open) [chat]
- co-change: `api/chat/routes.ts` <-> `web/workspace/ChatView.tsx` 17 commits, <-> `scripts/chat-e2e.mjs` 15 (the protocol table of F9 and the stage files narrow both) [cc]

Special cases removed: thirteen try/catch, four litscan branches, four confirm-line calls, two counting gates, five one-value branches (each becomes the rule of one stage).
Risk: the highest in the plan. Keep identical: goldens at every position (first-turn, since-year, .clean, .floor, .think, .understand); `api/chat/counters.test.ts`; integration with and without the switch matrix; browser chat, think, understand, new-topic, chat-tools suites; legal-match (switch names still read in apps/api/src). Do it only after F6, F8, F14, F16. Size: **L**.

### F18. One web route and tool table

Design: `web/routes.ts` (1.4) drives the router, page titles, the rail, the palette, Home's tools and cards, ChatView's offers, the legal links and the "Check references" link. Navigation intents go through the URL and `history.state` (open at a page, search my papers, Home-to-tool text) instead of module globals, window events and sessionStorage protocols. Share-token and document-id patterns come from `shared/ids.ts`. `lib/workspace.ts` splits: product name to the route table, hand-off to history state, flags to `lib/state/flags.ts`. One `openTool(id, text)` replaces Home's three dispatchers.

Problems:
- tool names four times, already drifted: `web/workspace/Shell.tsx:35`, `:38-43`, `:40`, `:141`, `web/workspace/baseCommands.ts:21`, `web/workspace/HomePage.tsx:108`, `:617`, `:622`, `web/App.tsx:83` ("Verify references", 6.4), `web/components/papers/ReferencesPanel.tsx:83`, `web/workspace/ChatView.tsx:62`, `:68` [wc]
- route facts four times: `web/App.tsx:67-82`, `:83`, `:118` (11 ternaries), `:244-263`, `web/lib/view.ts:2`, `web/lib/legal.ts:28-32`; `web/App.tsx:364` title string surgery [wl]
- share-token pattern: `web/App.tsx:71`, `web/components/litscan/LitscanPage.tsx:40`, `:66`, `:324`, `api/litscan/share.ts:9`; doc id: `web/App.tsx:79` vs `web/lib/offline.ts:131`, `public/sw.js:59` [wc][wl]
- hand-off mechanisms: `web/lib/jump.ts:2-12` (module global, 10 s staleness; callers `web/workspace/HomeExtras.tsx:71`, `web/components/papers/WorkspaceSearch.tsx:93`), `:15-24`, `:18` with `web/components/papers/PapersPage.tsx:67-68` window event, `web/lib/workspace.ts:4-36`, `:13-36` [wl]
- `web/lib/workspace.ts:2`, `:43-57`, `:47-57` grab-bag and string flags; `web/lib/legend.ts:3`, `:18`; `web/components/papers/DocWorkspace.tsx:391-392`, `:472`, `:583`, `web/components/papers/NotesPanel.tsx:106` [wl][wc]
- `web/workspace/HomePage.tsx:343`, `:344-383`, `:346`, `:369`, `:380` three dispatchers with `paper`/`litscan` special cases [wc]
- `web/workspace/Shell.tsx:11`, `:27-30` the rail knows how Settings loads (`web/workspace/Pages.tsx:12-21`) [wc]
- `web/lib/legal.ts:9-32` text constants and `:35-42` an API call in one file [wl]

Special cases removed: the ternary chain; `requestJump` call order; `scholar:search` event; the 10 s window; per-tool dispatch `if`s.
Risk: URLs and titles. Keep identical: browser suites (workspace, papers, verify, idea, litscan, legal, default); titles unchanged except 6.4; budget (lazy pages stay functions in the table, so no page enters the first load). Size: **M**.

### F19. One web state layer: store, keys, person changes, startup, service-worker contract

Design: `lib/state/store.ts` (`createStore<T>()` with get/set/subscribe/use) and `persisted(key, codec, {area, crossTab})`; `lib/state/keys.ts` lists every storage key and the migrations of retired keys; the theme key and the signed-in key are read by an inline `theme-init` script generated from `keys.ts` at build (same bytes in index.html as today). `lib/state/person.ts`: each per-person store registers its cleanup with `onPersonChange`; sign-out and account deletion run the same list (bug B10); auth imports nothing volatile and the chat-owner call runs outside auth's try (bug B11). `startup.ts` runs everything that runs at import today, in today's order, and a test fails on a lib module with a top-level side effect. `lib/state/sw-contract.ts` holds cache names with the version, message types and the paper URL pattern, used by `offline.ts` and built into `sw.js`. `idb` helpers take the store name explicitly. One `newId()`. Components never touch `localStorage` directly.

Problems:
- thirteen hand-rolled stores: `web/lib/notice.ts:4-23`, `web/lib/preview.ts:7-33`, `web/lib/commands.ts:25-49`, `web/lib/auth.ts:14-60`, `web/lib/oa-ask.ts:26-40`, `web/lib/documents.ts:58-72`, `:143-158`, `web/lib/chat.ts:85-107`, `web/lib/prefs.ts:9-51`, `web/lib/remember.ts:4-33`, `web/lib/legend.ts:6-50`, `web/lib/offline.ts:10-35`, `web/lib/library.ts:24-127`; `web/lib/store.ts:4-35` used by two [wl]
- storage try/catch copies: `web/lib/remember.ts:6-20`, `web/lib/legend.ts:10-30`, `web/lib/notify.ts:19-34`, `web/lib/offline.ts:14-20`, `web/lib/trending.ts:22-36`, `web/lib/chat.ts:50-82`; components: `web/workspace/HomePage.tsx:117-132`, `:134-141`, `web/components/litscan/LitscanPage.tsx:47-53`, `web/components/papers/DocWorkspace.tsx:115-129`, `web/components/papers/PdfViewer.tsx:46-54`, `:69-78`, `:82-100`, `:378-384`, `:522-529`, `:603-611`, `:712-719`, `web/components/verify/VerifyPage.tsx:32-52` [wc][wl]
- keys shared by convention: `scholar.signedin` (`web/lib/auth.ts:40-41`, `web/App.tsx:43`, `public/theme-init.js:7`); theme (`web/lib/prefs.ts:13-14`, `public/theme-init.js:4-5`; `web/App.tsx:343-347` undoes `theme-init.js:7`); `scholar.scope` (`web/workspace/HomePage.tsx:117-128`, `web/components/litscan/LitscanPage.tsx:49`) [wc][wl]
- retired-key migrations in two places: `web/main.tsx:27-32`, `web/lib/chat.ts:846-856`; inconsistent cross-tab rules `web/lib/remember.ts:21-33`, `web/lib/offline.ts:23-35`, `web/lib/legend.ts:36-41` [wl]
- auth knows every store: `web/lib/auth.ts:3-5`, `:74-88` (git: 5 of 7 commits); account deletion's different list `web/components/SettingsDialog.tsx:42-45` (bug B10); three "person changed" patterns `web/lib/auth.ts:38`, `web/lib/library.ts:95-104`, `web/components/papers/PapersPage.tsx:77-81`; `web/lib/library.ts:185-190`; `web/lib/auth.ts:27-48`, `:45-48` (bug B11) [wl]
- `web/lib/offline.ts:121`, `:129` and `web/lib/idb.ts:48-98` ink's store as idb's default [wl]
- service-worker contract: `web/lib/offline.ts:9`, `:45-58`, `:104`, `:119`, `:131`, `:151-152` vs `public/sw.js:11`, `:13-17`, `:27`, `:41`, `:45-56`, `:59` (bug B17); `web/lib/offline.ts:176` 2.5 s re-read (the worker posts "stored"; the wait goes) [wl]
- import-time work: `web/lib/auth.ts:111`, `web/lib/library.ts:82-93`, `:95-104`, `web/lib/chat.ts:316-340`, `:839-856`, `web/App.tsx:43`, `web/main.tsx:25-26` [wl]
- ids: `web/lib/chat.ts:109`, `web/lib/ink.ts:28`, `web/lib/oa-ask.ts:62`, `web/lib/documents.ts:334`, `:405`, `:440` [wl]
- `web/lib/library.ts:118-127` alerts share the library's listener set (bug B29) [wl]
- `web/lib/offline.ts:165` refreshWhen, `web/lib/autogrow.ts:28` after: parameters for one caller [wl]

Special cases removed: per-module storage try/catch; the two migration sites; the 2.5 s re-read; auth's cleanup list; `App.tsx:343-347` (the inline script and the route agree from one source).
Risk: stored formats (chats, library, prefs) must read back. Keep identical: the moved web-store, lane-store and new-topic-store tests (F1); a test that every key in `keys.ts` reads today's stored value; browser suites (chat two-tab, offline, workspace, auth, library), with storage keys imported from `keys.ts` by the e2e (F24); budget (the store primitive replaces thirteen; first load must not grow). Size: **L**.

### F20. Web UI primitives

Design: `components/ui/`: `Modal` and `Sheet` (each caller passes its motion preset, so motion is unchanged), `CopyButton` + `useCopy` from `lib/copy.ts` (each caller keeps its timeout until 6.4; the live text says what was copied: bug B13), `PageFrame` (hero, sign-in gate, "how it works" cards, loading state, `rise(i)` with each page's numbers as props), `useTypingGuard` (one selector: input, textarea, select, contenteditable, dialog: bug B15), `useModifierClick`, `lazyChunk(load, {warmOnIdle, warmOnIntent, retry})` (each caller keeps its delays), the prompt box's `focus()` contract (`useReturnFocus`) so ChatView no longer queries Home's DOM, one Announcer region (bug B14).

Problems:
- dialogs: `web/components/SignInDialog.tsx:12`, `web/components/ConfirmDialog.tsx:28`, `web/components/litscan/LitscanPage.tsx:87`, `web/components/oa/OaAskSheet.tsx:213`, `web/components/PaperPreview.tsx:190`, `web/workspace/CommandPaletteBody.tsx:78`, `:192`, `web/workspace/Shell.tsx:168`; `.modal-actions` in three sheets (`web/styles/app.css:856`, `web/styles/intro.css:26`, `web/styles/workspace.css:23`) used by `web/components/ProviderButtons.tsx:12` [wc]
- copy: `web/components/oa/OaAskSheet.tsx:76-89`, `:80`, `:85`, `web/components/papers/AskPanel.tsx:171-189`, `:175`, `:181`, `web/components/PaperPreview.tsx:148-170`, `:161`, `web/components/papers/NotesPanel.tsx:68`, `web/components/litscan/LitscanPage.tsx:79`, `:81`, `web/components/litscan/Review.tsx:217`, `web/components/CiteMenu.tsx:11`, `:20`, `:38-40`; importers `web/components/LibraryList.tsx:6`, `web/components/verify/VerifySummary.tsx:8`; `lib/copy.ts` used only by `web/workspace/ChatView.tsx:492`, `:941` and CiteMenu [wc]
- page frame: hero `web/workspace/HomePage.tsx:471`, `web/components/idea/IdeaPage.tsx:229`, `web/components/papers/PapersPage.tsx:89`, `web/components/verify/VerifyPage.tsx:79`; gate `web/components/idea/IdeaPage.tsx:253`, `web/components/papers/PapersPage.tsx:112`, `web/components/litscan/LitscanPage.tsx:465`; principles `web/components/idea/IdeaPage.tsx:283`, `web/components/papers/PapersPage.tsx:140`, `web/components/verify/VerifyPage.tsx:113`; loading `IdeaPage.tsx:251`, `PapersPage.tsx:110`, `LitscanPage.tsx:463`, `web/components/admin/AdminPage.tsx:146`; `rise` at `HomePage.tsx:457`, `IdeaPage.tsx:21`, `PapersPage.tsx:20`, `VerifyPage.tsx:20`, `PaperPreview.tsx:34`, `AdminPage.tsx:11`; `LitscanPage.tsx:458` ws-page vs vhead [wc]
- typing guards: `web/workspace/CommandPalette.tsx:4`, `web/components/papers/DocWorkspace.tsx:407`, `web/components/papers/PdfViewer.tsx:584`, `web/components/PaperPreview.tsx:181`, `web/App.tsx:165`; modifier click `web/workspace/Shell.tsx:55`, `:82` [wc]
- lazy chunks: `web/workspace/HomePage.tsx:27-101`, `:320-328`, `:326`, `web/workspace/CommandPalette.tsx:10-12`, `:28`, `:37`, `web/workspace/Pages.tsx:12-21`, `web/components/papers/PdfViewer.tsx:24-26`, `:683-692`, `:691`, `web/components/papers/DocWorkspace.tsx:33`, `web/components/papers/SecondPaper.tsx:8` (depgraph 7: SecondPaper -> PdfViewer) [wc][cc]
- focus: `web/workspace/HomePage.tsx:276`, `:433`, `:439`, `:444`, `:464`, `:493`, `:506`, `:554`, `:590`, `:617`, `:622`; `web/workspace/ChatView.tsx:568-571`, `:950-957`, `:1052`, `:1057`, `:1081`, `:1192`; `web/workspace/CommandPaletteBody.tsx:52`; `web/components/idea/IdeaPage.tsx:97`; `web/components/verify/VerifyPage.tsx:64`; `web/App.tsx:204`, `:215` [wc][wl]
- announcer: `web/workspace/announcer.tsx:12-33`, `:86`, mounted at `web/workspace/HomePage.tsx:585`, `web/workspace/ChatView.tsx:1239`; a third region `web/components/papers/AskPanel.tsx:255`, `:468` [wc]
- the "setter only when it changes, or error 185" workaround three times: `web/workspace/HomePage.tsx:332-334`, `web/workspace/CommandPaletteBody.tsx:41-43`, `web/components/papers/PdfViewer.tsx:821-823` (one `useSetWhenChanged` hook; the comment about React's error 185 is outside-world and stays once) [wc]
- `web/components/ThemeSwitch.tsx:14`, `web/workspace/Shell.tsx:60`, `:98`, `:99`, `:144` a callback standing in for a mode [wc]
- `web/components/PaperPreview.tsx:10`, `web/components/papers/AskPanel.tsx:9` import CountUp and SaveButton from ResultCard [wc]
- `web/components/SettingsDialog.tsx:67` maps provider names by hand (`useAuth().providers` has labels) [wc]

Special cases removed: eight boilerplate copies; zero-ms focus timers (the focus contract); the fixed warm-up delays move into `lazyChunk` calls with the same values; the e2e-driven `.hm-topic` naming stays (F23).
Risk: look, motion and accessibility. Keep identical: browser suites with axe and screenshots (chat-look, polish-chat, polish-reader, workspace, auth, idea, verify); budget (first-load scripts: primitives used by lazy chunks must not be pulled into the first load; lazy-chunk list C3). Behaviour changes only at B13-B16. Size: **M**.

### F21. Shared feature views: paper summary, reference row, answer view, reply kinds

Design: `components/paper/PaperSummary` (badges, authors through one `authorLine(authors, {max, empty})` with each surface's options, actions) and `RetractionBanner` (variants keep each surface's words until 6.4); `RefRow` shared by ChatTool and RefCard, ChatTool calling `lib/verify` (`checkOne` with its 429 handling); `AnswerView` (cited text, live text, status line, quote list, copy) for chat, paper Ask, OA Ask and highlights, with each surface's stage words as data; ChatView reads the reply-kind table (F4); ChatView calls `lib/chat` itself and Home passes only box callbacks; one `paperFrom(partial)` (shared) for record-to-Paper.

Problems:
- verdict UI copies: `web/workspace/ChatTool.tsx:103`, `:109`, `:113`, `:125`, `:208` vs `web/components/verify/RefCard.tsx:13-28`, `:30`, `:77`, `:84`, `:126`, `:160`; `web/lib/citeStatus.ts:38-53` (bug B12); `web/components/papers/ReferencesPanel.tsx` imports verify/RefCard and VerifySummary; `web/components/papers/DocWorkspace.tsx:206` owns a useVerify [wc][wl]
- `web/components/papers/CitationCard.tsx:10-38` hand-drawn icons, `web/workspace/ChatTool.tsx:7-8` copies, both to steer chunks (words and logic go to shared, icons stay local) [wc]
- retraction banner seven times: `web/components/ResultCard.tsx:113`, `web/components/PaperPreview.tsx:41`, `web/components/verify/RefCard.tsx:126`, `web/workspace/ChatTool.tsx:125`, `:208`, `web/components/LibraryList.tsx:41`, `web/components/oa/OaAskSheet.tsx:236` [wc]
- source naming: `web/components/ResultCard.tsx:124`, `web/components/PaperPreview.tsx:46` (PROVIDER_LABELS at `:12`) [wc]
- badges and actions twice: `web/components/ResultCard.tsx:146-175`, `:192`, `web/components/PaperPreview.tsx:63-83`, `:121`; `web/components/ResultCard.tsx:95` (Shodhganga host), `:85` sameCard [wc]
- author lines four ways: `web/components/ResultCard.tsx:68`, `web/components/verify/RefCard.tsx:30`, `web/workspace/ChatTool.tsx:103`, `web/components/papers/DocWorkspace.tsx:82` [wc]
- `[n]` renderers four: `web/workspace/ChatView.tsx:148`, `web/components/papers/AskPanel.tsx:37`, `web/components/oa/OaAskSheet.tsx:112`, `web/components/papers/HighlightsTools.tsx:111`; live text twice `web/workspace/ChatView.tsx:175`, `web/components/papers/AskPanel.tsx:68`; answer cards four `web/components/papers/AskPanel.tsx:129`, `:191`, `web/components/oa/OaAskSheet.tsx:91`, `web/components/papers/HighlightsTools.tsx:105` [wc]
- stage tables four: `web/workspace/ChatView.tsx:115`, `web/workspace/ThinkBlock.tsx:15`, `web/components/papers/AskPanel.tsx:28`, `web/components/oa/OaAskSheet.tsx:18` [wc]
- the OA turn body twice: `web/components/oa/OaAskSheet.tsx:159-179`, `web/workspace/ChatTool.tsx:206-224`, `:7` (five internals); AskPanel as a de facto library: `web/workspace/ChatTool.tsx:8`, `web/components/oa/OaAskSheet.tsx:12`, `web/components/papers/HighlightsTools.tsx:6` [wc]
- reply kinds: `web/workspace/ChatView.tsx:33-52`, `:338-356`, `:369-385`, `:534`, `:576`, `:616`, `:704`, `:738` [wc]
- chat actions through props: `web/workspace/HomePage.tsx:493`, `web/workspace/ChatView.tsx:9`, `:83`, `:616`, `:934-937`, `:1114-1122` [wc]
- `web/workspace/HomeExtras.tsx:8` imports progressOf from `web/components/papers/DocMeta.tsx:146` [wc]
- `web/workspace/ChatView.tsx:1109`, `:1152` rows found by CSS class (data attributes) [wc]

Special cases removed: five `reason` exclusion chains; the six-branch ternary; Shodhganga host `if` (a source field); the hand memo comparators; the ref-of-callbacks.
Risk: words and chunks. Keep identical: browser suites (chat-look, chat-tools, oa, verify, papers, idea-chat) and axe; budget per chunk (the reasons for the copies are chunk boundaries: check the C3 list and the PDF reader line). Behaviour changes only at B12. Size: **L**.

### F22. The reader: one action list, a ready signal, a split viewer, one PDF page and text-layer layer

Design: reader actions are commands (label, key, enabled, run) that drive the toolbar, the palette, the keyboard handler and the shortcut sheet; AnnotatedDownload and split run through actions, not a window event or a DOM click. `ViewerHandle` gains a `ready` promise and an awaited `goTo`, so the timers that guess go. `ReferencesPanel` exposes `flash(id)`. PdfViewer splits into viewer + hooks (zoom/pinch, find, notes, ink, ink prefs, citations); My Workspace's citation vocabulary is provided by DocWorkspace through context. The ink model gets a home (`lib/ink/`), ending the only lib -> components edge. `lib/pdf/readPages` is the one page iterator (with cleanup and an optional cap); `lib/pdf/text-layer.ts` the one span/word/rect index; one ingest routine with "text pages" and "scanned pages" branches; NOTE_HEX read from the tokens.

Problems:
- actions: `web/components/papers/DocWorkspace.tsx:360-362`, `:378-399`, `:386`, `:388-390`, `:392`, `:403`, `:467`, `:472`, `:527`, `:575`, `:599`, `:609`; `web/components/papers/AnnotatedDownload.tsx:58-65`, `:63`; `web/workspace/CommandPaletteBody.tsx:150-187`; `web/components/papers/InkToolbar.tsx:10` [wc]
- waits: `web/components/papers/DocWorkspace.tsx:238-259`, `:244`, `:250`, `:308`, `:313`, `:351`, `:363-368`, `:364`; `web/components/papers/PdfViewer.tsx:683`, `:810-812`, `:830-832`, `:846`; `web/styles/cites.css:190` ref-flash [wc]
- `web/components/papers/SecondPaper.tsx:20-39` copies `web/components/papers/DocWorkspace.tsx:166-182` [wc]
- PdfViewer: `web/components/papers/PdfViewer.tsx:374` (1070 lines), `:32-44` CitationsProps passed only by `DocWorkspace.tsx:574`, `:15` imports ink rules from InkToolbar (`:40-59`), InkToolbar imports DrawTool from InkLayer (`:7`) [wc]
- lib -> components: `web/lib/annotated-pdf.ts:3` -> `web/components/papers/InkLayer.tsx:56` (depgraph 2c: the web folder SCC of 5) [wl][wc][cc]
- page loops five: `web/lib/paperinfo.ts:9-17`, `:20-28`, `web/lib/documents.ts:248-261`, `web/lib/ideafile.ts:16-29`, `:20`, `web/lib/citations.ts:45-52`, `:47-52` (bug B18); `web/lib/citations.ts:19-20`, `:45` bundler parameter; idle helpers `web/lib/citations.ts:36-42`, `web/lib/trending.ts:83-89` [wl]
- text layer: `web/lib/highlight.ts:17`, `:18-25`, `:42`, `:43-50`, `:73`, `:78-86`, `web/lib/citations.ts:69`, `:92-102`, `:99-101` [wl]
- ingest: `web/lib/documents.ts:224-238`, `:241-245`, `:243`, `:295`, `:312`, `:325`, `:329`, `:367-384`, `:411-429` [wl]
- `web/lib/annotated-pdf.ts:6` copies `web/styles/workspace.css:1465-1468`; `:86` and `:196`, `:156-168` and `:200-221` two copies each [wl]
- polling the scan while the job store exists: `web/components/papers/DocWorkspace.tsx:217`, `:218` [wc]
- `web/components/papers/ReferencesPanel.tsx` <-> `shared/paperinfo.ts` co-change 4 of 5 [cc]

Special cases removed: the 40 x 100 ms poll, the 500 ms second go, three 120 ms waits, the 180 ms wait, the 350/300 ms waits, setTimeout(0) focus; the global event; the id click; the `readPage` parameter for the bundler.
Risk: the reader chunk (66 KB script+style) and the first load (pdf.js must never enter it). Keep identical: budget (all lines), browser suites (papers, polish-reader, annotated, cites, workspace, offline, scan; `REAL_PDFS` run once by hand on the 18 real PDFs: same 2,404 of 2,439 citations linked). Behaviour changes only at B18. Size: **L**.

### F23. Stylesheets by owner

Design: each component folder imports its own sheet; `styles/` keeps tokens and what the first screen draws. Shared menu classes move to `components/ui/menu.css`; the content-visibility variables are defined with ChatView; litscan asks Shell for a chrome-less frame instead of hiding it with `body:has(... ) !important`; `.modal-actions`, `.seg-label`, `.chat-live-wait` are defined once. Class names that browser suites select are kept (or the suite is changed in the same commit).

Problems:
- `web/styles/shell.css` styles six features: `:117-123`, `:163-328`, `:233`, `:321`, `:330`, `:407-438`, `:440-700`, `:494-518`, `:564`, `:665` (git: 26 commits, with 10 different components) [wc][cc]
- `web/styles/topic.css:31` and `web/styles/chat-lazy.css:4`, `:13` style Home from ChatView's lazy chunk [wc]
- `web/styles/workspace.css:550` on (PDF viewer in first-load CSS; overridden by `web/styles/ink.css:86`, `web/styles/cites.css:50`), `:1170`, `:1216`, `:1221` used by ChatView (`web/workspace/ChatView.tsx:134`, `:178`, `:180`), `:6` `.papers-gate` [wc]
- `web/styles/papers.css:15`, `:184` style PaperPreview and OaAskSheet [wc]
- `web/styles/verify.css:22`, `:178`, `:259` and `.vin-*` used by idea; `web/styles/idea.css:170`, `:700` override them [wc]
- `web/styles/litscan.css:181`, `:184` [wc]
- `web/styles/app.css:204`, `web/styles/verify.css:460`, `web/styles/shell.css:321` `.seg-label` thrice; `web/styles/app.css:349`, `:1171` [wc]
- `web/components/papers/DocWorkspace.tsx:66`, `web/workspace/HomeExtras.tsx:27` use DocCard's classes; `web/workspace/ChatView.tsx:317` and `web/components/litscan/Review.tsx` use Home's menu classes; `web/workspace/ChatView.tsx:1208` sets variables defined in another chunk's sheet [wc]
- `web/workspace/HomePage.tsx:564` `.hm-topic` kept separate because suites find `.hm-scope` [wc]
- co-change: `web/styles/shell.css` <-> `web/workspace/ChatView.tsx` 15; `web/styles/workspace.css` <-> `web/components/papers/DocWorkspace.tsx` 9; `web/styles/intro.css` <-> `web/workspace/intro/Film.tsx` 5 [cc]

Special cases removed: the `body:has` hide; the per-caller overrides of `.modal-actions`, `.vin-hint`, `.vin-actions`.
Risk: the look and the 26 KB first-load style budget (about 23.6 KB today: moving chat and papers styles out should lower it). Keep identical: browser suites with screenshots, axe, `web-scripts/contrast.mjs` (made to fail in F25), budget. Size: **M**.

### F24. One test harness and an integration runner driven by a table

Design: a `test-support` module set (API: `scripts/lib/harness.mjs`; browser: `e2e/lib/browser.mjs` built on it): the Worker address, the fake identity provider's port and secret, `check()` and the exit code (a failed `waitFor` is recorded as a named failure and the suite goes on, replacing about 130 `ok(true)`), `signIn(user)` (with the privacy ack and the check that it took), `readSse` (the app's own), `sql()`, `until()`, switch positions parsed once from the registry (F6). Browser: launch with `E2E_BROWSER`, `watch()` with one allowed-errors list, `axe()` with reduced motion and the box unstuck, `setTheme`, the viewports, `noSideways`, one in-page chat stream stand-in. `testWorker({vars})` copies wrangler.jsonc with a real JSONC parser (the same one `api/legal-match.test.ts` uses for `vars`) and is used by integration.mjs and qa-eval.yml. The suite list is data `{label, file, kind, needs}`; a check fails when a suite file is not listed (or marked manual). The reset table list comes from the personal-data registry once F15 lands (until then the hand list stays). Fixed waits for background work become `until()`. Product values the suites assert (lane spacing, Trending keys, Thinking lines, logo path, storage keys) are imported from source.

Problems:
- port 9911 in 55 files: `scripts/integration.mjs:21`, `scripts/fake-idp.mjs:6`, the API suites (`auth-e2e.mjs:14`, `cache-e2e.mjs:64`, `chat-e2e.mjs:23`, `chat-tools-e2e.mjs:19`, `docs-e2e.mjs:12`, `feedback-e2e.mjs:9`, `idea-e2e.mjs:11`, `library-e2e.mjs:20`, `litscan-e2e.mjs:12`, `mcp-e2e.mjs:26`, `oa-e2e.mjs:11`, `ops-e2e.mjs:21`, `retraction-e2e.mjs:18`, `scan-e2e.mjs:13`), the eval/manual scripts and 22 browser suites listed in [ti] H1, `.github/workflows/qa-eval.yml:61` [ti]
- INTEGRATION_VARS parsed with private regexes: `scripts/integration.mjs:51`, `scripts/chat-e2e.mjs:12`, `:18`, `:377`, `scripts/chat-tools-e2e.mjs:13-15`, `e2e/chat.mjs:24`, `:30`, `:1080-1082`, `:1324-1325`, `:1349-1350` (bug T-B1), `e2e/think.mjs:209`, `e2e/understand.mjs:20`, `scripts/trending-e2e.mjs:21-22`, `scripts/mcp-e2e.mjs:13`, `e2e/mcp.mjs:18` [ti] H2
- `ok` and exit copied into 49 suites (H3); login copied 10 times, `scripts/library-e2e.mjs:21-25` without the ack (T-B2), `scripts/router-eval.mjs:81` the only check; `scripts/auth-e2e.mjs:24` own client (N1) [ti]
- SSE readers 18 copies (H5: `scripts/chat-e2e.mjs:33-60`, `chat-tools-e2e.mjs:28-34`, `docs-e2e.mjs:165-181`, `idea-e2e.mjs:20-33`, `litscan-e2e.mjs:28-45`, `oa-e2e.mjs:30-43`, `mcp-e2e.mjs:43`, `eval/mcp.eval.ts:44`, `eval/understand-route.eval.ts:67`, ...); sql helper 15 copies (H6); APP/BASE 57 copies (H7), `e2e/smoke.mjs:9`, `e2e/verify.mjs:12` default 8787 (SP3), `e2e/understand.mjs:30` FAKE_IDP_PORT (SP4) [ti]
- browser preamble (H8: 34 launches, 26 axe, 8 unsticks, three setTheme forms, six VP, eight noSideways, watch lists that differ `e2e/workspace.mjs:32`, `e2e/chat.mjs:52`, `e2e/understand.mjs:36`); poll helpers 10 (H9); chat fetch stand-in 4 + page.route 3 (H10) [ti]
- `scripts/integration.mjs:28` whole-line-comment JSONC reading (H11; same in `api/legal-match.test.ts`); `.github/workflows/qa-eval.yml:59-63` own Worker (H12); "dev-secret" three places `scripts/fake-idp.mjs:29`, `scripts/integration.mjs:53`, `qa-eval.yml:61` (H13); `scripts/integration.mjs:99` reset tables (H14, with F15); `:184` ops-e2e must be last because `scripts/ops-e2e.mjs:141` renames job_runs (H15); `:147-181` URL argument 31 times (H16) [ti]
- one-value runner branches: `scripts/integration.mjs:33`, `:36`, `:39`, `:42`, `:59`, `:60`, `:62`, `:68` (SC1-SC5) [ti]
- suites in no list: `e2e/poc.mjs` (SU1, msedge-only); `apps/web/package.json:13-17` five e2e scripts (SU2) [ti]
- `ok(true)` after a wait, about 130 (`e2e/admin.mjs:46`, `e2e/auth.mjs:51`, `e2e/papers.mjs:200`, `e2e/workspace.mjs:1072`, `e2e/chat.mjs:1973`, ...) (T1, T-B3) [ti]
- fixed waits for background work: `scripts/cache-e2e.mjs:52`, `:57`, `scripts/docs-e2e.mjs:202`, `scripts/retraction-e2e.mjs:61`, `:74`, `scripts/litscan-e2e.mjs:174`, `:183`, `scripts/gate-e2e.mjs:41`; `e2e/workspace.mjs:684`, `:848`, `:863`; `e2e/chat.mjs:1972` (T-B11, in progress on another branch) [ti]
- copied product values: `scripts/gate-e2e.mjs:2`, `:24-27`, `scripts/trending-e2e.mjs:32`, `:34-35`, `e2e/chat.mjs:44`, `e2e/workspace.mjs:17`, `e2e/poc.mjs:16` (H28); storage key names in e2e (N6) [ti]
- two PDF writers `scripts/lib/make-pdf.mjs:7`, `api/oa/stub.ts:22` (H29: the stand-in imports the one in test-support) [ti][svc]
- swallowed: `scripts/qa-eval.mjs:24-31` (T-B9), `scripts/ops-e2e.mjs:141` (T-B10), `e2e/real-papers.mjs` end, `scripts/integration.mjs:90` (deliberate, kept), `:101-109` retry [ti]

Special cases removed: every per-suite copy; the runner's per-switch `if`s (a matrix of named runs); the "ops-e2e last" convention (ops-e2e simulates the missing job through a dev route instead of renaming the table).
Risk: the safety net itself. Keep identical: no product code changes in this fix; run the old and the new harness on the same commit: same suites, and the check count may only go up (checks that were skipped after a failed wait are now counted). Size: **L**.

### F25. Evals, scripts and CI workflows

Design: one model record/replay layer (`eval/lib/model-layer.ts`) next to FetchLayer, one `EVAL_MODE=record|replay|live`; a missing recording fails a gate instead of skipping it; one real-model eval runner for the five weekly scripts (accounts per N items, gate table, `--gate` exit, result file), so qa-eval.yml has one step; one `loadSrc()` (Node type stripping) and one `devVars()`; a `.github/actions/setup` composite (checkout, setup-node from `package.json` engines, `npm ci`) and one reusable alert workflow; the production URL as one repository variable; the deploy job deploys the build the check job tested. Build scripts read their facts: `contrast.mjs` parses `tokens.css` and exits non-zero on a failure (with an allowlist of today's failures, 6.17); `budget.mjs` names chunks by module id from the Vite manifest and fails on zero preloaded fonts.

Problems:
- model record/replay three times: `eval/claim.eval.ts:47-86`, `eval/understand.eval.ts:49`, `:62-100`, `eval/understand-route.eval.ts:23-40` (H17); three mode switches `eval/claim.eval.ts:24`, `eval/understand.eval.ts:54`, EVAL_MODE elsewhere (SP5) [ti]
- gates that pass on missing data: `eval/understand-route.eval.ts:84`, `eval/understand.eval.ts:212`, `eval/prior-art.eval.ts:33`, `:91`, `eval/eval.eval.ts:329`, `eval/plain-text.eval.ts:156` (T3, T-B4) [ti]
- five eval scripts' gates: `scripts/chat-eval.mjs:18`, `:163`, `scripts/support-eval.mjs:22`, `:169`, `scripts/oa-eval.mjs:21`, `:196`, `scripts/qa-eval.mjs:123-132`, `scripts/router-eval.mjs:29`, `:46`, `:160` (H18, H20); `.github/workflows/qa-eval.yml:65-94`, `:101-109` (H19); `scripts/router-eval.mjs:41` `--followup` never run, `trending-subfields.mjs --check` (SC6); `api/chat/followup-eval.test.ts:318-328` reads script text (N3, T8) [ti]
- three ways to load app TypeScript (H21: `scripts/lib/stream-rule.mjs:3`, `scripts/trending-e2e.mjs:28`, `scripts/search-live.mjs:11`, `india-live.mjs:41`, `doaj-live.mjs:61`, `refs-check.mjs:20`, `refs-live.mjs:28-29`, `r5-ocr.mjs:32`, `r5-replay.mjs:41`, `trending-live.mjs:57`); `.dev.vars` parsed six times (H22: `eval/run.mjs:12-15`, `eval/patch-fixtures.mjs:14`, `eval/build-prior-art.mjs:11`, `scripts/doaj-live.mjs:55`, `scripts/refs-live.mjs:36`, `scripts/push-secrets.mjs:21`); getJson copies (H23: `eval/build-dataset.mjs:15-23`, `eval/build-heldout.mjs:18-26`, `:25-32`, `:27-30`, `eval/build-fakes.mjs:9`) [ti]
- workflows: alert job six times (H24), setup eight times (H25), production address four times `ci.yml:70`, `watchdog.yml:30`, `trending-live.yml:43`, `:64` (H26), node 22 vs engines (H27), deploy rebuilds `ci.yml:57` (SP7, T-B7), PR guard twice `ci.yml:76` / `.github/scripts/workflow-alert.mjs:138`, missing at `watchdog.yml:34` (SC7) [ti]
- `eval/intent-gates.eval.ts:307-320` second transcription (T5), `:360-377` plan line numbers (T6), `eval/eval.eval.ts:300-324` writes docs/eval/REPORT.md (T7), `eval/frame.eval.ts:91`, `:214` no assertion (T4) [ti]
- `web-scripts/contrast.mjs:7-11`, `:29` (T-B5); `apps/web/vite.config.ts:10`, `web-scripts/budget.mjs:45`, `:56` (T-B6), `:57-62`, `:71`, `:76-77` [wl]
- `scripts/trending-subfields.mjs:13` a personal e-mail address as MAILTO (SC9; replaced by CROSSREF_MAILTO); `eval/build-prior-art.mjs:11` (SP6) [ti]
- finished spikes and one-off builders (SU3-SU6, SU8): archived per 6.11 [ti]

Special cases removed: per-eval record code, per-script gate code, the copied workflow blocks, the file-name chunk regexes.
Risk: CI. Keep identical: `npm run eval` prints the same gate table before and after; one weekly qa-eval run by hand (workflow_dispatch) with the same gates; budget numbers unchanged (only how chunks are found). Size: **M**.

---

## 3. Waves

Each wave is one PR (or one PR per worktree, merged in the order given), lands on main alone with CI green, and leaves behaviour unchanged apart from the bugs it lists. Every wave also: shrinks the `layers.test.ts` allowlist, reruns `depgraph.mjs` and `copies.mjs` and records the section 7 measures in the PR description.

Common verification (every wave): `npm run typecheck`, `npm test` (after W1: api + shared + web), `npm run test:scripts` (until F1 folds it in), `npm run eval`. Plus, per wave, what is listed.

### W1. Ground: dead code, each package tests itself, one Env (F0, F1, F5)

- Files: everywhere for F0 (deletions only); `apps/web/package.json`, `apps/web/vitest.config.ts`, `packages/shared/package.json`, `packages/shared/vitest.config.ts`, root `package.json`, `packages/test-support/`, about 55 moved test files, `api/*.test.ts` at the root, `web/test/`, new `layers.test.ts` (F1); `apps/api/worker-configuration.d.ts`, `api/platform/env.ts`, every module with a `Bindings`/`*Env` type, `api/index.ts`, `api/auth/http.ts`, `.github/workflows/ci.yml` (cf-typegen check) (F5).
- Verification: common + `npm run build && npm run budget -w apps/web` (F0 removes CSS) + `node apps/api/scripts/integration.mjs` (API). Test totals before = after (F1).
- Parallel: F0 first (one small commit, it deletes tests F1 would move). Then F1 (tests, configs) and F5 (types in api src) in two worktrees: they touch disjoint files except `api/chat/routes.ts` Bindings comments, which F5 owns.

### W2. Switches and the test harness (F6, F24, F25)

- Files: `api/platform/switches.ts` (from `api/understand/flags.ts`), `api/mcp/flag.ts`, `api/chat/routes.ts` (switch reads only), `api/litscan/workflow.ts`, `api/trending/routes.ts`, `api/trending/job.ts`, `api/legal-match.test.ts` (F6); `scripts/lib/harness.mjs`, `scripts/integration.mjs`, every `scripts/*-e2e.mjs`, `e2e/lib/browser.mjs`, every `e2e/*.mjs`, `.github/workflows/qa-eval.yml` (F24); `eval/lib/model-layer.ts`, `eval/*.eval.ts`, the eval scripts, `.github/actions/setup`, all workflows, `web-scripts/contrast.mjs`, `web-scripts/budget.mjs`, `apps/web/vite.config.ts` (F25).
- Verification: common + `node apps/api/scripts/integration.mjs --browser` + the switch matrix + `INTEGRATION_TRENDING=dark` + `INTEGRATION_MCP=off`; `npm run build && npm run budget -w apps/web` (same numbers, new chunk naming); check counts of the harness before/after (F24).
- Parallel: F6 (api src), F24 (scripts, e2e), F25 (eval, .github, web-scripts) in three worktrees. F24 reads switch positions from F6's registry: merge F6 first; F24 keeps the old vars parsing until it rebases.

### W3. Shared words: text, identifiers, vocabulary; request guards (F3, F4, F10)

- Files: `shared/text.ts`, `shared/ids.ts`, `shared/vocab/*`, `shared/protocol/problem.ts`, every copy site listed under F3 and F4 in api, shared and web; `api/outcomes.ts`, `web/components/admin/AdminOps.tsx`; `api/platform/http/guards.ts`, `body.ts`, `api/app/mount.ts`, `api/ratelimit.ts`, every route file (guard lines only), `api/mcp/server.ts`, `api/mcp/oauth.ts` (F10).
- Verification: common + goldens + budget + integration `--browser` + switch matrix (counters).
- Bugs fixed: B5, B7, B19, B20.
- Parallel: F3 then F4 in one worktree (both edit `shared/chat-state.ts`, `shared/ledger.ts`, `api/understand/understanding.ts`); F10 in a second worktree (route files; conflicts with F3/F4 only in import lines of `api/chat/routes.ts`).

### W4. Platform ports: dev mode, model port, wire contract (F7, F8, F9)

- Files: `api/platform/dev.ts`, `api/platform/deps.ts`, `api/app/stand-ins.ts`, `api/app/dev-routes.ts`, `api/index.ts`, every `stub*.ts` into `<feature>/testing/`, every module listed under F7 (F7); `api/platform/llm/*` (from `api/llm/*`), `api/docs/qa.ts`, every model adapter site, `api/ocr/read.ts`, `api/chat/malformed.ts` (removed) (F8); `shared/protocol/streams.ts`, `shared/stream-shape.ts`, `api/platform/http/sse.ts`, the seven stream routes, `web/lib/api/*`, every `web/lib/*.ts` endpoint module, `web/lib/sse.ts`, `web/workspace/ChatTool.tsx` (fetch only) (F9).
- Verification: common + goldens + legal-match + integration `--browser` + switch matrix + budget; the production-env test of F7 (no dev route, no stand-in reachable); the profile request table of F8; byte comparison of recorded streams (F9).
- Bugs fixed: B1, B2, B3 (if the old page stays), B25, B30.
- Parallel: F7 then F8 in one worktree (F8's `modelFor` takes the stand-in from F7's deps; both edit the same adapter sites); F9's web half (`web/lib/**`) in a second worktree from the start; F9's server half (sseStream callers) after F7 merges.

### W5. Package boundaries: slim shared, feature services, personal data (F2, F13, F15)

- Files: `packages/shared/src/**` (moves out), `web/lib/<area>/` (moves in), `api/trending/**`, `api/chat/router-rules.ts`, `apps/web/package.json` (sideEffects), deep-import sites, the scripts that name shared paths (F2); `api/docs/service.ts`, `api/docs/store.ts`, `api/ocr/process.ts`, `api/oa/*`, `api/library/*`, `api/platform/db/*`, `api/platform/config.ts`, `api/mcp/apps.ts`, `api/mcp/scopes.ts`, `api/mcp/oauth.ts`, `api/auth/*`, `api/monitoring/sentry.ts`, `api/admin/*`, `api/feedback/routes.ts`, a new migration `oa_papers.format` (F13); `<feature>/personal-data.ts` for every feature, `api/app/personal-data.ts`, `api/account/*`, `api/maintenance.ts` (to `api/app/`), `api/admin/routes.ts`, `scripts/integration.mjs` reset list (F15).
- Verification: common + budget (every line within 0.2 KB of before) + integration `--browser` + `INTEGRATION_TRENDING=dark`; the erase/export/purge before-and-after test (F15); `npm run db:migrate:local` then integration (F13 migration).
- Bugs fixed: B6, B21, B26 (if 6.9 says yes).
- Parallel: F2 (shared, web lib, api trending) in one worktree; F13 then F15 in another (F15's export uses F13's docs store).

### W6. The outside world: service clients, search API, DOI facts, cache (F11, F12)

- Files: `api/platform/services/*`, `api/platform/gate/*` (from `api/gate/*`), `api/s2-throttle.ts`, `api/search/*`, `api/references/*`, `api/oa/sources.ts`, `api/oa/deps.ts`, `api/library/retraction.ts`, `api/idea/search.ts`, `api/idea/sources/`, `api/trending/sources.ts`, `api/trending/arxiv.ts`, `api/litscan/*` (concurrency), `api/mcp/server.ts`, `api/index.ts` (withPlatform), workflows' entry (F11); `api/platform/cache/*` (from `api/cache/*` and `api/search/cache.ts`), `api/search/doi-facts.ts`, `api/search/api.ts`, `api/chat/understand-wire.ts` (resolver), `api/llm/gateway.ts` (cache), `api/library/service.ts` (F12).
- Verification: common (eval in replay is the main guard: unchanged requests) + recorded-header check + integration (gate-e2e, cache-e2e, retraction-e2e, idea, chat, mcp, trending) + switch matrix.
- Bugs fixed: B4, B8, B9, B22, B23, B24.
- Parallel: F11's clients and gate in one worktree; F12's cache half (`remember`) in another from the start; F12's DOI-facts and search API after F11 merges (they call the clients).

### W7. Chat: answering engine, Understand folder, turn pipeline (F14, F16, F17)

- Files: `api/answering/*` (from `api/chat/answer.ts`, `support.ts`, `evidence.ts`), `api/chat/claim-check.ts`, `api/chat/tighten.ts`, `api/litscan/worker.ts` (F14); `api/understand/*`, `api/chat/understand-wire.ts` (removed), `api/chat/stub*.ts` to `api/chat/testing/`, the prompt modules (`api/chat/router.ts`, `api/understand/ledger-input.ts`, `api/understand/chat-reply.ts`, `api/answering/*`), fixtures to `*.fixture.ts`, `api/legal-match.test.ts` NO_FUNCTION_TO_CALL (F16); `api/chat/turn/*`, `api/chat/routes.ts`, `api/chat/think.ts` (F17).
- Verification: common + goldens at every position + legal-match + integration `--browser` + the switch matrix (each position separately for CHAT_FLOOR, CHAT_SAFETY, CHAT_UNDERSTAND) + `npm run eval` (claim, understand, understand-route, frame, tiers).
- Parallel: F14 (answering) and F16 (understand) in two worktrees; F17 after both merge, alone.

### W8. Web state and primitives: route table, state layer, UI primitives (F18, F19, F20)

- Files: `web/routes.ts`, `web/App.tsx`, `web/workspace/Shell.tsx`, `web/workspace/baseCommands.ts`, `web/workspace/HomePage.tsx` (tools, dispatch), `web/lib/jump.ts`, `web/lib/workspace.ts`, `web/lib/view.ts`, `web/lib/legal.ts` (F18); `web/lib/state/*`, `web/startup.ts`, `web/main.tsx`, `web/lib/{auth,chat,oa-ask,offline,library,documents,prefs,remember,legend,notify,notice,preview,commands,trending,idb,ink}.ts`, `public/sw.js`, `public/theme-init.js` (generated), `web/components/SettingsDialog.tsx` (F19); `web/components/ui/*`, the dialog, copy, page, focus and lazy sites listed under F20 (F20).
- Verification: common + budget + `node apps/api/scripts/integration.mjs --browser` (all browser suites, storage keys from `keys.ts`) + axe in the suites.
- Bugs fixed: B10, B11, B13, B14, B15, B16, B17, B29.
- Parallel: F19 (lib/state, lib modules) in one worktree; F18 then F20 in another (both edit HomePage and App; F18 first).

### W9. Web views, the reader and styles (F21, F22, F23)

- Files: `web/components/paper/*`, `web/components/chat/*` (from `web/workspace/ChatView.tsx`, `ThinkBlock.tsx`, `ChatTool.tsx`), `web/components/verify/RefCard.tsx`, `web/components/papers/AskPanel.tsx`, `web/components/oa/OaAskSheet.tsx`, `web/components/papers/HighlightsTools.tsx`, `web/components/ResultCard.tsx`, `web/components/PaperPreview.tsx`, `web/components/LibraryList.tsx`, `web/lib/citeStatus.ts` (F21); `web/components/papers/{DocWorkspace,PdfViewer,SecondPaper,AnnotatedDownload,InkToolbar,InkLayer,ReferencesPanel}.tsx`, `web/workspace/CommandPaletteBody.tsx`, `web/lib/ink/*`, `web/lib/pdf/*`, `web/lib/{paperinfo,documents,ideafile,citations,highlight,annotated-pdf}.ts` (F22); `web/styles/*` and new per-folder sheets (F23).
- Verification: common + budget (every line, the C3 lazy list, the forbidden-in-first-load list) + `node apps/api/scripts/integration.mjs --browser` + one `REAL_PDFS` run (F22) + contrast.
- Bugs fixed: B12, B18.
- Parallel: F21 (chat, paper, verify, oa views) and F22 (reader) in two worktrees (only `web/components/papers/AskPanel.tsx` is shared: F21 owns it); F23 last, alone.

### W10. Comments pass and tests pass (section 4)

- Verification: common + integration `--browser` + switch matrix + budget; final behaviour check (section 7 "done").

---

## 4. Comments pass and tests pass

### 4.1 Comments

Rules:
- Remove a comment that restates the code, even when it is phrased as a "why" (`// sort first so the binary search works`; the Hinglish restatements such as `api/search/merge.ts` "DOI (phir PMID, phir title+year) se dedup").
- Keep a comment about the outside world: a measured service limit (`api/gate/index.ts:3-7`, "Crossref polite pool ... 24 Oct 2026"), a browser or platform behaviour (`api/trending/job.ts:636` illegal invocation; React's error 185), a privacy or design-doc reference that records a decision (`docs/design/...`), a date-stamped measurement in `web-scripts/budget.mjs`.
- Remove a workaround comment together with its workaround, in the wave that removes it (not in this pass): e.g. the doi-check retraction-flag comment (`api/search/doi-check.ts:120`) in W6, "the browser applies the same caps" (`api/understand/ledger-input.ts:11`) in W3, "nothing in the Worker imports this file" (`api/chat/clean-cases.ts:2`) in W7, "tested without a browser" (`shared/chat-state.ts:10`, `shared/trending-row.ts:4`) in W5, "import it as @scholar/shared/src/trending" (`shared/trending.ts:3-4`) in W5, "the list is the server's and a few more" (`shared/chat-state.ts:391`) in W3, the 2.5 s "kept a moment after" (`web/lib/offline.ts:176`) in W8.
- Long "why" comments about switches, privacy and the off position are deliberate (the audits' own note) and stay.

Split for parallel worktrees (one per audit area; each touches only comments in its own folders, so there are no conflicts):
1. `api/chat/**`, `api/understand/**`, `api/answering/**`
2. `api/platform/**`, `api/search/**`, `api/references/**`, `api/oa/**`, `api/ocr/**`, `api/library/**`
3. the other api features (`docs`, `idea`, `litscan`, `trending`, `mcp`, `auth`, `admin`, `account`, `feedback`, `monitoring`), `api/app/**`, `api/index.ts`, `apps/api/migrations`, `apps/api/wrangler.jsonc` (careful: `api/legal-match.test.ts` and integration read `vars`; with F24's JSONC parser end-of-line comments become safe)
4. `packages/shared/**`
5. `web/components/**`, `web/styles/**`
6. `web/lib/**`, `web/App.tsx`, `web/main.tsx`, `web/routes.ts`, `web-scripts/**`, `apps/web/vite.config.ts`, `public/**`
7. `scripts/**`, `e2e/**`, `eval/**`, `.github/**`

Verification: `npm run typecheck`, `npm test`, `npm run build` (comments only; a diff that touches a non-comment token fails review).

### 4.2 Tests (last, after W9)

A test should fail on a regression, and only then.

Remove (they repeat the implementation):
- constant pins: `api/chat/history.test.ts:239`, `api/chat/chat-list.test.ts:22`, `api/chat/ledger.test.ts:114`, `api/understand/flags.test.ts:376`, `api/understand/tiers.test.ts:92`, `:107`, `api/understand/lane.test.ts:26`, `api/chat/outcome-share.test.ts:35`, `api/search/query.test.ts:130`, `api/references/crossref-gate.test.ts:24`, `:40`, `api/sse.test.ts:75`, `api/outcomes.test.ts:137`, `api/scale.test.ts:62`, `api/trending/select.test.ts:32-34`, `:242`, `:248`, `api/trending/text.test.ts:19`, `api/trending/rank.test.ts:389`, `api/trending/home-row.test.ts:43`, `:78`, `:199`, `:337`, `api/trending/client.test.ts:80`, `api/trending/job.test.ts:653`, `api/trending/cron.test.ts:25` (paths as they were before the moves of W1/W5) [chat][svc][feat][sh]
- prompts and schemas compared with copies of themselves: `api/chat/answer-context.test.ts:66`, `api/chat/general.test.ts:61`, `:69-71`, `api/chat/router-context.test.ts:25-35`, `:65`, `api/chat/support-strict.test.ts:27-28`, `api/idea/plan.test.ts:76-77`, `api/idea/compare.test.ts:131`, `api/idea/insights.test.ts:259-260`, `api/idea/sentence-refs.test.ts:36`, `:44`, `api/litscan/plan.test.ts:97` [chat][feat]
- `eval/intent-gates.eval.ts:307-320` (second transcription) and `:360-377` (plan line numbers) [ti]
- the migration pins added by W3, W4 and W6 (title fold equality, profile request table, cache key strings) once their wave is on main.
- Keep: owner-approved sentences and frozen counter names (`api/chat/failpolicy.test.ts:378-379`, `api/understand/input-shape.test.ts:34`, `api/understand/reading.test.ts:37-48`), the legal-text runbook pins, and `ABSTRACT_READ_CHARS` (`api/chat/abstract-read.test.ts:10`) per 6.3.

Remove (they cannot fail):
- `not.toThrow()` on try-wrapped functions: `api/understand/input-shape.test.ts:372`, `api/understand/tiers.test.ts:136`, `api/understand/frame.test.ts:469-470`, and the `not.toThrow()` halves of `api/chat/history.test.ts:143`, `api/understand/input-shape.test.ts:359`, `:366`, `api/understand/lane.test.ts:42` (the value assertions beside them stay) [chat]
- `api/search/query.test.ts:115-124` (`expect(calls).toBeDefined()`), `api/trending/client.test.ts:294`, `api/chat/abstract-read.test.ts:106` [svc][feat][sh]
- `api/chat/history.test.ts:2`, `api/chat/context-before.test.ts:161-162` (an unenforced constant; gone with F4) [sh]
- `api/docs/citations.real.test.ts:29`, `:120` becomes a script beside refs-live (it measures; its one assertion cannot fail) [feat]
- `eval/frame.eval.ts:91`, `:214`, `e2e/smoke.mjs:86`, `:104-105` (turn the logged facts into checks or remove), `e2e/real-papers.mjs` exit 0 [ti]
- tests of dead code and unreachable branches: `api/understand/understand-flag.test.ts` (F0), `api/understand/guards.test.ts:17-25`, `:40-44` (F16) [chat]

Rewrite (tied to internals, so they break when behaviour does not change):
- `api/chat/answer.test.ts:3`, `:103`, `:253`, `api/chat/support.test.ts:5`, `api/chat/support-strict.test.ts:4`: test `answerFromResults` and `judgeAnswer`/`judgeClaims` through their entries with `answering/evidence` fixtures [chat]
- `api/chat/stub-context.test.ts:19-64`, `api/chat/router.test.ts:175`: become tests of the prompt readers (F16) [chat]
- `api/search/merge.test.ts:27`: really shuffle the insertion order [svc]
- `api/cache/kv.test.ts:40`: "a different version does not read old entries", not the key layout [svc]
- `api/llm/pricing.test.ts:20-24`, `:45`: pass a price table instead of mutating the global [svc]
- `api/search/plain-text.test.ts:338`, `:342`: the eval fixtures become a named test input [svc]
- `api/jobs.test.ts:64-80`, `:89-91`, `api/maintenance.test.ts:44`, `:52`, `api/account/erase.test.ts:26-52` (already on testD1 in F15), `api/scheduled.test.ts:22-25`: check job state and table contents on testD1, not SQL words or module mocks [feat]
- `api/scale.test.ts:31-46`: run the plans of the queries the stores export, not copied SQL [feat]
- `api/legal-text.test.ts:234-235` (read the constants by import), `:260-276` (assert behaviour of the route table, not an import line) [feat][wl]
- `api/monitoring/sentry.test.ts`: a fresh limiter per test, not `resetEventLimit` [feat]
- `api/chat/chat-fold.test.ts:498-503` (if chat-fold stays, 6.10), `api/chat/followup-eval.test.ts:318-328` [wl][ti]
- web store tests: through `persisted()`'s storage seam, no path mocks [wl]
- browser suites: assertions on computed styles and animations (191 `getComputedStyle|getAnimations|window.__`) kept only where the style is the behaviour (reduced motion, focus ring, sticky box); storage key names from `keys.ts` (N6); copied product strings imported (H28); `e2e/perf.mjs:11`, `:21` become report-only with a recorded baseline (T10) [ti]

Move: anything F1 left behind (the pass ends with no test outside the package of its code: measure 7.8).

Split for parallel worktrees (tests live per folder, so no conflicts): (1) api chat/understand/answering, (2) api services (platform, search, references, oa, ocr, library, cache, llm), (3) api features and root, (4) packages/shared, (5) apps/web unit tests, (6) scripts, e2e, eval. Verification for each: `npm test`, `npm run eval`, `node apps/api/scripts/integration.mjs --browser`; plus mutation spot-checks: for each rewritten test, break the code it guards once by hand and see it fail.

---

## 5. Real bugs found by the audits

Product bugs (fixed in the wave named; each gets a test that fails before the fix):

| # | Bug | Where | Wave (fix) |
| --- | --- | --- | --- |
| B1 | The browser's SSE reader swallows exceptions thrown by the event handler, so a literature scan's `error` event (thrown as ApiError) never reaches `useScan`; the loop reconnects instead | `web/lib/sse.ts:15-19`, `web/lib/litscan.ts:127` | W4 (F9) |
| B2 | Reference check retries a 4xx once when the server sent a `detail`, because "do not retry 4xx" is a regex on message text the detail replaces | `web/lib/verify.ts:92`, `:41` | W4 (F9) |
| B3 | The old search page's error listener parses the server's error event with no guard, inside a listener | `web/lib/search.ts:92` | W4 (F9), or gone with 6.1 |
| B4 | The chat's ledger-paper resolver runs the DOI check and the retraction check at the same time on one array that both change; the order rule of `api/search/index.ts:152` is broken | `api/chat/understand-wire.ts:163` | W6 (F12) |
| B5 | Titles with no Latin letter (Devanagari, any non-Latin script) all get the merge key `t:|<year>`, so different Indian-language papers of one year without DOI/PMID are merged into one | `api/search/normalize.ts:18-25`, `api/search/merge.ts:30` | W3 (F3); visible, see 6.18 |
| B6 | Trending's job sorts candidates with a copy of the comparator that lost the last tie-break (`subfield`), so ties order differently from the shared ranking | `api/trending/job.ts:277-278` vs `shared/trending.ts:218-219` | W5 (F2) |
| B7 | `POST /api/v1/chat/tighten` reads its JSON body with no byte limit (the chat's size-limited reader is not used) | `api/chat/routes.ts:1059` (and dev `/judge` `:1013`) | W3 (F10) |
| B8 | The gate caps a lane wait at 30 s in the Durable Object but not in the local lane, so litscan's 120 s wait differs between local runs and production | `api/gate/api-gate.ts:31`, `api/gate/index.ts:87`, `:94`, `api/litscan/model.ts:68` | W6 (F11) |
| B9 | Reference verification calls the retraction check without the injected `fetch`, so the eval's record/replay never reaches it (it goes to the global fetch) | `api/references/verify.ts:51` | W6 (F11) |
| B10 | Deleting the account in Settings leaves the open-access "Ask" conversations on the device and does not start the wipe, unlike sign-out (the privacy rule: a shared computer must not show the last person's questions) | `web/components/SettingsDialog.tsx:42-45` vs `web/lib/auth.ts:73-86` | W8 (F19) |
| B11 | An error in the chat-ownership step during auth refresh makes the page show the person as signed out with no providers | `web/lib/auth.ts:27-48`, `:38`, `:45-48` | W8 (F19) |
| B12 | A reference's record previewed from the reader names its retraction source `crossref` instead of `crossref-retraction-watch` (the label the cards map) | `web/lib/citeStatus.ts:51` vs `web/components/verify/RefCard.tsx:160` | W9 (F21) |
| B13 | The shared copy button always announces "Citation copied to clipboard", also for "Copy all BibTeX" and "Copy flagged references" | `web/components/CiteMenu.tsx:38-40` | W8 (F20) |
| B14 | Two Announcers are mounted over one module-global queue; unmounting one calls `reset()` and drops what the other was about to say | `web/workspace/announcer.tsx:12-33`, `:86`; `web/workspace/HomePage.tsx:585`, `web/workspace/ChatView.tsx:1239` | W8 (F20) |
| B15 | Two global key handlers decide "the person is typing" with weaker tests (tag name only; no select, no dialog), so a shortcut can fire while typing in a select or a dialog | `web/components/PaperPreview.tsx:181`, `web/App.tsx:165` | W8 (F20) |
| B16 | Six copy buttons swallow a failed clipboard write and say nothing | `web/components/oa/OaAskSheet.tsx:85`, `web/components/papers/AskPanel.tsx:181`, `web/components/PaperPreview.tsx:161`, `web/components/papers/NotesPanel.tsx:68`, `web/components/litscan/LitscanPage.tsx:79`, `web/components/litscan/Review.tsx:217` | W8 (F20); words per 6.5 |
| B17 | The page hard-codes the service worker's cache names with `-v1`, while the worker builds them from `VERSION`; the first version bump silently breaks "papers kept offline" and their removal | `web/lib/offline.ts:9`, `:151-152` vs `public/sw.js:13-15` | W8 (F19) |
| B18 | The citation reader never calls `page.cleanup()` in its page loop (memory on long PDFs) | `web/lib/citations.ts:47-52` | W9 (F22) |
| B19 | The copy of the invisible-character list used for "Copy the answer" lacks U+061C, which the server's list strips | `shared/chat-copy.ts:22` vs `api/chat/history.ts:54` | W3 (F3) |
| B20 | The server's ledger caps (600 user chars, 250 title chars) disagree with the browser's (300, 200) although the server's comment says "the browser applies the same caps" | `api/understand/ledger-input.ts:11`, `:35`, `:38` vs `shared/ledger.ts:28`, `:31` | W3 (F4); numbers per 6.15 |
| B21 | The MCP connected-apps page hard-codes `https://sodhsetu.in` (wrong on staging) and uses the `/\/+$/` regex that `api/mcp/scopes.ts:28` calls a ReDoS risk | `api/mcp/apps.ts:66` | W5 (F13) |
| B22 | A variant spelling search that fails is turned into "no papers" and its source still reports ok | `api/search/index.ts:141` | W6 (F12) |
| B23 | Reference verification's cache copy has no in-flight sharing, so identical references checked at the same moment each call upstream (the case `api/search/cache.ts:8-9` warns about) | `api/references/service.ts:33-51` | W6 (F12) |
| B24 | Cache meter labels disagree with keys, so /admin counts `refverify2` hits under `refverify` and `openalex-dois` under `openalex` | `api/references/service.ts:37`, `:48`, `api/chat/understand-wire.ts:159-160`, `api/cache/meter.ts:11` | W6 (F12) |
| B25 | The Workers AI provider reads token usage twice, and the second read has no `input_tokens` fallback (usage can be under-counted) | `api/llm/providers/workersai.ts:137-139`, `:150` | W4 (F8) |
| B26 | Sentry events from account erasure and /admin carry no `release` | `api/monitoring/sentry.ts:250`, `api/account/erase.ts:28`, `api/admin/routes.ts:91`, `:106`, `:132` | W5 (F13), per 6.9 |
| B27 | Unanchored switch tests in the browser chat suite match `CHAT_FLOOR:onx` | `e2e/chat.mjs:1080-1082`, `:1324-1325`, `:1349-1350` | W2 (F24) |
| B28 | `QA_TOP_K` in the oa ask path has no upper bound (docs caps it at 12; dev only) | `api/oa/service.ts:184` vs `api/docs/routes.ts:128-129` | W4 (F7) |
| B29 | Library alert subscribers share the library's listener set, so each redraws on the other's changes | `web/lib/library.ts:118-127` | W8 (F19) |

Test and tooling bugs (the safety net lies; fixed in W2 unless noted):

| # | Bug | Where | Wave |
| --- | --- | --- | --- |
| T-B1 | see B27 | | W2 (F24) |
| T-B2 | The library suite signs in without the privacy ack, unlike every other suite | `scripts/library-e2e.mjs:21-25` | W2 (F24) |
| T-B3 | About 130 `ok(true)` follow a `waitFor` whose timeout aborts the whole suite as one "unexpected error", so every later check is skipped and not counted | e.g. `e2e/admin.mjs:46`, `e2e/auth.mjs:51`, `e2e/papers.mjs:200`, `e2e/workspace.mjs:1072`, `e2e/chat.mjs:1973` | W2 (F24) |
| T-B4 | Eval gates skip themselves when their recording is missing, so a lost recording passes | `eval/understand-route.eval.ts:84`, `eval/understand.eval.ts:212`, `eval/prior-art.eval.ts:33`, `:91`, `eval/eval.eval.ts:329`, `eval/plain-text.eval.ts:156` | W2 (F25) |
| T-B5 | The contrast check always exits 0 | `web-scripts/contrast.mjs:29` | W2 (F25), per 6.17 |
| T-B6 | The fonts budget line passes with zero fonts when the preload plugin finds none | `web-scripts/budget.mjs:56`, `apps/web/vite.config.ts:10` | W2 (F25) |
| T-B7 | The deploy job builds the web app again, so the deployed bundle is not the tested one | `.github/workflows/ci.yml:57` | W2 (F25), per 6.14 |
| T-B8 | Checks guarded by switches no workflow sets never run in CI (`scripts/chat-e2e.mjs:18-21` exits 0 for the whole suite when CHAT_UNDERSTAND is on) | [ti] T2 list | W2 (F24), per 6.12 |
| T-B9 | qa-eval returns null on any SQL failure, so usage numbers go missing silently | `scripts/qa-eval.mjs:24-31` | W2 (F25) |
| T-B10 | ops-e2e swallows the error of restoring the renamed `job_runs` table | `scripts/ops-e2e.mjs:141` | W2 (F24) |
| T-B11 | Two-tab check sends `focus` before the other tab's 800 ms save landed (fix in progress on another branch) | `e2e/chat.mjs:1972` | W2 (F24) |
| T-B12 | Two browser suites default to port 8787 while all others use 8788 | `e2e/smoke.mjs:9`, `e2e/verify.mjs:12` | W2 (F24) |

Count: 28 product bugs (B1-B26, B28, B29; B28 and B8 matter only outside production) and 12 test/tooling bugs (B27 = T-B1, and T-B2 to T-B12).

---

## 6. Decisions only the owner can make

Each is a short question with a recommendation. Until answered, the fix keeps today's behaviour.

1. **The old `/?q=` search results page** (`web/components/SearchBox.tsx`, `web/components/SourceStatus.tsx`, `web/lib/search.ts`, `web/App.tsx:86-187`, `:274-332`, the search stream `api/index.ts:168-189`; reached only by `/?q=` links, e.g. `web/components/litscan/Review.tsx:206`): keep or remove? **Recommend remove**, with `/?q=<words>` opening the Home conversation and searching those words, so existing links keep working. Removes a second search pipeline, one SSE dialect and bugs B3/B22's visible half.
2. **`llm_usage.subject` keeps the user id after account erasure** (`apps/api/migrations/0002_llm_usage.sql:2`; not in `api/account/erase.ts:37-55`; the privacy page lists "How much AI you used ... tied to your account ... 90 days" and does not list it under what deletion removes): erase it, or keep it with a privacy sentence? **Recommend erase the link**: on erasure set `subject` to a fixed `erased` value (cost totals stay for /admin; the rows still expire at 90 days). No privacy sentence is needed for keeping less. Alternative: keep and add "the record of AI use stays for up to 90 days, under an account number that no longer exists".
3. **`ABSTRACT_READ_CHARS`'s pinned test** (`api/chat/abstract-read.test.ts:10`): does it stay as a deliberate rollback lever? **Recommend keep**, renamed "owner's rollback lever: changing this number is a decision" and moved next to `shared/protocol/limits.ts`; delete its sibling that cannot fail (`:106`).
4. **Wording that has drifted** (the fixes keep each surface's words; choosing one is yours): the page title "Verify references" (`web/App.tsx:83`) vs "Check references" everywhere else; seven retraction banners; four stage-label tables ("Checking each claim" / "Reading each claim against its sentences" / "Checking every source against the paper" / "Checking every quote against the paper"); author lines ("Authors unavailable" vs "No authors listed", 3 vs 4 names); "copied" display times (1500, 1600, 1800, 2500 ms); five model-error wordings; two "could not reach the databases" sentences (`api/references/verify.ts:175`, `:249`). **Recommend** one wording each, starting with "Check references" for the title.
5. **Clipboard failure** (B16): show the words `web/lib/copy.ts` already shows in the chat when a copy fails? **Recommend yes.**
6. **User-Agent strings sent to Crossref, OpenAlex and arXiv** ("SodhsetuSearch/0.1", "SodhsetuRefCheck/0.1", "Sodhsetu/1.0" at `api/search/crossref.ts:8-10`, `api/references/lookup.ts:39`, `api/oa/deps.ts:18`, `api/trending/arxiv.ts:70`): unify? It changes what is sent to those services. **Recommend** one "Sodhsetu/1.0 (+mailto)" after W6, in its own one-line PR.
7. **Retire the Semantic Scholar Durable Object** (`api/s2-throttle.ts`; needs a wrangler `deleted_classes` migration) once S2 is a gate lane with the same spacing? **Recommend yes**, a week after W6 is live.
8. **Unused queue binding and empty tables**: `JOBS` (`api/index.ts:48`, `apps/api/wrangler.jsonc:24-26`, `:87`) and tables `usage_ledger`, `jobs` (`apps/api/migrations/0001_init.sql:21-43`). Drop them (a migration and a wrangler change)? **Recommend yes.**
9. **Sentry `release` on erasure and /admin events** (B26) adds a field to what is sent to Sentry. **Recommend yes.**
10. **Speculative and parked code**: `shared/chat-fold.ts` (no production importer, three test files) and the PARKED split view and colour names (`web/components/papers/DocWorkspace.tsx:391`, `:392`, `:472`, `:583`, `web/components/papers/SecondPaper.tsx`, `web/components/papers/NotesPanel.tsx:106`). **Recommend** delete chat-fold unless a release is scheduled; keep PARKED behind the typed flags module.
11. **Finished spikes and one-off builders** ([ti] SU3-SU6: `scripts/spike-*.mjs`, `scan-spike.mjs`, `crossref-burst.mjs`, `r5-*.mjs`, the `-live` tools, `eval/build-*.mjs`, `scrub-fixtures.mjs`, `scripts/r2/run.mjs`): archive or delete? **Recommend** `apps/api/scripts/archive/` with one README line each; keep the data they made. Regardless: `scripts/trending-subfields.mjs:13` has a personal e-mail address hard-coded as MAILTO; it reads `CROSSREF_MAILTO` instead.
12. **CI cost**: run the switch matrix ([ti] T2) and the browser suites ([ti] T11, today weekly) more often? **Recommend** the switch matrix nightly on main, and the browser suites on pull requests that touch `apps/web` or `packages/shared`.
13. **The integration default run uses production positions** (TRENDING off, MCP beta; today it forces Trending on and MCP on, `scripts/integration.mjs:36`, `:60`), with named runs for the other positions? **Recommend yes.**
14. **Deploy the tested build** (T-B7): upload the check job's `dist` and deploy that. **Recommend yes.**
15. **Ledger caps** (B20): the browser's 300/200 or the server's 600/250? The browser sends at most 300 today, so the browser's numbers change nothing for the page. **Recommend 300/200** for both.
16. **Durable stored ids for non-Latin titles** (B5): fixing the key separates papers that are merged today; a library entry saved under `t:|<year>` will not show "Saved" against the new id. **Recommend fix**, with a one-time library migration that leaves such entries as they are.
17. **The contrast check** (T-B5): if today's run reports failures, making it fail CI needs colour changes (visible) or an allowlist. **Recommend** an allowlist of today's failures now, colours later.
18. **One entity decoder** (F3): titles from arXiv, oa and the reference lookup that today show a raw entity such as `&eacute;` will show the character. **Recommend yes** (a bug, but visible).
19. **The privacy text and features changing together** (`web/components/legal/LegalPages.tsx` changes with ChatView 9 times, SettingsDialog repeats retention prose at `web/components/SettingsDialog.tsx:94`): may the Settings sentence be read from the same constant as the privacy table row, so the two cannot drift? It changes no words today. **Recommend yes.**

---

## 7. Done criteria and measures

### 7.1 Measures at the start (main 1c3b3db), and how to rerun them

Rerun after every wave, put the numbers in the PR description and under "Progress" at the end of this file (depgraph.mjs and copies.mjs are the step-2 audit scripts, kept outside the repo until F1 brings the parser in for `layers.test.ts`):

```
node depgraph.mjs <repo> --months=6 --max-commit-files=50 > depgraph.txt
node copies.mjs <repo> > copies.txt
```
and the greps below (production source = not `*.test.*`, run from the repo root).

| # | Measure | Start | Source | Target |
| --- | --- | --- | --- | --- |
| 7.1 | Folder cycles (production) | api: one SCC of 15 folders (6 two-way pairs: library<->root, root<->litscan, ocr<->docs, search<->library, llm<->llm/providers (types), references<->search); web: one SCC of 5 folders (lib -> components/papers, 1 edge) | depgraph 2c | 0 |
| 7.2 | File cycles | runtime 0; type-only 3 SCCs (shared 19 files through index.ts; auth oauth<->providers; chat answer<->support) | depgraph 2a/2b | 0 |
| 7.3 | Stable-to-volatile edges | 133 flagged (55 -> shared/index.ts, 15 -> shared/chat.ts, 12 -> web lib/documents.ts, 12 -> api search/types.ts, 8 -> shared/chat-state.ts, 6 -> search/index.ts, 6 -> shared/legal.ts, 5 -> chat/stub.ts, 4 -> chat/answer.ts, 2 -> docs/routes.ts, 2 -> references/lookup.ts, 1 each PdfViewer, ratelimit, ResultCard, SettingsDialog) | depgraph 7 | under 20, none into an `index.ts`, a `routes.ts` or a `testing/` module |
| 7.4 | Copies across packages | A 10, B 21, C 59, D 31, E 19 regex, F 50 strings (190 groups) | copies.txt | A 0, E 0; B/C/D/F reviewed, only deliberate ones left |
| 7.5 | Dead / local-only / test-only exports | 11 / 253 / 392; files only tests import: 4 | depgraph 4b, 5 | 0 / under 50 / only deliberate seams |
| 7.6 | `ok(true)` checks | 130 | `grep -rhoE "\bok\(\s*true\b" apps/api/scripts apps/web/e2e \| wc -l` | 0 |
| 7.7 | Fixed waits in browser suites | 385 | `grep -rhoE "waitForTimeout\(\|\bsleep\(" apps/web/e2e \| wc -l` | only animation waits behind `axe()`; record the number each wave |
| 7.8 | Tests outside the package of their code | about 53 api test files test shared/web code; 11 api tests read apps/web | `grep -rln "apps/web/src\|/@fs\|web/src/lib" apps/api/src --include=*.test.ts` | 0 |
| 7.9 | Dev-stub switch copies | 15 (`QA_STUB === "1"`); `ENABLE_DEV_ROUTES` read 83 times in production api | `grep -rn 'QA_STUB === "1"' apps/api/src --include=*.ts \| grep -v test` | 1 and 1 (platform/dev.ts) |
| 7.10 | Env types | 46 | `grep -rnE "type (Bindings\|[A-Za-z]*Env) =" apps/api/src --include=*.ts \| grep -v test` | 1 (+ Picks) |
| 7.11 | Model contract importers from docs | 24 | `grep -rn 'docs/qa"' apps/api/src --include=*.ts \| grep -v test` | 0 |
| 7.12 | Hand guards and inline problems | `sameOrigin(c)` 43; inline `c.json({ type` 47 | grep | 0 and 0 |
| 7.13 | DOI regex sites | 25 | `grep -rnE '10\\\\?\.\\\\?d\{4' apps/api/src apps/web/src packages/shared/src --include=*.ts --include=*.tsx \| grep -v test` | 1 (`shared/ids.ts`) |
| 7.14 | Deep shared imports | 15 | `grep -rn "@scholar/shared/src/" apps \| grep -v test` | 0 |
| 7.15 | installGates call sites | 6 | grep | 0 (withPlatform) |
| 7.16 | `sleep` helper definitions | 11 (api + web) | `grep -rnE "(const\|function) sleep\b"` | 2 (platform, web lib/api/retry) |
| 7.17 | Shared modules | 47 (21 web-only, 2 api-only, 2 none) | shared-work/imports.txt | only modules both apps import |

### 7.2 Special cases at the start, by kind

Counted from the eight audits' lists (each `path:line` once) and cross-checked with greps; recount after each wave from the same lists, ticking what each fix removed:

| Kind | Start | Main sources | Fixes that remove most |
| --- | --- | --- | --- |
| An `if` for one value / a parameter for one caller | about 114 (chat 24, services 14, features 25, shared 10, web components 13, web lib 14, test infra 14) | audits' "Special cases" and "a general function with a parameter only one workflow understands" | F4, F6, F7, F17, F18, F21, F24 |
| A swallowed exception | about 106 listed (chat 26, services 27, features 19, shared 6, web components 8, web lib 13, test infra 7); grep of `catch {` / `.catch(() =>` in production source: 327 | audits; `grep -rnE "catch \{\|\.catch\(\(\) =>" apps/api/src apps/web/src packages/shared/src --include=*.ts --include=*.tsx \| grep -v test` | F11, F12, F17 (one fail-open rule per stage), F19 |
| A retry or sleep in product code | about 66 (chat 12, services 5 + 7 sleep helpers, features 8, web components 20, web lib 21); `setTimeout` in web source: 75 | audits | F8 (one malformed retry), F9 (one web retry), F11 (one polite policy), F20/F22 (ready signals, focus contract) |
| A retry or sleep in tests | 385 browser waits, 9 fixed API-suite waits, 6 retries | [ti] | F24 |
| A disabled or self-skipping test | 8 `skip/skipIf/runIf` in api src and eval; 1 never-run real test; about 12 switch-guarded checks CI never runs | grep; [ti] T2, T3 | F24, F25, tests pass |
| A disabled lint rule | 20 `eslint-disable` in web (13 `exhaustive-deps` listed, 3 of them one copied workaround) | `grep -rn "eslint-disable" apps/web/src` | F20 (`useSetWhenChanged`), F21 |
| A hand-written memo comparator | 2 (`web/workspace/ChatView.tsx:934-937`, `web/components/ResultCard.tsx:85`) | [wc] | F21 |

The special cases the redesign keeps on purpose (they are requirements, not accidents): the safety lane's tier order and `core` position, R5's "not read" policy, the R9 trust rule, the visitor cap, `general.ts` refusing to show cited background, the frozen R3 counter definitions, Devanagari queries replaced by the raw message (`api/understand/understand.ts:202-203`), the acronym rule in greetings (`api/understand/greeting.ts:98`), the judge's fallback to the other mark policy (`api/chat/answer.ts:254`), the gate's fallback to a local lane when the Durable Object fails, the illegal-invocation fetch wrapper, the health-wait swallow in integration, workflow-alert's warning-not-failure exit.

### 7.3 Done when

- The special-case counts of 7.2 are as low as the kept list allows (the best single measure).
- 7.1, 7.2, 7.6, 7.8, 7.9, 7.11, 7.12, 7.13, 7.14, 7.15 are at target; `layers.test.ts` in both apps has an empty allowlist.
- A typical change lands in one place: spot-check with three recent releases (a new chat switch, a new search source, a new per-person table) by writing down which files each would touch in the new layout; each is one feature folder plus at most one line in shared vocabulary or the registry.
- A subagent pass over each audit area finds no hidden link, needless link or surplus worth fixing.
- Behaviour is the same as at 1c3b3db apart from the bugs of section 5 and the owner's answers in section 6: goldens at every switch position, `npm run eval` gate table identical, integration with `--browser` and the switch matrix green, budget lines equal or lower, and a final side-by-side click-through of Home, chat, papers, verify, Idea Check, literature scan, settings and /admin on the old and the new build.

---

## Progress

### W1, step 1: F0 (12 Nov 2026, branch `untangle`, on main 002314d)

Commits: the decision log; web dead code and CSS; chat-fold removed (decision 10); API and shared dead code; the scripts archive (decision 11); trending-subfields reads `CROSSREF_MAILTO` (decision 11). Deletions only, apart from the path rewrites of the archived scripts; nothing a person sees and nothing sent to another service changes.

Done as planned: every F0 item of section 2 not listed below, each checked by grep over `apps/`, `packages/`, `.github/`, the scripts and `e2e/` before it went. Things that became unused because of a deletion went with it (the imports of `HighlightsTools.tsx`, `d1Store` in `llm/d1.ts`, `NoRouteError` in `llm/gateway.ts`, `withGate` in `oa/workflow.ts`, `ABSTRACT_READ_CHARS` in `shared/chat.ts`, the `@keyframes ask-bounce` of `.ask-dots`). Aliases with callers were replaced by their target at the call (`tallyOf` -> `refTally`, `notesToMarkdown` -> `notesMarkdown`, `sanitizeInsightsRequest` -> `sanitizeCompareRequest`, `IdeaInsightsRequest` -> `IdeaCompareRequest`, `MAX_TIGHTEN_ABSTRACT` -> `ABSTRACT_READ_CHARS`, `findRetracted` -> the keys of `findRetractionNotices`, `servedPayload` -> `readTrending(...).payload`, `GRANTABLE` -> `SCOPES`).

Kept against the plan, with the reason:
- `api/understand/understand-counters.ts` `isUnderstandCounterName`: legal-match rule 3 loads every `understand/` module and calls each function a plain string can call, with fetch and the AI binding throwing; this is the module's only such function, so without it the run-time check of the module is empty (the test fails). Kept, with a comment that says so; its test now uses `und_retry`. `und_change` itself went.
- `api/oa/sources.ts:163`, `:182` `.catch(() => null)`: not redundant. The lookups run inside `gated(...)`, and `withGate` throws `GateBusy` when the lane is full; the catch turns that into "no record". Removing it would change what happens under load.
- `.github/scripts/workflow-alert.mjs` modes `failure` and `success`: `docs/runbook.md` ("Test it") uses them as the alert self-test.
- Root `package.json` `deploy` script: `docs/runbook.md` ("Manual deploy (only if CI is unavailable)") uses it.
- `public/sw.js` still accepts the `"clear"` message (the page no longer has the type; the service-worker contract is F19's).
- Of the scripts named by decision 11 (SU3 to SU6), kept in place because something calls them: `scripts/staging-session.mjs` (imported by other scripts, read by `api/legal-text.test.ts`), `scripts/intent-holdout.mjs` (its node test runs it; the sealing steps of `docs/eval/intent-writing-guide.md` are still to come), `scripts/intent-replay-plan.mjs` (the E1 recording plan of `docs/eval/README.md`), `scripts/restore-rehearsal.mjs` (the backup rehearsal of `docs/runbook.md`), `eval/build-intent-cases.mjs` (imported by `eval/intent-data.eval.ts`), `scripts/trending-live.mjs` and `scripts/trending-contract-live.mjs` (run by `.github/workflows/trending-live.yml`). The 26 archived ones are listed in `apps/api/scripts/archive/README.md`; every doc that names one now points at `scripts/archive/`.

Kept on purpose (F0 says so): the PARKED split view and colour names, the `ABSTRACT_READ_CHARS` lever (decision 3; only its sibling check that could not fail went), the stand-ins integration uses.

Pending:
- Decision 8, the unused `JOBS` queue binding and the empty `usage_ledger` and `jobs` tables: needs a migration and a `wrangler.jsonc` change, so it is its own small PR.
- Newly local after chat-fold went: `shared/chat-state.ts` `answerWords`, `scanTurns` and `type FinishedTurn` are exported but used only inside the file (depgraph lists them as test-only through a namespace import); their `export` goes with F2.
- A personal address is still hard-coded in `docs/spikes/R8/` (fetchability.mjs, run.mjs, src/index.ts), a finished spike kept as documentation; outside decision 11's list.

Tests removed (unit totals 185 files / 4,485 tests -> 181 / 4,415, 3 skipped before and after): `api/understand/understand-flag.test.ts`, `api/chat/chat-fold.test.ts`, `api/chat/chat-fold-walk.test.ts`, `api/chat/chat-fold-canary.test.ts` (65 cases together); in `api/chat/new-topic.test.ts` the block "the fold starts at the marker too" (4) and two `foldState` lines; in `api/understand/frame.test.ts` "cleanRequest is the topic of a Reading..." (1) and two `cleanRequest` lines. Cases kept with a line less: `support.test.ts` (the `dropUnmarkedNo: false` half), `kv.test.ts` (two `cacheTtl` calls), `abstract-read.test.ts` (the `MAX_TIGHTEN_ABSTRACT` line), `services.test.ts` and `trending/routes.test.ts` (call the function the alias pointed at), `context-before.test.ts` (notices built by a helper, as the function reads only the kind).

Verification (before = main 1c3b3db, after = `untangle` on 002314d): typecheck clean; `npm test` 4,482 passed / 3 skipped -> 4,412 / 3; `npm run test:scripts` 179 -> 179; `npm run eval` 441 passed / 1 skipped -> the same; build clean; `node apps/api/scripts/integration.mjs` all passed, 0 FAIL: 1,034 checks -> 1,048, every suite the same count except "chat tools integration" 3 -> 17, which is main's CHAT_TOOLS turned on (002314d), not this change.

Budget (`npm run budget -w apps/web`, gzip), before -> after: first-load scripts 243.5 -> 243.4 KB (of 250); first-load style sheet 23.8 -> 23.5 KB (of 26); preloaded fonts 166.6 -> 166.6; intro chunk script 14.4 -> 14.4, style 6.6 -> 6.6; PDF reader 62.0 -> 62.0; Rive runtime 55.7 -> 55.7, wasm 336.6 -> 336.6, Rive files 5.3 -> 5.3.

Measures (depgraph.mjs, `--months=6 --max-commit-files=50`):

| Measure | Before (1c3b3db) | After |
| --- | --- | --- |
| 4a files nothing imports (entries excluded) | 0 | 0 in production; the 26 archived CLIs show here because depgraph's script-entry rule matches `apps/api/scripts/*.mjs` only, not `scripts/archive/` |
| 4b production files only tests import | 4 (`clean-cases.ts`, `trending/fake-kv.ts`, `hostile-messages.ts`, `understand-flag.ts`) | 3 (`understand-flag.ts` gone) |
| 7.5 dead exports | 11 | 0 |
| 7.5 local-only exports | 253 | 237 |
| 7.5 test-only exports | 392 | 377 |

### W1, step 3: F5, one Env (12 Nov 2026, branch `w1-env`, on `untangle` d38b079)

Commits: the generated bindings and the CI check; one `Env` in `api/platform/env.ts`, which every module picks from; this log. Types only: the production bundle of `wrangler deploy --dry-run` is byte-for-byte the same before and after (`index.js` 4,553,601 bytes both times, `cmp` equal; upload 4,446.88 KiB / gzip 1,063.12 KiB both times).

Done as planned:
- `apps/api/worker-configuration.d.ts` is generated by `npm run cf-typegen -w apps/api` (`wrangler types --env-file=typegen.env --include-runtime=false --strict-vars=false`) and is in `tsconfig.json`'s `include`. CI (`.github/workflows/ci.yml`, before typecheck) runs it and fails on `git diff --exit-code -- apps/api/worker-configuration.d.ts`.
- `api/platform/env.ts`: `Env = Cloudflare.Env & SecretsAndVariables`, where the second half declares, once, every secret, every switch that is a Worker variable only while set, and every variable of local runs and tests, each with the doc comment it had in `api/index.ts`, `api/chat/routes.ts`, `api/docs/routes.ts`, `api/llm/index.ts`, `api/auth/providers.ts`, `api/search/types.ts`, `api/litscan/model.ts` or `api/trending/routes.ts`. The 9 variables missing from the Worker's `Bindings` (`CHAT_JUDGE`, `OCR_PAGES_PER_DAY`, `QA_TOP_K`, `LLM_QA_MODEL`, `LLM_REASONING`, `LLM_CLASSIFY_MODEL`, `LLM_VERIFY_MODEL`, `SEARCH_PLAINTEXT`, `SSE_KEEPALIVE_MS`) are in it, typed `string | undefined` as the code reads them. `EnvPick<Need, Optional>` is `Pick<Env, Need> & Partial<Pick<Env, Optional>>`, for a module that runs without a binding (a test, a local run); `HonoEnv = { Bindings: Env }`.
- Entry points take `Env`: the Worker's `fetch` and `scheduled` (`satisfies ExportedHandler<Env>`), the two Workflows (`WorkflowEntrypoint<Env, ...>`), the MCP OAuth provider (`OAuthProvider<Env>`), the Hono app and every router (`Hono<HonoEnv>`, also `references/routes.ts` and `trending/routes.ts`, which had narrower ones). Every other module takes `Pick<Env, ...>` / `EnvPick<...>`, or a named slice built only from those (`CacheEnv`, `LlmEnv`, `SentryEnv`, `LimitEnv`, `AuthEnv`, `SearchBindings`, `SearchEnv`, `LookupEnv`, `ReferenceEnv`, `RetractionServiceEnv`, `OaEnv`, `ScanEnv`, `McpFlagEnv`, `McpOAuthEnv`, `McpEnv`, `TrendingJobEnv`, `TrendingRouteEnv`, and a few file-local ones), each keeping the optional names it had, so no test needed a new field.
- One `OaEnv` (`api/oa/service.ts`: `LlmEnv & EnvPick<...>`); `api/oa/workflow.ts`'s went (the Workflow takes `Env`), and the padding lines (`OCR_PAGES_PER_DAY`, `GEMINI_API_KEY`) with it. `api/account/erase.ts` says what erasure reads (`EraseEnv`: `DB`, `FILES`, `PUBLIC_BASE_URL`, `OAUTH_KV` optional, `SENTRY_*`); the account router is typed with the whole `Env`.
- `currentUser` is generic over a context whose bindings have `DB` (no `Context<any>`, no cast). `api/sse.ts` reads its two variables through `Pick<Env, ...>` instead of a cast.

Counts (pattern `type (Bindings|*Env|*Bindings) =` over `apps/api/src`, the string in `legal-match.test.ts` left out):
- Env types that write a binding's or a variable's type by hand: 46 -> 1 (`api/understand/flags.ts` `FlagEnv`, kept, below). Plus `SearchBindings` (`api/search/env.ts`), which the 46 did not count: also now a `Pick`. Plus inline parameter types (`{ CROSSREF_MAILTO: string }`, `{ OPENALEX_API_KEY?: string }` x2, `{ PUBLIC_BASE_URL?: string }`, `{ OAUTH_KV?: ...; PUBLIC_BASE_URL?: string }`): 5 -> 0. `CROSSREF_MAILTO: string` is written once (env.ts), down from 17.
- After: 23 type aliases in production code match the pattern besides `FlagEnv` and the two of env.ts (`Env`, `HonoEnv`), all built from `Env` (`Pick`, `EnvPick` or an intersection of such slices).
- Env casts in production code: 15 -> 1. `as never` on an env or for an env's sake: 7 -> 0 (`index.ts:366` the handler, `mcp/server.ts:279`, `chat/routes.ts:457`, `:468` the session, `oa/service.ts:182`, `:202`, `oa/routes.ts:53`); other env casts: `index.ts:366` `as unknown as McpEnv`, `auth/http.ts:24`, `sse.ts:33`, `chat/routes.ts` `env as Bindings` x4, `mcp/apps.ts:66` `as McpOAuthEnv` -> only the last stays, as `env as Pick<Env, "OAUTH_KV">` (below).

Kept against the plan, with the reason:
- `api/understand/flags.ts` `FlagEnv = { CACHE?: FlagKv }`: a port, not a copy of the binding. `FlagKv` is the one `get` that `flagOf` uses, so the real `KVNamespace` fits and a test passes a get-only fake; `understand/` must stay network-free and import only shared, the model port and switch types (legal-match rule 3, section 1.5). F6 moves the reader to `platform/switches.ts` and decides its env type there.
- `api/mcp/apps.ts` `revokeAllApps`: `env as Pick<Env, "OAUTH_KV">` right after `if (!env.OAUTH_KV) return 0`. TypeScript does not narrow an object by one property's check, and the way round it (a local `kv`, or a new object) would change the emitted code, which this fix must not. It is an honest narrowing now; before, it claimed `DB` and the sign-in names too.
- `api/search/arxiv.test.ts:61`, `:66` `store: undefined as never`: a test file, and the type change does not force it; F1 (in parallel) owns the test files, so it waits for the tests pass (section 4.2). The plan lists it under F5.
- `api/understand/flags.test.ts:495` declares a `Bindings` of its own on purpose (it proves a Worker's type can be passed to `flagOf`); a test, not forced.
- `wrangler types` runs with `--include-runtime=false`: the runtime types stay `@cloudflare/workers-types` (tsconfig `types`), as before; generating them as well would change every runtime type at once, which is not F5. `--strict-vars=false`: a var is `string`, not its literal (`"off"`), since the code compares `TRENDING` with `"dark"` and tests pass other positions. `--env-file=typegen.env` (an empty file with a comment): without it wrangler adds the names of a local `.dev.vars`, so the generated file would differ between the owner's machine and CI.
- `wrangler dev` compares the file's hash against one made with the local `.dev.vars` and may print "Your types might be out of date" on a machine that has one; it only prints (no `dev.generate_types`), and `npm run cf-typegen` / CI are the check.

One test line changed, forced by the change: `api/chat/routes-context.test.ts:404` pins the signature `judgeStreamFor(env: Bindings, ...)`, now `judgeStreamFor(env: Env, ...)`.

Verification (before = `untangle` d38b079 after F0, after = `w1-env`): `npm run typecheck` clean; `npm test` 4,412 passed / 3 skipped (181 files) -> the same; `npm run test:scripts` 179 -> 179; `npm run eval` 441 passed / 1 skipped -> the same; `npm run build` clean and every size budget met (unchanged numbers); `wrangler deploy --dry-run` bundle byte-equal (above); `node apps/api/scripts/integration.mjs` all passed, 0 FAIL, 1,048 checks -> 1,048. `npm run cf-typegen -w apps/api` leaves the committed file unchanged, and a var added to wrangler.jsonc makes the CI step's `git diff --exit-code` fail (tried, then undone).

Merging with F1: F5 changed one test file (`chat/routes-context.test.ts`, one line) and added no test. Every type a test imports keeps its name (`McpEnv`, `SearchEnv`, `LlmEnv`, `CacheEnv`, `OaEnv`, ...), so a test F1 moves keeps compiling; a moved test that imports `../platform/env` would need its relative path, but none does.
