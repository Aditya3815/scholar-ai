# R9: can a Cloudflare Workflow run the open-access ingest? (spike, 26 Oct 2026)

Question: for W4, is a Workflow a better engine for "fetch, read, embed, finish" than a queue consumer, and can we test it here? Code: [R9/](R9/) (own `package.json`, not part of the app; run with `npx wrangler dev --port 8801`).

## What was tried

A Workflow shaped like the ingest (`fetch`, `read` with retries and a timeout, `embed-0 … embed-n` in batches of 20 chunks, `finish`), started by `POST`-like calls with `env.INGEST.create({ id: paperKey, params })`, run in `wrangler dev` (local, wrangler 4.151.1).

## What happened

| Test | Result |
| --- | --- |
| A normal run | All steps ran once, in order; `status()` reports `complete` with the output. Steps are memoised: each step body ran exactly once |
| The `read` step fails on its first try (a simulated out-of-memory) | Retried by the engine with the configured delay; the second run succeeded. `fetch` was **not** run again (it ran once, `read` twice): this is the checkpoint |
| A second request for the same paper while it is running, or after it finished | `create` with the same `id` throws `instance.already_exists`; the handler catches it and **joins**: reads `status()` of the instance that exists. The paper key as instance ID gives "two people ask at once: one ingest" without writing a lock |
| Two requests at the same moment for a new paper | One `started`, one `joined` (`running`), one run in the end |

## What it means

1. **Workflows are the engine for the ingest.** Named steps, retries, checkpoints and the one-instance-per-key rule are what the design (P-7, P-8) asked for, and they work in the local test setup that the integration suites already use (`wrangler dev`; the Workflow binding is part of `wrangler.jsonc`, so the generated integration config carries it).
2. **The instance ID cannot be reused.** A finished or failed instance keeps its ID for the retention period (3 days on the free plan, 30 on Paid per Cloudflare's limits page), so "asking again retries once" (P-8) needs a **new ID per attempt**: `oa-<keyhash>-<attempt>`, with the attempt counter in the D1 row. The D1 row, not the engine, says what the paper's state is, and which instance is current.
3. **IDs are at most 100 characters**, so the key is hashed into the ID.
4. **Steps return at most 1 MiB**: the PDF goes to R2 in the fetch step and later steps pass the key; chunks are written to D1 inside the embed steps under `(paper_id, idx)` (a repeated step overwrites the same rows).
5. **Not tested here:** behaviour on the deployed Worker (the first deploy is the test), a restart in the middle of a step, the CPU and memory of the `read` step inside a Workflow (R8 measured the extraction in a plain Worker).
