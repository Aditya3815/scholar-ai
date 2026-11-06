import { describe, expect, it } from "vitest";
import { greetingKind, isGreeting, normaliseGreeting } from "./greeting";

describe("isGreeting: the whole message is social", () => {
  const yes = [
    "HY", "Hy", "hy", "hi", "Hi!", "hii", "hiiii", "hlo", "Hlo bhai", "helo", "hello", "Hello sir", "hellow", "hey", "heyy", "heyyyy 👋", "Hey there", "yo",
    "gm", "good morning", "Good morning sir", "gud mrng", "good night", "gn", "good evening",
    "thanks", "thnx", "thx", "thank you", "thank u", "Thanks bhai", "thanks a lot", "tysm", "shukriya", "dhanyavad", "bahut shukriya",
    "ok", "okk", "okay", "cool", "nice", "accha", "theek hai", "bye", "bye bye", "tata", "take care",
    "how are you", "how r u", "how are you doing?", "kaise ho", "kaise ho bhai", "aap kaise ho", "kya haal hai", "Aur batao sab badhiya?", "aur batao", "sab badhiya?", "kya chal raha hai",
    "what's up", "whats up", "sup",
    "tum kya kar sakte ho?", "aap kya kar sakte ho", "what can you do?", "who are you", "are you chatgpt?", "who made you", "tum kaun ho", "ye kya hai",
    "नमस्ते", "नमस्ते जी", "धन्यवाद", "शुक्रिया", "आप कैसे हैं?", "आप कौन हैं", "आप क्या कर सकते हैं?", "क्या हाल है", "और बताओ सब बढ़िया", "हाय",
  ];
  for (const m of yes) it(`"${m}"`, () => expect(isGreeting(m)).toBe(true));
});

describe("isGreeting: a single real word makes it a request", () => {
  const no = [
    "hi, papers on dengue", "hello can you find studies on sleep", "thanks, now show malaria vaccine papers", "hey HIV prevention", "HIV", "CNN", "BERT", "AI", "papers", "research",
    "hi HPV", "good morning yoga benefits", "kaise kaam karta hai CRISPR", "transformers kya hote hain?", "how are vaccines made", "who are the authors of attention is all you need",
    "what is this protein", "thanks bhai, ab diffusion models for MRI", "tum kya kar sakte ho diabetes ke liye", "aur batao diabetes ke baare mein", "covid 2020", "hello world dataset",
    "नमस्ते, मधुमेह पर शोध", "bye bye bias in hiring", "ok google",
  ];
  for (const m of no) it(`"${m}"`, () => expect(isGreeting(m)).toBe(false));
});

describe("normaliseGreeting", () => {
  it("maps phone spellings and cuts repeated letters", () => {
    expect(normaliseGreeting("HYYY!!")).toBe("hi");
    expect(normaliseGreeting("Thnx bhai 🙏")).toBe("thanks bhai");
    expect(normaliseGreeting("gud mrng")).toBe("goodmorning");
    expect(normaliseGreeting("what's up")).toBe("whats up");
  });
  it("is total", () => {
    expect(isGreeting("")).toBe(false);
    expect(isGreeting("   ")).toBe(false);
    expect(isGreeting("x".repeat(500))).toBe(false);
    expect(isGreeting(undefined as unknown as string)).toBe(false);
  });
});

describe("greetingKind", () => {
  it("tells the kinds apart", () => {
    expect(greetingKind("HY")).toBe("hello");
    expect(greetingKind("thanks bhai")).toBe("thanks");
    expect(greetingKind("bye")).toBe("bye");
    expect(greetingKind("Aur batao sab badhiya?")).toBe("how_are_you");
    expect(greetingKind("tum kya kar sakte ho?")).toBe("about");
    expect(greetingKind("आप कौन हैं")).toBe("about");
    expect(greetingKind("धन्यवाद")).toBe("thanks");
  });
});
