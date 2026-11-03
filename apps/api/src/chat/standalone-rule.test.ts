import { describe, expect, it } from "vitest";
import { SMALL_TALK_REPLY, detectLanguage, hasDependencyCue, isSmallTalk, needsContext, ruleRoute, smallTalkReply, topicWordCount } from "@scholar/shared";
// the router's labelled first messages, and the labelled follow-ups
// @ts-expect-error a script, not a typed module
import { CASES, HOLDOUT as FIRST_HOLDOUT } from "../../scripts/router-cases.mjs";
// @ts-expect-error a script, not a typed module
import { TUNED } from "../../scripts/router-followup-cases.mjs";

/**
 * The rule that says whether a message can stand alone once there is an earlier conversation. It used to be "five words or more and no dependency cue": a natural follow-up that has neither a cue nor
 * fewer than five words ("give me the short version", "what were the side effects in children", "papers from 2018 to 2021", "gaon me kya hota hai", "शहरों में क्या हाल है") was searched as written, as a
 * junk search, and no model ever read it with the turns before it. Now a message of five to nine words that says (almost) nothing about a TOPIC of its own is read with the turns too: it has fewer than
 * two words that are about a subject (a word that is not a function word, not a word of a kind ("side effects", "sample size", "children", "India", "bullet points") and not a number).
 * Measured on the 203 labelled first messages: nothing the rules settled loses its rule, and `STANDALONE_NEWLY_READ` below lists what else goes to the model with the turns.
 */
const wordCount = (t: string) => (t.match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).length;
/** The rule as it was before this change (kept here so that "what changed" is a fact that is tested, not a memory). */
const oldNeedsContext = (t: string) => wordCount(t) < 5 || hasDependencyCue(t);
const ALL_FIRST: [string, unknown, string][] = [...CASES, ...FIRST_HOLDOUT];
const ONE = { turns: 1 };

describe("a natural follow-up with no cue and five words or more is read with the turns before it", () => {
  const FOLLOW_UPS = [
    // English: the four kinds of thing a person types after an answer
    "give me the short version",
    "give me the short version please",
    "what were the side effects in children",
    "what are the side effects in kids",
    "how large were the sample sizes",
    "tell me about the sample sizes used",
    "which studies used a control group",
    "compare with the placebo group results",
    "is the effect different in women",
    "what is the evidence for older adults",
    "which country were the studies done in",
    "how long did the benefit last",
    "are there any trials from India",
    "are there any trials in India",
    "limit to studies after 2018",
    "papers from 2018 to 2021",
    "papers published between 2012 and 2016",
    // Hinglish
    "gaon me kya hota hai",
    "2019 ke baad ke hi",
    "2015 ke baad chhape hue papers dikhao",
    // Hindi in Devanagari
    "शहरों में क्या हाल है",
    "ग्रामीण इलाकों में नतीजे कैसे रहे",
    "२०१५ के बाद के पेपर दिखाओ",
  ];
  it.each(FOLLOW_UPS)("%s", (t) => {
    // five words or more and no cue: the case the old rule missed
    expect(wordCount(t)).toBeGreaterThanOrEqual(5);
    expect(oldNeedsContext(t), `${t}: the old rule already read it`).toBe(false);
    expect(needsContext(t), t).toBe(true);
  });

  it("a message that names a way of putting the answer (bullet points, a summary in two lines, simple words) is read with the turns, unless it has a topic of its own", () => {
    for (const t of ["put the answer into three bullet points", "write the answer in simple words", "the answer in two lines"]) expect(needsContext(t), t).toBe(true);
    expect(needsContext("summary of evidence for statins in primary prevention of stroke")).toBe(false);
  });

  it("every follow-up of the tuned list that leans on the turns is read with them (the four that the old rule lost are in that list now, and the probes of the reviewers)", () => {
    const leans = TUNED.filter((c: { cls: string }) => ["refine", "same_papers", "restyle", "year_filter", "earlier_chat"].includes(c.cls));
    expect(leans.length).toBeGreaterThanOrEqual(50);
    const lost = leans.filter((c: { message: string }) => !needsContext(c.message)).map((c: { id: string }) => c.id);
    expect(lost).toEqual([]);
    const moved = ["en-restyle-6", "hg-refine-5", "hg-year-5", "hi-refine-4"];
    for (const id of moved) expect(TUNED.some((c: { id: string }) => c.id === id), id).toBe(true);
    // ...and each of them is one the OLD rule lost (else moving it would mean nothing)
    for (const id of moved) {
      const c = TUNED.find((x: { id: string }) => x.id === id);
      expect(oldNeedsContext(c.message), `${id}: ${c.message}`).toBe(false);
    }
  });
});

