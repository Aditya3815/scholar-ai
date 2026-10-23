# Scanned papers (OCR)

A scan is a PDF whose pages are pictures. It has no text layer, so the old code refused it ("No readable text was found"). Since 23 Oct 2026 it is read:
each page is drawn in the browser, sent to **two** vision models on Cloudflare Workers AI, the two readings are compared, and only pages they agree on are used.
Background and the first measurements: [spikes/R4-ocr.md](spikes/R4-ocr.md). This page is how it works, what it costs, what it cannot do, and how to operate it.

## What a person sees

1. They upload a PDF as always. The browser reads the text layer of every page; if **half or more of the pages have under 25 characters** the paper is a scan (a text
   paper with a few picture pages is left alone, `isScanned` in `packages/shared/src/ocr.ts`).
2. The upload job shows **Read, Upload, Read the pages**, with a Pause button and "Read 12 of 80 pages".
3. The paper is marked **Scan** in the list and has a banner: "Read from a scan. Words and numbers were read from page pictures by two AI models that check each other. Check
   numbers against the page." It lists pages **read with doubt**, pages **not read reliably** (left out of answers and the reference check) and numbers the two models read
   differently. Every chip jumps to that page.
4. Questions open when every page has been tried. Answers say "Sources match the text read from the scan" (not "checked against the paper") and name the pages to check.
5. The DOI and the reference list are looked for in the text that was read (`packages/shared/src/scan-info.ts`). The title is **not** guessed.
6. Highlighting and notes need selectable text, which a scan does not have; the banner says so.

## How a page is read

```
browser                                   server (POST /api/v1/documents/:id/ocr?page=N)
draw page 150 dpi, <= 1240x1754  ──JPEG──▶ check: owner, JPEG header, size, one page per call
blank? ──yes──▶ ?blank=1 (nothing sent)   reserve one page of today's allowance (atomic)
                                          Llama 4 Scout  ┐ in parallel, temperature 0,
                                          Mistral Small 3.1 ┘ at most 2,500 tokens each
                                          judgePage(): compare, decide
                                          ok / warn: chunk + embed + store, text kept
                                          unreliable / empty: nothing kept
```

