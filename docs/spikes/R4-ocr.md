# R4 spike: reading scanned PDFs (Hindi and English)

Date: 2026-10-22. Question: many Indian theses and older papers are page scans, and today an upload with no text layer is refused
("No readable text was found"). Can Workers AI vision models read such pages well enough for the product, at what cost, and
how do we avoid showing wrong text as if it were right? Code and test pages: [R4-ocr/](R4-ocr/).

## How it was tested (and what this does not prove)

- Five pages written for the test (so no model can have seen them): an English abstract, an English reference list, a Hindi abstract, a Hindi thesis
  summary with English terms (SPSS, Python, Machine Learning, 10 Mbps) and a page with Hindi and English paragraphs. Rendered in Edge (so Devanagari is
  shaped correctly) at 150 dpi, then made to look scanned in two ways: **good** (small tilt, light noise and blur, JPEG 80, 150 dpi) and **poor**
  (2.2° tilt, blur, heavy noise, faded ink, uneven light, 62% size = about 93 dpi, JPEG 45).
- Ground truth is the text the page was drawn from. Measured: character error rate (CER), word error rate (WER), and how many of the page's numbers come back exactly.
- **Not tested:** real scans (typewriter pages, stamps, two columns, tables, handwriting, old Hindi fonts such as Kruti Dev, bleed-through). One font family per language.
  Ten images is a spike, not a benchmark. Real scanned pages from you (3 to 5 from Shodhganga or a department) would be the first thing to add.
- Not run: Tesseract, EasyOCR and Docling (they need a Container or a local install; see "Not measured").
- Gemma 3 12B (`@cf/google/gemma-3-12b-it`) answered "5018: This account is not allowed to access" and was left out. Llama 3.2 Vision needs a licence click on the account, which is yours to decide; not clicked.

## Result

Mean over the two Workers AI vision models that ran, 150 dpi scans ("good", 5 pages) and degraded ones ("poor", 5 pages):

| Model | Scan | CER | WER | Numbers exact | Neurons / page | Seconds / page |
| --- | --- | --- | --- | --- | --- | --- |
| Llama 4 Scout 17B | good | **0.1%** | 0.9% | 100% | 71 | 7.6 |
| Llama 4 Scout 17B | poor | 28.9% (English 2.8%, Hindi 54%, mixed 30%) | 38.9% | 81% | 60 | 7.0 |
| Mistral Small 3.1 24B | good | **0.4%** | 1.2% | 100% | 81 | 6.9 |
| Mistral Small 3.1 24B | poor | 41.8% (English 1.7%, Hindi 88%, mixed 30%) | 54.2% | 72% | 48 | 6.3 |

What this says:

1. **A clean 150 dpi scan, Hindi or English, is read almost perfectly** (0 to 1.2% CER per page, every number right). The earlier worry that Hindi would not work is not true for decent scans.
2. **A poor scan breaks Hindi first.** English survives a bad scan (about 2 to 3% CER), Hindi does not (50 to 90%).
3. **Numbers fail silently.** On the poor English abstract the character error was only 1.6%, yet "2005" came back as "2003", "2020" as "2009" and "38" as "18"; Mistral also turned "0.01" into "0.011". The text looks fine and a number is wrong. For a research tool this is the dangerous failure.
4. **Models invent text when they cannot read.** Mistral produced 856 characters for a 560-character poor Hindi page. Fed an enlarged copy (below) it wrote 11,582 characters for a 690-character page, a loop.
5. **Do not "enhance" the scan.** Enlarging the poor scans 2x with contrast and sharpening made them worse (Scout CER 28.9% to 48.5%, Mistral 41.8% to 393%): the model reads the added noise. Send the page as it is.
6. **Scout is the better default**: same quality on good scans, no loops, a little faster, a little cheaper per good page (71 against 81 neurons).

### Two models disagreeing predicts the real error

For every scan the two models were compared with each other (no ground truth) and that disagreement was set beside the real error:

| Scan | Models disagree (CER) | Scout real CER | Mistral real CER |
| --- | --- | --- | --- |
| en-abstract good / poor | 0.1% / 1.6% | 0.1% / 1.6% | 0.0% / 0.3% |
| en-refs good / poor | 0.2% / 4.5% | 0.2% / 4.0% | 0.0% / 3.2% |
| hi-abstract good / poor | 0.4% / 70.3% | 0.0% / 61.3% | 0.4% / 112.7% |
| hi-thesis good / poor | 1.4% / 64.0% | 0.2% / 47.3% | 1.2% / 62.8% |
| mixed good / poor | 0.3% / 34.8% | 0.0% / 30.2% | 0.3% / 30.1% |

Every good page is at 1.4% disagreement or less; every unreadable page is at 34% or more; the gap between the two groups is wide, so a threshold of a few percent separates them on these ten
pages. It does **not** catch an error both models make the same way (both read "38" as "18"), so it is a quality gate for the page, not proof that each number is right.

### Cost and time

