import { describe, expect, it } from "vitest";
import { MAX_CHAT_CHARS, cleanChatMessage, offlineRoute, ruleRoute } from "@scholar/shared";
import KEYWORDS_1702 from "./fixtures/oa-keywords-1702-a.json";
import { TREND, chipTextProblem, isGenericPhrase, phraseKey } from "@scholar/shared/src/trending";

/**
 * T7: a chip is a search phrase, not a fact. Its text is exactly the display name of an OpenAlex keyword, at most 36 characters, no URL, not digits-only, not small talk, and it passes
 * the same cleaner the chat box uses, unchanged (what is shown in the box is what is checked). A generic word is not a trend (T5).
 */

describe("chipTextProblem: what may become a chip's text", () => {
  it("accepts the keywords the first live test found", () => {
    for (const ok of ["retrieval-augmented generation", "tirzepatide", "AI governance", "hallucination mitigation", "generative AI", "world model", "vision-language-action", "diffusion language model", "T cell exhaustion", "Grad-CAM", "explainable machine learning", "IndoBERT", "C++ templates", "COVID-19 vaccines"]) {
      expect(chipTextProblem(ok), ok).toBeNull();
    }
  });

  it("takes at most 36 characters: the 36th is fine, the 37th is not", () => {
    expect(TREND.chipMax).toBe(36);
    expect(chipTextProblem("a".repeat(35) + "b")).toBeNull();
    expect(chipTextProblem("a".repeat(36))).toBeNull();
    expect(chipTextProblem("a".repeat(37))).toBe("length");
    expect(chipTextProblem("quantum error correction codes for qubits")).toBe("length");
  });

  it("counts the characters the page counts (UTF-16 units), so what is accepted here is accepted by the page", () => {
    expect(chipTextProblem("x".repeat(19) + String.fromCodePoint(0x1d11e).repeat(9))).toBe("length"); // 19 + 9 pairs = 37 units for 28 characters
  });

  it("needs at least 3 characters", () => {
    expect(chipTextProblem("abc")).toBeNull();
    expect(chipTextProblem("ab")).toBe("length");
    expect(chipTextProblem("")).toBe("length");
    expect(chipTextProblem("a")).toBe("length");
  });

  it("refuses what is not text", () => {
    for (const bad of [undefined, null, 5, {}, [], ["world model"], true, Symbol("x")]) expect(chipTextProblem(bad)).toBe("type");
  });

  it("refuses text that the chat box would change when sent: untidy spaces, tabs, line breaks, control characters", () => {
    for (const bad of [" world model", "world model ", "world  model", "world\tmodel", "world\nmodel", "world\u0000model", "world\u007fmodel"]) {
      const p = chipTextProblem(bad);
      expect(p, JSON.stringify(bad)).not.toBeNull();
      expect(["invisible", "not_clean"]).toContain(p);
    }
  });

  it("refuses invisible and direction characters, which no scan of the screen would show", () => {
    for (const cp of [0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202e, 0x2060, 0x2066, 0x2069, 0xfeff, 0x061c, 0xe0041]) expect(chipTextProblem(`world${String.fromCodePoint(cp)}model`), cp.toString(16)).toBe("invisible");
  });

  it("refuses text with no letters: digits only, symbols only, a year, a version", () => {
    for (const bad of ["2024", "12345", "3.14", "1,000", "2024-2025", "---", "+++", "(1)", "10 20"]) expect(chipTextProblem(bad), bad).toBe("no_letters");
  });

  it("keeps a name that has digits and letters", () => {
    for (const ok of ["5G networks", "GPT-4 evaluation", "Web 3.0", "H2 production", "3D bioprinting"]) expect(chipTextProblem(ok), ok).toBeNull();
  });

  it("refuses a URL, a domain name, an address, a DOI", () => {
    for (const bad of ["https://example.org/paper", "http://x.io", "www.example.com", "example.com", "arxiv.org/abs/2401.00001", "doi.org/10.1000/xyz", "user@example.com", "10.1038/s41586-024-07487-w", "ftp://files.example.net"]) expect(chipTextProblem(bad), bad).toBe("url");
  });

  it("keeps a name that only looks a little like one", () => {
    for (const ok of ["Node.js frameworks", "Vue.js components", "e.g. learning", "3.5 mm jack design"]) expect(chipTextProblem(ok), ok).toBeNull();
  });

  it("refuses small talk, which the page would answer with a greeting instead of a search", () => {
    for (const bad of ["hello", "Hello there", "thanks", "thank you", "help", "test", "testing", "good morning", "namaste", "who are you", "how are you", "ok", "cool"]) expect(chipTextProblem(bad), bad).not.toBeNull();
  });

  it("refuses generic words that are not a topic", () => {
    for (const bad of ["research", "Analysis", "study", "systematic review", "meta-analysis", "case study", "model", "machine learning", "artificial intelligence", "deep learning", "India", "China", "Africa", "women", "children", "students", "education", "health", "data", "technology", "innovation"]) {
      expect(chipTextProblem(bad), bad).toBe("generic");
    }
  });

  it("a name that is only two letters is too short before it is generic (AI, ML); the word is generic all the same", () => {
    expect(chipTextProblem("AI")).toBe("length");
    expect(isGenericPhrase("AI")).toBe(true);
    expect(isGenericPhrase("ML")).toBe(true);
  });

  it("is not fooled by case, hyphens or extra marks around a generic word", () => {
    for (const bad of ["RESEARCH", "Meta-Analysis", "meta analysis", "Case-Study", "Machine Learning", "India."]) expect(isGenericPhrase(bad), bad).toBe(true);
  });

  it("refuses a phrase that Auto would not search for a visitor who is not signed in (no model reads it for them): a cue of Idea Check, of Check references or of Ask a paper", () => {
    // "novelty detection" is a real OpenAlex keyword (4,803 works); pressed and sent in Auto by a visitor, it was an Idea Check offer, not papers, and the year filter was dropped
    for (const bad of ["novelty detection", "novelty search algorithms", "prior art search", "bibliography management", "reference list formatting", "citation check", "verify references", "check references automatically"]) {
      expect(offlineRoute(bad).mode, bad).not.toBe("search"); // (these are the cases the rule is for)
      expect(chipTextProblem(bad), bad).toBe("not_search");
    }
  });

  it("keeps a topic that merely contains a word of another tool, where the visitor's Auto still searches it (and a signed-in person's router reads a topic as a search)", () => {
    for (const ok of ["citation analysis", "citation networks", "research ideas", "idea generation", "reference management", "self-citation", "research proposal generation", "peer review"]) {
      expect(offlineRoute(ok).mode, ok).toBe("search");
      expect(chipTextProblem(ok), ok).toBeNull();
    }
  });

  it("every keyword of the recorded OpenAlex list that is a chip is a search as Auto settles it: by the rules alone or, where they leave it to the model, as the visitor's fallback does", () => {
    const names = (KEYWORDS_1702 as { group_by: { key_display_name: string }[] }).group_by.map((g) => g.key_display_name);
    const chips = names.filter((n) => chipTextProblem(n) === null);
    expect(chips.length).toBeGreaterThan(20);
    for (const text of chips) {
      const settled = ruleRoute(text);
      if (settled) expect(settled.mode, text).toBe("search");
      expect(offlineRoute(text).mode, text).toBe("search");
    }
  });

  it("accepts every text that passes the checks as something the chat box takes unchanged", () => {
    for (const ok of ["retrieval-augmented generation", "GPT-4 evaluation", "mRNA vaccine delivery"]) {
      expect(cleanChatMessage(ok)).toBe(ok);
      expect(ok.length).toBeLessThanOrEqual(MAX_CHAT_CHARS);
    }
  });

  it("does not throw on anything", () => {
    for (const bad of [new Proxy({}, { get() { throw new Error("x"); } }), Object.create(null), "\ud800", "x".repeat(10_000), "\u{10FFFF}"]) expect(() => chipTextProblem(bad)).not.toThrow();
  });
});

describe("phraseKey: the same phrase written two ways is one phrase", () => {
  it("ignores case, hyphens, slashes, brackets and spacing", () => {
    expect(phraseKey("Retrieval-Augmented Generation")).toBe("retrieval augmented generation");
    expect(phraseKey("retrieval augmented  generation")).toBe("retrieval augmented generation");
    expect(phraseKey("  Vision/Language-Action ")).toBe("vision language action");
    expect(phraseKey("AI governance.")).toBe("ai governance");
  });

  it("keeps the marks that make a name what it is", () => {
    expect(phraseKey("C++")).toBe("c++");
    expect(phraseKey("C#")).toBe("c#");
    expect(phraseKey("mRNA")).toBe("mrna");
  });

  it("keeps letters of other scripts", () => {
    expect(phraseKey("मशीन लर्निंग")).toBe("मशीन लर्निंग");
  });

  it("gives a string for anything, never throws", () => {
    for (const odd of [undefined, null, 5, {}, "", "\u0000"]) expect(typeof phraseKey(odd as unknown as string)).toBe("string");
  });
});
