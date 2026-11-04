// Builds the DEV set of the intent eval (plan 8.2) from the labelled cases of the studies, and the manifest of the eval data. Run on the machine that has the study files; the output is committed, and
// intent-data.eval.ts checks it (the study files themselves are not in the repository).
//   node eval/build-intent-cases.mjs --src <folder with r3-cases-a.json, r3-cases-b.json, r3-cases-c1.json, r3-cases-c2.json, r3-cases-c2-followups.json>
// Writes data/intent-cases.json. If data/intent-controls.json exists it also writes data/intent-manifest.json (counts, the plan's targets, a hash of each study file's cases).
//   node eval/build-intent-cases.mjs
// With no --src it rewrites only the manifest, from the committed files and the study hashes already in it: run it after editing data/intent-controls.json.
//
// The mapping keeps EVERY original field of a record under `source.record`, and puts into the gold schema only what the study states:
//   a   anchors -> retrieval.anchorsAnyOf, clean (the hand-cleaned form) -> retrieval.cleanOracle
//   b   language; anyOf -> anchorsAnyOf, alsoAnyOf -> anchorsAlsoAnyOf; goodSystemDoes.cleanQuery -> cleanOracle (not "two searches: ..." lines, which are not one query);
//       goodSystemDoes.action "search" or "search_and_offer_narrowing" -> gold.tool search, and "search" -> gold.ask none; a year range with both ends -> gold.years (an "after N" with only a start is
//       NOT labelled: the study reads "after 2020" as 2021 and plan 4.16 reads "published after 2019" as 2019, so the owner decides; see CONTESTED_LABELS); typos false -> gold.spell null
//   c1  toolWanted -> gold.tool; shouldDo "search" or "search_and_say_assumption" -> gold.ask none; mustContainAny -> anchorsAnyOf
//   c2  tool_wanted -> gold.tool; ideal_action "search" or "search_and_say_assumed" -> gold.ask none; must_contain -> anchorsAnyOf (any of: c2-01's own exact title lacks "ResNet");
//       the follow-up of a case (the words a good router would have produced) -> the case's retrieval.cleanOracle, unless it is the case's own message again
//   c2f the follow-ups are cases of their own (tool_wanted, must_contain); the two with "control:" in their intended_topic are tagged study-control and are not used as a cleanOracle
// "ask_back" and "not_a_search" say that the system should not just search, but not which kind of question or lane: those fields stay absent. A missing field is "not labelled".
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CASES as ROUTER_CASES } from "../scripts/router-cases.mjs";

export const DEV_FILES = [
  { key: "a", file: "r3-cases-a.json" },
  { key: "b", file: "r3-cases-b.json" },
  { key: "c1", file: "r3-cases-c1.json" },
  { key: "c2", file: "r3-cases-c2.json" },
  { key: "c2f", file: "r3-cases-c2-followups.json" },
];
const FILE_OF = Object.fromEntries(DEV_FILES.map((f) => [f.key, f.file]));

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
// Study b names its classes by letter in its meta ("H hindi-hinglish"); study c2 gives a number and names the categories in the merge report (r3-categories.txt, rows B1 to B14).
const B_CLASS = { H: "hindi_hinglish", C: "constraints", N: "negation_exclusion", M: "comparison_multipart", Q: "claim_form", V: "vague_broad", A: "acronym_ambiguity", I: "india_focused" };
const C2_CLASS = {
  1: "known_paper_by_title",
  2: "known_paper_by_authors_and_year",
  3: "doi_pmid_or_arxiv_id",
  4: "papers_by_an_author",
  5: "papers_from_institution_or_journal",
  6: "reference_list_to_check",
  7: "idea_to_test_for_novelty",
  8: "question_about_one_paper",
  9: "small_talk_variants",
  10: "off_topic_everyday_or_code",
  11: "request_it_cannot_do",
  12: "prompt_injection_or_extraction",
  13: "long_paste_with_request_at_end",
  14: "empty_ish_message",
};

/* ---------------------------------------------------------------- language */

