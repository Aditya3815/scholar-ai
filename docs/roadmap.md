# Roadmap and status

The living plan. Updated after every piece of work; the dated log at the bottom says what changed and when. Older detail: the
private "START HERE" notes (not in the repo) and the spike write-ups in `docs/spikes/`.

Legend: ✅ done and verified · 🟡 partly done · 🔨 in progress · ⏳ planned · ❓ needs a decision from Aditya

## Where we are (2026-10-21)

Live at https://scholar.shodhsetu.workers.dev. Search (4 sources, retraction and DOI checks), Reference Verifier, uploaded papers with a
real PDF reader and grounded, verified Q&A (streaming), library, Google/ORCID sign-in, **Idea Check (M1)**, "Report a problem" buttons and an admin page. Citation eval gates run on
every push. Cloudflare: Workers Paid, R2 Paid.

**Pushed 19 Oct:** the Verifier, Idea Check M1 and feedback/admin work, with the eval green (genuine 98/100, held-out 57/60, fabricated verified 0/70). On 21 Oct two scheduled workflows were found failing and fixed (see N1).

## Phase 0: foundations

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| A1 | LLM spike R2 | ✅ | gpt-oss-120b: 88% grounded, 100% refusal |
| A2 | LLM gateway, private-only routing | ✅ | + streaming; tests prove private data never reaches Gemini/free providers |
| A3 | Login (Google, ORCID) | ✅ | PKCE, hashed sessions, CSRF |
| A4 | Library, settings, export, delete | ✅ | account deletion also removes uploaded papers |
| A5 | Eval harness + held-out set | ✅ | tuned 100%, held-out 93%, fabricated verified 0/70 |
| A6 | Platform hardening | 🟡 | CSP, rate limits, Durable Object throttle, cron, CI integration, runbook ✅. **Sentry, staging, Turnstile ⏳** |
| A7 | GROBID spike | ✅ | works (R1); decided not to host it yet (R1b) |
| A8 | Privacy policy, Terms, "How we verify", retention | ⏳ ❓ | needs contact email, entity name, product name |
| A9 | Rotate every key pasted in chat, make repo private | ⏳ ❓ | Aditya |

## Phase 1: upload, ask, verify

| Epic | Status | Notes |
| --- | --- | --- |
| E1 Upload + ingest | ✅ | browser reads the PDF; Worker chunks and embeds (bge-m3). 25 MB, 500 pages. Scanned PDFs fail with a clear message |
| E2 Paper workspace | 🟡 | viewer, thumbnails, zoom, highlight, **Contents menu** ✅. notes/highlights ⏳, search in paper ⏳ |
| E3 Grounded Q&A | ✅ | verified quotes, refusal, streaming stages. 24/24 correct on the gold set |
| E4 Reference Verifier | ✅ | paste/BibTeX/file; **References tab for an uploaded paper** (checked, retracted citations called out) ✅ |
| E5 Privacy + trust | 🟡 | delete and export ✅ (now include reports). **"Report a problem"** on answers, references and idea searches ✅ (says what it sends; kept a year). First-upload privacy card, consent ⏳ (A8) |
| E6 Onboarding | 🟡 | home page has three "start with" cards (Idea Check, Verify, My papers); each tool has an example. A sample paper ⏳ (needs an openly licensed PDF) |
| E7 Admin / cost | ✅ | `/admin` (admins only): people, papers, questions, AI tokens per day and per model, failures, reports. Numbers only, no paper or idea text |
| E8 Notifications | ⏳ | not needed yet |
| E9 Quality | 🟡 | citation eval in CI ✅. Weekly Q&A workflow (`qa-eval.yml`, `--gate`) ✅ ran green in CI on 21 Oct |

## Paper intelligence v1 (GROBID-free): done, see docs/spikes/R1b-grobid-alternatives.md

| Step | Status |
| --- | --- |
| 1. Browser extraction: title, DOI/arXiv id, PDF outline, headings, reference block split into entries | ✅ 5/5 titles exact, reference count within 1 of GROBID on all five |
| 2. Store it per paper; metadata from OpenAlex/Crossref by DOI | ✅ also gives a paper its real title; publisher's list as fallback |
| 3. References tab: every entry checked by the Verifier, retracted citations called out, export | ✅ |
| 4. Contents (outline) menu in the reader | ✅ |
| 5. OpenAlex as a second lookup source in the Verifier (arXiv/preprints) + fixes found by running real papers | ✅ built: 21% (rate-limited) → 78% of the five papers' 175 references verified (R1b spike, "Result: the Verifier"). Eval: genuine 98/100, held-out 57/60, fabricated verified 0/70. One recording to add, then push |
| 6. Docling in Cloudflare Containers for scanned PDFs (OCR) and tables | ⏳ later |

