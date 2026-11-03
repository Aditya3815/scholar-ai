import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SMALL_TALK_REPLY, cleanAutoMessage, detectLanguage, hasDependencyCue, isSmallTalk, languageWithContext, looksLikeReferenceList, needsContext, offlineRoute, ruleRoute, smallTalkReply } from "@scholar/shared";
// the router's labelled messages: the first-turn behaviour is pinned by running every one of them through both signatures
// @ts-expect-error a script, not a typed module
import { CASES, HOLDOUT } from "../../scripts/router-cases.mjs";

const ONE = { turns: 1 };
const ALL: [string, unknown, string][] = [...CASES, ...HOLDOUT];

/**
 * What the first-turn functions give for one message. The same function wrote `first-turn.golden.json` from the code of the commit before this release (it is in `producedFrom` there), so a
 * line of the file is what a first message got then.
 */
const firstTurn = (text: string) => {
  const language = detectLanguage(text);
  const rule = ruleRoute(text);
  const clean = cleanAutoMessage(text);
  const talk = isSmallTalk(text);
  return JSON.parse(JSON.stringify({ text, language, rule, ...(rule ? {} : { offline: offlineRoute(text) }), ...(clean === text ? {} : { clean }), refs: looksLikeReferenceList(text), talk, ...(talk ? { reply: smallTalkReply(text, language) } : {}) }));
};

describe("a first message gets what it got before the release (the answers of the last commit before it, kept in first-turn.golden.json)", () => {
  const golden = JSON.parse(readFileSync(fileURLToPath(new URL("./first-turn.golden.json", import.meta.url)), "utf8")) as { count: number; entries: { text: string; rule?: unknown; talk: boolean; refs: boolean }[] };

  it("the list is real: the labelled router messages and more, with messages the rules settle, small talk, a reference list and the rest that go to the model", () => {
    expect(golden.entries).toHaveLength(golden.count);
    expect(golden.count).toBeGreaterThanOrEqual(390);
    expect(new Set(golden.entries.map((e) => e.text)).size).toBe(golden.count);
    for (const [text] of ALL) expect(golden.entries.some((e) => e.text === text), text).toBe(true);
    expect(golden.entries.filter((e) => e.rule).length).toBeGreaterThan(100);
    expect(golden.entries.filter((e) => !e.rule).length).toBeGreaterThan(100);
    expect(golden.entries.filter((e) => e.talk).length).toBeGreaterThan(40);
    expect(golden.entries.some((e) => e.refs)).toBe(true);
  });

  it("every message gets the same route, the same language, the same small-talk verdict and the same small-talk reply, word for word, as the commit before the release gave", () => {
    const changed = golden.entries.filter((e) => JSON.stringify(firstTurn(e.text)) !== JSON.stringify(e)).map((e) => e.text);
    expect(changed).toEqual([]);
  });
});

describe("with no context every result is exactly what it was", () => {
  it("ruleRoute, isSmallTalk and smallTalkReply give the same for no argument, undefined and no earlier turns, over every labelled router message", () => {
    expect(ALL.length).toBeGreaterThan(200);
    for (const [text, , lang] of ALL) {
      const plain = JSON.stringify(ruleRoute(text));
      expect(JSON.stringify(ruleRoute(text, undefined))).toBe(plain);
      expect(JSON.stringify(ruleRoute(text, { turns: 0 }))).toBe(plain);
      const talk = isSmallTalk(text);
      expect(isSmallTalk(text, undefined)).toBe(talk);
      expect(isSmallTalk(text, { turns: 0 })).toBe(talk);
      const language = detectLanguage(text);
      const reply = smallTalkReply(text, language);
      expect(smallTalkReply(text, language, undefined)).toBe(reply);
      expect(smallTalkReply(text, language, { turns: 0 })).toBe(reply);
      expect(lang).toBeTruthy();
    }
  });

  it("a context can only hold back what the rules settle or the small-talk gate swallows, never settle or swallow more, or change what it settles", () => {
    for (const [text] of ALL) {
      const plain = ruleRoute(text);
      const withContext = ruleRoute(text, ONE);
      if (withContext) expect(JSON.stringify(withContext)).toBe(JSON.stringify(plain));
      if (isSmallTalk(text, ONE)) expect(isSmallTalk(text)).toBe(true);
    }
  });

  it("the plain-search settling of the first turn is untouched: a pasted list of references and a bare DOI do not need the earlier turns either", () => {
    const refs = "[1] LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521, 436-444.\n[2] Vaswani, A., Shazeer, N., Parmar, N., et al. (2017). Attention is all you need. NeurIPS.\n[3] Krizhevsky, A., Sutskever, I., & Hinton, G. E. (2012). ImageNet classification with deep convolutional neural networks. NIPS.";
    expect(ruleRoute(refs, ONE)).toMatchObject({ mode: "verify", how: "rules", confidence: 1 });
    expect(ruleRoute("10.1038/nature14539", ONE)).toMatchObject({ mode: "search", how: "rules", confidence: 1 });
    expect(ruleRoute("arXiv:1706.03762", ONE)).toMatchObject({ mode: "search", how: "rules", confidence: 1 });
  });
});

