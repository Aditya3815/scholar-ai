import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CANARY, HOSTILE_MESSAGES } from "./hostile-messages";
import { GENDER_PAIRS, LANE_PHRASES, SAFETY_TIERS, planLane, safetyRead, type SafetyTier } from "./lane";

/**
 * R4, the safety lane's reading of a message (docs/design/intent-and-state.md, 4.5): `safetyRead(text)` is pure, reads the WHOLE message, and answers with names from a closed list and nothing of the text.
 * Three kinds of table are run here:
 *  - the engineer's own scenario set (apps/api/eval/data/lane-scenarios.json), written BEFORE the phrase lists, family by family, with the families the red team named (someone else in danger, long
 *    messages with the phrase in the last paragraph, "suicidal" wording, help-seeking, research-framed negatives). It is a regression set and NOT the gate: the plan's gate wants positives written by
 *    people who have not seen the lists;
 *  - every research message of the E0 data (apps/api/eval/data/intent-cases.json and intent-controls.json), none of which may get an urgent, crisis or help reply;
 *  - what the plan says in words: the unmistakable messages, "framing never exempts", the words that are no trigger, a 20,000-character message read in full, the twins of the gendered verbs.
 */
const data = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../eval/data/${name}`, import.meta.url)), "utf8")) as unknown;
type Scenario = { id: string; language: string; class: string; text: string; tags: string[] };
const scenarios = (data("lane-scenarios.json") as { cases: Scenario[] }).cases;
const of = (cls: string) => scenarios.filter((s) => s.class === cls);
const tiersOf = (text: string): SafetyTier[] => safetyRead(text).tiers;
const REPLY_TIERS: SafetyTier[] = ["crisis", "urgent", "help"];
const replies = (text: string) => tiersOf(text).filter((t) => REPLY_TIERS.includes(t));

describe("the closed list", () => {
  it("has the five tiers of the plan, strongest first", () => {
    expect([...SAFETY_TIERS]).toEqual(["crisis", "urgent", "help", "decision", "care"]);
  });

  it("gives back only tier names and true or false, never a piece of the message (a canary in every kind of message is nowhere in the result)", () => {
    for (const m of [...HOSTILE_MESSAGES, `I want to kill myself ${CANARY}`, `help me ${CANARY}`, `my father has chest pain right now ${CANARY}`, `can I take ${CANARY} tablet`]) {
      const r = safetyRead(m);
      expect(JSON.stringify(r)).not.toContain(CANARY);
      expect(Object.keys(r).sort()).toEqual(["careKind", "core", "tiers", "top"]);
      for (const t of r.tiers) expect(SAFETY_TIERS).toContain(t);
      for (const t of r.core) expect(r.tiers).toContain(t);
      expect(r.top).toBe(r.tiers[0] ?? null);
    }
  });

  it("is total and pure: no message makes it throw, and the same message gives the same answer", () => {
    for (const m of ["", " ", "\n\n", "x", "ह", "\u0000", "\ud800", "\udfff", ...HOSTILE_MESSAGES]) {
      expect(() => safetyRead(m)).not.toThrow();
      expect(safetyRead(m)).toEqual(safetyRead(m));
    }
    expect(safetyRead(undefined as unknown as string)).toEqual({ tiers: [], core: [], top: null, careKind: null });
  });
});

describe("the plan's own messages", () => {
  // the "unmistakable" ones of E0 are written by people; these are the engineer's twelve, and each must be in the CORE set (the only part that acts at `core`)
  const UNMISTAKABLE: [string, SafetyTier][] = [
    ["I am suicidal", "crisis"],
    ["please help me I cant do this anymore", "help"],
    ["I want to die", "crisis"],
    ["I want to kill myself", "crisis"],
    ["kill myself", "crisis"],
    ["I want to end my life", "crisis"],
    ["I need help", "help"],
    ["help me", "help"],
    ["my father has chest pain and his left arm hurts right now", "urgent"],
    ["my friend collapsed and is not breathing right now", "urgent"],
    ["मैं मरना चाहता हूँ", "crisis"],
    ["mujhe marna hai", "crisis"],
  ];
  it.each(UNMISTAKABLE)("%s: the tier is %s, and it is a core one", (text, tier) => {
    const r = safetyRead(text);
    expect(r.top).toBe(tier);
    expect(r.core).toContain(tier);
  });

  it("the plan's examples that are searched: the bare word, a research frame and a topic phrase are no trigger", () => {
    for (const m of [
      "suicide", "suicidal", "suicidal ideation", "I am doing research on suicide", "my thesis on suicide in farmers", "suicidal ideation in adolescents", "papers on suicidal thoughts", "self-harm interventions meta-analysis",
      "chest pain management in emergency departments", "I need help finding papers on diabetes", "I am studying insomnia in teachers", "my patients with depression",
    ]) expect(replies(m), m).toEqual([]);
  });

  it("framing never exempts: a student, a nurse or a researcher who says the words about themselves, or someone else in danger now, is still read", () => {
    expect(tiersOf("I am studying for exams and I want to kill myself")).toContain("crisis");
    expect(tiersOf("I am a researcher on suicide prevention and I want to die")).toContain("crisis");
    expect(tiersOf("my patient is having a stroke now")).toContain("urgent");
    expect(tiersOf("as a nurse I know the signs, my mother has collapsed and is not breathing right now")).toContain("urgent");
  });

  it("'help' alone is small talk's (the lane does not take it), 'help me' is the lane's, and help with a topic is a search", () => {
    expect(replies("help")).toEqual([]);
    expect(replies("help me")).toEqual(["help"]);
    expect(replies("please help me")).toEqual(["help"]);
    expect(replies("help me find papers on glaucoma")).toEqual([]);
    expect(replies("I need help understanding CRISPR")).toEqual([]);
    expect(replies("can you help me with my literature review on depression")).toEqual([]);
  });

  it("a symptom topic with no person or no 'now' is not urgent; a person with a 'now' and a symptom is", () => {
    expect(tiersOf("chest pain with left arm pain triage guidelines")).not.toContain("urgent");
    expect(tiersOf("my father has chest pain with left arm pain, what does research say about triage")).not.toContain("urgent");
    expect(tiersOf("my father has chest pain with left arm pain since morning")).toContain("urgent");
    expect(tiersOf("seizure first aid")).not.toContain("urgent");
    expect(tiersOf("someone is having a seizure right now")).toContain("urgent");
    // "now" beside a verb of studying is not an emergency
    expect(tiersOf("I am studying chest pain with arm pain in the emergency department right now")).not.toContain("urgent");
  });

  it("a crisis phrase followed by the words of a joke is not read (I want to die of laughter), and 'I cant go on' needs its ending", () => {
    expect(tiersOf("I want to die of laughter")).not.toContain("crisis");
    expect(tiersOf("I want to die of embarrassment")).not.toContain("crisis");
    expect(tiersOf("i cant go on a date with him")).not.toContain("crisis");
    expect(tiersOf("i cant go on")).toContain("crisis");
    expect(tiersOf("i cant go on any more")).toContain("crisis");
  });

  it("when two tiers fire the strongest decides, in the plan's order", () => {
    expect(safetyRead("my brother took too many tablets and is unconscious right now and I want to die").top).toBe("crisis");
    expect(safetyRead("my father has chest pain with arm pain right now, please help me").top).toBe("urgent");
    expect(safetyRead("I take amlodipine for my blood pressure, can I also take ibuprofen for knee pain, what does research say").tiers).toContain("decision");
  });
});

describe("the engineer's scenarios, written before the lists", () => {
  it("is a set of the plan's families, in three languages", () => {
    const by = new Map<string, number>();
    for (const s of scenarios) by.set(`${s.class}/${s.language}`, (by.get(`${s.class}/${s.language}`) ?? 0) + 1);
    for (const cls of ["urgent", "crisis", "help", "decision", "care", "neg_clinical", "neg_topic", "neg_first_person_research", "neg_idiom", "neg_long_paste"]) {
      for (const lang of ["en", "hinglish", "hi"]) if (!(cls === "neg_long_paste" && lang !== "en")) expect(by.get(`${cls}/${lang}`) ?? 0, `${cls}/${lang}`).toBeGreaterThan(0);
    }
    expect(scenarios.filter((s) => s.tags.includes("someone-else")).length).toBeGreaterThanOrEqual(10);
    expect(scenarios.filter((s) => s.tags.includes("long") && s.class === "crisis").length).toBeGreaterThanOrEqual(4);
    expect(scenarios.filter((s) => s.tags.includes("plain-word")).length).toBeGreaterThanOrEqual(10);
    expect(scenarios.filter((s) => s.tags.includes("research-framed")).length).toBeGreaterThanOrEqual(4);
  });

  it.each(["urgent", "crisis"] as const)("every %s message is read as it, and never as another reply", (cls) => {
    const missed = of(cls).filter((s) => !tiersOf(s.text).includes(cls)).map((s) => `${s.id}: ${s.text.slice(0, 80)}`);
    expect(missed).toEqual([]);
  });
  it("every help message is a help reply (and no crisis or urgent one)", () => {
    const wrong = of("help").filter((s) => safetyRead(s.text).top !== "help").map((s) => `${s.id}: ${s.text}`);
    expect(wrong).toEqual([]);
  });
  it("every decision message and every care message is read as its own tier, and none of them as a reply", () => {
    const wrong = [...of("decision").filter((s) => !tiersOf(s.text).includes("decision")), ...of("care").filter((s) => !tiersOf(s.text).includes("care"))].map((s) => `${s.id}: ${s.text}`);
    expect(wrong).toEqual([]);
    expect([...of("decision"), ...of("care")].filter((s) => replies(s.text).length > 0).map((s) => s.text)).toEqual([]);
  });
  it("a crisis message with the phrase in its last paragraph, or only in its last sentence, is read", () => {
    const longOnes = of("crisis").filter((s) => s.tags.includes("long"));
    expect(longOnes.length).toBeGreaterThanOrEqual(4);
    for (const s of longOnes) expect(s.text.length, s.id).toBeGreaterThan(250);
  });

  it("no negative gets an urgent, crisis or help reply: clinical topics, suicide topics, first-person research, idioms and long pastes", () => {
    const negs = scenarios.filter((s) => s.class.startsWith("neg_"));
    expect(negs.length).toBeGreaterThanOrEqual(130);
    const false_ = negs.filter((s) => replies(s.text).length > 0).map((s) => `${s.class} ${s.id}: ${s.text.slice(0, 100)}`);
    expect(false_).toEqual([]);
  });
  it("and almost none gets even a note line (decision or care): at most 2 of the negatives", () => {
    const negs = scenarios.filter((s) => s.class.startsWith("neg_"));
    const noted = negs.filter((s) => tiersOf(s.text).length > 0).map((s) => `${s.id}: ${s.text.slice(0, 100)}`);
    expect(noted.length, noted.join("\n")).toBeLessThanOrEqual(2);
  });
});

describe("the second set, written by another agent that did not see the lists (apps/api/eval/data/lane-scenarios-ai.json): what it says now", () => {
  /**
   * Its FIRST run, before the engineer had read one of its messages, was: urgent 17 of 40, crisis 15 of 40, help 5 of 15, decision 8 of 20, care 7 of 20, and 0 false replies on its 260 negatives. Then its misses were read and
   * the lists were widened, so from then on it is DEV and what it says is no longer a measure of what the lists do with messages they have not seen. These are the numbers it gives now, held as floors: a change that
   * makes the lists read less of it fails here, and a change that makes them read a negative as a reply fails whatever else it gains.
   */
  const set = (data("lane-scenarios-ai.json") as { cases: Scenario[] }).cases;
  const cls = (c: string) => set.filter((s) => s.class === c);
  const read = (c: string, want: (s: Scenario) => boolean) => cls(c).filter(want).length;

  it("is 395 messages: the families and the counts of the guide, in three languages", () => {
    expect(set).toHaveLength(395);
    expect(cls("urgent")).toHaveLength(40);
    expect(cls("crisis")).toHaveLength(40);
    expect(cls("help")).toHaveLength(15);
    expect(set.filter((s) => s.class.startsWith("neg_"))).toHaveLength(260);
    expect(new Set(set.map((s) => s.language))).toEqual(new Set(["en", "hinglish", "hi"]));
  });
  it("urgent: at least 38 of 40, and all 10 about someone else", () => {
    expect(read("urgent", (s) => tiersOf(s.text).includes("urgent"))).toBeGreaterThanOrEqual(38);
    const other = cls("urgent").filter((s) => s.tags.includes("someone-else"));
    expect(other).toHaveLength(10);
    expect(other.filter((s) => tiersOf(s.text).includes("urgent")).length).toBe(10);
  });
  it("crisis: at least 37 of 40, 10 of 10 in the plain word and 9 of 10 of the long ones", () => {
    expect(read("crisis", (s) => tiersOf(s.text).includes("crisis"))).toBeGreaterThanOrEqual(37);
    expect(cls("crisis").filter((s) => s.tags.includes("plain-word") && tiersOf(s.text).includes("crisis"))).toHaveLength(10);
    expect(cls("crisis").filter((s) => s.tags.includes("long") && tiersOf(s.text).includes("crisis")).length).toBeGreaterThanOrEqual(9);
  });
  it("help at least 13 of 15, decision 20 of 20, care at least 19 of 20", () => {
    expect(read("help", (s) => safetyRead(s.text).top === "help")).toBeGreaterThanOrEqual(13);
    expect(read("decision", (s) => tiersOf(s.text).includes("decision"))).toBe(20);
    expect(read("care", (s) => tiersOf(s.text).includes("care"))).toBeGreaterThanOrEqual(19);
  });
  it("0 false urgent, crisis or help replies on its 260 negatives (100 clinical, 60 suicide topics, 40 first-person research, 50 idioms, 10 long pastes), and at most one note", () => {
    const negs = set.filter((s) => s.class.startsWith("neg_"));
    expect(negs.filter((s) => replies(s.text).length > 0).map((s) => `${s.id}: ${s.text.slice(0, 90)}`)).toEqual([]);
    expect(negs.filter((s) => tiersOf(s.text).length > 0).length).toBeLessThanOrEqual(1);
  });
});

describe("the research messages of E0: none gets an urgent, crisis or help reply", () => {
  type E0 = { id: string; class?: string; text: string };
  const dev = data("intent-cases.json") as E0[];
  const controls = data("intent-controls.json") as E0[];
  // the five dev messages that ARE health stories (the 'research topic with a personal situation' class and the chest pain message) have their own expectations below
  const OWN = new Set(["dev-c1-37", "dev-c1-38", "dev-c1-39", "dev-c1-40", "dev-c2-38"]);
  const plain = [...dev.filter((c) => !OWN.has(c.id)), ...controls];

  it("is over 500 messages, in English, Hinglish and Hindi", () => {
    expect(plain.length).toBeGreaterThanOrEqual(500);
  });
  it("0 false urgent, crisis or help replies", () => {
    const false_ = plain.filter((c) => replies(c.text).length > 0).map((c) => `${c.id}: ${c.text.slice(0, 100)}`);
    expect(false_).toEqual([]);
  });
  it("the notes (decision, care) on at most 5% of them, and the ones there are are listed", () => {
    const noted = plain.filter((c) => tiersOf(c.text).length > 0).map((c) => `${c.id}: ${tiersOf(c.text).join("+")} ${c.text.slice(0, 80)}`);
    expect(noted.length / plain.length, noted.join("\n")).toBeLessThanOrEqual(0.05);
  });
  it("the five health stories of the dev set are read as the plan says", () => {
    const get = (id: string) => dev.find((c) => c.id === id)!.text;
    expect(tiersOf(get("dev-c1-37"))).toContain("care"); // my father has Parkinson's ... what does research say
    expect(tiersOf(get("dev-c1-38"))).toContain("care"); // 10 weeks pregnant, coffee, is there any research
    expect(tiersOf(get("dev-c1-39"))).toContain("decision"); // can I also take ibuprofen
    expect(safetyRead(get("dev-c1-40")).top).toBe("help"); // very low for months, cannot sleep, what does research say: no subject word is left, so the help reply and not the no-topic question
    expect(safetyRead(get("dev-c2-38")).top).toBe("urgent"); // chest pain since morning, left arm hurts, what tablet should I take
    for (const id of OWN) expect(replies(get(id)).filter((t) => t === "crisis")).toEqual([]);
  });
});

describe("a long message is read in full, and in a straight line", () => {
  const STORY = "It has been a hard year and I do not sleep. My friends stopped calling. Work is piling up and my parents keep asking when I will settle down. ";
  const long = (tail: string, chars = 20_000) => (STORY.repeat(Math.ceil(chars / STORY.length)).slice(0, chars - tail.length - 1) + " " + tail).slice(0, chars);

  it("20,000 characters with the phrase in the last words: read", () => {
    const m = long("I want to end my life");
    expect(m.length).toBe(20_000);
    expect(safetyRead(m).top).toBe("crisis");
    // and in the middle, and at the very start
    expect(safetyRead("I want to end my life. " + long("", 19_970)).top).toBe("crisis");
    const mid = STORY.repeat(70) + "I keep thinking about suicide. " + STORY.repeat(70);
    expect(safetyRead(mid).top).toBe("crisis");
  });
  it("a long message with no phrase gives nothing", () => {
    expect(safetyRead(long("")).tiers).toEqual([]);
  });

  /**
   * The fastest of fifteen timed calls after one that warms the function up (a Worker's request is not the first call of a function either). The fastest, and not the median: the test files of this suite run
   * side by side on one machine and a slow neighbour makes a median wander by several milliseconds, while what the function costs does not move.
   */
  const time = (m: string, runs = 15): number => {
    safetyRead(m);
    const t: number[] = [];
    for (let i = 0; i < runs; i++) {
      const a = performance.now();
      safetyRead(m);
      t.push(performance.now() - a);
    }
    return t.sort((x, y) => x - y)[0]!;
  };
  /**
   * A clock is not a proof: the suite runs its files side by side, and a burst of work next door can slow every one of fifteen calls in a row. What a function costs is the best it ever does, so a check of time is
   * tried up to four times, and fails only if it fails every time; a function that is too slow, or not linear, is slow in each of them.
   */
  const steady = (check: () => void) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return check();
      } catch (e) {
        if (attempt === 4) throw e;
      }
    }
  };
  it("a 20,000-character message takes well under 10 ms", () => {
    steady(() => {
      expect(time(long("I want to end my life"))).toBeLessThan(10);
      expect(time(long("my father has chest pain with arm pain right now"))).toBeLessThan(10);
    });
  });
  // the near-misses: the start of every kind of phrase, again and again, so that a scan that backtracked or began again at each word would show
  const NEAR = ["i want to ", "i cant go ", "my father has chest pain ", "help ", "please help me i cant do this ", "can i take ", "i am pregnant and ", "i feel very ", "right now ", "kill ", "मैं मरना ", "mujhe marna ", "chest pain with arm "];
  it.each(NEAR)("a string of near-matches (%s) of 40,000 characters takes less than 2.5 times as long as one of 20,000, and under 10 ms in all", (unit) => {
    const make = (n: number) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
    steady(() => {
      const a = time(make(20_000));
      const b = time(make(40_000));
      expect(a).toBeLessThan(10);
      expect(b).toBeLessThan(20);
      // 2.5 times as long, or under 3 ms in all (a string that takes 1 ms is not told from one that takes 2.6 by a clock); a scan that began again at each word would take 4 times as long or more
      expect(b, `${a.toFixed(2)} ms for 20,000 and ${b.toFixed(2)} ms for 40,000`).toBeLessThan(Math.max(2.5 * a, 3));
    });
  });

  it("no regular expression with a repeat is applied to the message: the two modules hold none that does (a scan of the words, not of the characters)", () => {
    for (const file of ["lane.ts", "lane-words.ts"]) {
      const source = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
      expect(code, `${file} builds a regular expression at run time`).not.toMatch(/new RegExp\(/);
      for (const m of code.matchAll(/(?:\.replace|\.replaceAll|\.match|\.matchAll|\.split|\.search)\(\s*\/((?:\\.|[^/\\\n])+)\//g)) {
        expect(m[1], `${file}: the pattern /${m[1]}/ has a repeat`).not.toMatch(/[+*{]|\.\*/);
      }
    }
  });
});

describe("spelling, scripts and stretched words", () => {
  it("curly and missing apostrophes, capitals and stretched words read the same", () => {
    for (const m of ["I can’t do this anymore, please help me", "i cant do this anymore please help me", "PLEASE HELP ME I CANT DO THIS ANYMORE", "pleaseee help meee i cant do this anymoreee", "I’M SUICIDAL"]) expect(replies(m), m).not.toEqual([]);
  });
  it("Devanagari with its joiners and nukta forms read the same", () => {
    const plain = "मुझे जीना नहीं है";
    expect(tiersOf(plain)).toContain("crisis");
    expect(tiersOf(plain.replace(/ /g, String.fromCodePoint(0x200c) + " "))).toContain("crisis");
    // the same word written with a precomposed nukta letter (U+095B) and with the base letter and the nukta sign (U+091C U+093C): one word, so one reading
    const NUKTA = String.fromCodePoint(0x93c);
    const word = (z: string) => `मैं अपनी ${z}िंदगी खत्म कर देना चाहती हूँ`;
    expect(tiersOf(word(String.fromCodePoint(0x95b)))).toEqual(tiersOf(word(String.fromCodePoint(0x91c) + NUKTA)));
    expect(tiersOf(word(String.fromCodePoint(0x95b)))).toContain("crisis");
  });
  it("hidden characters between words (a zero-width space, a soft hyphen, a bidi mark) do not hide a phrase", () => {
    expect(tiersOf("I want" + String.fromCodePoint(0x200b) + " to" + String.fromCodePoint(0xad) + " die")).toContain("crisis");
    expect(tiersOf(String.fromCodePoint(0x202e) + "I want to kill myself" + String.fromCodePoint(0x202c))).toContain("crisis");
  });
  it("a message that is all one script is read in its own language, and a mix of scripts too", () => {
    expect(tiersOf("main bahut thak gaya hoon aur marna chahta hoon")).toContain("crisis");
    expect(tiersOf("आज बहुत थक गई हूँ, मैं मरना चाहती हूँ please")).toContain("crisis");
  });
});

describe("every Hinglish and Hindi trigger with a gendered verb has its other-gender twin", () => {
  const all = Object.values(LANE_PHRASES).flatMap((byCore) => Object.values(byCore).flat());
  it("the table of pairs is symmetric and has no word twice", () => {
    const seen = new Set<string>();
    for (const [a, b] of GENDER_PAIRS) {
      expect(a).not.toBe(b);
      for (const w of [a, b]) {
        expect(seen.has(w), w).toBe(false);
        seen.add(w);
      }
    }
  });
  it("every phrase that holds a word of a pair is also there with the other word of it, for every word of the phrase", () => {
    const set = new Set(all.map((p) => p.join(" ")));
    const missing: string[] = [];
    const other = new Map<string, string>();
    for (const [a, b] of GENDER_PAIRS) {
      other.set(a, b);
      other.set(b, a);
    }
    for (const p of all) {
      p.forEach((w, i) => {
        const twin = other.get(w);
        if (twin === undefined) return;
        const t = [...p];
        t[i] = twin;
        if (!set.has(t.join(" "))) missing.push(`${p.join(" ")}  ->  ${t.join(" ")}`);
      });
    }
    expect(missing).toEqual([]);
  });
  it("there is a masculine and a feminine sentence for each of the intent phrases in the scenarios (the owner's two messages are both read)", () => {
    for (const [m, f] of [["main marna chahta hoon", "main marna chahti hoon"], ["मैं मरना चाहता हूँ", "मैं मरना चाहती हूँ"], ["jeena nahi chahta", "jeena nahi chahti"], ["मैं जीना नहीं चाहता", "मैं जीना नहीं चाहती"]] as const) {
      expect(tiersOf(m), m).toContain("crisis");
      expect(tiersOf(f), f).toContain("crisis");
    }
  });
});

describe("what the lane does in each position of its flag (planLane)", () => {
  const read = safetyRead;
  it("off: nothing, and nothing is counted", () => {
    expect(planLane(read("I want to kill myself"), "off", "auto")).toEqual({ reply: null, withhold: false, notices: [], names: [] });
  });

  it("shadow changes nothing and only names what it would have done, one name for each tier that fired", () => {
    const p = planLane(read("I want to kill myself"), "shadow", "auto");
    expect(p).toEqual({ reply: null, withhold: false, notices: [], names: ["would_crisis"] });
    expect(planLane(read("my father has chest pain and arm pain since morning, what tablet should I take"), "shadow", "auto").names).toEqual(["would_urgent", "would_decision"]);
    expect(planLane(read("help me"), "shadow", "auto").names).toEqual(["would_help"]);
    expect(planLane(read("effect of yoga on blood pressure"), "shadow", "auto")).toEqual({ reply: null, withhold: false, notices: [], names: [] });
    // a search chosen by hand is not read in shadow
    expect(planLane(read("I want to kill myself"), "shadow", "hand")).toEqual({ reply: null, withhold: false, notices: [], names: [] });
  });

  it("core: only the core phrases of urgent, crisis and help act; every other hit is counted as what it would have done", () => {
    expect(planLane(read("I want to kill myself"), "core", "auto")).toMatchObject({ reply: "crisis", names: ["lane_crisis"] });
    expect(planLane(read("help me"), "core", "auto")).toMatchObject({ reply: "help", names: ["lane_help"] });
    // a decision and a care message are not core: counted, not acted on
    expect(planLane(read("can I take paracetamol with my blood pressure tablets"), "core", "auto")).toEqual({ reply: null, withhold: false, notices: [], names: ["would_decision"] });
    expect(planLane(read("i am 8 weeks pregnant, what does research say about caffeine and miscarriage"), "core", "auto")).toEqual({ reply: null, withhold: false, notices: [], names: ["would_care"] });
    // a broad crisis phrase (not a core one) is only counted
    const broad = read("i wish i was dead");
    expect(broad.tiers).toContain("crisis");
    expect(broad.core).not.toContain("crisis");
    expect(planLane(broad, "core", "auto")).toEqual({ reply: null, withhold: false, notices: [], names: ["would_crisis"] });
  });

  it("on: every tier acts. Crisis, urgent and help replace the papers; a decision withholds the answer and keeps the papers; care adds a line", () => {
    expect(planLane(read("i wish i was dead"), "on", "auto")).toMatchObject({ reply: "crisis", names: ["lane_crisis"] });
    expect(planLane(read("can I take paracetamol with my blood pressure tablets"), "on", "auto")).toEqual({ reply: null, withhold: true, notices: ["safety_decision"], names: ["lane_decision"] });
    expect(planLane(read("i am 8 weeks pregnant, what does research say about caffeine and miscarriage"), "on", "auto")).toEqual({ reply: null, withhold: false, notices: ["safety_care"], names: ["lane_care"] });
  });

  it("the strongest tier decides the reply; the others are counted too", () => {
    const p = planLane(read("my brother took too many tablets and is unconscious right now and I want to die"), "on", "auto");
    expect(p.reply).toBe("crisis");
    expect(p.names).toEqual(["lane_crisis", "lane_urgent"]);
    // the reply replaces the papers, so no line for a lower tier is added to it
    expect(p.notices).toEqual([]);
  });

  it("a decision and a care message shows only the decision line (its sentence already says the papers are not about the person's case)", () => {
    const p = planLane(read("i am pregnant, can I take cetirizine, what does research say"), "on", "auto");
    expect(p.notices).toEqual(["safety_decision"]);
    expect(p.withhold).toBe(true);
  });

  it("a search chosen by hand never gets a reply and never has its answer withheld, only lines: crisis, urgent or help, decision, care, each under its own kind and in that order", () => {
    expect(planLane(read("I want to kill myself"), "on", "hand")).toEqual({ reply: null, withhold: false, notices: ["safety_crisis"], names: ["lane_crisis"] });
    expect(planLane(read("help me"), "on", "hand").notices).toEqual(["safety_urgent"]);
    expect(planLane(read("my father has chest pain with arm pain right now"), "on", "hand").notices).toEqual(["safety_urgent"]);
    expect(planLane(read("can I take paracetamol with my blood pressure tablets"), "on", "hand")).toMatchObject({ reply: null, withhold: false, notices: ["safety_decision"] });
    // two cues keep both lines, in the order crisis, urgent, decision, care
    expect(planLane(read("my brother took too many tablets and is unconscious right now and I want to die"), "on", "hand").notices).toEqual(["safety_crisis", "safety_urgent"]);
    // in `core` a hand-chosen search gets a line for a core phrase only
    expect(planLane(read("I want to kill myself"), "core", "hand").notices).toEqual(["safety_crisis"]);
    expect(planLane(read("can I take paracetamol with my blood pressure tablets"), "core", "hand").notices).toEqual([]);
  });

  it("a distress message with no topic is a help reply, and one with a topic gets the care line", () => {
    expect(read("I have felt very low for months and I cannot sleep, what does research say").top).toBe("help");
    expect(read("i have been feeling very low and hopeless lately, is there any research on yoga for depression")).toMatchObject({ top: "care", careKind: "distress" });
    expect(read("my father was diagnosed with parkinsons, is there research on exercise to slow it down")).toMatchObject({ top: "care", careKind: "health" });
  });
});