## Master backlog (2026-10-21): everything that is left

Owner: **me** = Claude can do it alone · **you** = Aditya must do or decide it · **both** = I build, you supply something. IDs are stable; the plan below refers to them.

### 1. Right now (broken or unverified)
| ID | Item | Owner | Notes |
| --- | --- | --- | --- |
| N1 | Two scheduled workflows failed: "Q&A quality" (web app was not built before the Worker started) and "Browser e2e" (an axe colour reading taken while an answer was still fading in) | me | ✅ Fixed 21 Oct. Browser e2e passes again. Q&A had three causes (no web build, no dev sign-in flag, `tee` hiding the exit code); now green |
| N2 | Recreate `apps/api/.dev.vars` (lost on 19 Oct; names are in `.dev.vars.example`) | you | Blocks every local live test (live eval, Idea Check live run, real-paper check). Production is unaffected |
| N3 | Four Dependabot PRs open (checkout 7, setup-node 7, upload-artifact 7, workers-types 5.x) | both | CI passes on all four. The three action bumps are safe to merge; workers-types is a major version, I check it first |
| N4 | The Q&A weekly workflow had never produced a result | me | ✅ First real run in CI, 21 Oct: answerable 24/24, unanswerable declined 10/10, sources verified 24/24, median 4.3 s |

### 2. Product, Phase 1 leftovers
| ID | Item | Owner | Notes |
| --- | --- | --- | --- |
| P1 | Privacy policy, Terms, "How we verify" page, data retention text | both | 🟡 Written and live as drafts at `/privacy`, `/terms`, `/how-we-verify` (linked in the footer). Every missing detail shows as a marked blank. **To finish: fill `LEGAL` in `apps/web/src/lib/legal.ts` (entity, address, contact and grievance e-mail, jurisdiction, date), then a lawyer reads it** |
| P2 | First-upload privacy card and consent record | both | ✅ Built: shown before the first upload and the first idea check; the server refuses both until it is agreed to and records which text and when (migration 0008). Bumping `PRIVACY_VERSION` asks everyone again |
| P3 | Notes and highlights in the paper reader; search inside a paper | me | E2 |
| P4 | Onboarding sample paper | both | Needs one openly licensed PDF we may bundle (licence to be confirmed) |
| P5 | Sentry (errors), Turnstile (bot check on sign-in), staging environment | both | **Sentry: built** (own thin client, nothing leaves until `SENTRY_DSN` is set; steps in the runbook). Turnstile: I suggest dropping it for now, because sign-in is Google/ORCID only and uploads/asks are already limited per account. Staging: waiting for your yes to create a second D1/R2 |
| P6 | Manual screen-reader (NVDA) pass | you | axe is clean on every page; a person is still needed |
| P7 | Q&A first answer text under 2.5 s (now 1.5 to 3.3 s) | me | Phase 1 exit gate, partly met |
| P8 | Pilot with 20 to 30 scholars | you | Needs 10 names first; I prepare the invite text, a short survey and the admin view |

### 3. Verifier and data quality
| ID | Item | Owner | Notes |
| --- | --- | --- | --- |
| V1 | Two tuned references (McMurray 2019, Murray 2022) fell from verified to not_found / mismatch | me | ✅ Found and fixed 21 Oct: for a reference written with initials the title guess picked a piece of the author list ("V., Solomon, S") instead of the title. Tuned set is back to 100/100; held-out 57/60; fabricated verified 0/70 |
| V2 | Better search title for references that start with initials | me | ✅ Same fix as V1 (no full re-record needed: the few new requests were added with `eval/patch-fixtures.mjs`) |
| V3 | Wording for reprints (year differs, authors match) and for books, reports and web pages ("not a journal article") | me | These are most of the remaining 22% that do not verify |
| V4 | Records for software and datasets (Zenodo, GitHub) appear in Idea Check; filter or label them | me | |
| V5 | Crossref calls from one global lane (Queue) instead of per-process | me | Today's gate is per isolate |
| V6 | Cache public lookups (DOI to record) in KV | me | Protects the OpenAlex budget |

