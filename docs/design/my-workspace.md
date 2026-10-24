# My Workspace: drawing on papers, and how to make it better

Date: 2026-10-24. Asked: "My papers" becomes **My Workspace**; a paper opens without the rail and without the footer; paint-like tools (highlighter, pen, eraser, sizes, undo, redo) so papers can be marked up; a click opens a paper and the title draws a line; and research on how to make My Workspace more engaging ("user additive").
This document says what was built, what the research found, and what I would do next, in order.

## 1. What is built (behind `?ws=1`, like the rest of the new look)

| Ask | Built |
| --- | --- |
| "My papers" → "My Workspace" | the rail, the page heading, the back button, the tab title, the home card. The URL stays `/papers`; the old look keeps "My papers" until W6 |
| No rail while a paper is open | the reader uses the whole window (`Shell` `focus`); the paper's own header has the way back ("My Workspace"). The rail returns when you go back |
| No footer in My Workspace | removed in the list and in the reader |
| Click opens a paper; a line under the title | a click on the card opens it (cover and title area; rename and delete keep their own buttons; the cover button is the keyboard way in). Pointing at a card draws a line under the title from the left (a transform, so it is free) |
| Pen, highlighter, eraser, sizes, undo, redo | **Draw** button in the reader's bar opens the tools: select-and-read, pen, highlighter, eraser; four sizes; six pen colours and five highlighter colours; undo and redo (buttons, Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y); keys V P H E; Esc closes. Saved with the paper, private, in the data export, deleted with the paper |
| Search icon a little to the left | the mode chip had a hidden "Auto" label taking space beside "Search papers"; fixed, the icon is now 12 px from the edge and the pill is only as wide as its words (a test checks it) |

### How drawing works

