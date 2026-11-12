import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { positionOfVariable } from "../platform/switches";
import { HELPLINE_CHECKED, HELPLINES, allLaneSentences, helplineProblems, noticeText, replyText, type LaneLang } from "./lane-text";

/**
 * The fixed sentences of the safety lane (docs/design/intent-and-state.md, 5.1) and the one constant that guards the numbers in them (4.5: "The numbers in the sentences are a precondition, not a todo").
 * 112 and Tele-MANAS 14416 are from memory and not checked on an official page; while `HELPLINE_CHECKED` is null no sentence may carry a digit, and CHAT_SAFETY may not stand above `shadow` in the
 * committed wrangler.jsonc. The sentences that ship with the numbers are pinned to the plan's own text, which this test reads from the plan, so that a word of one that was changed here is seen.
 */
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const LANGS: LaneLang[] = ["en", "hinglish", "hi"];

describe("while HELPLINE_CHECKED is null, no safety sentence holds a digit", () => {
  it("is null today: nothing has been read off an official page", () => {
    expect(HELPLINE_CHECKED).toBeNull();
  });

  it("not one sentence, in any language, for any reply or line, has a digit, 112 or 14416 (the null variant is the one that ships)", () => {
    const all = allLaneSentences(false);
    // eight sentences in English and Hinglish, the two replies that were written in Hindi, and the line for a decision as a hand-chosen search has it
    expect(all.length).toBe(20);
    for (const s of all) {
      expect(s, s).not.toMatch(/\p{N}/u);
      expect(s).not.toContain("112");
      expect(s).not.toContain("14416");
    }
    // and what the lane gives out today is that variant, whatever way it is asked
    for (const lang of ["en", "hinglish", "hi", "other"] as const) {
      for (const r of ["crisis", "urgent", "help"] as const) expect(replyText(r, lang)).toBe(replyText(r, lang, false));
    }
  });

  it("the development build with the constant null says 'your local emergency number' and no number", () => {
    expect(replyText("urgent", "en")).toContain("your local emergency number");
    expect(replyText("urgent", "en")).not.toMatch(/\p{N}/u);
    expect(replyText("crisis", "en")).toContain("your local emergency number");
    expect(replyText("urgent", "hinglish")).toContain("local emergency number");
    expect(replyText("urgent", "hi")).toContain("आपातकालीन नंबर");
  });

  it("the check itself works: a sentence with a digit is found while the constant is null, and not once it is set", () => {
    expect(helplineProblems(["call 112 now"], null)).toEqual(["call 112 now"]);
    expect(helplineProblems(["call your local emergency number"], null)).toEqual([]);
    expect(helplineProblems(["call 112 now"], { date: "2026-11-05", emergency: "the official page", teleManas: "the official page" })).toEqual([]);
  });
});

