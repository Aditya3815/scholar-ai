# S3: saved papers are looked at again for retractions (built 27 Oct 2026)

Backlog item S3: "Retraction re-check of saved papers (weekly cron) with a notice". A paper is retracted after people have saved it; the search that found it only knew what was true that day. Before this, a retraction showed only on a *new* search result for the same paper.

## What a person sees

- **Signed in, a saved paper is retracted:** the Library page opens with a notice above the list: "A paper you saved has been retracted" (or "N papers ... have been retracted"), the title (opens the paper), "Remove from library", and "Got it". The rail's Library link carries a small warning mark, with words for a screen reader ("1 retraction notice"), on every page, so it is seen without opening the Library. The paper stays in the list and is marked "Retracted. Do not cite it without reading the retraction notice." (The Library list never showed a retraction mark before; it does now, for any retracted paper.)
- **Dismissing:** "Got it" hides the notice for good (it does not come back with the next run); the paper stays marked. **Removing the paper** from the library settles its notice too.
- **Kept honest:** the text says some papers are retracted for a part of the work only, and to read the notice. The marker comes from Crossref's retraction data (Retraction Watch), the same source the search already uses; the library item names it.
- **Not signed in:** a library that lives only in the browser is **not** re-checked (nothing about it reaches the server, and the privacy text promises that). Signing in moves it into the account and it is checked from then on.
- The page also looks again when a tab comes back into view after 30 minutes, so a notice made at night appears without a reload.
- There is no e-mail or push message: there is no mail service, and a notice shown in the app is enough for the pilot. (If one is wanted later it is a separate decision: it needs an address list, an unsubscribe and a sender.)

## How it works

- **A daily job** `retraction_check` runs in the same cron as the clean-up (03:17 UTC; `runJob` heartbeat, listed on `/admin` as "Retraction re-check of saved papers" and in `/api/v1/health/jobs`, alerting like the clean-up). Each paper is asked about **at most once a week**; the daily run takes the DOIs that have not been checked for 7 days (never-checked first, then the longest waiting), at most **400 a run**, in groups of 40, through the same gated Crossref lane every search uses (a call may wait up to 15 s for its turn, as a reference check does). The rest wait for tomorrow.
- **Shared table `paper_retraction`** (migration 0018): one row per DOI (`clear`, `retracted` or `unknown`, when it was checked, when it was first seen retracted). **No person in it** (asserted by a unit test). A DOI known to be retracted is not asked again.
- **A notice per person** in `library_alerts` (user, paper, title, when, when dismissed): made once for everyone who saved the paper when its DOI turns up retracted, whatever the spelling of the DOI; **nobody who saved it already marked as retracted** gets one (they saw that). Erased with the account, part of the data export (`retractionNotices`), removed with the paper.
- **The library list** (`GET /library`) joins the shared table, so a paper shows as retracted without anything saved being rewritten, and `alerts` are listed with it. `POST /library/alerts/seen` dismisses (all, or given papers; same-origin, signed in, only the person's own).
- **Failure handling** (each one is a test): a group the service **rejects** (HTTP 4xx other than 408/429) is split in halves until the DOI at fault stands alone; that DOI is marked `unknown` and not asked again for a week, and the others are checked. **Any other failure** (service down, a 5xx, lane too busy, timeout) stops the run: what earlier groups found is kept, nothing is marked for the rest, tomorrow's run continues, and the heartbeat says the job failed (it is reported, never swallowed). Running twice in a day makes no second request and no second notice.
- **Limits of the check, said plainly:** it uses Crossref's data only (the search also uses OpenAlex's flag), so it can miss a retraction that only OpenAlex knows; a paper without a DOI cannot be checked; a notice appears after the next night's run, not at the moment of the retraction.

## Tests

- **Unit (13, real SQL):** a small D1 stand-in over `node:sqlite` with every migration applied (`src/test-d1.ts`), so the queries and the schema are tested as they are, not through a mock. Which DOIs are due (one per DOI however spelled; none without a DOI or with a comma; none already retracted; a week; the limit); the re-check (clear, retracted with a notice for each person, spelled differently, again the same day, saved after the mark, a clear paper that is retracted a week later keeps its first-seen date, a rejected DOI marked unknown alone, a service outage stops the run and keeps earlier groups, batching); the schema holds no person.
- **Endpoint (`scripts/retraction-e2e.mjs`, Worker with `--test-scheduled`, an offline Crossref stand-in):** no notice before; the job runs; the notice for the person, with title and time; the paper shows as retracted with the source named; a refused DOI is not called retracted; a second person who spelled the DOI differently gets one for that paper only; what was learned is kept by DOI; the shared table has no person column; the job is listed in `/health/jobs`; a second run makes no second notice; dismissing needs the same origin and a signed-in person, cannot touch someone else's notice, hides it without un-marking the paper and does not come back; the export lists it with the dismissal time; removing the paper settles its notice; erasing the account leaves no notice.
- **Browser (`e2e/library.mjs`):** a paper saved with no mark, the job run, a reload: the rail marker with its words, the notice above the list, the paper marked in the list, axe in light and dark, "Got it" takes the notice and marker away, a reload keeps them away, removal. The operations suite no longer assumes it is the only thing that fires the cron.

## Privacy

The privacy text lists the weekly background check in the library row of the data table and in the list of what is sent to others (only DOIs, in groups, no person; what is learned is kept without any link to a person; the notice with the account). Version `2026-10-draft-10`.

## Not done

- A notice for a library kept only in the browser (by design, see above).
- A notice by e-mail or push (no sender; a separate decision).
- Re-checking against OpenAlex as well (see the limit above), and re-checking the references of an uploaded paper.
- A weekly summary count on the admin page (the job's heartbeat is there; how many papers were checked and how many retracted are in the log line of each run: `retraction_check` with `checked`, `retracted`, `unknown`, `alerts`).
