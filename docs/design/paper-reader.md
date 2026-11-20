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

## 24. Phase 3 as built: the agents (19 Nov 2026)

Built on the branch `reader-p3`, from main bdc81d3, behind READER (still `dark`, the owner only). Capture was built in phase 2.5 (section 22); Related and the Export dialog are phase 4. Where the build differs from sections 9, 13 and 16, or adds to them:

**The server (`apps/api/src/docs/agents.ts`).** Every agent is a short system prompt on the private `qa` path through the model port: the existing profiles `docsAsk` and `docsAskStream` (no new profile, so `profiles.table.json` did not change), with labels of their own in the AI log (`doc_explain`, `doc_critique`, `doc_notes`). No new model, no new outside service.
- **Explain**: `POST /documents/:id/ask` with `mode: "explain"`, a `selection` (at most 600 characters, `MAX_SELECTION_CHARS`) and its `page`, or a named idea in `question`, or both (the idea is then the reader's question about the selection). The selection must be in the paper: its words are checked against the passages of its page and the pages next to it (`selectionInPaper`: as a quote is checked, for four words or more; as words in a row for fewer); otherwise 400 "That passage is not in this paper". The passages read start from the selection: the passage it is in (the best match on its page) and the ones on either side, then the best matches, six in all, in reading order (`explainPassages`). It runs the questions' own pipeline (`answerQuestionStream` and `answerQuestion` gained an optional `plan`: the system prompt, the passages, the label), so the quote check is the same one, a mark with no checked quote is removed, and an answer with no checked citation is not called verified.
- **Critique**: `mode: "critique"`, with an optional focus in `question`. It reads up to ten passages: the paper's opening and a few for each kind of weak point (or those matching the focus). The model answers JSON `{points: [{kind, text, excerpt, quote}]}`; `verifyCritique` keeps a point only when its kind is one of `thin_evidence`, `missing_baseline`, `overclaim`, `limitation_stated`, `limitation_unstated`, it has words, and its quote is found in the passage it names (or, as a model sometimes numbers wrong, in another passage read). Everything else is **dropped on the server** and only counted (`dropped`); at most eight points, a quote once. Streamed, a critique sends the stages and the pages, never text (a point is shown only once its quote is checked), and ends with a `critique` event, a new end event of the ask stream (`stream-shape.ts`; the chat's tool reducer and the open-access reducer ignore it).
- **Note-taker**: `POST /documents/:id/ask-highlights` with `mode: "notes"` and the legend. It reads only the highlights and their notes. The model returns bullets `{text, from, quote}` (`from`: the numbers of the highlights a bullet comes from). The **draft is made by `buildNotesDraft` in shared**, not by the model: a heading for each meaning that has something (Key idea, Method, Question, Result, or the reader's own names), each bullet under the meaning of its first highlight, ending with the pages of its highlights ("(p. 3, 4)", written by the builder, so a page is never lost or invented); a bullet marked as a quote is a quote block linked to its highlight; a bullet that names no highlight is dropped; a highlight no bullet used comes in as a quote, so every highlight's page is in the draft. Nothing is kept: the page shows the draft.
- Explain and Critique are **never kept in the question history**, whoever asks (the plan's "doc_qa for history" applies to Ask). The owner may want them kept; a critique would then need a shape of its own in `doc_qa`.
- **Counters**: `reader_agent_explain` (the answer's endings, as `doc_ask`), `reader_agent_critique` (`critique_points`, `critique_all_dropped`, `critique_none`) and `reader_agent_notes` (`notes_drafted`, `notes_empty`): new features on the outcomes table, with their /admin labels in `vocab/outcomes.ts`; no old name changed. Ask stays `doc_ask`.
- **Roles** (paper-share.md): Explain and Critique need Commenter (the route's existing gate), on the asker's own allowance; the Note-taker needs Editor or the owner (its own check once the body is read, in the gate's words). The share role table test gained the three modes for its eight kinds of person.

**The notes.** The plan's `answer` block kind (never accepted by the server, so no stored data) became **`agent`**: `{agent: "ask" | "explain" | "critique", ask (what it was asked: one line, at most 600), md (the answer as Markdown, at most 8,000, every citation written as its page, "(p. 3, 4)", never a mark), pages (each once, pages of the paper), at}`, checked like every kind; every kind is accepted now (`NOTEBOOK_KINDS_NOW`). It is drawn with a small header "✦ Explain · p. 3, 4", what it was asked, the answer, and "p. N ↗" for each page, in the read-only shared view too, and in the Markdown, Word and PDF exports with the same header and question. The Note-taker's page is made of ordinary text and quote blocks.

**The drawer.**
- The agent chips are a radio group (`Agent`; the arrows move the choice): Ask · Explain · Critique · Note-taker; a Commenter has no Note-taker. One line under them says what the chosen agent does. Each agent's view is made the first time it is chosen, and kept for the visit.
- **Explain** from the pop-up opens the drawer on Explain with the selection as its chip ("SELECTION · p. 1 “…” ×") and the question box ready, with the focus in it; **nothing is asked until the person presses Send** (the owner's choice of 20 Nov; the first build explained at once). Send alone explains the selection; words typed first are a question about it; with the chip taken away, they name an idea.
- **Critique** shows each point with its kind, the label "A reading of the paper, not a fact", its words and its passage (a button to the paper, "p. N"), and a line when points were left out ("1 point was left out: its quote was not found in the paper.").
- **Note-taker** shows the draft ("Draft · not saved yet") with **Add as a new page** (a new page at the end, through the notebook store, with a toast to undo or open it) and **Discard**.
- **"+ Add to notes"** is on every answer of Ask, Explain and Critique for the owner and Editors; it becomes "In notes", and the toast has Undo (and Open when the notes are not in sight).
- A paper with no index: Explain, Critique and the Note-taker say "This paper has no index yet, so … cannot read it." with Index again (asked of the Note-taker too, although it reads only highlights).
- Each view announces its stages and its result in a polite live region, never the words as they arrive. Under a conversation the suggestions are one line that scrolls sideways.
- The palette (Ctrl+K) lists each agent.
- The drawer is `overflow: clip` now: with `hidden`, focus or `scrollIntoView` could still scroll it, and its head slid out of sight.

**Weight.**

| Chunk | Before (bdc81d3) | After |
|---|---|---|
| First load, scripts | 235.7 of 250 KB | 235.8 |
| First load, style | 23.7 of 26 KB | 23.7 |
| Agents drawer | 2.3 of 20 KB | 9.2 (the views and the agents' client) |
| Desk | 22.1 of 28 KB | 23.8, then 24.2 with the review's fixes (the handlers, the agent block's and the field's styles) |
| Notebook | 14.1 of 16 KB | 15.2, then 15.3 with the review's fixes (the agent block, the styled field, the picture's handle) |
| Notes export | 3.2 of 5 KB | 3.3 |

No new chunk, no new dependency; the agents' client (`lib/agents-api.ts`) is imported only by the drawer. The layer allowlists did not grow. The Notebook chunk has 0.7 KB left of its budget.

**Privacy** (section 13). Sending to the AI service is covered by the words already there ("the relevant text is sent to an AI model run by Cloudflare (Workers AI)"; "When you ask about your highlights, those highlights and the notes you wrote on them are sent in the same way"). Keeping an answer in the notes now has words of its own, approved by the owner on 20 Nov: the row "Papers you upload" reads "…(including pages of notes you write in the reader, with the passages you quote into them, pictures you add to your note pages and answers from the reader's agents you keep there)…", with a "Latest change (19 November 2026)" line, and `PRIVACY_VERSION` is 2026-11-draft-21 (draft-20 retired). The READER row of `legal-match.test.ts` holds the new sentence.

**The owner's review (20 Nov) and what changed for it.**
- **Underline showed its marks** ("ddd<u>dddd</u>" on screen). The cause: a text block is a plain text field while it is written in, so the toolbar's `<u>…</u>` showed as typed until the field was left (and an empty `<u></u>` with the cursor outside it stayed text for good). Now underline has **one syntax, `++words++`**, written by the toolbar and Ctrl+U, read by the renderer (an `<u>` element, from tokens, never an HTML string) and by the read-only view; `<u>…</u>`, which notes written before hold, is still read as underline and taken away by the toolbar. While a block with marks is written in, its source is drawn **under the field, styled** (`mdSourceRuns` in shared, `SourceMirror` in NbBlocks.tsx): the field's own letters are clear, every character keeps its place (so the cursor and the selection fall where they are drawn), the marks are faint and the words they wrap are underlined, marked or bold (bold by a shadow, which takes no width) at once. The Word export writes a real underline (`<w:u>`), the PDF draws a line under the words, the Markdown export keeps `++`.
- **Pictures can be resized**: a handle at the picture's corner (a slider for a screen reader): drag it with a pointer or a finger, or focus it and use ← and → (5 %, Shift 20 %, Home and End); S, M and Full beside the words, as a capture has. The shape is kept (the height follows). The width is kept in the block as `width`, a share of the page from 0.2 to 1 (three places; a picture with none is as wide as the page, as before), checked by the server, and used by the read-only view and the exports (Word and PDF at that share of the text's width; the Markdown says it). Captures keep S, M and Full.
- **Explain waits for Send** (above). Keeping Explain and Critique out of the question history is approved as built.

**Tests.** Shared: the agent block's checks and Markdown, `answerMarkdown`, `critiqueMarkdown`, the draft builder (`reader-agents.test.ts`), the counters' labels. API: `docs/agents.test.ts` (the selection check, the passages, Explain's check, a critique's filtering, the stream's events, the Note-taker), the notebook's agent block, the share role table's modes. Eval: `eval/reader-agents.eval.ts` replays recorded replies for five Explain, three Critique and two Note-taker cases on a made-up paper (`data/reader-agents-cases.json`): every citation and every point has a checked quote, no invented quote survives, the Note-taker keeps every page. The recording was **seeded from hand-written replies** (`READER_AGENTS_SEED=1`), not recorded live: the gates are about our checks, which must hold whatever the model writes; delete it and run `EVAL_MODE=record` to record Workers AI. Integration (`reader-on`): `scripts/agents-e2e.mjs`. Browser (`reader-on`): `e2e/agents.mjs` (with `AGENTS_SHOTS=<folder>` it takes the owner's pictures); `reader.mjs` follows Explain; `share.mjs` (`share-on`) checks a Commenter's agents.

## 25. Ink on note pages (plan, 19 Nov 2026; approved 20 Nov)

The owner, after the phase 2.5 sketch block: *"I don't want a separate drawing box; I want to draw on the notes page itself, just like on the research paper"*, and the PDF and Word exports must keep good formatting. This section is a plan only. Nothing here is built. It is written against `reader-p3` (5e8507f) and `notes-polish` (bdc81d3). Both branches have a different section 23, so the owner picks which one keeps the number 23 when they merge.

### 25.1 The problem in one paragraph

A notes page is a column of blocks whose typed text **reflows**: the same paragraph is about 900 px wide in the Notes view, about 450 px in Split and about 340 px on a phone, and in the PDF (Helvetica, 11 pt, 483 pt wide) and in Word (Calibri, Word's own layout) its lines break in other places again. Ink is **positional**. A circle drawn around the word "baseline" at 900 px is around some other word at 340 px if it is kept as an x and y on the page. The paper does not have this problem, because a PDF page never reflows (its ink is kept as fractions of the page width, section 18). The sketch block avoids it by being a box with no text in it. So drawing *on* the notes means choosing what a stroke is attached to.

### 25.2 How other apps solve it (research, with sources)

| App | Model | What happens to ink when text moves or the width changes | Lesson for us |
|---|---|---|---|
| **Microsoft OneNote** | A free canvas. Typed text sits in note containers; ink is a separate floating object on the page. "Insert Space" pushes everything down; "Ink to Text" turns handwriting into typed text. | Ink is **not** anchored to paragraphs. Microsoft's own Q&A says OneNote "does not lock ink and text together as a single grouped layout element, so even small text reflow can make ink look shifted". Users see annotations shift between iPad and PC. The only grouping is ink selected together with an image or a PDF printout. | A canvas with floating ink is the most common design, and its best-known complaint is ours: ink drifts off the text. Don't copy it. The "Insert Space" idea is worth borrowing. Sources: [MS Q&A, iPad vs PC shift](https://learn.microsoft.com/en-us/answers/questions/5778657/facing-an-issue-in-microsoft-onenote-between-ipad), [Insider blog: ink grouped with printouts and images](https://techcommunity.microsoft.com/blog/microsoft365insiderblog/more-improvements-to-ink-annotations-on-pdf-printouts-and-images-in-onenote/4225463), [Ink to Text pen](https://insider.microsoft365.com/blog/introducing-the-ink-to-text-pen-tool-in-word-onenote-and-powerpoint-for-windows), [WPS note on floating ink (third party)](https://www.wps.com/office-quick-solution/office-app-problems/how-to-fix-onenote-ipad-annotations-shifting-on-pc/) |
| **Samsung Notes** | A page with typed text and handwriting together. | Same failure. On the Samsung community, users report that typed text moves while handwriting stays put ("not anchored to the page"). Images have "move with text"; handwriting does not. A moderator forwarded it as a feature request. | Users notice this, and it makes notes "not usable between devices". Sources: [Samsung community thread](https://eu.community.samsung.com/t5/mobile-apps-services/samsung-notes-problem-penwrite-doesn-t-stay-aligned-with-the/td-p/5960919), [Samsung Notes handwriting help](https://www.samsung.com/us/support/answer/ANS10003634) |
| **GoodNotes / Notability** | **Fixed-size paper pages** (A4, Letter). Typed text lives in text boxes placed on the page. Nothing reflows; a narrow screen zooms out. | Ink is always exactly where it was drawn, because the page never changes width. The cost shows on the iPhone: Notability's Text-Only mode gives "narrower note width with reflowed text" and **hides "drawings, images, shapes, and media"**. Once text reflows, they give up on ink. | A fixed page gives perfect ink and perfect exports, but text is tiny on a phone, and once you reflow you have to hide the ink. Sources: [Notability iPhone app, Text-Only mode](https://support.gingerlabs.com/hc/en-us/articles/10213191545754-Notability-iPhone-App), [Notability on the App Store](https://apps.apple.com/app/id360593530), [GoodNotes typing-mode feedback](https://feedback.goodnotes.com/forums/191274-customer-suggestions-for-goodnotes/suggestions/46473409-more-settings-for-new-feature-of-typing-mode) |
| **reMarkable (3.x, typed text)** | A page of typed paragraphs that you write on with the stylus. | Annotations are **anchored to the typed text**. Their help says highlights, underlines and circles "anchor to typed text", and the release notes say handwriting "anchors intelligently to typed text, ensuring that scribbled and typed notes stay connected even as you move text up and down". | The closest match to what the owner wants: ink attached to words, not to page coordinates. Sources: [Combine handwriting and typing](https://remarkable.com/using-remarkable/first-steps/how-to-combine-handwriting-and-typing-on-remarkable), [5 ways to work with typed text](https://remarkable.com/using-remarkable/first-steps/5-ways-to-work-with-typed-text-on-remarkable), [Release 3.11](https://blog.remarkable.com/blog/remarkable-software-release-3-11) |
| **Nebo / MyScript Notes** | Two formats. A **responsive Document**, where handwriting is recognised and **reflows** like text (rotate or split the screen "without worrying about readability"), and separate fixed-size pages and freeform canvases. | Ink reflows because Nebo understands it (it recognises the words). Diagrams and drawings are kept as separate objects inside the flow. | Reflowing the ink itself needs handwriting recognition. That is a big model, out of scope, and our ink is often drawings rather than words. Treating a diagram as an object inside the flow does apply to us (25.4, the `space` block). Source: [MyScript Notes on the App Store](https://apps.apple.com/us/app/-/id1119601770) |
| **Apple Notes** | Typed text with **inline drawings**: a drawing area that sits between lines of text and grows. "Markup" is a separate drawing tool on pictures and PDFs. A third option is a sketch attachment. | Drawings never sit over text. They are blocks in the flow (so they move with it), and Apple notes you "can't change how large they appear". | The model we already have (the sketch block). The owner asked to move past it. Sources: [Draw with Notes (Apple)](https://support.apple.com/en-us/HT209498), [Add drawings and handwriting in Notes on iPad](https://support.apple.com/en-ca/guide/ipad/aside/ipada87a6078/ipados), [inline drawing (Mac guide)](https://support.apple.com/en-la/guide/notes/aside/apde7648093a/4.6/mac/10.14) |
| **Microsoft Word / Pages** | The Draw tab inks over the document **in Print Layout only** (a fixed page). Ink becomes a drawing object anchored to a paragraph (moves with the paragraph, not with the words), or goes in a Drawing Canvas, a box in the text. | Ink moves with the paragraph it is anchored to. Inside the paragraph it stays at a fixed offset, so editing the paragraph's text can leave it off its word. | Word itself only inks over a fixed page. Our DOCX has to live with "anchored to a paragraph, offset from its top" (25.8). Sources: [Draw and write with ink in Office](https://support.microsoft.com/en-us/Office/draw-and-write-with-ink-in-office), [anchor class, OOXML](https://learn.microsoft.com/en-us/previous-versions/office/developer/office-2010/cc846345(v=office.14)) |
| **Notion, Craft** | No ink. Drawings are embedded blocks (images, Excalidraw or whiteboard embeds). | n/a | They chose not to solve it. |
| **tldraw / Excalidraw** | Infinite canvases with absolute coordinates. tldraw's **bindings** attach one shape to another with a normalised anchor point on the target (the arrow keeps its place on the shape when the shape moves or resizes); DOM-backed shapes measure themselves with a ResizeObserver. | Ink is attached to *shapes*, and the anchor is stored relative to the target. | Our anchor is the same idea, with "a character in a block" as the target. Sources: [tldraw bindings](https://tldraw.dev/sdk-features/bindings), [arrow binding props (normalised anchor)](https://tldraw.dev/reference/tlschema/TLArrowBindingProps), [DOM-based shape size](https://tldraw.dev/examples/size-from-dom) |
| **Research** | Microsoft patent US8250463, "Recognizing, anchoring and reflowing digital ink annotations": classify each annotation (underline, circle, margin note), anchor it to the text context under it, and re-render it when the layout changes. | Ink stays on its words through reflow. | The method we adopt, without the recogniser: the anchor is the character under the stroke's centre. Source: [US8250463B2](https://patents.google.com/patent/US8250463) |
| **W3C Web Annotation** | A **TextPositionSelector** (character offsets) backed by a **TextQuoteSelector** (the exact text with a little before and after), so that an anchor can be found again after the text changes. | n/a | We keep both an offset and a short quote for each anchor (25.5). Source: [Web Annotation Data Model, selectors](https://www.w3.org/TR/annotation-model/#selectors) |

**Web input** (the paper's InkLayer already does most of this, so the notes reuse it):
- **Pointer events** carry `pointerType` (`pen`, `touch`, `mouse`), `pressure`, tilt and `buttons`. The stylus eraser end is `buttons & 32`, which the paper already reads. [W3C Pointer Events](https://www.w3.org/TR/pointerevents/)
- **`getCoalescedEvents()`** returns the pen samples the browser merged between frames, for smooth curves. The paper uses it (InkLayer.tsx:289). An old Firefox bug returned an empty list for pens, so we keep the fallback to the event itself. `getPredictedEvents()` can cut perceived lag, and is optional. [MDN](https://developer.mozilla.org/docs/Web/API/PointerEvent/getCoalescedEvents), [Mozilla bug 1511231](https://bugzilla.mozilla.org/show_bug.cgi?id=1511231), [W3C TPAC 2023 demo](https://www.w3.org/2023/Talks/TPAC/pointer-events)
- **`touch-action`** decides at pointer-down whether the browser pans. The paper's rule (`ink.css`) is `pan-y pinch-zoom` when finger drawing is off, so a finger scrolls while a stylus and a mouse draw, and `none` when finger drawing is on. [Chrome: touch-action](https://github.com/GoogleChrome/developer.chrome.com/blob/main/site/en/blog/aligning-input-events/index.md)
- **Palm rejection** on the web is ours to do. The paper ignores touches for 4 s after a pen was seen (`PEN_SEEN_MS`) and treats a second finger as a pinch. The notes keep exactly that rule.
- **`caretPositionFromPoint`** (standard; in Chrome since 128, and in Firefox) and **`caretRangeFromPoint`** (WebKit) turn a point into a text node and an offset. **`Range.getClientRects()`** turns an offset back into a box. These two calls are the whole anchoring engine.

**DOCX can hold ink in three ways:**
1. **An inline picture** (`wp:inline`). This is what the writer does today (`docx.ts` `imageXml`). The ink can only be *between* paragraphs, never over the text.
2. **A floating picture anchored to a paragraph** (`wp:anchor` with `wp:positionH relativeFrom="column"`, `wp:positionV relativeFrom="paragraph"`, `wp:wrapNone`, `behindDoc="0"`, `allowOverlap="1"`). It is drawn over the text, moves with its paragraph when the reader edits the file, and the text stays real text. [Anchor](https://learn.microsoft.com/en-us/previous-versions/office/developer/office-2010/cc846345(v=office.14)), [WrapNone](https://msdn.microsoft.com/en-us/library/cc881960(v=office.14)), [VerticalPosition](https://technet.microsoft.com/en-au/library/cc802260(v=office.14)), [docx4java example with relativeFrom="paragraph"](https://www.docx4java.org/forums/post10645.html), [dxpdf notes on floating images](https://docs.rs/crate/dxpdf/latest/source/docs/floating-images.md)
3. **Real Office ink.** An InkML part (`application/inkml+xml`, root `ink` in the `http://www.w3.org/2003/InkML` namespace) referenced by a `contentPart`, inside `mc:AlternateContent` with a picture fallback. Word shows it as editable ink. LibreOffice and Google Docs show the fallback. It is specified for Office ([MS-ODRAWXML 2.1.4 Ink Content Part](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/096dacae-0d2c-4861-bc4d-c8e4c6405ad3), [1.3.2 Content Parts and Ink](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/bf6a6c33-f5d5-4b7d-a4ef-26dcd3c627e6), [InkML](https://www.w3.org/2002/mmi/2010/InkML/inkml.pdf)), but Word's own `w14` use of it is thinly documented. **Later, not now** (25.15).

**PDF:** our PDF is laid out by our own code (`notes-export.ts`), so we know where every word lands. `@cantoo/pdf-lib` 2.11.1 (already in the app) has `page.drawSvgPath(d, {x, y, scale, color, opacity, borderColor, borderOpacity, borderWidth, borderLineCap, blendMode})`. Ink can be drawn as **vector paths over real text**: sharp at any zoom, small, and the text stays selectable and searchable.

### 25.3 Options we weighed

| | A. Fixed-width page (GoodNotes) | B. Block anchor: x as a fraction of the width, y in px from the block's top (the owner's example) | **C. Word anchor (reMarkable, patent, Web Annotation)**, with a box anchor for pictures and a `space` block for room to draw |
|---|---|---|---|
| Ink stays on its word through reflow | Yes (nothing reflows) | **No**: inside a long paragraph a circle drifts by whole lines, and x fractions slide off words | **Yes**: each stroke moves with the character under its centre |
| Text on a phone | Tiny (the page zooms out) or sideways scrolling | Good | Good |
| Block delete or move | Leaves ink behind | Ink goes with the block | Ink goes with the block |
| PDF | Exact (render the fixed page) | Approximate (our PDF wraps differently) | Exact for words (we know every word's place) |
| Word | Exact only as a picture, so the text is not editable | Approximate | Close, with the font chosen so that our line breaks match Word's (25.8) |
| Cost | Rebuild the Notes page as a paper page | Small | Medium: an anchoring engine (about 400 lines) and tests |
| Fits today's notebook (blocks, Markdown, merge by block id) | No: it is a different product | Yes | Yes |

**Recommendation: C.** It is the only one that keeps "this circle is around *that* word" true in Split, in the Notes view, on a phone, in the PDF and in Word. A doesn't fit a reflowing, phone-first notebook (Notability shows that the moment you reflow you have to hide the ink). B is a cheaper C that fails at exactly the case people notice (paragraphs longer than three lines).

### 25.4 The design (C), in plain words

1. **One ink layer over the whole notes page**, as on the paper. In Draw mode you can draw anywhere: over text, in the margins, between blocks and below the last block.
2. **Each stroke is attached when the pen lifts**, to what lies under the **centre of its bounding box**:
   - over the text of a **text, quote or agent block**: to the **character** nearest that centre (`caretPositionFromPoint`). The stroke is stored as offsets **in em** from that character's box. A circle around a word, an underline under it, a tick beside it and a margin note level with it all follow that word wherever the line breaks.
   - over a **capture, image, (old) sketch or space block**: to the **block's box**, as fractions of the block's width on both axes (the paper's and the sketch's convention). These blocks scale with the width, so their ink scales with them.
   - in the **left or right margin**: to the nearest character on that line (the caret call already clamps to the line's end or start). A margin note follows its line.
   - in the **gap between two blocks**: to the nearest character of whichever block is closer.
   - **below the last block**: a **`space` block** is made there (25.5). It is blank room that grows while you draw and is trimmed to the ink, plus 1 em, when you leave Draw mode. This is OneNote's "Insert Space" and Apple's inline drawing, without a box or a border.
   - **Why the centre and not the start point** (the owner's example): a circle starts beside its word, and an arrow starts in the margin. The centre is where the meaning is. The start point stays as the tie-breaker when the centre is in empty space.
3. **A stroke keeps its size in em** (1 em is the page's body text size, 16 px on screen today and 11 pt in the PDF). Ink grows and shrinks with the text, never with the panel. A circle stays a circle.
4. **"Insert space"** (in More, and as a key in Draw mode): drag down between two blocks to open a `space` block there. This is how you make room for a diagram in the middle of a page.

**What happens when…**

| Situation | Behaviour |
|---|---|
| **The width changes** (Split, Notes view, phone, rotating a tablet) | Text reflows. Every text-anchored stroke is re-placed at its character's new box. Box-anchored strokes scale with their block. A stroke wider than the column is moved left until it fits, never scaled (scaling would take it off its word). On a phone, ink in a `space` block scales down with the width, as a sketch does today. |
| **A stroke spans several lines or blocks** (a long arrow, a bracket down a paragraph) | It moves as one piece with its anchor, so after a reflow its far end may point at a neighbouring line. This is the known limit of single-anchor designs (reMarkable has it too). A two-anchor stroke (both ends attached, the middle stretched) is listed in 25.15 as later. |
| **The text under it is edited** | While a text block is open for typing (a textarea, with the Markdown visible), its ink is dimmed to 25 % at its last place. On blur, each anchor offset is mapped through the edit (a common-prefix and common-suffix diff of the block's plain text, before and after). A stroke on a word you deleted moves to where that word was. Its 16-character quote (25.5) is checked, and the nearest match within ±200 characters is used when the offset drifted (another window's edit). |
| **A block is deleted** | Its ink is deleted with it and comes back with Undo. A whole page's Undo brings back its ink as well. If another window deleted the block, its strokes are never dropped silently: they are re-anchored to the end of the block before it (or the page's start) and the save line says *Some drawing moved: its text was deleted in another window*. |
| **A block is moved** (drag, Alt+↑/↓) | Its ink goes with it. |
| **Very long pages** (200 blocks, 2,000 strokes) | Each block draws its own ink in an absolutely placed SVG inside its `li` (`overflow: visible`), so ink scrolls with its block and costs nothing off screen. Blocks far from the view use `content-visibility: auto` (as the chat list does, shell.css:512), and their anchors are measured only when they come near the view (IntersectionObserver). A width change re-measures what is in view in one `requestAnimationFrame`. About 1,000 range measurements take a few milliseconds. |
| **Fonts arrive late** | The positions are re-measured after `document.fonts.ready` and on every ResizeObserver change of the column. |
| **Dark and Read themes** | The notes page follows the theme. The paper's "ink" pen colour (near-black) would vanish on Dark, so on screen the pen colour `ink` is drawn as `var(--text)`, the other pen colours use a lighter tint in Dark (one map, tested for 3:1 contrast against the page in each theme), and the highlighter draws at 0.35 opacity in Dark and 0.45 in Light and Read. Exports always use the light palette on white. *(To check while building: the notes page background in each theme.)* |

### 25.5 Data shape (`packages/shared/src/notebook-ink.ts`, imports nothing)

Ink is kept **in a row of its own per page**, not in the page's `blocks`:
- A page holds at most 128 KB of JSON, which is only about 60 handwritten strokes.
- Typing and drawing then never conflict: each has its own `rev`, and two windows can type and draw at once.
- A text save stays small.

```ts
/** Where a stroke is attached. */
export type NoteInkAnchor =
  /** a character of a text, quote or agent block: `at` is its offset in the block's plain text (mdPlain, below); `q` is up to 16 characters around it, to find it again */
  | { k: "text"; b: string; at: number; q: string }
  /** the box of a capture, image, sketch or space block: points are fractions of the block's width (x 10,000) */
  | { k: "box"; b: string };

export type NoteStroke = {
  id: string;                       // [A-Za-z0-9_-]{1,40}
  tool: "pen" | "highlighter";      // the paper's two freehand tools; shapes, text boxes and stickies are later (25.15)
  color: string;                    // PEN_COLORS / HIGHLIGHTER_COLORS ids, as on the paper
  w: number;                        // width: hundredths of an em (text anchor) or 1/10,000 of the width (box anchor), integer
  a: NoteInkAnchor;
  pts: number[];                    // integers: dx, dy, pressure x 100, ... (dx, dy in hundredths of an em from the anchor character's top-left, or 1/10,000 of the block width)
};

export type NotebookInk = { pageId: string; strokes: NoteStroke[]; rev: number; updatedAt: number };

/** A blank room in the flow, for drawing: its height as a fraction of the page width x 10,000 (so its ink keeps its shape, as a sketch's does). */
export type SpaceBlock = { id: string; kind: "space"; h: number };   // a new NotebookBlock kind
```

- **`mdPlain(md)`** is a new pure function in `notebook-md.ts`: the text of the parsed tokens, joined as the renderer puts them in the DOM (list markers are CSS, so they are not in it). A test renders each kind of block and holds `mdPlain(md) === element.textContent`. The anchor's `at` is an offset in it, so the screen, the PDF writer and the DOCX writer all read anchors the same way.
- **Integers** keep the JSON small: about 12 bytes a point. Strokes go through the paper's `simplify()` (RDP, 0.02 em) on pen-up.

**Limits** (`NOTE_INK_LIMITS`), with the paper's numbers for comparison:

| | Notes, per page | Paper (INK_LIMITS) |
|---|---|---|
| strokes | 2,000 | 4,000 per paper |
| points per stroke | 2,000 | 2,000 |
| points per page | 40,000 | 200,000 per paper |
| bytes of JSON | 512 KB per page; **4 MB for all of a paper's note ink** | 1.4 MB per paper |
| `dx` and `dy` (text anchor) | ±6,000 and ±4,000 (±60 em and ±40 em) | n/a |
| `x` and `y` (box anchor) | −500..10,500 and −500..40,000 | `maxY` 4 |
| `at` and `q` | 0..8,000 (the text limit) and ≤ 16 characters | n/a |
| `space.h` | 300..40,000 (a quarter of the width is 2,500), and at least 48 px on screen | n/a |

The `sketch*` limits stay for old sketches. One D1 row is at most 2 MB, so 512 KB a page is safe.

**Server** (`apps/api/src/docs/notebook.ts`, migration `00NN_doc_notebook_ink.sql`):

```sql
CREATE TABLE doc_notebook_ink (
  doc_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  strokes TEXT NOT NULL DEFAULT '[]',
  rev INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (doc_id, page_id),
  FOREIGN KEY (doc_id, page_id) REFERENCES doc_notebook_pages (doc_id, id) ON DELETE CASCADE
);
```

- `GET /documents/:id/notebook` returns `ink: NotebookInk[]` beside `pages`, so one request loads both. A shared viewer gets it exactly when they get the pages.
- `PUT /documents/:id/notebook/pages/:pageId/ink` takes `{rev, strokes}`. It answers 200 `{ink}`; 409 `{ink}` with the server's copy when `rev` is stale; 413 over a limit; 400 for a bad stroke; 404 when the page is gone.
- The body is read with `readJson(c, MAX_NOTE_INK_BODY)` (512 KB plus 4 KB). The same doors as the page routes apply: same-origin, signed in, owner or Editor (paper-share.md), READER gate, and route-guard table rows.
- **`checkNoteInk(raw)`** in shared rebuilds every stroke from its known fields, checks every number above, and refuses anything else (400 or 413, never dropped silently), as `checkNotebookBlocks` does. The paper's 4 MB total is one `SUM(length(strokes))` over the paper's ink rows before the write.
- The server does **not** check that `a.b` is a block of the page. The page and its ink are saved apart, and a block made in the same second may not be stored yet. The page re-anchors orphans (25.4).
- **The merge on 409** is by stroke id, the paper's `mergeItems` rule: the server's strokes, plus the ones this window added, minus the ones it erased.
- `/account/export` gains `notebookInk: [{docId, pageId, strokes, updatedAt}]`. Deleting a page, the paper or the account removes the rows through the cascade, and the account-deletion test checks it.
- `checkNotebookBlocks` accepts `space` (a new kind; old clients never send it).

### 25.6 Interface

**Toolbar (notes).** **Draw** stops adding a sketch block. It becomes a **toggle** (`aria-pressed`), with the key **D** when focus is not in a text field, as on the paper.
- When Draw is on, the formatting row is **replaced** by the ink row, so there is only one toolbar line: **Pen · Highlighter · Eraser | colours (the tool's palette) | sizes S M L XL | Undo · Redo | Finger (switch) | Insert space | Done**.
- These are the paper's tools, colours, sizes and keys (P, H, E; Ctrl+Z and Ctrl+Shift+Z), so nothing new needs learning.
- **Esc**, **Done**, **D** again, or **V** returns to typing.

**Modes are obvious.**
- In Draw mode the page gets a thin accent outline and a small floating pill, *"Drawing · Esc to type"*.
- The cursor is a crosshair. Text selection is off (`user-select: none`), and block handles and ⋯ menus are hidden.
- A click never opens a text block for editing.
- Out of Draw mode the ink is shown and nothing on the page reacts to the pen (`pointer-events: none` on the ink), so typing works exactly as today.

**Input** is the paper's, moved into one shared module (`lib/ink-input.ts`) that both InkLayer and the notes use, so there is one copy of the rules:
- coalesced events, and pressure from a pen only (0.5 otherwise);
- the stylus eraser end erases whatever tool is on;
- a mouse draws with its left button;
- palm rejection: touches are ignored for 4 s after a pen was seen, and a second finger is a pinch;
- **finger drawing off by default**: one finger scrolls (`touch-action: pan-y pinch-zoom`) while a stylus draws, which is what the owner asked for ("stylus may draw while finger scrolls");
- with **Finger** on, one finger draws (`touch-action: none`) and a two-finger drag scrolls the page (we call `scrollBy`, as GoodNotes does).

The **eraser** removes whole strokes it touches (the paper's rule), with Undo. **Undo and Redo** keep 200 steps (the paper's `HISTORY_MAX`). A step is a set of added or removed strokes, plus a block delete's strokes.

**Phone.**
- Draw is in the basic row (it already is).
- In Draw mode the ink row is one row of 44 px buttons that scrolls sideways with a fade, the 2.5 rule. The colour dots open as a small popover so the row fits 390 px.
- The page keeps its width, and text and ink reflow as described in 25.4.
- With no stylus, a person must turn on Finger. The first finger touch in Draw mode with Finger off shows the paper's toast, *"Turn on Finger to draw with your finger"*, with a button that turns it on.

**Shared, read-only view** (Viewer, Commenter, signed-out link): the ink is drawn exactly as for the owner (the same layout engine). There is no Draw button, no layer that catches the pointer, and no Insert space. An **Editor** draws as the owner does, and the stroke-id merge handles two people at once.

**Show drawings.** "More" gets *Show drawings* (on by default, kept on the device), for reading the text alone. This is also the high-contrast way out.

### 25.7 PDF export, in detail (`lib/notes-export.ts`)

1. **Find where each anchor's word lands.** The writer already breaks lines word by word.
   - `runsOf` and `write()` learn to carry each word's **plain-text offset** (a cursor over `mdPlain`, advanced as tokens emit their text).
   - For every anchor offset of the block, the writer records `{pdfPage, x, yTop, size}` of that character's line as it draws it. A character in the middle of a word gets the word's x plus the width of its leading letters.
2. **Draw the ink after the text, as vectors.**
   - Each stroke's points become page points: `x = anchorX + dx × E`, `y = anchorTop + dy × E`, with `E` = 11 pt (the body size in the PDF) per em.
   - The paper's `penPath` (perfect-freehand outline) and `markerPath` make the SVG path, in points.
   - `page.drawSvgPath(d, {x: 0, y: H, color, opacity: 1})` draws a pen stroke. A highlighter is `{borderColor, borderWidth: w × E, borderOpacity: 0.45, borderLineCap: Round, blendMode: Multiply}`.
   - The text is drawn first and stays real text, so it can be selected, searched and copied. The ink is a vector on top, sharp at any zoom.
3. **Box-anchored ink** (capture, image, sketch, space): its points are multiplied by the drawn width of the block's picture or room. A `space` block becomes vertical room of `h × width` in the flow.
4. **Page breaks.**
   - Before the writer places a line that carries an anchor, it calls `need(lead + inkBelow)`, where `inkBelow` is how far that line's strokes reach below it. A line moves to the next page *with* its ink rather than cutting the ink.
   - Ink above a line can reach into the top margin, which is fine.
   - A stroke taller than a page (rare) is drawn on its anchor's page and cut there.
5. **Width.**
   - A text-anchored stroke that would cross the right edge is moved left to fit, as on screen.
   - Ink in the margins of the screen page has 56 pt of margin in the PDF. Ink still beyond that is moved in.
6. **Old sketch blocks** export as today (a PNG picture). Turned into page ink (25.9), they become vectors too.
7. **Size:** vectors make ink a few KB a page, and no PNG is made for page ink.

### 25.8 Word export, in detail (`packages/shared/src/docx.ts` + `notes-export.ts`)

Word lays out its own text, so we cannot know exactly where a word lands. The plan makes Word's line breaks predictable and attaches ink to the **paragraph** with an offset predicted by our own line-breaker.

1. **One font whose widths we have.** When a notes export has ink, the body font of that document is **Arial** instead of Calibri.
   - Arial has Helvetica's widths, which pdf-lib's standard font gives us.
   - Liberation Sans (LibreOffice) and Arial (Google Docs) have the same widths.
   - So Word, LibreOffice, Google Docs and our PDF writer break lines in the same places.
   - Line spacing is **exact** (`w:spacing w:line="308" w:lineRule="exact"`, 15.4 pt, the PDF's 1.4 × 11 pt). The text width is set to the PDF's 483 pt through the section margins, and the paragraph spacing to the PDF's gaps.
   - Exports without ink keep Calibri, unchanged. *(Open question O-5: Arial for every notes export, so all exports look the same.)*
2. **Predict the lines.** The PDF writer's line-breaker runs once more, without drawing, at Word's width, and gives each anchor its **line index inside its paragraph** and its x.
3. **One floating picture per paragraph that has ink.**
   - The strokes anchored in one Markdown paragraph (or list item, heading or quote) are drawn into **one transparent PNG**. The PNG uses the light palette, at 2× (about 192 dpi) and with the highlighter at 0.45 alpha.
   - Its box is the strokes' bounding box.
   - It is placed with `wp:anchor` inside the first run of that paragraph:

```xml
<w:r><w:drawing>
  <wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251660000" behindDoc="0"
             locked="0" layoutInCell="1" allowOverlap="1">
    <wp:simplePos x="0" y="0"/>
    <wp:positionH relativeFrom="column"><wp:posOffset>{x EMU}</wp:posOffset></wp:positionH>
    <wp:positionV relativeFrom="paragraph"><wp:posOffset>{lineIndex × 15.4 pt + dy, EMU}</wp:posOffset></wp:positionV>
    <wp:extent cx="…" cy="…"/><wp:effectExtent l="0" t="0" r="0" b="0"/>
    <wp:wrapNone/>
    <wp:docPr id="…" name="Drawing …" descr="Drawing on the text: 3 strokes"/>
    <wp:cNvGraphicFramePr/>
    <a:graphic>… pic:pic with r:embed to word/media/ink-….png …</a:graphic>
  </wp:anchor>
</w:drawing></w:r>
```

   - The child order is the schema's (simplePos, positionH, positionV, extent, effectExtent, wrap, docPr, cNvGraphicFramePr, graphic).
   - `wrapNone` with `behindDoc="0"` draws it **in front of the text without moving any text**. The text stays real, editable and searchable.
   - A negative `posOffset` is allowed, for ink above the paragraph's first line.
   - `relativeHeight` increases per picture, so later ink is on top.
4. **Box-anchored ink:**
   - a `space` block becomes an empty paragraph of exact height `h × width` holding its ink picture inline (a space is a picture in Word);
   - ink over a capture or image is **composited into that picture's PNG** (one inline picture, as today);
   - an old sketch is a PNG, as today.
5. **What survives editing in Word:** the ink moves with its paragraph (Word's own anchor behaviour). After heavy edits *inside* the paragraph it can sit beside the word it was on. That is Word's model, and the same as ink drawn in Word itself.
6. **Devanagari:** we have no widths for Nirmala UI, so paragraphs with Devanagari are predicted with Noto Sans Devanagari's widths. They may land a line off. A test page shows it, and the owner judges it with the PDF's Hindi (22, O-6).
7. **Real Office ink (InkML)** is left for later (25.15). It would make strokes editable in Word, but only Word reads it, and its `w14` markup is thinly documented.

### 25.9 Markdown export and the sketch blocks

**Markdown** cannot hold ink over text.
- `notebookMarkdown` writes one line after a block that has ink: `*(Drawn on: 3 strokes)*`, as it already writes `*A sketch (n strokes)*`. A `space` block writes `*(A drawing: n strokes)*`.
- Copy as Markdown does the same.
- When the phase-4 zip export exists, each inked block can add a PNG of the block (text plus ink) as `![Drawing over the block above](images/…png)`. That waits for phase 4.

**Existing sketch blocks:**
- **Kept as they are.** `sketch` stays a valid kind on the server forever. Old pages render, edit and export exactly as today. `NbSketch` stays its own lazy chunk, fetched only when a page has one.
- **Not made any more.** The Draw button toggles Draw mode. No sketch is made by the toolbar or the palette.
- **"Turn into page drawing"** in a sketch's ⋯ menu replaces it with a `space` block of the same height-to-width ratio, plus its strokes as box-anchored page ink. It is **exact**, because both use fractions of the width, and Undo reverses it. The white box and its border go.
- An automatic conversion of every sketch is not proposed. The owner can ask for it after seeing a converted page (O-3).

### 25.10 Accessibility

- Drawing is optional. Everything else (typing, blocks, quotes, captures, export) works without it, and with the keyboard as today.
- The ink SVGs are `aria-hidden`. A block that has ink gets *", has a drawing (3 strokes)"* in its accessible description, and a `space` block is a `role="img"` named *"A drawing, 5 strokes"*.
- A block's ⋯ menu gets **Remove drawing on this block** (with Undo), so a keyboard user can clear ink they cannot draw.
- Draw mode can be entered and left with the keyboard (D, Esc). Draw is announced (*"Drawing on. Use a pen, mouse or finger. Esc to type."*), and the ink row is a `role="toolbar"` with radios, as the sketch bar is.
- **Show drawings** off hides all ink, for anyone who finds it noise.
- `forced-colors: active`: ink is drawn with `CanvasText` (the highlighter with `Highlight` at 0.4), so it stays visible.
- axe runs on a page with ink in the three themes at 1280 and 390 px.

### 25.11 Weight

The Notebook chunk is at 15.2 of 16 KB (section 23).
- The notebook chunk gains only the Draw toggle, the `space` block view and a lazy import, about 0.6 KB.
- Everything else is a new lazy chunk, **`nb-ink`**, fetched when a page has ink or Draw is pressed: the layer, the anchoring engine, the ink row and the input module. Its budget is **9 KB gzip**, and it shares `lib/ink-path` and perfect-freehand with the PDF reader chunk (Vite splits the common part).
- If the 0.6 KB does not fit in the 0.8 KB left, the notebook line goes to 17 KB with the owner's yes (O-7).
- **Notes export** grows about 2 KB (anchor positions, vector ink, the anchored picture).
- **No new dependency.** The first load does not change.

### 25.12 Privacy

- Strokes are covered by the live words: *"drawings (pen and highlighter strokes)"* on the "Papers you upload" row. Pages of notes are covered by *"pages of notes you write in the reader"*.
- An anchor's 16-character quote is a copy of the person's own note text, kept with it.
- Ink is never sent to any model. The Note-taker reads highlights only, and Ask, Explain and Critique read the paper.
- Shared people see the ink as they see the notebook (paper-share.md: "read the paper, highlights and notebook").
- **No new words and no new privacy version are expected.** The owner confirms that "notebook" in the sharing text includes drawings on it (O-8).

### 25.13 Tests

| Level | What |
|---|---|
| **shared unit** | `checkNoteInk`: every limit, both anchor kinds, palettes, integers, the 4 MB total helper, 413 vs 400. `space` in `checkNotebookBlocks`. `mdPlain` for every token kind. **The remap**: an offset through insert-before, insert-after, delete-around and replace, and the quote search finding a drifted anchor. `simplify` on the new units. |
| **web unit** | The anchoring engine with a fake layout. Centre-point choice: a circle anchors to the inner word, an underline to the word above it, a margin note to its line, a stroke below the last block makes a `space`. Re-placement after the width changes. A stroke wider than the column is moved left, never scaled. Block delete removes ink and Undo brings it back. An orphan is re-anchored with the notice. The 409 merge (added, erased, both). The input module's palm rule and finger switch, as the paper's tests now (moved, not duplicated). |
| **DOM equality** | For each block kind, rendered in the test DOM: `mdPlain(md) === li.textContent`. |
| **API unit** | `PUT …/ink`: create, replace, stale `rev` gets 409, 404 for a gone page, 413 per page and per paper, 400 for a bad stroke, another user gets 404, an Editor may write, a Viewer may not (the share role table), READER off gives 404. The cascade on page, paper and account delete. The export carries the ink. |
| **route-guard table** | The new route with its guards. |
| **export unit** | PDF: a page with a circled word at three widths gives ink in the same place relative to that word (read back with pdf.js: the word's box contains the stroke's centre); the text is extractable; no PNG for page ink; a line with ink moves to the next page whole. DOCX: the XML has `wp:anchor` with `relativeFrom="paragraph"`, `wrapNone`, `behindDoc="0"`, in schema order; the predicted line index for a 5-line paragraph at Arial widths; Arial only when ink is present. Markdown: the `(Drawn on: n strokes)` line. |
| **integration** (`notebook-e2e.mjs`) | The real Worker: draw (PUT ink), conflict and merge, page delete cascade, `/account/export`. |
| **browser** (`e2e/notebook.mjs`, `reader-on`) | Draw toggle, D, Esc and Done; pen, highlighter and eraser; Undo and Redo. **A circle around a word stays around it**: Notes view to Split to 390 px (the word's box and the stroke's box are measured, and the centre is inside the word), and after a reload. Typing in the block remaps the ink. Delete a block, then Undo. Move a block. Insert space. Turn a sketch into page drawing (identical pixels before and after, within 1 px). Read-only view: ink shown, no Draw. Finger switch: a finger scrolls with Finger off, a synthetic pen draws. Export PDF and DOCX downloaded and opened (pdf.js; DOCX through JSZip structure). axe in three themes. No sideways scroll at 390 px. |
| **manual, for the owner** | The DOCX opened in Word, LibreOffice and Google Docs (one page: circled words, underlines, a margin note, a diagram in a space), with screenshots beside the PDF's. A real stylus (iPad Safari and an Android or Windows pen): palm rejection and finger scroll. *A real phone was not tested in earlier phases (project-reader-and-film), so this one is asked for explicitly.* |
| **budget** | The `nb-ink` line (9 KB), and the notebook and notes-export lines. |

### 25.14 Phases and size (behind READER, as before; one PR, small commits)

| Step | Contents | Size |
|---|---|---|
| **I1. Data** | `notebook-ink.ts` (types, limits, `checkNoteInk`), `mdPlain`, `space` kind, migration, `PUT …/ink`, GET carries ink, export JSON, cascade, API tests, route-guard row | S, about 450 lines with tests |
| **I2. Engine** | `lib/ink-input.ts` (moved out of InkLayer, the paper keeps its behaviour, with its tests moved), the anchoring engine (point to anchor, anchor to box, remap, quote search, orphans), per-block SVG render, `space` block view, read-only render, themes, Show drawings | M/L, about 700 lines |
| **I3. Draw mode** | The toolbar toggle and ink row, modes, eraser, Undo and Redo, Insert space, Finger, phone row, save and merge (`useNotebook` gains the ink row, its IndexedDB queue and 409 merge), a11y | M, about 500 lines |
| **I4. Exports** | PDF vectors and page-break rule, DOCX `wp:anchor` with Arial and exact spacing and the predictor, Markdown line, export tests | M, about 400 lines |
| **I5. Sketch** | "Turn into page drawing", the Draw button no longer makes sketches, before and after screenshots (desktop, tablet and phone × three themes, plus the Word, LibreOffice and Docs views), e2e | S, about 200 lines |

About 2,200 lines with tests: four to five working sessions. The owner sees pictures after I3 (screen) and after I4 (files) before anything merges.

### 25.15 Not now, and why

- **Shapes, lasso move, text boxes and stickies on notes.** The owner asked for pen, highlighter, eraser, colours, sizes and Undo. The anchor model takes them later: a shape is a two-point stroke, and lasso move re-anchors at drop.
- **Two-anchor strokes** (both ends attached, for long arrows and brackets): a later step if single anchors annoy in use.
- **Ink to text** (OneNote, Nebo). It needs handwriting recognition: a model, a cost and privacy words.
- **Real Office ink (InkML `contentPart`)** in the DOCX: editable ink in Word only, a fallback elsewhere, and thin documentation. To revisit if the owner works in Word a lot.
- **A fixed-page "paper" mode** (option A) as a second page kind for people who want GoodNotes-style pages: possible later, since ink on a fixed page is the paper's model already.

### 25.16 Open questions for the owner

- **O-1.** Anchor by the **centre** of a stroke (recommended) or by its **start point** (your example)? The centre keeps circles and arrows on their word.
- **O-2.** Should a stylus draw **even when Draw mode is off** (as in GoodNotes's "Apple Pencil only draws")? Recommended: no for now. A pen tap then edits text as a mouse click does, and Draw stays one clear mode.
- **O-3.** Old sketch blocks: keep them with a "Turn into page drawing" button (recommended), or convert them all automatically?
- **O-4.** Deleting a block deletes its ink (recommended, as reMarkable does), or should the ink stay on the page where it was?
- **O-5.** Word export: Arial (Helvetica widths) **only when a page has ink** (recommended), or for every notes export so that all files look alike?
- **O-6.** Hindi and Devanagari paragraphs with ink may sit a line off in Word. Acceptable with a known note, or should ink on such paragraphs go in as a picture under the paragraph instead?
- **O-7.** The notebook chunk is at 15.2 of 16 KB. Raise its line to 17 KB if the Draw toggle does not fit?
- **O-8.** Privacy: confirm that "notebook" in the sharing text, and "drawings (pen and highlighter strokes)", cover ink on note pages (no new words).
- **O-9.** Markdown: the line `*(Drawn on: 3 strokes)*` after an inked block (recommended), or say nothing?
- **O-10.** Which branch's section 23 keeps the number (reader-p3's "Phase 3 as built" or notes-polish's "Notes polish")? This section is 25 here (24 in the plan as first written).

### 25.17 Owner decisions (20 Nov 2026)
- Approved: build the plan as written.
- O: Hindi (Devanagari) paragraphs in the Word export may place ink a line off — accepted.
- O: the Notebook chunk budget may go from 16 KB to 17 KB — accepted.

### 25.18 As built (20 Nov 2026, branch notes-ink)

Built as planned (I1 to I5), behind READER, with the owner's two decisions (Devanagari in Word may sit a line off; the Notebook line at 17 KB). Where the build differs from the plan, it says so here.

**Data (I1).** `packages/shared/src/notebook-ink.ts` (imports nothing): the types, `NOTE_INK_LIMITS`, `checkNoteInk` (400 or 413, never dropped), `remapOffset`, `anchorQuote`, `resolveAnchor`, `mergeNoteInk`. `mdPlain` in `notebook-md.ts`; the `space` block kind (h 300..40,000) in `notebook.ts`, and Markdown's `*(Drawn on: n strokes)*` and `*(A drawing: n strokes)*` lines in `notebookMarkdown`. Migration **0031_doc_notebook_ink.sql**. `PUT /documents/:id/notebook/pages/:pageId/ink` (`{rev, strokes}`: 200, 409 with the server's ink, 404 when the page is not there, 413, 400), the same door as the page's own PUT (Editor up; a Viewer and a Commenter get 403); `GET .../notebook` answers `{pages, ink}`. A page's DELETE, the paper's deletion (and so the account's) delete the rows explicitly, as well as by the cascade. `/account/export` has `notebookInk` (by page), and `notebook` now names each page's `pageId` so the two can be matched. Route-guard table and share-role table rows added.

**Engine and page (I2, I3).** `lib/note-ink.ts` (pure: anchor, place, erase, remap, orphans, sketch to ink), `lib/note-ink-store.ts` (save per page with a revision, 1.2 s after the last change, IndexedDB `nbink:<paper>` while offline, the 409 merge, Undo and Redo of 200 steps, Delete block's strokes and their Undo, edits and orphans followed), `lib/ink-input.ts` (the paper's palm rule, pressure, eraser end and coalesced points, now used by the paper's InkLayer too), and the `nb-ink` chunk `NbInk.tsx` (the layer, the catcher, the ink row, Turn into page drawing). Differences from the plan:
- **One SVG per page**, over the list of blocks, not one per block; nothing is virtualised (no `content-visibility`, no IntersectionObserver). A page re-places its strokes after each change, a width change (ResizeObserver) and when the fonts arrive; at a few hundred strokes this is a few milliseconds. Per-block layers stay a later step if long pages show it.
- **The point a text anchor measures from** is the character's left edge at the **middle of its line box** (not its top left), so the PDF's and Word's different line heights do not move ink up or down.
- **An edit is carried through as it is typed**, not on blur: every change of a block's text maps its anchors (`remapOffset`, then the quote). While a block is open for typing its strokes wait at their last place at 25 % (as planned).
- **Insert space** puts a quarter of the width of room after the block in the middle of the view (the end, when the page ends in view); there is no drag to size it. In Draw mode the page ends in a room (a dashed line, 30 % of the view) where a stroke makes a space; leaving Draw mode does not trim spaces (a space is never shorter than its ink when made).
- The ink row is one row: **Draw** (pressed: press to leave) · Pen · Highlighter · Eraser | colours (one Colour button on a narrow panel, which opens them in the row) | Fine, Medium, Thick, Very thick | Undo · Redo | Finger | Space | Done. Keys while drawing (they win over the reader's own letters): P, H, E, Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y, and Esc, V or D to leave; D enters from anywhere in the notes outside a text field.
- **Colours on screen** follow the theme (`--nbi-*`, `--nbh-*` in notebook.css): the pen's "ink" is the text's colour; Dark has lighter pens and a highlighter at 0.32; `forced-colors` draws with CanvasText and Highlight. Exports use the paper's palette on white.

**Exports (I4).** PDF: the line-breaker (`makeBreaker` in `lib/notes-export.ts`) gives every piece of a line its plain-text offset; a line that holds an anchored character takes the ink below it to the next page with it; ink is drawn last as vector paths (`drawSvgPath`; the highlighter multiplied at 0.45) over real text, moved left to fit the page, never scaled. Word: with ink, the file is Arial, 56 pt margins and exact lines (1.4 times the size); each paragraph's ink is one transparent PNG (192 dpi) anchored to that paragraph (`wp:anchor`, column and paragraph, `wrapNone`, `behindDoc="0"`, in the schema's order; `DocFloat` in `docx.ts`); a space is a paragraph of its own exact height. Differences: **ink over a picture, a capture, a sketch or a space is a float too** (anchored to the picture's paragraph, by the text's width), not painted into the picture, so the picture stays as it was; a capture that has ink keeps its S or M share of the width in both files (as on screen), one with none is as before. Word's line middle is taken as four fifths down an exact line less a third of the size; checked in Word on this machine (the owner's pictures of 20 Nov): the circles and the highlight fall on their words, and the lines break where ours do. Devanagari is predicted with Helvetica's widths (no Noto metrics in the prediction): such a paragraph may sit a line off in Word, as accepted.

**Sketches (I5).** Draw no longer makes a sketch; old sketches render, edit and export as before. A sketch's ⋯ menu has **Turn into page drawing** (a space of the same shape with the same strokes, one step of Undo; the e2e measures the stroke the same size within 1 px).

**Accessibility.** The ink SVGs are `aria-hidden`; a block with ink says "Has a drawing, n strokes" (visually hidden); a space is `role="img"` "A drawing, n strokes"; the ink row is a `role="toolbar"` with radio groups, a switch for Finger and roving arrows; entering says "Drawing on. Use a pen, mouse or finger. Esc to type." and puts the focus on the row's pressed Draw, leaving puts it back on Draw. The block's menu has **Remove drawing on this block** (with Undo); More has **Show drawings** (kept on the device). 44 px buttons on a touch screen, no layout shift when the row changes (the e2e measures the row's height and the text's place), reduced motion respected.

**Weight.** Notebook chunk 16.3 KB (limit raised to 17 KB, the owner's yes), `nb-ink` 8.7 of 9 KB, notes export 5.3 KB (limit raised from 5 to 6 KB, as 25.11 foresaw), the shared paper chunk 4.7 KB, the reader chunk 25.4 KB, first load 235.8 of 250 KB.

**Tests.** Shared: `notebook-ink.test.ts` (every limit, both anchors, colours, 413 against 400, the space block, Markdown's lines, `mdPlain`, the remap, the quote search, the merge), `docx-ink.test.ts`. API: `docs/notebook.test.ts` (create, replace, 409, 404 for a page not there, 400, 413 a page and 4 MB a paper, another person, cross-origin, READER off, page and paper deletion), the route-guard and share-role tables. Web: `note-ink.test.ts` (a fake monospace layout: a circle stays round its word at three widths, an underline, a margin mark, a new space and a taller one, a box scaled, a wide stroke moved and not scaled, the eraser, edits, orphans, sketch to ink, the palm rule), `note-ink-store.test.ts`, `nb-plain.test.tsx` (`mdPlain` equals the text the page renders, every kind, and the quote's). Integration `notebook-e2e.mjs` (ink section, the export, the cascade on page, paper and account). Browser `e2e/notebook.mjs` part 8 (Draw toggle and row, no layout shift, a circle round a word kept through a reload, an edit above it, Split and a phone; highlighter; eraser, Undo, Redo; a space; Delete block and Undo; Show drawings; PDF read back with pdf.js: vector paths round the word, no picture; Word's anchor and Arial; Markdown; axe in three themes, in and out of Draw mode; Turn into page drawing; a phone: 44 px, colours, a synthetic stylus draws, a finger scrolls and is told how to draw), `NB_ONLY=ink` runs only it; `e2e/share.mjs` (a Viewer sees the ink read only and gets 403 writing it; an Editor draws).

**Not done, or for the owner.** A real stylus on a real tablet and phone (palm, finger scroll) is still to be tried by hand. Per-block layers and lazy measuring (above), two-anchor strokes, InkML, shapes and lasso stay later (25.15). Privacy: no words changed (see the report: a proposed clarification waits for the owner, O-8).