### 4. Idea Check (the big differentiator)
| ID | Item | Owner | Notes |
| --- | --- | --- | --- |
| I1 | **M2**: split the idea into facets, compare each of the top papers with a quoted sentence from its abstract (checked like Q&A quotes), show a coverage map | me | The core of "has it been done" |
| I2 | Prior-art recall eval: hide a paper, rebuild its idea from the abstract, see how many of its own references come back | me | Gate before M2 is shown to anyone. Needs OpenAlex budget |
| I3 | **M3**: gaps, feasibility (grounded vs opinion, labelled), grounded answer to the question, downloadable report | me | |
| I4 | More sources (arXiv, PubMed, CORE), open-access full text for the closest papers | me | |
| I5 | Calibration against RINoBench; 20 ideas judged by real scholars | both | Scholars are yours |
| I6 | Hands-on comparison with Elicit, Undermind, Consensus, SciSpace before any public claim | you | I can prepare the comparison sheet |
| I7 | Idea history (opt-in, deletable) so a researcher can come back to a check | me | Currently nothing is stored, by design; this needs a decision |

### 5. Platform and scale
| ID | Item | Owner | Notes |
| --- | --- | --- | --- |
| S1 | "Chat with this paper" for open-access search results | me | Also the preview path for Idea Check |
| S2 | Collections and Q&A across papers (Vectorize, one namespace per user) | me | |
| S3 | Retraction re-check of saved papers (weekly cron) with a notice | me | |
| S4 | Long jobs as Workflows; bulk jobs on Queues | me | When a job no longer fits one request |
| S5 | Scanned PDFs (OCR) and tables: Docling in Cloudflare Containers | me | |
| S6 | OpenRouter free models as a fallback for public-data tasks only; paid zero-retention route only after it passes the Q&A gate | me | Needs the $10 credit decision (D2) |
| S7 | Search in more Indian sources (Shodhganga theses, regional journals) | both | Research first: licences and APIs |
| S8 | Uptime check, alert when a cron or workflow fails, cost alerts | both | Alerts need an e-mail or phone channel from you |
| S9 | Backups: D1 Time Travel and R2 restore steps written and rehearsed once | me | |

