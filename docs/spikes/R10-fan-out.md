# R10: can a Workflow fan out to parallel workers, survive one that fails, and be replayed? (spike, 27 Oct 2026)

Question for a "literature scan" (a plan, several workers each reading the papers of one sub-topic, a merge): does a Cloudflare Workflow run the workers **at the same time**, does one worker that fails for good leave the others and the merge intact, and can a reader that arrives late **replay the progress from a sequence number**? Code: [R9/src/index.ts](R9/src/index.ts), class `Scan` (same project as R9; `npx wrangler dev --port 8801`, then `/scan/start?key=s1&n=5&fail=3&slow=2500`, `/scan/events?key=s1&after=8`, `/scan/status?key=s1`).

## What was tried

`plan` (one step), then five worker steps started together with `Promise.allSettled(topics.map((t, i) => step.do("worker-" + (i + 1), { retries: { limit: 2, delay: "200 milliseconds" }, timeout: "30 seconds" }, …)))`, then `merge`. Worker 3 always throws; worker 1 takes 2.5 s, the others 0.4 s. Each worker appends a `progress` event to a list with a sequence number (in memory here; in the real thing a table).

## What happened

| Test | Result |
| --- | --- |
| Do the workers overlap? | **Yes.** All five `started` events came within 15 ms of each other; the four fast workers finished about 400 ms later, not 2 s later (as one after the other they would have). The slow one finished last without holding up the others |
| A worker that fails for good | It was **tried three times** (the first try and two retries, `started` three times), then rejected. The other four workers and the merge were not affected. With `allSettled` the failure arrives as data: the merge got four sections and a record `{ worker: 3, why: "…" }` for the gap |
| The result | `status()` is `complete`; the output carries the sections and the gaps. A scan with a gap is a finished scan that says what is missing, not a failed one |
| Replay | Events carry `seq`; reading `after=8` returned exactly events 9 to 15, in order. A reader that comes late, or comes back after a dropped connection, needs only the last `seq` it saw |

## What it means

1. Parallel workers inside a Workflow work as documented (Cloudflare's rules page names `Promise.race`/`Promise.any` for concurrent steps and shows `Promise.all` in an example; `allSettled` behaved the same way). Each worker is its own named, retried, checkpointed step.
2. **Progress belongs in an append-only event list with a sequence number**, written by the steps; the stream is only a reader of that list (replay from `Last-Event-ID`). This is the same shape as A2A's task events and MCP's progress notifications (see [research-patterns.md](../design/research-patterns.md)).
3. Not tested: the same on the deployed Worker; the event list in D1 (here: memory); many scans at once; cancelling a running instance (`terminate()` is documented, not tried); worker steps that really call the model and the search (their cost is the question that matters, and is estimated in the design note, not measured).