describe("a question that stands alone is still settled without the turns", () => {
  const STANDALONE = [
    "effect of yoga on blood pressure",
    "effect of intermittent fasting on insulin sensitivity",
    "does intermittent fasting improve insulin sensitivity",
    "role of the microbiome in treating childhood obesity",
    "how effective is the BCG vaccine against tuberculosis in adults",
    "glaucoma screening with smartphone fundus photographs in rural India",
    "transformer models for low-resource Indian languages",
    "what is known about microplastics in drinking water",
    "causes of groundwater depletion in northwest India",
    "NEP 2020 higher education India",
    "diabetes me exercise ka kya asar hota hai",
    "India me TB ki drug resistance par latest studies",
    "land records ke liye blockchain",
    "मधुमेह में व्यायाम का प्रभाव",
    "भारत में तपेदिक दवा प्रतिरोध पर अध्ययन",
    "बच्चों में कुपोषण कम करने के उपाय",
    "अब मलेरिया के टीके के बारे में बताओ",
  ];
  it.each(STANDALONE)("%s", (t) => {
    expect(needsContext(t), t).toBe(false);
  });

  it("a message with a tool word of its own (a first person, an upload, a list of references, an idea) is for the first-turn router and is not read with the turns for lacking a topic", () => {
    for (const t of ["what does my uploaded paper say about methods", "mere paper me sample size kitna tha", "मेरे अपलोड किए पेपर में नमूना आकार कितना था", "check the references in the draft"]) expect(needsContext(t), t).toBe(false);
  });

  it("a bare DOI or arXiv number is a search as it ever was (the rules settle it before this rule is asked); a text of many words, of several lines or over 300 characters is not a follow-up", () => {
    for (const t of ["10.1038/nature14539", "arXiv:1706.03762", "https://doi.org/10.1000/xyz123"]) expect(ruleRoute(t, ONE), t).toMatchObject({ mode: "search", how: "rules", confidence: 1 });
    expect(needsContext("list the sample sizes of the studies in children women men adults elderly patients")).toBe(false); // ten words or more: it says enough
    expect(needsContext("give me the short version\nand the long one")).toBe(false);
    expect(needsContext(`give me the short version ${"x ".repeat(200)}`)).toBe(false);
  });
});

describe("topicWordCount: the words of a message that are about a subject", () => {
  it("function words, words of a kind, numbers and short bits are not about a subject; a subject's own words are", () => {
    expect(topicWordCount("what were the side effects in children")).toBe(0);
    expect(topicWordCount("papers from 2018 to 2021")).toBe(0);
    expect(topicWordCount("effect of yoga on blood pressure")).toBe(3); // yoga, blood, pressure
    expect(topicWordCount("glaucoma screening")).toBe(2);
    expect(topicWordCount("rural areas and communities in schools")).toBe(0); // where and who are kinds, not subjects
  });
  it("an acronym, a word with a digit and a hyphenated word count; an apostrophe does not make a word of its own", () => {
    expect(topicWordCount("what is the cost of TB")).toBe(1);
    expect(topicWordCount("what is known about COVID-19 and H5N1")).toBe(2);
    expect(topicWordCount("what's the cost in Parkinson's")).toBe(1);
    expect(topicWordCount("off-target effects")).toBe(1);
  });
  it("Hinglish and Devanagari: the little words of the language and its words of a kind are not about a subject", () => {
    expect(topicWordCount("gaon me kya hota hai")).toBe(0);
    expect(topicWordCount("शहरों में क्या हाल है")).toBe(0);
    expect(topicWordCount("मधुमेह में व्यायाम का प्रभाव")).toBe(2);
    expect(topicWordCount("diabetes me exercise ka kya asar hota hai")).toBe(2);
  });
});

