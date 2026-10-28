# Cinematic story: the intro as a short film (mock v3, 28 Oct 2026)

You did not like the Vellum-style mock ("kuch khaas nahi") and chose **Cinematic story** from three directions (cinematic, hands-on playground, Indian editorial). The mock: [poc/scroll-v3.html](poc/scroll-v3.html), opened from the repository folder so the app's fonts load. Nothing of it is in the app until you approve it.

The rules of [scroll-design-system.md](scroll-design-system.md) still hold: the app's tokens and fonts, native scrolling (no hijacking), real text first, a stacked finished layout for phones, reduced motion and no JavaScript, never fake data. What changes is the **language**: one claim per full-screen scene, told like a film.

## The film (nine scenes, about 29 screens of scroll)

| # | Scene | The one thing it says | What moves |
| --- | --- | --- | --- |
| 1 | **Cold open** | "An AI can write a perfect reference to a paper that was **never written**." | The words light up one by one as you scroll, like subtitles read aloud; unlit words are only an outline; "never written" is in red. Then one line: what Scholar AI does about it |
| 2 | **Title** | Scholar AI · *Research, with the receipts.* | The name comes from very close and out of focus (3.2 times, blurred, wide letter-spacing) and settles; the book mark draws itself; a glow drifts |
| 3 | **I · The question** | A question goes in, real papers come back | The box rises, the question types itself, **twelve papers fly in from far away** (3D depth, staggered); every card says "DOI ✓"; the retracted one is struck through and **stamped RETRACTED**; a count line: 20 papers, 4 sources, 1 retracted, never used |
| 4 | **II · The answer** | Every claim points at a sentence | The answer in large type with its mark [3]; a ring pulses on the mark; then an **iris opens from the mark** (a circle with a ring of light on its edge) while the camera pushes into the answer, and inside it is paper 3 with **the exact sentence highlighted by a sweep**: "The sentence, word for word. Not a paraphrase." |
| 5 | **III · The proof** | The paper is real. *We checked.* | A green ring closes around the DOI; Crossref (found), doi.org (resolves), Retraction Watch (clear) slide in one after another |
| 6 | **IV · The fake** | A reference that does not exist is said so | A perfectly formatted invented reference; a scan line passes; Crossref, OpenAlex, Semantic Scholar: no match; then **the reference turns to dust and blows away** (its own letters, sampled into dots on a canvas, drifting right and up like ash, left to right), the card becomes a dashed empty frame: "Nothing to cite here." and **No such record.** |
| 7 | **V · Close to home** | Indian research, *on purpose* | A large Devanagari "शोध" behind, the two real counts rolling up in Indian numbering (**1,17,635** theses on Shodhganga through OpenAlex, **3,09,564** articles in journals published in India, DOAJ), the "Indian sources" switch, and a Hinglish question answered in Hinglish |
| 8 | **VI · Your own papers** (added 28 Oct, after your approval: "Workspace ka bhi introduction") | Your PDFs. Marked, *and asked.* | A PDF drops into My Workspace and opens as a page; a **highlighter** sweeps a sentence and the **pen** rings "80%" with a note in the margin ("why 80%?", tied to the word so it sits right at every size); a question is asked; the answer says **"158 in each group"** with the quote and **Page 4**; the page **turns** (a 3D flip) to page 4 and the quoted sentence lights up; then what My Workspace does: pen and highlighter, annotated PDF download, scanned papers, offline reading, private to your account and never used to train AI (all real features) |
| 9 | **The end** | Ask your *first* question | The light comes up from below (an indigo dawn), the prompt box with its caret, the button, and **end credits that roll: the real sources** (OpenAlex, Semantic Scholar, Crossref, PubMed, arXiv, DOAJ, Europe PMC, Retraction Watch) |

## The film language (what makes it cinematic, and its limits)