describe("small talk when there is an earlier conversation: only the social words stay", () => {
  it.each([
    "what is that?", "what is that", "really?", "really", "are you sure", "are you sure?", "do that again", "can you do that again", "what was that", "so what", "how so", "what is this",
    // Hinglish and Hindi ones were never taken for small talk; they are here so that stays so
    "kya hai ye", "ye kya hai", "क्या है ये",
  ])("%s goes on as a follow-up", (t) => {
    expect(isSmallTalk(t, ONE)).toBe(false);
    expect(isSmallTalk(t, { turns: 3 })).toBe(false);
  });

  it("...and the same words with no earlier conversation are small talk as ever (the ones that were)", () => {
    for (const t of ["what is that?", "really?", "are you sure", "do that again", "so what", "how so", "what is this"]) expect(isSmallTalk(t)).toBe(true);
  });

  it.each([
    "hi", "Hello!", "thanks", "Thanks a lot!", "thank you so much", "thank you so much, that was helpful", "ok thanks bye", "hi thanks", "ok", "okay.", "cool", "bye", "goodbye", "great", "nice", "yes", "no", "got it",
    "how are you", "kaise ho", "namaste", "नमस्ते", "धन्यवाद", "shukriya", "lol", "wow", "hmm", "hey how are you?", "namaste aap kaun ho", "नमस्ते आप कैसे हैं", "thanks, that was great",
    // about the box itself: still answered by the box
    "who are you", "what can you do?", "how does this work", "help", "can you help me", "are you a bot", "are you there", "what's your name",
  ])("%s is still small talk", (t) => expect(isSmallTalk(t, ONE)).toBe(true));

  it("what is not made only of filler words is a message as ever", () => {
    for (const t of ["thanks, and what about children?", "hello world dataset", "why?", "only after 2020", "ok thanks, now only RCTs", "BERT"]) expect(isSmallTalk(t, ONE)).toBe(false);
  });
});

describe("the box says nothing about itself after an answer", () => {
  it("a thanks, a hello, a goodbye and a how-are-you get their line and no introduction", () => {
    expect(smallTalkReply("thanks a lot", "en", ONE)).toBe("You are welcome.");
    expect(smallTalkReply("hello", "en", ONE)).toBe("Hello!");
    expect(smallTalkReply("bye", "en", ONE)).toBe("Goodbye.");
    expect(smallTalkReply("how are you", "en", ONE)).toBe("I'm doing well, thank you.");
    expect(smallTalkReply("Hey How are you?", "en", ONE)).toBe("Hello! I'm doing well, thank you.");
    for (const t of ["thanks a lot", "hello", "bye", "how are you"]) expect(smallTalkReply(t, "en", ONE)).not.toContain(SMALL_TALK_REPLY);
  });

  it("an ok or a cool is met with a line that asks for the next question, in the language of the message", () => {
    expect(smallTalkReply("ok", "en", ONE)).toBe("Ask a follow-up, or a new question, whenever you like.");
    expect(smallTalkReply("theek hai", "hinglish", ONE)).toBe("Koi aur sawaal ho to poochiye.");
    expect(smallTalkReply("ठीक है", "hi", ONE)).toBe("कोई और सवाल हो तो पूछिए।");
    expect(smallTalkReply("cool", "other", ONE)).toBe("Ask a follow-up, or a new question, whenever you like.");
  });

  it("a question about the box itself is still answered with what the box is for", () => {
    expect(smallTalkReply("what can you do", "en", ONE)).toBe(SMALL_TALK_REPLY);
    expect(smallTalkReply("who are you", "en", ONE)).toBe(SMALL_TALK_REPLY);
    expect(smallTalkReply("hello, who are you", "en", ONE)).toBe(`Hello! ${SMALL_TALK_REPLY}`);
  });

  it("with no earlier conversation the replies are the old ones, word for word", () => {
    expect(smallTalkReply("thanks a lot", "en")).toBe(`You are welcome. ${SMALL_TALK_REPLY}`);
    expect(smallTalkReply("ok", "en")).toBe(SMALL_TALK_REPLY);
    expect(smallTalkReply("hello", "en", { turns: 0 })).toBe(`Hello! ${SMALL_TALK_REPLY}`);
  });
});