describe("what the change does to the 203 labelled first messages", () => {
  // first messages are not routed by this rule at all (it needs an earlier turn); this is what they would be if they came after one
  const settledBefore = ALL_FIRST.filter(([t]) => ruleRoute(t, ONE) !== null);
  it("a message that the rules settled with turns before it is settled exactly as before: none of them is taken from the rules", () => {
    expect(settledBefore.length).toBeGreaterThan(20);
    const lost = settledBefore.filter(([t]) => needsContext(t) && !oldNeedsContext(t)).map(([t]) => t);
    expect(lost).toEqual([]);
  });
  it("with no turns before it every one of them is exactly as it was: the rule is not asked", () => {
    for (const [t] of ALL_FIRST) {
      expect(JSON.stringify(ruleRoute(t, undefined))).toBe(JSON.stringify(ruleRoute(t)));
      expect(JSON.stringify(ruleRoute(t, { turns: 0 }))).toBe(JSON.stringify(ruleRoute(t)));
    }
  });
  it("what goes to the model with the turns instead of to the first-turn router is counted and pinned: at most a handful, and each is a message with almost no subject of its own", () => {
    const newly = ALL_FIRST.filter(([t]) => !oldNeedsContext(t) && needsContext(t)).map(([t]) => t);
    // (a first message that the rules or the first-turn router settle is one of the 203; the list is of those that would instead be read with the earlier turns, about 1,000 tokens more each)
    expect(newly).toEqual(STANDALONE_NEWLY_READ);
    expect(newly.length / ALL_FIRST.length).toBeLessThan(0.03);
  });
});

/** The labelled first messages that, coming after an earlier turn, are read with it under the new rule and were not under the old. Written down from a run of the rule, and checked by hand. */
const STANDALONE_NEWLY_READ: string[] = ["NEP 2020 ke baare me kuch papers do"];

describe("after an answer, an acknowledgement is small talk and costs nothing; a request that starts with one is not", () => {
  const TWO = { turns: 2 };
  const ACKS = [
    "thanks, that helps",
    "great, that is clear",
    "ok got it thanks",
    "thanks, this is useful",
    "interesting, thanks",
    "that makes sense, thanks",
    "perfect, thank you so much",
    "shukriya, samajh aa gaya",
    "धन्यवाद, समझ आ गया",
  ];
  it.each(ACKS)("%s", (t) => {
    expect(isSmallTalk(t, TWO), t).toBe(true);
    // the reply answers it as it is (a thanks is met with a thanks), without introducing the box again
    const reply = smallTalkReply(t, detectLanguage(t), TWO);
    expect(reply).not.toContain(SMALL_TALK_REPLY);
    expect(reply.length).toBeGreaterThan(0);
  });
  it("with no earlier turn nothing changes: these are searched or sent to the model, as they were", () => {
    for (const t of ACKS.filter((x) => !/^(?:perfect, thank you so much)$/.test(x))) expect(isSmallTalk(t), t).toBe(false);
    expect(isSmallTalk("thanks, that helps", { turns: 0 })).toBe(false);
  });
  it.each(["thanks, now explain that simpler", "great, but what about children", "ok so what about older adults", "thanks, can you give the same in Hindi", "got it, why?", "interesting, which paper said that", "thanks and the sample size?", "that helps, only after 2020"])(
    "a request that starts with one is a follow-up: %s",
    (t) => {
      expect(isSmallTalk(t, TWO), t).toBe(false);
    },
  );
});
