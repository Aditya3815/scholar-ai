# R12: Indian sources (Shodhganga theses, regional journals): what can be used, checked 27 Oct 2026

> **Built 28 Oct 2026** as an opt-in "Indian sources" switch (DOAJ journals published in India, Shodhganga theses through OpenAlex, papers by authors at Indian institutions): [india-sources.md](../design/india-sources.md), with the measurements asked for in point 4 below.

Question (roadmap S7, "research first: licences and APIs"): can Scholar AI search Shodhganga theses and Indian regional journals, and how.

## Shodhganga (INFLIBNET) directly: no

`shodhganga.inflibnet.ac.in` was asked for its OAI-PMH endpoint (`/oai/request?verb=Identify`, the standard way a DSpace repository is harvested) and for `/robots.txt`:

- The server answers a program with a **proof-of-work challenge page** ("Making sure you're not a bot", Anubis) instead of data. Solving it from a Worker would be getting round the site's own protection.
- `robots.txt` says `User-agent: *` and `Disallow: /` (and names `/discover`, `/simple-search`, `/browse`, `/handle`).

So a search provider that calls Shodhganga, a harvester, and a server-side fetch of its PDFs are all **not to be built**: the site says in two ways that programs are not welcome. Asking INFLIBNET for a harvesting agreement would be a separate, human step (their contact is on the site).

## Shodhganga through OpenAlex: yes, already there

OpenAlex lists **Shodhganga as a source** (type repository, **117,654 works**, homepage shodhganga.inflibnet.ac.in) and 2,639 works that mention it. Our search already asks OpenAlex, so theses with their metadata and (when OpenAlex has it) an abstract can already appear in a search. What is missing is a way to **ask for them on purpose**:

- an "Indian theses" filter or boost using OpenAlex's own filter on the source (an API feature, not scraping); the card then says "Thesis · Shodhganga";
- the PDF cannot be read by our server (the site's protection above), so "Ask this paper" falls back to the abstract, which the sheet already says plainly; the link opens the thesis on Shodhganga in the person's own browser.

## Regional journals: DOAJ, an open API

The Directory of Open Access Journals has an open API (`doaj.org/api`), with **309,564 articles from journals published in India** (query `bibjson.journal.country:IN`) and the licence of each journal. A provider would be a small module like `arxiv.ts` (search, map to our `Paper`, DOI check as for any result). Open questions before building: DOAJ's rate limits and terms of use for a service like ours (to read on their page), and how often an Indian-journal article has an abstract and a DOI (the DOI check drops a record whose DOI does not resolve).

## Recommendation

1. A DOAJ provider (a day), behind the same lane rules as the others.
2. An OpenAlex "Indian theses" filter (half a day).
3. Neither needs anything from you. Harvesting Shodhganga itself needs INFLIBNET's permission and is yours to start if you want it.
4. Both should be measured on real Indian-topic queries (the held-out set of the search eval) before they are switched on: more sources can lower the quality of the first page if they add weak records.