describe("CHAT_SAFETY may not stand above shadow in the committed wrangler.jsonc while HELPLINE_CHECKED is null", () => {
  // read the way scripts/integration.mjs and legal-match.test.ts read the file: whole-line comments dropped, then JSON
  const varsOf = (text: string): Record<string, unknown> => (JSON.parse(text.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n")) as { vars?: Record<string, unknown> }).vars ?? {};
  /** The problems with a config: the flag stands above shadow, and no number has been checked. */
  const above = (vars: Record<string, unknown>, checked: unknown): string[] => {
    const { position } = positionOfVariable(vars.CHAT_SAFETY, true);
    return (position === "core" || position === "on") && checked === null ? [`CHAT_SAFETY is ${position} while HELPLINE_CHECKED is null`] : [];
  };

  it("the committed config is read, and it does not set the flag above shadow (it does not set it at all: nothing leaves off in this release)", () => {
    const vars = varsOf(read("../../wrangler.jsonc"));
    expect(vars.EXPECT_CRON).toBe("1"); // the right file, and the right block
    expect(above(vars, HELPLINE_CHECKED)).toEqual([]);
    expect(vars.CHAT_SAFETY).toBeUndefined();
  });

  it("fails for core and for on, passes for off and shadow and for unset, and passes at core once the numbers were checked", () => {
    expect(above({ CHAT_SAFETY: "core" }, null)).toHaveLength(1);
    expect(above({ CHAT_SAFETY: "on" }, null)).toHaveLength(1);
    for (const v of [undefined, "off", "shadow"]) expect(above({ CHAT_SAFETY: v }, null), String(v)).toEqual([]);
    expect(above({ CHAT_SAFETY: "core" }, { date: "d" })).toEqual([]);
    // a value that is not a position is off, which the Worker reads the same way
    expect(above({ CHAT_SAFETY: "CORE" }, null)).toEqual([]);
  });

  it("the check reads the real file's own text: a line of a committed variable is not a comment", () => {
    const text = read("../../wrangler.jsonc");
    expect(text).toMatch(/"vars":\s*\{/);
    expect(varsOf(text.replace('"vars": {', '"vars": { "CHAT_SAFETY": "core",')).CHAT_SAFETY).toBe("core");
  });
});

/* ---------------------------------------------------------------- the plan's own words */

type Plan = Record<string, string>;
/** Section 5.1 of the plan: every sentence by its name and language, as the plan writes it (a button in square brackets is not part of the text; " / " is the break between its two paragraphs). */
function planSentences(): Plan {
  const doc = read("../../../../docs/design/intent-and-state.md");
  const section = doc.slice(doc.indexOf("### 5.1 Safety (R4)"), doc.indexOf("### 5.2 Not a search (R10)"));
  const out: Plan = {};
  let name = "";
  for (const line of section.split("\n")) {
    const head = /^\*\*(S-[A-Z-]+)\*\*/.exec(line);
    if (head) name = head[1]!;
    const m = /^- (EN|Hinglish|Hindi)(?: (urgent|crisis))?: (.*)$/.exec(line);
    if (!m) continue;
    const key = `${m[2] ? `S-${m[2].toUpperCase()}-NOTE` : name}|${m[1]}`;
    out[key] = m[3]!.replace(/\s*\[[^\]]+\]\s*$/, "").replace(/ \/ /g, "\n\n");
  }
  return out;
}
const LANG_OF: Record<string, LaneLang> = { EN: "en", Hinglish: "hinglish", Hindi: "hi" };

describe("the sentences with their numbers (what ships once the numbers are checked) are the plan's text, word for word", () => {
  const plan = planSentences();
  const marked = (key: string) => plan[key];
  it("the plan's section 5.1 was found: eight sentences in English and in Hinglish", () => {
    for (const s of ["S-ACUTE", "S-CRISIS", "S-HELP", "S-DECISION", "S-CARE", "S-DISTRESS", "S-URGENT-NOTE", "S-CRISIS-NOTE"]) {
      expect(marked(`${s}|EN`), s).toBeTypeOf("string");
      expect(marked(`${s}|Hinglish`), s).toBeTypeOf("string");
    }
  });

  const REPLY: [string, "urgent" | "crisis" | "help"][] = [["S-ACUTE", "urgent"], ["S-CRISIS", "crisis"], ["S-HELP", "help"]];
  for (const [name, reply] of REPLY) {
    for (const [word, lang] of Object.entries(LANG_OF)) {
      it(`${name} in ${word}`, () => {
        const text = marked(`${name}|${word}`);
        if (text === undefined || /^to be written/.test(text)) {
          // a Hindi sentence that is not yet written falls back to the Hinglish one, never to the English one
          expect(replyText(reply, lang, true)).toBe(marked(`${name}|Hinglish`));
        } else expect(replyText(reply, lang, true)).toBe(text);
      });
    }
  }
  const NOTES: [string, "safety_decision" | "safety_care" | "safety_urgent" | "safety_crisis", string][] = [
    ["S-DECISION", "safety_decision", "decision"],
    ["S-URGENT-NOTE", "safety_urgent", ""],
    ["S-CRISIS-NOTE", "safety_crisis", ""],
  ];
  for (const [name, kind] of NOTES) {
    for (const [word, lang] of Object.entries(LANG_OF)) {
      it(`${name} in ${word}`, () => {
        const text = marked(`${name}|${word}`);
        const have = noticeText(kind, lang, { auto: true, careKind: null, checked: true });
        if (text === undefined || /^to be written/.test(text)) expect(have).toBe(marked(`${name}|Hinglish`));
        else expect(have).toBe(text);
      });
    }
  }
  for (const [name, careKind] of [["S-CARE", "health"], ["S-DISTRESS", "distress"]] as const) {
    for (const [word, lang] of Object.entries(LANG_OF)) {
      it(`${name} in ${word}`, () => {
        const text = marked(`${name}|${word}`);
        const have = noticeText("safety_care", lang, { auto: true, careKind, checked: true });
        if (text === undefined || /^to be (written|re-read|re-written)/.test(text)) expect(have).toBe(marked(`${name}|Hinglish`));
        else expect(have).toBe(text);
      });
    }
  }

  it("a search chosen by hand keeps its written answer, so the decision line there does not say that no answer was written (the one change to the plan's sentence)", () => {
    const auto = noticeText("safety_decision", "en", { auto: true, careKind: null, checked: true });
    const hand = noticeText("safety_decision", "en", { auto: false, careKind: null, checked: true });
    expect(auto).toMatch(/no answer was written/);
    expect(hand).not.toMatch(/no answer was written/);
    expect(hand).toBe("I cannot say what is right for you to take. A doctor or pharmacist can. These papers are about the topic, not about your case.");
    expect(noticeText("safety_decision", "hinglish", { auto: false, careKind: null, checked: true })).not.toMatch(/koi jawab nahi likha gaya/);
    expect(noticeText("safety_decision", "hinglish", { auto: false, careKind: null, checked: true })).toMatch(/aapke case par nahi/);
  });
});

describe("the voice and the shape", () => {
  it("Hinglish has neutral verbs: no raha, rahi or rahe, which tell the speaker's gender (the page speaks about this box)", () => {
    for (const s of allLaneSentences(true)) {
      if (/[ऀ-ॿ]/.test(s)) continue;
      // the Hinglish ones are the sentences that have a Roman-letter Hindi word of the list below; the English ones have none of these words
      expect(s.toLowerCase(), s).not.toMatch(/(^|[^a-z])(raha|rahi|rahe)([^a-z]|$)/);
    }
  });

  it("the replies lead with what to do, in the first paragraph; the card's second paragraph is the line on how to look up research", () => {
    for (const lang of LANGS) {
      const acute = replyText("urgent", lang, false);
      expect(acute.split("\n\n")).toHaveLength(1);
      for (const r of ["crisis", "help"] as const) {
        const parts = replyText(r, lang, false).split("\n\n");
        expect(parts, `${r} ${lang}`).toHaveLength(2);
        expect(parts[1]!.length).toBeLessThan(parts[0]!.length);
      }
    }
    expect(replyText("crisis", "en", false).split("\n\n")[1]).toBe("To look up research on this topic, choose Search papers and write the topic.");
    expect(replyText("help", "en", false).split("\n\n")[1]).toBe("To look something up, write the topic.");
  });

  it("a language the rules do not know (another script) gets the English sentence, and Hindi falls back to Hinglish where no Hindi was written", () => {
    expect(replyText("urgent", "other" as never, false)).toBe(replyText("urgent", "en", false));
    expect(replyText("help", "hi", false)).toBe(replyText("help", "hinglish", false));
    expect(noticeText("safety_care", "hi", { auto: true, careKind: "health", checked: false })).toBe(noticeText("safety_care", "hinglish", { auto: true, careKind: "health", checked: false }));
    // Hindi that was written is Hindi
    expect(replyText("urgent", "hi", false)).not.toBe(replyText("urgent", "hinglish", false));
    expect(replyText("crisis", "hi", false)).not.toBe(replyText("crisis", "hinglish", false));
  });

  it("holds the two numbers in one place, and nowhere else in the sentences", () => {
    expect(HELPLINES).toEqual({ emergency: "112", teleManas: "14416" });
    for (const lang of LANGS) {
      expect(replyText("crisis", lang, true)).toContain("112");
      expect(replyText("crisis", lang, true)).toContain("14416");
      expect(replyText("urgent", lang, true)).toContain("112");
      expect(replyText("urgent", lang, true)).not.toContain("14416");
    }
  });
});