// Devanagari is built from code points: a typed escape in a source file can be turned into the character by an editor.
const DEVA = new RegExp("[" + String.fromCharCode(0x900) + "-" + String.fromCharCode(0x97f) + "]");
// A closed list of Roman-letter Hindi words that are not English words (ambiguous ones such as me, do, to, par, ne, se, ko are left out). Two different ones make a message Hinglish.
const ROMAN_HINDI = new Set(
  "ka ki ke kya hai hain kaise kyun kyu nahi nahin aur lekin mera meri mere mujhe aap hum tum liye chahiye batao bataiye dikhao dhundo dhoondo asar fayde fayda hota hoti hote karta karte karna wala wali wale tarike bachav ilaj kitna kitni baare baad ye woh iska uska unka".split(" "),
);

/** The language of a message when the study does not say, and how it was decided. Conservative: Devanagari means hi (hinglish when a third or more of the letters are Latin), two different Roman-letter Hindi words mean hinglish, a message with no letter has no language. */
export function detectLanguage(text) {
  const letters = [...text].filter((ch) => /\p{L}/u.test(ch));
  if (letters.length === 0) return { language: "other", basis: "no-letters" };
  const deva = letters.filter((ch) => DEVA.test(ch)).length;
  const latin = letters.filter((ch) => /[A-Za-z]/.test(ch)).length;
  if (deva > 0 && deva / letters.length >= 0.3) return { language: latin / letters.length >= 0.3 ? "hinglish" : "hi", basis: "devanagari" };
  if ((letters.length - latin - deva) / letters.length > 0.5) return { language: "other", basis: "other-script" };
  const hits = new Set((text.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => ROMAN_HINDI.has(w)));
  if (hits.size >= 2) return { language: "hinglish", basis: "roman-hindi-words" };
  return { language: "en", basis: "latin" };
}

/* ---------------------------------------------------------------- one record -> one case */

const nonEmpty = (a) => Array.isArray(a) && a.length > 0;
// The two probe controls of the follow-ups file (the same references in APA style; the exact small-talk phrase) say "control:" in their intended_topic: they are not a cleaned form of their parent.
const isProbeControl = (r) => /^control:/.test(r.intended_topic ?? "");
const SEARCHES = new Set(["search", "search_and_say_assumption", "search_and_say_assumed"]);

/**
 * The case that a study record makes. `followUps` maps a case id to the record of its follow-up (study c2). Pure; the same call gives the same JSON, which intent-data.eval.ts relies on.
 */
export function studyCase(key, r, index, followUps = {}) {
  const file = FILE_OF[key];
  const id = key === "a" || key === "b" ? `dev-${key}-${r.id}` : `dev-${r.id}`;
  const { language, basis } = key === "b" ? { language: r.language, basis: "source" } : detectLanguage(r.message);
  const gold = {};
  const retrieval = {};
  let cls;
  let tags;

  if (key === "a") {
    cls = slug(r.class);
    if (nonEmpty(r.anchors)) retrieval.anchorsAnyOf = r.anchors;
    if (r.clean) retrieval.cleanOracle = r.clean;
  } else if (key === "b") {
    cls = B_CLASS[r.class];
    const action = r.goodSystemDoes?.action;
    if (typeof action === "string" && action.startsWith("search")) gold.tool = "search";
    if (action === "search") gold.ask = "none";
    if (r.constraint?.type === "year" && r.constraint.to !== undefined) gold.years = { from: r.constraint.from, to: r.constraint.to };
    if (r.typos === false) gold.spell = null;
    if (nonEmpty(r.anyOf)) retrieval.anchorsAnyOf = r.anyOf;
    if (nonEmpty(r.alsoAnyOf)) retrieval.anchorsAlsoAnyOf = r.alsoAnyOf;
    const clean = r.goodSystemDoes?.cleanQuery;
    if (clean && !/^two searches:/.test(clean)) retrieval.cleanOracle = clean;
  } else if (key === "c1") {
    cls = slug(r.catName);
    gold.tool = r.toolWanted;
    if (SEARCHES.has(r.shouldDo)) gold.ask = "none";
    if (nonEmpty(r.mustContainAny)) retrieval.anchorsAnyOf = r.mustContainAny;
  } else {
    cls = C2_CLASS[r.cat];
    gold.tool = r.tool_wanted;
    if (SEARCHES.has(r.ideal_action)) gold.ask = "none";
    if (nonEmpty(r.must_contain)) retrieval.anchorsAnyOf = r.must_contain;
    const follow = key === "c2" ? followUps[r.id] : undefined;
    if (follow && !isProbeControl(follow) && follow.message !== r.message) retrieval.cleanOracle = follow.message;
    if (key === "c2f") tags = isProbeControl(r) ? ["followup", "study-control"] : ["followup"];
  }

  const out = { id, set: "dev", language, languageBasis: basis, class: cls, text: r.message };
  if (Object.keys(gold).length) out.gold = gold;
  if (Object.keys(retrieval).length) out.retrieval = retrieval;
  out.author = "study";
  out.source = { file, index, record: r };
  if (tags) out.tags = tags;
  return out;
}

