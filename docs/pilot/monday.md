# Monday routine

Thirty minutes, once a week, from the first day anyone outside has the link. It replaces "wait until something breaks". Written for the person running the service.
Every step says where to look and what a bad result means. Stop at the first one that is red and deal with it, then carry on.

## 1. Did anything alert you? (5 minutes)

- **Your e-mail**: any GitHub issue titled "Workflow failed: ..." or a Sentry mail since last Monday. Open issues are listed at github.com/Aditya3815/scholar-ai/issues; a workflow that failed and then passed has closed its own issue, so an **open** issue means it is still failing.
- **The weekly workflows** (Actions tab): Eval (live APIs, Mondays), Browser e2e (Mondays), Q&A quality (Tuesdays: look at this one on Wednesday). Green is the normal state. Red: open the run, read the last lines.
  The Q&A gate is answerable at least 85% correct, unanswerable at least 90% declined, and the sources of the answers verified.
- **Watchdog**: green runs every hour. A gap in the list means GitHub skipped some; a red one has an issue.

## 2. `/admin` (10 minutes)

Open `https://scholar.shodhsetu.workers.dev/admin` (signed in as admin).

| Look at | Healthy | If not |
| --- | --- | --- |
| **People** and "new this week" | grows by the number you invited | nobody new: the invite did not land, or sign-in is broken. Try signing in yourself in a private window |
| **Uploaded papers**: ready and **failed** | failed is a small share | many failed: open one as a user would (no PDF text? a scan?). Scans are the usual cause |
| **AI use, last 14 days** and "failed" calls | failures near zero; tokens a small fraction of the free allowance | failures: see "By model"; a model that fails often needs the fallback. Tokens climbing fast: one person or one feature, find which |
| **Scheduled jobs** | "On time", last good run within a day | red: the daily clean-up did not run or failed; read the error, see the runbook ("Limits and housekeeping") |
| **What people reported** | read **every** one, today | see step 3 |

Once a month, and after any restore: **Data checks** → *Compare papers with stored files*. It should say they match.

## 3. Reports (10 minutes)

Each report says the kind (answer, reference, idea), the problem the person picked, their note, and what they were looking at. For each one, decide one of four things and write it in a running list:

- **Our bug** (a wrong "verified", a wrong answer shown as right, a missed paper that should have been found): fix it, and add it to the evaluation so it cannot come back: a wrong answer goes in `apps/api/scripts/r2/questions.json`, a wrong reference verdict into the verifier eval, a missed paper into the Idea Check prior-art set.
- **Wording or unclear page**: the person understood the product differently from how it behaves. Change the page.
- **A limit we already know** (scanned PDF, book or thesis "not found", a regional journal): answer them kindly, say it is on the list, and make sure the page said so.
- **Not a problem**: reply, then remove the report with the bin icon.

Reply to every person who wrote a note. A reply within a day is what the invite promised.

## 4. The survey sheet (when a week has passed since the invites)

See [survey.md](survey.md), "How to read the answers". Add the counts to the roadmap log.

## 5. The five complaints (5 minutes, from week 2)

Keep a list with at most five items, ordered by how many people hit it and how bad it was (wrong results first, then blocked people, then annoyances). Each item gets one of: *fixing this week*, *next*, *not now (why)*.
At the end of the pilot this list is the answer to "what do we build next", and it goes into [../roadmap.md](../roadmap.md).

## Then, once

Write three lines to the people who took part: what you changed because of them, what is next, and thanks. People who see their report fixed are the ones who invite their colleagues.

## When something is on fire

1. `https://scholar.shodhsetu.workers.dev/api/v1/health` and `/api/v1/health/jobs`. Not 200: see the runbook, "Roll back".
2. A deploy made it worse: `npx wrangler rollback`, then fix forward.
3. Data damaged: the runbook, "Backups and restore" (30 days of Time Travel; rehearsed).
4. Someone asks you to delete their data: Settings and data does it for them (paper by paper, or the whole account). If they cannot sign in there is **no admin button for it yet** (on the backlog as N5): a hand-made SQL delete would
   also skip the deletion marker, so ask the person to sign in once and delete it themselves, and tell me if that is not possible.