describe("dependency cues: what a message that leans on the earlier turns looks like", () => {
  it.each([
    // English
    "only after 2020", "explain that simpler", "what about in children", "how about older adults", "tell me more about paper 2", "summarise the second paper", "can you make it shorter",
    "and what about India", "also in women", "compare them", "same but for adults", "do that again", "give me more", "instead of mice, humans", "what does [3] say", "the first one please",
    "papers from the same period", "in the last one, what was the sample", "one of them",
    // Hinglish
    "uske side effects?", "aur bachon me?", "iska matlab kya hai", "wahi par ek aur", "phir isme kya hota hai", "pehle wale paper me", "dusra paper dikhao", "sirf 2020 ke baad", "unke results batao", "isko Hindi me samjhao", "ye kya hai",
    // Devanagari
    "उसके साइड इफेक्ट्स?", "और बच्चों में?", "इसका मतलब क्या है", "वही पर एक और", "फिर इसमें क्या होता है", "दूसरा पेपर दिखाओ", "सिर्फ 2020 के बाद", "इसको सरल भाषा में समझाओ", "वह क्या है",
  ])("%s", (t) => expect(hasDependencyCue(t)).toBe(true));

  it.each([
    "glaucoma screening with smartphone fundus photographs", "does intermittent fasting improve insulin sensitivity", "how effective is BCG vaccine against tuberculosis in adults", "first-line treatment for hypertension in India",
    "next generation sequencing for rare diseases", "mujhe graph neural networks ke applications par papers chahiye", "diabetes me exercise ka kya asar hota hai", "मधुमेह में व्यायाम का प्रभाव", "भारत में तपेदिक दवा प्रतिरोध पर अध्ययन",
    "India me TB ki drug resistance par latest studies", "air pollution aur bachon me asthma ka relation kya hai",
  ])("%s has none", (t) => expect(hasDependencyCue(t)).toBe(false));
});

describe("needsContext: a message that cannot be understood alone", () => {
  it("fewer than five words, or any dependency cue, needs the earlier turns", () => {
    for (const t of ["glaucoma screening", "only after 2020", "why?", "aur bachon me?", "और बच्चों में?", "tell me more about paper 2 please", "uske side effects kya hain", "four words only here"]) expect(needsContext(t)).toBe(true);
  });
  it("five words or more with no cue stands alone, in any of the three languages", () => {
    for (const t of ["effect of yoga on blood pressure", "tuberculosis drug resistance in India 2020", "diabetes me exercise ka kya asar hota hai", "मधुमेह में व्यायाम का प्रभाव क्या है", "recent work on CRISPR off-target effects"]) expect(needsContext(t)).toBe(false);
  });
  it("a long text or several lines is not a follow-up: it stands alone", () => {
    expect(needsContext("it ".repeat(200))).toBe(false);
    expect(needsContext("one line\nsecond line")).toBe(false);
  });
  it("exactly five words is enough, four is not", () => {
    expect(needsContext("effect of yoga on sleep")).toBe(false);
    expect(needsContext("effect of yoga sleep")).toBe(true);
  });
});

describe("ruleRoute with an earlier conversation", () => {
  it("settles a plain search only when it has five words and no cue; the rest goes to the model", () => {
    expect(ruleRoute("effect of yoga on blood pressure", ONE)).toMatchObject({ mode: "search", how: "rules", confidence: 0.9 });
    expect(ruleRoute("tuberculosis drug resistance in India 2020", ONE)).toMatchObject({ mode: "search", how: "rules" });
    for (const t of ["only after 2020", "explain that simpler", "why?", "tell me more about paper 2", "what about in India?", "glaucoma screening", "summarise that in two lines", "can you say that in Hindi", "more", "continue", "papers on retinal imaging"]) {
      expect(ruleRoute(t, ONE)).toBeNull();
    }
  });

  it("these are the messages the rules settled wrongly before: a search of the raw words, with no model", () => {
    for (const t of ["only after 2020", "explain that simpler", "why?", "tell me more about paper 2", "what about in India?", "more", "continue"]) expect(ruleRoute(t)).toMatchObject({ mode: "search", how: "rules" });
  });

  it("another tool is still found by the rules' own cues (they never needed the earlier turns)", () => {
    expect(ruleRoute("check my references please", ONE)).toBeNull();
    expect(ruleRoute("what does my uploaded paper say about methods", ONE)).toBeNull();
  });
});

