/**
 * The pure half of the Trending feed, server side (docs/design/chatview-and-trending.md, T3 to T8, T10). No network, no clock, no storage: the job in apps/api feeds it what OpenAlex,
 * arXiv and the product's own search answered, and it says what is a trend, what may be shown, and what the file for the page holds. Not imported by the page (the page has
 * `trending-client.ts`) and not exported from `index.ts`: import it as `@scholar/shared/src/trending`.
 *
 * The flow, each step a function here:
 *   1. `scoreSubfields`: for each subfield, the keywords of window A against window B (journal articles with abstracts, fewer than 60 authors, not retracted, not paratext: the job's query),
 *      floors, the Wilson score against the subfield's own growth, the text rules of a chip, the deny list, the top-10-in-two-subfields rule, the policy table. -> candidates, and held ones.
 *   2. for the best candidates the job asks OpenAlex for the journals (`journalProblem`) and arXiv for computing, mathematics and physics (`confirmation`): `evaluate`.
 *   3. `selectShown`: the shown list: at most 1 phrase per field and 2 per domain, only what the verifier accepts (`summarizeSearch`, `verifySummary`), with hysteresis.
 *   4. `buildPayload`: the file the page reads. It refuses to publish fewer than 8 phrases, and anything the page's own reader would refuse.
 *
 * A chip is a search phrase taken from open data: the exact display name of an OpenAlex keyword. Nothing here asks a model to write, translate or reword one, and we take nothing from a
 * title or an abstract ourselves. What is upstream is not ours to say away: OpenAlex's own indexing assigns its keywords to papers with a model that reads their titles and abstracts
 * (https://help.openalex.org/data/keywords/, read 4 Nov 2026), so the words are model-assigned before they reach us and are unchanged here. The privacy page and the Why panel say so.
 */
import { cleanChatMessage } from "./chat";
import { isSmallTalk, offlineRoute } from "./route";
import { subfieldInfo, type SubfieldInfo } from "./subfield-policy";
import { TRENDING_CHIP_MAX, TRENDING_CHIP_MIN, TRENDING_MAX_CHIPS, parseTrending, type TrendingChip, type TrendingPayload } from "./trending-client";

/**
 * Every number the plan names, in one place. Some are proposals from three subfields and are to be calibrated on the first human read of a list (the plan's "Human" test): `minScore`
 * and the floors in particular.
 */
export const TREND = {
  /** Window A: this many days, ending `endsDaysAgo` days before the day (the newest month is under-indexed by about 20%). Window B: the same dates `baselineShiftDays` earlier (same weekdays). */
  windowDays: 91,
  endsDaysAgo: 45,
  baselineShiftDays: 364,
  /** The confidence of the Wilson bound: 1.96 is 97.5% one-sided. */
  z: 1.96,
  /** A keyword must beat its subfield's own growth by this much, with that confidence, to be a candidate at all. */
  minScore: 1.2,
  /**
   * Papers in window A. `subfield`: in the subfield where the keyword is found. `total`: for the keyword in all the subfields looked at together (so 116 papers in Endocrinology, as the
   * live probe found for tirzepatide, is not enough for the global list). India has smaller numbers and a lower floor.
   */
  floors: { global: { subfield: 40, total: 150 }, in: { subfield: 30, total: 30 } },
  /** A keyword in the top `topForGeneric` of two or more subfields is a generic one ("risk stratification"). */
  topForGeneric: 10,
  journals: { min: 8, maxShare: 0.25 },
  /**
   * Not in the plan's T5 but in the research it rests on (r2-trend-method, 5.3), and needed: on the live data of 3 Nov 2026 the journal check passed every Indonesian regional batch
   * (IndoBERT: 141 journals, none over 3%; "habituation": 200, top 11%), and the best of them scored first. At least `min` countries with an author, and the top country on at most
   * `maxShare` of the keyword's papers. For the global group only: for the India list one country is the point.
   */
  countries: { min: 5, maxShare: 0.6 },
  /** At most this many shown phrases in one OpenAlex field, and in one domain. With Health held, 2 per domain is 6 phrases in all: see `selectShown`. */
  diversity: { perField: 1, perDomain: 2 },
  /** A second source confirms with at least `minGrowth` times last year's volume and at least `minRecent` submissions in the last 30 days; with none, a score of `minScoreAlone`. */
  confirm: { minGrowth: 1.3, minRecent: 40, minScoreAlone: 1.5 },
  /** A shown phrase is kept unless a candidate scores `factor` times higher, or it falls out of the top `keepTop`. */
  hysteresis: { factor: 1.25, keepTop: 30 },
  size: TRENDING_MAX_CHIPS,
  /** The job publishes nothing (and leaves the last good file) when fewer phrases than this can be shown. */
  minPublish: 8,
  validHours: 48,
  chipMin: TRENDING_CHIP_MIN,
  chipMax: TRENDING_CHIP_MAX,
} as const;