- **Vectors, not pixels.** A stroke is a list of points (x, y, pressure) as fractions of the page width, so it is sharp at any zoom, survives a re-render, takes a few hundred bytes, and can be erased and undone as a whole.
- **Two SVG layers per page.** The highlighter layer sits under the text and blends by multiplying (so text stays readable, like a marker); the pen layer sits on top and takes the pointer only while a drawing tool is on. With "select and read" or the tools closed the pointer goes through to the text as before.
- **Pen** strokes are outlines made by [perfect-freehand](https://github.com/steveruizok/perfect-freehand) (MIT): thicker where a stylus presses harder; a mouse has no pressure, so the speed of the hand shapes the line. **Highlighter** strokes are flat-ended lines of one width.
- **Eraser** removes whole strokes it touches (they fade while you sweep) and the sweep is one undo step. The stylus's own eraser end or barrel button erases whatever tool is on.
- **Fingers and styluses.** A stylus and a mouse draw. One finger scrolls the page unless "Draw with a finger" is on (it remembers); while a stylus is writing, a resting palm is ignored; a second finger is a pinch, not a stroke. Pointer Events with coalesced events for smooth lines.
- **Saving.** Strokes are changed in the browser at once and saved 1.2 s after the last change, one save at a time, with the revision they started from. If another window saved in between, this one is told ("Updated from another window") and shows the newer drawing instead of silently overwriting it. A failed save keeps the strokes, retries with a growing pause and when the network returns, and the browser warns before the page is closed with something unsaved. Server limits: 4,000 strokes, 2,000 points a stroke, 200,000 points and 1.4 MB per paper; every number is checked and clamped on the server (it is untrusted input).
- **Tests.** 17 unit tests (checks, limits, simplify, the eraser's hit test, undo and redo), about 20 checks of the real API (sign-in, revision conflicts, bad strokes, another user, export, deletion with the paper), and about 60 browser checks (drawing with a real mouse, saving, undo by button and key, the eraser, reopening, a conflict, the three themes with axe, the phone layout).

### Limits you should know

- Drawing needs a pointer; it cannot be done from the keyboard (nobody can draw a line with Tab). For marking text without a pointer, select text and use the colours of the Notes tab, which is keyboard-accessible.
- The eraser removes whole strokes; there is no pixel eraser. That is on purpose (see section 2).
- Drawings are not yet in the downloaded PDF (the download is the original file): see "next" below.
- Two-finger scrolling while a drawing tool is in hand on a touch screen uses the reader's pinch; scrolling with one finger needs the tools closed or finger drawing off.

## 2. What I found (sources, 24 Oct 2026)

| Question | Finding | Decision |
| --- | --- | --- |
| Use pdf.js's built-in annotation editor? | pdf.js has ink, highlight, free text and stamp editors and can write them into a saved PDF (`saveDocument`), but they live in its own viewer components, not in our own page renderer, and store into the PDF, not our database ([Nutrient write-up](https://www.nutrient.io/blog/pdfjs-annotation-editor-layer/), [API listing](https://tessl.io/registry/tessl/npm-pdfjs-dist)). I could not confirm details in the official docs | custom layer: it fits our reader (zoom, pinch, find, notes), our database and our privacy rules |
| A stroke library? | perfect-freehand is MIT and does exactly this (pressure, smoothing, taper; SVG output) ([README](https://github.com/steveruizok/perfect-freehand)) | used (small, no dependencies) |
| Input handling | Pointer Events cover mouse, stylus and finger; `touch-action` decides who scrolls; `getCoalescedEvents()` gives the raw points between frames for smooth curves, but is not available everywhere, so there is a fallback ([MDN](https://developer.mozilla.org/docs/Web/API/PointerEvent/getCoalescedEvents), [TPAC 2023](https://www.w3.org/2023/Talks/TPAC/pointer-events)). I found nothing authoritative on palm rejection | `touch-action: pan-y pinch-zoom` by default (a finger scrolls), `none` when finger drawing is on; palm rejection is my own rule (ignore touches for 4 s after a stylus) and untested on a real tablet |
| Eraser | Apps that keep ink as vectors (GoodNotes, PDF Expert) offer a stroke eraser that removes a whole mark cleanly, while a pixel eraser on a flat layer also destroys what is beneath a highlight ([DEVONthink forum thread](https://discourse.devontechnologies.com/t/apple-pencil-annotations-destructive-pixel-eraser-vs-stroke-eraser/86231), a user's account, not a study); Bluebeam separates a stroke eraser from an annotation eraser ([Bluebeam help](https://support.bluebeam.com/online-help/revu20/Content/RevuHelp/Menus/Tools/Markup/Eraser-Tool--V.htm)) | stroke eraser, one undo step per sweep |
| Highlighter look | A highlighter is ink drawn with a multiply blend ([Apryse docs](https://docs.apryse.com/api/ios/Classes/PTInk.html)) | multiply, in a layer under the text |
| Why people mark up while reading | Old but consistent HCI work (XLibris, CHI 1998; the Marshall studies of law students) shows that free-form ink while reading is a way of thinking and is most valuable when it is connected to what the reader later writes ([XLibris](https://unpaywall.org/10.1145%2F2669485.2669542), [Marshall et al.](https://link.springer.com/doi/10.1007/978-3-540-45175-4_11)). I found no recent quantitative study of highlight against margin-note behaviour | ink is a first step; the value is in what happens to it afterwards (section 3) |
| What keeps researchers coming back | Zotero's reader lets you extract highlights into a note, filter by colour and tag; its heavy users ask for extraction by colour ([UCL guide](https://library-guides.ucl.ac.uk/zotero/extracting-annotations), [forum thread](https://forums.zotero.org/discussion/110131/extract-annotations-by-color)). Readwise brings old highlights back by daily review and spaced repetition ([review](https://www.asianefficiency.com/productivity/readwise-reader-review/)); that is the vendor's own pitch, with no independent retention data | the sticky part of a reading tool is that **what you marked comes back to you in a useful form** |

## 3. How to make My Workspace better, and more worth coming back to

Ordered by value to a researcher against the work and the risk. "Engaging" here means useful enough to return to; nothing below uses streaks, guilt notifications or other dark patterns, and anything that sends mail or notifications is opt-in.

| # | Idea | Why it helps | Effort | Notes |
| --- | --- | --- | --- | --- |
| 1 | **Download the annotated PDF** (ink and text highlights flattened into a copy) | the marked-up paper is the thing people share with a supervisor and keep; without it drawings feel trapped in the app | medium | pdf-lib is MIT and can draw paths on pages ([repo](https://github.com/Hopding/pdf-lib)); its upkeep is unclear, so prove it on a real PDF first. The original is never changed |
| 2 | **Highlights and notes as a page of their own**: all of a paper's highlights grouped by colour, a colour legend you name (yellow = important, green = method), filter by colour, **copy as Markdown** or a citation-ready list | this is exactly what Zotero's users ask for and what makes marking worth the effort | small to medium | the data is already there (notes with colours, quotes, pages) |
| 3 | **Ask about your highlights**: "summarise what I marked", "what did I mark as a limitation?" | links two things we already do well (grounded Q&A, highlights); every line points at your own marked passage | small | the quote check already guarantees the text is from the paper |
| 4 | **Pick up where you left off**: reopen a paper at the last page, zoom and tool; a "Continue reading" card on Home | removes the smallest friction; expected by anyone who has used a Kindle | small | page and zoom in the browser; per-device |
| 5 | **Search across all my papers and my highlights** | turns a pile of PDFs into a workspace | medium | per-paper vectors exist; across papers is S2 (Vectorize) |
| 6 | **Collections and tags**, a reading status (to read, reading, done), a progress bar per card | structure for a growing list; progress, not streaks | medium | |
| 7 | **Remember this?** One of your old highlights on Home now and then (in the app only; a weekly e-mail only if you turn it on) | the Readwise idea: marks come back at a useful moment; but the evidence for retention is the vendor's own | small in-app, larger for e-mail | opt-in; the privacy text must say what is sent |
| 8 | **More tools**: sticky notes and text boxes on the page, straight-line and shape snapping, lasso to move strokes, a ruler | what a paper notebook does that a mouse cannot | medium to large | the vector model supports all of it |
| 9 | **Work offline**: papers and drawings cached so a poor connection does not stop reading | much of the target audience reads on unreliable mobile data | medium | a service worker; drawings queue and sync (the save code already retries) |
| 10 | **Two papers side by side**, a focus mode, a shortcut sheet (?), a command palette (Ctrl+K) to jump to a paper or a tool | speed for people who live in the tool | medium | |

My suggestion for the next three: **1, 2 and 3** (the drawing becomes something you keep, reuse and ask about), then 4 and 5.

## 4. Not done, on purpose

- No pixel eraser, no hand-writing recognition, no sharing of a marked-up paper by link (privacy: it would need an explicit, revocable, read-only design).
- No real-tablet testing: the pen path (pressure, barrel button, palm rule) is written to the Pointer Events specification and tested with a mouse; it needs an hour with an iPad or a Surface before I would call it finished.
