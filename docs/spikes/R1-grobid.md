# R1 spike: GROBID for PDF structure

**Question.** Can GROBID turn a scholar's PDF into usable structure (title, authors, abstract, sections, references) fast enough
and well enough to build the reader, paper Q&A and the Reference Verifier on?

**Verdict: yes, with the lightweight CRF image.** 5/5 papers parsed correctly in 1.6–2.6 s each (17 s for the very first
request while the models warm up). The deep-learning `-full` image (14 GB) is not needed for the first release.

## Setup

- Image `grobid/grobid:0.9.1-crf` (510 MB compressed, CPU only), Docker Desktop on a laptop, 8 GB given to Docker.
- Endpoint `POST /api/processFulltextDocument` with `consolidateCitations=0` (GROBID does not call Crossref; the Reference
  Verifier does that itself, deterministically).
- Papers: the same five PDFs used for the LLM spike ([R2](R2-llm.md)): a 15-page ML paper, an arXiv maths paper, an
  agricultural-economics paper (Indian authors), a physics-education paper and a statistics paper. Reproduce with
  `apps/api/scripts/spike-grobid.mjs`.
- Gate set before running: at least 4/5 papers "sensible" (title, abstract, sections and references all present and plausible)
  and under 90 s each.

## Results

| Paper | Time | Title | Authors found | Abstract | Sections | References |
| --- | --- | --- | --- | --- | --- | --- |
| Attention Is All You Need | 17.0 s cold, 2.0 s warm | exact | 8 of 8, plus 2 affiliation names mixed in | 2,085 chars | 30 | 40 (40 in the PDF) |
| Cholera model (arXiv) | 2.4 s | exact | 2 of 3 (misses the last author) | 799 chars | 16 | 32 |
| Milk fever (Haryana) | 3.2 s | exact | 6 of 6 | 1,181 chars | 28 | 49 (40 with DOI) |
| Graduate problem solving | 2.8 s | exact | 2 of 2 | 1,385 chars | 25 | 31 |
| Pilot-study sample size | 1.8 s | exact | 1 of 2 (misses the first author, set in capitals) | 655 chars | 17 | 24 |

- **Body text:** 62–91 % of the characters `pdftotext` finds. The rest is mostly the reference list, running headers and page
  numbers, which is what we want removed.
- **References:** every reference has a title and year; 1 of 5 papers carries DOIs in its bibliography (40 of 49), because
  the others simply do not print them. That is exactly why the Reference Verifier searches Crossref by title and author instead
  of depending on DOIs.
- **Memory:** about 4 GB resident after the run, no errors in the log.

## Weaknesses found

1. **Author lists are not fully reliable** (2 of 5 papers dropped an author; one mixed affiliations into the list). The author
   list GROBID returns must never be treated as ground truth. For the user's own paper this is cosmetic; for the Reference
   Verifier it matters little because a reference's authors are matched against Crossref's record, not the other way round.
2. **Some body text becomes a heading** ("In 2016, the Indian Council of Agricultural Research-National Dairy…", a theorem
   statement). The reader should render GROBID's section tree but not rely on it for navigation labels without a length cap.
3. **Scanned PDFs (no text layer) are not tested** and GROBID does not OCR. Needs a clear "this PDF is an image" message, and
   OCR later if Indian scholars' theses turn out to be mostly scans (they often are).
4. Only five papers. This shows the approach works, not its failure rate. A 30-paper set, including thesis-length PDFs and
   Hindi/regional-language material, belongs in the ingest phase.

## What this means for the design

- **Hosting is the real open decision.** GROBID is a Java service that wants about 4 GB of RAM, so it cannot run on the
  Cloudflare free tier. Options, cheapest first: a small VPS (4 GB, roughly 4–6 USD per month), Oracle Cloud's free ARM
  instance (free, but capacity is hard to get), or Cloudflare Containers (needs the paid Workers plan). Recommendation: do not
  decide now. Phase 1 can start with GROBID on the developer's machine behind a tunnel for testing, and the hosting choice can wait
  until there are real users.
- **Wrap it.** Put a thin service in front (queue → fetch the PDF from R2 → GROBID → store TEI and parsed JSON in R2/D1),
  so the Worker never talks to GROBID directly and a slow or failed parse becomes a retryable job instead of a failed request.
- **Keep the TEI.** Store the raw TEI next to the parsed JSON: the parser can improve later without re-reading the PDFs.
- **Parse time is not a problem** (2–3 s typical), so no need for GPU or the `-full` image yet. Re-test `-full` only if
  the 30-paper set shows reference or author accuracy below the targets.

## Reproduce

```sh
docker run -d --name grobid -p 8070:8070 --init --ulimit core=0 grobid/grobid:0.9.1-crf
curl http://localhost:8070/api/isalive          # wait for "true" (about 30 s)
node apps/api/scripts/spike-grobid.mjs <folder with PDFs> [output folder]
```