/* ---------------------------------------------------------------- the manifest */

const NOT_BUILT = "not built here: written by people";
const PLAN_SETS = {
  dev: { target: 185, targetKind: "exact", writtenBy: "the studies (visible to builders: tuning allowed)", neededBefore: "R3" },
  safety_dev: { target: 395, targetKind: "about", writtenBy: "a clinician and a student, not the engineers; the owner in his natural Hinglish for the Hinglish part", neededBefore: "R4 (first)" },
  notsearch: { target: 460, targetKind: "about", writtenBy: "people", neededBefore: "R10" },
  ids_cues: { target: 390, targetKind: "about", writtenBy: "people; the lists built from the real references of the reference-extraction fixtures", neededBefore: "R13, R15" },
  ask_typo_years_traps: { target: 330, targetKind: "about", writtenBy: "people", neededBefore: "R8, R12, R16, R17" },
  controls: {
    target: 300,
    targetKind: "at_least",
    writtenBy: "existing repository data (the English router cases, the G5 titles, the G6 queries) plus clean messages drafted by the assistant, for the owner to review",
    neededBefore: "R8",
  },
  rare_valid: { target: 100, targetKind: "exact", writtenBy: "people", neededBefore: "R12" },
  holdout: { target: 120, targetKind: "exact", writtenBy: "the owner, a medical student, a PhD student and a clinician; no writer sees another's list", neededBefore: "E0 end" },
  chains: { target: 25, targetKind: "exact", writtenBy: "two writers per gold standalone question (the CAsT method), 20% frozen", neededBefore: "R20" },
};
const BUILT_HERE = new Set(["dev", "controls"]);
// The plan lists all 20 G6 queries as controls, but plan 4.8 lists "how to" as a question stem the cleaner takes off: the plan disagrees with itself on this one query.
// The same kind of disagreement for the determiner "the": plan 4.8 lists it among the leading words to take off, and two of the 30 G5 titles open with it.
const FRAME_EXCEPTIONS = {
  "ctl-g5-24": "Plan 8.2 names the 30 G5 titles as controls, and this one opens with 'The', which plan 4.8 lists among the leading determiners (some, any, all, the, a few) to take off: the plan disagrees with itself, and its author decides which list wins.",
  "ctl-g5-30": "Plan 8.2 names the 30 G5 titles as controls, and this one opens with 'The', which plan 4.8 lists among the leading determiners (some, any, all, the, a few) to take off: the plan disagrees with itself, and its author decides which list wins.",
  "ctl-g6-08": "Plan 8.2 names all 20 G6 queries as controls, and this one opens with 'how to', which plan 4.8 lists as a question stem to take off: the plan disagrees with itself, and its author decides which list wins.",
};
const INTENDED_OVERLAPS = [];
// c2-22s is c2-22's own sentence searched by hand (mode search), written after the 48: two cases with one text and two modes.
const INTENDED_DUPLICATES = [["dev-c2-22", "dev-c2-22s"]];
// Plan 4.8: comparison, method or dataset, narrow technical, thin literature, exact title. The exact title is dev-c2-01; the class also holds a half-remembered (c2-02) and a misspelt (c2-03) title.
const DO_NOT_TOUCH_CLASSES = ["comparison", "topic_by_method_or_dataset", "very_narrow_technical", "little_open_literature", "known_paper_by_title"];
const DO_NOT_TOUCH_NOTE =
  "A class is taken whole. known_paper_by_title holds the exact title (dev-c2-01) and also a half-remembered title (dev-c2-02) and a misspelt one (dev-c2-03); a test that wants only exact titles picks dev-c2-01.";
