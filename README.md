# Scholar

Research assistant for scholars: verified citations, grounded paper Q&A, reference checks.

## Layout

- `apps/web` Vite + React + TypeScript (3 themes: Light / Dark / Read)
- `apps/api` Hono on Cloudflare Workers (D1, Queues; serves the web build as static assets)
- `packages/shared` shared types
- `docs/` spikes (search, LLM routing, GROBID), ADRs, runbook

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
`npm run e2e -w apps/web` (Edge headless: screenshots in `apps/web/e2e/shots`, axe accessibility scan, mobile overflow, CSP violations;
needs the local server from `npm run dev:api` running, or use `npm run integration` above).

Citation accuracy: `npm run eval` replays recorded API responses against 100 real papers, 20 retracted papers and 30 fabricated
references (gates: 0 fabricated references verified, 0 unresolvable DOIs, all retractions detected). See `docs/eval/README.md`.
It runs in CI on every push; a weekly workflow repeats it against the live APIs.

Auth, library and account tests run against a **fake identity provider** (no real Google/ORCID account needed). One command starts a
throwaway local Worker and database and runs them (after `npm run build`): `npm run integration -w apps/api`; add `-- --browser` to
also run the Playwright suites (set `E2E_BROWSER=chrome` if you do not have Edge). CI runs the first on every push and the second weekly.
Real credentials: `docs/auth-setup.md`.

Uploaded papers and grounded Q&A: `docs/qa.md` (try it with the real models via `apps/api/scripts/docs-live.mjs`).

How we work (decide, test first, cause before fix, prove before done): `docs/how-we-work.md`.

Docs: `docs/design/UI-direction.md`, `docs/spikes/`, `docs/llm-providers.md`, `docs/auth-setup.md`, `docs/adr/`.

Needs Node 22+ (see `.nvmrc`; CI uses Node 22).

## Deploy

Pushing to `main` runs CI and, if it passes, migrates D1, deploys the Worker and checks `/api/v1/health`.
Details, rollback and secret rotation: [docs/runbook.md](docs/runbook.md). Security model and reporting: [SECURITY.md](SECURITY.md).
