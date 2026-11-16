# Paper Reader: one desk for reading, marking, notes and the paper's agents

Date: 13 Nov 2026. This plan is for the owner, and for whoever builds it.

On 12 Nov 2026 the owner asked for a reader for My Workspace, taking its ideas from `Paper Reader.dc.html`, a design mock with the ViT paper. The owner's words: "apna UI/UX design theme banao … acche se Idea lo", plan first and build after. The owner set four rules:

1. **Themes.** Light, Dark and Read stay exactly as they are, and every new part works in all three.
2. **Agents FAB.** The Agents open from a floating button, as in the mock.
3. **Split on big screens only.** Split (paper and notes side by side) is offered on laptops, desktops and tablets.
4. **Phone: one or the other.** On a phone the person picks Paper OR Notes, never both. Split is not shown at all.

The design uses only our own tokens (`apps/web/src/styles/tokens.css`), fonts and components. The mock's orange "Native Orange" look, its fonts and its colours are not used.

## 1. What the mock proposes and what we already have

The reader at `/papers/:id` (`DocWorkspace`) already does most of what the mock shows. The table below maps each idea of the mock onto today's code, and says what we do with it. Status: **Have** means it exists, **Part** means part of it exists, **New** means nothing exists yet.

| Mock idea | Today | Status | Decision |
|---|---|---|---|
| Header: back, title, authors, venue, pages, passages, DOI | `DocWorkspace` 443-509 (title can be renamed, "N pages · M passages indexed", byline, DOI ↗) | Have | Keep. Only the order of the controls at the end changes (section 3) |
| Read status: To read / Reading / Done | `DocMeta` chip, which also holds tags | Have | Keep |
| Views: Paper / Split / Notes | Desktop: paper plus a side panel (Ask, References, Notes), which can be hidden. Under 1000 px: four tabs | Part | **Adopt.** One view switch, with the phone rule (section 2) |
| Share: invite by e-mail, link | Nothing in the reader | New | **Skip.** We decided on 24 Oct (my-workspace.md, section 4) not to share a marked-up paper by link without a revocable, read-only privacy design. The button becomes **Export** |
| Toolbar: thumbnails, page n/N, find (Ctrl F), Contents, zoom, fit, download | `PdfViewer` 929-992 has all of it, plus the marked-PDF download and the citation-card toggle | Have | Keep. The tools join one segment (next row) |
| Tools: Select V, Highlight H, Capture C, Draw D | Select ("Select and read") and Draw (a full ink toolbar) exist. A text highlight is only made from the selection pop-up. There is no capture | Part | **Adopt** as a 4-part tool segment. Highlight becomes a mode. Capture is new (section 6) |
| Highlight colours carry meaning: Key idea, Method, Question, Result | Four colours named by colour (yellow, green, blue, pink). Naming them is built but parked | Part | **Adopt** the four meanings as the default names, and make the dots readable in each theme (section 5) |
| Selection pop-up: colours, Add to notes, Explain, Copy, Remove | Colours and "Add note" | Part | **Adopt**: add Copy and Explain. Clicking an existing highlight gives Change colour, Add to notes, Remove |
| Notes: several pages, a paper style, rich text, quote a highlight, captures, "Show in paper" | One note text per highlight (plain textarea, saved on blur, line breaks lost on the server) | Part | **Adopt as a Notebook**: pages of blocks, laid out one after another, not placed freely (section 7). The existing note on each highlight stays |
| Highlights tab: filter by colour, "In notes" | The Notes tab is this list (colour filter, by page or by colour, Markdown) | Have | Rename it **Highlights** and add the "In notes" mark |
| References tab: counts, filters, CSV, copy flagged | `ReferencesPanel` and `VerifySummary` have all of it, plus citation hover cards | Have | Keep, unchanged |
| Agents drawer: Ask, Explain, Critique, Note-taker, Related, prompt chips, "+ Add to notes", "Answers cite pages" | Ask exists (`AskPanel`: streamed, page chips, quotes checked against the paper, highlights questions, prompt chips). The rest do not exist | Part | **Adopt** behind a FAB. Ask moves into it. Each new agent sits on the existing private Workers AI path (section 9) |
| Toast with Undo | Only one banner (`showNotice`): no action button, does not close by itself | New | **Adopt**: a small toast queue with an optional action |
| Export: Markdown and PDF of notes, choose what to include | Markdown of highlights, and the marked PDF | Part | **Adopt** for the Notebook (section 10) |
| Free-placed text boxes on a note page ("double-click anywhere") | Text boxes and sticky notes exist **on the paper** (ink tools) | Skip on the note page | A note page is a flowing document (section 7) |

