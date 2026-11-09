# Reader: in-text citations with a card on hover (design, 9 Nov 2026)

The owner asked, with a picture: in My Workspace's reader, the paper's in-text citations ("(Vaswani et al., 2017)", "[12]", "[3-5]",
"Smith and Jones (2019)", "(Smith 2019; Lee 2020)") are found by themselves and highlighted. Hovering one (or focusing it, or
tapping it on a phone) shows a small card:
- the status;
- the title;
- authors, venue and year;
- **Ask about it**, **Save to library** and **Open**;
- **Show in reference list**.

For a verified reference the status is only the word **Verified**, with a small green tick in a small circle.

## What exists already (read before deciding)

- **The reference list.**
  - It is read in the browser when a paper is uploaded or first opened (`apps/web/src/lib/paperinfo.ts`).
  - The parser is `analyzePaper` in `packages/shared/src/paperinfo.ts`. It splits the list four ways: numbered (`splitNumbered`), keyed (`splitKeyed`, e.g. "[ADG16]"), hanging indent, or `splitReferences`.
  - The result is stored with the paper as `PaperInfo.references`, one string per entry, with the marker ("[12]", "12.") cut off.
  - The person can correct the list ("Use this list"). It can also come from Crossref when the PDF's list cannot be read (`referencesSource: "crossref"`).
- **Verification.**
  - `ReferencesPanel` checks every entry against Crossref and OpenAlex (`useVerify`: one request per entry, two at a time, verdicts cached on the server for a day).
  - The panel stays mounted while the paper is open (DocWorkspace keeps all side tabs mounted). So **the whole list is already checked as soon as a paper is opened**, whether or not the References tab is looked at.
- **Privacy.** The page already says: "The references you verify are sent as text to Crossref and OpenAlex to find the record. We keep the verdict (not your text) for up to a day so a repeat is fast."
  - The citation cards send nothing new and nothing to anyone new: they show verdicts of requests the open paper already makes.
  - **No new privacy sentence and no switch for privacy are needed** (see "Privacy" below).
- **The reader** (`PdfViewer.tsx`):
  - pages are drawn when near the view; pdf.js's text layer (one span per text item) is put over each page.
  - Saved highlights are measured from the text layer (`quoteRects`) and drawn in a layer of their own (`.pdfp-marks`, above the text, `pointer-events: none`).
  - The ink layer is above both.
- **Ask, Save, Open.**
  - "Ask this paper" (`openOaAsk(paper)`) works for any paper with a DOI or arXiv number, from its open-access text or abstract.
  - The library saves a `Paper` (`toggleSaved`).

## Decisions

### 1. Finding citations (pure, `packages/shared/src/citations.ts`)

Citations are found in the text of each page **as its text layer is drawn**: the text of its spans joined in order. Each hit keeps its character range, and the range becomes boxes on the page.

Kinds:
- **Numeric in brackets:** "[12]", "[3-5]", "[3–5]", "[1, 4, 7–9]", "[12, p. 5]".
  - Taken only when every number is between 1 and the length of the list (a numbered list is needed: see 2).
  - Never when the bracket holds a decimal or a 0, or follows a letter or digit directly ("a[1]", "x2[3]").
  - Never when it sits after a maths sign ("∈ [0, 1]", "= [2, 3]").
  - Never when the range is backwards or longer than 30.
  - "(12)" in parentheses is **not** taken: equation numbers look the same. This is an open item.
  - Superscript numbers (medicine) are not taken either: the text layer gives no reliable sign that a number is raised.
- **Keyed:** "[ADG16]", "[BMR+20]", only when the list is keyed (`splitKeyed`).
- **Author and year in parentheses:**
  - "(Vaswani et al., 2017)", "(Smith and Jones, 2019a)", "(Smith & Jones 2019; Lee 2020, 2021b)", "(e.g., Smith, 2019, p. 4)", "(see Lee 2020)".
  - Each part between ";" is read on its own, and the prefixes "e.g.", "see", "cf." and "also" are skipped.
- **Narrative:** "Smith (2019)", "Smith and Jones (2019a, b)", "Vaswani et al. (2017)", "Vaswani et al. [2017]".
- **Surnames:**
  - any letter script (Devanagari too): "van der Berg", "de Souza", "O'Neil", "Rodríguez-García";
  - "et al" with or without a dot, and the "et al.," variants;
  - "and", "&" and "और".
- **Only linked author-year hits are shown.** A year in brackets that matches no entry ("(COVID-19, 2020)", "(n = 2019)") is not drawn. A false highlight costs trust; a missed one costs little.

### 2. Linking a citation to its entry

- **Numbers and keys.** The marker is cut from the stored entries, so the reader reads the reference section of the open PDF once:
  - It is read lazily, after the first page is drawn, in idle time.
  - It uses the same `referenceSection` code, plus a new `labelledReferenceEntries` that keeps each entry's label (12, "ADG16") and the page of its first line.
  - The stored list is lined up with what was read by the text of each entry.
  - "[12]" links to the entry whose label is 12, never to "the twelfth entry", because a lost marker would shift every later one.
  - If the stored list does not line up (it was corrected by hand, or came from Crossref), numeric hits are not drawn.