export type TrendGroup = "global" | "in";
const DAY = 864e5;

/* ---------------------------------------------------------------- windows and the score */

const DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const dayMs = (s: unknown): number => {
  if (typeof s !== "string" || !DAY_SHAPE.test(s)) return NaN;
  const t = Date.parse(s);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s ? t : NaN;
};
const isoDay = (t: number): string => new Date(t).toISOString().slice(0, 10);

/** The two windows of dates (inclusive, as OpenAlex's from_publication_date and to_publication_date read them) for a day "YYYY-MM-DD". Throws on a day that is not a day. */
export function trendWindows(asOf: string): { a: { from: string; to: string }; b: { from: string; to: string } } {
  const day = dayMs(asOf);
  if (!Number.isFinite(day)) throw new RangeError(`not a day: ${String(asOf)}`);
  const to = day - TREND.endsDaysAgo * DAY;
  const from = to - (TREND.windowDays - 1) * DAY;
  const shift = TREND.baselineShiftDays * DAY;
  return { a: { from: isoDay(from), to: isoDay(to) }, b: { from: isoDay(from - shift), to: isoDay(to - shift) } };
}

/**
 * The lower end of the confidence interval of a share: of `n` papers, `k` are in the newer window. The share of a small sample can be far off, so a small rise is trusted less than a
 * large one. Evan Miller's formula. 0 for anything that is not a count.
 */
export function wilsonLower(k: number, n: number, z: number = TREND.z): number {
  if (!Number.isFinite(k) || !Number.isFinite(n) || n <= 0 || k <= 0) return 0;
  const p = Math.min(k, n) / n;
  const z2 = z * z;
  const lower = (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n);
  return Math.min(1, Math.max(0, lower));
}

/**
 * How much faster a keyword grows than its subfield: the Wilson lower bound of a/(a+b) as odds, divided by the subfield's own total A/B (`ratio`). 1 is "as fast as the subfield".
 * Null when there is nothing to compare: a count that is not a count, no papers, or a subfield ratio that is not a positive number.
 */
export function trendScore(a: number, b: number, ratio: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0 || a + b <= 0) return null;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  const lower = wilsonLower(a, a + b);
  return lower >= 1 ? null : lower / (1 - lower) / ratio;
}

/* ---------------------------------------------------------------- the text of a chip */