## 2. Layout: three views, and the phone rule

### 2.1 Which views a screen gets

| Screen | How it is told apart | Views offered | First view |
|---|---|---|---|
| **Wide**: laptop, desktop, tablet in either orientation | `(min-width: 744px) and (min-height: 520px)` | Paper · Split · Notes | Split (as today), then the person's last choice |
| **Phone**: any phone, portrait or landscape | everything else | Paper · Notes | Paper |

Why these two numbers:
- 744 px is the narrowest tablet in portrait (iPad mini). Every phone in portrait is under 500 px.
- A phone turned sideways can be 932 px wide, but it is never more than about 440 px tall. That is why the height test is there: without it a phone in landscape would get Split. The owner's rule is "Split on a phone, never".
- A small laptop window still has at least about 600 px of height in the browser.
- The rule is one hook, `useWide()` (a `matchMedia` with a listener), plus the same query in CSS. Nothing tests for a phone by its user agent.
- When a screen turns from wide to phone (a rotation, or a window dragged narrow) while Split is on, the view becomes **Paper**. The last panel tab is kept, so Notes reopens where it was.

### 2.2 The views

```
Wide, Split (default)                                   Wide, Paper                 Wide, Notes
┌──────────────────────────────────────────────────┐    ┌───────────────────────┐   ┌───────────────────────┐
│ ←  Title …                  [Reading ▾] [Paper|Split|Notes] [Export] [◐] │   …same header…           │   …same header…
│    Authors · venue · 22 pp · 91 passages · DOI ↗ │    ├───────────────────────┤   ├───────────────────────┤
├───────────────────────────┬──────────────────────┤    │ toolbar               │   │ [Notes|Highlights|Refs]│
│ [▤] ‹ 3/22 › [Select|Highlight|Capture|Draw] …   │    │                       │   │ notebook, centred at   │
│ ┌──┐ ┌──────────────────┐ │ [Notes|Highlights|Refs]│  │      the paper        │   │ a reading width (66ch)│
│ │p1│ │                  │ │ ───────────────────── │   │                       │   │                       │
│ │p2│ │      page        │ │  panel content        │   │                       │   │                       │
│ │p3│ │                  │ │                       │   │                 (✦)   │   │                 (✦)   │
│ └──┘ └──────────────────┘ │                 (✦) Agents│ └───────────────────────┘   └───────────────────────┘
└───────────────────────────┴──────────────────────┘
```

```
Phone, Paper                Phone, Notes
┌────────────────────┐      ┌────────────────────┐
│ ←  Title …   [◐]   │      │ ←  Title …   [◐]   │
│ Reading ▾          │      │ Reading ▾          │
│ [ Paper | Notes ]  │      │ [ Paper | Notes ]  │
│ ‹ 3/22 › [V H C D] │      │ [Notes|Highl.|Refs]│
│                    │      │                    │
│      page          │      │  notebook          │
│                    │      │                    │
│              (✦)   │      │              (✦)   │
└────────────────────┘      └────────────────────┘
```

- **Split.** The columns are `1.35fr | minmax(23rem, .65fr)`, as today. A divider between them can be dragged (keyboard: focus it, then ← and →). The width is kept per device, between 22rem and 48% of the window.
- **Notes**, on a wide screen. The panel fills the window, and its text is held to the reading width so a line does not run 1,400 px long. The paper is one click away (the view switch, or "Show in paper" on any block, which switches to Split and scrolls to the passage).
- **The view switch.**
  - It is a segmented control (`role="radiogroup"`, arrow keys move inside it) in the header.
  - It replaces today's "Hide the side panel" button and the four phone tabs.
  - The choice is kept on the device (`scholar.view`). It replaces `scholar.focus`; an old `scholar.focus=closed` is read once as Paper.
- **Phone.**
  - The four tabs of today (Paper, Ask, References, Notes) become `Paper | Notes`. Inside Notes are the panel tabs. Ask moves to the FAB.
  - The panel takes the full height under the header (`100dvh` minus the header), not today's `calc(100dvh - 17.5rem)`.

### 2.3 Header, end controls, in order

Read status · view switch · Export · full screen (wide only, as today) · ThemeSwitch.

At or below 760 px the status and the switch move to a second row, as the status and theme row do today. The ThemeSwitch shows icons only below 720 px.

## 3. The paper toolbar

One row, left to right:

`[▤ thumbnails]  ‹ [ 3 ] / 22 ›  │  [Select V | Highlight H | Capture C | Draw D]  [colour ▾]  │  [⌕]  [Contents]  [❝ cards]  │  [− 115% +] [fit]  [⤓ ▾]`

