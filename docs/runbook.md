# Runbook

Production: https://sodhsetu.in (the CI health check and the watchdog use it; https://scholar.shodhsetu.workers.dev still answers while people move over, `www` redirects to the bare name; Worker `scholar`, D1 `scholar-db`, R2 `scholar-files`, queue `scholar-jobs`).

## Deploy

Every push to `main` runs CI, and only if it passes, deploys:

1. typecheck, unit tests, citation eval (replay), web build, **integration** (real Worker + local D1 + fake IdP), `npm audit`
2. apply D1 migrations to production
3. `wrangler deploy`
4. check `GET /api/v1/health` (fails the run if the service is down or the database is not migrated)

Manual deploy (only if CI is unavailable): `npx wrangler login`, then `npm run deploy`.

## Check that production is healthy

Two addresses, both answer 200 when well and **503** when not, and neither shows anything private:

- `GET /api/v1/health`: `{ok, db, migrations, version}`. 503 if D1 is unreachable or no migrations are applied. Used by the deploy check.
- `GET /api/v1/health/jobs`: whether the daily job ran on time. 503 if it failed, did not finish, or has not run for 30 hours (see "Alerts"). Staging answers `{"scheduled": false}` because it has no schedule.

An hourly check of both is already set up (the Watchdog workflow, see "Alerts"). For minute-level alerts point an uptime service (for example UptimeRobot, free) at the same two addresses and alert on non-200.

## Roll back

Code: `npx wrangler rollback` (pick the previous version), or revert the commit and push. Migrations are forward-only, so
**every migration must keep the previous version of the code working** (add columns/tables first, remove old ones in a later
release). That is what makes a code rollback safe.

Data: see "Backups and restore" below. In short: `npx wrangler d1 time-travel restore scholar-db --timestamp=<time before the damage>`, then the checks on `/admin`.

## Logs

Workers Logs are on (Cloudflare dashboard → Workers → scholar → Logs). Each request writes one JSON line:
`{level, msg:"request", requestId, method, path, status, ms, cfRay}`. Query strings are never logged. A user can quote the
`X-Request-Id` response header or the `requestId` in a 500 body; search for it.

## Secrets

List: `npx wrangler secret list` (names only). Rotate one:

```sh
# 1. put the new value in apps/api/.dev.vars, then
npm run secrets:push -w apps/api -- --only=GOOGLE_CLIENT_SECRET
# 2. for keys the weekly live eval also uses (OPENALEX_API_KEY, S2_API_KEY, NCBI_API_KEY, CROSSREF_MAILTO):
gh secret set OPENALEX_API_KEY
```

`ENABLE_DEV_ROUTES` and `DEV_IDP_URL` must never exist in production (the script refuses to upload them).
After rotating a pasted-in-chat credential, revoke the old one at the provider.

## Limits and housekeeping

- Rate limits: `ratelimits` in `apps/api/wrangler.jsonc` (search 60/min, other API 240/min, per IP). Change and deploy.
- Cron (daily 03:17 UTC) deletes expired cache, sessions and OAuth states and old usage rows. Every run leaves a heartbeat in the `job_runs` table (started, finished, ok or failed, last error), shown on `/admin`
  under "Scheduled jobs" and reported by `/api/v1/health/jobs`, so a trigger that stops, a run that throws and a run that hangs are all noticed. The log line `{"msg":"maintenance","deleted":{...}}` is still written.
  `EXPECT_CRON` ("1" in production, "0" in staging) tells the health address that the job is expected; the migration counts as the first good run.
- The same cron runs a second job, `retraction_check` ("Retraction re-check of saved papers", S3, [design/s3-retraction.md](design/s3-retraction.md)): every saved paper's DOI is asked about at Crossref at most once a week (400 a run, in groups of 40, through the shared Crossref lane), what is learned goes to `paper_retraction` (shared, no person) and a notice to `library_alerts` for each person who saved a paper that turned out to be retracted. Its heartbeat is listed beside the clean-up (same alerting). The log line `{"msg":"retraction_check","result":{"checked":..,"retracted":..,"unknown":..,"alerts":..}}` says what a run did. If it fails (Crossref down), the earlier groups of that run are kept and the next night continues; to run it by hand, trigger the cron (Cloudflare dashboard, Workers, Triggers, "Run" the schedule). To see what is known: `SELECT state, COUNT(*) FROM paper_retraction GROUP BY state`.
- The nightly purges run in pieces of 5,000 rows, with a 25-second budget ([design/scalability.md](design/scalability.md)). One failing purge does not stop the others, but the run then fails and names it
  on `/admin` and `/api/v1/health/jobs`. A `maintenance_budget` warning in the logs means the run stopped early and the next night continues; several nights in a row means a table grows faster than it is emptied.
