# The OpenAlex key's budget (one table, written before E0 starts)

Plan: [intent-and-state.md](../design/intent-and-state.md), section 8.6. Drafted 4 Nov 2026 for review.
Several scheduled jobs and one large one-off recording spend the same OpenAlex key. This page says who spends what, on which day, and the rule that keeps two big spenders off the same day.

## Read this first: what is known and what is not

- **The key's day is not known.** The plan says "about 10,000 calls". That figure is **inferred**, from a note in `trending-live.yml`, which says the Trending list run "spends about a tenth of the key's day" at about 1,000 calls. Nobody has read the allowance off the OpenAlex dashboard. Section "To read off the dashboard" below is the list of what must be read, and by whom, before the first big recording.
- **A "call" is not one price.** The project's own notes use two:

  | Kind of call | Price in the project's notes | Where it is written |
  |---|---|---|
  | a search (`title_and_abstract.search` filter, 20 papers, abstracts) | about **$0.001** | `apps/api/src/search/openalex.ts`, cost note ("OpenAlex Feb 2026 pricing, $1/day free"); `eval-live.yml` ("about $0.15 of OpenAlex credit per run") |
  | a Trending keyword question (a count, no papers) | **$0.0001** | `apps/api/src/trending/openalex.ts`; `docs/runbook.md`, "measured with live calls on 3 Nov" |

  Put in dollars, the Trending note's "a tenth of the key's day" is $0.10 (1,000 calls at $0.0001; the same note gives the keyless day as $0.10 and the key's as ten times that), so the day is about **$1**, which is also the "$1/day free" of the search note. A $1 day is 10,000 Trending-style calls but only about **1,000 search-style calls**. The plan's "10,000 calls" is therefore true for the cheap kind of call and ten times too many for the kind the replay recording makes. This page keeps both readings side by side. **If the day is $1, the recording below is most of a day, not a twentieth of it.** (To be confirmed on the dashboard; it may be a prepaid balance, not a daily allowance.)
