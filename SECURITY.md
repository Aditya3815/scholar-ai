# Security

## Reporting a vulnerability

Please do **not** open a public issue. Use GitHub's private reporting: **Security → Report a vulnerability** on this repository.
Include what you found, how to reproduce it and what you think the impact is. This is a small project run by one person, so
there is no bounty, but reports are read and acknowledged.

## What is protected, and how

| Area | Control |
| --- | --- |
| Sign-in | Google and ORCID OAuth code flow with PKCE (S256) and single-use `state`; only verified emails can join an existing account |
| Sessions | Random token in an `HttpOnly`, `SameSite=Lax` cookie (`__Host-` prefixed on HTTPS); only its SHA-256 is stored, so a leaked database does not leak usable sessions |
| CSRF | State-changing requests must be same-origin |
| Browser | Strict Content-Security-Policy (no inline or third-party scripts), HSTS, `nosniff`, no framing, locked-down Permissions-Policy |
| API | Per-IP rate limits (Cloudflare Rate Limiting), request ids, structured logs without query strings, cookies or bodies |
| Citations | References are never produced by an LLM; DOIs come from Crossref/OpenAlex and are checked for existence |
| Privacy | A user's private text only goes to models in the same Cloudflare account (Workers AI); public-data tasks may use Gemini. Enforced in code and covered by tests |
| User data | Library export and full account deletion are built in and tested |
| Supply chain | `npm audit` on production dependencies is a CI gate; Dependabot opens weekly update PRs |
| Secrets | Never in the repo; production secrets are Worker secrets uploaded with `npm run secrets:push`; dev-only switches are never uploaded |

## Known gaps (tracked, not hidden)

- No bot challenge (Turnstile) on sign-in; sign-in is OAuth-only, which already limits abuse.
- No error-reporting service yet (Cloudflare Workers Logs only).
- No separate staging environment; changes are gated by CI (unit, eval, integration) and a post-deploy health check.
- Rate limits are per IP; users behind one institutional NAT share a budget.
