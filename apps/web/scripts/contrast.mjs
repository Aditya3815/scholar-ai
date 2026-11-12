// WCAG contrast of the text and background pairs of every theme (docs/design/UI-direction.md: "every text/background pair is checked"), read from the theme colours themselves,
// src/styles/tokens.css: `:root` is Light, `:root[data-theme="<name>"]` overrides it for that theme, and `:root:not([data-theme])` inside `@media (prefers-color-scheme: dark)` is the
// dark look of a person who has not picked a theme (checked on its own, as it is a copy of Dark).
//   npm run contrast -w apps/web       exits 1 on a pair under its minimum that is not in ALLOWED, on an ALLOWED entry that passes, or on a colour it cannot read
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TOKENS = fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url));

/** [foreground, background, minimum ratio]: 4.5 is WCAG AA for body text; a border is decorative (1.0 only says it is drawn at all). */
const PAIRS = [
  ["text", "bg", 4.5], ["text", "surface", 4.5], ["text", "surface-2", 4.5],
  ["muted", "bg", 4.5], ["muted", "surface", 4.5], ["muted", "surface-2", 4.5],
  ["accent", "bg", 4.5], ["accent", "surface", 4.5], ["accent", "accent-soft", 4.5], ["accent-fg", "accent", 4.5],
  ["ok", "surface", 4.5], ["warn", "surface", 4.5], ["warn", "surface-2", 4.5], ["danger", "surface", 4.5],
  ["danger", "bg", 4.5], ["ok", "surface-2", 4.5], ["danger", "surface-2", 4.5], ["danger-fg", "danger", 4.5], ["border", "bg", 1.0],
];

/**
 * Pairs that were under their minimum when this check began to fail the build (owner decision 17 of docs/design/untangle.md: an allowlist of that day's failures, the colours
 * later), as "<theme>: <fg> on <bg>". On 12 Nov 2026 there were none. An entry may only be removed: a new failure fails, and so does an entry whose pair passes again.
 */
const ALLOWED = [];

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** The custom properties of the first rule `selector { ... }` in the CSS, as { name: value }, or null when there is no such rule. */
function block(css, selector) {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return null;
  const body = css.slice(at + selector.length + 2, css.indexOf("}", at));
  return Object.fromEntries([...body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const css = readFileSync(TOKENS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const light = block(css, ":root");
const media = css.indexOf("@media (prefers-color-scheme: dark)");
const systemDark = media < 0 ? null : block(css.slice(media), ":root:not([data-theme])");
const themes = light
  ? {
      light,
      ...Object.fromEntries([...css.matchAll(/:root\[data-theme="([\w-]+)"\]\s*\{/g)].map((m) => [m[1], { ...light, ...block(css, `:root[data-theme="${m[1]}"]`) }])),
      ...(systemDark ? { "dark (system)": { ...light, ...systemDark } } : {}),
    }
  : {};

const problems = light ? [] : [`no :root rule in ${TOKENS}`];
const allowedSeen = new Set();
const hex = (v) => /^#[0-9a-f]{6}$/i.test(v ?? "");
for (const [name, t] of Object.entries(themes)) {
  console.log(`\n${name}`);
  for (const [fg, bg, min] of PAIRS) {
    if (!hex(t[fg]) || !hex(t[bg])) {
      problems.push(`${name}: --${fg} (${t[fg]}) or --${bg} (${t[bg]}) is not a #rrggbb colour this check can read`);
      continue;
    }
    const r = ratio(t[fg], t[bg]);
    const ok = r >= min;
    const id = `${name}: ${fg} on ${bg}`;
    const allowed = !ok && ALLOWED.includes(id);
    if (allowed) allowedSeen.add(id);
    else if (!ok) problems.push(`${id} is ${r.toFixed(2)}, under ${min}`);
    console.log(`  ${ok ? "ok " : allowed ? "LOW (allowed)" : "LOW"} ${fg.padEnd(11)} on ${bg.padEnd(11)} ${r.toFixed(2)}${min > 1 ? "" : " (decorative)"}`);
  }
}
for (const id of ALLOWED) if (!allowedSeen.has(id)) problems.push(`"${id}" is in ALLOWED but does not fail: take it out of the list`);

console.log(`\nthemes: ${Object.keys(themes).join(", ")}; failures: ${problems.length}${allowedSeen.size ? ` (and ${allowedSeen.size} allowed)` : ""}`);
for (const p of problems) console.log(` FAIL  ${p}`);
process.exit(problems.length ? 1 : 0);
