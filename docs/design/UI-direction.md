# UI direction: calm, scholarly, alive

Date: 2026-10-17. Audience: scholars, PhD/MTech students, professors. They read for hours, scan many titles quickly, and distrust anything that looks like marketing. The UI should feel like a well-set journal that also responds to touch.

## References checked and what we took

| Reference | Took | Rejected |
| --- | --- | --- |
| [Motion](https://motion.dev/docs/react-installation) (`motion/react`) | Springs for popovers and pills, `layout` animations for reordering streamed results, `AnimatePresence` for drawer/popover exit, `MotionConfig reducedMotion="user"`, `LazyMotion` so the animation engine loads as a separate 19 KB gzip chunk | Scroll-jacking, parallax |
| [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) (cloned and queried offline, not installed into the project) | Style: Minimalism / Swiss with soft depth; checklist (SVG icons, visible focus, 4.5:1 contrast, reduced motion, test at 375/768/1024/1440 px); "academic/research" pairing idea (scholarly serif + hyperlegible sans); skeletons with `aria-busy`; motion tokens instead of one magic duration | Its auto-generated palette (red "breaking news") and hero-centric landing pattern: wrong tone for scholars |
| [Motion Sites](https://motionsites.ai/) + the *Framer X Claude Setup Guide* | Oversized serif headline with one emphasised word, staggered entrance, a quiet ambient background | 3D scenes and background videos: heavy on low-bandwidth Indian networks, and distracting for people who came to read |

## Decisions

**Typography.** Headings and reading text: Source Serif 4 (variable, optical-size axis, built for long reading). UI: Inter. Easy-read option: Atkinson Hyperlegible. Hindi and Odia: Noto Sans (more scripts in Phase 4). All fonts are self-hosted via Fontsource (no third-party requests, DPDP-friendly). Reading settings (size 15-24 px, line width, font) change `--read-*` CSS variables and apply to abstracts today and to the paper reader later.

**Colour.** Three themes, tokens in `apps/web/src/styles/tokens.css`: Light (warm paper white, indigo accent), Dark (ink, soft periwinkle accent, not pure black), Read (sepia, brown accent). Auto follows the OS. Every text/background pair is checked by `npm run contrast -w apps/web` (0 failures at WCAG AA 4.5:1). Status is never colour-only: icon + text on every badge and chip.

**Trust is the visual theme.** Each result shows how many sources agree ("Cross-checked · 3 sources"), citation counts, open-access status, and a red retraction banner with who flagged it. The word "verified" is only used where it is true.

**Motion system** (`lib/motion.ts`): one set of springs (`spring`, `springSoft`, `springPop`) and one easing, used everywhere so the product has one feel.

| Where | Motion | Purpose |
| --- | --- | --- |
| Hero | staggered rise, hand-drawn underline on "trust", slow drifting colour glow | warmth without video weight |
| Source chips | pulse while waiting, check mark draws itself, lightning for cache hits | shows the system working; sources arrive progressively |
| Results | cards enter staggered, reorder smoothly when a slower source changes the ranking, citation counts count up | streaming never feels jumpy |
| Retraction | banner shakes once | draws the eye to the one thing that must not be missed |
| Save / Copy | bookmark pops, copy icon swaps to a check | instant feedback on small actions |
| Theme switch | sliding pill, 260 ms colour cross-fade | feels physical, no flash |
| Popover / drawer | scale+fade / slide with spring | spatial continuity |
| Reduced motion | `MotionConfig reducedMotion="user"` + CSS media query: transforms and loops off, final state identical | accessibility |

**Streaming.** `GET /api/v1/search/stream` (SSE) sends a merged snapshot after each source. First results appear in about 1 s while the slowest source takes about 3 s (cold). Cached repeats take about 30 ms.

## Reference Verifier (/verify)

Built with the same references and rules as above (Motion springs and stagger from `lib/motion.ts`, UI UX Pro Max UX guidelines queried offline: visible labels, loading/progress feedback, no colour-only status, one atomic live message, error recovery paths, 4.5:1 contrast, test at 375/768/1024/1440).

| Decision | Why |
| --- | --- |
| Paste anything: numbered list, one per line, blank-line separated, wrapped lines, BibTeX, or open a .txt/.bib file | scholars copy from Word, PDFs and LaTeX; a live "N references detected" count shows how the paste was split before anything is sent |
| One request per reference, three at a time; cards appear queued and fill in as answers arrive | each request stays inside the Worker subrequest limit, one slow entry never blocks the rest, the page is useful after one second |
| Verdict is never a black box: the matched record, and three plain-words checks (title, author, year) | a scholar must be able to judge the tool, not just trust it |
| "Not found" says it can also mean a book, thesis or regional journal that Crossref does not index | many Indian sources are not in Crossref; calling them fake would be wrong and unkind. A database outage is "Could not verify", never "Not found" |
| Retracted matches get the same shaking red banner as search results and a line in the summary | the one thing that must not be missed |
| Three buckets, each an icon plus words: Verified, Needs attention, Could not check; they double as filters | the supervisor question is "what do I need to look at?" |
| Report: CSV (formula-safe, opens in Excel with UTF-8) and "Copy flagged references" | something to send to a co-author or attach to a thesis review |
| Progress and filters pinned while scrolling on desktop; plain on phones | pinned, they would cover half of a phone screen |
| Reference text is never stored (cache key is a hash); the list is kept in this tab only | a bibliography can reveal an unpublished thesis |

Motion: hero-style rise and drawn underline, status icon pops (the verified check draws itself), one soft ring on cards that need attention, counts roll in, progress bar springs and turns green when done. All of it respects reduced motion.

## Paper preview, My papers, reader and Q&A

Same references and rules as above; the new pages reuse the tokens, springs, popovers, chips and cards, so nothing looks "added on".

| Decision | Why |
| --- | --- |
| One **preview sheet** for every tool: search results, the library, and the verifier's matched record | a scholar decides whether a paper is worth opening by reading its abstract, authors and venue, not by clicking out; arrow keys move through the list it came from, a missing abstract is explained, retractions keep the red banner |
| **My papers** is a card grid with each paper's **first page as its cover** (rendered in the browser at upload) | people recognise papers by how the first page looks |
| Upload is one big drop zone (drag, click or Enter); every file gets its own row with three steps (Read, Upload, Index), a progress bar and a plain error with Try again | uploads can take a while; each stage is visible and a failure says what happened |
| The reader is the real PDF: page thumbnails with a sliding current-page ring, lazy rendering, zoom, page jump, text layer (select and copy), dark/read themes dim the white page | a scholar reads the original, not a re-typeset copy |
| Q&A sits beside the paper; on a phone it is a Paper / Ask tab pair | both are needed at once on a desk, one at a time on a phone |
| An answer shows **page chips** and a **sources list** with the exact quote; clicking either scrolls the PDF to the page and **highlights the passage** | verification is one click, which is the whole point |
| A **References** tab beside Ask: the paper's own list, each entry checked like in Verify references, a red banner when it cites retracted work; a **Contents** menu in the reader (the PDF's bookmarks, or headings we detected, labelled as possibly incomplete) | the questions a reader has about a paper are "does it cite real work?" and "where is the section I want?" |
| Three honest answer states, each icon plus words: checked, could not verify (warning), not in this paper | the tool says when it does not know instead of sounding sure |
| Real, server-reported progress while an answer is produced: four steps (Find, Think, Write, Check), the pages being read as clickable chips, then the answer written word by word and dimmed until it is checked; a Stop button; auto-scroll only while the reader is at the bottom | a reasoning model thinks for seconds before writing, so the honest way to make the wait feel short is to show what is really happening; text is provisional until the sources are verified |

Micro-motion: drop zone icon bounces while you drag, step dots draw their check, finished upload rows slide away and the new card rises in, covers fade and settle in, the rename pencil appears on hover, question bubbles spring in, the answer's sentences fade in one after another, source rows rise in order, send button morphs into a spinner, copy icons swap to a check, the highlight flashes then settles, the sheet slides in and its content rises piece by piece. All of it respects reduced motion.

## Verified (automated, `npm run e2e -w apps/web`, Edge headless)
- axe-core WCAG 2.2 AA: **0 violations** on home (Light/Dark/Read), results (Light/Dark/Read), cite popover, library drawer, retracted results.
- Mobile 390 px: no horizontal overflow; no console errors.
- Bundle: main JS 142 KB gzip + 19 KB lazy motion chunk; CSS 8 KB gzip.

## Known gaps / next
- Library is localStorage until sign-in exists (interface ready to swap to D1).
- Citation formatting is heuristic on display names; Phase 1 moves to structured names + CSL.
- Paper workspace (PDF reader + Q&A), onboarding, Hindi/Odia UI strings, Storybook of components.
- Real-device pass on a mid-range Android (Moto G class) for the Lighthouse target.
