# What vellum.ai does with scrolling, and what we take from it (27 Oct 2026)

Asked: look into https://www.vellum.ai/, learn how its scrolling animation is made, and ideate how to use it in our site in our own theme. Result: this note, the design system [scroll-design-system.md](scroll-design-system.md), and a mock to play with, [poc/scroll-v2.html](poc/scroll-v2.html) (open it from the repository folder; sample data only).

**How this was looked at.** The page's HTML, its inline styles (which carry the developers' own comments) and its JavaScript chunks were read as text, nothing was run, nothing is copied. A text-only fetch of the page cannot show motion, so the markup, the CSS and the scroll code were read instead. What is below is what the code does, not how it looked on a screen I cannot see: the mock is my reading of it, to be judged by you.

## 1. What it is

A single long marketing page for a personal AI assistant (a banner on it says the platform shuts down on 2 November 2026; the page is still a good study of technique). A friendly character with two big eyes ("the avatar") is the thread of the whole page: it starts small, gets poured into devices, grows to fill the screen, walks in with a partner and ends the page. The page is **not** built on an animation library: no GSAP, no Lenis, no Motion, no Lottie, no WebGL. It is Next.js with React, `position: sticky`, one `requestAnimationFrame` per scroll event, SVG, and a 2D canvas.

| Section (its class prefix) | What happens while you scroll | How it is built |
| --- | --- | --- |
| Hero (`aw-`) | Headline over an open area; a **wave** is drawn on a canvas beneath it; the giant eyes peek above the bottom edge | 2D canvas, device pixel ratio capped at 2, text laid over a fixed-aspect "design stage" (1440 × 1040) so it does not jump when the page hydrates |
| Feature stage (`fh-`) | A tall section with one pinned stage. Four titles ("I'm 100% yours", "I remember what matters", "I'm always available", "I'm private and secure"). The **active** title grows, its description unfolds under it, a different interactive picture shows (a turning memory sphere, a 24-hour dial with sun, moon and pop-up notifications, a vault), and the **whole stage's colour follows the active feature**. Phone, cloud, tablet and laptop "homes" are flooded by the avatar's colour in turn | `position: sticky; top: 64px; height: calc(100vh - 64px)` inside a tall container; progress read from `getBoundingClientRect()`; values written straight to `style.transform`, `opacity`, `clip-path`; the titles are real buttons that scroll the page to their feature |
| Surface split (`ss-`) | A tall section tucked under the one above (a negative margin pulls it up), so it is already pinned while the features fade out above it. Two characters (Business purple, Personal yellow) slide in from the edges, walk to a divider, labels and lists appear; a mouse-move parallax; at the end it whitens out to hand over to the next section | Same pattern; **actors are positioned per frame from the scrub**; the exit scrub sets `pointer-events: none` so the section below stays clickable |
| FAQ (`anw-`) | Tucked a viewport up beneath the split; accordion with a smooth height | `<details>` with `interpolate-size: allow-keywords` and `::details-content`; falls back to instant in other browsers |
| Closing (`hatch-cta-`, `fm-`) | "The Personal AI you were promised", a strip with small figures moving along the bottom | CSS, absolutely positioned figures |

