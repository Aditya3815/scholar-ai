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

## Next, in this order

1. Verifier: finish step 5 (re-record the eval, check the gates, push).
2. Q&A eval in a weekly workflow; free OpenRouter as a public-data fallback; paid ZDR route only after it passes the gold set.
3. Privacy / Terms / "How we verify" pages + first-upload privacy card (needs Aditya's inputs).
4. Onboarding, a "wrong answer / wrong citation" button feeding the eval set, small admin page.
5. "Chat with this paper" for open-access search results (import the PDF).
6. Collections and Q&A across papers (Vectorize). Staging, Sentry, Turnstile. Custom domain before public beta.

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

- 2026-10-18 (night): Verifier: Crossref calls gated to its 3/s limit, OpenAlex title search and arXiv-id lookup as a second source, three false accusations fixed (wrapped DOIs, markup in titles, broken words). Real-paper verification 21% → 78%. Eval re-record in progress.
- 2026-10-18 (later): paper intelligence v1 shipped: References tab, Contents menu, real titles and metadata for uploads; measured on the five real PDFs.
- 2026-10-18: held-out eval; uploaded papers + grounded Q&A + preview + My papers UI; answer streaming; GROBID alternatives spike;
  Workers Paid active; this roadmap created.