- **Letterbox bars** close in at the start of each chapter and open at its end (8.5% of the screen, top and bottom), so a chapter feels like a shot. Content keeps out of the bars.
- **Film grain** (a static SVG noise, 7%, blended; not animated, so nothing flickers) and a soft **vignette**.
- **Chapter cards** in small spaced capitals ("Chapter II · The answer") and a **timecode** at the bottom right (`SC 4/8 · 00:01:27:07`, from the scroll position).
- **A scene strip** at the bottom (eight dashes, the current one longer and filling as you scroll; each is a button with its name).
- **Dark by default.** Light and read work (the app's tokens), but the film is made for dark.
- Kept from v2: one overshoot at most (the stamp), no sound, no auto-play except the caret, the scroll is never taken from you.

## How it is built (same engine as v2)

Each scene is a tall section with a sticky full-screen frame; one passive scroll listener asks for one animation frame; each scene turns its progress `p` into a few CSS variables (`--k`, `--ts`, `--pt`, `--r`, `--rg`, …) whose defaults are the finished state, so the stacked layout costs nothing. Only `transform`, `opacity`, `filter: blur` (title and push-in only), `clip-path` (the iris) and the canvas of scene 6 change per frame. The dust is sampled once per size from the real letters (font loaded first) and drawn only while scene 6 is on screen, at a pixel ratio of at most 2.

## Checked in the mock ([check-scroll-v3.mjs](poc/check-scroll-v3.mjs), 28 Oct 2026: `node docs/design/poc/check-scroll-v3.mjs`)

- axe (WCAG 2.2 AA): 0 violations at the end of all nine scenes in **dark, light and read**, in the **stacked layout on a phone** and with **reduced motion**. (A first run found that the big Devanagari watermark counted as text with no contrast; it is now drawn by CSS as decoration.)
- No sideways scroll at 1440 px or 390 px (a first run found the glows overflowing on a phone: fixed).
- Keyboard: the first Tab is "Skip the film"; the strip's buttons take you to their scene; the Playground opens and Escape closes it. No page errors.
- Phones and reduced motion get the stacked layout before first paint; without JavaScript the page is the stacked layout.

## Playground (mock only)

Theme (dark, light, read), Film or Stacked, Grain, Letterbox, a progress read-out per scene, scene length (60 to 150%), and jump buttons. Kept in this browser. Use it to decide: the length of the film, whether grain and letterbox stay, and dark-only or all three themes.

## Built into the app (28 Oct 2026, after your approval)

The intro page for signed-out visitors (`/`) is now the film: `apps/web/src/workspace/intro/` (`Film.tsx` the nine scenes, `engine.ts` the scroll engine, `IntroPage.tsx` the page), `apps/web/src/styles/intro.css`. What differs from the mock, and why:

- **The engine is the mock's, in TypeScript** (one passive scroll listener, one frame, CSS variables written on the elements; no React render per frame), not Motion's scroll timelines: it is smaller and the variables' defaults already give the stacked layout. Motion stays for the header's progress line.
- **The app's own header, sign-in and theme switch.** The title scene carries the way in (Continue with Google or ORCID, Try it without signing in), and so does the end. A button reached with the keyboard is always fully shown, wherever the scroll has left it.
- **Theme:** a visitor who has not chosen a theme sees the film dark, from the first paint (`public/theme-init.js`); Light or Read, when chosen, is kept; leaving the intro gives "Auto" back.
- **Two quiet sections before the end** that the film itself does not show: Idea Check and Literature scan ("Two more tools, same rules") and privacy ("Your work stays yours"). The header links go to "What it does", "Your papers" and "Privacy".
- **Fixes found by the app's own suites:** the cold open's words are either lit or an outline, never half way (a half-lit word failed contrast in the read theme at the top of the page), and the title no longer animates its letter-spacing (that was a layout shift at every scroll: the intro's layout shift went from 0.094 to 0.001).
- **Measured** (`e2e/perf.mjs`, 4× CPU, 1.6 Mbit/s): first paint 3.6 to 3.9 s, layout shift 0.001 (desktop) and 0.000 (phone). The intro chunk is 13.5 KB of script and 5.7 KB of style (gzip); the style budget was raised from 5 to 6 KB for it.
- **Tests:** `e2e/workspace.mjs` "intro: the film" (heading, dark default, nine scenes, scroll both ways, the way in, pinning, stamp, iris, dust and verdict, real counts, page turn, the strip, axe at the end of every scene in three themes, the quiet sections, theme choice kept, phone and reduced motion stacked); `smoke`, `default`, `offline` and `perf` suites pass with it.

## How it was planned (kept for the record)

As in [scroll-design-system.md §8](scroll-design-system.md): the scenes as components in `apps/web/src/workspace/intro/`, Motion's `useScroll` and `useTransform` through refs (no React state per frame), the stacked layout as the intro's existing static path, the dust canvas and the grain as lazy pieces, the budgets of `budget.mjs` and `perf.mjs` kept (first paint on the slow profile, CLS), and the copy reviewed by you. The sample data stays labelled.