### 6. Legal, trust and money (non-technical)
| ID | Item | Owner | Notes |
| --- | --- | --- | --- |
| L1 | Product name: **Scholar AI** (decided 21 Oct). Still to do: check the name is free to use (trademark and domain), logo | you | The name is now in the app, the page titles, the sign-in dialog and the export file name |
| L2 | Legal entity, contact and grievance officer (India's DPDP Act asks for a notice, consent, a grievance route and a deletion route; we have the last one) | you | Have a lawyer read P1 before launch |
| L3 | Google sign-in: confirm the OAuth consent screen is published (not "Testing") and brand-verified, so people outside the test list can sign in | you | Easy to forget, blocks any pilot |
| L4 | ORCID: production (not sandbox) credentials | you | Check |
| L5 | Custom domain, then update the Google/ORCID redirect addresses | both | Before the public beta |
| L6 | Business model: free allowance per person, what a paid plan covers, who pays for AI use | you | I can model the cost per active scholar |
| L7 | Rotate every key that was ever pasted in chat (OpenAlex, S2, NCBI, CORE, Gemini, OpenRouter, Google, ORCID, Cloudflare); make the repo private | you | I do the production secret updates once you have new keys |
| L8 | Billing alerts on Cloudflare; cancel "Images Stream Basic" if it is not wanted | you | |
| L9 | Two-factor sign-in on GitHub, Cloudflare, Google Cloud, OpenRouter, OpenAlex accounts | you | |
| L10 | Copyright view on users uploading PDFs (private, per account, deletable) and on the bundled sample paper | you | Part of the lawyer's read |
| L11 | Support channel (an address, answered within a day) and a short FAQ | both | I write the FAQ |
| L12 | Launch plan: who hears about it first (a department, a research methods course, a supervisor network), how feedback is collected | you | I can draft it |

### 7. Decisions that unblock the most work
| ID | Decision | Unblocks |
| --- | --- | --- |
| D1 | OpenAlex plan: **$5 prepaid balance bought (21 Oct, expires in 90 days)**, on top of the free $1/day; the prepaid amount is used only after the day's $1 runs out. Still open: a separate key for development and the eval, so production never competes with tests | V2, I2, V6, anything live |
| D2 | One-time $10 on OpenRouter (free-model limit rises from 50 to 1,000 a day) | S6 |
| D3 | ~~Product name~~ (decided: Scholar AI). Still needed: legal entity, address, contact and grievance e-mail, jurisdiction (L2) | P1 final, L5 |
| D4 | Do Idea Check results get saved (I7)? | I7 |
| D5 | Ten pilot names (P8) | P8, I5 |

## Plan: four milestones

Each milestone ends with a check that has to pass before the next one starts. After every piece of work: tests and the eval gates run, the roadmap is updated, and a push happens only when CI is green.

### Milestone 1: safe to show to other people (about one week)
Goal: nothing embarrassing or unsafe if a stranger signs in.
1. Read the two re-runs of the failed workflows (N1, N4); merge the safe Dependabot PRs (N3). *me*
2. Look into the two lost verifications (V1) and fix the wording for reprints, books and web pages (V3). *me*
3. Write the Privacy policy, Terms and "How we verify" with the blanks marked, and build the first-upload privacy card (P1, P2). *me, then you fill the blanks (D3)*
4. Sentry, Turnstile and a staging environment, all inert until you give the keys (P5). *me*
5. Your side, in parallel: recreate `.dev.vars` (N2), choose the OpenAlex plan (D1), publish and verify the Google sign-in screen (L3), check ORCID (L4), rotate the keys and make the repo private (L7), turn on two-factor sign-in (L9), billing alerts (L8).
Exit check: every workflow green; the legal pages drafted and linked; a stranger can sign in with Google; no key from the chat is still live.

### Milestone 2: ready for a pilot (about one to two weeks)
Goal: ten real scholars use it and we learn from them.
1. Notes, highlights and search inside a paper (P3); the sample paper (P4); answer speed (P7). *me*
2. Idea Check M2 (I1) behind the prior-art recall eval (I2). The recall number is the gate: nothing about "coverage" is shown to a pilot user until it is measured. *me, needs D1*
3. The title improvement and one full eval re-record (V2); the wording and software/dataset filter (V4). *me*
4. Alerts: a failed cron or workflow reaches you (S8); backups rehearsed (S9). *both*
5. Screen-reader pass (P6). *you*
6. Invite text, a five-question survey, and a weekly routine: read `/admin` and the reports every Monday (P8). *me prepare, you invite*
Exit check: 10 scholars have used it for a week; the weekly Q&A and eval are green; every report was read; a list of the top five complaints exists.

### Milestone 3: the part nobody else has (about two to three weeks)
Goal: Idea Check is the reason to come back.
1. Idea Check M3 (I3), more sources and open-access full text (I4), saved history if you choose it (I7). *me*
2. Chat with an open-access paper (S1); retraction notices on saved papers (S3). *me*
3. Free-model fallback for public tasks (S6), after the Q&A gate passes with it. *me, needs D2*
4. Calibration and 20 ideas judged by scholars (I5); the hands-on comparison with other tools (I6). *both*
Exit check: scholars say Idea Check found something they did not know, or confirmed what they knew, in most of the 20 cases; no wrong "verified" in any report.

### Milestone 4: public beta (about two to three weeks)
1. Collections and cross-paper Q&A (S2); Workflows and Queues where jobs outgrow a request (S4, V5, V6); OCR for scanned PDFs and tables (S5); Indian sources (S7). *me*
2. Name, domain, logo, redirect addresses (L1, L5); cost per active scholar and the plan (L6); support address and FAQ (L11); launch plan (L12); the lawyer's read (L2, L10). *you, with drafts from me*
Exit check (the public-beta gate): 0 fabricated citations in the eval and in reports; Q&A gate green for four weeks in a row; legal pages final; cost per scholar known; support answered within a day during the pilot.

### What I would do first, today, without waiting for anything
N1/N4 results, N3, V1, V3, then the legal drafts (P1, P2) and Sentry/Turnstile/staging code (P5). They need nothing from you except, later, the blanks.

## What the paid plans give us, and how we use it

Workers Paid (from the plan page): 10M requests/month included, CPU up to 5 min per request (default 30 s), 10,000 subrequests per request,
10 MB script, 500 Workers, 250 cron triggers; D1 with 150x the free row reads; Queues retention up to 14 days; KV 10x; Vectorize 2x stored vectors.

| Platform piece | Use here | When |
| --- | --- | --- |
| **Workflows** (10,000 steps, state kept 30 days, retries) | Idea Check and bulk jobs as durable multi-step runs with progress | Idea Check M1 |
| **Queues** (retries, up to 14 days, batches of 100) | one global lane for Crossref calls (3/s limit; today only a per-isolate gate), reference verification of long lists, embedding big papers | after Idea Check M1 |
| **KV** | cache of public lookups (DOI to record, search results) with a TTL: fewer Crossref/OpenAlex calls, which also protects the OpenAlex $1/day key budget | soon, small |
| **Vectorize** (50,000 namespaces per index on Paid, 20M vectors, 1,536 dims max) | cross-paper Q&A and collections; one namespace per user keeps tenants apart. Today's per-paper vectors in D1 stay as they are | Phase 2 collections |
| **D1** (more row reads) | stays the system of record; room for more caching tables | now |
| **Cron** (250) | weekly Q&A eval, live eval, retraction re-check | next |
| **Containers** | Docling or GROBID if scanned PDFs or tables matter | later |
| 5 min CPU, 10,000 subrequests | long paper analysis no longer has to be chunked by the browser; keep the browser step for privacy and speed | optional |

OpenRouter (dashboard shows key "Sodhsetu", 2 requests, $0.00; 23 free models in the filter, among them a free embedding model): free models are for
**public data only** (hosts may log or train). Good uses: summarising or classifying public abstracts, chatting with open-access papers, a
fallback when Workers AI is busy. Never the user's own files or ideas. Limits we found earlier: 20 requests/min and 50/day, or 1,000/day after
a one-time $10 of credit; the roster changes, so every model must pass the Q&A eval before use and the allowlist is reviewed weekly.

## Phase 1 exit gate

| Gate | Status |
| --- | --- |
| 0 fabricated citations, retraction recall 100% | ✅ |
| Q&A groundedness >= 85%, refusal >= 90% | ✅ (smoke set; grow it) |
| 20-page ingest < 90 s | ✅ (about 10 s) |
| Q&A first token < 2.5 s | 🟡 pages and stages show in about 0.3 s; the answer text starts at 1.5 to 3.3 s |
| a11y: axe 0 violations + one manual NVDA pass | 🟡 axe ✅, NVDA ⏳ |
| Pilot with 20 to 30 scholars | ⏳ ❓ names needed |
| Tenant isolation tests, no manuscript text in logs, delete verified | ✅ (R2 delete is not covered by a test) |

## Decisions waiting for Aditya

Product name (Scholar / ShodhSetu) · contact and grievance email, entity name · pilot users (10 names) · rotate keys · custom domain · whether
to keep the "Images Stream Basic" subscription (we do not use it).

## Log

- 2026-10-21: two scheduled workflows failed (Q&A quality: the web app was not built before the Worker started; Browser e2e: an axe reading taken while an answer faded in). Both fixed and re-run. Full backlog and a four-milestone plan written (above). Also: on 19 Oct a temporary git worktree with a node_modules junction was force-removed and deleted tracked files and `apps/api/.dev.vars` through the junction; tracked files were restored from git, `.dev.vars` was not recoverable (N2).
- 2026-10-19: Idea Check M1 (read PDF/Word/LaTeX/Markdown/text in the browser, approve the search plan, closest papers by meaning with DOI and retraction checks, report of what was searched); "Report a problem"; admin page; home start cards; weekly Q&A workflow; R2 deletion is now tested. Fixed: answers lost double letters ("process" became "proce "), Crossref titles with markup, top bar too wide for four tabs. OpenAlex's $1/day budget ran out during the eval re-record.
- 2026-10-18 (late): researched the "Idea Check" product idea (docs/design/idea-check.md) and what Workers Paid and OpenRouter free models can be used for; pending list rewritten above.
- 2026-10-18 (night): Verifier: Crossref calls gated to its 3/s limit, OpenAlex title search and arXiv-id lookup as a second source, three false accusations fixed (wrapped DOIs, markup in titles, broken words). Real-paper verification 21% → 78%. Eval re-record in progress.
- 2026-10-18 (later): paper intelligence v1 shipped: References tab, Contents menu, real titles and metadata for uploads; measured on the five real PDFs.
- 2026-10-18: held-out eval; uploaded papers + grounded Q&A + preview + My papers UI; answer streaming; GROBID alternatives spike;
  Workers Paid active; this roadmap created.
