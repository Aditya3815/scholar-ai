# R1b spike: can we do without GROBID?

Date: 2026-10-18. Question: with Crossref and OpenAlex already in the product, can Docling, Nougat, FAISS, AnyStyle or something
free replace GROBID (see [R1](R1-grobid.md))? What do we actually need from a PDF parser?

## What we need, in order of value

1. **The reference list of the uploaded paper**, split into entries, then checked by the Reference Verifier we already have.
2. **Title and metadata** (to show a proper title, and to find the paper in Crossref/OpenAlex).
3. **Section headings / outline** for reader navigation (Q&A itself does not need them: it works on chunks).
4. **Scanned PDFs** (OCR) and **tables**.

## Verdict per tool

| Tool | What it is | Verdict |
| --- | --- | --- |
| **OpenAlex** `referenced_works`, **Crossref** `reference` | structured reference lists for *published* papers, no parsing | **Use.** Measured below |
| **pdf.js in the browser** (already in the app) | text with positions and font sizes, PDF outline (bookmarks) | **Use.** Free, nothing to host, the PDF never leaves the browser for this step |
| **Our own code** (`splitReferences`, Reference Verifier) | splits a pasted reference block, checks each entry against Crossref | **Use.** Already built and tested |
| **Docling** (IBM, MIT code) | layout models, excellent tables, OCR; Python, about 500 MB of models, roughly 0.5 to 3 s per page on CPU, 2 to 4 GB RAM typical | **Later**, for scanned PDFs and tables, in Cloudflare Containers (now possible: Workers Paid). Not for references: no dedicated reference parser |
| **AnyStyle** (CRF reference-string parser, Ruby) | turns one reference string into fields | **Optional.** Our verifier matches text to Crossref and does not need fields. Reviews disagree on accuracy (one study F1 0.54 vs GROBID 0.89 out of the box; a 56-article study ranked it best). Licence not checked here |
| **Nougat** (Meta) | PDF to markup with LaTeX, very good on maths | **No.** Model weights are CC-BY-NC (non-commercial); wants a GPU; English only; weak on tables |
| **FAISS** | a vector-index *library* | **Not relevant.** It parses nothing. Per-paper retrieval already works in the Worker; searching across many papers should use Vectorize (managed) |
| **Cloudflare `AI.toMarkdown`** (free) | PDF to markdown | **No** (tested, see below) |
| **GROBID** | best published header/reference extraction (F1 about 0.79 to 0.89 in benchmarks) | **Keep as the quality upgrade**, hosted in Cloudflare Containers if it is ever needed (about 4 GiB, scale to zero, cents per month) |

## Measured

**1. Structured references for published papers (OpenAlex / Crossref), 160 papers from our eval sets**

| Set | OpenAlex has a reference list | Crossref has one | either |
| --- | --- | --- | --- |
| tuned (100 most-cited) | 99 | 91 | 99% |
| held-out, Indian institutions (30) | 29 | 25 | 97% |
| held-out, global (30) | 28 | 24 | 93% |

If an uploaded PDF has a DOI (printed on page 1, or found by title in Crossref), its references come for free and clean. Crossref
also returns the raw reference string and often the DOI of each cited work. This does **not** cover manuscripts, theses and
preprints (no DOI yet), which is exactly what many users upload: for those we parse the PDF.

**2. Cloudflare `toMarkdown` on our five PDFs: rejected.** 2 to 9 s each, but the output is a plain text dump under "### Page N"
(no headings, no references structure), words are glued together ("TheLawwillneverbeperfect") in the arXiv paper, and the 34-page
Word-made paper came back with **no text at all** (pdf.js reads it fine).

**3. Prototype: pdf.js + a few rules, compared with GROBID on the same five papers**

| | attention | cholera | milk | physed | pilot |
| --- | --- | --- | --- | --- | --- |
| references found (GROBID) | 40 (40) | 32 (32) | 57 (49) | 30 (31) | 24 (24) |
| GROBID's reference titles also found in ours | 35/39 | 24/30 | 45/49 | 27/31 | 24/24 |
| our references verified by the Verifier (of those found) | 15 | 17 | 34 | 17 | 22 |
| headings also found (GROBID headings) | 17/30 | 0/16 | 7/28 | 3/25 | 9/17 |
| extraction time | 0.6 s | 0.2 s | 0.2 s | 0.2 s | 0.1 s |
| PDF outline (bookmarks) present | 7 entries | 5 | none | none | 5 |

- **References: good enough.** 155 of 173 GROBID reference titles (90%) are inside the references we extract with no model at all,
  in 0.1 to 0.6 s. Over-splitting (milk: 57 vs 49) is the main error.
- **Verification is honest, not high.** 105 of 183 extracted references verified (57%). Most of the rest are arXiv preprints,
  conference papers and books that Crossref does not index; the verifier says "not found" and explains why. Adding OpenAlex (which
  indexes arXiv) as a second source in the Verifier should lift this; to be measured.