// A label the studies give but the plan reads the other way: left out of the data until the owner decides, so that no gate is judged against it.
const CONTESTED_LABELS = [
  {
    field: "gold.years",
    ids: ["dev-b-C1", "dev-b-H5"],
    why: "Study b reads 'after 2020' as years.from 2021 (after means later than). Plan 4.16 reads 'published after 2019' as years.from 2019. The same wording gives two labels, so R16's '40 of 40 year phrases read' cannot be judged against either until the owner says whether 'after N' includes N. The closed range of dev-b-C2 (between 2018 and 2020) is not in doubt and is labelled.",
  },
];

const countBy = (cases, key) => {
  const out = {};
  for (const c of cases) out[key(c)] = (out[key(c)] ?? 0) + 1;
  return out;
};
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const DATA = fileURLToPath(new URL("./data/", import.meta.url));
// papers.json has no "G5 titles" marker: the first 30 are used. topical.json is the 20 G6 queries.
const G5_FILE_LENGTH = JSON.parse(readFileSync(DATA + "papers.json", "utf8")).length;
const G6_FILE_LENGTH = JSON.parse(readFileSync(DATA + "topical.json", "utf8")).length;

/** How the controls were taken from the router cases: of the English cases whose gold tool is search, the clean ones; the others and why. */
function routerComposition(controls) {
  const english = ROUTER_CASES.filter((c) => c[2] === "en");
  const searches = english.filter((c) => c[1] === "search");
  const taken = controls.filter((c) => c.class === "router_search");
  const takenTexts = new Set(taken.map((c) => c.text));
  const rest = searches.filter((c) => !takenTexts.has(c[0]));
  const isId = (text) => /^(?:10\.\d|arxiv:)/i.test(text);
  const leftOut = {
    typo: rest.filter((c) => c[3] === "typo").length,
    small_talk_or_order: rest.filter((c) => c[3] === "safe").length,
    id: rest.filter((c) => c[3] !== "typo" && c[3] !== "safe" && isId(c[0])).length,
  };
  leftOut.frame = rest.length - leftOut.typo - leftOut.small_talk_or_order - leftOut.id;
  return { english: english.length, englishSearch: searches.length, taken: taken.length, leftOut };
}

export function buildManifest({ dev, controls, sources }) {
  const sets = {};
  for (const [set, plan] of Object.entries(PLAN_SETS)) {
    const cases = set === "dev" ? dev : set === "controls" ? controls : [];
    sets[set] = {
      ...plan,
      status: BUILT_HERE.has(set) ? "built" : NOT_BUILT,
      count: cases.length,
      byClass: countBy(cases, (c) => c.class),
      byLanguage: countBy(cases, (c) => c.language),
      byAuthor: countBy(cases, (c) => c.author),
    };
  }
  const fromFile = Object.fromEntries(DEV_FILES.map(({ file }) => [file, dev.filter((c) => c.source.file === file).length]));
  const notInPlanIds = dev.filter((c) => c.tags?.includes("study-control")).map((c) => c.id);
  return {
    version: 1,
    plan: "docs/design/intent-and-state.md, section 8.2",
    note: "A missing gold field means not labelled. Sets not built here are written by people (plan 8.2): no text of theirs exists in this repository, and the hold-out is not created here.",
    sets,
    sourcesNote: "The study files are outside the repository (the studies' working folder): only their base names are recorded. fileSha256 is the hash of the file's text, casesSha256 of the JSON of its list of cases as the files here hold it.",
    sources,
    dev: {
      reconciliation: {
        planCount: 185,
        total: dev.length,
        fromFile,
        notInPlanIds,
        note: "The plan's 185 is 40 + 40 + 48 + 48 + 9 follow-ups. The follow-ups file holds 11 records: the 9 follow-ups and 2 probe controls (tagged study-control). All 187 are kept, so nothing of the studies is lost; 187 - 2 = 185.",
      },
      doNotTouchClasses: DO_NOT_TOUCH_CLASSES,
      doNotTouchNote: DO_NOT_TOUCH_NOTE,
      intendedDuplicates: INTENDED_DUPLICATES,
      contestedLabels: CONTESTED_LABELS,
    },
    controls: {
      floor: 300,
      frameExceptions: FRAME_EXCEPTIONS,
      intendedOverlaps: INTENDED_OVERLAPS,
      composition: {
        router: routerComposition(controls),
        g5: { taken: controls.filter((c) => c.class === "g5_title").length, of: G5_FILE_LENGTH },
        g6: { taken: controls.filter((c) => c.class === "g6_query").length, of: G6_FILE_LENGTH },
      },
    },
  };
}

