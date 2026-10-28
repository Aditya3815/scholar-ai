# Sign-in setup (Google and ORCID)

Login code is built and tested (`apps/api/src/auth/`, `scripts/auth-e2e.mjs`, `apps/web/e2e/auth.mjs` (the new look's sign-in)). It stays **invisible** until
the credentials below exist: the UI only shows providers the deployment has configured.

Redirect URIs to register (exact match):

| Environment | Google | ORCID |
| --- | --- | --- |
| Local dev (`npm run dev:api`) | `http://localhost:8787/api/v1/auth/google/callback` | `http://localhost:8787/api/v1/auth/orcid/callback` (ORCID: use the sandbox, see below) |
| Production | `https://scholar.shodhsetu.workers.dev/api/v1/auth/google/callback` | `https://scholar.shodhsetu.workers.dev/api/v1/auth/orcid/callback` |

## Google (about 10 minutes)
1. <https://console.cloud.google.com> -> create a project (e.g. "Scholar").
2. **Google Auth Platform / OAuth consent screen**: user type **External**, app name, support email, developer contact email.
   Scopes: only `openid`, `email`, `profile` (non-sensitive, no verification needed). Leave **Publishing status = Testing**.
3. **Audience / Test users**: add the Google accounts that may sign in (limit 100 in Testing; fine for the pilot).
4. **Clients -> Create client -> Web application**: add the two redirect URIs above. Copy **Client ID** and **Client secret**.
5. Put them in `apps/api/.dev.vars`:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```
Before a **public** beta: publish the app (needs a domain you own, a privacy policy URL and a homepage). Google may refuse
`workers.dev` hosts on the consent screen; this is one more reason to get a custom domain before launch.

## ORCID (about 10 minutes)
1. Sign in at <https://orcid.org> (or the sandbox <https://sandbox.orcid.org> for testing) and verify your email.
2. Profile menu -> **Developer Tools** -> accept the Public API terms -> **register for Public API credentials**.
3. Name, application URL, description, and the redirect URIs above. Production accepts **HTTPS only**; for local testing register in
   the sandbox and set `ORCID_BASE_URL=https://sandbox.orcid.org` in `.dev.vars`.
4. Put the client id/secret in `.dev.vars`:
   ```
   ORCID_CLIENT_ID=APP-...
   ORCID_CLIENT_SECRET=...
   ```
ORCID returns the iD and public name only (no email).

## Go live
```bash
# upload only what login needs (add ORCID_* the same way)
npm run secrets:push -w apps/api -- --only=GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET
npm run secrets:push -w apps/api -- --dry   # lists key names that would be uploaded without --only
```
Dev-only flags (`ENABLE_DEV_ROUTES`, `DEV_IDP_URL`) are never uploaded. Reload the site: a **Sign in** button appears.

## What the implementation guarantees (all covered by tests)
OAuth authorization-code flow with **PKCE (S256)**; **single-use state** (replays and forged states rejected); post-login redirects are
**same-site paths only**; sessions are random 256-bit tokens, only their **SHA-256 is stored**, cookie is `HttpOnly; SameSite=Lax`
(and `__Host-` + `Secure` on HTTPS); logout is **same-origin only**; an email is stored and used to join accounts **only when the
provider says it is verified**; linking an ORCID that belongs to another account is refused.
Not built yet: rate limiting on `/start` (Cloudflare WAF rule + Turnstile, Sprint A6), session list/revocation UI, account deletion (Sprint A4).