- **Author and year.** The candidates are entries that:
  - carry the year (with its letter when the citation has one: 2019a);
  - carry the first surname as a whole word in their author part (the text before the year or the title).

  Then the following steps run, in order, until one candidate is left:
  1. The surname must be the first author.
  2. The second surname must match ("Smith and Jones").
  3. "et al." needs three or more authors; two names need exactly two.
  4. The year letter must match.

  If more than one candidate is still left, the citation is **not linked**: it is not drawn. A wrong card is worse than none.
- **Comparison** ignores case and diacritics (NFKD, marks removed).

### 3. Verification

- **No second run.** The `useVerify` state moves up from `ReferencesPanel` to `DocWorkspace`, and the References tab and the cards read the same verdicts: no request is ever made twice.
- **The hovered entry goes first.** Opening a card moves its entry to the front of the queue (a new `bump(id)`), so on a long list the card says "Checking…" for a second, not for minutes.
- **Card status:**

  | Verdict | Card shows |
  |---|---|
  | verified | "Verified" with a small green tick in a circle. The tooltip and screen reader say "Verified at Crossref and OpenAlex". |
  | mismatch, not found, could not verify, not a full reference, check failed | The existing labels and the existing rule that a status is always icon plus words, in a quiet tone. |
  | pending | "Checking…" |
  | retracted | A red "Retracted" mark, always, also next to Verified. |

- **Title, authors, venue and year on the card:**
  - from the matched record **only when verified**;
  - otherwise the reference as printed, up to 220 characters. A record that "does not match" is not shown as if it were the reference.
- **The buttons act on a known paper, so they need a verified record:**
  - **Ask about it** needs a DOI or arXiv number;
  - **Save to library** and **Open** (doi.org) need a DOI.
  - For a reference that is not verified, the card shows the reference as printed and **Show in reference list** only.

### 4. The card

- **One card per viewer.** A single Radix Popover, controlled, anchored to the citation in focus by a virtual anchor. Radix places it with flip and shift, keeps 12 px from the edges, puts it below the citation by preference and never over it.
- **The citation itself** is a `<button>` with:
  - `aria-haspopup="dialog"` and `aria-expanded`;
  - a label, e.g. "Citation: Vaswani et al., 2017. Reference 12 of 40."

  It is laid over the text in a layer of its own (as saved highlights are). The highlight under it is a light accent tint with a dotted underline.
- **Opening and closing.**
  - **Mouse.** The card opens after 200 ms on the citation (hover intent). It stays open while the pointer moves from the citation into the card, with a 250 ms grace, and closes 250 ms after the pointer leaves both.
  - **Keyboard.**
    - Tab reaches each citation, and focus shows the card without moving into it.
    - Enter or Space opens it and moves focus to its first button.
    - Escape closes it and gives focus back to the citation.
    - Tab past the last button closes it.
  - **Touch.** A tap opens the card, a tap outside or Escape closes it, and hover is ignored for touch pointers.
  - **Never** while drawing (the citation layer takes no pointer then), and never in the middle of selecting text.
- **The card is a non-modal dialog.** It has role dialog, its title as accessible name, a focus ring, and motion that is cut to a fade when reduced motion is asked for.
- **Show in reference list.**
  - It closes the card and goes to the entry in the paper's own reference section: the page known from step 2, with its first words highlighted (the existing `goTo(page, quote)`).
  - When the page is unknown (a list from Crossref or one corrected by hand), it opens the References tab instead.

### 5. Work and speed

- A page's citations are found once each time its text layer is drawn, which happens when it comes near the view and again after a zoom. The cost is one pass of the parser over the page's text, and one `Range.getClientRects` per hit.
- Pages far from the view are not drawn, so they cost nothing.
- Reading the reference section for labels is one pass over the pages' text, the same work the upload did. It runs in idle time after the first paint, and only once per open paper.
- Nothing new is in the first-load script: the reader is its own chunk already, and the parser lives in that chunk.

### 6. Offline

- The cards work from the text of the PDF, so the highlights and **Show in reference list** work offline.
- Verdicts already received are shown. Others say "Not checked (offline)", and nothing is retried in a loop.
- Ask, Save and Open behave as they do elsewhere offline.

### 7. Language

The reader's controls are in English today (the Hinglish lines are in the prompt box), so the card's words are English, like the rest of the reader.

Citations in Hindi papers are found (Devanagari surnames, "और"), and author-year linking works on any script.

## Privacy

- **No new privacy sentence.** Nothing new leaves the browser:
  - Verification already runs for every entry of an opened paper (DocWorkspace keeps `ReferencesPanel`, and with it `useVerify().start`, mounted).
  - It goes to the places the page names for "the references you verify".
- **The buttons reuse existing paths**, each covered by its own sentence:
  - "Ask about it" opens the existing "Ask this paper" sheet on that paper;
  - "Save to library" is the existing save.
