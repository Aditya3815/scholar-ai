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

## Test everything locally

```sh
npm run build && npm run integration -w apps/api              # auth + library against a real local Worker
npm run integration -w apps/api -- --browser                  # plus the Playwright/axe suites (E2E_BROWSER=chrome|msedge)
```

## Not done yet (decisions for later)

Custom domain (needed before public launch; OAuth redirect URIs and cookies depend on it), a separate staging environment,
Sentry or similar, Turnstile on sign-in, email login.
