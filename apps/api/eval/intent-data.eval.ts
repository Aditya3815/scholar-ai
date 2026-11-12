// The data of the intent eval (plan 8.2, step E0a): the case validator, and the checks that keep the data files honest. Offline and fast, because `npm run eval` runs it on every push.
//   intent-cases.json     DEV: the labelled cases of the studies, every original field kept under `source.record`
//   intent-controls.json  CONTROLS: clean messages that no cleaner or lane may change
//   intent-manifest.json  counts, the plan's targets, and a hash of each study file's cases
// The study files are not in the repository. Their cases are pinned by the hash in the manifest (checked here, always); with INTENT_STUDY_DIR set to the folder that holds them
// the records are also compared with the files themselves.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { detectLanguage as productLanguage } from "@scholar/shared";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs: the mapping from a study record to a case, shared with the script that wrote the data
import { DEV_FILES, detectLanguage, studyCase } from "./build-intent-cases.mjs";
// @ts-expect-error plain .mjs: the labelled messages of the router eval
import { CASES as ROUTER_CASES } from "@scholar/test-support/router-cases.mjs";
import { INTENT_SETS, contactProblems, frameMarkers, validateCase, type IntentCase } from "./lib/intent-schema";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const readJson = <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/* ---------- the validator ---------- */

const base = (): Record<string, unknown> => ({
  id: "dev-a-T2",
  set: "dev",
  language: "en",
  class: "typos",
  text: "diabetis treatmnet",
  author: "study",
  source: { file: "r3-cases-a.json", index: 1 },
});
const problemsOf = (over: Record<string, unknown>) => validateCase({ ...base(), ...over });
const has = (problems: string[], fragment: string) => problems.some((p) => p.includes(fragment));

describe("validateCase accepts what a study labelled and nothing less", () => {
  it("a case with only the required fields", () => {
    expect(validateCase(base())).toEqual([]);
  });

  it("a case with only the retrieval fields the study had (no gold at all)", () => {
    expect(problemsOf({ retrieval: { anchorsAnyOf: ["diabetes", "diabetic"], cleanOracle: "diabetes treatment" } })).toEqual([]);
  });

  it("a case with a few gold fields and the others absent", () => {
    expect(problemsOf({ gold: { tool: "search" } })).toEqual([]);
    expect(problemsOf({ gold: { ask: "none", years: { from: 2021 } } })).toEqual([]);
  });

  it("every gold field of plan 8.2 at once, and spell null as a label of its own", () => {
    const full = {
      lane: "none",
      tool: "search",
      topicAnyOf: [["convolutional", "convolution"], ["neural network", "neural networks"]],
      mustNotContain: ["rice"],
      removed: ["can you search about", "all papers"],
      ids: [{ kind: "doi", value: "10.1038/nature14539" }],
      years: { from: 2018, to: 2020 },
      count: 5,
      answerLanguage: "hinglish",
      ask: "acronym",
      spell: { from: "convoluton", to: "convolution" },
      protected: ["CAN bus"],
    };
    expect(problemsOf({ author: "person", source: undefined, set: "ask_typo_years_traps", gold: full })).toEqual([]);
    expect(problemsOf({ gold: { spell: null } })).toEqual([]);
  });

  it("a draft by the assistant needs no source, and a chain case may carry its earlier Readings", () => {
    expect(problemsOf({ author: "assistant-drafted", source: undefined })).toEqual([]);
    expect(problemsOf({ set: "chains", author: "person", source: undefined, prior: [{ v: 1, source: "rules", topic: "yoga diabetes" }] })).toEqual([]);
  });

  it("Devanagari text is hi, and a mix is hinglish", () => {
    expect(problemsOf({ language: "hi", text: "मधुमेह में योग के फायदे" })).toEqual([]);
    expect(problemsOf({ language: "hinglish", text: "diabetes में exercise के फायदे" })).toEqual([]);
  });

  it("an emoji (a surrogate pair) is one character and is not invisible", () => {
    expect(problemsOf({ text: "diabetes " + String.fromCodePoint(0x1f600) })).toEqual([]);
  });
});

