import { describe, expect, it } from "vitest";
import { detectLanguage } from "@scholar/shared";

/**
 * Which Try chips a visitor is offered and how each is sent (apps/web/src/workspace/starters.ts; docs/design/chatview-and-trending.md, C4). The list is one array the owner edits. It has to hold at least two
 * chips in Hinglish and two about India (the design note promised them), the English ones are searched as written, and a Hinglish one is sent through Auto and offered only to a person who is signed in:
 * on the live search of 4 Nov 2026 the Hinglish words as they stand found nothing in OpenAlex, and what Crossref gave was not about the topic ("What Does Pakistan Mean?: Pakistan Ka Matlab Kya?").
 */
type Mod = { STARTERS: string[]; startersFor: (signedIn: boolean) => string[]; starterMode: (t: string) => "search" | "auto"; inEnglish: (t: string) => boolean };
const load = async () => (await import("./starters")) as Mod;

describe("the Try chips and who is offered which", () => {
  it("has two or more chips in Hinglish and two or more about India, and no more than the 8 the design allows (the words are the owner's to change)", async () => {
    const { STARTERS } = await load();
    expect(STARTERS.filter((s) => detectLanguage(s) === "hinglish").length).toBeGreaterThanOrEqual(2);
    expect(STARTERS.filter((s) => /\bIndia\b|\bNEP\b|\bUPI\b|MGNREGA/.test(s)).length).toBeGreaterThanOrEqual(2);
    expect(STARTERS.length).toBeLessThanOrEqual(8);
  });

  it("a person who is signed in is offered every chip; anybody else only the ones the indexes can be asked as written", async () => {
    const { STARTERS, startersFor, inEnglish } = await load();
    expect(startersFor(true)).toEqual(STARTERS);
    const out = startersFor(false);
    expect(out.length).toBe(STARTERS.filter((s) => detectLanguage(s) === "en").length);
    expect(out.every((s) => detectLanguage(s) === "en" && inEnglish(s))).toBe(true);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(STARTERS.filter((s) => !out.includes(s)).every((s) => detectLanguage(s) === "hinglish")).toBe(true);
  });

  it("an English chip is a search chosen by hand (searched as written, as it always was); a Hinglish one goes through Auto", async () => {
    const { STARTERS, starterMode } = await load();
    for (const s of STARTERS) expect(starterMode(s), s).toBe(detectLanguage(s) === "en" ? "search" : "auto");
    expect(starterMode("graph neural networks")).toBe("search");
    expect(starterMode("diabetes me exercise ka kya asar hota hai")).toBe("auto");
    expect(starterMode("मधुमेह में व्यायाम का असर")).toBe("auto");
  });
});
