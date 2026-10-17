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

Docs: `docs/design/UI-direction.md`, `docs/spikes/`, `docs/llm-providers.md`, `docs/adr/`.

Needs Node 20.19+ locally (wrangler is pinned to 4.86.0; CI uses Node 22).

## Deploy

`npm run deploy` (needs `npx wrangler login`).

CI/CD: the workflow lives at `docs/ci.yml.template` because the pushing token had no `workflow`
scope. Copy it to `.github/workflows/ci.yml` once that is sorted, and add the
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets.