- Cloudflare reports about **60 to 80 neurons per page** (a page costs about 2,300 input tokens as an image). With Cloudflare's published Workers AI price (about $0.011 per 1,000 neurons, and 10,000 free neurons a day; not re-checked today),
  one model read of a 100-page thesis is about 7,000 neurons, roughly **$0.08**; with the two-model check about **$0.15**. The free 10,000 neurons a day is only about 65 two-model pages for everyone together, so the paid rate applies in practice and a per-person daily page cap is needed.
- About 7 s per page per model. 100 pages, two models, one after the other is about 23 minutes; four pages at a time about 6 minutes. That is a job for a Queue or Workflow (S4), not one request.

## Decision: go, small, with a reading gate

**Go** for "scanned papers (beta)" using Llama 4 Scout, built in this order:

1. **Render in the browser** (pdf.js is already there) at 150 dpi, JPEG quality about 80, at most 1,240 by 1,754 px. No upscaling, no filters. Page images go only to the private model route, like the idea text, and are not stored.
2. **Read each page with two models** (Scout, Mistral) and compare. Disagreement up to about 2%: accept. Between 2% and 5%: accept with a warning on the page. Above 5%, or an answer longer than about twice what the page can hold, or a repeating loop: the page is **"not read reliably"** and is left out of Q&A and the Reference Verifier. The thresholds come from ten pages: they must be re-set on real scans before launch.
3. **Always say it is a scan.** The paper shows "Read from a scan, check numbers against the page image"; a quote in an answer opens the page image (it already opens the page). Numbers where the two models differ are marked.
4. **Cap**: pages per person per day (start at 60) and a hard `max_tokens` per page, so one bad page cannot spend the allowance.
5. **A job, not a request**: one page per queue message, three or four at a time, progress shown; the first pages and the reference pages first, so the title, DOI and references appear before the whole thesis is done.
6. **Add real scans first** (yours), re-run `score.py`, and only then reset the thresholds and turn it on for pilot users.

## Not measured

- **Tesseract / EasyOCR / Docling** (classic OCR with layout and tables, in Cloudflare Containers): not run here. Docling stays the plan for **tables** (the vision route above reads running text, not tables) and as the fallback if the vision route fails the real-scan test. Hindi OCR quality of Tesseract on poor scans is also commonly weak, so it is unlikely to rescue the "poor" case; that is a guess until measured.
- **Handwriting and non-Devanagari Indian scripts**: no test; assume not supported.
- **Layout**: multi-column pages, footnotes and tables were not in the test pages; reading order there is unknown.

## To reproduce

```
node render.mjs                      # clean pages from pages.json (needs Edge)
python degrade.py                    # good and poor scans (needs Pillow, numpy)
cd worker && wrangler dev --port 8799   # remote AI binding: costs a few neurons
node run.mjs                         # every scan, every model
python score.py                      # tables above
```

## Follow-up, 23 Oct 2026: real scans, and what changed in the plan

Six real scans were added (kept out of the repository): an old English book page (margin note, footnotes), a two-column English bibliography, a Hindi page (a 515 px wide
screenshot), a Sanskrit and English page pair (a JBIG2-compressed, image-only PDF), a Russian transcript (creased, stamped) and a text PDF as a control. Each was read by both
models through the finished route (`apps/api/scripts/scan-live.mjs`). Details and the build are in [../ocr.md](../ocr.md). What the real pages changed:

1. **The 5% limit was wrong for real Hindi and Sanskrit.** Clean English pages differ by 0.3 to 2%, but the Hindi page differs by 9.9% and the Sanskrit and English pages by 9 to 12.5%,
   although the first model's text on them is mostly right. The checking model (Mistral) is much weaker in Devanagari and invents words, so the disagreement measures its errors as well.
   New limits: under 2% used, 2 to 15% used and marked "read with doubt", above that not read reliably.
2. **A model that cannot read a page writes a different document, with confidence.** On the Russian transcript Llama 4 Scout produced a plausible, wrong "list of courses of an air force school"
   and Mistral repeated one sentence until it ran out of room (11,000 characters, 166 neurons). Only the comparison, the loop test and the cut-off test caught it. Scout alone would have shown it.
3. **Neurons per page are higher on dense real pages:** 50 to 119 for Scout and 56 to 166 for Mistral, about 180 for both (the spike's 71 was for light test pages). About $0.002 a page.
4. **Time per page** is 6 to 40 seconds for both models together.
5. **References read from a scan work:** all 24 entries of the two-column bibliography page were found in the text (a reference that omits the author because it repeats the one above
   keeps its year first, "(1983). The Architecture of Cognition", as printed). One name was misread by the first model ("Cadiierno" for "Cadierno"), which is what "check names on the page" is for.
6. **pdf.js needs its WebAssembly decoder for JBIG2** (the Sanskrit PDF): the app already serves it (`/pdfjs/wasm/`), the page then renders in the browser.
7. **Plan change:** one page per request from the browser instead of a Queue job. The picture is not stored, so a background job could not read it later; the price is that the tab stays open.
