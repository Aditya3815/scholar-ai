# Word (.docx) export of a literature review (built 29 Oct 2026)

The review's Download menu now has **Review (Word)**: the whole review as a `.docx` that opens in Word, Google Docs and LibreOffice, to be edited, commented on and cited from. It sits beside Markdown, CSV (the evidence table), BibTeX, RIS and Print. Before this the Markdown and Print (save as PDF) were the way, and the note said a real .docx "needs a library of its own in the page".

## It needs no new library

A `.docx` is a zip of XML parts. The XML is written by a small, pure module and the zip is made by **fflate**, which the app already had (it reads a Word file in Idea Check). Nothing is added to the first load: the Word code is a chunk of its own (5 KB gzip) loaded when the menu item is chosen. Nothing is sent to a server; the file is made in the browser.

- [packages/shared/src/docx.ts](../../packages/shared/src/docx.ts): the writer. Title, three heading levels, paragraphs, a note box, bullets, numbered references that keep their own numbers, a table with a repeating header row; runs with italic, bold, superscript, an outside link or a jump to a bookmark. Styles and numbering are in the file (Title, Heading 1 to 3, List Bullet, Reference, Table Text, Table Grid), so Word's own Styles pane and navigation pane work.
- [packages/shared/src/litscan-docx.ts](../../packages/shared/src/litscan-docx.ts): the review as blocks, with the same content and order as the Markdown review. Every mark **[n] jumps to reference n** (a bookmark), the sentences behind a theme are listed under it, the evidence table is a real table, the references are APA with the journal in italics and the DOI as a link.
- [apps/web/src/lib/docx.ts](../../apps/web/src/lib/docx.ts): zips the parts (the zip's dates are the review's date, so the same review gives the same file).

## What can go wrong, and how it is handled

| Risk | Handling |
| --- | --- |
| A character XML cannot hold (a control character, U+FFFE, a lone surrogate) makes Word say "unreadable content" | `xmlSafe` drops them; tab, line breaks, Hindi and emoji are kept |
| Text with `<`, `&`, quotes, or `</w:t>` in an abstract or a topic | everything is escaped; tested with hostile text |
| A link that is not a web address (`javascript:`, `data:`, `file:`) | only http, https and mailto become links; the rest stays text, and no relationship is written for it |
| A bookmark name Word refuses (digits first, spaces, over 40 characters) | `bookmarkName` makes `b` + letters, digits and underscores, at most 40 |
| Elements in an order the schema does not allow (Word is strict, viewers are not) | the order of every element follows the schema; checked by reading the file back with python-docx and by a well-formedness check of every part in the tests |
| Hindi and other Indian scripts | a complex-script font is set (Nirmala UI) and the spell-check language follows the review's language (hi-IN or en-IN) |
| A table with a short or long row, zero widths, 2,000 rows | every row has a cell for every column, each with a paragraph; widths are made to fit the page |
| An empty review (every theme without an answer) | still a valid file with the Gaps section |
| Making the file fails (a very old browser, a blocked chunk) | a notice says so and points to the Markdown review |

## Tests

- 39 unit tests ([docx.test.ts](../../apps/api/src/litscan/docx.test.ts)): what XML can hold, links, bookmarks, styles all defined, a table in every odd shape, the zip round trip, the whole review (sections in order, every mark has its bookmark, the DOI links, Indian-sources line, language, hostile text, 40 themes), file name.
- Browser ([litscan.mjs](../../apps/web/e2e/litscan.mjs)): the file is downloaded, unzipped, and checked for its parts, its text, a table with a row for every paper under a repeating header, the bookmarks and the DOI links.
- By hand: a sample review was opened with **python-docx** (a separate reader from ours): the title, author and date in its properties, every paragraph in its style (Title, Heading 1 to 3, List Bullet, Reference), the table's 5 columns, Hindi text intact.

## Not done

- Word itself was not available here: the file was checked with a second reader and against the schema's element order, not opened in Word. If Word shows a problem, the file name and what Word says are what is needed.
- The Idea Check report and the reference-check report are still Markdown and CSV; the writer takes any blocks, so adding them is small.
- A page header or footer and page numbers (a field) are not written.
