# Scholar

Research assistant for scholars: verified citations, grounded paper Q&A, reference checks.

## Layout

- `apps/web` Vite + React + TypeScript (3 themes: Light / Dark / Read)
- `apps/api` Hono on Cloudflare Workers (D1, Queues; serves the web build as static assets)
- `packages/shared` shared types
- `docs/` spikes and ADRs

## Develop

```bash
npm install            # .npmrc has legacy-peer-deps=true (npm 10 peer-resolver bug)
npm run build          # web build, needed once so the Worker has assets
npm run db:migrate:local
npm run dev:api        # http://localhost:8787 (API + built web)
npm run dev:web        # Vite dev server with /api proxied to :8787
```

Secrets: copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars` (gitignored) and fill the keys
(OpenAlex, Semantic Scholar, NCBI, CORE, Crossref contact email, optional Gemini). For production use `wrangler secret bulk`.

Checks: `npm run typecheck`, `npm run contrast -w apps/web` (WCAG pairs for the 3 themes),
`npm run e2e -w apps/web` (Edge headless: screenshots in `apps/web/e2e/shots`, axe accessibility scan, mobile overflow;
needs the local server from `npm run dev:api` running).

Citation accuracy: `npm run eval` replays recorded API responses against 100 real papers, 20 retracted papers and 30 fabricated
references (gates: 0 fabricated references verified, 0 unresolvable DOIs, all retractions detected). See `docs/eval/README.md`.
It runs in CI on every push; a weekly workflow repeats it against the live APIs.

Auth, library and account tests run against a **fake identity provider** (no real Google/ORCID account needed):
start the Worker with `npx wrangler dev --port 8788 --var GOOGLE_CLIENT_ID:dev --var GOOGLE_CLIENT_SECRET:dev-secret --var ORCID_CLIENT_ID:dev --var ORCID_CLIENT_SECRET:dev-secret --var DEV_IDP_URL:http://localhost:9911 --var ORCID_BASE_URL:http://localhost:9911/orcid`
(after `npm run build` and `npm run db:migrate:local`), then `node apps/api/scripts/auth-e2e.mjs`, `node apps/api/scripts/library-e2e.mjs`,
`npm run e2e:auth -w apps/web`, `npm run e2e:library -w apps/web`. Real credentials: `docs/auth-setup.md`.

Docs: `docs/design/UI-direction.md`, `docs/spikes/`, `docs/llm-providers.md`, `docs/auth-setup.md`, `docs/adr/`.

Needs Node 22+ (see `.nvmrc`; CI uses Node 22).

## Deploy

`npm run deploy` (needs `npx wrangler login`).

CI/CD: the workflow lives at `docs/ci.yml.template` because the pushing token had no `workflow`
scope. Copy it to `.github/workflows/ci.yml` once that is sorted, and add the
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets.
