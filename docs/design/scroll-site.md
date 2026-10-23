# The scroll-animated intro page: research and decisions

Date: 2026-10-24. Question from Aditya: the home page should be a scrolling, animated website that looks great. How can it be built, which components, from where, and how to do it properly?
Short answer: **one animation engine we already ship (Motion), native scrolling, sticky "pinned chapters" driven by scroll progress, our own components written for our tokens**, with a plain stacked layout for phones, reduced motion and no-JS.

## 1. What I checked (sources, 24 Oct 2026)

| Question | Finding | Source |
| --- | --- | --- |
| Can plain CSS do scroll-linked animation (`animation-timeline`)? | Chrome and Edge since 115 (July 2023) and Safari since 26.0 (September 2025). **Firefox: not enabled by default** (behind a flag, on the 2026 Interop list). So CSS alone would give Firefox users a dead page | [ICS MEDIA](https://ics.media/en/entry/230718/), [Mozilla Connect thread](https://connect.mozilla.org/t5/ideas/implement-css-scroll-driven-animations-animation-timeline/idc-p/119840) |
| Does Motion (already in the app, `motion` 14) do it? | Yes: `useScroll` + `useTransform`. It uses the browser's native `ScrollTimeline` where it can and **falls back to JavaScript otherwise**, so it works in Firefox too. Scroll-*linked* (tied to position) is separate from scroll-*triggered* (`whileInView`). Pinned sections are a tall container with a `position: sticky` child | [Motion scroll animations](https://motion.dev/docs/react-scroll-animations) |
| GSAP ScrollTrigger? | Now **free including commercial use** (Webflow made GSAP and its former paid plugins free). Powerful, but it is a second animation engine next to Motion, for no feature we need | [GSAP README](https://cdn.jsdelivr.net/npm/gsap@3.15.0/README.md), [GreenSock forum](https://gsap.com/community/forums/topic/44709-clarification-on-gsap-licensing-for-a-wordpress-plugin/) |
| Smooth-scroll library (Lenis)? | MIT, a few KB, keeps native scroll, `position: sticky` and anchors working, and **respects `prefers-reduced-motion` by default**. Caveats: iframes, Safari frame rate, nested scrollers | [Lenis](https://github.com/darkroomengineering/lenis) |
| Component libraries | **Aceternity UI** (Container Scroll Animation, Sticky Scroll Reveal, Tracing Beam, Hero Parallax: React + Tailwind + Motion). Its licence page covers items "available for purchase or download", allows commercial end products, forbids redistributing the source; it does not say "free components" in so many words, and listings on 21st.dev say MIT: **unverified, so I copy no code**. **Magic UI**: MIT. **React Bits**: MIT + Commons Clause, free for personal and commercial use | [Aceternity licence](https://ui.aceternity.com/licence), [21st.dev listing](https://21st.dev/@manuarora700/components/container-scroll-animation.md), [Magic UI](https://github.com/magicuidesign/magicui), [React Bits](https://github.com/DavidHDev/react-bits) |
| Accessibility | WCAG 2.2.2 (Level A) covers motion that starts by itself and lasts over 5 seconds: it needs a pause control; motion that **follows the person's own scrolling is the person's doing**, and ordinary scrolling is exempt from 2.3.3. Parallax is the typical vestibular trigger: honour `prefers-reduced-motion`, keep one subtle effect per view, never take over the scroll | [W3C 2.3.3](https://w3.org/WAI/WCAG21/Understanding/animation-from-interactions), [Hidde de Vries](https://hidde.blog/meeting-2-22-pause-stop-hide-with-prefers-reduced-motion/) |
| Performance | Animate **transform and opacity only** (compositor); do not use scroll event listeners (use Motion's scroll or IntersectionObserver); `scroll-behavior: smooth` only when motion is allowed | [Core Web Vitals note](https://www.corewebvitals.io/pagespeed/improve-inp-ditch-javascript-scrolling) |

## 2. Decision

| Option | Verdict | Why |
| --- | --- | --- |
| CSS scroll-driven animations only | no (maybe later as an enhancement) | no Firefox without a flag |
| **Motion `useScroll` / `useTransform` / `whileInView`** | **yes** | already in the app (no new weight), native timeline where available, JS fallback elsewhere, one set of springs for the whole product |
| GSAP + ScrollTrigger | no | free now, but a second engine (tens of KB) for something Motion already does |
| Lenis (smooth scrolling) | not now | it makes native scroll feel "floaty", is one more thing to keep accessible, and the page does not need it. Easy to add later behind the reduced-motion check |
| Video, Lottie, WebGL, 3D | no | heavy on slow phones, worse accessibility, and the product is text, citations and tables, not a render |
| Copy components from Aceternity, Magic UI, React Bits | **take the patterns, write them ourselves** | our app has no Tailwind (adding it would restyle everything); the Aceternity licence for free items is unclear; our versions are small, use our tokens in three themes, and are tested with axe |

### Patterns used and where they come from

| Pattern | Idea from | Used for |
| --- | --- | --- |
| Pinned chapters, content changes with scroll progress | Aceternity *Sticky Scroll Reveal* | the product tour (four chapters), the window inside it is scrubbed by the scroll |
| Window that tilts flat as it enters | Aceternity *Container Scroll Animation* | the product window in the hero |
| Progress line along the side | Aceternity *Tracing Beam* | chapter rail with jump buttons |
| Words that light up with scroll | Aceternity *Text Reveal* / Magic UI word-by-word | the manifesto paragraph |
| Layers that move at different speeds | Aceternity *Hero Parallax* | the aurora and the grid behind the hero (small movement, one effect) |
| Top progress bar | Magic UI *Scroll Progress* | page progress line under the header |
| Fade and rise on entering | Magic UI *Blur Fade* | cards in later sections (`whileInView`, once) |

## 3. The page

Spine (everything is real text in the page; the animation only decides when it shows):

1. **Header**: logo, section links, theme switch, Sign in; turns translucent with a hairline after the first scroll; a thin progress bar.
2. **Hero**: "Research you can *trust*." (words arrive, underline draws), one sentence, **Sign in** buttons and "Try without signing in", and the product window. Aurora and grid drift slowly at different speeds while scrolling (parallax, small).
3. **The tour** (pinned, about 4 screens of scrolling): the stage stays on screen, the window on the right is *scrubbed* by scroll: Chapter 1 find papers (question typed, steps tick, answer streams, cards with DOI and retraction), 2 check references (verdict per line), 3 check an idea (coverage map fills, never a verdict on novelty), 4 ask a paper (the quote is highlighted with its page). The left side shows the chapter text and a vertical rail whose dots jump to a chapter.
4. **Manifesto**: one large paragraph; each word turns from faint to full as you scroll ("An AI that sounds sure is not an answer you can cite…").
5. **Check the checker**: three rules, three cards (DOI that resolves, quote that highlights, retraction banner), then the honest-limits box.
6. **Ask the way you think**: Hinglish and Hindi exchange; the chat bubbles arrive in turn.
7. **Your work stays yours**: three privacy facts.
8. **Final band and footer**.

No numbers, logos or quotes from people that are not real; the page says its examples are sample data.

## 4. Rules (best practices I am building to)

**Scroll and motion**
- Native scrolling always: no scroll hijacking, no scroll-snap traps, the scrollbar and keyboard (Space, PageDown, Home, End, Tab) behave as in any page.
- Pinning is only `position: sticky` inside a tall container; the container's height is the scroll budget (4 chapters × about 85vh).
- Animate **transform and opacity only**; no layout properties; `will-change` only on the few moving layers; no scroll listeners (Motion's scroll timelines and IntersectionObserver).
- One engine (Motion), the same springs as the rest of the app (`lib/motion.ts`).
- Scroll-triggered reveals run **once**, so scrolling back up never replays a distraction.

**Accessibility**
- With `prefers-reduced-motion`, on phones (below 900 px) and without JavaScript animation, the page is **a stacked, static article**: every chapter shown one after another with its scene in its finished state. Nothing is hidden behind scrolling.
- The pinned stage is decorative duplication of the chapter text; a screen reader gets the same four chapters once, as a normal list of headings and paragraphs. Focusable things (the chapter buttons, CTAs) are never inside an `aria-hidden` region.
- Focus is always visible; every control has a name; the chapter rail is a `nav` with `aria-current`.
- No auto-playing loop: the only motion is the person's own scrolling and a few one-shot entrances (so the "pause" rule of WCAG 2.2.2 has nothing to pause).
- Contrast uses the product's own token pairs in Light, Dark and Read; axe runs on the page in all three themes and on a phone.

**Performance (budgets I will measure, not assume)**
- The page is its own code chunk (`React.lazy`), loaded only for signed-out visitors, so signed-in people never download it.
- No images and no video; fonts are the ones already self-hosted; the text of the hero is in the HTML that React renders first, so LCP is a text paint.
- Targets on a throttled mobile profile (4× CPU slowdown): LCP under 2.5 s, CLS 0, no long task over 100 ms while scrolling the tour. I will report the numbers.
- The tour is skipped (static layout) below 900 px, so phones do no scroll-linked work at all.

**Engineering**
- Hooks per chapter component (no hooks in loops); the scrubbed scenes derive everything from one `progress` value, so they are deterministic and testable (a test sets the scroll position and checks what is visible).
- All of it behind the workspace flag until it is approved; the old home stays the default until W6.

## 5. As built (W1, 24 Oct)

Files: `apps/web/src/workspace/intro/IntroPage.tsx` (page, hero, pinned tour, stacked tour, manifesto, trust, privacy), `scenes.tsx` (the four scrubbed scenes), `styles/intro.css`; the page is its own chunk (38 KB, 13 KB gzipped) and the rail, home and pages are `workspace/Shell.tsx`, `HomePage.tsx`, `Pages.tsx`. Turn the new look on with `?ws=1` (off with `?ws=0`); it is off by default until you approve it.

What was measured (Edge, 4× slower CPU, slow 4G: 1.6 Mbit/s, 150 ms), `ws-perf` run of 24 Oct:

| | desktop 1360×900 | phone 390×844 |
| --- | --- | --- |
| First contentful and largest contentful paint | 2.6 s and 2.6 s | 2.6 s and 2.6 s |
| Layout shift on load and while scrolling the whole page | **0.002** | 0.032 (one shift: the serif font replacing the fallback in the headline) |
| Long tasks while scrolling the whole page | one of 123 ms (at 4× slowdown) | none |
| Transferred | about 1.0 MB uncompressed, of which the app's main script is 556 KB (171 KB gzipped) | same |

Reading it honestly: the page itself is light; the paint time is the app's own main bundle on a throttled link (it was 3.6 s before two fixes: the intro chunk is requested at once for someone who has not signed in before instead of after the sign-in check, and the headline keeps a faint opacity so the browser counts it when it is first painted). Layout shift was 0.19 before every scene reserved its final layout and only hid what is not yet shown. Not done: preloading the serif font file (the one remaining phone shift), and splitting the app's main bundle (affects every page, not only this one).

Tests: `apps/web/e2e/workspace.mjs` (part of `npm run integration -w apps/api -- --browser`): scrolling the tour and reading which chapter is on screen, that the typed question grows and winds back with the scroll, the chapter rail, the stacked layout on a phone and with reduced motion, axe in Light, Dark and Read at the hero, the tour, trust, privacy and the end, then the signed-in home, the mode menu, hand-off to Check references and Idea Check, the Library and Settings pages, My papers without "Open and ask", the phone drawer, sign-out, and that the old look is untouched without the flag.

## 6. How I checked it while building

Browser tests (as listed above): the intro at 1360×900 and 390×844 in the three themes (axe, no sideways scroll); scroll to each chapter and check the scene shows the right state; keyboard: Tab order, rail buttons jump to chapters; reduced motion: stacked layout and finished scenes; no console errors. Performance: LCP, CLS and long tasks with 4× CPU throttling via the DevTools protocol. Screenshots of every chapter are reviewed by eye before I report.
