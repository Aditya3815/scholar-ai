# Motion for the icons the app already has (1 Nov 2026)

The owner asked for a small animation on every icon when it is hovered, on the icons the app already draws (about 60 different Lucide icons, in 57 places), not on new ones. The research
([rive-ideas.md](rive-ideas.md)) found that a Rive file per icon would cost about 450 KB of runtime for what CSS does for nothing, so this is CSS: [icons.css](../../apps/web/src/styles/icons.css),
tested by [e2e/icons.mjs](../../apps/web/e2e/icons.mjs) (36 checks). No JavaScript, nothing to download (the style sheet grew by about 0.8 KB gzip).

## How it reaches every icon without touching the 57 places

Lucide puts `lucide lucide-<name>` on every svg it draws, so a rule for `.lucide-bell` reaches the bell wherever it is. The rules apply only to an icon **inside something pressable** (a button,
a link, a summary, an element with role button, tab or menuitem) that is not disabled or `aria-disabled`; an icon that is only a picture in a heading never moves. Only `transform` and
`opacity` change, so nothing is laid out again (checked: the button's box does not change on hover).

## What each does

| When | What |
|---|---|
| hovered with a mouse, or focused with the keyboard | the icon does what suits it (below); an icon with no character of its own lifts 1 px |
| pressed (mouse, finger, or Space) | the icon shrinks to 86%; this is the only motion a touch screen gets (a finger has no hover) |
| the app swaps one icon for another because a state changed (Copy becomes Check, Bookmark becomes BookmarkCheck) | the Check is **drawn** as a line in 0.28 s inside a button; a bookmark that has become checked pops in |
| a toggle is switched on (`aria-pressed` becomes true) | a bell is filled and rings once; a bookmark is filled and pops |

| Icon | On hover or focus |
|---|---|
| arrow right, chevron right, log in | nudges 3 px to the right |
| log out | nudges 3 px to the left |
| arrow up (send) | rises 2.4 px |
| chevron down | drops 2.1 px |
| send | goes up and right |
| plus, x | turns a quarter |
| search | grows 12% and tilts |
| pencil, highlighter | tilts, as if about to write |
| link | tilts 18 degrees |
| copy | the front sheet comes forward |
| sparkles | grows and turns 14 degrees |
| shield check | grows 10% |
| bin | tilts 10 degrees |
| file up | rises 2 px |
| bell | rings once (a swing that dies away, 0.64 s, from the top) |
| download | the arrow dips once |
| eye | blinks once |
| every other icon | lifts 1 px |

## Rules that make it safe

1. **Reduced motion:** the whole kit is inside `prefers-reduced-motion: no-preference`; with reduced motion nothing here applies (tested: a hovered arrow stays where it is, the bell does not ring, a check is not drawn).
2. **Touch:** hover rules are inside `(hover: hover) and (pointer: fine)`; a tap does not leave an icon nudged.
3. **Keyboard:** `:focus-visible` gets what the mouse gets; Space pressed shrinks the icon as a mouse press does.
4. **Tuning:** five numbers at the top of the file set the feel (`--ico-time`, `--ico-nudge`, `--ico-lift`, `--ico-press`, `--ico-ring`); the look and the amount of movement are the owner's call.

## Not done

- The animation of an icon that is drawn in several parts (the bin's lid lifting, the bell's clapper) needs the svg's paths addressed one by one; whole-icon motion was chosen as it is robust to Lucide's changes.
- A real phone was not used: the touch behaviour was tested with the browser's phone emulation.