- **No filters, no upscaling.** The spike found both made reading worse.
- The picture is **not stored** and not logged. Only Workers AI (private route, the same account and terms as the papers' text) sees it. The text that was read is kept
  like any other text of the paper (`doc_ocr.text` and `doc_chunks`), and goes with the paper when it is deleted.
- One page per request, three at a time from the browser. The server keeps the list of pages still to read (`doc_ocr`, status `pending`), so reading can be stopped and
  continued from another day or another device. This replaces the Queue in the spike's plan: the picture is not stored, so a background job could not read it later.
  Cost of that choice: **the tab has to stay open** while a paper is read (pause and continue are safe).

### The gate (`judgePage`)

| Result | When | What happens |
| --- | --- | --- |
| `ok` | the two readings differ on **under 2%** of their characters | text kept, used everywhere |
| `warn` ("read with doubt") | **2% to 15%** | text kept and used, page named in the banner, numbers the two differ on listed |
| `unreliable` | **15% or more**, or one answer is more than twice as long as the other, or a loop (the same four words again and again, 30 identical characters), or a model ran out of its 2,500 tokens, or **one model could not be reached** | nothing kept; left out of answers and the reference check |
| `empty` | both read nothing | nothing to keep (also: the browser saw a blank sheet) |
| `retry` (not stored) | a model could not be reached (network) | the page stays pending, **no allowance used**; tried again once, then left for "Continue" |

Comparison is on a normalised form: Unicode compatibility form (so `²` and `2` are the same), straight quotes and dashes, Devanagari digits as digits, no spaces or line
breaks, no capitals. The first model's text is kept as it was read (chatter such as `## ` headings, `**bold**` and "Here is the transcription:" removed). Nothing is "fixed"
and the better of two is never picked.

**What the gate cannot do:** two models can make the same mistake (both read "38" as "18"), and the gate then says nothing. That is why every use says it comes from a scan.

### Why 2% and 15% (measured on real pages, 23 Oct 2026)

Eight real pages (the six in `test_sample_papers/test_scans/`, which stay out of the repository) plus the spike's ten test pages:

| Page | Two readings differ | Gate |
| --- | --- | --- |
| English book page, margin note and footnotes (old print) | 1.8 to 2.1% | ok / warn |
| English bibliography, two columns, 24 references | 0.3% | ok |
| Hindi typeset page (low-resolution screenshot, 515 px wide) | 9.9% | warn |
| Sanskrit and English, two pages (diacritics, Devanagari glyphs) | 9.4% and 11.4 to 12.5% | warn |
| Typed Russian transcript, creased, stamp (not a supported script) | one model invented a different document, the other looped (11,000 characters, cut off) | unreliable |
| Spike, good scans (Hindi and English) | 0.1 to 1.4% | ok |
| Spike, poor scans | 1.6 to 70% (unreadable ones 34% or more) | ok to unreliable |

The first model's text on the Hindi page was mostly right (a few wrong words: "अनुसीलन" for "अनुशीलन", "बद्धाई" for "बधाई"); the checking model was clearly worse in Devanagari
(it invented words), so the disagreement is mostly the weaker model's mistakes. With the spike's 5% limit, every real Hindi and Sanskrit page would have been thrown away;
15% keeps them, marked. **These two numbers come from 18 pages. They are provisional: re-set them on the pilot's real scans** (`OCR_ACCEPT_BELOW`, `OCR_WARN_BELOW`).

## Limits and cost

- **Pages per person per day: 60** (`OCR_PAGES_PER_DAY`, a Worker variable; a value that is not a whole number from 1 to 2000 is ignored). Every page that was sent to
  the models uses one, whatever the outcome; a page that could not be reached, a blank sheet and a page that was already read do not. The count is per UTC day and checked
  atomically (`INSERT ... ON CONFLICT DO UPDATE ... WHERE pages < limit`), so three pages in flight cannot overshoot.
- At the limit the job stops, **what was read is kept**, and the banner says "Continue tomorrow".
- Page picture: JPEG, at most 1,240 by 1,754 px, 1.5 MB, 4.5 million pixels (a larger picture costs more tokens). Papers: still 500 pages and 25 MB.
- **Cost, measured with the real route (6 pages, 23 Oct):** Llama 4 Scout 50 to 119 neurons a page, Mistral 56 to 166, about **180 neurons a page for both** (the spike's
  71 per page was for light pages). At Cloudflare's price of about $0.011 per 1,000 neurons (not re-checked today) that is **about $0.002 a page, $0.20 for a 100-page thesis**; the free
  10,000 neurons a day cover about 55 pages for everybody together. A person at the daily limit costs at most about $0.12 a day.
- **Time:** 6 to 40 seconds a page (both models together; Mistral is the slower one and takes 40 s when it loops). A 100-page thesis with three pages at a time takes
  roughly 10 to 15 minutes. Dense Hindi pages are the slowest.

## Not supported (said to the reader, not hidden)

- Handwriting, tables as tables (running text is read, a table becomes lines of text), formulae, and scripts other than English and Devanagari. A Russian page is refused by the gate,
  not read. Docling for tables is still planned (S5).
- Highlights, notes and in-paper search on a scan (no text layer).
- Reading while the tab is closed (see above).
- A scan whose pages are very low resolution (the Hindi screenshot was 515 px wide) reads with doubt at best.

## For whoever runs it

- Migration `0011_scans.sql`: `documents.scanned`, `doc_ocr` (one row per page to read: status, disagreement, numbers, reason, text) and `ocr_usage` (pages and neurons per person per day;
  rows older than 35 days are removed by the daily clean-up; erased with the account; `doc_ocr` goes with its paper).
- Routes: `POST /documents/:id/scan` (register the pages to read; asking again keeps what was read), `POST /documents/:id/ocr?page=N` (a JPEG body, or `?blank=1`),
  `GET /documents/:id/scan` and `/scan/text`. `GET /documents/:id` also returns `scan`.
- Cost review: `SELECT day, COUNT(*) AS people, SUM(pages) AS pages, ROUND(SUM(neurons)) AS neurons FROM ocr_usage GROUP BY day ORDER BY day DESC;` (admin SQL console or `wrangler d1 execute --remote --command`).
- A paper stuck as "indexing" with pages pending is not broken: it is waiting for someone to press "Continue reading".
- The privacy text names the page pictures (policy and the note before the first upload; `PRIVACY_VERSION` is now `2026-10-draft-2`, so everyone is asked once more).

## Tests

- Unit (`apps/api/src/ocr/`): the gate (cleaning, comparing, edit distance, numbers, loops, blank pages, every verdict and both thresholds), the JPEG header reader, the reference and DOI
  finder for scanned text (including a reference cut by a page break).
- Integration (`apps/api/scripts/scan-e2e.mjs`, about 105 checks): access and CSRF, every refusal of a bad scan list or picture, each outcome (ok, doubt, not reliable, empty, loop, cut off),
  one model down, both down, a better scan accepted on a second try, nothing read or charged twice, the limit (exactly the limit, per person, per UTC day), six pages at the same time,
  deleting a paper and erasing an account. The two models are replaced by an offline stand-in (`src/ocr/stub.ts`, only with `QA_STUB=1` and `ENABLE_DEV_ROUTES=1`).
- Browser (`apps/web/e2e/scan.mjs`, 61 checks): upload, the steps, a blank page found by the browser, the banner, questions, references, pause and continue, the daily limit and the
  next day, phone width, light and dark, axe on every state.
- Live, with the real models: `apps/api/scripts/scan-live.mjs <folder of page JPEGs>` (costs neurons; needs `--var ENABLE_DEV_ROUTES:1` as well, see the script header).
