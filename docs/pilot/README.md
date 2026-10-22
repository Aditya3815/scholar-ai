# Pilot kit

For running the first pilot: ten scholars use Scholar AI on their own work for a week, and you learn what to fix first. Written for you (the person running it);
the texts to send to scholars are in [invite.md](invite.md), the questions in [survey.md](survey.md), and what to read every Monday in [monday.md](monday.md).

## Why a pilot, and what "done" means

Milestone 2 in [roadmap.md](../roadmap.md) ends with this check: **10 scholars have used it for a week; the weekly Q&A and eval workflows are green; every report was read; a list of the top five
complaints exists.** Nothing about Idea Check "coverage" or "prior art" should be promised to anyone before that.

## What has to be true before the first invite goes out

| | Check | Where | State on 22 Oct |
| --- | --- | --- | --- |
| 1 | Anyone can sign in with Google (the consent screen is **published**, not "Testing") | Google Cloud, OAuth consent screen | you checked: works |
| 2 | The privacy, terms and how-we-verify pages are linked in the footer and have no marked blanks | `/privacy`, `/terms`, `/how-we-verify`, `apps/web/src/lib/legal.ts` | **blanks remain** (entity, address, grievance name, jurisdiction, date). Fine for ten people you know, if you tell them it is a pilot and the pages are drafts; fill them before anyone you do not know |
| 3 | A contact address that you read daily | `atiadi@nativeorange.ai` (already the contact and grievance address in `legal.ts`) | set |
| 4 | Alerts reach you (GitHub issues, Sentry) | runbook, "Alerts" | done and tested 22 Oct |
| 5 | A restore has been rehearsed | runbook, "Backups and restore" | done 22 Oct |
| 6 | The survey form exists and you tested it once | [survey.md](survey.md) | **yours: 10 minutes** |
| 7 | You can see who has signed in (the count on `/admin`), but not their papers | `/admin` | works; it shows numbers only |

## Steps

1. **Choose ten names** (decision D5). People you can message directly, who write papers or supervise them, from different fields. Include two or three with a PDF-heavy workflow (theses, older papers).
   Keep the list in a private sheet, **not in this repository** (it is public): columns `name, field, how you know them, invited on, signed in?, used (search / verify / papers / idea), survey done, notes`.
2. **Make the survey form** from [survey.md](survey.md) (Google Forms, five questions). Put its link into the invite where it says `[SURVEY LINK]`.
3. **Send the invite** ([invite.md](invite.md)): the email to people you write to, the short message to people you chat with. Send a few a day, not all at once, so that you can answer each person's first questions.
4. **Day 1 to 2: be around.** Reply within the day (the invite promises it). Most early problems are "I could not sign in" or "what do I try".
5. **Day 3: a nudge** to anyone who has not signed in (the `/admin` people count tells you how many, not who; ask in the message).
6. **Day 7: send the survey link again** to everyone, and thank them.
7. **Day 8: run the [Monday routine](monday.md)** once with their data, write the top five complaints, and decide what is fixed first.

## What to look for, beyond the survey

- **A wrong "verified" or a wrong answer shown as right.** One of these matters more than ten complaints about speed. The "Report a problem" button on every answer, reference and idea search lands in `/admin`; read each one the same day.
- **Where people stop.** The first upload (the privacy card), the first Idea Check (the plan step), a scanned PDF (not supported yet, the message says so).
- **Whether Idea Check is understood.** It shows the closest papers and how each part of the idea compares; it never says an idea is new. If people read it as a verdict, the wording needs work.
- **Cost.** `/admin` shows tokens per day and per model. A pilot of ten should stay far under the free allowance; if not, find out which feature.

## Limits you promise nothing about (said plainly in the invite)

Scanned PDFs (no OCR yet), tables, handwritten text, and papers behind a paywall (Scholar AI never fetches paywalled text; it works on what a person uploads and on public
metadata and abstracts). Languages: search and answers were tested in English, with one Hindi question per test paper; do not promise more than that.

## After the pilot

Update [roadmap.md](../roadmap.md): the five complaints become backlog items with owners; the survey answers go into the roadmap log (counts, not names); decide Idea Check M3 vs. scanned-PDF reading
vs. whatever the pilot shows matters more. Delete the sheet of names when you no longer need it, as you would any personal data.