- **Headings: weak.** Simple rules (font size, numbering, capitals) find 36 of 116 GROBID headings (31%), because headings wrap over
  lines, share the body size or are small caps. Use the PDF's own outline when it exists (3 of 5 papers) and show detected headings
  only as a hint. This is where GROBID is clearly better.
- Title: the largest text on page 1 is the title in all five papers; Crossref then supplies authors, year and DOI.

## Decision

Build **"paper intelligence v1" without GROBID**:

1. In the browser, while reading the PDF: first-page title, DOI regex, PDF outline, heading candidates, and the reference block
   (from the last "References" heading) split into entries.
2. If a DOI is known: take the reference list and metadata from OpenAlex/Crossref. Otherwise use the extracted block.
3. Show a **References** tab in the paper workspace: every entry checked by the Reference Verifier (reusing its cards), with
   export; add OpenAlex as a second lookup source to the Verifier and re-measure on the held-out set.
4. **Docling in Cloudflare Containers later**, when scanned PDFs (OCR) or tables matter. GROBID stays the fallback if section and
   author quality turn out to matter to users.

## Caveats

Five papers, one reviewer, heuristics tuned by eye: a smoke test, not a benchmark. The GROBID figures come from [R1](R1-grobid.md)
(CRF image). Benchmark numbers for AnyStyle and GROBID come from third-party studies of different corpora and do not agree.

## Result: built, 2026-10-18

Implemented as `packages/shared/src/paperinfo.ts` (pure analysis, 24+ unit tests including real PDFs read by pdf.js), `apps/api/src/docs/info.ts`
(validation and registry lookups) and the **References** tab and **Contents** menu in the paper workspace.

Run on the same five PDFs through the real pipeline (browser pdf.js, Worker, live Crossref/OpenAlex), `apps/web/e2e/real-papers.mjs`:

| | attention | cholera | milk | physed | pilot |
| --- | --- | --- | --- | --- | --- |
| title | exact | exact | exact | exact | exact |
| references found (GROBID) | 40 (40) | 32 (32) | 49 (49) | 30 (31) | 24 (24) |
| contents | 22 bookmarks | 9 bookmarks | 9 detected | 10 detected | 11 bookmarks |
| metadata (authors, year, venue) | OpenAlex via arXiv id | OpenAlex via arXiv id | Crossref via SSRN DOI | OpenAlex via arXiv id | OpenAlex via arXiv id |

Reference titles also found in the extracted entries: 154 of 173 (89%), the same as the prototype, with the entry count now within one of
GROBID's on every paper (the prototype over-split `milk`: it split on text; the final version splits on hanging indentation). Detected
headings stay a hint (they miss run-in and bold-only headings), which is why the reader labels them "may be incomplete" and prefers
the PDF's bookmarks when there are at least three.

Safeguards worth knowing: a DOI printed on page 1 is trusted for metadata only if the record's title agrees with the PDF's; a
preprint's year comes from its arXiv id (OpenAlex merges versions and can report the latest); if the PDF's own list cannot be read
and a DOI is known, the publisher's deposited list is used instead and the panel says so; what the browser sends is validated and
bounded, and `metadata` can never be set by the client.

## Result: the Verifier on real references, 2026-10-18

Same five PDFs, every extracted reference (175 of them) run through the live Verifier (`REAL_PDFS=<folder> REAL_VERIFY=1 npm run integration -w apps/api -- --browser --only="browser: real"`):

| Step | Verified |
| --- | --- |
| First run | 21%: not a quality number. Crossref allows 3 requests per second and 3 at once; one reference made up to 3 calls and the app ran 3 to 4 references in parallel, so most came back "could not check" |
| Crossref calls gated (2 at once, a 429 is retried after the time Crossref asks) | 63% (110 of 175), "could not check" 128 to 5 |
| OpenAlex title search when Crossref cannot confirm a reference | 66% |
| arXiv ids looked up directly; the search title is taken from after the author list (short titles such as "Layer normalization" were being lost to the author list); preprint year from the arXiv id | 72% |
| DOIs a PDF wrapped onto the next line are rejoined (they were reported as "DOI does not exist": a false accusation); "<i>" markup in Crossref titles stripped (a correct reference was called a different paper); hyphenated line breaks ("im- age") rejoined | 79% |
| One-word record titles can no longer be offered as "a real paper with a very similar title" | 78% (live data moves a little between runs) |

What is left (about 1 in 5) is mostly **not a defect**: books, reports, web pages and Wikipedia (not in either registry; the card says so), reprints
whose record carries a later year (Collins 1989 listed as 2018: reported as a year mismatch, with the record shown), and records where OpenAlex has the wrong
author list. A fabricated reference is still never "verified": the same tuned and held-out fake sets gate every push (see docs/eval/REPORT.md).

