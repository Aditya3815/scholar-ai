# Runbook

Production: https://scholar.shodhsetu.workers.dev (Worker `scholar`, D1 `scholar-db`, R2 `scholar-files`, queue `scholar-jobs`).

## Deploy

Every push to `main` runs CI, and only if it passes, deploys:

1. typecheck, unit tests, citation eval (replay), web build, **integration** (real Worker + local D1 + fake IdP), `npm audit`
2. apply D1 migrations to production
3. `wrangler deploy`
4. check `GET /api/v1/health` (fails the run if the service is down or the database is not migrated)

Manual deploy (only if CI is unavailable): `npx wrangler login`, then `npm run deploy`.

## Check that production is healthy

`GET /api/v1/health` returns 200 with `{ok, db, migrations, version}`. It returns **503** if D1 is unreachable or no migrations
are applied. Point an uptime monitor (for example UptimeRobot, free) at it and alert on non-200.

## Roll back

Code: `npx wrangler rollback` (pick the previous version), or revert the commit and push. Migrations are forward-only, so
**every migration must keep the previous version of the code working** (add columns/tables first, remove old ones in a later
release). That is what makes a code rollback safe.

Data: D1 Time Travel restores the database to any minute in the retention window (7 days on the free plan):

```sh
npx wrangler d1 time-travel info scholar-db
npx wrangler d1 time-travel restore scholar-db --timestamp=<unix seconds or ISO time>
```

Restoring overwrites the live database, so note the "before" bookmark that the command prints.

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
- Cron (daily 03:17 UTC) deletes expired cache, sessions and OAuth states and old usage rows. Look for the
  `{"msg":"maintenance","deleted":{...}}` log line; if it stops appearing, the trigger is broken.
- Semantic Scholar: calls go through the `S2Throttle` Durable Object (1 request/second). S2 also returns 429 on its own
  under load; the search then reports `s2` as failed and still returns the other three sources. That is upstream, not a bug.

## Uploaded papers

PDFs and covers live in R2 (`scholar-files`, keys `docs/<user>/<id>.pdf`), text and vectors in D1 (`doc_chunks`), answers in `doc_qa`.
Limits are in `packages/shared/src/documents.ts`. An upload that stops half way leaves a paper in "uploaded" or "indexing":
the user sees **Index again** on its card, which re-reads the stored PDF in the browser and re-sends the text; nothing to do server side.
Orphaned R2 objects can only appear if a delete fails between the file and the rows; list `docs/` in R2 and compare with
`SELECT id FROM documents` if storage grows unexpectedly. `QA_STUB` must never exist in production (the secrets script refuses to upload it).
A question uses one gateway call (about 3 to 4k tokens); the per-user daily token quota is in `src/llm/config.ts`.

## Idea Check, reports and the admin page

- **Idea Check** (`/idea`): the idea text is sent to `POST /api/v1/idea/plan` (private model), is not stored and is not logged. Only the approved search plan
  goes to OpenAlex and Semantic Scholar. Nothing about a check is kept server side.
- **OpenAlex budget.** The API key has a daily budget of **$1** (response header `X-RateLimit-Limit-USD`), about 1,000 searches, shared by production, local testing and the
  eval. When it is used up OpenAlex answers 429 until the reset (`Retry-After` seconds): search then reports `openalex` as failed and the other sources carry on, Idea Check
  reports the failed searches, and the Verifier falls back to Crossref. A full `npm run eval:record` uses a large part of the day's budget: do not record while testing live.
  Check what is left: `curl -sI "https://api.openalex.org/works?per-page=1&select=id&api_key=KEY" | grep -i ratelimit`.
  A separate key for development and the eval, or prepaid credit, removes the problem.
- **Reports** ("Report a problem" on an answer, a reference or an idea search) go to the `feedback` table and are kept for a year (cron) or until the account is deleted. They are
  listed on `/admin`. Make someone an admin in D1: `npx wrangler d1 execute scholar-db --remote --command "UPDATE users SET role='admin' WHERE email='you@example.com'"`
  (sign out and in again). The admin overview shows counts, AI use per day and per model, failures and reports; it never shows paper or idea text, and shows people only as a short id.
- Answers reported as wrong are the raw material for the Q&A gold set: copy the question and passage into `apps/api/scripts/r2/questions.json` (new `id`) once the right answer is known.
- **Weekly Q&A quality** (`.github/workflows/qa-eval.yml`, Tuesdays): downloads the five public gold-set papers, asks the 35 questions with the real models and fails below the gate
  (`qa-eval.mjs --gate`). It needs the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets. First run: trigger it by hand (Actions, "Q&A quality", Run workflow).

## Error reporting (Sentry)

Unexpected errors in the Worker, a failed daily clean-up, and errors in people's browsers go to Sentry through our own small client (`apps/api/src/monitoring/`). No SDK is
installed. Only the error type, a message shortened and stripped of e-mail addresses, links and ids, the stack, and a route pattern (never a URL with ids or a query) leave; no request, user, IP, cookie or
text a person typed. The browser posts to `/api/v1/monitoring` and the Worker forwards it, so the page's Content-Security-Policy is unchanged and the Sentry key never reaches the browser.
At most 20 events a minute are sent from one Worker instance, so a failure loop cannot use up the free quota (5,000 errors a month on Sentry's free Developer plan).

Set it up (once): in Sentry create a project (platform: Cloudflare Workers or JavaScript), copy its **DSN**, then
`npx wrangler secret put SENTRY_DSN` (or put `SENTRY_DSN=...` in `apps/api/.dev.vars` and run `npm run secrets:push -w apps/api -- --only=SENTRY_DSN`). Then open `/admin` while signed in as admin and press
**Send a test event**: it should say Sentry accepted it, and a "Test event from the admin page" appears in the project. Optional: `SENTRY_ENVIRONMENT` (default `production`).

## Test everything locally

```sh
npm run build && npm run integration -w apps/api              # auth + library against a real local Worker
npm run integration -w apps/api -- --browser                  # plus the Playwright/axe suites (E2E_BROWSER=chrome|msedge)
```

## Not done yet (decisions for later)

Custom domain (needed before public launch; OAuth redirect URIs and cookies depend on it), a separate staging environment,
Sentry or similar, Turnstile on sign-in, email login.
