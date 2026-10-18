# Uploaded papers and grounded Q&A

A scholar uploads a PDF, reads it in the app, and asks questions. **Every answer points at the exact passage it came from, and
that passage is checked against the paper's own text before it is shown.** This is the same rule as the rest of the product
(a citation is never taken on the model's word), applied to answers.

## How it works

```
browser                                   Worker (Cloudflare)                       storage
-------                                   -------------------                       -------
pick a PDF
 pdf.js reads every page (in the browser)
 first page -> small JPEG cover
 POST  /documents  (the PDF bytes)  ----> check size, %PDF- magic bytes, quota ---> R2  docs/<user>/<id>.pdf
 PUT   /documents/:id/cover         ----> store the cover                       ---> R2  docs/<user>/<id>.cover.jpg
 POST  /documents/:id/pages  x N    ----> chunk (~1000 chars, sentence aware),
                                          embed (Workers AI bge-m3, multilingual) -> D1  doc_chunks (text + vector)
 POST  /documents/:id/finish        ----> ready (or failed: "scanned PDF")      ---> D1  documents

ask a question
 POST  /documents/:id/ask           ----> embed the question
                                          rank chunks: 0.75 semantic + 0.25 keywords, top 6
                                          LLM Gateway, PRIVATE route (Workers AI gpt-oss-120b), JSON schema:
                                            { found, answer with [n] markers, evidence: [{excerpt n, exact quote}] }
                                          verify every quote against that excerpt's stored text
                                          drop markers whose quote cannot be verified; flag the answer
 <- answer, citations (page + verified quote), verified flag   ------------------> D1  doc_qa (history)
click [n] or a source -> viewer scrolls to the page and highlights the quote in the text layer
```

Why the browser reads the PDF: the Workers free plan allows about 10 ms of CPU per request, far too little to parse a PDF. The
browser does it with pdf.js (which also gives us the page images and the text layer for highlighting), and sends only text.
The Worker only chunks, embeds and stores, which is cheap.

## Streaming: what is real and what is not

A reasoning model (gpt-oss-120b) thinks silently before it writes: measured on Workers AI, about 300 hidden reasoning chunks and
7 to 10 seconds before the first answer token in a plain call. Writing the answer itself takes about a second. So streaming the
text alone barely shortens the wait; what helps is showing the *real* stages as the server reaches them
(`POST /documents/:id/ask?stream=1`, server-sent events):

| Event | When (real model, measured) | What the reader sees |
| --- | --- | --- |
| `stage: retrieving` | immediately | step 1 lights up |
| `sources` (pages) | about 0.3 s | "Reading p.1 p.2 p.3": chips that already open those pages in the PDF |
| `stage: thinking` | first reasoning chunk, 0.7 to 1 s | step 2 |
| `stage: writing` + `delta`... | model starts the JSON, 1.5 to 3.3 s | the answer appears word by word, dimmed because it is provisional |
| `stage: checking` | the JSON is complete | step 4: quotes are verified against the paper |
| `answer` | right after | the checked answer replaces the draft; unverified markers are removed, the warning appears if needed |

Details that matter: the answer text is pulled out of the growing JSON by a small incremental parser (it handles escapes and
packets cut anywhere); the draft hides citation markers because nothing is verified yet; the same gateway, privacy rule, quota and
ledger apply as for a normal call; if a provider fails *after* text was shown there is no silent switch to another model; if the
reader leaves (Stop, Escape, closing the tab) the model call is aborted and nothing half-finished is saved. For screen readers the
text is not announced token by token (that is read out word by word and is unusable); only stage changes and the result are.

## What "verified" means

`quoteInText` compares word sequences, so punctuation, case, ligatures and spacing do not matter, but wording does: at least 85 %
of the quote's words must appear as one unbroken run in the cited excerpt, and the run must be at least 4 words. The result:

| Status shown | Meaning |
| --- | --- |
| Every source checked against the paper | `found` and at least one cited quote was verified; markers whose quote failed are removed |
| Could not verify the source | the model claimed an answer but none of its quotes is in the paper; shown with a warning |
| Not in this paper | the model said the excerpts do not contain the answer; no citations are invented |

The unit tests (`src/docs/qa.test.ts`) cover made-up quotes, quotes from the wrong excerpt, non-existent excerpt numbers,
markers the model forgot, citation tokens gpt-oss invents for itself, and garbage JSON.

## Privacy

- PDFs, extracted text and questions are scoped to the signed-in user in every query; another user's id returns 404.
- The route is `sensitivity: "private"`: the gateway will only use providers that do not train on prompts (Workers AI). Gemini on
  the free tier is never used for papers (tests enforce this).
- Reference text is not involved; the question and six excerpts are the only things sent to the model.
- Account deletion removes every PDF, cover, chunk and answer (R2 objects first); the data export lists the papers and the
  questions asked.
- The excerpts are untrusted text: the system prompt says never to follow instructions inside them, the output is a JSON
  schema, and the browser renders the answer as text.

## Limits (all in `packages/shared/src/documents.ts`)

25 MB and 500 pages per PDF, 30 papers and 300 MB per user, 600 characters per question, 20 questions per minute per IP, and the
gateway's daily token quota per user (about 15 answers a day on the free Workers AI allowance; raise it when the account is on a
paid plan). **Scanned PDFs (page images with no text) fail with a clear message**; OCR is not built.