- **No switch.** The cards are a reading aid with nothing to disclose. A person who finds the highlights distracting can turn them off from the reader's toolbar; the choice is kept on the device.

## As built (9 Nov 2026): what changed from the plan, and why

- **The citation's button is the size of its words, not 24 px square.**
  - A 24 px box was tried. On a paper the lines are closer than 24 px, so it covered the citations of the next line: on a phone a tap on "[1]" landed on "[2]".
  - WCAG 2.2's target size (2.5.8) excepts a target in a sentence whose size is set by the line height of the text around it, as for a link in a paragraph.
  - axe cannot see that the buttons are inline (they are laid over the page's text). The browser suite leaves out only the `target-size` results for the citations, and says why. The card's own buttons are 34 px high.
- **The card's actions come from the page as props**, not as imports: the card does not import the library, "Ask this paper", the verifier's labels or icons.
  - Those modules live in the first load. Importing them from the reader's chunk made the bundler split them into chunks of their own, and the first load grew by 3 KB.
  - The card's words are kept in `lib/citeStatus.ts`, and a test holds them equal to the verifier's.
- **The citation code is its own chunk:** `lib/citations.ts` (4.0 KB gzip) and `CitationCard` (3.4 KB script and 1.1 KB style).
  - The reader fetches it in idle time, 600 ms after it opens.
  - The reader chunk is 62.0 KB of its 66 KB limit; with the code inside it was 68.2 KB.
  - The budget has no line of its own for this chunk. Adding one is the owner's call (see the report).
  - The reader passes `readPage` in: an import of `lib/pdf` from the new chunk pulled `lib/pdf` into the first load.
- **First load: 243.3 KB of 250 (241.4 before).** The 1.9 KB is the page's own new code (the shared verifier state, Show in reference list) and the shared module `paperinfo` now being a chunk of its own.
- **Linking.**
  - "The first author" means the surname is inside the entry's first author: up to the first comma, semicolon or "and". "Shazeer et al. (2017)" must not link to "Ashish Vaswani, Noam Shazeer, ...".
  - Keys are compared without "+" and spaces: PDFs drop the "+" of "[VSP+17]" in the list.
  - Two candidates are told apart by the number of authors as a last step (Graves 2013 alone, or with Jaitly and Mohamed).

## Measured on real papers (9 Nov 2026)

18 open-access PDFs were read with pdf.js and the same shared code (`CITE_PDFS=<folder> npx vitest run src/docs/citations.real.test.ts` in apps/api):
- 12 from arXiv: Transformer, ViT, BERT, ResNet, GPT-3, Bahdanau, InstructGPT, GW150914, Planck 2018, LoRA, EfficientNet, Scaling laws;
- 6 from PMC.

**Linking.**
- 2,404 of the 2,439 citations found (98.6%) were linked to exactly one entry. The 35 left plain are mostly not citations ("(ICML 2012)" in a reference list, "January 2016"), or entries the PDF's list does not have (an extraction miss).
- By style, linked/found:

  | Style | Paper | Linked |
  |---|---|---|
  | Numbered | ResNet | 174/174 |
  | Numbered | GW150914 | 120/120 |
  | Numbered | Transformer | 75/75 |
  | Keyed | GPT-3 | 211/211 |
  | Keyed | Scaling laws | 72/72 |
  | Author-year | Planck | 602/616 |
  | Author-year | InstructGPT | 184/184 |
  | Author-year | PMC sociology | 145/145 |

**Missed (recall).** A loose count was made, independent of the parser: "et al." with a year after it, and number brackets, before the list.
- "et al.": 1,175 of 1,215 (96.7%) were covered by a linked citation.
- Number brackets: 240 of 251 (95.6%).
- What is missed:
  - citations of entries the list extraction lost;
  - "Ross et al. (2017)" where two entries fit (not linked on purpose).

**Wrong links (precision).** Read by eye: about 110 linked citations across all 18 papers, none linked to a wrong entry.

**Not found at all.**
- Two PMC papers (both numbered) cite with superscript numbers: 0 citations found. This is an open item.
- "(12)" in parentheses is not taken: equation numbers look the same.

## Tests

- **Unit, shared:**
  - the parser: every style above, numbers in tables and equations, intervals, years in prose, ranges, several citations in one bracket, Hindi;
  - `labelledReferenceEntries` agreeing with `referenceEntries`;
  - linking, with its ambiguity rules.
- **Unit, web:** the card's status for each verdict, with "Verified" only for verified.
- **Browser e2e** (`e2e/cites.mjs`), on a generated paper with both styles. Verdicts are fixed by intercepting `/api/v1/references/verify`. It checks:
  - hover opens the card, and moving into it keeps it;
  - focus shows it and Enter moves focus in;
  - Escape returns focus to the citation;
  - a tap on a phone opens it;
  - "Show in reference list" goes to the entry;
  - Verified appears only on the verified entry, and Retracted is shown;
  - axe passes, and nothing scrolls sideways.
- **Real PDFs.** Detection and linking rates are measured on open-access PDFs (arXiv and PMC), by a script that runs the same shared code on pdf.js text.
