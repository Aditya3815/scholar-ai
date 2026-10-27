# Scroll design system v2 (27 Oct 2026)

For the scroll-driven intro of Scholar AI, from the study of vellum.ai ([vellum-research.md](vellum-research.md)) and the first intro ([scroll-site.md](scroll-site.md)). It is **ours**: the tokens are the app's (`apps/web/src/styles/tokens.css`), the type is the app's, nothing is Vellum's. The mock that uses all of it: [poc/scroll-v2.html](poc/scroll-v2.html). Nothing here is built in the app yet; section 8 says how it would be.

## 1. Principles

1. **One claim per act.** An act is a pinned stage with one sentence the reader should leave with ("every claim points at a sentence"; "a reference that does not exist is said so"; "two answers, only one can be checked"; "a scan is parallel and says what it could not answer").
2. **The scroll is the reader's, not ours.** Native scrolling only; no scroll hijacking, no snap traps; the keyboard (Space, PageDown, Home, End, Tab) works as on any page. A stage reads the scroll, it never moves it, except when a person presses a button that asks for it.
3. **Real text first, then motion.** Every stage is real text and real elements in reading order. Animation decides only when they are shown. Without JavaScript, on a phone, or with reduced motion, the same page is the **stacked finished layout**.
4. **Calm.** Trust is the product: one overshoot at most (the citation chip), no loops except the strip of sources (which stops on hover and focus), no sound, no parallax beyond a few pixels.
5. **Never fake.** Examples are labelled "Sample data"; no logo, number or quote that is not real.

## 2. Tokens

Colour, radius, shadow and the three themes are the app's, unchanged: light, dark, read (sepia). A theme switch re-colours the whole page and the background graph.

| Token | Value | Use |
| --- | --- | --- |
| `--bg`, `--surface`, `--surface-2` | per theme | page, cards, wells |
| `--text`, `--muted` | per theme | all text (muted is for secondary only; both pass 4.5:1 on their surfaces) |
| `--accent`, `--accent-soft`, `--accent-fg` | indigo `#3548c8` (light) | the chip, highlight, progress, primary buttons |
| `--ok`, `--ok-soft` | green | "resolves", "found", "answered" |
| `--warn` | amber | a gap, a caution |
| `--danger`, `--danger-soft` | red | a retraction, "no such record" |
| `--tint` (new, stage-level) | `accent`, `ok`, `warn` or a mix of two | the stage colour that follows the active tool: `background: color-mix(in srgb, var(--tint) 7%, var(--bg))` |

| Type | Family | Use |
| --- | --- | --- |
| Display | Source Serif 4 (variable, optical size), weight 600, `letter-spacing: -.02em`, `text-wrap: balance`; an `<em>` in the accent for the one word that carries the claim | H1 `clamp(2.6rem, 6.4vw, 5.2rem)`, H2 `clamp(1.9rem, 4vw, 3.1rem)`, stage titles |
| UI | Inter (variable) | body, buttons, captions; eyebrows 12.5 px, 700, uppercase, `.1em` |
| Mono | JetBrains Mono (variable) | DOIs, the clock |

Fonts are not changed from what the app already loads (changing them is your call).

**Motion tokens**