- Migration 0024 adds `library_items.doi` (a copy of the paper's DOI, kept by the code on every save). If a paper is ever written to `library_items` by hand, set the column too, or its retraction check is skipped.
- Scanned papers: pages per person per day is the Worker variable `OCR_PAGES_PER_DAY` (default 60; a value that is not a whole number from 1 to 2000 is ignored). It is a plain
  variable, not a secret: set it in `wrangler.jsonc` `vars` (and the staging block) and deploy. Cost and how it works: [ocr.md](ocr.md).
- Semantic Scholar: calls go through the `S2Throttle` Durable Object (1 request/second); Crossref and CORE through `ApiGate` (next section). S2 also returns 429 on its own
  under load; the search then reports `s2` as failed and still returns the other three sources. That is upstream, not a bug.

## Uploaded papers

PDFs and covers live in R2 (`scholar-files`, keys `docs/<user>/<id>.pdf`), text and vectors in D1 (`doc_chunks`), answers in `doc_qa`.
Limits are in `packages/shared/src/documents.ts`. An upload that stops half way leaves a paper in "uploaded" or "indexing":
the user sees **Index again** on its card, which re-reads the stored PDF in the browser and re-sends the text; nothing to do server side.
Orphaned R2 objects can only appear if a delete fails between the file and the rows, or after a database restore. `/admin`, "Data checks", **Compare papers with stored files** lists both kinds
of drift (a paper without its file, a file without a paper) by short paper id; files and papers younger than 15 minutes are not judged. It is read only. `QA_STUB` must never exist in production (the secrets script refuses to upload it).
A question uses one gateway call (about 3 to 4k tokens); the per-user daily token quota is in `src/llm/config.ts`.

## Idea Check, reports and the admin page

- **Idea Check** (`/idea`): the idea text is sent to `POST /api/v1/idea/plan` (private model), is not stored and is not logged. Only the approved search plan
  goes to OpenAlex and Semantic Scholar. Nothing about a check is kept server side.
- **Comparison and second reading** (`POST /api/v1/idea/compare` and `/idea/insights`): the researcher asks for each; each is one model call on the private route, streamed as stages, nothing stored. Measured with the real model
  (22 Oct): about 5,500 tokens and 20 to 60 s for the comparison, about 6,500 tokens and 25 to 80 s for the second reading (its time limit is 150 s); a whole check is 12,000 to 14,000 tokens (23 Oct: the earlier 19,000 to 24,000 counted streamed
  output twice, see [spikes/R5-cost.md](spikes/R5-cost.md)), so the 60,000 a day is about five checks (roadmap D6). Locally, with `ENABLE_DEV_ROUTES=1` and a real model, the Worker logs every claim it dropped (`compare_dropped`, `insights_dropped`, with the quote and the abstract) so the prompts can be tuned; never in production.
  `node apps/api/scripts/idea-live.mjs` runs all of it on three real ideas (use `LIVE_SUB=<name>` for a fresh test user when a day's allowance is used up).
- **OpenAlex budget.** The API key has a daily budget of **$1** (response header `X-RateLimit-Limit-USD`), about 1,000 searches, shared by production, local testing and the
  eval. When it is used up OpenAlex answers 429 until the reset (`Retry-After` seconds): search then reports `openalex` as failed and the other sources carry on, Idea Check
  reports the failed searches, and the Verifier falls back to Crossref. A full `npm run eval:record` uses a large part of the day's budget: do not record while testing live.
  Check what is left: `curl -sI "https://api.openalex.org/works?per-page=1&select=id&api_key=KEY" | grep -i ratelimit`.
  A separate key for development and the eval, or prepaid credit, removes the problem.
- **Reports** ("Report a problem" on an answer, a reference or an idea search) go to the `feedback` table and are kept for a year (cron) or until the account is deleted. They are
  listed on `/admin`. Make someone an admin in D1: `npx wrangler d1 execute scholar-db --remote --command "UPDATE users SET role='admin' WHERE email='you@example.com'"`
  (sign out and in again). The admin overview shows counts, AI use per day and per model, failures and reports; it never shows paper or idea text, and shows people only as a short id.
- **Someone asks to delete their data and cannot sign in:** `/admin`, **Erase an account**. Type their e-mail address or ORCID iD, press Erase, confirm. It is the same erasure as "Delete my account"
  (papers, files, library, reports, sign-in, and the deletion marker that keeps a restore from bringing the account back). It signs the person out, refuses your own account and any other admin (remove the role first with
  `UPDATE users SET role='scholar' WHERE email=...`), and the address typed is used for one lookup and not stored. The audit log records "account_erased_by_admin" without saying who.
- Answers reported as wrong are the raw material for the Q&A gold set: copy the question and passage into `apps/api/scripts/r2/questions.json` (new `id`) once the right answer is known.
- **Weekly Q&A quality** (`.github/workflows/qa-eval.yml`, Tuesdays): downloads the five public gold-set papers, asks the 35 questions with the real models and fails below the gate
  (`qa-eval.mjs --gate`). It needs the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets. First run: trigger it by hand (Actions, "Q&A quality", Run workflow).

## The new look (the only look since W6b, 29 Oct 2026)

- It is **the only look** (W6b, 29 Oct 2026): the switch (`?ws=0` / `?ws=1`) and the old pages (the old header, top navigation, library drawer, account menu and the home page with its hero) are gone from the code. A value the switch once left in a browser (`scholar.ws`) is cleared on load. To go back to the old pages, revert the W6b commit.
- What it is: the intro page for signed-out visitors (`/`), the home screen (`/` signed in, `/home` for people who skipped signing in), the rail (with Admin for admins), `/library`, `/settings` (with "Link ORCID/Google"), My Workspace. Design and measurements: [design/scroll-site.md](design/scroll-site.md), plan: [design/unified-workspace.md](design/unified-workspace.md), the switch-over: [design/w6.md](design/w6.md).
- **Size budget for a first visit** (`apps/web/scripts/budget.mjs`, run in CI after the build as `npm run budget -w apps/web`): scripts 250 KB gzip, style sheet 26 KB, preloaded fonts 185 KB, the intro chunk 15 KB, the PDF reader chunk 66 KB, and none of the heavy chunks in the first load. Going over fails the build; raising a limit is a decision written down in design/w6.md. `e2e/perf.mjs` (part of the browser integration run) measures first paint and layout shift on a slow link with a slow processor.

## Streams: the event rule, and how answers went (27 Oct 2026)

Design: [design/research-patterns.md](design/research-patterns.md), sections 1 and 3.

- **The rule for every stream the server sends: progress and text are different event types.** A *progress* event (`step`, `stage`, `ingest`) says that work is moving and never carries the words of an answer; a *text* event (`token`, `general_token`, `delta`) carries nothing but `text`, is provisional and is replaced by the result event that follows; a stream has exactly one *end* event and it is last (`done`/`error` for chat and Idea Check, `answer`/`error` for a question about a paper); the reading progress of a paper (`ingest.progress`) is a number from 0 to 1 that never goes back. The table of every event type and its kind is `packages/shared/src/stream-shape.ts` and is typed against the event unions: **a new event type does not compile until it is classified**. `streamShapeProblems` checks a recorded stream; the endpoint tests (chat, Idea Check, questions about a paper, Ask this paper) run it on every stream they read and report it on their last line.
- **A new stream or a new event:** add the type to the union, classify it in `stream-shape.ts`, and write the test for any rule it needs. Keep-alive stays an SSE comment line (`sse.ts`), never an event.
- **How answers went** (`answer_outcomes`, migration 0019, counts only: a day, a feature, an outcome, a number; no text, no person, no paper; kept 90 days): the admin page shows the last seven days under "How answers went". The line to watch is how often the model wrote an answer that our own check then refused (`not_grounded`) among the questions the papers could have answered. It decides whether a "check again" step is built: under about 5% it is not worth it.

## Open-access papers (W4, the shared index)

Design: [design/oa-w4.md](design/oa-w4.md). A paper is read once into `oa_papers` / `oa_chunks` by a Cloudflare Workflow (`OaIngest`, binding `OA_INGEST`, named `scholar-oa-ingest` in production and `scholar-oa-ingest-staging`). The first deploy that contains it creates the Workflow; nothing else to set up.

- **Look at it**: the admin page ("Open-access papers in the shared index") shows how many are ready, being read, failed for now, or cannot be read, and the reasons. Instances: `npx wrangler workflows instances list scholar-oa-ingest` and `... describe scholar-oa-ingest <instance>` (an instance is `oa-<hash>-<attempt>`; the row in D1 names its current instance).
- **A paper that is stuck "reading"**: it gives itself up after 15 minutes and is tried again by whoever asks next. To do it by hand: `UPDATE oa_papers SET status = 'failed', retry_after = NULL WHERE key = 'doi:...'`.
- **Read a paper again** (a bad extraction, or its source changed): delete its row, `DELETE FROM oa_papers WHERE key = 'doi:...'` (its passages go with it), and the next question reads it afresh. Its file stays in R2 under `oa/<hash>/` until overwritten.
- **A paper that cannot be read** (`unreadable`) stays so: `blocked`, `scanned`, `too_long`, `not_open_access`, `wrong_paper`. A `failed` one (download failed, timeout, our fault) is tried again after an hour.
- **Limits**: 20 new papers a person a day and 300 for the whole service (`oa_daily`, the row with user `*`). To raise the service's brake, change `OA_NEW_PAPERS_PER_DAY_ALL` in `packages/shared/src/oa.ts`.
- **After the first deploy, check** the share of papers that become `ready` against what spike R8 measured (about 55% of publisher PDF links fetchable by a server; Europe PMC XML and arXiv always), from a few real searches. If Cloudflare's addresses are blocked by publishers more than a laptop was, the ladder's third step is the one that suffers; the other two do not.
- **Cost**: a first reading is one download, text extraction (CPU seconds), and 60 to 600 embeddings: cents at most; a shared paper is paid for once.

## The shared lanes to Crossref and CORE (V5)

- Every call to **Crossref** and **CORE** first asks one Durable Object, `ApiGate` (binding `API_GATE`, one instance per lane: `crossref`, `core`), so the limit holds for the whole product and not per process.
  Settings are in `apps/api/src/gate/index.ts` (`GATES`): Crossref a start every 340 ms and three at once (what its polite pool says in `x-rate-limit-limit` and `x-concurrency-limit`); CORE nine starts a minute and 800 a day (it allows ten a minute; the daily
  allowance of 1,000 is from CORE's documentation, nothing in its answers shows it). State is kept in the object's storage, so a restart does not forget what was spent.
- A call the lane cannot place in time is **not made**: Search gives up after 2.5 s and goes on without Crossref, a reference check queues up to 15 s. To the caller it looks like a 429, which every caller reports as "could not check", never as "not found".
  When Crossref or CORE answer 429 themselves, the lane is closed for the time they ask (CORE: its `x-ratelimit-retry-after`), so the other callers do not walk into the same wall.
- If the Durable Object cannot be reached, each isolate keeps its own lane (a log line `gate_unreachable` is written once per isolate): a little too loose is better than every lookup failing.
- Look: no page yet. A burst test against a deployed Worker: `node apps/api/scripts/crossref-burst.mjs <base url> refs 40 15 <offset>` (use a new offset each time: answers are cached). Local: `scripts/gate-e2e.mjs`, part of `npm run integration`.
- Change a limit: edit `GATES` and deploy (the object reads it when it starts; to apply it at once change nothing else, a deploy restarts it). Reset a lane that was closed by mistake: deploy; or delete the object's storage key `state:<lane>` (Dashboard, Durable Objects, `ApiGate`).
- Adding a lane for another service: add it to `GATES`, wrap the call in `withGate(name, maxWaitMs, ...)`, and say in the wording of its errors that it is busy, not "HTTP 429" (Idea Check retries that after a pause).
- Numbers and why: [spikes/R7-lanes-and-core.md](spikes/R7-lanes-and-core.md).

## The public cache (Workers KV)

- Search results, DOI and retraction checks, reference lookups and public model answers are remembered in **Workers KV**, binding `CACHE` (namespace ids in `apps/api/wrangler.jsonc`: `scholar-cache`, and `scholar-cache-staging` for staging). Only public data goes in it; never a person's text, file or idea.
  Entries expire by themselves (a day to a week; "not found" six hours); nothing to clean up. Why KV, what it can and cannot do, and what was measured: [spikes/R6-kv-cache.md](spikes/R6-kv-cache.md).
- Look: `/admin`, "Public lookups kept" (hits and misses per source, 7 days). Contents: `wrangler kv key list --namespace-id <id> --remote` (use the staging id for staging).
- Throw everything away: change `KV_VERSION` in `apps/api/src/cache/kv.ts` and deploy. Go back to the database table: remove `kv_namespaces` from the config and deploy; the code uses `api_cache` by itself when `CACHE` is not bound
  (the daily job still cleans that table, and `cache_stats` older than 35 days).
- A deploy needs the namespace to exist already (it does; created with `wrangler kv namespace create`). A new environment needs its own namespace and a `kv_namespaces` entry.

## What it costs (and how to look)

- `/admin`, "AI use": the last 14 days (tokens, calls, failures and **cost at list prices**), then **by model** and **by feature** for the last 7 days (a document question `doc_qa`, the Idea Check steps `idea_plan`, `idea_compare`,
  `idea_insights`), and the scanned pages (pages and neurons, at $0.011 per 1,000). Each call is priced from `apps/api/src/llm/pricing.ts` when it is made; a model that is not in the table counts as free and a test fails if one that can be routed to is missing.
  **When Cloudflare changes a price or a model is added, edit that table** (source and date are in its header), or the cost shown is wrong.
- Measured unit costs and the reasoning behind not using cheaper models: [spikes/R5-cost.md](spikes/R5-cost.md). About $0.0008 a question, $0.007 an Idea Check, $0.002 a scanned page.
- From the command line: `wrangler d1 execute scholar-db --remote --command "SELECT label, COUNT(*) calls, ROUND(SUM(tokens_in)) tin, ROUND(SUM(tokens_out)) tout, ROUND(SUM(cost_cents), 3) cents FROM llm_usage WHERE ts >= date('now', '-6 days') GROUP BY label"`.
- The account's free 10,000 neurons a day are shared by tests and the weekly evals too; the daily bill above that is what the cost table adds up.

## Error reporting (Sentry)

Unexpected errors in the Worker, a failed daily clean-up, and errors in people's browsers go to Sentry through our own small client (`apps/api/src/monitoring/`). No SDK is
installed. Only the error type, a message shortened and stripped of e-mail addresses, links and ids, the stack, and a route pattern (never a URL with ids or a query) leave; no request, user, IP, cookie or
text a person typed. The browser posts to `/api/v1/monitoring` and the Worker forwards it, so the page's Content-Security-Policy is unchanged and the Sentry key never reaches the browser.
At most 20 events a minute are sent from one Worker instance, so a failure loop cannot use up the free quota (5,000 errors a month on Sentry's free Developer plan).

Set it up (once): in Sentry create a project (platform: Cloudflare Workers or JavaScript), copy its **DSN**, then
`npx wrangler secret put SENTRY_DSN` (or put `SENTRY_DSN=...` in `apps/api/.dev.vars` and run `npm run secrets:push -w apps/api -- --only=SENTRY_DSN`). Then open `/admin` while signed in as admin and press
**Send a test event**: it should say Sentry accepted it, and a "Test event from the admin page" appears in the project. Every press is a new Sentry issue (the time is in its message), so an alert on "a new issue is created" fires each time; it is sent at error level so the alert rules are tested the way they will be used. Optional: `SENTRY_ENVIRONMENT` (default `production`).

## Backups and restore

Rehearsed on 22 Oct 2026 on staging (`node apps/api/scripts/restore-rehearsal.mjs --yes`, about 80 s): put rows in every table, took a restore point, wiped every table and dropped one, restored (4.5 s), and every table, row and the schema came back
identical; restoring to the bookmark the command printed brought the wiped state back exactly (so a restore can itself be undone); a plain SQL export loaded into a fresh database gave the same rows. Run it again before launch, after any change to the data layer,
and about every quarter. It only ever touches `scholar-db-staging` (it refuses to run if `env.staging` points anywhere else).

| What | Copy | How it comes back | Reach |
| --- | --- | --- | --- |
| D1: accounts, library, paper text and vectors, questions, notes, reports | D1 Time Travel, built in, nothing to schedule | `wrangler d1 time-travel restore` | any minute of the last **30 days** (Workers Paid; 7 days on the free plan) |
| The same, as a file | `npx wrangler d1 export scholar-db --remote --output=<file>.sql` | load it into a database with `wrangler d1 execute <db> --file=<file>.sql` | the day you took it. Take one before a risky migration. It contains personal data: keep it encrypted, off shared drives, and delete it within 30 days (the privacy text promises 30) |
| R2: the PDFs and covers | **none** (no versioning in R2) | the owner uploads the PDF again; the records stay, and "Index again" re-reads it | not restorable. A copy would outlive an account deletion, so none is kept on purpose |
| Secrets | not readable back from Cloudflare | names are in `apps/api/.dev.vars.example`; keep the values in a password manager | |
| Code | GitHub | `git` | |

**To restore the database** (after a bad migration, a wrong `DELETE`, a bug that damaged rows):

1. Stop the damage first: `npx wrangler rollback` for a bad deploy. Note the time just before it started.
2. `npx wrangler d1 time-travel info scholar-db` prints the current bookmark. Write it down: it is your undo.
3. `npx wrangler d1 time-travel restore scholar-db --timestamp=<ISO time before the damage>` (add `--json` to read the answer). It prints the bookmark it replaced; keep that too.
4. Check `/api/v1/health` (200) and a count: `npx wrangler d1 execute scholar-db --remote --command "SELECT COUNT(*) FROM users"`.
5. If the restore point is **before a migration**, the code expects a newer schema: run `npm run db:migrate:remote` again (migrations are forward only and re-apply) or roll the code back to match.
6. Open `/admin`, "Data checks", and run both, in this order:
   - **Re-apply deletions after a restore.** Someone who deleted their account after the restore point comes back with the restore. When an account is deleted a marker with its random id is written to R2 (`tombstones/<id>`; R2 is not rolled back by a D1 restore); this erases again every account that has a marker and a row. Not doing this would keep data we promised to delete. Markers expire after 35 days (R2 lifecycle rule `deletion-markers` on `scholar-files` and `scholar-files-staging`), a few days longer than the 30 days a restore can reach back.
   - **Compare papers with stored files.** Files uploaded after the restore point have no record any more (orphans: delete them in the R2 dashboard once you are sure, under `docs/<owner>/`); papers whose file was deleted after it have a record but no file (the owner can delete the card and upload again).
7. Tell people what they will notice: sign-ins and sessions after the restore point are gone (sign in again), and anything saved, uploaded, asked or reported after it is gone.
8. If it did not help, restore to the bookmark from step 2 to undo it.

What a restore does not cover: R2 files; Sentry and GitHub history; anything an outside service already received.

## Alerts

What can go wrong and what notices it. Everything below sends a GitHub issue, which GitHub e-mails to people watching the repository, except Sentry, which e-mails by its own rules.

| What goes wrong | What notices | Where it shows |
| --- | --- | --- |
| The site, its database or its web app are down, or a deploy left the database unmigrated | **Watchdog** workflow, hourly (`.github/workflows/watchdog.yml`, script `.github/scripts/watchdog.mjs`): `/api/v1/health`, `/api/v1/health/jobs`, `/`. Each is tried 3 times, 15 s apart, before it counts | issue "Workflow failed: Watchdog" with the reason (for example `service: HTTP 503 (ok=false db=error migrations=0)`) |
| The daily job did not run, threw, or hung | the `job_runs` heartbeat, read by the Watchdog (`daily job`), by `/admin` ("Scheduled jobs") and by Sentry (the exception) | same issue, and the admin page |
| A workflow failed: CI on `main` (including the deploy), Q&A quality, Eval (live APIs), Browser e2e, Watchdog | an `alert` job at the end of each (`.github/scripts/workflow-alert.mjs`) | one issue per workflow, "Workflow failed: <name>", with the run link and commit. A workflow that keeps failing adds one comment every 6 hours, not one per run. The issue **closes itself** when the workflow passes again. Not for pull requests or other branches |
| An unexpected error in production, or in a browser | Sentry | the Sentry project; rules below |

Set up once (yours):
1. GitHub, this repository, **Watch** (top right) → **Custom** → tick **Issues** (or "All activity"). Without this GitHub does not e-mail you about issues the workflows open. Check your e-mail address under Settings → Notifications.
2. Sentry, project, **Alerts → Create Alert → Issues**. Three rules are enough: (a) "A new issue is created" → send an e-mail to yourself; (b) "The issue is seen more than 10 times in 1 hour" → e-mail; (c) condition "The event's tags match `source` equals `cron`" → e-mail every time (a failed daily job). Events carry the tags `source` (worker, browser, cron) and `route`. Then press "Send a test event" on `/admin` and check that an e-mail arrives. (Sentry's screens change; the idea is: new issues, spikes, and anything from the cron.)
3. Optional: an uptime service on `/api/v1/health` and `/api/v1/health/jobs` for minute-level alerts (the Watchdog is hourly, and GitHub may start a scheduled run late).

Test it: Actions → **Watchdog** → Run workflow (green means all three checks passed). To see the failure path without breaking anything: `GITHUB_WORKFLOW="Alert self-test" GITHUB_REPOSITORY=<owner>/<repo> GITHUB_EVENT_NAME=workflow_dispatch node .github/scripts/workflow-alert.mjs failure`, then the same with `success` (needs `gh auth login`); it opens and closes one issue. (Done once on 22 Oct against the real repository.)

Limits to know: GitHub pauses scheduled workflows in a repository with no activity for 60 days (push anything or run one by hand to wake it; the alerts cannot tell you that they themselves stopped); a private repository has 2,000 free Actions minutes a month, and an hourly watchdog of about one minute uses roughly 720 of them.

## Literature scan (27 Oct 2026)

Design and numbers: [design/litscan.md](design/litscan.md). A scan is a row in `litscans` with its events in `litscan_events` (migration 0020) and a Cloudflare Workflow (`LitscanRun`, binding `LITSCAN`, named `scholar-litscan` in production and `scholar-litscan-staging`; the first deploy that contains it creates it, nothing else to set up).

- **Look at one:** `npx wrangler workflows instances list scholar-litscan`, `... describe scholar-litscan litscan-<scan id>` (the instance id is `litscan-` and the scan's id). A person's scan list is on the page; for yourself: `SELECT id, state, updated_at FROM litscans ORDER BY created_at DESC LIMIT 10`.
- **A scan stuck on "running":** nothing to do. A running scan that has not moved for 12 minutes is ended as `failed` the next time anyone reads it; the person can start another (one at a time). The engine tries a failed step 3 times; a sub-question that still fails is a gap.
- **Logs:** one line a finished scan (`litscan_done`: how many sub-questions, how many answered, the language, the time) and one line for a search that found nothing or that a source refused (`litscan_search`: which sources failed and with what words, e.g. `OpenAlex HTTP 429`). Many `HTTP 429` lines mean the sources are being asked too fast: the lane is `GATES.litscan` in `src/gate/index.ts`.
- **Counts:** the admin page, "How answers went", feature "Literature scan" (answered, nothing found, no paper about it, no abstracts, the papers do not answer, an answer that could not be checked, too slow, allowance used, unavailable). A rising share of "unavailable" or "too slow" is the thing to look at first.
- **What it keeps and for how long:** the topic, the approved plan and the checked report, 24 hours (the daily clean-up deletes past `expires_at`), the count of scans started today 35 days; all of it goes with an account and is in the data export (`literatureScans`).
- **Limits** (shared constants in `packages/shared/src/litscan.ts`): topic 8 to 400 characters, 2 to 6 sub-questions, 4 scans a day, one at a time, 3,000 tokens a sub-question shown as the estimate and refused when the day's 60,000 cannot cover it, 75 s for the model per sub-question.
- **A new event type in the scan stream:** add it to `LitscanEvent`, classify it in `stream-shape.ts` (`LITSCAN`), and run `scripts/litscan-e2e.mjs`, which checks every stream it reads.
- **Staging check with the real model and sources:** `node apps/api/scripts/staging-session.mjs make 2 <file>`, then `APP=https://scholar-staging.shodhsetu.workers.dev SESSIONS=<file> node apps/api/scripts/litscan-live.mjs`, then `... staging-session.mjs cleanup`. It prints the plan, the time of every event, each section and the tokens by label (`litscan_plan`, `litscan_worker`).

## A literature scan shared by a link, and the refresh of old open-access papers (28 Oct 2026)

- **Shared links** (`litscan_shares`, migration 0021): `GET /api/v1/litscan/shared/<token>` needs no sign-in and returns the scan without its owner. A wrong, turned-off or expired link is one 404. To kill a link by hand: `DELETE FROM litscan_shares WHERE scan_id = '<id>'`. A person can have 5 at a time; the link ends with the scan (24 h), by the daily clean-up, or with the account. The static host adds `noindex`, `no-store` and `Referrer-Policy: no-referrer` for `/literature-scan/shared/*` (`apps/web/public/_headers`).
- **Refresh of a paper in the shared index** (`oa_papers.content_hash`, `refresh_at`, migration 0022): a ready paper read more than 180 days ago is fetched again when someone asks it. Look at one: `SELECT key, status, attempt, ready_at, refresh_at, content_hash FROM oa_papers WHERE key = 'doi:…'`; the instance is `oa-<hash>-<attempt>` as for a first reading (`npx wrangler workflows instances describe scholar-oa-ingest <instance>`). A refresh that cannot fetch leaves the paper `ready` and moves its `ready_at` to 150 days ago (it is tried again in 30 days). To refresh a paper now: `UPDATE oa_papers SET ready_at = datetime('now', '-200 days') WHERE key = '…'` and ask it once.
- **Retractions at ask time:** the `paper` event of `POST /papers/oa/ask` carries `retracted: true` from Crossref's data through the public cache (a day). A failed lookup is silent by design.
- **Running two Workers locally** (an experiment beside a test run): `INTEGRATION_PORT`, `INTEGRATION_STATE` and `INTEGRATION_CONFIG` change the runner's port, state folder and generated config; the fake identity provider of the suites is on 9911, so only one suite or evaluation can run at a time. A model comparison belongs in its own `git worktree` (its own folder, its own `wrangler dev`), so it does not watch the folder you are editing.

## Indian sources (28 Oct 2026)

- The switch under the prompt box sends `scope: "india"` with `POST /api/v1/chat`; `GET /api/v1/search?q=…&scope=india` does the same for a plain search (an unknown scope is a 400). Sources: `doaj`, `shodhganga`, `openalex-india` (src/search/india.ts), cached a day like the others.
- **DOAJ** allows 2 requests a second for everyone: the lane `doaj` (a start every 600 ms, 2 at once) keeps us under it; a 429 closes the lane for its `Retry-After`. If DOAJ is down the other two still answer and the reply says the list may be incomplete. Since 28 Oct DOAJ is also the fifth source of the regular search (`doaj-all`, same lane, [doaj-regular.md](design/doaj-regular.md)); there, DOAJ failing alone does **not** make the reply say "incomplete" (it is in `providers` and the logs).
- **Staging has no OpenAlex or Semantic Scholar key**, so OpenAlex answers it HTTP 429 once the shared key-less allowance of the day is used (the regular search too). To test the Indian sources end to end use a local Worker with `.dev.vars` (`npx wrangler dev`, real model, see [india-sources.md](design/india-sources.md)) or production.
- What the switch adds is measured with `node scripts/india-live.mjs` (real services, needs `OPENALEX_API_KEY`).
- **Literature scans can use it too** (migration 0023, `litscans.scope`, `'all'` or `'india'`; the Workflow reads it in its `load` step). See which: `SELECT id, scope, state FROM litscans WHERE user_id = '…'`. The review the page shows (themes, evidence table, study designs, APA, CSV/BibTeX/RIS) is built in the browser from the stored parts: nothing new is stored for it ([litscan-review.md](design/litscan-review.md)).

## The support judge (28 Oct 2026)

Every answer of the prompt box, and every sub-question of a literature scan, is read a second time: a model (Llama 3.3 70B, then Mistral Small 3.1) says which sentences of the cited abstracts support each claim; unsupported claims are left out ([claim-support.md](design/claim-support.md)). It costs one more call per answer: about 2,500 tokens (2.3k in, 0.2k out), about 0.024 cent and 7 s, counted in the person's 60,000 a day like any other call (so a day holds about nine searches instead of fourteen; a scan sub-question is estimated at 5,500 tokens, it was 3,000).

- **Switch it off**: set the Worker variable `CHAT_JUDGE` to `off` (`wrangler deploy --var CHAT_JUDGE:off`, or in the dashboard). Answers are then shown as before, without a `checked` flag, and the banner says only that each mark points at a sentence. Use it if the model service is failing for long or the AI cost must stop. Nothing else changes.
- **When the judge fails** (a timeout of 20 s, an error, a reply that does not fit) the answer is shown as written and the banner says the claims were not read against the sentences. One log line a call: `chat_judge` with the counts of verdicts, `leftOut`, `ms`, the model, and `error` when it failed (never a word of the question, the answer or an abstract). Many `error` lines in a row mean the judge's models are down; the usage page shows the label `chat_judge` (and `litscan_worker_judge`) per model.
- **Check strictly** (`POST /api/v1/chat/tighten`, 29 Oct 2026): the reader asks for a slower, stronger reading of an answer ([claim-support.md](design/claim-support.md), section 4). It uses gpt-oss-120b (20 to 45 s, about 5,000 tokens) plus a quick second reading, counts in the person's day like any call, and has its own limiter (the AI bucket, `ASK_LIMITER`). `CHAT_JUDGE=off` switches it off as well (503 "switched off"). Logs: `chat_judge` lines with `rewritten`, `offered`, `checkMs`; usage labels `chat_strict` and `chat_strict_recheck`. About 5% of calls fail (the model's stream is cut); the reader is told and can press the button again. Nothing of the request is stored.
- **Check it**: `node apps/api/scripts/support-eval.mjs --split=all --gate` against a local Worker with a real model (it runs every week in `qa-eval.yml`); the labelled claims are `apps/api/scripts/fixtures/support-gold.json`.

## The own domain (sodhsetu.in, 31 Oct 2026)

- Bought at Spaceship on 30 Oct 2026 for 2 years (auto-renew on; renews around Oct 2028). Spaceship holds only the registration and the nameservers (`leia.ns.cloudflare.com`, `will.ns.cloudflare.com`); **all DNS is in Cloudflare** (Free plan, zone `sodhsetu.in`).
- The Worker serves it through the `routes` custom domain in `apps/api/wrangler.jsonc` (Cloudflare makes the record and the certificate). There is deliberately **no other DNS record on the bare name**: a record there stops the custom domain from attaching.
- `www.sodhsetu.in` is a proxied dummy record (`192.0.2.1`) that exists only so a Cloudflare **redirect rule** ("www to apex", 301, path and query kept) can answer it. **Always Use HTTPS** is on (SSL/TLS, Edge Certificates). Leave Rocket Loader, Email Obfuscation and Bot Fight Mode off: they rewrite pages or challenge API clients.
- Sign-in addresses: `https://sodhsetu.in/api/v1/auth/google/callback` and `.../orcid/callback` are registered at Google and ORCID (docs/auth-setup.md). A new domain or subdomain needs them added there first.
- Roll back the domain alone: delete the `routes` line and deploy; `https://scholar.shodhsetu.workers.dev` keeps working (`workers_dev` is on). Do not remove the Cloudflare zone while the Worker uses it.
- Mail: **Cloudflare Email Routing** (Free) forwards `team@sodhsetu.in` (the contact address on the legal pages) and `privacy@sodhsetu.in` (the grievance address) to the owner's own inbox; the catch-all is off. It only receives: nothing can be sent *from* these addresses yet. The MX, SPF and DKIM records are Cloudflare's and are in the zone's DNS; do not use Spaceship's own e-mail forwarding (it writes records into a DNS zone that is not in use and can pull the nameservers back).
- Without DNSSEC the domain still works; DNSSEC is turned on in Cloudflare (DNS, Settings) and its DS record is added at Spaceship (Domain, DNSSEC). Turn it off at Spaceship **first** if the nameservers are ever moved away from Cloudflare, or the domain stops resolving for many people.

## The product's name (Sodhsetu, 31 Oct 2026)

The product is called **Sodhsetu** everywhere a person can see it: the page titles, the logo's wordmark, the intro film, sign-in, the legal pages, the Word and PDF exports, the scan notification, the data export file (`sodhsetu-export-DATE.json`). It was first called "Scholar AI". The old name is kept only where changing it would cost people their data or break a deployment, and none of it is shown:

- the browser's saved keys and caches (`scholar.*` in localStorage, the `scholar` IndexedDB, `scholar-*` caches): renaming them would lose each person's local library, chats, drafts and offline papers;
- the Cloudflare names (Worker `scholar`, D1 `scholar-db`, bucket `scholar-files`, queue `scholar-jobs`, the `workers.dev` address), the `@scholar/*` package names and the repository name.

The names registered by hand at other services (the Google OAuth consent screen, the ORCID application, the Sentry project) are the owner's to rename there.

## Pictures drawn by Rive files, and the motion of icons (1 Nov 2026)

- Three pictures are drawn by Rive files: the bridge on a running scan, the box in the upload zone, the scene beside an upload ([design/setu-rive.md](design/setu-rive.md), [design/rive-ideas.md](design/rive-ideas.md)). They are decoration: the page is whole without them and every fact is in text.
- **What it costs.** The runtime is a lazy chunk of about 56 KB and a wasm file of about 337 KB (gzip), fetched from our own origin only when a picture is on the page; the files of the pictures are 3.4 KB. Nothing of it is in the first load, and `scripts/budget.mjs` fails the build if any of it is, or if a chunk grows past its line.
- **Who does not get them.** A person with reduced motion, with Save-Data on, on a 2g connection, or in a browser without WebAssembly; and anyone whose browser cannot start the runtime. The page shows the icons it had. If the runtime cannot be fetched at all the console says so once and nothing else changes.
- **The CSP must stay as it is.** The runtime needs `'wasm-unsafe-eval'` (already there) and fetches its files from `'self'`. It will not fetch from a `data:` address, so `vite.config.ts` never inlines a `.riv`; a build that did would show no picture for the two small files. If a browser cannot start the main wasm the runtime asks a CDN for a fallback, which the CSP refuses.
- **Changing a picture** needs the Rive CLI on the machine (no account, no login: the files have no scripts, so nothing is signed or uploaded). Edit the generator in `apps/web/rive/<name>/`, build, copy the `.riv` into `apps/web/src/assets/rive/`, and commit both: [the folder's README](../apps/web/rive/README.md). CI does not have the CLI, so it cannot check that the committed file is the generator's.
- **Icons:** hover, press, focus and "switched on" motion of the icons the app already has is CSS ([design/icon-motion.md](design/icon-motion.md)); its feel is five numbers at the top of `styles/icons.css`. Tests: `e2e/icons.mjs` and `e2e/rive.mjs` in the browser run.

## Staging

A separate, empty copy of the service at https://scholar-staging.shodhsetu.workers.dev (Worker `scholar-staging`, database `scholar-db-staging`, bucket `scholar-files-staging`, queue `scholar-jobs-staging`),
for trying a change before production. Nothing in it is real people's data. Deploy to it with `npm run build && npm run deploy:staging -w apps/api` (this applies the migrations to the staging database first).
It has no daily clean-up job. Secrets are its own: `npx wrangler secret put NAME --env staging` (today only `SENTRY_DSN`, reported as environment "staging", and `CROSSREF_MAILTO`). To sign in there, add
`https://scholar-staging.shodhsetu.workers.dev/api/v1/auth/google/callback` to the Google OAuth client's authorised redirect URIs, and put the same Google client id/secret in with `wrangler secret put ... --env staging`.
Cost: an empty staging copy is inside the paid plan's included amounts (D1, R2, Queues and Workers requests all have a free allowance that production does not use up); expect cents at most, and nothing while nobody uses it.

## Local secrets file (`apps/api/.dev.vars`)

Not in git (it holds keys), so it has to be recreated by hand on a new or wiped machine: copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars` and fill in what you need.
For local live tests only `OPENALEX_API_KEY`, `S2_API_KEY`, `NCBI_API_KEY` and `CROSSREF_MAILTO` matter; the sign-in pairs are not needed locally (tests use a fake identity provider).
Production does not read this file: its secrets live in Cloudflare (`npx wrangler secret list`), and `npm run secrets:push -w apps/api` copies a key from this file up to Cloudflare.

## Test everything locally

```sh
npm run build && npm run integration -w apps/api              # auth + library against a real local Worker
npm run integration -w apps/api -- --browser                  # plus the Playwright/axe suites (E2E_BROWSER=chrome|msedge)
npm run integration -w apps/api -- --browser --only="browser: admin,operations"   # some suites only (substrings of their names, comma separated)
npm run test:scripts                                          # the tests of the alert and watchdog scripts (.github/scripts) and the rehearsal helpers
```

Rule for tests that need to change the database (age a row, rename a table, bring back a deleted account): do it **through the Worker** (`POST /api/v1/dev/sql`, which exists only with `ENABLE_DEV_ROUTES=1`),
never with `wrangler d1 execute --local` from a second process while `wrangler dev` is running. On 22 Oct that made the dev server spin at 100% CPU (over 1,000 CPU-seconds) and stop answering anything, which showed up as
random timeouts in whichever suite ran next. The integration runner's own clean-up between suites works this way too. Also stop a leftover `wrangler dev` (for example from a spike) before running the suites.

## Offline reading (service worker)

`apps/web/public/sw.js` is served at `/sw.js` (`Cache-Control: no-cache` in `_headers`, so a new version replaces the old at the next visit). It does nothing unless a person switched on "Offline reading" in Settings (the page registers it and sends it "on"; the flag lives in the cache `scholar-meta`). Caches: `scholar-shell-v1` (the page, `/assets`, `/pdfjs`), `scholar-data-v1` (the few small reads: paper details, notes, drawing, list, who is signed in), `scholar-papers-v1` (PDFs, the ten last). Reads go to the network first, with a 6 second wait before a kept copy is used. Drawings that could not be sent are in IndexedDB (`scholar` / `pendingInk`).

- **Change what is cached**: edit `readable()` or `isAsset()` in `sw.js`; if the shape of what is kept changes, bump `VERSION` (old caches are deleted when the new worker activates).
- **Kill switch** (if a worker ever misbehaves for everyone): deploy a `sw.js` that contains only `self.addEventListener("install", () => self.skipWaiting()); self.addEventListener("activate", async () => { for (const k of await caches.keys()) await caches.delete(k); await self.registration.unregister(); });`. Browsers pick it up at the next visit.
- Signing out, deleting the account, deleting a paper and switching the setting off clear what was kept (`lib/offline.ts`); a person who signs out with an unsent drawing is asked first.
- Tested by `apps/web/e2e/offline.mjs` with real network cuts (`context.setOffline`).

## Not done yet (decisions for later)

Custom domain (needed before public launch; OAuth redirect URIs and cookies depend on it), Turnstile on sign-in, email login.
Sentry alert rules (above, your side), "Watch: Issues" on the repository, a rehearsal of the restore with production-sized data.