describe("validateCase refuses a case that cannot be trusted", () => {
  const bad: [string, unknown, string][] = [
    ["a number", 42, "object"],
    ["an array", [], "object"],
    ["no id", { ...base(), id: undefined }, "id"],
    ["an id with a space", { ...base(), id: "dev a" }, "id"],
    ["an unknown set", { ...base(), set: "devv" }, "set"],
    ["an unknown language", { ...base(), language: "english" }, "language"],
    ["a class that is not a slug", { ...base(), class: "Typos And Filler" }, "class"],
    ["empty text", { ...base(), text: "" }, "text"],
    ["text that is not a string", { ...base(), text: 5 }, "text"],
    ["text over 20,000 characters", { ...base(), text: "a".repeat(20_001) }, "text"],
    ["a misspelt field name", { ...base(), langauge: "en" }, "langauge"],
    ["an unknown gold field", { ...base(), gold: { toll: "search" } }, "toll"],
    ["an unknown retrieval field", { ...base(), retrieval: { anchors: ["a"] } }, "anchors"],
    ["an unknown tool", { ...base(), gold: { tool: "browse" } }, "gold.tool"],
    ["an unknown lane", { ...base(), gold: { lane: "panic" } }, "gold.lane"],
    ["an unknown ask kind", { ...base(), gold: { ask: "maybe" } }, "gold.ask"],
    ["an unknown answer language", { ...base(), gold: { answerLanguage: "fr" } }, "gold.answerLanguage"],
    ["an empty gold object", { ...base(), gold: {} }, "gold"],
    ["an empty retrieval object", { ...base(), retrieval: {} }, "retrieval"],
    ["an empty list as a label", { ...base(), gold: { mustNotContain: [] } }, "gold.mustNotContain"],
    ["an empty alternative inside topicAnyOf", { ...base(), gold: { topicAnyOf: [[]] } }, "gold.topicAnyOf"],
    ["a blank string inside a list", { ...base(), retrieval: { anchorsAnyOf: ["a", " "] } }, "anchorsAnyOf"],
    ["years with from after to", { ...base(), gold: { years: { from: 2020, to: 2018 } } }, "gold.years"],
    ["years out of range", { ...base(), gold: { years: { from: 1850 } } }, "gold.years"],
    ["years with neither end", { ...base(), gold: { years: {} } }, "gold.years"],
    ["a count of 0", { ...base(), gold: { count: 0 } }, "gold.count"],
    ["a count of 51", { ...base(), gold: { count: 51 } }, "gold.count"],
    ["a count that is not whole", { ...base(), gold: { count: 2.5 } }, "gold.count"],
    ["an id of an unknown kind", { ...base(), gold: { ids: [{ kind: "isbn", value: "1" }] } }, "gold.ids"],
    ["spell without a to", { ...base(), gold: { spell: { from: "a" } } }, "gold.spell"],
    ["spell as a string", { ...base(), gold: { spell: "convolution" } }, "gold.spell"],
    ["an unknown author", { ...base(), author: "robot" }, "author"],
    ["a study case without a source", { ...base(), source: undefined }, "source"],
    ["a source with a negative index", { ...base(), source: { file: "f.json", index: -1 } }, "source.index"],
    ["a source with no file", { ...base(), source: { index: 0 } }, "source.file"],
    ["prior outside the chains set", { ...base(), prior: [{ v: 1 }] }, "prior"],
    ["an empty prior", { ...base(), set: "chains", prior: [] }, "prior"],
    ["a tag that is not a slug", { ...base(), tags: ["Not A Slug"] }, "tags"],
    ["the same tag twice", { ...base(), tags: ["a", "a"] }, "tags"],
    ["language hi without Devanagari", { ...base(), language: "hi" }, "Devanagari"],
    ["language en with Devanagari", { ...base(), text: "योग yoga" }, "Devanagari"],
    ["an e-mail address in the text", { ...base(), text: "write to asha.rao@example.org about dengue" }, "e-mail"],
    ["a link in the text", { ...base(), text: "see https://example.org/paper.pdf" }, "web address"],
    ["a phone number in the text", { ...base(), text: "call me on +91 98765 43210" }, "phone"],
    ["a zero-width character in the text", { ...base(), text: "dia" + String.fromCharCode(0x200b) + "betes" }, "invisible"],
    ["a control character in the text", { ...base(), text: "dia" + String.fromCharCode(0x07) + "betes" }, "invisible"],
    // one row for each class of character that shows nothing: pasted from a PDF or a Word file they come along unseen (a soft hyphen above all)
    ...(
      [
        ["a C1 control, the first (U+0080)", 0x80],
        ["a C1 control, next line (U+0085)", 0x85],
        ["a C1 control, the last (U+009F)", 0x9f],
        ["a soft hyphen (U+00AD)", 0xad],
        ["a combining grapheme joiner (U+034F)", 0x34f],
        ["a Mongolian vowel separator (U+180E)", 0x180e],
        ["a Hangul choseong filler (U+115F)", 0x115f],
        ["a Hangul jungseong filler (U+1160)", 0x1160],
        ["a Hangul filler (U+3164)", 0x3164],
        ["a halfwidth Hangul filler (U+FFA0)", 0xffa0],
        ["a variation selector (U+FE00)", 0xfe00],
        ["a variation selector (U+FE0F)", 0xfe0f],
        ["a variation selector of the supplement (U+E0100)", 0xe0100],
        ["a variation selector of the supplement (U+E01EF)", 0xe01ef],
        ["an interlinear annotation anchor (U+FFF9)", 0xfff9],
        ["an object replacement character (U+FFFC)", 0xfffc],
        ["a lone high surrogate (U+D83D)", 0xd83d],
        ["a lone low surrogate (U+DE00)", 0xde00],
      ] as [string, number][]
    ).map(([label, cp]): [string, unknown, string] => [label, { ...base(), text: "dia" + String.fromCodePoint(cp) + "betes" }, "invisible"]),
  ];
  it.each(bad)("%s", (_label, value, fragment) => {
    const problems = validateCase(value);
    expect(problems.length).toBeGreaterThan(0);
    expect(has(problems, fragment), problems.join(" | ")).toBe(true);
  });

  it("lists every problem, not only the first", () => {
    expect(validateCase({ ...base(), set: "nope", language: "xx", text: "" }).length).toBeGreaterThanOrEqual(3);
  });

  it("an oversized text gets its length problem and no scan: the contact and invisible checks are quadratic", () => {
    const long = "write to asha.rao@example.org about " + String.fromCharCode(0xad) + "a".repeat(20_001);
    const problems = problemsOf({ text: long });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("longer than 20000");
  });

  it("a text of 40,000 characters is refused in well under a second", () => {
    const started = Date.now();
    expect(has(problemsOf({ text: "a".repeat(40_000) }), "longer than")).toBe(true);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("contactProblems", () => {
  // Ten digits of another script are a phone number as much as ten ASCII ones (the Hindi and Hinglish writers may type either)
  const digitsOf = (zero: number) => Array.from({ length: 10 }, (_, i) => String.fromCodePoint(zero + i)).join("");
  const flagged = [
    "a.b@example.org", "mail asha_rao@mail.example.in please", "http://example.org/x", "www.example.org", "doi.org/10.1038/nature14539", "+91 98765 43210", "9876543210", "call 022-2345-6789 today", "98765-43210",
    "call " + digitsOf(0x966), // Devanagari digits
    "call " + digitsOf(0x660), // Arabic-Indic digits
    "call " + digitsOf(0xff10), // fullwidth digits
    "bit.ly/3xYz", "see bit.ly/3xYz for the data", "t.me/somegroup", "example.xyz/path", "Docs.Example.Studio/page",
    "john (at) gmail (dot) com", "john [at] gmail [dot] com",
  ];
  const clean = [
    "ISBN 978-3-16-148410-0",
    "ISBN-13: 978-3-16-148410-0",
    "trial 2019-2020-2021 results",
    "cohorts of 1990 2000 2010 2020",
    "recall@10 and precision@k for retrieval",
    "and/or, TCP/IP, e.g./i.e. and Fig.2/3",
    "Higgins et al./Thompson",
    "PMID: 33378609",
    "10.1109/CVPR.2016.90",
    "arXiv:1412.6980",
    "Statistics in Medicine, 21(11), 1539-1558",
    "papers between 2018-2020 on yoga",
    "global burden of 369 diseases and injuries in 204 countries and territories 1990-2019",
    "Higgins JPT. Stat Med. 2002;21(11):1539-58.",
    "COVID-19 variants 2021 vaccine",
    "10 papers on remote sensing",
    "sample size above 1000",
  ];
  it.each(flagged)("flags %s", (text) => expect(contactProblems(text).length).toBeGreaterThan(0));
  it.each(clean)("leaves %s alone", (text) => expect(contactProblems(text)).toEqual([]));
});

describe("frameMarkers", () => {
  const framed: [string, string][] = [
    ["Can you search about convoluton nueral netwrk all papers", "can you"],
    ["Can you search about convoluton nueral netwrk all papers", "all papers"],
    ["could you please find me some papers about microplastics", "could you"],
    ["please show me studies regarding groundwater depletion", "please"],
    ["hey, can u help me find research on quantum error correction? thanks!", "hey"],
    ["what is long covid exactly", "what is"],
    ["what is long covid exactly", "exactly"],
    ["how do you measure burnout in teachers", "how do you"],
    ["whats federated learning in simple terms", "in simple terms"],
    ["latest review papers on federated learning", "latest"],
    // plan 4.8 lists "the" among the leading determiners, so a title that opens with it is framed too (two G5 titles do: the manifest names them)
    ["the effect of minimum wage on employment", "lead:the"],
    ["The chemistry of layered nanosheets", "lead:the"],
    ["papers on graph neural networks", "papers on"],
    ["research about soil carbon", "research about"],
    ["top 5 papers about dark matter detection", "top 5"],
    ["give me all papers on transformer models", "give me"],
    ["list of every study on intermittent fasting", "every study"],
    ["Kerala floods in 2018 and rural health", "in 2018"],
    ["graph neural networks since 2019", "since 2019"],
    ["mujhe graph neural networks ke papers chahiye", "chahiye"],
  ];
  it.each(framed)("flags %s (%s)", (text, marker) => {
    const found = frameMarkers(text);
    expect(found.some((f) => f.includes(marker)), found.join(" | ")).toBe(true);
  });

  const traps = [
    "all-trans retinoic acid in acute promyelocytic leukemia",
    "CAN bus security in modern vehicles",
    "new-onset diabetes after kidney transplantation",
    "Papers with Code benchmarks for image classification",
    "TOP2A expression in cancer",
    "You Only Look Once: Unified, Real-Time Object Detection",
    "top-down proteomics of intact proteins",
    "attention is all you need",
    "Systematic Review and Meta-analysis",
    "Does intermittent fasting improve insulin sensitivity?",
    "Tokyo Olympics 2020 economic impact",
    "Climate Change 2007: Impacts, Adaptation and Vulnerability",
    "5-year survival after lung cancer surgery",
    "systematic review of mindfulness for student anxiety",
    "मधुमेह में योग के फायदे",
  ];
  it.each(traps)("leaves %s alone", (text) => expect(frameMarkers(text)).toEqual([]));
});

/* ---------- the data files ---------- */

type Manifest = {
  version: number;
  sets: Record<string, { target: number; targetKind: string; status: string; count: number; byClass: Record<string, number>; byLanguage: Record<string, number>; byAuthor: Record<string, number> }>;
  sources: Record<string, { key: string; count: number; fileSha256: string; casesSha256: string }>;
  dev: {
    reconciliation: { planCount: number; total: number; fromFile: Record<string, number>; notInPlanIds: string[] };
    doNotTouchClasses: string[];
    doNotTouchNote: string;
    intendedDuplicates: [string, string][];
    contestedLabels: { field: string; ids: string[]; why: string }[];
  };
  controls: {
    floor: number;
    frameExceptions: Record<string, string>;
    intendedOverlaps: [string, string][];
    composition: { router: { english: number; englishSearch: number; taken: number; leftOut: Record<string, number> }; g5: { taken: number; of: number }; g6: { taken: number; of: number } };
  };
};
const NOT_BUILT = "not built here: written by people";
const WRITTEN_BY_PEOPLE = ["safety_dev", "notsearch", "ids_cues", "ask_typo_years_traps", "rare_valid", "holdout", "chains"];

// Each file is read on first use, so a missing file fails only the tests that need it.
const memo = <T>(read: () => T) => {
  let value: T | undefined;
  return () => (value ??= read());
};
const devFile = memo(() => readJson<IntentCase[]>(HERE + "data/intent-cases.json"));
const controlsFile = memo(() => readJson<IntentCase[]>(HERE + "data/intent-controls.json"));
const manifestFile = memo(() => readJson<Manifest>(HERE + "data/intent-manifest.json"));
const data = () => ({
  get dev() {
    return devFile();
  },
  get controls() {
    return controlsFile();
  },
  get manifest() {
    return manifestFile();
  },
});
const countBy = (cases: IntentCase[], key: (c: IntentCase) => string) => {
  const out: Record<string, number> = {};
  for (const c of cases) out[key(c)] = (out[key(c)] ?? 0) + 1;
  return out;
};
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
// Built from code points: a typed escape in a source file can be turned into the character by an editor.
const DEVANAGARI = new RegExp("[" + String.fromCharCode(0x900) + "-" + String.fromCharCode(0x97f) + "]");
const hasDevanagari = (text: string) => DEVANAGARI.test(text);
const keyOf = (file: string) => (DEV_FILES as { key: string; file: string }[]).find((f) => f.file === file)!.key;

describe("the case files", () => {
  it("every case validates", () => {
    const { dev, controls } = data();
    const problems = [...dev, ...controls].flatMap((c) => validateCase(c).map((p) => `${(c as { id?: string }).id}: ${p}`));
    expect(problems).toEqual([]);
  });

  it("ids are unique across both files", () => {
    const { dev, controls } = data();
    const seen = new Set<string>();
    const dup = [...dev, ...controls].map((c) => c.id).filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
    expect(dup).toEqual([]);
  });

  it("each file holds only its own set", () => {
    const { dev, controls } = data();
    expect(new Set(dev.map((c) => c.set))).toEqual(new Set(["dev"]));
    expect(new Set(controls.map((c) => c.set))).toEqual(new Set(["controls"]));
  });

  it("no case text holds an e-mail address, a link or a phone number", () => {
    const { dev, controls } = data();
    const hits = [...dev, ...controls].flatMap((c) => contactProblems(c.text).map((p) => `${c.id}: ${p}`));
    expect(hits).toEqual([]);
  });

  it("no text appears twice in a file, and none in both files, unless the manifest lists the pair as intended", () => {
    const { dev, controls, manifest } = data();
    const within = (cases: IntentCase[]) => {
      const seen = new Map<string, string>();
      const dups: [string, string][] = [];
      for (const c of cases) {
        const k = norm(c.text);
        if (seen.has(k)) dups.push([seen.get(k)!, c.id]);
        else seen.set(k, c.id);
      }
      return dups;
    };
    expect(within(dev)).toEqual(manifest.dev.intendedDuplicates);
    expect(within(controls)).toEqual([]);
    const devByText = new Map(dev.map((c) => [norm(c.text), c.id]));
    const across = controls.filter((c) => devByText.has(norm(c.text))).map((c) => [devByText.get(norm(c.text))!, c.id] as [string, string]);
    expect(across).toEqual(manifest.controls.intendedOverlaps);
  });
});

describe("the manifest", () => {
  it("counts match the files, per set, class, language and author", () => {
    const { dev, controls, manifest } = data();
    for (const [set, cases] of [["dev", dev], ["controls", controls]] as const) {
      const m = manifest.sets[set]!;
      expect(m.count, set).toBe(cases.length);
      expect(m.byClass, set).toEqual(countBy(cases, (c) => c.class));
      expect(m.byLanguage, set).toEqual(countBy(cases, (c) => c.language));
      expect(m.byAuthor, set).toEqual(countBy(cases, (c) => c.author));
    }
  });

  it("names every set of the plan with its target, and marks the sets that people write as not built here", () => {
    const { manifest } = data();
    expect(Object.keys(manifest.sets).sort()).toEqual([...INTENT_SETS].sort());
    const targets = { dev: 185, safety_dev: 395, notsearch: 460, ids_cues: 390, ask_typo_years_traps: 330, controls: 300, rare_valid: 100, holdout: 120, chains: 25 };
    for (const [set, target] of Object.entries(targets)) expect(manifest.sets[set]!.target, set).toBe(target);
    expect(manifest.sets.controls!.targetKind).toBe("at_least");
    for (const set of WRITTEN_BY_PEOPLE) {
      expect(manifest.sets[set]!.status, set).toBe(NOT_BUILT);
      expect(manifest.sets[set]!.count, set).toBe(0);
    }
    expect(manifest.sets.dev!.status).toBe("built");
    expect(manifest.sets.controls!.status).toBe("built");
  });

  it("reconciles the 185 of the plan with the records of the five study files", () => {
    const { dev, manifest } = data();
    const r = manifest.dev.reconciliation;
    expect(r.planCount).toBe(185);
    expect(r.fromFile).toEqual({ "r3-cases-a.json": 40, "r3-cases-b.json": 40, "r3-cases-c1.json": 48, "r3-cases-c2.json": 48, "r3-cases-c2-followups.json": 11 });
    expect(dev.length).toBe(r.total);
    expect(r.total - r.notInPlanIds.length).toBe(r.planCount);
    const flagged = dev.filter((c) => c.tags?.includes("study-control")).map((c) => c.id);
    expect(flagged.sort()).toEqual([...r.notInPlanIds].sort());
  });
});

describe("DEV: the studies' cases", () => {
  it("each study file's cases are the ones the manifest hashed (the data was not edited)", () => {
    const { dev, manifest } = data();
    for (const { file } of DEV_FILES as { file: string }[]) {
      const own = dev.filter((c) => c.source?.file === file).sort((a, b) => a.source!.index - b.source!.index);
      const m = manifest.sources[file]!;
      expect(own.length, file).toBe(m.count);
      expect(own.map((c) => c.source!.index), file).toEqual(own.map((_, i) => i));
      expect(sha256(JSON.stringify(own.map((c) => c.source!.record))), file).toBe(m.casesSha256);
    }
  });

  it("every case is what the mapping makes of its own source record (no gold label was added by hand)", () => {
    const { dev } = data();
    const followUps = Object.fromEntries(
      dev.filter((c) => c.source?.file === "r3-cases-c2-followups.json").map((c) => [(c.source!.record as { parent: string }).parent, c.source!.record]),
    );
    const diff = dev.filter((c) => JSON.stringify(studyCase(keyOf(c.source!.file), c.source!.record, c.source!.index, followUps)) !== JSON.stringify(c)).map((c) => c.id);
    expect(diff).toEqual([]);
  });

  it("maps only what a study states, on one case of each kind", () => {
    const { dev } = data();
    const by = (id: string) => dev.find((c) => c.id === id)!;
    // study a: the hand-cleaned form and the anchors, nothing else
    expect(by("dev-a-T1")).toMatchObject({
      language: "en",
      languageBasis: "latin",
      class: "typos",
      text: "Can you search about convoluton nueral netwrk all papers",
      retrieval: { anchorsAnyOf: ["convolutional", "convolution", "CNN", "neural network"], cleanOracle: "convolutional neural network" },
      author: "study",
      source: { file: "r3-cases-a.json", index: 0 },
    });
    expect(by("dev-a-T1").gold).toBeUndefined();
    // study b: language, year range, no spelling change expected, a clean query; the labels of an "ask back" case stay absent
    // "after 2020" is read as 2021 by the study and "published after 2019" as 2019 by the plan (4.16): the open-ended years stay unlabelled until the owner decides, a closed range is not in doubt
    expect(by("dev-b-H5")).toMatchObject({ language: "hinglish", languageBasis: "source", class: "hindi_hinglish", gold: { tool: "search", ask: "none", spell: null } });
    expect(by("dev-b-H5").gold).not.toHaveProperty("years");
    expect(by("dev-b-C1").gold).not.toHaveProperty("years");
    expect(by("dev-b-C2").gold).toMatchObject({ years: { from: 2018, to: 2020 } });
    expect(by("dev-b-V1").gold).toEqual({ spell: null });
    expect(by("dev-b-H4").gold).not.toHaveProperty("spell");
    // study c1: the tool wanted; "search" and "search and say the assumption" mean no ask, "ask back" does not say which kind
    expect(by("dev-c1-01").gold).toEqual({ tool: "search", ask: "none" });
    expect(by("dev-c1-31").gold).toEqual({ tool: "search" });
    expect(by("dev-c1-37").gold).toEqual({ tool: "search", ask: "none" });
    // study c2 and its follow-ups
    expect(by("dev-c2-28").gold).toEqual({ tool: "small_talk" });
    expect(by("dev-c2-20").gold).toEqual({ tool: "verify", ask: "none" });
    expect(by("dev-c2-46")).toMatchObject({ language: "other", languageBasis: "no-letters", gold: { tool: "none" } });
    expect(by("dev-c2-09").retrieval).toMatchObject({ cleanOracle: "arXiv:1412.6980" });
    expect(by("dev-c2-22").retrieval?.cleanOracle).toBeUndefined();
    // a probe control with the same parent is not a hand-cleaned form of the case
    expect(by("dev-c2-21").retrieval?.cleanOracle).toBeUndefined();
    expect(by("dev-c2-29").retrieval?.cleanOracle).toBeUndefined();
    expect(by("dev-c2-42").retrieval?.cleanOracle).toBe("insulin resistance");
    expect(by("dev-c2-22s").gold).toEqual({ tool: "idea" });
    expect(by("dev-c2-29c").tags).toEqual(["followup", "study-control"]);
    expect(by("dev-c2-29c").gold).toEqual({ tool: "small_talk" });
  });

  it("no case carries a lane, a count, ids, removed phrases or a protected token: the studies did not label them", () => {
    const { dev } = data();
    const extra = dev.flatMap((c) => Object.keys(c.gold ?? {}).filter((k) => !["tool", "ask", "years", "spell"].includes(k)).map((k) => `${c.id}: gold.${k}`));
    expect(extra).toEqual([]);
  });

  it("the language of every case is decided by the source, by script or by Roman Hindi words, and says which", () => {
    const { dev } = data();
    for (const c of dev) {
      expect(["source", "devanagari", "roman-hindi-words", "latin", "other-script", "no-letters"], c.id).toContain(c.languageBasis);
      if (c.languageBasis !== "source") expect(detectLanguage(c.text), c.id).toEqual({ language: c.language, basis: c.languageBasis });
    }
    expect(countBy(dev, (c) => c.languageBasis ?? "").source).toBe(40);
  });

  it("names the classes the cleaner must leave alone (plan 4.8) so a later test can pick them from DEV", () => {
    const { dev, manifest } = data();
    const classes = new Set(dev.map((c) => c.class));
    expect(manifest.dev.doNotTouchClasses.length).toBeGreaterThanOrEqual(5);
    for (const k of manifest.dev.doNotTouchClasses) expect(classes.has(k), k).toBe(true);
  });

  it("says that a do-not-touch class is a whole class: the exact-title class also holds a half-remembered and a misspelt title", () => {
    const { dev, manifest } = data();
    const inClass = dev.filter((c) => c.class === "known_paper_by_title").map((c) => c.id);
    expect(inClass).toEqual(["dev-c2-01", "dev-c2-02", "dev-c2-03"]);
    expect(manifest.dev.doNotTouchNote).toContain("dev-c2-02");
    expect(manifest.dev.doNotTouchNote).toContain("dev-c2-03");
  });

  it("leaves 'after N' unlabelled and names the cases (the study reads 'after 2020' as 2021, plan 4.16 reads 'after 2019' as 2019)", () => {
    const { dev, manifest } = data();
    const openEnded = dev
      .filter((c) => {
        const k = (c.source?.record as { constraint?: { type?: string; to?: number } } | undefined)?.constraint;
        return k?.type === "year" && k.to === undefined;
      })
      .map((c) => c.id);
    expect(openEnded.length).toBeGreaterThan(0);
    const contested = manifest.dev.contestedLabels.find((x) => x.field === "gold.years");
    expect(contested?.ids.slice().sort()).toEqual(openEnded.sort());
    expect(contested?.why).toContain("4.16");
    // no case carries a year range with only a start: that is exactly the contested reading
    expect(dev.filter((c) => c.gold?.years && c.gold.years.to === undefined).map((c) => c.id)).toEqual([]);
  });

  // The study files are outside the repository: this runs where INTENT_STUDY_DIR points at the folder that holds them.
  const dir = process.env.INTENT_STUDY_DIR;
  it.skipIf(!dir || !existsSync(dir))("the records equal the study files on disk, and the files are the ones the manifest hashed", () => {
    const { dev, manifest } = data();
    for (const { file } of DEV_FILES as { file: string }[]) {
      const raw = readFileSync(dir + "/" + file, "utf8");
      expect(sha256(raw), file).toBe(manifest.sources[file]!.fileSha256);
      const cases = (JSON.parse(raw) as { cases: unknown[] }).cases;
      const own = dev.filter((c) => c.source?.file === file);
      expect(own.length, file).toBe(cases.length);
      for (const c of own) expect(c.source!.record, c.id).toEqual(cases[c.source!.index]);
    }
  });
});

/* ---------- CONTROLS ---------- */

const TRAP_TOKENS = ["all-trans retinoic acid", "TOP2A", "CAN bus", "You Only Look Once", "Papers with Code", "new-onset diabetes", "CRISPR", "GAN", "BERT", "RAG", "5G", "GPT-4"];
const STYLES = ["style-phrase", "style-question", "style-title", "style-year", "style-quote"];

describe("CONTROLS: messages no cleaner or lane may change", () => {
  it("there are at least as many as the plan asks for", () => {
    const { controls, manifest } = data();
    expect(manifest.controls.floor).toBe(300);
    expect(controls.length).toBeGreaterThanOrEqual(manifest.controls.floor);
  });

  it("none opens or closes with a filler frame (plan 4.8's closed lists), unless the manifest names it and says why", () => {
    const { controls, manifest } = data();
    const framed = controls.filter((c) => frameMarkers(c.text).length > 0).map((c) => c.id);
    expect(framed.sort()).toEqual(Object.keys(manifest.controls.frameExceptions).sort());
    for (const reason of Object.values(manifest.controls.frameExceptions)) expect(reason.length).toBeGreaterThan(20);
  });

  it("the three frame exceptions are the three titles that plan 4.8's lists would change: two open with 'the', one with 'how to'", () => {
    const { manifest } = data();
    expect(Object.keys(manifest.controls.frameExceptions).sort()).toEqual(["ctl-g5-24", "ctl-g5-30", "ctl-g6-08"]);
    for (const id of ["ctl-g5-24", "ctl-g5-30"]) expect(manifest.controls.frameExceptions[id], id).toMatch(/determiner.*the|the.*determiner/i);
    for (const reason of Object.values(manifest.controls.frameExceptions)) expect(reason).toContain("plan");
  });

  it("the language of every control is what the product's own detector says (R8 cleans only what the product calls English)", () => {
    const { controls } = data();
    const off = controls.filter((c) => productLanguage(c.text) !== c.language).map((c) => `${c.id} (${c.language}, the product says ${productLanguage(c.text)}): ${c.text}`);
    expect(off).toEqual([]);
  });

  it("there are 15 Hindi controls in Devanagari and 15 Hinglish ones (what makes a Hinglish one Hinglish is the product's own detector, in the test above)", () => {
    const { controls } = data();
    const hi = controls.filter((c) => c.language === "hi");
    const hinglish = controls.filter((c) => c.language === "hinglish");
    expect([hi.length, hinglish.length]).toEqual([15, 15]);
    for (const c of hi) expect(hasDevanagari(c.text), c.id).toBe(true);
  });

  it("the 30 known-item titles are the first 30 of papers.json, in order (that file has no G5 marker), and the 20 landmark queries are all of topical.json", () => {
    const { controls } = data();
    const papers = readJson<{ title: string }[]>(HERE + "data/papers.json");
    const topical = readJson<{ q: string }[]>(HERE + "data/topical.json");
    const g5 = controls.filter((c) => c.class === "g5_title").sort((a, b) => a.source!.index - b.source!.index);
    const g6 = controls.filter((c) => c.class === "g6_query").sort((a, b) => a.source!.index - b.source!.index);
    expect(g5.map((c) => c.text)).toEqual(papers.slice(0, 30).map((p) => p.title));
    expect(g6.map((c) => c.text)).toEqual(topical.map((t) => t.q));
    expect(g5.every((c) => c.source!.file === "apps/api/eval/data/papers.json")).toBe(true);
    expect(g6.every((c) => c.source!.file === "apps/api/eval/data/topical.json")).toBe(true);
  });

  it("the router controls are English cases of router-cases.mjs whose gold tool is search, word for word", () => {
    const { controls } = data();
    const router = controls.filter((c) => c.class === "router_search");
    expect(router.length).toBeGreaterThanOrEqual(10);
    for (const c of router) {
      const [text, mode, language] = (ROUTER_CASES as [string, unknown, string, string][])[c.source!.index]!;
      expect(c.text, c.id).toBe(text);
      expect(mode, c.id).toBe("search");
      expect(language, c.id).toBe("en");
      expect(c.gold?.tool, c.id).toBe("search");
    }
  });

  it("says how the English router cases were chosen, and the counts add up", () => {
    const { controls, manifest } = data();
    const { router, g5, g6 } = manifest.controls.composition;
    const rows = ROUTER_CASES as [string, unknown, string, string][];
    const searches = rows.filter((x) => x[2] === "en" && x[1] === "search");
    expect(router.english).toBe(rows.filter((x) => x[2] === "en").length);
    expect(router.englishSearch).toBe(searches.length);
    expect(router.taken).toBe(controls.filter((c) => c.class === "router_search").length);
    expect(router.taken + Object.values(router.leftOut).reduce((a, b) => a + b, 0)).toBe(router.englishSearch);
    expect(router.leftOut.typo).toBe(searches.filter((x) => x[3] === "typo").length);
    expect(router.leftOut.small_talk_or_order).toBe(searches.filter((x) => x[3] === "safe").length);
    expect(g5.taken).toBe(controls.filter((c) => c.class === "g5_title").length);
    expect(g6).toEqual({ taken: controls.filter((c) => c.class === "g6_query").length, of: readJson<unknown[]>(HERE + "data/topical.json").length });
    expect(g5.of).toBe(readJson<unknown[]>(HERE + "data/papers.json").length);
  });

  it("the trap tokens of the plan each appear in at least three clean queries, and the control says which token it protects", () => {
    const { controls } = data();
    for (const token of TRAP_TOKENS) {
      const own = controls.filter((c) => c.class === "trap_token" && c.text.includes(token));
      expect(own.length, token).toBeGreaterThanOrEqual(3);
      for (const c of own) expect(c.gold?.protected, c.id).toContain(token);
    }
  });

  it("the new clean messages are marked as the assistant's drafts, span at least 15 fields and five styles, and include Hindi and Hinglish", () => {
    const { controls } = data();
    const drafts = controls.filter((c) => c.author === "assistant-drafted");
    expect(drafts.length).toBeGreaterThanOrEqual(150);
    expect(drafts.every((c) => c.source === undefined)).toBe(true);
    const fields = new Set(drafts.flatMap((c) => (c.tags ?? []).filter((t) => t.startsWith("field-"))));
    expect(fields.size).toBeGreaterThanOrEqual(15);
    for (const style of STYLES) expect(drafts.some((c) => c.tags?.includes(style)), style).toBe(true);
    expect(drafts.filter((c) => c.language === "hi").length).toBeGreaterThanOrEqual(10);
    expect(drafts.filter((c) => c.language === "hinglish").length).toBeGreaterThanOrEqual(10);
    expect(drafts.filter((c) => c.language === "en").length).toBeGreaterThanOrEqual(100);
  });

  it("a control that is not a draft says where it came from, and a draft names no person's text", () => {
    const { controls } = data();
    for (const c of controls.filter((c) => c.author !== "assistant-drafted")) {
      expect(c.source?.file, c.id).toBeTruthy();
      expect(Number.isInteger(c.source?.index), c.id).toBe(true);
    }
    expect(controls.some((c) => c.author === "person")).toBe(false);
  });

  it("the controls taken from the repository's own files are authored 'repository', not 'study': none of them is from the studies", () => {
    const { controls } = data();
    expect(controls.filter((c) => c.author === "study")).toEqual([]);
    const fromRepository = controls.filter((c) => c.author === "repository");
    expect(fromRepository.length).toBe(64);
    expect(fromRepository.every((c) => c.source!.file.startsWith("apps/api/eval/") || c.source!.file.startsWith("apps/api/scripts/"))).toBe(true);
    expect(new Set(fromRepository.map((c) => c.class))).toEqual(new Set(["router_search", "g5_title", "g6_query"]));
  });

  it("a style tag says what the text is: a title has no question mark, a question has one, a year style has a year, a quote style has quotation marks (English drafts)", () => {
    const { controls } = data();
    const quote = new RegExp("[" + String.fromCharCode(0x22, 0x27, 0x2018, 0x2019, 0x201c, 0x201d) + "]");
    const drafts = controls.filter((c) => c.author === "assistant-drafted" && c.language === "en");
    const slips: string[] = [];
    for (const c of drafts) {
      const has = (tag: string) => c.tags?.includes(tag);
      if (has("style-title") && c.text.includes("?")) slips.push(c.id + " style-title but it has a question mark");
      if (has("style-question") && !c.text.includes("?")) slips.push(c.id + " style-question but it has no question mark");
      if (has("style-year") && !/(?:^|[^0-9])(?:1[89]|20)[0-9]{2}(?![0-9])/.test(c.text)) slips.push(c.id + " style-year but it has no four-digit year");
      if (has("style-quote") && !quote.test(c.text)) slips.push(c.id + " style-quote but it has no quotation mark");
    }
    expect(slips).toEqual([]);
  });

  it("no drafted control names a living public figure (the one the review found stays out)", () => {
    const { controls } = data();
    expect(controls.filter((c) => /hazare/i.test(c.text)).map((c) => c.id)).toEqual([]);
  });
});