describe("languageWithContext: the language of a short follow-up", () => {
  it("a message of its own language keeps it, whatever the earlier turns were", () => {
    expect(languageWithContext("uske side effects kya hain", ["effect of yoga on blood pressure"])).toBe("hinglish");
    expect(languageWithContext("और बच्चों में क्या होता है", ["effect of yoga on blood pressure"])).toBe("hi");
    expect(languageWithContext("what about the side effects in children and adults", ["diabetes me exercise ka kya asar hota hai"])).toBe("en");
  });

  it("a short message that reads as English after a Hinglish or Hindi question takes that conversation's language, in Roman letters", () => {
    for (const q of [["diabetes me exercise ka kya asar hota hai"], ["effect of yoga", "diabetes me exercise ka kya asar hota hai"], ["मधुमेह में व्यायाम का प्रभाव"]]) {
      expect(detectLanguage("aur bachon me?")).toBe("en"); // the reason this function exists
      expect(languageWithContext("aur bachon me?", q)).toBe("hinglish");
      expect(languageWithContext("uske side effects?", q)).toBe("hinglish");
      expect(languageWithContext("bachon me?", q)).toBe("hinglish");
    }
  });

  it("it looks only at the last two questions, and a question that was itself a short follow-up counts as English", () => {
    expect(languageWithContext("bachon me?", ["diabetes me exercise ka kya asar hota hai", "and in adults"])).toBe("hinglish");
    expect(languageWithContext("bachon me?", ["diabetes me exercise ka kya asar hota hai", "effect of yoga on sleep", "and in adults"])).toBe("en");
    expect(languageWithContext("bachon me?", ["diabetes me exercise ka kya asar hota hai", "effect of yoga on sleep", "and in adults", "only RCTs"])).toBe("en");
  });

  it("a Hinglish sign in a short message is Hinglish even after English questions", () => {
    expect(languageWithContext("aur bachon me?", ["effect of yoga on blood pressure"])).toBe("hinglish");
    expect(languageWithContext("uske side effects?", ["effect of yoga on blood pressure"])).toBe("hinglish");
  });

  it("an English short follow-up in an English conversation stays English", () => {
    expect(languageWithContext("only after 2020", ["effect of yoga on blood pressure"])).toBe("en");
    expect(languageWithContext("why?", [])).toBe("en");
  });

  it("four words is short and five is not (the same line as needsContext draws): a short message with no English word in it takes the conversation's language", () => {
    const hinglishChat = ["diabetes me exercise ka kya asar hota hai"];
    expect(languageWithContext("children ke liye", hinglishChat)).toBe("hinglish");
    expect(languageWithContext("kids?", hinglishChat)).toBe("hinglish");
    // five words are enough to be read as they are
    expect(languageWithContext("kids children women men adults", hinglishChat)).toBe("en");
  });

  it("a short message that is English by its words ('what about older adults') is English, also in a Hinglish conversation: the person just typed English", () => {
    const hinglishChat = ["diabetes me exercise ka kya asar hota hai"];
    for (const t of ["what about older adults", "what about the children", "how about women", "which country", "who funded it", "does it work"]) expect(languageWithContext(t, hinglishChat), t).toBe("en");
    // ...and the little words that are Hindi too ("me", "the" for tha, "to", "par") are not English evidence
    expect(languageWithContext("bachon me?", hinglishChat)).toBe("hinglish");
    expect(languageWithContext("buzurgon par?", hinglishChat)).toBe("hinglish");
  });

  it("an English word that is also a Hindi word does not make a short English message Hinglish: 'jab', 'Se', 'Kar', 'Ne', 'fir', 'agar' and 'tune' are names, elements and English words", () => {
    const yoga = ["effect of yoga on blood pressure"];
    for (const t of ["COVID jab side effects", "flu jab", "selenium Se levels", "Kar T cells", "agar dilution method", "fine-tune BERT", "Ne and Se"]) {
      expect(detectLanguage(t), t).toBe("en");
      expect(languageWithContext(t, yoga), t).toBe("en");
    }
    // a real sign is still a sign
    expect(languageWithContext("uske side effects?", yoga)).toBe("hinglish");
    expect(languageWithContext("aur bachon me?", yoga)).toBe("hinglish");
    expect(languageWithContext("kya ye safe hai", yoga)).toBe("hinglish");
  });

  it("a Hinglish cue is a sign in a message of five to eight words too: 'iska matlab simple bhasha me' is Hinglish (it read as English, and the writer was told English)", () => {
    const yoga = ["effect of yoga on blood pressure"];
    expect(detectLanguage("iska matlab simple bhasha me")).toBe("en"); // the reason: two Hindi words are needed, and it has one
    expect(languageWithContext("iska matlab simple bhasha me", yoga)).toBe("hinglish");
    expect(languageWithContext("pehle paper ke baare me thoda aur batao", yoga)).toBe("hinglish");
    // ...and an English message of that length is English, with no cue or with the cue of a name
    expect(languageWithContext("what about the effect on children", ["diabetes me exercise ka kya asar hota hai"])).toBe("en");
    expect(languageWithContext("tell me more about it please", yoga)).toBe("en");
  });

  it("a longer message is never given another language than it reads as", () => {
    expect(languageWithContext("what about the effect on children over two years", ["diabetes me exercise ka kya asar hota hai"])).toBe("en");
  });
});