- Where the project's own text and the plan agree, the table uses them. Where a number is mine, it says so.
- **Not in this branch.** The Trending job (`apps/api/src/trending/`, `trending-live.yml`, `trending-live.mjs`, the runbook's Trending section) is uncommitted work in the main checkout at the time of writing. It was read there, 4 Nov 2026, and not changed. Rows 2, 3, 4 and 4b rest on it.

## The table

Times are UTC, with IST (UTC+5:30) beside them. "Share" is the cost of one run against the day, read both ways: calls against 10,000 (the plan's figure), and dollars against $1 (the dollar reading above).

| # | Consumer | When | OpenAlex calls | Price per call | Cost of a run | Share: 10,000 calls / $1 | Where the figure comes from |
|---|---|---|---|---|---|---|---|
| 1 | `eval-live.yml`, weekly live check | Mondays 03:00 (08:30 IST) | about 150 | search, $0.001 | about $0.15 | 1.5% / 15% | the workflow's own note; the plan |
| 2 | Trending weekly **scan**, inside the Worker's daily job | Mondays 03:17 (08:47 IST); also when the pool is missing or 7 days old; a failed or unfinished scan goes on in the next day's run, so it can reach **Tuesday** | about 1,000 (792 plus 100 to 250) | keyword question, $0.0001 | about $0.10 | 10% / 10% | `docs/runbook.md`, the Trending job's table; the plan |
| 3 | Trending daily **file** (the verifier asks the product's own search for each phrase it has to decide on, once for the global list and again for the India list) | every day 03:17 (08:47 IST) | **up to 180**: up to 60 searches for the global list at 1 OpenAlex call each, and up to 60 for the India list at **2** each (the India scope asks `openalex-india` and `shodhganga`, and both are OpenAlex requests) | search, $0.001 | **up to about $0.18 a day**, less when the 24-hour search cache holds the answer or the lists fill sooner | 1.8% / 18% | `apps/api/src/trending/job.ts` in the main checkout (`maxAsks: 60`, and `selectVerified` runs once for each list, so the cap is 60 for each, 120 searches); `apps/api/src/search/index.ts` (`india: [openalexIndia, doajIndia, shodhganga]`) and `india.ts` (`openalexIndia` and `shodhganga` both fetch `api.openalex.org/works`). The real number is `daily.asks` in the job's log line: it adds the two lists, and counts searches, not calls. **The plan's list leaves this row out.** |
| 4 | `trending-live.yml`, weekly contract check | Tuesdays 06:17 (11:47 IST) | about 40 searches through the live site and its production key: 1 OpenAlex call each, and **2 for each India phrase** (the contract script searches the published India phrases with scope india), so a little over 40 | search, $0.001 | about $0.04 to $0.05 | 0.4% to 0.5% / 4% to 5% | the workflow's note ("about 40 searches"); `trending-contract-live.mjs` (`scope: india` for the India list); fewer when cached. **New in the main checkout, not in this branch** (read there, 4 Nov 2026) |
| 4b | the same file, by hand with "list" ticked | on request only | about 1,000 | keyword question, $0.0001 | about $0.10 | 10% / 10% | the workflow's note ("about a tenth of the key's day") |
| 5 | **Replay recording** (plan 8.3, layer L2) | **once**, then only for cases added later | **600 to 1,142** at today's case files; the plan says about 750 | search, $0.001 | **$0.60 to $1.14**; the plan says about $0.75 | **6% to 11% / 60% to over 100%** | `node apps/api/scripts/intent-replay-plan.mjs`, a dry run with no network call, on the 542 cases in `intent-cases.json` and `intent-controls.json` at the time of writing: 600 distinct searches for the raw and oracle forms, at most 1,142 once the "read" form of each message is added (the reader of R8 does not exist yet, so those rows wait). Run it again for the number on the day |
| 6 | `measure-senses.mjs` (new in the plan, line 579) | once a quarter, by a person | about 120 | count call, under $0.0013 | under $0.15 | 1.2% / under 15% | the plan (line 579: "about 120 OpenAlex count calls, under 0.15 USD") |
| 7 | R13's key check | once per release, by a person | a few | search | under $0.01 | under 0.1% / 1% | the plan |
| 8 | `browser-e2e.yml`, the browser smoke test (cron `41 4 * * 1`, with `OPENALEX_API_KEY` in its environment) | Mondays 04:41 (10:11 IST) | **not counted**: it searches through the app with the key; read Monday's total off the dashboard | search, $0.001 | not known | not known | `.github/workflows/browser-e2e.yml`. It falls on Monday with rows 1 and 2. Since 12 Nov 2026 it also runs on every pull request that changes `apps/web` or `packages/shared` (decision 12 of docs/design/untangle.md): one smoke test per such push |
| 8b | `switch-matrix.yml`, the nightly switch matrix (cron `37 21 * * *`, with `OPENALEX_API_KEY` in its environment; new 12 Nov 2026, decision 12 of docs/design/untangle.md) | every night 21:37 (03:07 IST) | **not counted**: of its three runs only "chat switches on" runs the browser smoke test, which searches through the app with the key, as row 8 does; read the daily total off the dashboard | search, $0.001 | not known | not known | `.github/workflows/switch-matrix.yml` |
| 9 | Visitors' searches on sodhsetu.in | every day | **not known** | search, $0.001 | not known | not known | each uncached search is one call; read the daily total off the dashboard. This is the biggest unknown, and the reason for keeping room |
| - | `qa-eval.yml` (Tuesdays 04:00, 09:30 IST) | weekly | none on the key | - | - | - | the workflow passes no OpenAlex key, so its 12 to 14 live searches use the keyless shared pool of the runner's address, not this key's day (by the file; not tested) |
| - | `intent-eval.yml` (plan 8.3 and 8.6: a Wednesday run, **new, not written yet**) | Wednesdays | none on this key, as the plan describes it | - | - | - | the plan has it repeat the follow-up eval (model calls on Workers AI, not searches). If it ever gives a job the OpenAlex key, it adds a row here in the same change, and Wednesday stops being a free day |
| - | `watchdog.yml` (hourly) | every hour | none | - | - | - | it looks at health, migrations, the daily job and the web app; it makes no search |

Weekly scheduled spend, rows 1, 2 and 4: $0.15 + $0.10 + $0.05 = $0.30, plus row 3 at up to $0.18 on each of seven days ($1.26): **at most about $1.6 a week**, with rows 8 and 9 on top. (My sum of the table's own figures. At its ceiling row 3 alone is 18% of a $1 day, every day, before any visitor.)

## The rule

1. **The replay recording and `measure-senses` run on a Wednesday, Thursday or Friday morning, IST** (05:30 to 12:00 IST is 00:00 to 06:30 UTC, the same weekday in UTC). The weekly consumers all fall on Monday and Tuesday (rows 1, 2, 4 and 8; row 2 can spill into Tuesday), so Wednesday to Friday are free of them. Rows 3 and 9 run every day: row 3 is up to 18% of a $1 day, row 9 is unknown, and together they are the reason to start from the dashboard's reading of the day.
2. **Never on the day of a scheduled consumer**, and never two of the big ones (rows 4b, 5, 6) on one day.
3. **Which tool records, with what pace, and how it stops.** The recording is made with `node eval/patch-fixtures.mjs`, which adds only the recordings that are missing, so a recording can take two or three mornings and lose nothing. **The stop rule is per provider.** A 429 from **OpenAlex** stops the whole run and reports: that is the source that spends the key's day, so there is no retry and no next request. A 429 from another source skips that source for the rest of the run, goes on with the others, and is reported at the end. **Today's `patch-fixtures.mjs` does neither**: on a 429 or a 5xx of any source it prints "not recorded", sets a failing exit code and goes on with the next request, and it paces only DOAJ (800 ms) and CORE (7 s), not Semantic Scholar, Crossref or PubMed. The 1,150 ms gap for Semantic Scholar, and the "at least 11.5 minutes" that the dry run prints, belong to the eval's request layer (`apps/api/eval/lib/fetch-layer.ts`, used by `npm run eval:record`), which retries a 429 up to six times (1.5 s, 3 s and so on) and then records the 429 itself as the answer. So `patch-fixtures.mjs` needs both the Semantic Scholar pace and the per-provider stop before the replay is recorded; it is a different file from the ones in this change, and is in the report's deferred list.
4. **Before the first recording**, read the dashboard (next section) and, if the day turns out to be about $1, split the recording into batches of at most about $0.4 (about 400 searches) over separate mornings.
5. **Aim** for about 05:30 IST, as the plan says. That is 00:00 UTC; if the key's day starts at midnight UTC, that is the start of a fresh day. This is a guess until the dashboard says when the day resets.
6. A new scheduled job that uses the key adds its row here, with its day, in the same change.

## To read off the dashboard (by the owner or whoever holds the OpenAlex login)

Fill this in, with the date, and then correct the table. Do not copy a key or a screenshot of one into the repository.

| What | Reading |
|---|---|
| the key's allowance: dollars a day, calls a day, or a prepaid balance | |
| when the day starts (what hour, which zone) | |
| the price of a search call, and of a keyword count call | |
| calls on the busiest day of the last month, and on an ordinary day | |
| what is shown when the allowance is used up (a 429? a charge?) | |
| date read, and by whom | |

## How the replay numbers were counted

Not guessed: a regular search (`runSearch`, scope "all") asks OpenAlex 1 time; Semantic Scholar 1; Crossref 3 (the search, the DOI check's one batch call, the retraction check's one call); PubMed 2; DOAJ 1: **8 requests, 1 of them OpenAlex**. A search whose words contain a name written as one word ("SwinYolo"), and that finds fewer than 12 papers, is asked again with the name split: up to 6 requests and 1 OpenAlex call more. Not counted: one doi.org lookup for each DOI Crossref does not hold (at most 12 a search), and retries. The numbers sit in `apps/api/scripts/lib/intent-replay-plan.mjs`, and a test fails if the product's code stops matching them. The price per call is the search note's $0.001; at that price the plan's 750 calls are the plan's $0.75.