/* ---------------------------------------------------------------- main */

function main() {
  const at = process.argv.indexOf("--src");
  const src = at > 0 ? process.argv[at + 1] : undefined;
  const out = DATA;
  let dev;
  let sources;

  if (src) {
    sources = {};
    const records = {};
    for (const { key, file } of DEV_FILES) {
      const raw = readFileSync(`${src}/${file}`, "utf8");
      const { cases, ...meta } = JSON.parse(raw);
      records[key] = cases;
      sources[file] = { key, count: cases.length, fileSha256: sha256(raw), casesSha256: sha256(JSON.stringify(cases)), meta };
    }
    // Study b's own list of classes must agree with the letters used here.
    for (const c of sources["r3-cases-b.json"].meta.meta.classes) {
      const [letter, ...name] = c.split(" ");
      if (B_CLASS[letter] !== slug(name.join(" "))) throw new Error(`class ${letter}: the study says ${c}, the table says ${B_CLASS[letter]}`);
    }
    const followUps = Object.fromEntries(records.c2f.map((r) => [r.parent, r]));
    dev = DEV_FILES.flatMap(({ key }) => records[key].map((r, i) => studyCase(key, r, i, followUps)));
    writeFileSync(out + "intent-cases.json", JSON.stringify(dev, null, 1) + "\n");
    console.log(`intent-cases.json: ${dev.length} cases`, Object.fromEntries(DEV_FILES.map(({ file }) => [file, sources[file].count])));
  } else {
    dev = JSON.parse(readFileSync(out + "intent-cases.json", "utf8"));
    sources = JSON.parse(readFileSync(out + "intent-manifest.json", "utf8")).sources;
  }

  const controlsPath = out + "intent-controls.json";
  if (!existsSync(controlsPath)) return console.log("no intent-controls.json yet: the manifest was not written");
  const controls = JSON.parse(readFileSync(controlsPath, "utf8"));
  const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const seen = new Map();
  const duplicates = [];
  for (const c of dev) seen.has(norm(c.text)) ? duplicates.push([seen.get(norm(c.text)), c.id]) : seen.set(norm(c.text), c.id);
  if (JSON.stringify(duplicates) !== JSON.stringify(INTENDED_DUPLICATES)) throw new Error(`texts twice in DEV that are not listed as intended: ${JSON.stringify(duplicates)}`);
  const devByText = new Map(dev.map((c) => [norm(c.text), c.id]));
  const overlaps = controls.filter((c) => devByText.has(norm(c.text))).map((c) => [devByText.get(norm(c.text)), c.id]);
  if (JSON.stringify(overlaps) !== JSON.stringify(INTENDED_OVERLAPS)) throw new Error(`texts in both DEV and CONTROLS that are not listed as intended: ${JSON.stringify(overlaps)}`);
  writeFileSync(out + "intent-manifest.json", JSON.stringify(buildManifest({ dev, controls, sources }), null, 1) + "\n");
  console.log(`intent-manifest.json: dev ${dev.length}, controls ${controls.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
