# Literature scan, read as a review (28 Oct 2026)

What you asked: "Literature scan ko hum aise sawal wise nahi denge, kuch alag tarike se denge… jo user ko bhi sahi lage." The scan was a form of sub-questions to fill in and a report of questions and answers. It is now **a short literature review**, in the shape a scholar writes one ("Review of Literature" in a thesis), and the work of planning it is a glance, not a form. The engine underneath is unchanged ([litscan.md](litscan.md)): the same workers, the same checks, nothing written by a model after the checks.

## What changed for the person

**1. Planning is a glance.** The topic becomes **themes**, shown as cards: each has a short name (like a heading of a review: "Risk factors", "How exposure is measured"), the question it is answered as, and the English words that are searched (the only part that reaches the public indexes, as before). Nothing has to be filled in. A theme can be removed, edited (a pencil opens its three fields; Done closes it) or added. **One press, "Start the review (4 themes)", is the approval** of the words shown. The private model proposes the names with the questions (`title`, 2 to 5 words, in the language of the review; scrubbed, at most 60 characters, no question mark; the search words, capitalised, when it gives none).

**2. Indian sources, as a choice.** The plan has the same switch as the prompt box ("Indian sources only": DOAJ journals published in India, Shodhganga theses through OpenAlex, papers by authors at Indian institutions; [india-sources.md](india-sources.md)). It starts as the prompt box's switch was left on this device. The scan keeps it (migration 0023, `litscans.scope`), the page and a shared link say it, and the privacy text names DOAJ for it.

**3. While it runs: a board of themes,** one tile each (waiting, searching, reading, answered from n papers, or no answer). The review below fills in as themes finish.

**4. The result is a review, in four tabs, under an "at a glance" strip** (themes answered, papers cited, the years they span, the study designs):

| Tab | What it holds |
| --- | --- |
| **Summary** | One section a theme, under its name, with the checked text. A mark opens its paper right under the paragraph (the APA reference, the sentence of the abstract, the link), without leaving the page. "The sentences behind it" as before |
| **Evidence table** | One row a cited paper: number, study (first author, year, title, journal), **design**, **key finding** (the abstract's own sentences, in quotes), themes. Filter by theme and design, order by number or year. On a phone, one card a paper |
| **Gaps** | Each theme without an answer, why, the words searched, and a link to search them yourself |
| **References** | The numbered list in **APA 7** (as far as the index's record goes: no volume or pages are invented; the page says to check them), "Copy all" |

**5. Downloads:** the whole review as Markdown (glance, findings, evidence table, gaps, references), the evidence table as **CSV** for Excel or Google Sheets (UTF-8 with a byte-order mark so Hindi opens; a cell that a spreadsheet would run as a formula is made text), the references as **BibTeX** and **RIS** (Zotero, Mendeley, EndNote), and Print (all four tabs, each under its heading).

## The study design, honestly

The design is read **from the paper's own words**, its title first, then the sentences cited (`studyDesign`, `packages/shared/src/litscan-review.ts`): systematic review or meta-analysis, randomised or controlled trial, intervention study (not randomised), case-control, cohort or longitudinal, cross-sectional or survey, qualitative, case report, review, modelling. A paper that does not name its design is **"Not stated"**, never a guess, and the table says how the column is made. A live run showed the order matters: "a prospective interventional study" is an intervention, not a cohort, so the intervention rule comes first.

## Checked

- Unit: `review.test.ts` (designs, the table, the glance, APA names and references, CSV quoting and formula guard, BibTeX escaping and unique keys, RIS, the Markdown review, file names), `plan.test.ts` (theme names), `report.test.ts` (sections carry their theme's name; an older scan without names uses the question), `india.test.ts` ("India" left out of an Indian source's words), `answer.test.ts` (mark punctuation).
- Endpoint (`litscan-e2e.mjs`): the plan's themes have names; a theme sent without one is named from its words; an unknown scope is refused; a scan of Indian sources is kept as one, keeps its theme names, cites the Indian sources' papers and never a thesis.
- Browser (`e2e/litscan.mjs`): the cards (nothing to fill in), edit, remove, add, Done before Start, Indian sources, the board, the glance, the four tabs, a mark opening its source, the table's filters and order, the gaps with their links, APA and Copy all, the four downloads (names and contents), reload, the shared link (the same review), phone (the table as cards); axe in light and dark.
- **With the real model and sources** (a local Worker, 28 Oct): an English topic gave five themes with good names ("Exposure Assessment", "Vulnerable Subpopulations"…), a Hinglish one Hinglish names ("Myopia ka Risk", "Blue Light ka Effect"); a review of Indian sources only ("anaemia among adolescent girls in India") finished in 18 to 30 s; the first run answered 3 of 4 themes from 8 papers (2008 to 2026), and after two fixes found on the way, **4 of 4**. The fixes: the Indian sources no longer ask OpenAlex for the word "India" (the source is Indian already; asking for the word too found nothing for "assessment methods"), and the text no longer keeps the separators of marks that were taken out ("[4]; [1]; , as is" becomes "[4][1], as is"). axe clean on the real review in light and dark.

## Not done

- A Word (.docx) file: the Markdown and Print (save as PDF) cover it for now; a real .docx needs a library of its own in the page.
- More than six themes, and reading full papers: each costs the allowance in proportion; to be decided with real use.
- A "consensus" figure ("8 of 10 papers say yes"): it would be a model's judgement after the checks, which the scan does not make.
