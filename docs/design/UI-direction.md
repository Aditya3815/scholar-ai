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

## Verified (automated, `npm run e2e -w apps/web`, Edge headless)
- axe-core WCAG 2.2 AA: **0 violations** on home (Light/Dark/Read), results (Light/Dark/Read), cite popover, library drawer, retracted results.
- Mobile 390 px: no horizontal overflow; no console errors.
- Bundle: main JS 142 KB gzip + 19 KB lazy motion chunk; CSS 8 KB gzip.

## Known gaps / next
- Library is localStorage until sign-in exists (interface ready to swap to D1).
- Citation formatting is heuristic on display names; Phase 1 moves to structured names + CSL.
- Paper workspace (PDF reader + Q&A), onboarding, Hindi/Odia UI strings, Storybook of components.
- Real-device pass on a mid-range Android (Moto G class) for the Lighthouse target.
