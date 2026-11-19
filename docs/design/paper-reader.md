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
- Phase 1 shows Ask alone: "Ask" is a label, not a control, and no other agent is shown until it works. Ask is today's `AskPanel`, unchanged except for two optional props that today's reader does not pass: `prefill` (Explain puts `Explain: "…"` into its question box) and `embedded` (inside the drawer, whose heading already says Agents and Ask, the panel's own title row "Ask this paper" is left out; its line about the passages stays). Inside the drawer the panel's own fine print is hidden by the drawer's style sheet, because the standing line says the same.
- The button does not become Close (section 9.1): there is one Close only, the × in the drawer's header (and Esc). On a phone the modal sheet covers the button; on a wide screen the button is hidden while the drawer is open, and when the drawer closes it comes back with the focus.
- The panel's lists (Highlights, References, and the Notes view) and, on a phone, the paper keep room under their last item for the button (`--fab-clear`: its 56 px, its 20 px offset, 16 px and the safe area), so nothing ends up under it.
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

## 19. Phase 2 plan: the Notebook (16 Nov 2026)

The owner approved phase 1 from its pictures on 16 Nov and asked for phase 2 to start beside it. This section turns section 7 into a buildable plan, on top of phase 1 as built (section 18). Where it is more precise than section 7, this section wins.

### 19.1 What a person can do when phase 2 ships (READER on)

1. **Open the Notes tab.**
   - The panel tabs become `Notes · Highlights · References`, with Notes first.
   - On a phone, `[ Paper | Notes ]` → Notes shows the same three tabs.
2. **Start writing at once.**
   - A paper with no notebook shows one page, "Notes", with an empty text block and its cursor in it.
   - The empty state says *"Write here, or select text in the paper and choose Add to notes."*
   - The page is created on the server only when something is written, so opening a paper creates no rows.
3. **Write formatted text.**
   - The toolbar has H (heading), B, I, U, Mark, bullet list and numbered list. Ctrl+B, Ctrl+I and Ctrl+U work too.
   - A text block is a `<textarea>` while it has focus and formatted text when it does not.
   - Line breaks are kept.
4. **Add a highlight to notes.**
   - It can come from the pop-up ("Add to notes"), from a Highlights card ("Add to notes"), or by dragging a highlight or a selection from the paper onto the page.
   - It becomes a **quote block** on the open page.
   - A toast says *Added to "Notes"*, with **Undo**. On a phone in Paper view the toast also has **Open**, which switches to Notes.
   - The Highlights card then shows **In notes ✓**. Clicking it opens the page and scrolls to the block.
5. **Insert a quote from the toolbar.**
   - The ❝ Quote button opens a list of the paper's highlights: meaning letter, page, first words.
   - The list is filtered as you type. Highlights already on this page are marked.
6. **Go back to the paper.**
   - Every quote block has **p. N ↗**.
   - On a wide screen it switches to Split if needed, goes to the page and flashes the passage. On a phone it switches to Paper.
7. **Keep several pages.**
   - "+ Page" adds "Untitled page" and focuses its title.
   - A page picker lists the pages, each with its title and number of blocks.
   - The ⋯ menu has Move up, Move down, Paper style (Plain, Ruled, Dotted, Grid) and Delete page.
   - Delete shows a toast with Undo, which brings the page back with all its blocks.
8. **Reorder and delete blocks.**
   - Drag the handle, or focus it and press Alt+↑ or Alt+↓.
   - The block's ⋯ menu has Delete, with Undo.
9. **See whether notes are saved.**
   - The save line says *Saved*, *Saving…*, *Not saved. Retry*, *Offline: kept on this device* or *Updated from another window*.
   - The browser warns before closing with unsaved changes, as it does for drawings.
10. **Export.**
    - The Notes tab's ⋯ menu has **Copy as Markdown** and **Download Markdown** (`notes-<paper title>-<date>.md`), for the open page or for all pages.
    - The Export dialog of section 10 stays in phase 4.

With READER off, none of this exists: today's reader and its notes are unchanged, except the line-break fix (19.6), which applies to both readers.

### 19.2 Data model

Migration `0028_doc_notebook.sql`:

```sql
-- A paper's notebook: pages of blocks the owner writes, in their own words, with quotes of their highlights. Private to the paper's owner;
-- deleted with the paper (and so with the account).
CREATE TABLE doc_notebook_pages (
  id TEXT PRIMARY KEY,                       -- made by the browser (a random id), so a page made offline keeps its id
  doc_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  style TEXT NOT NULL DEFAULT 'plain',       -- plain | ruled | dotted | grid
  position REAL NOT NULL,                    -- order among the paper's pages; a move takes the midpoint, no renumbering
  blocks TEXT NOT NULL DEFAULT '[]',         -- JSON, checked by the server (19.3)
  rev INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_doc_notebook_doc ON doc_notebook_pages (doc_id, position);
```

Blocks are a closed union in `packages/shared/src/notebook.ts`. The checks and the limits live there and are used by both sides.

| kind | fields | phase |
|---|---|---|
| `text` | `id`, `md` (≤ 8,000 chars) | 2 |
| `quote` | `id`, `noteId` (the highlight in `doc_notes`, or null after it is removed), `page`, `quote` (≤ 600; a copy, so the block survives the highlight), `color` | 2 |
| `capture` | `id`, `page`, `x`, `y`, `w`, `h` (fractions 0..1) | 3; the server refuses it until then |
| `answer` | `id`, `agent`, `text`, `pages[]` | 3 |

Limits:
- 50 pages per paper and 200 blocks per page.
- 48 KB of JSON per page and 1 MB per paper.
- Titles up to 120 characters.
- Ids up to 40 characters from `[A-Za-z0-9_-]`.

Every number is checked again on the server, because a block is untrusted input. Anything outside the union is refused with 400, not dropped silently.

Why one row per page:
- A save sends one page, not the whole notebook.
- Two windows editing two different pages never conflict.
- The 48 KB cap keeps every write small.

### 19.3 API (`apps/api/src/docs/notebook.ts`, mounted under the documents router)

- Every route is behind F10's `requireUser({ack, owns})` door and the same-origin middleware.
- Every body is read through `readJson(c, MAX_NOTEBOOK_BODY)`.
- With READER off the routes answer 404, the way MCP does when it is off.

| Route | Does | Answers |
|---|---|---|
| `GET /documents/:id/notebook` | all pages, ordered by position | `{ pages: [{id,title,style,position,blocks,rev,updatedAt}] }` |
| `PUT /documents/:id/notebook/pages/:pageId` | creates the page (no `rev`, or `rev: 0`) or replaces it (`rev` = the revision it started from) | 200 `{page}`; 409 `{page}` (the server's copy) when `rev` is stale; 413 over a limit; 400 for a bad block |
| `PATCH /documents/:id/notebook/pages/:pageId` | `{title?, style?, position?}` only, with no `rev` needed: the last write wins, so a rename never conflicts with someone typing | 200 `{page}` |
| `DELETE /documents/:id/notebook/pages/:pageId` | deletes the page; Undo puts it back with `PUT` and `rev: 0` | 204 |

- `/account/export` gains `notebook: [{docId, title, style, blocks, updatedAt}]`.
- Deleting the paper or the account removes the rows through the cascade. The account-deletion test checks it.

### 19.4 The web side (`apps/web/src/components/papers/desk/notebook/`, a lazy `notebook` chunk)

**Saving: `useNotebook(docId)`** (`lib/notebook.ts`)
- It holds the pages and saves each one 1.2 s after its last change, one save at a time per page, with the page's `rev`.
- Pages that are not saved yet wait in IndexedDB (the store `lib/idb.ts` already has for ink) and are sent when the connection returns.
- On a 409 it merges by block id:
  - the server's blocks are taken as the base;
  - blocks this window changed since its last save are put over them;
  - blocks this window added go after their neighbours;
  - blocks this window deleted stay deleted.
- If both windows changed the same block, this window's text wins and the toast says *Updated from another window*.
- The ink save has the same shape, so its tests are the template.

**The Markdown subset** (`packages/shared/src/notebook-md.ts`)
- It is a pure parser that turns the text into tokens. It knows:
  - headings (`#`, `##`, `###`), `**bold**`, `*italic*`, `<u>underline</u>`, `==mark==`;
  - `- ` and `1. ` lists, paragraphs and line breaks.
- React renders the tokens as elements. **No HTML string is ever put into the page** (no `dangerouslySetInnerHTML`), so by construction a block cannot run a script and nothing has to be sanitised.
- Anything else (links, images, raw HTML) is shown as the text that was typed.

**The editor**
- The toolbar wraps or toggles the selection in the focused textarea (`lib/md-edit.ts`, pure and tested).
- The textarea grows with its text (`useGrowingField`).
- Enter at the end of a list item continues the list; Enter on an empty item ends it.
- Tab is never trapped.

**Paper styles** are background images made from `--border` at about 35 % opacity, so they suit Light, Dark and Read. They are decorative and never carry meaning.

**In notes**
- The Highlights list reads which `noteId`s are on any page.
- When a highlight is removed from the paper, its quote blocks become plain quotes with the line *"highlight removed"*. The stored `noteId` becomes null on the next save.

**Drag from the paper**
- The drag carries the type `application/x-sodhsetu-quote` with `{noteId?, page, quote}`.
- A selection that is not a highlight yet is highlighted first, in the current meaning.
- Dropping works only on a wide screen. On a phone, "Add to notes" is the way.

**The open page** for "Add to notes" is the last page the person used in this paper, kept on this device in `scholar.notebook.<docId>`. The first time, it is a new page called "Notes".

### 19.5 Accessibility

- The page list is a listbox in a popover.
- The blocks are a list (`role="list"`).
- Each block has a handle button ("Move block, position 2 of 5"). Alt+↑ and Alt+↓ move the block, and the new position is announced through `announce()`.
- A formatted text block is a focusable region, "Text block 2, press Enter to edit". Enter or a click opens the textarea; Esc closes it and keeps the focus on the block.
- The toolbar is a `role="toolbar"`. B, I, U and Mark get `aria-pressed` from the selection.
- Quote blocks name their meaning in words ("Key idea, page 4").
- axe runs on the Notes tab in Light, Dark and Read, at 1280 and 390 px, with a page that holds every block kind.

### 19.6 The line-break fix (both readers)

**Today:** `cleanText` (docs/routes.ts:704) collapses every run of whitespace, line breaks included, so a note typed on three lines is saved as one.

**The fix:**
- `\n` is kept.
- Runs of spaces and tabs within a line become one space.
- At most two blank lines in a row are kept.
- Each line's end is trimmed.

Quotes keep today's single-line cleaning, because they come from the paper's text layer. The Notes list of today's reader shows the line breaks (`white-space: pre-line`).

**Tests:**
- API: a note with three lines comes back with three lines.
- Unit tests for the new cleaning.
- `papers.mjs`: a note typed with Shift+Enter keeps its line break after a reload.

### 19.7 Privacy (the owner reads this first)

The row "Papers you upload" (LegalPages.tsx) becomes:

> …Also what you add to a paper: highlights and notes (including **pages of notes you write in the reader, with the passages you quote into them**), drawings (pen and highlighter strokes), tags, whether it is to read, being read or done, and the page you reached…

**What stays the same:**
- Where the notes are kept: our database, with the paper.
- How long: until the paper or the account is deleted.
- Who sees them: only the owner.
- The data export and the AI rules.
- Phase 2 sends nothing new to any model or service.

**How it is tied down:**
- `legal-match.test.ts` gains READER in `FLAG_SENTENCES`. With READER at `dark` or `on`, the page must contain the new words.
- `PRIVACY_VERSION` goes to the next draft.

**How it ships:**
- The words are in a commit of their own on a branch of their own, `reader-privacy`.
- That branch is merged only after the owner has read it, and before READER leaves `off`.
- Phase 3 changes the same row once more, for captures and agent answers.

### 19.8 Weight

- The `notebook` chunk holds the parser, the editor, the blocks, the page picker and the merge. Its budget is **16 KB gzip**.
- It is on the HEAVY list and loads only when the Notes tab opens.
- The first load does not change, and there is no new dependency.

### 19.9 Tests

| Level | What |
|---|---|
| shared unit | `notebook.ts` checks: every limit, every kind, a capture refused in phase 2, ids. `notebook-md.ts`: each mark, nesting, lists, line breaks, and `<script>`, `<img onerror>` and `[x](javascript:…)` come out as text. `md-edit.ts`: wrap and unwrap, a list continued and ended |
| web unit | `useNotebook`: the merge on 409 (each of its four rules), the offline queue, Undo of a deleted page and of a deleted block |
| API unit | The routes: create, replace, a stale `rev` gets 409 with the server's page, PATCH with no `rev`, limits give 413, a bad block gives 400, another user gets 404, READER off gives 404 |
| route-guard table | The four new routes appear with their guards (F10's test fails until they do) |
| integration (`scripts/notebook-e2e.mjs`, `reader-on` run) | The real Worker: create, edit, conflict, delete and Undo, the export carries the notebook, deleting the paper and deleting the account remove the rows |
| browser (`e2e/notebook.mjs`, `reader-on` run) | Write and format. Add a highlight from the pop-up, from a card and by dragging. In notes. p. N ↗ back to the paper. Pages: add, rename, style, move, delete and Undo. Offline, then reconnect. Two tabs on one page. A reload keeps everything. Phone Paper ↔ Notes with the toast's Open. axe in the three themes. No sideways scroll |
| default run | `papers.mjs` gains the line-break check; everything else is unchanged |
| budget, contrast | The `notebook` budget line. The paper styles are decorative, so there is no new contrast pair |

### 19.10 Order of work (one PR, small commits)

1. Shared: `notebook.ts` and `notebook-md.ts`, with their tests.
2. The line-break fix for both readers, with its tests, in its own commit, because it is a visible change in today's reader.
3. Migration 0028, the API routes, the route-guard table rows, the export, and the API tests.
4. `notebook-e2e.mjs`, registered in the `reader-on` run.
5. Web, in this order:
   - `useNotebook` and its tests;
   - the Notes tab: blocks, editor, toolbar, pages;
   - Add to notes, In notes, drag, Markdown export.
6. `e2e/notebook.mjs` and the budget line.
7. Screenshots `after-p2-*` for the owner:
   - desktop, tablet and phone, each in Light, Dark and Read;
   - a phone toast with Open;
   - a page in each style;
   - a conflict toast.
8. The privacy words on `reader-privacy` (19.7), as a PR of their own, held for the owner.

Phase 2 merges the way phase 1 did: behind READER, which stays `off` in production until the owner turns `dark` on for their own account.

## 20. Phase 2 as built (17 Nov 2026)

Phase 2 ("Notebook") is built on the branch `reader-p2`, on top of phase 1 (`reader-v2`), behind `READER`, which is not set in `wrangler.jsonc`: production keeps today's reader. Where the build differs from section 19, this is what was done and why.

**The server.**
- F10 (`requireUser`, `readJson`, the route-guard table) is not on this base. The four routes are guarded the way the notes and the drawing of a paper are today, in `docs/routes.ts`: the same-origin check on a write, the signed-in person, their own paper (404 for anyone else's), and the body read with a size limit (`MAX_NOTEBOOK_BODY`, a page's 48 KB and 4 KB of envelope; the `Content-Length` and the text are both checked, as for ink). The notes and ink routes ask for no privacy note, so these do not either. **F10's door replaces these lines, and the route-guard table gains the four rows, when the W3 untangle merges.**
- The routes stay in `docs/routes.ts` (the door) and call `docs/notebook.ts` (the store): a new file importing `auth/http.ts` would have been a new edge against the layer rule.
- With READER off the routes answer 404 to everyone, signed in or not, before anything else (as the MCP server does when it is off); `shadow` counts as off, as in phase 1. At `dark`, an account not in `READER_BETA_USERS` gets the same 404 once signed in.
- The table's key is `(doc_id, id)`, not `id` alone: the id is made by the browser, and with a key of its own one person's id could meet (and be refused by) another person's page.
- `PUT` with a revision replaces the **blocks only**; the title, style and place are sent by `PUT` only when a page is made (no revision), and by `PATCH` after that. Otherwise a window holding an older title would put it back with every save of its blocks.
- `PUT` with a revision on a page that is gone (deleted in another window) answers 404 `page_gone`; the page that was writing in it makes it again (no revision), so what was typed is not lost.
- The 51st page is refused with 413 `notebook_full` (the plan's "413 over a limit"), checked in the same statement that inserts, so two windows cannot both make it.
- The export has `notebook: [{docId, title, style, blocks, updatedAt}]` at its top level, as 19.3 says (always present; empty for everyone today).

**The page.**
- `lib/notebook.ts` is a store with its network, IndexedDB, clock and storage handed in (like the toast queue), and `useNotebook` reads it, so the merge, the offline queue and both Undos are tested in node. Pages not yet saved wait under `nb:<paper>` in the store drawings use; signing out clears them with the drawings, and asks first when some wait (a second question, said only when there are notes waiting: with READER off there never are).
- **When the chunk loads.** Not only when the Notes tab opens: "Add to notes" (the pop-up on a phone in Paper view, a Highlights card) and the cards' "In notes" need the store while the Notes tab is closed. The chunk is fetched when the panel is shown, when Add to notes is pressed, or 2.5 s after the paper opens (as the Agents drawer is). It stays out of the first load and is on the HEAVY list.
- The chunk imports neither `lib/meanings` nor `lib/copy`: the reader hands them in. Imported from the notebook chunk too, the bundler cut them (and one icon) out of the first load's chunks into chunks of their own, which cost the first load 0.5 KB of compression for nothing.
- The Notes tab's pop-overs (the page picker, the menus, the quote picker) are the notebook's own small `NbPop`, not the app's `Pop` (a new layer edge); the menus wear the reader's own `.desk-menu` styles.
- An empty text block is always its text field, so writing starts at once; the cursor goes into the empty page's block when the person opens the Notes tab (a click on the tab, Open, In notes), never when the reader loads, so the focus is not taken from the paper.
- **H** makes the line a heading (`# `) or plain again; a block's headings are drawn as `h3` to `h5`, under the page's own heading (a hidden `h2` with the page's title).
- A block's ⋯ menu has Delete (with Undo); moving is the handle's (drag, or Alt+↑ and Alt+↓, said through `announce()`).
- **The pop-up**: "Add note" (phase 1) gives way to **Add to notes**, or **In notes ✓** for a highlight that is quoted, as section 4's table has it. A highlight's own note is still written in its Highlights card, and the note icon on the page still opens it. After Add to notes on a new selection the selection is let go (it is a highlight now).
- The panel has three tabs now (Notes, Highlights, References). In the new reader they are a little tighter than the two of phase 1, and the row scrolls sideways rather than cut the last one off: at 834 px in Split it was cut off.
- The formatting toolbar sits in a row of its own that is the sticky box, so the quote picker (a pop-over in it) is never clipped: a pop-over inside a scrolling box is cut off by it, and the first build's picker was (Playwright still counted it as visible; the suite now checks the point at its middle).
- The toast has a second action (`more`), for **Open** beside Undo on a phone in Paper view.
- **Drag from the paper**: a selection (of new text or of a highlight's text) carries `{noteId: null, page, quote}`; on the drop the reader finds the highlight it already is (`planNewHighlight`) or makes one in the meaning chosen. Dropping works on a wide screen only.
- Markdown: the page's one ⋯ menu copies or downloads this page or all pages: `notes-<paper>-<date>.md`, or `notes-<paper>-<page>-<date>.md` for one page.
- The paper styles are drawn with `--border-strong` at 38 %: `--border` at 35 % could not be seen at all in Light.
- Two windows that each show the starter page "Notes" (nothing written yet) and both start writing make two pages called Notes; once a page exists on the server, both windows show it and merge as planned.
- In the Markdown out, a text block's headings sit under the page's: `#` becomes `###` (the paper's title is `#`, each page `##`).


**The owner's review of the pictures (17 Nov): a calmer Notes tab.** The first build looked like a form; it should feel like a good notes app. What changed (the block editors' pattern, as in Tiptap, BlockNote and Notion: a block's controls show on hover or focus):
- **A block's handle and its one ⋯** are hidden until the block is pointed at, holds the focus, or (with no hover, on touch) was tapped. Opacity only, so nothing moves; the keyboard reaches them, and the focus shows them.
- **One header.** The page's title is written in place (large, serif, as wide as its words), with the list of pages (▾, and "1/2" when there are more) right after it; then **+ Page**, the save line (small and muted: "Saved"), and the page's **one ⋯ menu**: Rename, Move up, Move down, Paper (Plain, Ruled, Dotted, Grid), Markdown (copy or download this page or all pages), Delete page. The second ⋯ and the second title are gone.
- **One place to write at the end.** The page always ends on a line that says "Write here…": its last block when that is an empty text block, or a line that becomes one at the first key. "+ Text" is gone, and an empty block between two others is a blank line, not a second "Write here". The empty page's one line says what to do ("Write here, or select text in the paper and choose Add to notes."). A new page is Plain (it always was; the Grid in the pictures was the picture script's).
- **The toolbar** is attached to the top of the page, lighter (no box, muted icons), in two groups that never split: H B I U Mark, then the two lists and Quote. A narrow panel puts the second group on a row of its own, nothing is cut off, and on touch every button is 44 px.
- **One rhythm for the paper.** `--nb-line` is the height of a line of text. A text block has no vertical padding or border, and its headings, paragraphs and list items are each one line high, so its lines sit on the rules; the rules are drawn in each text block from its own top (and in the empty end of the page), so a quote card of another height never puts the blocks after it out of step. Dotted and Grid keep the same step, and Grid is lighter (`--border-strong` at 20 %). The paper scrolls with the text.
- **The Highlights head** (the new reader only; today's reader keeps its own): By page | By colour and **one Export menu** (Copy as Markdown, Download), so it is one row at every width. The count is said to a screen reader only, since the Highlights tab already shows it (with it, the head wrapped in Split at 1280 px). The colour chips leave out a meaning with no highlight (they were disabled noise) and stay on **one line**: when it does not fit, it scrolls sideways with a fade on the side that has more, so no chip sits alone on a second line. The Export menu is made in DeskBits.tsx and handed to the list (`exportMenu`), which keeps the layer rule's allowlist as it was.

**Weight.** The `notebook` chunk is 13.6 KB gzip of its 16 KB: the Markdown parser, the editor, the store and its merge. Its stylesheet (`notebook.css`, about 2.7 KB) comes with the reader's own chunk (Desk, 16.6 of 28 KB), because the Notes tab is the panel's first tab: the page is styled before the notebook chunk arrives, and nothing is added to the first load. (Putting the Markdown export behind a dynamic import was tried and made the chunk 0.9 KB larger, the loader and the module's wrapping costing more than the 0.3 KB it moved.) The first load grew by 0.09 KB gzip (233.07 to 233.16 KB), all of it the sign-out question about notes not yet sent (`lib/auth.ts`, `lib/offline.ts`), which has to be in the first load because signing out is. There is no new dependency, and the layer allowlists did not grow.

**Privacy.** The words of 19.7 are on `reader-privacy`, one commit on top of this branch. `legal-match.test.ts` refuses a flag's sentence on the page while the flag is off, but 19.7 puts the words on the page before READER leaves `off`. So the READER row of `FLAG_SENTENCES` is pinned at `off`, `dark` and `on`: the page must say it at every position. That is the safe way round, since the page may say more is kept than is, never less. The row can drop `off` once READER is `on` in production.

## 21. Phase 2.5: the owner's live test (18 Nov 2026)

On 18 Nov the owner tested phases 1 and 2 live (READER `dark`, their account only) and asked for the changes below. They asked us to follow the mock's Notes design (`Paper Reader.dc.html`, and the screenshot they attached) closely, in our own colours and tokens, and they put user experience first. This section is the plan, and it overrides sections 7 and 19 where they differ.

### 21.1 What changes

| # | The owner said | Design |
|---|---|---|
| 1 | "dono side khali" (the Notes view wastes both sides) | In the **Notes view** on a wide screen, the page fills the panel: 32 px side padding, no reading-width cap. Text lines run the full width; long words wrap (`overflow-wrap: anywhere`). In Split, and on a phone, the page fills the panel as now. |
| 2 | Pages as in the mock | **Page tabs** sit in a row under the panel tabs, replacing the "Title 1/2 ▾" picker. Each tab shows its paper icon (plain, ruled, dotted or graph) and its title ("Untitled page" when empty). The active tab is raised. The row scrolls sideways with an edge fade. It is `role="tablist"`: ← and → move, Enter opens. **"+ Page"** at the end of the row opens a **"Choose paper for the new page"** panel with four visual cards (Plain, Ruled, Dotted, Graph), each drawn in our tokens. Choosing one creates the page with that paper and focuses its title. Esc and × close the panel. |
| 3 | Delete icon on the page | The page header row holds the title field ("Untitled page" placeholder), a **trash button** ("Delete this page", with a toast and Undo), the quiet "Saved" status and **Export ▾**. The ⋯ menu keeps only Move left, Move right and Rename. |
| 4 | Download as PDF and Word | **Export ▾** offers: this page or all pages, then **PDF**, **Word (.docx)** or **Markdown**. PDF reuses the lazy `@cantoo/pdf-lib` chunk, with Noto Sans Devanagari embedded only when the text has Devanagari (subset, lazy). Word reuses the litscan DOCX writer (lazy). Captures and sketches go in as PNG images. Each is a lazy chunk with a budget line. |
| 5 | Draw in notes | A **Sketch block**: a drawing area inside the page, 240 px high by default and resizable by dragging its bottom edge or with Alt+↑/↓. It uses the reader's ink engine (perfect-freehand): pen, highlighter, eraser and the colours and sizes of the Draw toolbar, plus undo. Strokes are stored in the block as fractions of its box. The toolbar button is **Draw**. |
| 6 | Capture, as in the mock | **Capture** is in both toolbars: the paper's tool segment (C) and the Notes toolbar. On a wide screen in Notes view it switches to Split first; on a phone it switches to Paper and comes back to Notes after the capture. Drag a rectangle on the page; release to add a **capture block**. It is stored as `{page, x, y, w, h}` (fractions) and drawn from the open PDF at the device's pixel ratio, so no picture is stored or uploaded (section 6). The block shows the image, a **caption** field ("Add a caption…"), "p. N ↗", and a size toggle (S, M, Full). Keyboard: Enter on a page starts a frame; the arrows move it, Shift+arrows resize it, Enter captures. |
| 7 | Scrollbar | The dark, thick native scrollbar is replaced by **thin scrollbars in our tokens** in every scroll area of the reader (`scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent`, and `::-webkit-scrollbar` 8 px with a rounded `--border-strong` thumb), in Light, Dark and Read. No area has two scrollbars. |
| 8 | Chips touch the line and the edge | The Highlights chip row gets `padding-block: 10px` and `padding-inline: 12px`, so it no longer touches the divider above or the panel edge. The edge fade starts after the padding, so the first chip is never faded. The row's height comes from its content. |
| 9 | Image (in the mock) | **Not built yet.** An uploaded picture would be a new kind of stored data and needs a privacy sentence that the owner reads first ("pictures you add to your note pages"). Asked; built only after a yes. |

Kept from phase 2:
- Blocks are a column, not placed freely.
- Markdown storage.
- The hover/focus reveal of block controls.
- The two-row toolbar on narrow panels. With Text, Quote, Capture and Draw the groups are: H B I U Mark | lists | Text Quote Capture Draw | paper swatches. Groups wrap and never split.

### 21.2 Data

`packages/shared/src/notebook.ts` makes `capture` live and adds `sketch`:
- `capture {id, page, x, y, w, h, caption ≤ 500, size: "s"|"m"|"full"}`
- `sketch {id, height 120..800, strokes ≤ 400, points ≤ 20,000 per block}`

Each stroke is the ink shape the reader already uses. The server checks every number.

The size limits change:
- **Per page:** 48 KB → 128 KB of JSON. One sketch can be tens of KB.
- **Per paper:** 1 MB → 2 MB.

D1 rows stay far below its limits. The migration is unchanged: no schema change, because blocks are JSON.

### 21.3 Privacy

Covered by the words already live (draft-18), with no change:
- **Captures:** a place on the page, not a picture.
- **Sketches:** strokes, the same kind of data as the "drawings (pen and highlighter strokes)" row.

Needs new words, so it waits for the owner:
- **Image upload.**

### 21.4 Tests

**Unit tests:**
- block checks for `capture` and `sketch`, with limits;
- the capture rectangle maths (rotated and cropped pages, as in `annotated.mjs`);
- the sketch stroke scaling;
- the PDF and DOCX builders, checked structurally (page count, images present, Devanagari text extractable).

**`e2e/notebook.mjs`:**
- page tabs (keyboard and scroll);
- the paper picker;
- delete with Undo;
- Notes view full width at 1440 px (the page box within 40 px of the panel);
- Capture by pointer and by keyboard, from Notes view and on a phone;
- a sketch drawn, then reloaded;
- Export PDF, DOCX and Markdown files downloaded and opened;
- thin scrollbars (computed `scrollbar-width`);
- the chip row's padding;
- axe in the three themes;
- no sideways scroll.

**Pictures `p25-*`, for the owner:**
- desktop Notes view;
- page tabs and the picker;
- a capture block;
- a sketch block;
- the Export menu;
- phone;
- the three themes.

### 21.5 Order

1. Scrollbars and chip spacing (small, visible at once).
2. Notes view full width; page tabs and the paper picker; header with delete and Export.
3. Capture (paper side, then the block).
4. Sketch block.
5. PDF and DOCX export.
6. Suites, pictures, and section 22 "as built".

It ships behind READER, which stays `dark` (owner only), as phases 1 and 2 do.

## 22. Phase 2.5 as built (18 Nov 2026)

Built on the branch `reader-p25`, from main 531121b, in the order of 21.5, behind READER (still `dark`, the owner only). Where the build differs from section 21, or adds to it:

**Scrollbars and chips (21.1, 7 and 8).** Every scroll area of the desk and the Agents drawer takes `scrollbar-width: thin` with an `--border-strong` thumb on a clear track (8 px `::-webkit-scrollbar` rules for browsers that need them). The chip row has 10 px above and below and 12 px at its sides; its fade starts after the padding.

**Pages (21.1, 1 to 3).**
- In the Notes view on a wide screen the page fills the panel, 32 px at its sides (the Highlights and References keep their reading width).
- The page tabs are a `tablist` named Pages: ← → Home End move the focus, Enter or a click opens. Each tab shows a small swatch of its paper. The row scrolls with an edge fade and keeps the open tab in sight.
- "+ Page" opens "Choose paper for the new page": four cards (Plain, Ruled, Dotted, Graph) drawn in our tokens; Esc and × close it.
- The header: the title, the trash ("Delete this page", toast with Undo), the save line, Export ▾, and ⋯ (Move left, Move right, Rename).
- The paper of the open page is chosen in the toolbar, whose groups are H B I U Mark | the lists | Text Quote Capture Draw | the four papers. On a phone that is up to four rows; a group never splits. **Text** adds a text block after the one being written in.
- "Grid" is called **Graph** on screen, as in the mock; the stored value stays `grid`.

**Capture (21.1, 6).**
- C, or Capture in either toolbar. Notes view → Split first; a phone → Paper, then back to Notes after the capture (a toast with Open when it started on Paper).
- The layer over each page (`CaptureLayer`) is handed to the viewer as a slot, so the viewer's chunk does not carry it. Keyboard: Enter places a frame (the middle half of the page), the arrows move it, Shift and the arrows resize it, Enter captures, Esc lets it go, a second Esc puts the tool down.
- While the tool is in hand the page cannot be scrolled by touch (the layer takes the drag); the page arrows and the page number still move through the paper. **Owner to decide** whether a long press should start a frame instead, leaving the page to scroll.
- A capture block is drawn from the open paper (`lib/capture.ts`, the page's viewport with its rotation and crop box) at the screen's pixels, again when its width changes by more than 24 px. Where the paper is not open it says so instead of a picture.
- New blocks (a capture, a sketch, Add to notes) go in through one store method, `insertBlock`, with Undo.

**Sketch (21.1, 5).**
- `NbSketch.tsx` is a small lazy chunk (2.2 KB), fetched only when a page holds a sketch. It has pen, highlighter and eraser, the reader's pen and highlighter colours, three sizes, and Undo (the button, or Ctrl+Z inside it). It draws on the same white paper as the pages, dimmed as they are.
- Strokes are kept as **fractions of the sketch's width on both axes** (the paper's ink convention), so a drawing keeps its shape at any width. Fractions of width and height (as 21.2 says) would stretch it 3× sideways between Split and the Notes view. A sketch shown wider than it was drawn grows taller instead of being cut off.
- The height is set by dragging the bottom edge, or with Alt+↑ and Alt+↓ on it (40 px a step).
- The ink outlines moved to `lib/ink-path.ts`, shared by the paper's drawing, the annotated PDF and the sketches. That took `annotated-pdf → InkLayer` off the layer rule's allowlist. It also seems to have moved `InkLayer` back into the PDF reader chunk, which grew 55.7 → 59.9 KB of its 66.

**Export (21.1, 4).** Export ▾: This page | All pages, then PDF, Word (.docx), Markdown, and Copy as Markdown.
- `lib/notes-export.ts` is a lazy chunk (3.0 KB) that lays the pages out in the browser.
- **PDF:**
  - Uses the lazy pdf-lib chunk already in the app.
  - Helvetica for Latin. Devanagari is in Noto Sans Devanagari, the WOFF the app already ships, embedded as a subset with its text map, and only when the text has Devanagari.
  - That needs **fontkit, a new dependency: `@cantoo/fontkit` 2.0.12** (MIT, the font library made for `@cantoo/pdf-lib`). It is 151 KB gzip, fetched only for such a PDF, with a budget line.
  - pdf-lib places glyphs by their advance only. Substitutions (conjuncts) come out right, but a vowel sign may sit a little off where the font would shift it. **Owner to judge** the Hindi output.
  - A letter Helvetica cannot draw (outside Western European and Devanagari) is written as "?".
- **Word:** the shared writer gains a picture block (an inline drawing pointing at its PNG in word/media, sized to the page width).
- Captures (drawn from the open paper) and sketches go in as PNG pictures, 900 px wide.

**Data (21.2).** As planned: `capture {page, x, y, w, h, caption ≤ 500, size}` and `sketch {height 120..800, strokes ≤ 400, points ≤ 20,000}`. A sketch point's y may pass 1 (the sketch is taller than wide), up to 800/120. Limits: 128 KB a page, 2 MB a paper.

**Weight.**

| Chunk | Size (gzip) | Note |
|---|---|---|
| First load | 233.3 of 250 KB | unchanged |
| Desk | 19.3 of 28 KB | |
| Notebook | 14.8 of 16 KB | the sketch is a chunk of its own |
| Sketch | 2.2 of 4 KB | new line |
| Notes export | 3.0 of 5 KB | new line |
| fontkit | 151 of 160 KB | new line |
| PDF reader | 59.9 of 66 KB | |

**Not built (21.1, 9).** Image upload, which waits for the owner's yes and its privacy words.

### 22.1 The owner's answers (18 Nov) and what was built for them

- **fontkit**: yes, as built (lazy, only for Devanagari).
- **Capture on a phone**: a **long press** starts a frame (450 ms, the finger held within 10 px); until then the page scrolls as ever. Once a frame has started, the page's touch moves are stopped so the finger draws it. The keyboard way is unchanged.
- **Pictures in the notes** (`image` blocks):
  - **In the browser:** Image in the toolbar takes a JPEG, PNG or WebP. The picture is turned upright, made at most 2000 px a side and re-encoded, which removes its camera data (EXIF). A PNG stays a PNG within 2 MB; anything else becomes a JPEG, made smaller until it fits.
  - **On the server:** the file goes to `PUT /documents/:id/notebook/images/:blockId`, guarded like the paper's own file. The server reads the kind from the first bytes, and checks 2 MB, 2000 px a side, no EXIF and 200 pictures a paper. It keeps the file in R2 at `docs/<user>/<paper>/notebook/<block>` and serves it only to the owner (`nosniff`, a sandboxing CSP).
  - **Deleting:** a file no block holds (taken out of a page, a page deleted, an upload never saved) is noted in `doc_notebook_image_gone` (migration 0029). It is deleted ten minutes later, on the next write in that paper, so Undo can bring it back. The paper's deletion, and so the account's, deletes them all at once.
  - **Data export:** lists each picture (paper, block, kind, size, address).
  - **PDF and Word exports:** put the picture in.
  - **Privacy:** the words are on the "Papers you upload" row ("…and pictures you add to your note pages"), at draft-19, with a "Latest change" line.
- **"+" (Add a page)**: an icon right after the last tab, as a browser's new tab button. It is the tab's height (44 px on touch), and stays in sight at the end of a row that scrolls.
- **Toolbar**:
  - **One basic row:** B, I, Mark, bullet list | Quote, Capture, Draw, Image | **More** (Aa, `aria-expanded`). On a narrow panel the words beside the icons go and the row scrolls sideways with a fade; it never wraps.
  - **Behind More**, on a second row: H, U, numbered list, Text and the four papers.
  - The paper is also in the page's ⋯ menu again.

## 23. Notes polish (19 Nov 2026)

The owner tested the Notes tab live and found the comments, the page tabs and the header crowded. Built on `notes-polish` (from main bdc81d3), in our tokens only, Light, Dark and Read, desktop and phone. Reader and sharing behaviour and every role are as before.

**Page header and tabs.**
- The rows are: the panel's tabs → the page tabs → the page header → the toolbar. The separate "Comments (N)" row is gone: Comments is a speech-bubble button in the page header (`aria-label` "Comments, 1 open", with a count badge), beside Export and ⋯. The header's three buttons share one quiet style (no border, muted until pointed at, 32 px; 44 px on touch).
- A new page is named **Page N** (N = the page count plus one, or the next number no page shows); the title stays editable. A page with no title, or with the old default "Untitled page", *shows* "Page N" by its place (tabs, header, All pages, exports, the read-only notes); nothing stored is rewritten (`pageLabel`, `nextPageName` in `packages/shared/src/notebook-names.ts`).
- Tabs are at most 11 rem wide (ellipsis, the full name as tooltip), 36 px high; a tab not open is muted and lighter.
- When the tabs overflow, the edge fade stays and an **All pages** button (chevron, before "+") lists every page, the open one ticked, with ↑ ↓ to move each (and a search field above 8 pages).
- **Reorder:** drag a tab (a mouse after 5 px; a finger after a 450 ms long press, then the row stops scrolling under it), shown lifted with an accent line where it will go; on a focused tab Ctrl+Shift+← → (or Alt+Shift); Move left and right in ⋯; ↑ ↓ in All pages. Each move is said ("Page moved to place 2 of 5") and saved by the existing PATCH of the page's place, through a new store method `movePageTo(id, index)` (the midpoint between the new neighbours, as `movePage` did).

**Comments.**
- **List:** the head is ← Notes, the title "Comments", and one segmented control with counts (Open 1 · Resolved 0 · All 1), which moves under the title on a narrow panel. Each thread is one card (the whole card a button): the meaning's dot, "p. N" (or the page of notes), the quote on one line; the first comment on two; then avatars, author, relative time, "2 replies" and a Resolved badge. An empty filter says so, with how to add a comment.
- **Thread:** the head is ← Comments, the state ("Open" or "Resolved") as a quiet chip, and Resolve (✓) or Reopen at the end for the owner and Editors. The thing it hangs on is a quote card (a bar in the meaning's colour, the words muted and italic, two lines at most, "p. N ↗" to go there), no longer a heading. Each comment: a 28 px avatar, the name and "you", a relative time (Just now, 5 min ago, Yesterday, 12 Nov; the full date as the tooltip of its `<time>`), the words. Edit and Delete are in a ⋯ menu shown on hover or focus (always on touch); Delete asks in place ("Delete this comment?", the focus on Cancel), since a deleted comment cannot be brought back. A thread is one card, as in a document's comments: the first comment is its head; the replies hang under it, indented on a thin vertical line, with 22 px avatars, oldest first and newest last; a thread of more than 3 replies shows its last two and folds the rest behind "Show N earlier replies" (`aria-expanded`).
- **The box:** "Add a comment…" at the bottom of the panel while the thing has no thread; once it has one, "Reply…" at the end of that thread (the cursor goes with it). One line that grows to about six, a light border, and the one primary button, plainly off (neutral, not a faded accent) while empty. With a keyboard (a fine pointer) **Enter sends and Shift+Enter makes a new line** (`enterkeyhint="send"`; a letter still being composed by an IME is never sent), Ctrl/Cmd+Enter sends too, Esc clears; the hint "Enter to send · Shift+Enter for a new line" shows only then. On a touch screen (`pointer: coarse`) Enter makes a new line and the button sends. A thing that already has a thread gets replies, not a second thread (threads made before keep their own Reply and Resolve). The panel's body ends with the Agents button's room, so it never covers the last Reply.

**Weight (no limit raised).** The page tabs are a chunk of their own (`NbTabs.tsx`, 3.1 of 4 KB, a new line), fetched as soon as the Notebook's arrives; it imports nothing from the notebook or the first load (the pop-over, the names and three icons are handed in or drawn), or Vite's preload list for it named the whole app. The comments moved out of the shared paper chunk into their own (`Comments.tsx` with `comments.css`, 7.4 of 7.5 KB, a new line), fetched when they are first opened; the shared paper chunk (read-only notes) is 3.0 of 5.5 KB and the Share dialog 5.7 of 6.5 KB (it shared the comments' styles before). The Notebook chunk went **down**, 14.1 → 13.9 of 16 KB; the first load is unchanged (241,313 bytes of script gzip against 241,320 before: a lucide icon used in a lazy chunk would have become a preloaded chunk of its own, so the tick is drawn inline). Desk 22.6 of 28 KB.
