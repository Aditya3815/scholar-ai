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

## Not done, on purpose

- **Not tried on the deployed Worker with real publishers.** The first thing to look at after the deploy: the share of papers that become `ready` against the 55% of R8, and the reasons on the admin page ("Open-access papers in the shared index").
- **No quality evaluation yet** of answers on real papers (two-column text, tables, equations; Hindi and Hinglish questions about English papers). That is the next piece before this leaves the `?ws=1` flag: a small eval on 10 real papers with a Hinglish slice, like `chat-eval.mjs`.
- **No refresh after 180 days** and no retraction check at ask time beyond the badge the card already carries.
- **No "Save to My papers" pointer**, and no reader for the shared PDF (it is kept only to be read again; nothing serves it back). The licence is stored so that decision can be made later (CC0, CC BY and CC BY-SA only).
- Scanned open-access PDFs are not read (OCR stays for a person's own uploads).
- The PDF path does not read tables or equations beyond what the text layer gives.
- Idea Check and Check references still open their own pages (W5 brings Idea Check inside).
