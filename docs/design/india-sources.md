# Indian sources: DOAJ journals, Shodhganga theses, Indian institutions (built 28 Oct 2026)

What you asked for (28 Oct): "DOAJ provider aur Indian theses filter bana do". Research before it: [R12](../spikes/R12-indian-sources.md).

## What it is

A switch under the prompt box, **Indian sources** (off by default, remembered on the device). When it is on, a search (with Auto or Search papers) looks **only** at:

| Source | What | How it is asked | Notes |
| --- | --- | --- | --- |
| **DOAJ** | articles in open access journals **published in India** (about 310,000) | `doaj.org/api/v4/search/articles/(<words>) AND bibjson.journal.country:IN` | metadata is CC0; 2 requests a second for everyone, so it has its own lane (`GATES.doaj`, a start every 600 ms, 2 at once) |
| **Shodhganga theses** | about 117,600 theses, **as OpenAlex lists them** | OpenAlex `locations.source.id:S4377209701` + `title_and_abstract.search` | Shodhganga itself refuses programs (bot wall, `Disallow: /`): nothing is fetched from it. A thesis is listed with a link to its page; almost none has an abstract (about 1,000), a DOI or a PDF |
| **Indian institutions** | papers with an author at an institution in India | OpenAlex `authorships.institutions.country_code:IN` + `title_and_abstract.search` | |

The regular search is **unchanged** (same four sources): its quality gate replays recorded answers of those four, and a new source can make the first page worse. The Indian sources are a choice, not a silent addition.

## What the reader sees

- The switch (dashed when off, the accent when on); the line under the box says where the search will look; on a narrow phone only its icon shows (its name stays for screen readers). Not offered for tools that do not search.
- The reply says "Searched only **Indian sources**: …" (kept with the chat, so "Search again" looks in the same place).
- A thesis card says **Thesis**, its title and a **Shodhganga** button open its record page (`https://shodhganga.inflibnet.ac.in/handle/10603/N`; OpenAlex's other addresses for the same record, including the PDF of its title page, are turned into that page). A record with no DOI and another repository's page gets a **Record** button.
- The short answer is made only from papers with an abstract, as always: **a thesis without an abstract is listed, never cited**.
- Saving a thesis keeps its page and "Thesis" (the library now keeps `url` and `workType`, both checked: http(s) only, a plain word).

## Measured (28 Oct 2026)

**What the sources add**, 24 topics an Indian scholar searches, written before the first run and not changed after it ([india-live.mjs](../../apps/api/scripts/india-live.mjs)). "On topic" is a rough word check (two thirds of the topic's words in the title or abstract), so it is generous to sources that already require every word; "new" = not among the regular search's 20.

| Source | Records | With abstract | With DOI | On topic (first 10) | New | Topics with nothing |
| --- | --- | --- | --- | --- | --- | --- |
| Regular search | 480 | 54% | 93% | 97% | – | 0 |
| DOAJ (India) | 263 | **99%** | 87% | 97% | **98%** | 4 |
| Shodhganga | 79 | 8% | 3% | 100% | **99%** | 8 |
| Indian institutions | 474 | 77% | 90% | 98% | **80%** | 0 |

So the switch shows mostly papers the regular search does not, and the DOAJ articles nearly all have an abstract to answer from.

**Through the whole app, real sources and real model** (a local Worker, 5 questions, one in Hinglish through Auto): every search returned 20 papers from all three sources (4 to 6 theses each), every answer was grounded (4 to 7 citations, from DOAJ and Indian-institution papers, **never a thesis**), the Hinglish question was searched as "MGNREGA impact on rural employment" and answered in Hinglish; 16 to 48 s. On the deployed **staging** Worker DOAJ worked and both OpenAlex sources answered HTTP 429, as the regular OpenAlex search does there: staging has no OpenAlex key (only `CROSSREF_MAILTO` and `SENTRY_DSN`), so it shares the small key-less daily allowance. Production has the key (its regular search answered from OpenAlex the same day). A partial result says so ("Some of the places we search did not answer").

**Found on the way and fixed:** OpenAlex calls some Shodhganga records "article" (they are all theses there), and gives the same thesis under four kinds of address; the prompt-box answer sometimes left sentence labels in its text ("[5], S12, S13 show…", Hinglish "paper [1] ke S5 ke mutabiq"): and a Hindi answer left the evidence pairs ("[6] (6:1)", "[1] (2,5)"). The clean-up now removes a list of labels after a mark, a label joined to a mark by a small word, and number pairs or lists in brackets after a mark (a year such as (2019) stays); the prompt says the labels belong only in the evidence; the chat-eval check now also catches the pairs. Chat-eval gate after it: 11 of 12 answered (the twelfth was a model timeout, not a refusal), 0 problems in 15 answers; Hindi answered 2 of 2 on a re-run with clean marks. One Auto run of a Hinglish question searched the words as written: the router's model timed out once (`route_failed: workersai:timeout`), so it fell back to a search and said it was not sure, as designed; three more runs translated it ("effect of exercise on diabetes").

## Privacy

The search words go to OpenAlex and DOAJ instead of the four regular sources when the switch is on. The privacy text says so; version `2026-10-draft-12` (a new recipient, DOAJ, so everyone is asked again).

## Not done, on purpose

- **DOAJ in the regular search**: it would need the search eval re-recorded with DOAJ answers and a check that the first page does not get worse. Worth doing if the switch is used a lot.
- **Harvesting Shodhganga** or reading its PDFs: needs INFLIBNET's permission (yours to ask for, if you want it).
- **Literature scan with Indian sources**: the scan uses the regular search. Easy to add as a choice on the scan page later.
- **Hindi or other Indian-language queries to DOAJ**: DOAJ is searched with the English words (Auto translates a Hindi or Hinglish message first, as for the regular search).

## Tests

Unit: `src/search/india.test.ts` (query syntax cannot get through, links are http(s) only, Shodhganga pages, DOAJ mapping, the whole scope with the services stubbed, the regular search unchanged), the library keeps a thesis's page, the answer clean-up. Endpoint: `chat-e2e.mjs` "Indian sources" (unknown scope refused, only Indian sources, a thesis with its page, never cited, the search endpoint's scope). Browser: `e2e/chat.mjs` "Indian sources" (switch, help line, not for other tools, reply line, thesis card and links, axe, remembered, forgotten, narrow phone).