| Token | Value | Use |
| --- | --- | --- |
| `--ease` | `cubic-bezier(.22, 1, .36, 1)` | every transition (the app's own) |
| `out(t)` | `1 - (1 - t)^3` | scrubbed reveals (decelerate into place) |
| `inOut(t)` | cubic in-out | travel (the chip's flight) |
| duration, state changes | 450 to 600 ms | an active tool, a stage tint, an unfolding description |
| duration, reveals on entering | 700 ms, once | quiet sections |
| pinned stage length (`--vh`) | 330 to 480 viewport heights, times the Playground's `--len` | one act |
| usable range (`data-use`) | 0.8 for a stage that the next one slides over | the animation finishes before it is covered |
| header | 64 px, translucent, hairline after the first scroll | sticky; every stage pins under it |

## 3. The stage (the one pattern)

```
<section class="stage" data-stage="name" data-use=".8" style="--vh: 480">     tall container: height = --vh * --len * 1vh
  <div class="sticky">                                                       position: sticky; top: 64px; height: 100vh - 64px
    <div class="inner"> … real text and elements … </div>
  </div>
</section>
```

- **Progress** `p = clamp((HEAD - rect.top) / (rect.height - (innerHeight - HEAD)))`, then divided by `data-use`. One `scroll` listener (passive) asks for one `requestAnimationFrame`; the frame goes through the stages that are near the screen and calls `update(p)` for each whose `p` changed by more than 0.0004.
- **Segments**: `seg(p, a, b) = clamp((p - a) / (b - a))`; every effect is `ease(seg(p, start, end))`. Segments of one act do not overlap by accident: each act's table is in the file next to its updater.
- **Output** is a handful of CSS variables on the stage element (`--win`, `--q`, `--chip`, `--fly`, …); CSS uses them with `calc()` for `opacity`, `transform`, `clip-path` and a highlight's `background-size` (nothing else is animated: no layout, no paint-heavy properties). A variable's **default is its finished state** (`var(--x, 1)`), which is what makes the stacked layout free.
- **Actors**: a thing that travels is one element with `translate()` and `scale()` from `--fx`, `--fy`, `--fs`, computed from a quadratic curve between two points measured on resize and font load (not per frame).
- **Stacked layout**: `html.js-static` (phones under 768 px, `prefers-reduced-motion: reduce`, the Playground's switch, no JavaScript). Stages lose their height and `sticky`, the actors and trail are hidden, every variable is at its default. Decided in the `<head>` before first paint, so nothing jumps.
- **Hand-off**: the next act may slide over the previous one (negative margin, higher `z-index`, an opaque tinted background and a soft top shadow); the previous act's `data-use` leaves room for it. Acts without an overlap simply scroll past each other, with no fade (a fade-out followed by an empty moment was tried and removed).

## 4. The acts (components)

| Act | Claim | What moves | Segments of `p` (after `data-use`) |
| --- | --- | --- | --- |
| **Follow a citation** (hero) | Every claim points at a sentence | The window tilts flat; the answer is typed; the chip pops; it **flies** along a curve to the sentence; the sentence is highlighted; the DOI ring draws; three badges tick in; a retracted neighbour slides in | lead-in 0 to .14 · claim .14 to .30 · fly .30 to .52 · record .52 to .73 · retraction .73 to .92. Four captions, each fading in and out in its own segment, with four progress dashes |
| **The tools** | What it does | Four titles in a list; the active one grows to 2.9 rem and its text unfolds; a picture per tool crossfades (found papers, a reference check that ticks line by line, an idea's coverage bars, a quote highlighted in a page); the stage tint changes | one quarter each; titles are buttons that scroll to their quarter |
| **Two answers** | Only one of them can be checked | Two cards slide in from the edges to a divider that draws; the made-up DOI is struck and labelled, the real sentence is confirmed; closing line | slide .10 to .38 · bad .42 to .58 · good .52 to .68 · divider .36 to .56 · line .72 to .86 |
| **Literature scan** | Parallel, honest about gaps | Five lanes fill at different speeds with a clock 00:00 to 00:52; the lane that finds nothing turns amber and says why; the report on the right fills in order with skeletons for the sections not finished; one numbered source list | lanes by their own start and end · report by lane end · sources .64 to .9 |

Quiet sections (no pinning): **Check the checker** (three rules and the honest limits), **Ask the way you think** (a Hinglish exchange, bubbles in turn), **FAQ** (`<details>` with `::details-content` and `interpolate-size`, instant where unsupported), **Start with one question** (the call to action, then the strip of real sources). They reveal once, on entering (`IntersectionObserver`, no scroll listener).

Chrome: the header with a page progress line, a **spine** of five dots at the right edge (desktop only, links with labels on hover and focus, `aria-current` follows the act on screen), a **background citation graph** (one `<canvas>`, 40 nodes, edges appear with page progress, pixel ratio capped at 2, drawn on scroll only, static when stacked, can be turned off).

## 5. Accessibility rules (each is checked in the mock)

- Animated copy is decorative and `aria-hidden`; each act has an `sr-only` paragraph that says what the picture shows, in reading order. Captions are real text.
- Controls are real elements: titles are `<button aria-expanded aria-controls>`, the spine and nav are links, the Playground is a labelled panel closed with Escape.
- Focus is visible everywhere (2 px accent outline, offset 3 px); a keyboard user can tab through a stage even while it is pinned.
- Contrast at every **settled** state in light, dark and read themes (axe: 0 violations at the end of each stage and in the stacked layout). Text that is not yet revealed is **not** shown faded: it is hidden and a skeleton stands in (a faded line failed contrast in dark).
- Motion: nothing starts by itself except the source strip (CSS, 38 s, paused on hover and focus, off with reduced motion); no flashes; the largest movement is the chip's flight (about 400 px, under a second of scroll).
- No horizontal scroll at 390 px (checked); touch scrolling is native; buttons are at least 44 px high and the spine's 12 px dots have a 30 px hit area (WCAG 2.2 asks for 24).

## 6. Performance rules

Transform, opacity, `clip-path` and highlight `background-size` only; no `scroll` handler does layout reads other than one `getBoundingClientRect()` per near stage per frame; geometry is measured on resize and after fonts load; stages far from the screen are skipped; the canvas is capped at pixel ratio 2 and draws only on scroll. In the app, the stage code is its own lazy chunk (the intro already is), the graph is a second one loaded after first paint, and the page must keep the budgets of `apps/web/scripts/budget.mjs` and `e2e/perf.mjs` (intro chunk 15 KB script, 5 KB style, CLS ≤ 0.1, first paint ≤ 4.5 s on the slow profile).

## 7. The Playground (mock only)

Theme (light, dark, read), motion (full or stacked), a scroll-length slider (60 to 150%), the graph on and off, a per-stage progress read-out, and jump buttons. Choices are kept in this browser. Use it to decide the three things that are matters of taste: how long each act should be, whether the background graph is wanted, and whether the "tools" stage tint (green for references, amber for ideas) is quiet enough.

## 8. If you approve: how it becomes the app (not started)

1. The four acts become components in `apps/web/src/workspace/intro/` next to the current tour, using Motion (`useScroll({ target, offset })`, `useTransform`, `useMotionValueEvent`), **not** the raw loop of the mock: same segments, same variables, written through refs, no React state per frame.
2. The stacked layout is the existing static path of the intro (`prefers-reduced-motion`, phones).
3. The graph is a lazy component, off by default under reduced motion and on slow devices (`navigator.connection.saveData`, low `hardwareConcurrency`).
4. Tests: the `workspace.mjs` and `perf.mjs` suites are extended: every act's settled states with axe in three themes, the stacked layout, no console errors, CLS and first paint on the slow profile, and the buttons that scroll to a tool.
5. Copy is reviewed by you: the mock's sentences are sample text in our product's voice, not final.