- **The tool segment** replaces the lone Draw button.
  - **Select**: today's "Select and read".
  - **Highlight**: a mode. Every text selection becomes a highlight in the current meaning at once, with no pop-up. Useful for a long session of marking.
  - **Capture**: section 6.
  - **Draw**: opens today's ink toolbar under the row, unchanged.
- **The colour picker** shows only while Highlight is on: four dots with their names. Draw keeps its own palette.
- **Download** becomes one menu: the original PDF, and a copy with my marks (today's two buttons). This saves one button on a narrow toolbar.
- **On a phone** the row scrolls sideways inside itself. The page never scrolls sideways. Thumbnails and Fit stay hidden below 720 px, as today. The tool segment shows icons only; each button keeps its name as `aria-label` and a title.
- **Keys** (when focus is not in a text field):
  - V, H, C and D pick the tool.
  - While the Draw toolbar is open, the letters are the drawing tools, as today: P, H (the freehand highlighter), E, L, A, R, O, T, N, S. **V** returns to Select and **Esc** closes Draw.
  - So H means "highlight" in both places, with the text marker outside Draw and the freehand marker inside. The shortcut sheet (`?`) and the palette list both.
  - Nothing that works today changes meaning.

## 4. The selection pop-up

It is today's pill (`.pdfv-sel`), extended. It follows the selection and stays a fixed pill on a phone.

| What was clicked | Actions |
|---|---|
| New selection | four meaning dots · **Add to notes** · **Explain** · **Copy** |
| An existing highlight | four dots (recolour, ring on the current one) · Add to notes / **In notes ✓** · Explain · Copy · **Remove** |

- **Add to notes** makes the highlight (in the current meaning) and puts it as a quote block on the open notebook page. A toast says "Added to "Page title"" with **Undo**.
  - Until the Notebook ships (phase 2), it is today's "Add note": a highlight with its note box open.
- **Explain** opens the Agents drawer on Explain, with the selection as its context (section 9).
- **Copy** writes the text and says "Copied". If the browser refuses, it says "Could not copy. Select the text and press Ctrl+C." (decision 6.5 of untangle.md: a failed copy is never silent).
- **Remove** deletes the highlight, with a toast and **Undo**. The note text comes back too.
- **Keyboard**: the pill is a toolbar (`role="toolbar"`, ← and → move inside it, Esc closes it and returns focus to the text).

## 5. Highlight meanings, in every theme

| Meaning (default name) | Stored colour | Light mark | Dark mark | Read mark |
|---|---|---|---|---|
| Key idea | yellow | the paper's own `--hl-yellow` | same | same |
| Method | green | `--hl-green` | same | same |
| Question | blue | `--hl-blue` | same | same |
| Result | pink | `--hl-pink` | same | same |

- **The marks on the page stay as they are.** The page is white in every theme (only `--page-filter` dims or warms it), and the marks multiply onto it. So a mark already reads the same in Light, Dark and Read, and nothing changes there.
- **What is new is the dot and the chip in our own UI**: the pop-up, the colour filter, the notebook's quote bar, the legend. These sit on `--surface`, which differs by theme. Each meaning gets one token per theme, `--mean-key`, `--mean-method`, `--mean-question` and `--mean-result`, tuned to at least **3:1 against `--surface` and `--surface-2`** (WCAG 1.4.11, non-text). `contrast.mjs` gains these 12 pairs and fails CI if one drops.
- **Never colour alone.** Every dot carries its name: in a tooltip, in `aria-label`, and as text on chips and in exports. The quote bar in the notebook also shows the meaning's small letter icon (K, M, Q, R) for people who cannot tell the colours apart.
- **Stored data does not change.** A highlight still stores `yellow`, `green`, `blue` or `pink`. The meaning is a label, so nothing needs a migration, and the parked legend editor (own names) can come back later on top of it.
- **The default label changes from the colour name to the meaning**, in the Highlights filter, the Markdown export ("## Key idea" instead of "## Yellow") and the highlights question sent to the AI (it already sends the legend). This is a visible change; the test that pins the Markdown is updated on purpose, in its own commit.

## 6. Capture: a part of a page into the notes

- Pick **Capture** (C) and drag a rectangle on the page. A dashed frame in `--accent` follows the pointer, and a hint above the page says "Drag over the paper to capture a part of a page" ("Drag to capture" on a phone).
  - On release, if the frame is at least 24 × 16 px, the part becomes a **capture block** on the open notebook page. A toast says "Captured from p. 4" with Undo. The tool goes back to Select.
  - With a keyboard: on a page, Enter starts a frame at its centre. The arrow keys move it, Shift with an arrow resizes it, and Enter captures.
- **A capture is stored as a place, not a picture**: `{ page, x, y, w, h }`, as fractions of the page, like our ink strokes. The block draws it from the PDF that is already open, at the device's pixel ratio. So:
  - it stays sharp at any zoom;
  - it costs about 60 bytes;
  - **nothing new is stored and no picture is uploaded**;
  - it disappears with the paper.
- Export draws it once, into the Markdown zip and the PDF (section 10).
- **Touch**: Capture takes one finger, the way Draw does with "Draw with a finger". Two fingers still pinch.

## 7. The Notebook (the Notes tab)

### 7.1 What a person sees

```
┌ Notes ─ Highlights 12 ─ References 59 ────────────────────────┐
│ [Methods ▾]  [+ Page]                     Saved · 2 pages     │
│ ┌────────────────────────────────────────────────────────────┐│
│ │ Methods                       [Plain|Ruled|Dotted|Grid] [⋯]││
│ │ [H] [B] [I] [U] [mark] [• list] [1. list] │ [❝ Quote] [⬚ Capture] │
│ │ ────────────────────────────────────────────────────────── ││
│ │ Patch embedding is just a linear layer …                   ││
│ │ ┃ K  "a pure transformer applied directly to sequences of  ││
│ │ ┃     image patches…"                         p. 1 ↗       ││
│ │ ┌──────────── capture p. 3 ───────────┐                    ││
│ │ │  (figure 1, drawn from the PDF)     │      p. 3 ↗        ││
│ │ └─────────────────────────────────────┘                    ││
│ │ ✦ Explain · "Position embeddings let the model …" p. 4 ↗   ││
│ └────────────────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────────┘
```

- **Pages.**
  - A paper has one notebook with pages (at most 50). A page picker shows them; "+ Page" adds one, titled "Untitled page" and named in place.
  - Delete is in the ⋯ menu, with a toast and Undo.
- **A page is a column of blocks**, of four kinds:
  - **Text**: rich text, below.
  - **Quote**: a highlight, live-linked. It shows the meaning bar, the quote and "p. N ↗". If the highlight is removed, the quote stays as plain text marked "highlight removed".
  - **Capture**: section 6.
  - **Agent answer**: the answer, its "p. N" chips and the agent's name.
- **Moving blocks.** Each block has a handle: drag it, or with the keyboard Alt+↑ / Alt+↓ moves the block. Delete is in the block's menu, with Undo.
- **Why a column and not free placement** (the mock's "double-click anywhere"):
  - It reads in order for a screen reader.
  - It reflows on a phone.
  - It exports straight to Markdown, DOCX and PDF.
  - It can be used from the keyboard.
  - Free placement on the paper itself already exists (text boxes and sticky notes in Draw).
- **Paper style**: Plain, Ruled, Dotted or Grid. It is a background drawn with `--border` at low opacity, so it suits each theme. It is kept per page and never sits behind text at a contrast that matters (the lines are decorative and pale).
- **Text editing.**
  - What is stored is **Markdown**: headings, bold, italic, underline (as `<u>`, the one tag allowed), mark (`==text==`), and bullet and numbered lists. A text block is a `<textarea>` while focused and formatted text when not, and the toolbar wraps the selection. Ctrl+B, Ctrl+I and Ctrl+U work.
  - This keeps the editor small (no ProseMirror, no 100 KB), accessible (a real text field), safe (the renderer allows a fixed list of elements and escapes everything else) and exportable as it is.
  - Line breaks are kept. Today's server collapses them in highlight notes (`cleanText`, docs/routes.ts:701), which is a bug fixed in phase 2.
- **Saving.**
  - The page saves 1.2 s after the last change, with the revision it started from: the same pattern as ink (`useInk`).
  - The save line says "Saved", "Saving…", "Not saved. Retry", "Offline: kept on this device" or "Updated from another window".
  - Unsaved changes wait in IndexedDB, as drawings do.
- **Drag from the paper**: dragging selected text or a highlight onto the page drops a quote there (the mock's idea). It is a pointer convenience only; "Add to notes" is the way that always works.

### 7.2 Storage

- **A new D1 table `doc_notebook_pages`**, with columns:
  - `id`, `doc_id`, `user_id`;
  - `title` (up to 120 characters);
  - `style`, `position`;
  - `blocks` (JSON, at most 200 blocks and 64 KB per page);
  - `rev`, `created_at`, `updated_at`.
- **Rules for the table:**
  - It is deleted with the paper and with the account.
  - It is in "Export my data".
  - The server checks every number and kind; a block is untrusted input.
- **Routes:**
  - `GET /api/v1/documents/:id/notebook`;
  - `PUT /api/v1/documents/:id/notebook/pages/:pageId` (with `rev`, 409 on conflict);
  - `DELETE` the same path;
  - `POST /api/v1/documents/:id/notebook/pages` (new page).
- **"In notes".** A quote block stores the highlight's id, so the Highlights tab can show "In notes ✓" and a highlight's menu can open the block.

## 8. The Highlights tab

It is today's Notes list, renamed, with these changes:
- the meaning chips ("All 12 · Key idea 5 · Method 3 · Question 2 · Result 2");
- by page or by meaning;
- the per-highlight note, as today;
- on each card: **In notes ✓** or **Add to notes**, and **Show in paper**;
- the Markdown copy and download.

Freehand highlighter strokes are not text, so they stay out of this list, as today.

## 9. The Agents button and drawer

### 9.1 The button

- **What it is:**
  - a round button, 56 px, at the bottom right, 20 px from the edges plus the safe area;
  - `--accent` with `--accent-fg`, and the shadow `--shadow-2`;
  - a sparkle icon, and the word **Agents** on a wide screen (an icon with `aria-label="Agents"` on a phone).
- **Behaviour:**
  - Open, it becomes **Close** (×).
  - It moves up above the selection pill and the toast when they show, so it never covers them.
  - It is hidden while Capture or Draw is in hand: it would be in the way of the hand. The toolbar's palette entry still opens the drawer.
- **The same button in all three themes**: the accent pair already passes 4.5:1 in each (`contrast.mjs`).
- **Keyboard**: it is in the tab order after the panel. "Agents" and each agent are in the Ctrl+K palette. There is no single-letter key, because A is the arrow tool in Draw.
- **Motion**: it springs in on open (`springPop`) and rises 12 px when it moves up. With reduced motion it simply appears.

### 9.2 The drawer

- **Shape by screen:**
  - On a wide screen it is a sheet from the right, 26rem wide, over the panel side. The paper stays usable, and the drawer is not modal (`role="complementary"`, labelled "Agents"); focus moves into it and Esc returns focus to the button.
  - On a phone it is a bottom sheet, 88 % of the height, modal (`role="dialog"`, focus kept inside), with a grab bar and a swipe down to close.
- **Inside, top to bottom:**
  - the agent chips: **Ask · Explain · Critique · Note-taker · Related**;
  - one line saying what the chosen agent does;
  - its prompt chips;
  - the conversation;
  - the selection, when there is one ("SELECTION · "…" ×");
  - the question box;
  - the standing line **"Answers cite pages. Check the passage before you rely on an answer."**
- Every answer has **+ Add to notes**, which drops an agent-answer block onto the open page.

### 9.3 What each agent does, and how

All of them use the paths we already have:
- the private Workers AI route of the `qa` task (`@cf/openai/gpt-oss-120b`);
- retrieval over the paper's own chunks (`bge-m3`, top 6);
- the quote check;
- `doc_qa` for history.

No new model and no new outside service, except Related, which uses OpenAlex.

| Agent | What it is | Server | Grounding |
|---|---|---|---|
| **Ask** | Today's AskPanel, moved here unchanged: questions about the paper or about my highlights, with streamed stages | `POST /:id/ask?stream=1`, `/ask-highlights` | as today |
| **Explain** | Explains the selection, or a named idea, in plain words, at the level of a first-year student | `/:id/ask?stream=1` with `mode: "explain"` and `selection` (at most 600 characters, from this paper) | retrieval starts from the selection's page; the answer must cite pages, and the quote check runs |
| **Critique** | Weak points: where the evidence is thin, missing baselines, claims larger than the results, limitations the authors do and do not state | `mode: "critique"` | every point cites the passage it is about; each point is labelled "a reading of the paper, not a fact"; points without a checked quote are dropped |
| **Note-taker** | Turns my highlights (and their notes) into a draft page: headings by meaning, bullets that keep "p. N" | `/ask-highlights` with `mode: "notes"` | built only from my highlights; the result is a **draft page** I accept ("Add as a new page") or discard |
| **Related** | Papers that build on this one, papers it builds on, and similar papers | no model: OpenAlex `cited_by`, `referenced_works` and `related_works` for the paper's DOI (or title search when there is no DOI), through the existing OpenAlex client and cache | real records only, each with "Open" and "Save to library", like the citation card |

- When the paper has no index ("Not indexed", or a scan that was not read), Ask, Explain and Critique say so and offer Related only.
- **Counters**: `reader_agent_<name>` on the existing outcomes table, so the admin page shows use without storing questions twice.

## 10. Export

The header's **Export** opens a small dialog:
- Include: Notebook pages · Highlights · Captures · Agent answers (each with a count, all on by default).
- **Download Markdown**: a `.md` file, or a `.zip` with PNGs when captures are included.
- **Download PDF** (lazy, built with the pdf-lib chunk we already ship for the marked copy, Devanagari noted as today).
- **Download a copy of the paper with my marks**: today's annotated PDF, moved here as well.

DOCX comes later, reusing the litscan DOCX code.

## 11. Toasts

- A small queue at the bottom centre, one at a time, 4 s, paused while hovered or focused.
- It has `role="status"` (polite), and an optional action (**Undo**) that is a real button reached with Tab.
- On a phone it sits above the FAB.
- Errors still use today's notice banner (`role="alert"`); a toast is never the only place an error is said.

## 12. Accessibility

WCAG 2.2 AA, and the axe sweep in all three themes:
- every control has a visible name or `aria-label`;
- the segmented controls are radiogroups;
- the panel tabs are a tablist;
- the pop-up is a toolbar;
- the phone sheet is a dialog with its focus kept inside;
- the drawer on a wide screen is a labelled complementary region.

The keys V, H, C and D act only when focus is not in a text field. They are listed in the `?` sheet and the palette, and each tool button shows its key in its title. Targets are at least 24 × 24 px, and 44 px for the FAB and the phone controls. Focus rings use `--accent`. Motion respects reduced motion (`MotionConfig` and the CSS media query). Live lines are announced through the shared `announce()`, so the reader stops keeping six local live regions.

## 13. Privacy

What is new, and whether the privacy page already covers it:

| New | Stored or sent | Covered today? | Proposed words (the owner reads them before they go live) |
|---|---|---|---|
| Notebook pages, quote and capture blocks | stored in our database with the paper | Partly: the row says "highlights and notes" | Change the row "Papers you upload" to read "…highlights and notes (including note pages, the parts of the paper you capture into them, and agent answers you keep there)…". A capture is a place on the page, not a picture |
| Explain and Critique | the selected text and passages of the paper go to Workers AI | Yes: "the relevant text is sent to an AI model run by Cloudflare (Workers AI)" | none needed; it says "relevant text" |
| Note-taker | my highlights and notes go to Workers AI | Yes: "When you ask about your highlights, those highlights and the notes you wrote on them are sent in the same way" | none needed |
| Related | the paper's DOI or title goes to OpenAlex | To check: the DOI lookup at upload (`PUT /:id/info`) already sends it; the owner confirms the sentence that names OpenAlex covers this use | a sentence only if the owner wants one |

Phase 2 changes the privacy version (`PRIVACY_VERSION`), and `legal-match.test.ts` ties the new words to the switch.

## 14. Weight (the first-load budget stays 250 KB)

- **Today**, `DocWorkspace`, `AskPanel`, `NotesPanel`, `ReferencesPanel` and `DocMeta` are in the first load (App.tsx:14). The new reader moves the reader page itself into a lazy chunk (`ReaderPage`, loaded on `/papers/:id`, with the same preload on hovering a paper card that the PDF chunk has). So the first load should **shrink**, not grow.
- **Lazy chunks**, each with a budget line in `budget.mjs`:

  | Chunk | Contents | Budget (gzip) |
  |---|---|---|
  | `reader` | the layout, toolbar, pop-up, panel tabs, toast | 28 KB |
  | `notebook` | the editor, blocks, Markdown renderer | 16 KB |
  | `agents` | the drawer and agent views; AskPanel moves here | 20 KB |
  | `export` | the dialog, zip, PDF | its own; pdf-lib is already separate |

- **No new dependency** is planned, except a zip writer for Markdown with images (fflate, about 8 KB, or `CompressionStream`, which needs no library), decided in phase 4.
- The `HEAVY` list gains `notebook`, `agents` and `export`.

## 15. Phases, each behind a switch

- **The switch.** The reader has one server switch in the registry (`platform/switches.ts`), `READER`, with the positions `off` (today's reader), `dark` (new reader only for `READER_BETA_USERS`, like MCP beta) and `on`. The page reads it from the response it already loads for a paper, `GET /documents/:id`, as `features.reader`. No extra request.
- **One reader at a time.** The old reader stays whole until the new one is `on` everywhere. Then it is deleted in its own PR.

| Phase | What | Privacy | Size |
|---|---|---|---|
| **1. Desk** | The view switch with the phone rule. The panel tabs Highlights and References (Notes arrives in 2). The tool segment (Select, Highlight mode, Draw; Capture shown in 3). The pop-up with Copy and Explain. Explain opens Ask with the selection as its question until 3. The meaning names and their tokens. The Agents FAB and drawer with **Ask** (moved). Toasts with Undo (remove a highlight). The Download menu. The lazy reader chunk | no change | M |
| **2. Notebook** | Note pages, blocks (text, quote), the editor, saving with revision and offline. "In notes". Add to notes. Drag a quote. The line-break fix. Export Markdown | **yes**: the row in section 13, new version | L |
| **3. Capture and agents** | Capture (pointer and keyboard), capture blocks. Explain, Critique, Note-taker on the server (modes, prompts, quote check, evals). "+ Add to notes" on answers | no change (section 13), the owner confirms | L |
| **4. Related and export** | The Related agent. The Export dialog (Markdown zip, PDF). Retire the old reader | Related: as the owner decides | M |

## 16. Tests per phase

- **Phase 1**
  - Unit: `useWide` (the rule, rotation to Paper), the meaning table and its tokens, the toast queue (one at a time, Undo, pause), the keys V, H and D outside and inside Draw.
  - Browser (new `e2e/reader.mjs` on the shared kit):
    - 1280, 1024 (tablet landscape), 768 (tablet portrait), 390 and 844 × 390 (phone landscape: **no Split**);
    - Light, Dark and Read, with axe at each;
    - the view switch, kept on reload;
    - Highlight mode;
    - the pop-up actions, Copy refusal message;
    - Remove + Undo;
    - the FAB not covering the pill or the toast, the drawer focus and Esc, the phone sheet as a dialog;
    - no sideways scroll.
  - The existing `papers.mjs`, `workspace.mjs`, `cites.mjs` and `polish-reader.mjs` run in both `READER=off` and `on` (a named run `reader-on`) until the old reader is deleted. Contrast for the 12 new pairs. Budget lines.
- **Phase 2**
  - Unit: the block checks and limits, the Markdown renderer's allowed list (a `<script>`, an `onerror`, a `javascript:` link all come out as text), the line-break fix.
  - API (`scripts/notebook-e2e.mjs`): create, rename, reorder, conflict 409, another user, limits, export, account and paper deletion.
  - Browser: write, format, quote, In notes, offline then sync, a second tab, reload.
- **Phase 3**
  - Unit: the capture rectangle maths on rotated and cropped pages (like `annotated.mjs`).
  - Eval: a recorded set for Explain and Critique (every point has a checked quote; no point without one survives), and Note-taker keeps pages.
  - Browser: capture by pointer and by keyboard, an answer added to notes.
- **Phase 4**
  - Related against recorded OpenAlex answers.
  - The export files opened and checked (Markdown text, PDF pages, images present).

## 17. Not doing, and why

- **Invites and share links**: privacy, as decided on 24 Oct. Export covers sending notes to a supervisor.
- **Free placement of blocks on a note page**: free placement exists on the paper (Draw), and a column is what reads, reflows and exports.
- **A second set of highlight colours** for meanings: the four stored colours stay, and only their names change. The freehand highlighter keeps its own five colours, because it is drawing, not meaning.
- **Rich text with ProseMirror or Tiptap**: too heavy for what notes need. Markdown is the format people export to anyway.

## 18. Phase 1 as built (13 Nov 2026)

Phase 1 ("Desk") is built on the branch `reader-v2`, behind `READER`, which is not set in `wrangler.jsonc`: production keeps today's reader. Where the build differs from the sections above, this is what was done and why.

**The switch.**
- `READER` is a gate with the positions `off`, `dark` and `on`. The registry's gate reader had no `dark` (it knew `core`, `writer` and `beta`, each for one flag), so it learned `dark` the same way, for a flag that lists it (`FLAG_POSITIONS`, `positionOfVariable`'s fifth argument). Every other switch reads exactly as before: the switch table gained READER's rows and no other row changed. `shadow`, which every gate's reader takes, counts as off for READER.
- `dark` reads `READER_BETA_USERS` (a secret, like `MCP_BETA_USERS`). The page is told `features.reader` on `GET /documents/:id`.

**Layout.**
- Today's code keeps the side panel "put away" as `scholar.focus = "1"`, not `"closed"`: both are read as Paper, once, and from then on the choice is kept as `scholar.view`.
- When a wide screen turns into a phone while Split is on, the view shows Paper, but the choice kept on the device is not overwritten: it was the person's, and a wide screen offers Split again.
- On a phone held upright (600 px or less) the header has two rows under the title: the status and the theme on one, the view switch across the width under them (`[ Paper | Notes ]`). The mock put the theme in the title row; the theme switch is four buttons wide and does not fit there at 390 px. A phone on its side has all of it in one row, to keep its little height for the paper.
- In Split the paper's toolbar and thumbnails follow the paper's own width (a container query): on a tablet upright the thumbnails go and the meanings and tools show icons, with their names kept as accessible names and tooltips.
- On a wide screen the Agents drawer starts below the paper's header while the header is in sight, so the view switch and the theme stay reachable while it is open.

**The pop-up.**
- Highlight mode makes a highlight at once only for a selection made with the pointer. A selection made with the keyboard (Shift and the arrows) still shows the pop-up, so that a keyboard user is not given a highlight at every key.
- A keyboard user reaches the pop-up with Tab from the pages (nothing else could take the focus there without stealing it from a selection being made); the arrows move inside it, Esc closes it, clears the selection and gives the focus back to the pages.
- An existing highlight's pop-up also has **Add note** (it opens the highlight's note), as the table in section 4 has it, besides the recolour, Explain, Copy and Remove of the brief.
- Copy uses the app's shared copy (`lib/copy.ts`: the clipboard, then the older copy command), so "Could not copy. Select the text and press Ctrl+C." shows only when both fail. It is said in the notice banner (`role="alert"`); "Copied" is a toast.
- "That text is already highlighted" is a toast in the new reader (it is not an error), and the notice banner in today's.
- Undo after Remove makes the highlight again with its meaning and its note text; it gets a new id from the server.

**The Agents.**
- Phase 1 shows Ask alone: "Ask" is a label, not a control, and no other agent is shown until it works. Ask is today's `AskPanel`, unchanged except for an optional `prefill` (Explain puts `Explain: "…"` into its question box); today's reader does not pass it. Inside the drawer the panel's own fine print is hidden by the drawer's style sheet, because the standing line says the same.
- On a phone the sheet is modal and covers the button, so the sheet's own × is its Close (in its header, with the grab bar); on a wide screen the button becomes Close and moves to the left of the drawer, so it never covers the question box.
- The `agents` chunk is the drawer alone (2.2 KB). `AskPanel` stays where it was: today's reader shows it at once and the open-access sheet uses its pieces, so while both readers exist it cannot move into a chunk that only the new reader loads. It moves when the old reader is deleted.

**Weight.**
- There was no hover preload of the PDF chunk on a paper card to copy. Instead the paper page's chunk is fetched in idle time while the list of papers is on screen, and a few seconds after start when offline reading is on (the offline worker keeps what is fetched, so a paper opened before still opens offline).
- Moving the page of a paper out of the first load made a chunk of its own (DocWorkspace, today's reader and the state both readers share); it has a budget line of its own beside the plan's `reader` and `agents` lines, and all three are on the HEAVY list.

**Other.**
- The colour dots of the Highlights list, its filter chips and its group headings use the meaning tokens and letters in the new reader (style sheet only, under `.desk`); today's reader keeps its colours.
- The legend that names the colours is switched by the new reader being on screen (`lib/desk.ts`), so the Markdown, a question about the highlights and the notes page of the marked PDF use the meanings only then.
- Three import edges were added to the layer rule's allowlist (`layers.test.ts`), of the same kind as DocWorkspace's own: `desk/Desk.tsx` to `ThemeSwitch` and to the shared announcer, `desk/DeskBits.tsx` to `Pop`.
- Today's reader has a small display fault the pictures showed: in the Highlights list the sliding pill of "By page | By colour" covers the chosen word. It is fixed in the new reader only, to keep today's reader as it is.

**Tests.**
- `e2e/reader.mjs` runs in the named run `reader-on` (READER on), with the documents suite and the two reader suites of today's reader that apply to the new one: `cites.mjs` (Draw is a radio of the tool segment; the old phone tab bar is not drawn, so that part is left out) and `polish-reader.mjs` (Draw as a radio, Ask in the Agents drawer, and the Paper view, so the drawing toolbar is measured at the paper's full width as in today's reader under 1000 px). With READER off both take exactly the old path. `papers.mjs` and `workspace.mjs` run in the default run only: their reader checks are of today's layout, which the new reader replaces.
- The table test of the integration runner lists what the default run skips; it gained the new suite, on purpose. `ci.yml` and `browser-e2e.yml` add `reader-on`.
- `e2e/shots-reader.mjs` takes the before and after pictures (not a suite).
