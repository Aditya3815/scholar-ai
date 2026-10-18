# Roadmap and status

The living plan. Updated after every piece of work; the dated log at the bottom says what changed and when. Older detail: the
private "START HERE" notes (not in the repo) and the spike write-ups in `docs/spikes/`.

Legend: ✅ done and verified · 🟡 partly done · 🔨 in progress · ⏳ planned · ❓ needs a decision from Aditya

## Where we are (2026-10-18)

Live at https://scholar.shodhsetu.workers.dev. Search (4 sources, retraction and DOI checks), Reference Verifier, uploaded papers with a
real PDF reader and grounded, verified Q&A (streaming), library, Google/ORCID sign-in. Citation eval gates run on every push.
Cloudflare: Workers Paid, R2 Paid.

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
| E5 Privacy + trust | 🟡 | delete and export ✅. First-upload privacy card, consent, retention ⏳ (A8) |
| E6 Onboarding | ⏳ | 3 steps and a sample paper |
| E7 Admin / cost | ⏳ | usage ledger exists; dashboard does not |
| E8 Notifications | ⏳ | not needed yet |
| E9 Quality | 🟡 | citation eval in CI ✅. Q&A eval not in CI ⏳ |

## Paper intelligence v1 (GROBID-free): done, see docs/spikes/R1b-grobid-alternatives.md

| Step | Status |
| --- | --- |
| 1. Browser extraction: title, DOI/arXiv id, PDF outline, headings, reference block split into entries | ✅ 5/5 titles exact, reference count within 1 of GROBID on all five |
| 2. Store it per paper; metadata from OpenAlex/Crossref by DOI | ✅ also gives a paper its real title; publisher's list as fallback |
| 3. References tab: every entry checked by the Verifier, retracted citations called out, export | ✅ |
| 4. Contents (outline) menu in the reader | ✅ |
| 5. OpenAlex as a second lookup source in the Verifier (arXiv/preprints) + fixes found by running real papers | 🟡 built: 21% (rate-limited) → 78% of the five papers' 175 references verified (R1b spike, "Result: the Verifier"). **Eval gates being re-recorded**, then push |
| 6. Docling in Cloudflare Containers for scanned PDFs (OCR) and tables | ⏳ later |

## Everything still pending (2026-10-18)

**In progress**
- Verifier step 5: eval re-record running, then check gates G1 to G6 and held-out, then push.

**Phase 1 leftovers (finish before a public pilot)**
| Item | Notes |
| --- | --- |
| Privacy policy, Terms, "How we verify", first-upload privacy card, retention (A8, E5) | needs contact/grievance email, entity name, product name |
| Sentry, staging environment, Turnstile (A6) | |
| Onboarding: 3 steps and a sample paper (E6) | |
| "Wrong answer / wrong citation" button feeding the eval set | |
| Admin page: usage and cost (E7) | the usage ledger exists |
| Q&A eval weekly in GitHub Actions (E9); free OpenRouter as public-data fallback; paid ZDR route only after qa-eval passes | |
| Notes and highlights, search inside a paper (E2) | |
| a11y: one manual NVDA pass | axe is clean |
| Test that account deletion removes R2 files | |
| Pilot with 20 to 30 scholars | needs 10 names from Aditya |

**Phase 2: new capabilities**
| Item | Notes |
| --- | --- |
| **Idea Check**: bring an idea (PDF/docx/md/txt) and a question; get prior work with verified citations and previews, a coverage map, gaps, a grounded answer | researched: [design/idea-check.md](design/idea-check.md). Build in three milestones (M1 related work, M2 facets + coverage map + prior-art recall eval, M3 gaps/feasibility/report) |
| "Chat with this paper" for open-access search results (import the PDF) | also the preview path for Idea Check |
| Collections and Q&A across papers | Vectorize, one namespace per user |
| Docling in Cloudflare Containers: scanned PDFs (OCR) and tables | later |
| Weekly retraction re-check of saved papers, with a notice | uses cron (250 allowed on Paid) |
| Custom domain before public beta | |

**Aditya's side**
Rotate every pasted key (incl. OpenRouter) and make the repo private · product name · contact and grievance email, entity name · 10 pilot names ·
billing alert · cancel "Images Stream Basic" if unintended · custom domain · decide about the one-time $10 OpenRouter credit (see below) ·
3 Dependabot PRs open.

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

- 2026-10-18 (late): researched the "Idea Check" product idea (docs/design/idea-check.md) and what Workers Paid and OpenRouter free models can be used for; pending list rewritten above.
- 2026-10-18 (night): Verifier: Crossref calls gated to its 3/s limit, OpenAlex title search and arXiv-id lookup as a second source, three false accusations fixed (wrapped DOIs, markup in titles, broken words). Real-paper verification 21% → 78%. Eval re-record in progress.
- 2026-10-18 (later): paper intelligence v1 shipped: References tab, Contents menu, real titles and metadata for uploads; measured on the five real PDFs.
- 2026-10-18: held-out eval; uploaded papers + grounded Q&A + preview + My papers UI; answer streaming; GROBID alternatives spike;
  Workers Paid active; this roadmap created.
