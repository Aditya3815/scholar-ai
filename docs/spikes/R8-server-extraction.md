# R8: can the server read an open-access paper? (spike, 26 Oct 2026)

The question W4 depends on ([unified-workspace.md](../design/unified-workspace.md) section 5): can a Worker fetch an open-access paper and read its text, within the 128 MB isolate limit, often enough to be worth building on? Code and raw results: [R8/](R8/) (own `package.json`, not part of the app; the downloaded PDFs are not committed).

## Answers

| Question | Result |
| --- | --- |
| Can a Worker extract the text of a PDF? | **Yes.** `unpdf` 1.9.1 (a serverless build of pdf.js) read **35 of 35** PDFs it was given, on Cloudflare's real runtime (`wrangler dev --remote`), with no memory or CPU failure: the largest was 13.75 MB, the longest 214 pages (read to the 120-page cap), 6 papers over 40 pages. Median 485 ms, slowest 7.1 s for a 13 MB, 77-page file (those times include uploading the file from a laptop; locally the same files took a median of 92 ms and at most 0.7 s) |
| Is the text usable? | About 3,300 characters a page (median). A page with no text layer is detected: the scanned Ashtadhyayi sample gave 0 characters on 2 of 2 pages (and is reported as "scanned, cannot be read here", as designed). Not judged: quality of two-column reading order, tables, equations (planned: the Q&A eval on shared papers) |
| Is the memory limit a problem? | Not at these sizes. **Not measured as a number** (a Worker cannot read its own heap); the evidence is that nothing was killed. The 25 MB and 120-page caps of the design stay, and extraction stays its own step so a failure restarts only it |
| Can a server **fetch** the PDF a search result points at? | **About half.** Of 42 open-access links taken from OpenAlex (`best_oa_location.pdf_url`) for seven of our kind of topics, **23 (55%)** came back as a real PDF with a polite User-Agent. The 19 failures: **14 were 403** (13 from large publishers: Elsevier/ScienceDirect, The Lancet, Oxford, BMJ, Wiley, SAGE, Cell, AMS, ERS, even for CC BY articles; 1 from a university site), 2 connection failures, 2 landing pages (HTML) instead of a PDF, 1 a 404. A plain-`http` link is retried once as `https` (that recovered 2 links, already in the 55%). The sample is skewed (OpenAlex's text search returned many small OJS journals), so read 55% as "about half", not as a rate |
| Does **Europe PMC's PDF** link work from a server? | **No: 403** (an HTML challenge) for all 8 tried, from a plain script |
| Does Europe PMC's **full-text XML** work from a server? | **Yes, and it is better than a PDF.** `GET /europepmc/webservices/rest/{PMCID}/fullTextXML` returned JATS XML (75 to 405 KB) for every open-access paper tried, with real sections (`<sec><title>`). The PMCID, the open-access flag and the licence (`cc by`, `cc by-nc`) come from **one** search call by DOI. An article from a journal whose own site answered 403 (a BMJ journal) was complete in PMC |
| Is the arXiv route fine? | Yes: PDFs fetched at one request per 3 seconds, no blocking |

## What this changes in the W4 design

1. **A source ladder per paper, not one PDF link.** In order: (1) **Europe PMC full-text XML** when the DOI has a PMCID and the paper is open access (structured, licence known, no extraction, tiny, never blocked); (2) **arXiv** PDF by arXiv id; (3) the **open-access PDF link** from the search record, when it can be fetched (about half the time); (4) **abstract only**, labelled "Based on the abstract only", with "Upload the PDF you have" as the way out. The plan said "download the open-access PDF"; that would have failed on every paper from the big publishers.
2. **Quotes carry a section when there is no page.** JATS has no page numbers: answers from a PMC paper cite "Methods > Participants" and the exact quote; PDF sources keep the page. Own uploads are unchanged.
3. **The licence is decided from the record**, not guessed: the shared index keeps text and embeddings for answering; the PDF is shown only for permissive licences. (Still your or a lawyer's read, row S1-L.)
4. **Safe fetch stays as designed** (HTTPS only, every redirect re-checked, 25 MB and 25 s caps, `%PDF-` magic bytes, `citation_pdf_url` for one landing page), with one addition measured here: a plain-`http` link is retried once as `https` and never fetched over `http`.
5. **Say so when a paper cannot be fetched.** The "cannot read" outcome is expected for roughly half of publisher PDFs, so the panel must offer the abstract answer and the upload at once, not look like an error.
6. **The shared index is a bigger win than planned**: only a quarter to a half of papers a person meets can be ingested at all, so every success is worth sharing.

## What was not tested

Peak memory as a number; two-column and table quality; extraction under concurrent requests (the design caps ingest concurrency at 3); a PDF over 25 MB; fetching from the deployed Worker (Cloudflare's outbound IPs may be treated differently from a laptop by some publishers: **first thing to check after the first deploy**, with the numbers above as the baseline).

## How to repeat

`cd docs/spikes/R8 && npm install`, then `npx wrangler dev --remote --port 8800` in one terminal and `SPIKE=http://localhost:8800 node run.mjs --all` in another; `node fetchability.mjs 6` refreshes the fetch table (it is polite: arXiv every 3 s, others every 0.7 s).
