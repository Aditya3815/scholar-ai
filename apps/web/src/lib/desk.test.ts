import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NOTE_COLORS, notesMarkdown, type DocNote } from "@scholar/shared";
import { WIDE_QUERY, fitView, isWide, startView, viewsFor } from "./desk";
import { MEANINGS, MEANING_LEGEND, MEANING_LIST } from "./meanings";

const store = (o: Record<string, string>) => (k: string) => (k in o ? o[k]! : null);

describe("the reader's layout rule (docs/design/paper-reader.md, 2.1)", () => {
  it("wide is 744 px wide and 520 px tall or more: tablets either way round and laptops; every phone, portrait or landscape, is not", () => {
    for (const [w, h] of [[1280, 800], [1440, 900], [1024, 768], [768, 1024], [834, 1112], [744, 1133], [1366, 600], [800, 520]] as const) expect(isWide(w, h), `${w}x${h}`).toBe(true);
    for (const [w, h] of [[390, 844], [844, 390], [932, 430], [667, 375], [743, 1000], [1280, 519], [360, 740]] as const) expect(isWide(w, h), `${w}x${h}`).toBe(false);
  });

  it("the hook and the style sheet use the same query", () => {
    expect(WIDE_QUERY).toBe("(min-width: 744px) and (min-height: 520px)");
    const css = readFileSync(fileURLToPath(new URL("../components/papers/desk/desk.css", import.meta.url)), "utf8");
    expect(css).toContain(`@media ${WIDE_QUERY}`);
    expect(css).toContain(`@media not all and ${WIDE_QUERY}`);
  });

  it("a phone is offered Paper and Notes only, never Split", () => {
    expect(viewsFor(true)).toEqual(["paper", "split", "notes"]);
    expect(viewsFor(false)).toEqual(["paper", "notes"]);
  });

  it("turning from wide to phone while in Split gives Paper; Paper and Notes stay; back to wide keeps what the phone had", () => {
    expect(fitView("split", false)).toBe("paper");
    expect(fitView("notes", false)).toBe("notes");
    expect(fitView("paper", false)).toBe("paper");
    expect(fitView("split", true)).toBe("split");
    expect(fitView(fitView("split", false), true)).toBe("paper");
  });

  it("starts with the view kept on this device (fitted to the screen), an old put-away side panel as Paper, else Split on wide and Paper on a phone", () => {
    expect(startView(store({}), true)).toBe("split");
    expect(startView(store({}), false)).toBe("paper");
    expect(startView(store({ "scholar.view": "notes" }), true)).toBe("notes");
    expect(startView(store({ "scholar.view": "split" }), false)).toBe("paper");
    expect(startView(store({ "scholar.view": "garbage" }), true)).toBe("split");
    expect(startView(store({ "scholar.focus": "1" }), true)).toBe("paper");
    expect(startView(store({ "scholar.focus": "closed" }), true)).toBe("paper");
    expect(startView(store({ "scholar.focus": "0" }), true)).toBe("split");
    // the new key wins over the old one: the old one is read only while there is no new one
    expect(startView(store({ "scholar.view": "split", "scholar.focus": "1" }), true)).toBe("split");
    expect(startView(() => { throw new Error("private mode"); }, true)).toBe("split");
  });
});

describe("the meanings of the highlight colours (docs/design/paper-reader.md, 5)", () => {
  it("yellow is Key idea, green Method, blue Question, pink Result, each with its letter and its token; the stored colours do not change", () => {
    expect(MEANING_LIST.map((m) => [m.color, m.name, m.letter, m.token])).toEqual([
      ["yellow", "Key idea", "K", "--mean-key"],
      ["green", "Method", "M", "--mean-method"],
      ["blue", "Question", "Q", "--mean-question"],
      ["pink", "Result", "R", "--mean-result"],
    ]);
    expect(MEANING_LIST.map((m) => m.color)).toEqual([...NOTE_COLORS]);
    expect(new Set(MEANING_LIST.map((m) => m.letter)).size).toBe(4);
    expect(MEANING_LEGEND).toEqual({ yellow: "Key idea", green: "Method", blue: "Question", pink: "Result" });
    expect(MEANINGS.blue.name).toBe("Question");
  });

  it("each token is defined in every theme (Light, Dark, Read and the system's dark) at 3:1 or more on --surface and --surface-2", () => {
    const css = readFileSync(fileURLToPath(new URL("../styles/tokens.css", import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const block = (sel: string, from = 0): Record<string, string> => {
      const at = css.indexOf(`${sel} {`, from);
      const body = css.slice(at, css.indexOf("}", at));
      return Object.fromEntries([...body.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!]));
    };
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
      return (x + 0.05) / (y + 0.05);
    };
    const light = block(":root");
    const themes: Record<string, Record<string, string>> = {
      light,
      dark: { ...light, ...block(':root[data-theme="dark"]') },
      read: { ...light, ...block(':root[data-theme="read"]') },
      system: { ...light, ...block(":root:not([data-theme])", css.indexOf("@media (prefers-color-scheme: dark)")) },
    };
    for (const [name, t] of Object.entries(themes)) {
      for (const m of MEANING_LIST) {
        const v = t[m.token.slice(2)]!;
        expect(v, `${name} ${m.token}`).toMatch(/^#[0-9a-f]{6}$/i);
        expect(ratio(v, t.surface!), `${name} ${m.token} on surface`).toBeGreaterThanOrEqual(3);
        expect(ratio(v, t["surface-2"]!), `${name} ${m.token} on surface-2`).toBeGreaterThanOrEqual(3);
      }
    }
    for (const m of MEANING_LIST) expect(themes.system![m.token.slice(2)]).toBe(themes.dark![m.token.slice(2)]);
  });

  it("with the meanings legend the highlights' Markdown names its sections by meaning; the default legend still names the colour", () => {
    const notes = [
      { id: "a", page: 2, quote: "a claim", note: "", color: "yellow", createdAt: 1, updatedAt: 1 },
      { id: "b", page: 3, quote: "how", note: "", color: "green", createdAt: 2, updatedAt: 2 },
    ] as unknown as DocNote[];
    const md = notesMarkdown("T", notes, { legend: MEANING_LEGEND, groupBy: "colour" });
    expect(md).toContain("## Key idea (yellow, 1)");
    expect(md).toContain("## Method (green, 1)");
    expect(notesMarkdown("T", notes, { groupBy: "colour" })).toContain("## Yellow (1)");
  });
});