Colour and type: mostly white, near-black (#1a1a1a) text, a hairline grey (#e0e1e3), the avatar's warm yellow and a purple for the second character; **Instrument Serif** for the headline and **DM Sans** for the rest (a Google Fonts link). Seven keyframes in all (breathing, blink, pop, ping, lock snap); four easings (one overshoot, `cubic-bezier(.34, 1.56, .64, 1)`).

## 2. The ideas that matter (the developers wrote several of them down in comments)

1. **Scroll progress is a number from 0 to 1 per stage, split into segments.** One listener schedules one `requestAnimationFrame`; the frame reads the stage's position, computes `p`, and every moving thing is a function of `p` (`(p - start) / length`, clamped, then eased: `u*u`, a smoothstep). Nothing is kept as React state per frame: elements are written directly. This is the same thing Motion's `useScroll` and `useTransform` do, with more code.
2. **Actors, not effects.** A thing that travels (an avatar, a card, a chip) is one element whose position, scale and opacity are computed from `p` each frame between two measured points. The measuring happens on resize, not on every frame.
3. **Sections overlap on purpose.** A "tuck" (negative margin and a higher `z-index`) means the next stage is already in place, in its start state, while the previous one finishes: the join is never a cut. The comments explain the cost: the covered section's last part of scroll is wasted, so the previous stage must finish early.
4. **Titles as navigation.** The accordion titles are buttons that scroll the walk to their feature (and respect reduced motion). The active one grows, inactive ones are smaller and dimmer, the text unfolds with `grid-template-rows: 0fr → 1fr`.
5. **A stage colour that follows the content** (the avatar's hue changes with the active feature): one variable, a long transition.
6. **Reduced motion is CSS, not JS state**: every transition and loop is switched off by a media query that sits after the rules it overrides; the "host" parks a finished frame. No flash, no script needed.
7. **Layout rules learned the hard way** (their comments): full-bleed sections use `width: 100vw; margin-left: calc(-50vw + 50%)` and must not be centred by a flex parent (a 16 px gutter appears); never position the headline from an effect that measures `innerHeight` (it jumps on hydration: use CSS percentages of a fixed design height); use `vh`, not `svh`, for a stage that must cover the section beneath (the small viewport leaves a strip when the mobile address bar goes); a transparent scroll spacer over a clickable section needs `pointer-events: none`; screen-reader copy for both sides of a split; an `IntersectionObserver` and the page-visibility to stop work that is not seen.
8. **Canvas only where drawing is the point.** The wave is a 2D canvas with the pixel ratio capped; everything else is DOM and SVG (so it stays sharp, selectable and accessible).

## 3. What does **not** transfer, and why

| Their thing | Ours | Reason |
| --- | --- | --- |
| A mascot with eyes, devices flooding with colour, a wave | None | It is their brand. We are a tool for checking; a character would say the wrong thing, and copying one would be wrong in any case |
| One huge story from first screen to last | Short acts, each about one claim | Our reader is a researcher who wants to know whether it can be trusted, in the first minute |
| Instrument Serif and DM Sans | Our own: Source Serif 4 and Inter (and JetBrains Mono for DOIs) | Fonts are your call; the mock uses what the app already has |
| Hand-written rAF for everything | Motion's `useScroll` / `useTransform` in the app, vanilla only in the mock | Motion is already in the app, does the same off the React render path and falls back to JavaScript where CSS scroll timelines are missing (Firefox) |
| Sound-like delight (overshoot easing, blinking) | Quiet: one overshoot at most (the chip), no loops except the source strip | Trust is calm. Looping motion also needs a pause control (WCAG 2.2.2) |

Nothing here copies their code, characters, words or layout: the techniques are common practice (sticky stages, scroll-linked variables, section overlap) and the design below is ours.

## 4. What we take, as ideas for Scholar AI

1. **"Follow the citation"** (the hero's scroll story). The page's whole promise (every claim points at a sentence) shown as one journey: an answer with a numbered chip, the chip travels to the exact sentence of an abstract, the sentence is highlighted, the DOI ring draws and the record is confirmed, a retracted neighbour is marked. The chip is the actor (their avatar, our idea).
2. **Titles that grow, with a stage colour that follows** for the four tools. Replaces the current pinned tour's chapter list with something the reader can also click; the stage tint uses our own accent, success and warning tokens.
3. **"Two answers"**: an answer you cannot check (a made-up DOI, struck) beside an answer you can (the sentence found), the two cards sliding in from the edges to a divider. It is the "check the checker" message as a picture, and the closest thing in our product to their Business-and-Personal split.
4. **The literature scan in 52 seconds in one scroll**: five lanes fill at different speeds, one ends as a plain gap ("no paper is about it"), the report assembles on the side with one numbered list of sources. The scroll compresses the real time and says so on screen.
5. **A quiet citation graph in the background**: a canvas with 40 nodes and their edges, more edges as the page goes on (they "connect"). It is the only place a canvas is used, it draws on scroll only (no loop), and it can be switched off. It is the closest counterpart of their wave, in our subject.
6. **Smooth FAQ** with `::details-content` and **a strip of the real sources** (OpenAlex, Crossref, PubMed, arXiv, CORE, Semantic Scholar, Europe PMC, Retraction Watch) in place of logos we do not have; it stops on hover and with reduced motion.
7. **Hand-off between acts**: the tools stage slides over the end of the hero stage (their "tuck"), with the first act finishing in its first 80% of scroll.

## 5. Risks, honestly

- **Scroll length.** Four pinned stages of 330 to 480 viewport heights each is a long page on a trackpad and a very long one on a phone. The mock has a Playground slider (60 to 150%) to find the length that feels right; phones and reduced motion get the stacked finished layout instead (no pinning).
- **Performance.** Each stage writes a few CSS variables per frame, only for stages near the screen; transform and opacity only (plus `clip-path` and a highlight's `background-size`); one canvas, capped at pixel ratio 2, drawn on scroll only. Needs measuring in the real app on the 4× CPU profile of `e2e/perf.mjs` before it replaces the current intro (its budgets: first load scripts 250 KB, intro chunk 15 KB, CLS 0.1).
- **Accessibility.** Everything animated is decoration over real text that is in the page in reading order; the animated window is `aria-hidden` and each stage has a plain-text equivalent for screen readers; titles are buttons with `aria-expanded`; motion never starts by itself except the source strip, which pauses on hover and focus and is off with reduced motion. The mock passes axe in light, dark and read themes at the settled end of each stage, and in the stacked layout. Not tested by a person using NVDA (that stays yours, P6).
- **It is a mock.** The text is sample data and is labelled so; nothing in it is a real citation. The retracted paper, the DOI and the percentages are invented for the picture.