## Try it with the real models

```sh
npx wrangler dev --port 8788 --var GOOGLE_CLIENT_ID:dev --var GOOGLE_CLIENT_SECRET:dev-secret --var DEV_IDP_URL:http://localhost:9911
node apps/api/scripts/docs-live.mjs                              # built-in sample paper, 5 questions (one in Hindi)
node apps/api/scripts/docs-live.mjs paper.pdf paper.txt          # a real PDF and its text (pdftotext, pages split by [[page N]])
```

Tests run offline with a deterministic stand-in for the model (`QA_STUB=1` together with `ENABLE_DEV_ROUTES=1`, never uploaded
as secrets): `npm run integration -w apps/api -- --browser`.

## Measured quality (real models, 2026-10-18)

`apps/api/scripts/qa-eval.mjs` replays the 35 gold questions of the R2 spike (5 arXiv papers, 7 questions each: 4 answerable,
2 that the paper does not answer, 1 in Hindi) through the real upload, index and ask endpoints, scored the way the spike was:

| Measure | Result (final run) |
| --- | --- |
| Answerable questions answered correctly (every required fact present) | 24 of 24 that completed |
| ...of which Hindi questions about English papers | 5 of 5 |
| Unanswerable questions declined instead of guessed | 10 of 10 |
| Answers whose sources were verified against the paper | 24 of 24 |
| Requests that failed | 1 of 35 (a dropped connection to the AI service in the dev tunnel) |
| Median time to an answer | 5.2 s |

An earlier run found two correct answers whose quotes could not be verified: the PDF's text layer had broken words
("cons idering", "bigge st") and the model silently repaired them when quoting. Quotes now also match when compared with spaces
ignored (still verbatim, and at least 24 characters). 35 questions over 5 papers is a smoke test, not a benchmark: grow it
before quoting these numbers anywhere.

## Known weaknesses and next steps

- Retrieval is per paper (cosine over that paper's chunks, in the Worker). Searching across many uploaded papers needs Vectorize.
- Tables, equations and figures are plain text from the PDF's text layer, so questions about them are weaker.
- No streaming of the answer yet (the UI shows staged progress and reveals the answer when it is checked).
- GROBID (see `docs/spikes/R1-grobid.md`) would give section structure and references; hosting it is an open decision.
- No answer-quality benchmark yet: add questions with gold answers for the five spike papers and run them weekly.
