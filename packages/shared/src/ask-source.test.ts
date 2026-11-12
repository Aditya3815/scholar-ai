import { describe, expect, it } from "vitest";
import { classifyAskSource } from "@scholar/shared";

const H = [
  "What did I highlight about the sample size?",
  "Summarise my highlights",
  "summarize what i marked",
  "List my notes on the methods",
  "Which of my highlights are about limitations?",
  "what have I underlined?",
  "Show the yellow highlights",
  "What do my green highlights say?",
  "Which highlights have my notes on them?",
  "Where did I add a sticky note?",
  "Mere highlights ka summary do",
  "maine jo highlight kiya wo kya hai?",
  "mere notes me limitations kya hain",
  "peele highlights me kya likha hai",
  "मेरे हाइलाइट का सार बताओ",
  "मैंने क्या मार्क किया था?",
  "What annotations did I make on page 3?",
];
const P = [
  "What are the key highlights of this paper?",
  "What is the sample size?",
  "Summarise this paper in a few sentences",
  "What limitations do the authors mention?",
  "Which notes did the authors add to Table 2?",
  "The study marked a clear improvement; by how much?",
  "How does the paper highlight the role of cataract?",
  "I want to highlight the importance of screening: what does the paper say about it?",
  "How do I highlight text in this app?",
  "What did the authors note about the control group?",
  "paper ke main findings kya hain?",
  "इस पेपर का मुख्य निष्कर्ष क्या है?",
  "What is my confidence interval for the AUC?",
  "",
  "   ",
];

describe("classifyAskSource", () => {
  it.each(H)("is about the reader's highlights: %s", (q) => expect(classifyAskSource(q)).toBe("highlights"));
  it.each(P)("is about the paper: %j", (q) => expect(classifyAskSource(q)).toBe("paper"));
  it("a Devanagari word next to punctuation or a danda is still found", () => {
    expect(classifyAskSource("मेरे नोट्स क्या हैं?")).toBe("highlights");
    expect(classifyAskSource("मैंने जो हाइलाइट किया, वो बताओ।")).toBe("highlights");
  });
  it("a word that only contains a marking word is not one (notebook, remarkable, mine as in a mine)", () => {
    expect(classifyAskSource("My notebook ran the model; what was the learning rate?")).toBe("paper");
    expect(classifyAskSource("Is it remarkable that I see gains?")).toBe("paper");
  });
  it("never throws on odd input", () => {
    for (const q of ["\u0000", "(((", "highlight".repeat(5000), "मेरे".repeat(2000)]) expect(["paper", "highlights"]).toContain(classifyAskSource(q));
  });
});