/** A phrase as a key: lower case, hyphens and slashes as spaces, no punctuation (except the + and # of "C++" and "C#"), one space. The same phrase written two ways is one phrase. */
export function phraseKey(text: unknown): string {
  if (typeof text !== "string") return "";
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[-_/]+/g, " ")
    .replace(/[^\p{L}\p{M}\p{N}+# ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words that are no topic: how a study was done, what kind of text it is, very broad fields, who was studied, and where. Keys as `phraseKey` writes them. */
const GENERIC = new Set(
  [
    // how it was done, what kind of text
    "research, study, studies, analysis, analyses, review, reviews, systematic review, literature review, meta analysis, case study, case report, survey, surveys, questionnaire, interview, interviews",
    "qualitative research, quantitative research, mixed methods, model, models, modeling, modelling, simulation, method, methods, methodology, approach, framework, design, development, implementation",
    "application, applications, performance, evaluation, assessment, efficiency, effectiveness, impact, effect, effects, role, factors, risk factors",
    // very broad
    "technology, technologies, innovation, management, education, health, data, information, system, systems, algorithm, algorithms, optimization, prediction, classification, detection",
    "ai, ml, artificial intelligence, machine learning, deep learning, neural network, neural networks, big data, data mining",
    // who was studied
    "women, men, children, adolescents, adults, elderly, older adults, students, patients, population, gender, age",
    // where
    "india, china, usa, united states, united kingdom, uk, europe, asia, africa, latin america, indonesia, indonesian, brazil, nigeria, pakistan, bangladesh, iran, turkey, malaysia, vietnam, thailand",
    "saudi arabia, egypt, kenya, ethiopia, ghana, south africa, mexico, russia, japan, korea, south korea, germany, france, italy, spain, canada, australia, global, world, worldwide, indian, chinese",
  ]
    .join(", ")
    .split(", "),
);
/** Whether a phrase is one of the generic words, however it is written. */
export const isGenericPhrase = (text: unknown): boolean => GENERIC.has(phraseKey(text));

const URL_LIKE = /(?:https?:|ftp:|\/\/|www\.|@)|\b[a-z0-9-]+\.(?:com|org|net|edu|gov|io|ai|in|ac|co|uk|de|fr|cn|ru|info|me|app|dev|xyz)\b|\b10\.\d{4,}\//i;

export type TextProblem = "type" | "length" | "invisible" | "no_letters" | "not_clean" | "url" | "small_talk" | "generic" | "not_search";

/**
 * Why a keyword's display name may not be a chip, or null when it may (T7). 3 to 36 characters (as the page counts them); no control, invisible or direction character; at least one letter
 * (so not digits only); what the chat box would send unchanged (`cleanChatMessage` leaves it as it is); no URL, address or DOI; not small talk (the page would answer it with a greeting);
 * not a generic word (T5); and a search as Auto settles it for a visitor who is not signed in (`offlineRoute`, which has no model to ask: "novelty detection" is a real keyword and an Idea Check offer
 * there, a "reference list" phrase a Check references one). A topic that only contains a word of another tool ("citation analysis") is a search there and passes; for a signed-in person the router
 * reads a topic as a search. The text is never changed to make it pass: it passes as it is, or it is not a chip.
 */
export function chipTextProblem(text: unknown): TextProblem | null {
  if (typeof text !== "string") return "type";
  if (text.length < TREND.chipMin || text.length > TREND.chipMax) return "length";
  if (/[\p{Cc}\p{Cf}\p{Cs}]/u.test(text)) return "invisible";
  if (!/\p{L}/u.test(text)) return "no_letters";
  if (cleanChatMessage(text) !== text) return "not_clean";
  if (URL_LIKE.test(text)) return "url";
  if (isSmallTalk(text)) return "small_talk";
  if (isGenericPhrase(text)) return "generic";
  if (offlineRoute(text).mode !== "search") return "not_search";
  return null;
}

/* ---------------------------------------------------------------- candidates */

/** One row of a group_by on keywords.id: the keyword's id, its exact display name, and how many works in the window have it. */
export type KeywordRow = { id: string; name: string; count: number };
/** Everything the job fetched for one subfield: its total papers in A and in B over the same filters (their ratio is the subfield's own growth) and the two keyword lists (at most 200 each). */
export type SubfieldInput = { subfield: number; totalA: number; totalB: number; rowsA: readonly KeywordRow[]; rowsB: readonly KeywordRow[] };

export type Candidate = {
  /** The OpenAlex keyword id, for the job's follow-up questions (journals). Not stored in the file: keywords were renumbered once already. */
  id: string;
  /** The keyword's display name, exactly: this is the chip. */
  text: string;
  phrase: string;
  subfield: number;
  subfieldName: string;
  field: string;
  fieldId: number;
  domain: string;
  domainId: number;
  policy: "allow" | "hold";
  a: number;
  b: number;
  /** True when the keyword was not in last year's top 200 and `b` is the smallest count that list has (an upper bound of the truth). Not shown until `withExactBaseline` gives the real count. */
  bEstimated: boolean;
  /** The subfield's own growth, total A over total B. */
  ratio: number;
  score: number;
  /** The keyword's papers in A in all the subfields looked at together. */
  total: number;
};

export type ScoreResult = {
  /** Candidates from subfields that are allowed, best first. */
  candidates: Candidate[];
  /** Candidates from held subfields (health, politics, an unknown subfield): logged for the owner, never shown. */
  held: Candidate[];
  /** How many rows each rule took out, by rule name ("floor", "score", "multi_subfield", "denied", "text:generic", ...). */
  stats: Record<string, number>;
};

const isRow = (r: unknown): r is KeywordRow => {
  try {
    const o = r as KeywordRow | null;
    return !!o && typeof o === "object" && typeof o.id === "string" && o.id !== "" && typeof o.name === "string" && Number.isInteger(o.count) && o.count >= 0;
  } catch {
    return false; // an object that throws when read is not a row
  }
};
const rowsOf = (rows: unknown): KeywordRow[] => (Array.isArray(rows) ? rows.filter(isRow) : []);
const cmp = (p: string, q: string): number => (p < q ? -1 : p > q ? 1 : 0);
const bestFirst = (x: Candidate, y: Candidate): number => y.score - x.score || y.a - x.a || cmp(x.phrase, y.phrase) || x.subfield - y.subfield;

/**
 * The candidates of a group ("global", or "in" for papers with an author at an Indian institution; the job sends India's own counts and totals). Per subfield: the policy table (never: not looked
 * at; hold or unknown: the candidates are `held`); the floors; the text rules; the deny list; a keyword missing from last year's list takes the smallest count that list has (and is
 * flagged); the score has to be at least `TREND.minScore`. Then across subfields: a keyword in the top 10 of two or more subfields is generic and goes, and a phrase found in several
 * subfields is kept once, where it scores best. Throws only for a group that is not "global" or "in"; an input or a row that is not one (or throws when read) is skipped, and so is a
 * subfield with no totals or no last-year list.
 */
export function scoreSubfields(inputs: readonly SubfieldInput[], group: TrendGroup, opts: { deny?: Iterable<unknown> } = {}): ScoreResult {
  const stats: Record<string, number> = {};
  const bump = (key: string, n = 1): void => void (stats[key] = (stats[key] ?? 0) + n);
  const floor = TREND.floors[group];
  if (!floor) throw new RangeError(`unknown group: ${String(group)}`);
  const deny = new Set<string>();
  try {
    for (const d of opts.deny ?? []) {
      const k = phraseKey(d);
      if (k) deny.add(k);
    }
  } catch {
    /* a deny list that cannot be read adds nothing */
  }

  type Work = { info: SubfieldInfo | undefined; policy: "allow" | "hold"; ratio: number; rowsA: KeywordRow[]; baseline: Map<string, number>; baselineMin: number };
  const works: Work[] = [];
  const totals = new Map<string, number>();
  for (const input of Array.isArray(inputs) ? inputs : []) {
    try {
      if (!input || typeof input !== "object") {
        bump("bad_subfield");
        continue;
      }
      const info = subfieldInfo(input.subfield);
      const policy = info?.policy ?? "hold";
      if (policy === "never") {
        bump("never_subfield");
        continue;
      }
      const rowsA = rowsOf(input.rowsA);
      const rowsB = rowsOf(input.rowsB);
      const ratio = input.totalA / input.totalB;
      if (!(input.totalA > 0) || !(input.totalB > 0) || !Number.isFinite(ratio) || rowsB.length === 0) {
        bump("skipped_subfield");
        continue;
      }
      const baseline = new Map<string, number>();
      for (const r of rowsB) baseline.set(r.id, Math.max(baseline.get(r.id) ?? 0, r.count));
      works.push({ info, policy, ratio, rowsA, baseline, baselineMin: Math.min(...rowsB.map((r) => r.count)) });
      for (const r of rowsA) {
        const phrase = phraseKey(r.name);
        totals.set(phrase, (totals.get(phrase) ?? 0) + r.count);
      }
    } catch {
      bump("bad_subfield"); // an input that throws when read is skipped, like one that is not an input
    }
  }

  const bySubfield: Candidate[][] = [];
  for (const w of works) {
    const kept: Candidate[] = [];
    for (const r of w.rowsA) {
      bump("rows");
      const phrase = phraseKey(r.name);
      const total = totals.get(phrase) ?? r.count;
      if (r.count < floor.subfield || total < floor.total) {
        bump("floor");
        continue;
      }
      const problem = chipTextProblem(r.name);
      if (problem) {
        bump(`text:${problem}`);
        continue;
      }
      if (deny.has(phrase)) {
        bump("denied");
        continue;
      }
      const known = w.baseline.get(r.id);
      const b = known ?? w.baselineMin;
      const score = trendScore(r.count, b, w.ratio);
      if (score === null || score < TREND.minScore) {
        bump("score");
        continue;
      }
      const i = w.info;
      kept.push({
        id: r.id, text: r.name, phrase, subfield: i?.id ?? 0, subfieldName: i?.name ?? "", field: i?.field ?? "", fieldId: i?.fieldId ?? 0, domain: i?.domain ?? "", domainId: i?.domainId ?? 0,
        policy: w.policy, a: r.count, b, bEstimated: known === undefined, ratio: w.ratio, score, total,
      });
    }
    bySubfield.push(kept);
  }

  // a keyword in the top 10 of two or more subfields is generic (probe: "risk stratification" in Endocrinology and Oncology)
  const inTop = new Map<string, number>();
  for (const kept of bySubfield) for (const phrase of new Set([...kept].sort(bestFirst).slice(0, TREND.topForGeneric).map((c) => c.phrase))) inTop.set(phrase, (inTop.get(phrase) ?? 0) + 1);
  const generic = new Set([...inTop].filter(([, n]) => n >= 2).map(([phrase]) => phrase));

  const best = new Map<string, Candidate>();
  for (const c of bySubfield.flat()) {
    if (generic.has(c.phrase)) {
      bump("multi_subfield");
      continue;
    }
    const other = best.get(c.phrase);
    if (!other) best.set(c.phrase, c);
    else {
      bump("duplicate");
      if (bestFirst(c, other) < 0) best.set(c.phrase, c);
    }
  }
  const all = [...best.values()].sort(bestFirst);
  return { candidates: all.filter((c) => c.policy === "allow"), held: all.filter((c) => c.policy === "hold"), stats };
}

/**
 * The candidate with last year's real count instead of the estimate (the job asks OpenAlex for exactly that count, for the few candidates that were missing from the top 200). The score is worked
 * out again; the estimate was the cautious one, so it can only go up. Throws if `b` is not a count.
 */
export function withExactBaseline(c: Candidate, b: number): Candidate {
  const score = trendScore(c.a, b, c.ratio);
  if (score === null) throw new RangeError(`not a count: ${String(b)}`);
  return { ...c, b, bEstimated: false, score };
}

/* ---------------------------------------------------------------- the journals, and a second source */

/** Papers of the keyword in one journal (group_by primary_location.source.id, window A, the same filters as the count `a`). */
export type Venue = { id: string; count: number };
export type JournalProblem = "few_journals" | "concentrated" | "no_count";

/**
 * A keyword that a few journals, or one journal, made (a regional batch, a special issue): fewer than 8 journals, or the top journal with more than 25% of the keyword's papers.
 * The share is of `a`, or of the listed journals' papers if they add up to more. Rows that are not journals with papers are ignored.
 */
export function journalProblem(venues: readonly Venue[], a: number): JournalProblem | null {
  if (!Number.isFinite(a) || a <= 0) return "no_count";
  const perJournal = new Map<string, number>();
  for (const v of Array.isArray(venues) ? venues : []) {
    try {
      if (v && typeof v.id === "string" && v.id !== "" && Number.isFinite(v.count) && v.count > 0) perJournal.set(v.id, (perJournal.get(v.id) ?? 0) + v.count);
    } catch {
      /* a row that throws when read is not a journal */
    }
  }
  if (perJournal.size < TREND.journals.min) return "few_journals";
  const counts = [...perJournal.values()];
  const whole = Math.max(a, counts.reduce((s, n) => s + n, 0));
  return Math.max(...counts) / whole > TREND.journals.maxShare ? "concentrated" : null;
}

/** arXiv submissions with the phrase: in the last 30 days, and in the same 30 days a year earlier. */
export type SecondSource = { recent: number; yearAgo: number };
/** The OpenAlex fields that arXiv covers: Computer Science (17), Mathematics (26), Physics and Astronomy (31). */
const SECOND_SOURCE_FIELDS: ReadonlySet<number> = new Set([17, 26, 31]);
export const usesSecondSource = (fieldId: unknown): boolean => typeof fieldId === "number" && SECOND_SOURCE_FIELDS.has(fieldId);

export type Confirmation =
  | { ok: true; by: "arxiv"; growth: number }
  | { ok: true; by: "score" }
  | { ok: false; reason: "no_second_source_data" | "second_source_weak" | "score_too_low" };

const readable = (s: unknown): s is SecondSource => {
  const o = s as SecondSource | null;
  return !!o && typeof o === "object" && Number.isFinite(o.recent) && o.recent >= 0 && Number.isFinite(o.yearAgo) && o.yearAgo >= 0;
};

/**
 * Whether something besides OpenAlex's own count agrees (T5). For a phrase from computing, mathematics or physics: arXiv volume at least 1.3 times the same 30 days a year ago, and at least
 * 40 submissions; with no arXiv numbers it is not confirmed, and a high OpenAlex score does not stand in for arXiv when arXiv says the phrase is not rising. For any other field there is no
 * second source, and the phrase needs a score of 1.5. Never throws.
 */
export function confirmation(c: Pick<Candidate, "score" | "fieldId">, second?: SecondSource | null): Confirmation {
  try {
    if (usesSecondSource(c?.fieldId)) {
      if (!readable(second)) return { ok: false, reason: "no_second_source_data" };
      const growth = second.recent / Math.max(second.yearAgo, 1);
      return second.recent >= TREND.confirm.minRecent && growth >= TREND.confirm.minGrowth ? { ok: true, by: "arxiv", growth } : { ok: false, reason: "second_source_weak" };
    }
    return Number(c?.score) >= TREND.confirm.minScoreAlone ? { ok: true, by: "score" } : { ok: false, reason: "score_too_low" };
  } catch {
    return { ok: false, reason: "score_too_low" };
  }
}

/** Papers of the keyword with an author at an institution in one country (group_by authorships.institutions.country_code, window A, the same filters as `a`). */
export type Country = { id: string; count: number };
export type CountryProblem = "few_countries" | "one_country" | "no_count" | "no_country_data";

/**
 * A keyword that one country made: fewer than 5 countries, or the top country on more than 60% of the keyword's papers. The share is of `a` alone: a paper with authors in two countries is
 * in both rows, so the rows can add up to more than `a`. Without any country numbers (`undefined`, not a list) the answer is "no_country_data": nothing is guessed. Rows that are not
 * countries with papers are ignored.
 */
export function countryProblem(countries: readonly Country[] | undefined, a: number): CountryProblem | null {
  if (!Array.isArray(countries)) return "no_country_data";
  if (!Number.isFinite(a) || a <= 0) return "no_count";
  const perCountry = new Map<string, number>();
  for (const k of countries) {
    try {
      if (k && typeof k.id === "string" && k.id !== "" && Number.isFinite(k.count) && k.count > 0) perCountry.set(k.id, (perCountry.get(k.id) ?? 0) + k.count);
    } catch {
      /* a row that throws when read is not a country */
    }
  }
  if (perCountry.size < TREND.countries.min) return "few_countries";
  return Math.max(...perCountry.values()) / a > TREND.countries.maxShare ? "one_country" : null;
}

/**
 * The checks on what the job asked for, in order: the journals, the countries (for the global group, which is the default: `group: "in"` skips them), then the confirmation. Whether a
 * candidate may go on to the verifier.
 */
export function evaluate(
  c: Candidate,
  evidence: { venues: readonly Venue[]; countries?: readonly Country[]; second?: SecondSource | null; group?: TrendGroup },
): Confirmation | { ok: false; reason: JournalProblem | CountryProblem } {
  const journals = journalProblem(evidence?.venues, c?.a);
  if (journals) return { ok: false, reason: journals };
  if (evidence?.group !== "in") {
    const countries = countryProblem(evidence?.countries, c?.a);
    if (countries) return { ok: false, reason: countries };
  }
  return confirmation(c, evidence?.second);
}

/* ---------------------------------------------------------------- the shown list */

export type Rankable = Pick<Candidate, "phrase" | "score" | "fieldId" | "domainId" | "bEstimated">;

/**
 * The shown list. Candidates in any order; `previous` is what was shown last time (the chips' text); `accept` is the verifier (T8), asked in order only about a phrase that the caps allow and
 * only until the list is full, so each answer is one search; a verifier that throws says no. At most `perField` phrases per OpenAlex field and `perDomain` per domain (the plan's 1 and 2: with
 * Health held that is at most 6 phrases, three domains times two, so a list of 12 needs `perDomain` 4), each phrase once, none whose last-year count is only an estimate.
 *
 * Hysteresis: a phrase shown last time that is still in the top 30 competes with its score times 1.25, so it leaves only for a candidate that scores 1.25 times higher (exactly 1.25 times is
 * higher); one that has fallen out of the top 30 competes as it is. Phrases that are not candidates any more are simply gone. The score of what comes back is the real score.
 */
export function selectShown<C extends Rankable>(
  ranked: readonly C[],
  opts: { size?: number; perField?: number; perDomain?: number; previous?: readonly unknown[]; accept?: (c: C) => boolean } = {},
): C[] {
  const size = opts.size ?? TREND.size;
  const perField = opts.perField ?? TREND.diversity.perField;
  const perDomain = opts.perDomain ?? TREND.diversity.perDomain;
  if (!(size > 0)) return [];
  const valid = (Array.isArray(ranked) ? ranked : []).filter((c) => {
    try {
      return !!c && typeof c === "object" && typeof c.phrase === "string" && Number.isFinite(c.score) && Number.isFinite(c.fieldId) && Number.isFinite(c.domainId);
    } catch {
      return false;
    }
  });
  const order = (x: C, y: C): number => y.score - x.score || cmp(x.phrase, y.phrase) || x.fieldId - y.fieldId;
  const sorted = [...valid].sort(order);

  const rank = new Map<string, number>();
  for (const c of sorted) if (!rank.has(c.phrase)) rank.set(c.phrase, rank.size);
  const kept = new Set<string>();
  try {
    for (const p of opts.previous ?? []) {
      const key = phraseKey(p);
      if (key && (rank.get(key) ?? Infinity) < TREND.hysteresis.keepTop) kept.add(key);
    }
  } catch {
    /* a previous list that cannot be read keeps nothing */
  }
  const weight = (c: C): number => c.score * (kept.has(c.phrase) ? TREND.hysteresis.factor : 1);
  const competing = [...sorted].sort((x, y) => weight(y) - weight(x) || order(x, y));

  const out: C[] = [];
  const seen = new Set<string>();
  const inField = new Map<number, number>();
  const inDomain = new Map<number, number>();
  for (const c of competing) {
    if (out.length >= size) break;
    if (c.bEstimated || seen.has(c.phrase)) continue;
    if ((inField.get(c.fieldId) ?? 0) >= perField || (inDomain.get(c.domainId) ?? 0) >= perDomain) continue;
    if (opts.accept) {
      let yes = false;
      try {
        yes = opts.accept(c) === true;
      } catch {
        yes = false;
      }
      if (!yes) continue;
    }
    out.push(c);
    seen.add(c.phrase);
    inField.set(c.fieldId, (inField.get(c.fieldId) ?? 0) + 1);
    inDomain.set(c.domainId, (inDomain.get(c.domainId) ?? 0) + 1);
  }
  return out;
}

/* ---------------------------------------------------------------- the verifier (T8) */

/** The thresholds the product's own search has to meet for a phrase (all providers, the same merge, from the search year on, the Indian scope for the India list). */
export const VERIFY = { minResults: 20, minAbstracts: 10, minRecent: 5, window: 20, maxRetracted: 0, maxVenueShare: 0.5, /** as the answer needs one: apps/api/src/chat/answer.ts MIN_ABSTRACT_CHARS */ minAbstractChars: 80 } as const;

/** What the verifier reads of a result: the fields of a `Paper`. */
export type VerifyPaper = { abstract?: string | null; year?: number | null; retracted?: boolean | null; venue?: string | null };
export type SearchSummary = { total: number; withAbstract: number; recent: number; retracted: number; topVenueShare: number };

const venueKey = (v: unknown): string => (typeof v === "string" ? v.toLowerCase().replace(/\s+/g, " ").trim() : "");

/**
 * The numbers the thresholds are about, from a search's results (in rank order). Abstracts, recent papers and retracted ones are counted among the first 20 (the answer is written from those);
 * `sinceYear` is the search's own start year (a paper is recent from that year on); the biggest venue is a share of all the results. Skips what is not a paper.
 */
export function summarizeSearch(results: readonly VerifyPaper[], sinceYear: number): SearchSummary {
  try {
    const papers = (Array.isArray(results) ? results : []).filter((p) => !!p && typeof p === "object");
    const top = papers.slice(0, VERIFY.window);
    const venues = new Map<string, number>();
    for (const p of papers) {
      const key = venueKey(p.venue);
      if (key) venues.set(key, (venues.get(key) ?? 0) + 1);
    }
    return {
      total: papers.length,
      withAbstract: top.filter((p) => typeof p.abstract === "string" && p.abstract.trim().length >= VERIFY.minAbstractChars).length,
      recent: top.filter((p) => typeof p.year === "number" && p.year >= sinceYear).length,
      retracted: top.filter((p) => p.retracted === true).length,
      topVenueShare: papers.length ? Math.max(0, ...venues.values()) / papers.length : 0,
    };
  } catch {
    return { total: 0, withAbstract: 0, recent: 0, retracted: 0, topVenueShare: 0 }; // results that cannot be read verify as nothing found
  }
}

/**
 * Whether the search's own check for retracted papers (Crossref and Retraction Watch, `retractionCheck` of the search answer) ANSWERED. When it did not (Crossref said 429 or 5xx, or its shared
 * lane was busy) nothing was flagged by it, and "none retracted in the top 20" rests only on OpenAlex's own flag, which is nearly blind for fresh papers (11 of 558,759 articles of Oct 2026): the
 * count of retracted papers is then not a finding. Anything that is not a check that says `ok: true` is "did not answer". Never throws.
 */
export function retractionChecked(found: unknown): boolean {
  try {
    return (found as { retractionCheck?: { ok?: unknown } | null } | null | undefined)?.retractionCheck?.ok === true;
  } catch {
    return false;
  }
}

export type VerifyFailure = "too_few_results" | "too_few_abstracts" | "too_few_recent" | "retracted" | "one_venue";

/** Whether a search meets every threshold, and every one it fails. A number that is missing or not a number fails its rule: nothing unreadable is a pass. */
export function verifySummary(s: SearchSummary): { ok: boolean; failures: VerifyFailure[] } {
  const num = (key: keyof SearchSummary): number => {
    try {
      const v = (s as Partial<Record<keyof SearchSummary, unknown>> | null)?.[key];
      return typeof v === "number" ? v : NaN;
    } catch {
      return NaN;
    }
  };
  const failures: VerifyFailure[] = [];
  if (!(num("total") >= VERIFY.minResults)) failures.push("too_few_results");
  if (!(num("withAbstract") >= VERIFY.minAbstracts)) failures.push("too_few_abstracts");
  if (!(num("recent") >= VERIFY.minRecent)) failures.push("too_few_recent");
  const retracted = num("retracted");
  if (!(retracted >= 0 && retracted <= VERIFY.maxRetracted)) failures.push("retracted");
  const share = num("topVenueShare");
  if (!(share >= 0 && share <= VERIFY.maxVenueShare)) failures.push("one_venue");
  return { ok: failures.length === 0, failures };
}

/* ---------------------------------------------------------------- the file */

const tidyField = (f: unknown): f is string => typeof f === "string" && f.length >= 1 && f.length <= 60 && !/[\p{Cc}\p{Cf}]/u.test(f);
const count = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 1e9;

/**
 * A candidate as the page shows it: the keyword's own text, the year its search starts from (the year before the day's: "From 2025 on"), and the two counts. Null when it cannot be shown: a
 * count that was only estimated, text that fails the chip rules, a count or field that is not valid, or a day that is not a day. The last check on the text is here, so no path to the
 * file skips it.
 */
export function toChip(c: Candidate, asOf: string): TrendingChip | null {
  try {
    if (!c || c.bEstimated || !Number.isFinite(dayMs(asOf)) || chipTextProblem(c.text) || !tidyField(c.field) || !count(c.a) || !count(c.b)) return null;
    return { text: c.text, sinceYear: Number(asOf.slice(0, 4)) - 1, a: c.a, b: c.b, field: c.field };
  } catch {
    return null;
  }
}

function chipsOf(list: readonly Candidate[] | undefined, asOf: string): TrendingChip[] {
  const out: TrendingChip[] = [];
  const seen = new Set<string>();
  for (const c of Array.isArray(list) ? list : []) {
    const chip = toChip(c, asOf);
    if (!chip || seen.has(phraseKey(chip.text))) continue;
    seen.add(phraseKey(chip.text));
    out.push(chip);
    if (out.length === TREND.size) break;
  }
  return out;
}

const stamp = (now: Date): number => {
  const t = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isFinite(t)) throw new RangeError("not a time");
  return t;
};

/**
 * The file the page reads, from the shown lists (what `selectShown` chose). Valid for 48 hours. It throws, and the job leaves the last good file in place, when fewer than 8 phrases can be
 * shown in the global group (the India group may be short or empty), when `poolAsOf` is not a day, or when the page's own reader would refuse what was built.
 */
export function buildPayload(input: { now: Date; poolAsOf: string; global: readonly Candidate[]; india?: readonly Candidate[] }): TrendingPayload {
  const t = stamp(input.now);
  const generatedAt = new Date(t).toISOString();
  const asOf = generatedAt.slice(0, 10);
  if (!Number.isFinite(dayMs(input.poolAsOf))) throw new RangeError(`not a day: ${String(input.poolAsOf)}`);
  const global = chipsOf(input.global, asOf);
  if (global.length < TREND.minPublish) throw new Error(`only ${global.length} phrases can be shown; at least ${TREND.minPublish} are needed`);
  const built = {
    version: 1,
    asOf,
    generatedAt,
    validUntil: new Date(t + TREND.validHours * 3_600_000).toISOString(),
    poolAsOf: input.poolAsOf,
    disabled: false,
    groups: { global: { chips: global }, in: { chips: chipsOf(input.india, asOf) } },
  };
  const checked = parseTrending(built);
  if (!checked) throw new Error("the page would not accept this file");
  return checked;
}

/**
 * What the server answers when it has no list (nothing in the store yet) or is switched off: a file the page accepts, with no chips, that has already expired, so that no page can call it
 * trending.
 */
export function emptyPayload(now: Date, disabled = false): TrendingPayload {
  const generatedAt = new Date(stamp(now)).toISOString();
  const asOf = generatedAt.slice(0, 10);
  return { version: 1, asOf, generatedAt, validUntil: generatedAt, poolAsOf: asOf, disabled, groups: { global: { chips: [] }, in: { chips: [] } } };
}
