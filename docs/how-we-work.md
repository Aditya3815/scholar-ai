# How we work (31 Oct 2026)

A short checklist for any change to Sodhsetu, by a person or by an AI assistant. It is our own wording of a method we already follow, written down after reading the open-source
[obra/superpowers](https://github.com/obra/superpowers) skills (MIT): decide before building, tests first, find the cause before fixing, and prove it before saying it is done. Nothing from that
repository is installed or copied.

## 1. Decide before building
- Say in a few lines what is wanted and why. If the answer is a choice only the owner can make (a name, a price, what is stored about a person, what is sent to whom), **ask**; do not guess.
- A change that touches what people see, what is stored, or what leaves the app gets a short note in `docs/design/` first (what, why, what is not done). Small fixes need only the commit message.
- Cut the work into steps that can each be checked on their own.

## 2. Tests first
- Write the test, watch it fail for the reason you expect, then write the smallest change that makes it pass.
- Query that runs on every request or on a table that grows? Add it to the list in `apps/api/src/scale.test.ts`: it fails when the query has to read a whole table.
- Anything shown as checked (a citation, a quote, a "supported" claim) has a test that a made-up one is refused. Citations are never written by a model, and nothing is called "novel".
- Edge cases are tests too: empty, one, exactly the limit, over the limit, wrong person, a failure half way.

## 3. When something is wrong: cause first
1. Reproduce it, and read the whole error, not the first line.
2. Find the cause. A guess that "fixes" the symptom is not a fix.
3. Write the test that fails because of that cause, then fix it, then run the test.
4. A check that fails once and passes alone may be flaky: run it again by itself, and compare with and without your change (an A/B), before calling it a regression or not.

## 4. Prove it before saying it is done
Run, and read the output of, what the change can have touched:

| What | Command (from the repository root unless noted) |
|---|---|
| Types | `npm run typecheck` |
| Unit tests | `npx vitest run` in `apps/api` |
| Search quality gates | `npm run eval` |
| Build and size budgets | `npm run build`, then `npm run budget -w apps/web` |
| Whole service and browsers | `node scripts/integration.mjs --browser` in `apps/api` (see the runbook, "Test everything locally") |

Then push, wait for CI to go green, and look at `/api/v1/health` on the live address. If something failed or was skipped, say so with the output; do not write "done".

## 5. Review and leave the record
- Read your own diff once as a stranger would. Remove what is unused (`noUnusedLocals` helps), and keep one copy of a helper.
- Update [roadmap.md](roadmap.md) (what changed, what is left and why) and the runbook when operations change. A change of the contact address does not bump `PRIVACY_VERSION`; a change in what the text promises does.
- Keys live only in `apps/api/.dev.vars` and Cloudflare secrets, never in the repository or in a chat.
