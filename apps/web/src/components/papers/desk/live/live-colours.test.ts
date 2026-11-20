import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LIVE_COLOURS } from "@scholar/shared";

/**
 * The presence colours (docs/design/paper-live.md, 1: "a fixed palette of 6 token colours that pass contrast"), read from live.css, in each theme: the initial on its avatar and the name on
 * "Ravi is editing" (text, 4.5:1), and the avatar, the dots and the block's edge on the surfaces they sit on (not text, WCAG 1.4.11's 3:1). The surfaces are tokens.css's.
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const LIVE = read("./live.css");
const TOKENS = read("../../../../styles/tokens.css");

function block(css: string, selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no ${selector}`);
  const body = css.slice(at + selector.length + 2, css.indexOf("}", at));
  return Object.fromEntries([...body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};
const systemDark = (css: string) => block(css.slice(css.indexOf("@media (prefers-color-scheme: dark)")), ":root:not([data-theme])");

const THEMES: Record<string, { live: Record<string, string>; tokens: Record<string, string> }> = {
  light: { live: block(LIVE, ":root"), tokens: block(TOKENS, ":root") },
  dark: { live: block(LIVE, ':root[data-theme="dark"]'), tokens: { ...block(TOKENS, ":root"), ...block(TOKENS, ':root[data-theme="dark"]') } },
  read: { live: block(LIVE, ':root[data-theme="read"]'), tokens: { ...block(TOKENS, ":root"), ...block(TOKENS, ':root[data-theme="read"]') } },
  "dark (system)": { live: systemDark(LIVE), tokens: { ...block(TOKENS, ":root"), ...systemDark(TOKENS) } },
};

describe("the presence colours pass contrast in every theme", () => {
  for (const [name, t] of Object.entries(THEMES)) {
    it(name, () => {
      const bad: string[] = [];
      for (let i = 0; i < LIVE_COLOURS; i++) {
        const c = t.live[`lv-${i}`]!;
        expect(c, `--lv-${i} in ${name}`).toMatch(/^#[0-9a-f]{6}$/i);
        if (ratio(t.live["lv-fg"]!, c) < 4.5) bad.push(`initial on --lv-${i}: ${ratio(t.live["lv-fg"]!, c).toFixed(2)}`);
        for (const surface of ["surface", "surface-2", "bg"]) if (ratio(c, t.tokens[surface]!) < 3) bad.push(`--lv-${i} on --${surface}: ${ratio(c, t.tokens[surface]!).toFixed(2)}`);
      }
      expect(bad).toEqual([]);
    });
  }
  it("has one class a colour", () => {
    for (let i = 0; i < LIVE_COLOURS; i++) expect(LIVE).toContain(`.lv-c${i} { --lv: var(--lv-${i}); }`);
  });
});
