# W4: ask any open-access paper (as built, 26 Oct 2026)

Part of [unified-workspace.md](unified-workspace.md) section 5, after the two spikes that decided its shape: [R8](../spikes/R8-server-extraction.md) (can a server read a paper?) and [R9](../spikes/R9-workflows.md) (can a Workflow do the reading?). The streaming, checkpoint and idempotency decisions come from [agent-concepts.md](agent-concepts.md).

## What a person sees

Every search result that has a DOI or an arXiv number has **Ask this paper** (in the new look: on the card and in the preview). It opens a side sheet with the paper's title and a question box (English, Hindi or Hinglish).

1. **The first time a paper is asked**, it is read for everyone: a progress bar with words (Finding the paper, Reading the text, Getting it ready for questions), "the first time takes up to a minute, the paper is then kept for everyone, you can close this: it keeps going". A second person asking the same new paper joins that reading.
2. **The answer** quotes the paper: a short answer with marks, each tied to a quote that was checked against the text. For a paper read from XML the place is the **section** ("Methods > Participants"), for a PDF the **page**. A line says what it is made from: "Full text from Europe PMC · CC BY", "Full text from arXiv", "Full text from a free PDF".
3. **A paper that cannot be read** (not open access, the publisher blocks programs, a scan, over 120 pages, the link led to a different paper, the day's limit) is answered from its **abstract**, and the sheet says "Based on the abstract only", why, and offers My Workspace to upload the PDF.
4. A retracted paper says so at the top. Stop, "Ask again", the sign-in prompt for a visitor, and Escape (focus goes back to the button) work as elsewhere. Questions are kept for the visit only, per paper; signing out clears them.

## How it works

`POST /api/v1/papers/oa/ask` (same-origin, signed in; body: a DOI and/or arXiv number, the question, optionally the abstract the card already has) streams `ingest` (only while reading), `paper` (what the answer is made from), then the events of a question about a paper of your own (`stage`, `sources`, `delta`, `answer`; `error` ends it). `GET /api/v1/papers/oa/status` says where a paper is. It uses the shared stream helper (keep-alive, one terminal event, abort on leaving).

**The shared index** (migration 0017): `oa_papers` (key = `doi:…` or `arxiv:…`, source, licence, status, reason, attempt, instance, counts), `oa_chunks` (passages with embedding; `page` is a page or a section number, `section` its name), `oa_daily` (how many new papers a person brought in today). Nothing in it names a person; a test asserts the columns.

**The source ladder** (`oa/sources.ts`): Europe PMC full-text XML when the DOI has an open-access PubMed Central copy; the arXiv PDF; the free PDF OpenAlex lists for the DOI; else nothing. The PDF address always comes from OpenAlex, never from the browser, so nobody can fill the shared index with their own file under a real paper's name. A PDF's title is checked against the title the services gave (`identity.ts`): a different paper is refused (`wrong_paper`).

**Safe fetch** (`oa/safe-fetch.ts`): HTTPS only (an `http://` address is tried as `https://`), no IP address in any spelling, no private names, no port or password, every redirect checked again (3 at most), 25 MB counted while streaming, one 25 s limit, `%PDF-` magic bytes, a landing page's `citation_pdf_url` followed once. 57 tests including the redirect-to-a-private-address cases.

**Reading** (`oa/ingest.ts`, `oa/workflow.ts`): a Cloudflare Workflow, one instance per try (`oa-<hash>-<attempt>`): `fetch` (the ladder; the file goes to R2), `read` (JATS or PDF text to passages, replacing all the paper's passages), `embed-0…n` (the next 20 passages without an embedding, so a repeated step does what is left), `finish` (`ready` only when every passage has its embedding), and `record-failure`. A reason that waiting cannot cure (blocked, scanned, over 120 pages, wrong paper …) is a `NonRetryableError`: no retries, the paper is `unreadable`. A failed download or a fault of ours leaves it `failed`, tried again by whoever asks after an hour. A reading that has not moved for 15 minutes (its Workflow was lost) is given up and tried again. Politeness: one lane per service in the shared gate (arXiv one start every 3.2 s, free PDFs two at a time and one start a second, Europe PMC and OpenAlex a few a second).

**Limits**: 20 new papers a person a day, 300 for the whole service (an emergency brake; papers already in the index are free for everyone), 25 MB, 120 pages, 1,500 passages.

**The answer** is the same code as for a paper of your own (`answerQuestionStream`), so the same checks: the model's quote must be found in the passage it names. The question goes to the private model lane only. Nothing about the person enters the shared tables, and the question is stored nowhere.

## What was measured

Spike R8 (35 real PDFs read on Cloudflare's runtime; 23 of 42 open-access PDF links fetchable by a server; Europe PMC XML works and carries the licence) and R9 (Workflows locally: one instance per key, retries, checkpoints). In this build: about 150 new unit tests (safe fetch, JATS on a real article, PDF text, the ladder, identity, chunks, identifiers), 49 end-to-end checks of the endpoint with Workflows running locally (a paper from XML, from a PDF, from a landing page, from arXiv; two people at once; a step that fails once; every kind of unreadable paper; the two daily limits; a lost Workflow; nothing personal in the tables), 26 browser checks (the sheet, progress, Stop, abstract-only, preview, phone, signed out, axe in light and dark).

## The real-data eval (`scripts/oa-eval.mjs`, 26 Oct, from a laptop; real Europe PMC, arXiv, OpenAlex, embeddings and model)

Eight papers: four from Europe PMC XML (Ioannidis, PRISMA, WGCNA, a deep-learning-in-ophthalmology review), three arXiv PDFs (Attention Is All You Need, BERT, GPT-3 at 75 pages) and one closed Nature paper. 15 questions: English, two in Hinglish, one in Hindi, two controls the paper does not answer.

| Line | Limit | Result |
| --- | --- | --- |
| papers that should be read in full, read in full | 80% | **7 of 7** (first answer, which includes the reading, in 8.6 to 22.5 s; a paper already in the index: 2 to 7 s) |
| questions about those, answered with every quote found in the text | 75% | **10 of 10** |
| of those, the known fact is in the answer or its quotes | 70% | **9 of 9** |
| controls ("which hospital ...", "which chest X-ray dataset ...") get "not in this paper" | 80% | **2 of 2** |
| Hinglish and Hindi answered, in the right script | 70% / 90% | **3 of 3**, all in the right script |
| the closed paper is answered from its abstract | 100% | **1 of 1** (the reason shown was "not a PDF": its landing page names no PDF) |

What it taught, in the order it happened: the first run answered 7 of 10 because (a) the answer call allowed 700 tokens, which a reasoning model uses up before it finishes a Hindi or Hinglish answer ("Unterminated string in JSON": now 2,500, for papers of your own too), and (b) a model joins two stretches of a passage with "..." in its quote, which no longer matched as one run (a quote is now checked piece by piece, each piece of four words or more must be in the text; the prompt also asks for one continuous stretch). After that: 10 of 10. The eval is small; a number of 100% is a reason to grow it, not to relax.

## Measured on the deployed Worker (27 Oct 2026, staging, real publishers)

Hand-picked papers (the eval above) say little about what happens to a paper a person finds by chance. So three random samples of open-access articles with a DOI were taken from OpenAlex (seeds 27, 28, 29; the seven topics of spike R8; **112 articles**), each asked one plain question through `POST /papers/oa/ask` on the **deployed staging Worker** (the same code as production, Cloudflare's network and addresses), each by a throwaway staging account (`scripts/staging-session.mjs`, staging database only, erased after). The script is `scripts/oa-sample.mjs`.

| Result | Papers | Share |
| --- | --- | --- |
| **Read in full** (46 from a free PDF, 15 from Europe PMC's XML) | 61 | **54%** (the 55% of R8, again, now on the real thing) |
| Answered from the **abstract only**, with the reason said (a publisher refused the download: 9; a link that was not a PDF: 3) | 12 | 11% |
| **"Nothing to read"**: not readable and no abstract found | 25 | 22% |
| Stream cut on the way to my machine (see below) | 13 | 12% |
| Still being read after two minutes (the answer was asked for again) | 1 | 1% |

(One of the 61 read in full had its answer fail on the model side, `ai_failed`, and is counted among them.)

- **"Nothing to read" was a gap, and is fixed.** The fallback looked for an abstract in Europe PMC only, which has them for biomedical papers; for a paper from any other field, or a bare DOI pasted into the box (no card to send its abstract), a paper that could not be read ended with "nothing to read". It now also asks OpenAlex for the abstract (`lookupOpenAlexAbstract`, unit-tested, endpoint-tested, a stand-in paper in the offline network). **The same 25 papers asked again on staging: 23 were answered from their abstract, with the reason shown; 2 have no abstract anywhere.** So 61 + 12 + 23 = **96 of 112 (86%)** now get an answer grounded in the paper's own words (full text or abstract), 2 get an honest "nothing to read", and the rest are the cuts below. The message for the two now names the real reason ("The publisher does not let a program download this paper. No abstract could be found either…") instead of saying the paper is not open access, which was wrong for a paper that is.
- **The stream cuts are the path to my machine, not the Worker.** 13 of 112 answers were cut (ECONNRESET, 0.2 to 1.4 s after the last byte, so not an idle timeout; at 1 to 92 s into the answer). On the Worker side, tailing `scholar-staging` during the third sample: **252 events, every one `outcome: ok`, no exception, every ask status 200**; the ask that the client lost at 61 s was finished normally by the Worker at 121 s. The same machine also lost a log-tail connection ("did not respond to a keep-alive ping"), so this link is not reliable. I could not prove it is only my link: Cloudflare's edge ending a long response is not excluded. What the product does about it is what it should: the sheet says "The answer was cut off. Ask again: a paper that was being read keeps being read" (and "The connection was lost"), and asking again is fast because the reading went on. If a pilot user reports "cut off" often, the first thing to do is look at `wrangler tail scholar` during their session.
- **Time.** A paper that is new to the index takes a median of **20 to 25 s** to the first answer (fetch, read, embed, answer), the slowest 121 s; a paper already in the index answers in 3 to 6 s. The sheet shows how far the reading has got and says that it keeps going if closed.
- **Limits of this measurement:** a sample of articles OpenAlex says are open access, in seven topics, from one machine on one day; publishers change; the question was one generic sentence, so this says what can be *read*, not how good the answers are (the eval does that).

## Not done, on purpose

- ~~Not tried on the deployed Worker with real publishers~~ (done 27 Oct: see above; 54% read in full, 86% answered from the paper's own text).
- **The eval is small.** `scripts/oa-eval.mjs` (weekly, with a gate) asks 8 real papers 15 questions; it says little about two-column text, tables and equations, and nothing about papers in other languages. Grow it before this leaves the `?ws=1` flag.
- **No refresh after 180 days** and no retraction check at ask time beyond the badge the card already carries.
- **No "Save to My papers" pointer**, and no reader for the shared PDF (it is kept only to be read again; nothing serves it back). The licence is stored so that decision can be made later (CC0, CC BY and CC BY-SA only).
- Scanned open-access PDFs are not read (OCR stays for a person's own uploads).
- The PDF path does not read tables or equations beyond what the text layer gives.
- Idea Check and Check references still open their own pages (W5 brings Idea Check inside).
