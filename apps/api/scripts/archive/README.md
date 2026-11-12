# Archived scripts

Finished spikes, one-off measurements and one-off data builders (owner decision 11 of [docs/design/untangle.md](../../../../docs/design/untangle.md), 12 Nov 2026). Nothing runs them: no `package.json` script, workflow, test or integration suite. They are kept, and still run from here (`node scripts/archive/<name>.mjs` from `apps/api`), because the design notes and spikes that quote their numbers name them, and a measurement may be repeated. The data they made stays where it was (`eval/data/`, `eval/fixtures*.json.gz`, `docs/eval/understand/`, `scripts/r2/`).

| Script | What it did | What it made or measured |
| --- | --- | --- |
| `build-dataset.mjs` | Built the frozen eval datasets from OpenAlex and Crossref (was `eval/`) | `eval/data/*.json` |
| `build-fakes.mjs` | Built 30 fabricated references and checked the topical set (was `eval/`) | `eval/data/fake_refs.json` |
| `build-heldout.mjs` | Built the held-out eval set the verifier was never tuned on (was `eval/`) | `eval/data/` held-out files |
| `build-prior-art.mjs` | Built the prior-art set for Idea Check retrieval (was `eval/`) | `eval/data/prior_art.json` |
| `build-understand-sets.mjs` | One-time builder of the Understand eval sets; refuses to overwrite labelled files (was `eval/`) | `docs/eval/understand/*.json` |
| `scrub-fixtures.mjs` | Re-applied the trimming and scrubbing to an existing recording (was `eval/`) | `eval/fixtures.json.gz` |
| `spike-grobid.mjs` | Spike R1: GROBID on scholarly PDFs | `docs/spikes/R1-grobid.md` |
| `spike-r3.mjs` | Spike R3: 50 queries cold and warm, DOI validity, retraction sanity | `docs/spikes/R3-search.md` |
| `scan-spike.mjs` | Spike R11: the cost of a literature scan's workers | `docs/spikes/R11-scan-cost.md` |
| `r5-ocr.mjs` | Spike R5: the cost of reading scanned pages with other models and resolutions | `docs/spikes/R5-cost.md` |
| `r5-replay.mjs` | Spike R5: Idea Check model steps replayed with other models and prompts | `docs/spikes/R5-cost.md` |
| `r2-run.mjs` | Spike R2: grounded paper Q&A across models (was `scripts/r2/run.mjs`; its data stays in `scripts/r2/`) | `scripts/r2/` results, `src/llm/config.ts` model choice |
| `crossref-burst.mjs` | Many reference checks at once against a deployed Worker (lanes) | `docs/spikes/R7-lanes-and-core.md`, runbook |
| `latency-live.mjs` | P7: time to the first words of an answer on staging | `docs/design/p7-latency.md` |
| `oa-sample.mjs` | A random sample of open-access papers asked through Ask this paper | `docs/design/oa-w4.md` |
| `india-live.mjs` | What the Indian-sources scope adds, real services | `docs/design/india-sources.md` |
| `doaj-live.mjs` | What DOAJ would add to the regular search | `docs/design/doaj-regular.md` |
| `litscan-live.mjs` | The literature scan on staging with the real model and sources | `docs/design/litscan.md` |
| `scan-live.mjs` | Scanned pages read by the real models through the real route | `docs/ocr.md`, `docs/spikes/R4-ocr.md` |
| `chat-live.mjs` | The prompt box's search with the real sources and model (W2) | `docs/design/chat-w2.md` |
| `docs-live.mjs` | Upload, index and ask with the real models | `docs/qa.md` |
| `idea-live.mjs` | Idea Check with the real model and sources | `docs/runbook.md`, `docs/spikes/R5-cost.md` |
| `refs-check.mjs` | How many references the browser's extraction finds in real PDFs | `docs/eval/README.md` |
| `refs-live.mjs` | The Reference Verifier on the references of real PDFs, live services | `docs/eval/README.md` |
| `search-live.mjs` | The real search code against the real services, no Worker | (no write-up) |
| `stream-live.mjs` | Streaming answers with the real models, stage timings | (no write-up) |
