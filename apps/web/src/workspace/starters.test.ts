import { describe, expect, it } from "vitest";
import { cleanChatMessage, detectLanguage, isSmallTalk } from "@scholar/shared";
import { phraseKey } from "@scholar/shared/src/trending";

/**
 * The bundled "Try" chips of the Home page (apps/web/src/workspace/starters.ts): evergreen searches the owner chose, a different row from Trending and never called trending
 * (docs/design/chatview-and-trending.md, T2). A click sends one as a search chosen by hand (`sendMessage(text, "search", scope)`), so what a chip is held to is what that request is held to:
 *
 *   - the chat cleaner leaves it exactly as it is (`cleanChatMessage`: control characters and extra spaces out, 2 to 300 characters, a letter or a number in it), or the server would search
 *     other words than the chip says, or refuse it with a 400;
 *   - it is not small talk (`isSmallTalk`): a chip that reads like a greeting or a thanks is answered by the box with a greeting and is never searched, even for a search chosen by hand;
 *   - nothing invisible in it (a zero-width or direction character hides what is searched from the person's eyes), and no address, DOI or e-mail (a chip is a topic, not a link);
 *   - there are a few of them, each different from the others (a row of two chips that are the same phrase is a mistake).
 *
 * Not held to the 36 characters of a Trending chip (those are keywords of OpenAlex, set in a row of narrow chips; a Try chip is a sentence the owner wrote, and a Hinglish one is longer) and not to
 * the generic-word rule (that rule is about what a count can call rising). The live half is `scripts/trending-contract-live.mjs`: every chip is searched against the live product, weekly.
 */

/** Why a Try chip may not be a Try chip, or null when it may. */
function tryChipProblem(text: unknown): string | null {
  if (typeof text !== "string") return "not text";
  if (/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(text)) return "has a control, invisible or direction character";
  if (cleanChatMessage(text) !== text) return "the chat cleaner changes it (spaces, length 2 to 300, a letter or number)";
  if (!/\p{L}/u.test(text)) return "no letter";
  if (isSmallTalk(text)) return "reads as small talk: the box would answer it with a greeting";
  if (/(?:https?:|ftp:|\/\/|www\.|@)|\b10\.\d{4,}\//i.test(text)) return "an address, an e-mail or a DOI";
  return null;
}

async function bundled(): Promise<unknown> {
  const mod = (await import("./starters")) as Record<string, unknown>;
  return mod.STARTERS;
}

describe("the rule a Try chip is held to (so that it can fail)", () => {
  it("accepts topics: English, Hinglish, with an Indian context, with digits, with a hyphen", () => {
    for (const t of ["graph neural networks", "NEP 2020 higher education India", "CRISPR off-target effects", "diabetes me exercise ka kya asar hota hai", "UPI digital payments rural India", "Wnt/β-catenin signalling"]) {
      expect(tryChipProblem(t), t).toBeNull();
    }
  });

  it("refuses what the cleaner would change, what is not a topic and what the box answers by itself", () => {
    const bad: [unknown, RegExp][] = [
      ["hello", /small talk/],
      ["thanks a lot", /small talk/],
      ["what can you do", /small talk/],
      ["graph  neural networks", /cleaner/], // two spaces
      [" graph neural networks", /cleaner/],
      ["graph neural networks\n", /control|cleaner/],
      ["x", /cleaner/], // under 2 characters
      ["a".repeat(301), /cleaner/],
      ["graph\u200bneural networks", /invisible/], // zero-width space
      ["graph neural\u202enetworks", /invisible|direction/], // right-to-left override
      ["https://example.org/graph neural networks", /address/],
      ["10.1000/xyz123 graph networks", /address/],
      [42, /not text/],
      [undefined, /not text/],
    ];
    for (const [t, why] of bad) expect(tryChipProblem(t), String(t)).toMatch(why);
    // digits only: the cleaner accepts it (a number is enough for it), the letter rule does not
    expect(cleanChatMessage("2020")).toBe("2020");
    expect(tryChipProblem("2020")).toMatch(/letter/);
  });
});

describe("every bundled Try chip", () => {
  it("is a list of a few distinct texts (2 to 8: the design's limit, stated in starters.ts)", async () => {
    const list = await bundled();
    expect(Array.isArray(list), "apps/web/src/workspace/starters.ts must export STARTERS as a list of texts: if it was renamed or reshaped, this test reads the new name").toBe(true);
    const chips = list as unknown[];
    expect(chips.length).toBeGreaterThanOrEqual(2);
    expect(chips.length).toBeLessThanOrEqual(8);
    expect(new Set(chips.map((c) => phraseKey(c))).size).toBe(chips.length);
  });

  it("passes the rules of a chip that is sent as a search chosen by hand: the cleaner leaves it as it is, it is not small talk, nothing is invisible, no address", async () => {
    const chips = (await bundled()) as unknown[];
    const problems = chips.map((c) => [c, tryChipProblem(c)] as const).filter(([, p]) => p !== null);
    expect(problems).toEqual([]);
  });

  it("is one the box would search, in the language the page expects of it (a language is detected, not required)", async () => {
    const chips = (await bundled()) as string[];
    for (const c of chips) expect(["en", "hi", "hinglish", "other"]).toContain(detectLanguage(c));
  });
});
