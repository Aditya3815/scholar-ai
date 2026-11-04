import { subjectWords, type SafetyNoticeKind } from "@scholar/shared";
import type { FlagPosition } from "./flags";
import {
  ABSTRACT_WORDS, APPEAL, CHEST_FEEL, CHEST_PLACE, CONDITION, CONDITION_LEAD, CONDITIONAL_WORDS, CRISIS, CRISIS_NOT_IF_FOLLOWED_BY, DECISION_FRAME, DECISION_NOT_IF_FOLLOWED_BY, FEELING, FEELING_SELF, GENDER_PAIR_WORDS, HEALTH, HELP, HELP_FILLER, INTENSIFIERS, LOOKUP, MEDICINE, MEDICINE_LEAD, NOT_A_RELATION, NOW,
  PERSON_BODY, PERSON_OWN, SELF_ONLY, SPELLINGS, SPREAD, STUDY_WORDS, SYMPTOM, SYMPTOM_ALONE, SYMPTOM_NOW, SYMPTOM_NOW_BODY, type Words,
} from "./lane-words";

/**
 * R4, the safety lane's reading of a message (docs/design/intent-and-state.md, 4.5). `safetyRead(text)` is pure and total, runs on the server only, and answers with names from a closed list and nothing of
 * the message: which tiers fired, and which of them fired because of an unmistakable phrase (`core`). What the page does about it is `planLane` (a function of the position of the flag), and what the page
 * says is lane-text.ts. The tiers, strongest first: CRISIS (self-harm intent or state), URGENT (an emergency of a person, now), HELP (a plain call for help with no topic), DECISION (what the writer should
 * take), CARE (a health or distress story with a research question).
 *
 * How it reads. The WHOLE message, whatever its length (20,000 characters at most, `cleanAutoMessage`): distress is often written long, so no message is skipped for being long. The text is folded (NFKC,
 * lower case, apostrophes and invisible characters out, a nukta out, a stretched letter squeezed, a few spellings of one Hindi word made one) and cut into words once; a sentence's end is a word of its own, so
 * that a phrase cannot run over it. Every run of words that begins a phrase is then looked up in closed sets (a `Map` of phrases, extended one word at a time for as long as the run begins a longer phrase: no regular expression is applied to the message, so nothing can backtrack and the time
 * grows in a straight line with the length). The sets are DATA (lane-words.ts); a hit is a position and a name. The tiers that need more than one phrase (an emergency is a symptom, a person and a "now") look for
 * the hits of the others near it, by a binary search of the hits of that name (the hits come in order), so a message of near-misses costs a few lookups for each word and no more.
 *
 * What it does NOT do, on purpose: the bare word "suicide" or "suicidal" is no trigger and neither is a research frame in front of it; a topic phrase with no person and no "now" ("chest pain management in
 * emergency departments") is not urgent; "I need help finding papers on diabetes" has a subject word and is searched. And what it cannot do: it reads closed lists, so a phrase nobody listed is not read.
 */

export const SAFETY_TIERS = ["crisis", "urgent", "help", "decision", "care"] as const;
export type SafetyTier = (typeof SAFETY_TIERS)[number];

export type SafetyRead = {
  /** Every tier that fired, strongest first. */
  tiers: SafetyTier[];
  /** The tiers that fired because of an unmistakable phrase (each is also in `tiers`): the only ones that act while the flag is `core`. */
  core: SafetyTier[];
  /** The strongest tier, which decides the reply: `tiers[0]`, or null. */
  top: SafetyTier | null;
  /** For the care line only: a health story ("health") or a story of how the writer feels ("distress"). */
  careKind: "health" | "distress" | null;
};

const NOTHING = (): SafetyRead => ({ tiers: [], core: [], top: null, careKind: null });

/* ---------------------------------------------------------------- folding */

/** The words that only say how much (a plain split: they are single words, so they need no fold of their own). */
const INTENSIFIER: ReadonlySet<string> = new Set(INTENSIFIERS);

/** The word of a sentence's end: a phrase never runs over it. */
const END = ".";
const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;
const SPELL: ReadonlyMap<string, string> = new Map(Object.entries(SPELLINGS));
const NEGATED: Readonly<Record<string, string>> = { do: "dont", does: "doesnt", did: "didnt", can: "cant", will: "wont", is: "isnt", are: "arent", was: "wasnt", were: "werent", would: "wouldnt", could: "couldnt", should: "shouldnt", have: "havent", has: "hasnt", had: "hadnt" };

/** A character that is dropped without breaking the word: an apostrophe, a joiner, a bidi or zero-width mark, a soft hyphen, the nukta (one Devanagari letter with and without it is one word). */
function dropped(cp: number): boolean {
  return cp === 0x27 || cp === 0x2019 || cp === 0x2018 || cp === 0x60 || cp === 0xb4 || cp === 0xad || cp === 0x93c || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x2069) || cp === 0xfeff;
}
/** The end of a sentence or of a line: a full stop and its kin, a danda, a line break. (A comma is not.) */
function sentenceEnd(cp: number): boolean {
  return cp === 0x2e || cp === 0x21 || cp === 0x3f || cp === 0x3b || cp === 0x3a || cp === 0x0a || cp === 0x0d || cp === 0x2026 || cp === 0x964 || cp === 0x965 || cp === 0x2028 || cp === 0x2029;
}
const isLetterAz = (cp: number): boolean => cp >= 0x61 && cp <= 0x7a;

/**
 * The message as words: folded, one entry for each word and one (`END`) for the end of a sentence. A word of Latin letters has each run of one letter squeezed to one ("pleaseee" and "please" are "plese",
 * and the lists go through the same fold), then a few spellings made one (`SPELLINGS`). `sentinel`: the stream ends with an end of sentence, so that "i cant go on" at the very end is "i cant go on ." (the
 * phrases are folded without it). Linear in the text, and total.
 */
function fold(text: string, sentinel = true): string[] {
  const out: string[] = [];
  /** A word goes into the list; "not" after "do", "can", "will"... makes it one word ("dont"), so that "I do not want to die" and "I dont want to die" are one; a word that only says how much is left out. */
  const push = (token: string) => {
    if (INTENSIFIER.has(token)) return;
    if (token === "not") {
      const contracted = NEGATED[out[out.length - 1] ?? ""];
      if (contracted !== undefined) {
        out[out.length - 1] = contracted;
        return;
      }
    }
    out.push(token === "cannot" ? "cant" : token);
  };
  let word = "";
  let squeezed = "";
  let latin = true;
  let last = 0;
  const flush = () => {
    if (word === "") return;
    const key = latin ? squeezed : word;
    push(SPELL.get(key) ?? key);
    word = "";
    squeezed = "";
    latin = true;
    last = 0;
  };
  for (const ch of String(text).normalize("NFKC").toLowerCase()) {
    const cp = ch.codePointAt(0)!;
    if (dropped(cp)) continue;
    if (cp < 128 ? isLetterAz(cp) || (cp >= 0x30 && cp <= 0x39) : cp >= 0x900 && cp <= 0x97f && !sentenceEnd(cp) ? true : WORD_CHAR.test(ch)) {
      word += ch;
      if (isLetterAz(cp)) {
        if (cp !== last) squeezed += ch;
      } else latin = false;
      last = cp;
      continue;
    }
    flush();
    if (sentenceEnd(cp) && out.length > 0 && out[out.length - 1] !== END) out.push(END);
  }
  flush();
  if (sentinel && out.length > 0 && out[out.length - 1] !== END) out.push(END);
  return out;
}

/* ---------------------------------------------------------------- the sets, built once */

/** The pairs of words that differ only in the gender of the speaker, folded as the phrases are. */
export const GENDER_PAIRS: readonly (readonly [string, string])[] = GENDER_PAIR_WORDS.map(([a, b]) => [fold(a, false)[0]!, fold(b, false)[0]!] as const);
const TWIN = new Map<string, string>(GENDER_PAIRS.flatMap(([a, b]) => [[a, b], [b, a]] as [string, string][]));

/** A phrase and the phrases that differ from it only in the gender of a verb: every combination of the two forms of the words that have two. */
function withTwins(words: string[]): string[][] {
  let out: string[][] = [[]];
  for (const w of words) {
    const twin = TWIN.get(w);
    out = out.flatMap((p) => (twin === undefined ? [[...p, w]] : [[...p, w], [...p, twin]]));
  }
  return out;
}

type Cat =
  | "crisis" | "crisisStop" | "help" | "symNow" | "symNowBody" | "symAlone" | "sym" | "chestPlace" | "chestFeel" | "spread" | "person" | "personBody" | "now" | "study" | "abstract" | "decisionFrame" | "decisionStop" | "medicine" | "notRelation"
  | "health" | "medicineLead" | "conditionLead" | "condition" | "feeling" | "feelingSelf" | "lookup" | "self" | "appeal" | "conditional";
const CATS: Record<Cat, Words> = {
  crisis: CRISIS,
  crisisStop: { core: [], broad: CRISIS_NOT_IF_FOLLOWED_BY },
  help: HELP,
  symNow: SYMPTOM_NOW,
  symNowBody: { core: [], broad: SYMPTOM_NOW_BODY },
  sym: SYMPTOM,
  symAlone: { core: SYMPTOM_ALONE, broad: [] },
  chestPlace: { core: [], broad: CHEST_PLACE },
  chestFeel: { core: [], broad: CHEST_FEEL },
  spread: { core: [], broad: SPREAD },
  person: { core: [], broad: PERSON_OWN },
  personBody: { core: [], broad: PERSON_BODY },
  now: { core: [], broad: NOW },
  study: { core: [], broad: STUDY_WORDS },
  abstract: { core: [], broad: ABSTRACT_WORDS },
  decisionFrame: DECISION_FRAME,
  decisionStop: { core: [], broad: DECISION_NOT_IF_FOLLOWED_BY },
  medicine: { core: [], broad: MEDICINE },
  notRelation: { core: [], broad: NOT_A_RELATION },
  health: { core: [], broad: HEALTH },
  medicineLead: { core: [], broad: MEDICINE_LEAD },
  conditionLead: { core: [], broad: CONDITION_LEAD },
  condition: { core: [], broad: CONDITION },
  feeling: { core: [], broad: FEELING },
  feelingSelf: { core: [], broad: FEELING_SELF },
  appeal: { core: [], broad: APPEAL },
  conditional: { core: [], broad: CONDITIONAL_WORDS },
  lookup: { core: [], broad: LOOKUP },
  self: { core: [], broad: SELF_ONLY },
};

/** Every phrase of every set, as words, with the twins of gendered verbs added: what the tests read to see that each has its twin. */
export const LANE_PHRASES: Record<Cat, { core: string[][]; broad: string[][] }> = Object.fromEntries(
  (Object.keys(CATS) as Cat[]).map((cat) => {
    const dedupe = (list: string[]) => {
      const seen = new Set<string>();
      return list.flatMap((p) => withTwins(fold(p, false))).filter((p) => p.length > 0 && !seen.has(p.join(" ")) && !!seen.add(p.join(" ")));
    };
    return [cat, { core: dedupe(CATS[cat].core), broad: dedupe(CATS[cat].broad) }];
  }),
) as Record<Cat, { core: string[][]; broad: string[][] }>;

type Entry = { cat: Cat; core: boolean };
const PHRASES = new Map<string, Entry[]>();
/** The first word of every phrase, and every run of words that begins a longer phrase: a scan stops extending a run as soon as it is neither a phrase nor the beginning of one. */
const FIRST = new Set<string>();
const PREFIXES = new Set<string>();
for (const [cat, sets] of Object.entries(LANE_PHRASES) as [Cat, { core: string[][]; broad: string[][] }][]) {
  for (const [core, list] of [[true, sets.core], [false, sets.broad]] as const) {
    for (const p of list) {
      const key = p.join(" ");
      const entries = PHRASES.get(key) ?? [];
      if (!entries.some((e) => e.cat === cat && e.core === core)) entries.push({ cat, core });
      PHRASES.set(key, entries);
      FIRST.add(p[0]!);
      for (let k = 1; k < p.length; k++) PREFIXES.add(p.slice(0, k).join(" "));
    }
  }
}
const toSet = (list: string[]): ReadonlySet<string> => new Set(list.flatMap((p) => fold(p, false)));
const PRONOUNS = toSet(["he", "she", "hes", "shes", "they", "woh", "wo", "vo", "वो", "वह"]);
const FILLER = toSet(HELP_FILLER);
const NOT_RELATION = toSet(NOT_A_RELATION);

/* ---------------------------------------------------------------- reading */

type Hit = { s: number; e: number; core: boolean };
/** How far from a symptom (in words) the person and the "now" may be. */
const NEAR = 20;
/** The study words that take the "now" out of an emergency: how far before it and after it ("I am studying chest pain with arm pain in the emergency department right now"). */
const STUDY_BEFORE = 12;
const STUDY_AFTER = 3;

/** Is there a hit that STARTS in [lo, hi]? The hits are in order of their start, so it is a binary search. */
function startsIn(list: readonly Hit[], lo: number, hi: number): Hit | undefined {
  let a = 0;
  let b = list.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if (list[m]!.s < lo) a = m + 1;
    else b = m;
  }
  const h = list[a];
  return h !== undefined && h.s <= hi ? h : undefined;
}

export function safetyRead(text: string): SafetyRead {
  try {
    if (typeof text !== "string" || text === "") return NOTHING();
    const t = fold(text);
    const n = t.length;
    const hits: Record<Cat, Hit[]> = Object.fromEntries((Object.keys(CATS) as Cat[]).map((c) => [c, [] as Hit[]])) as Record<Cat, Hit[]>;
    const abstract = new Set<string>();
    // one scan: at each word that can begin a phrase, the run is looked up and made one word longer for as long as it is the beginning of a longer phrase (so no word is read more than the longest phrase is long)
    for (let i = 0; i < n; i++) {
      const w = t[i]!;
      if (!FIRST.has(w)) continue;
      let key = w;
      for (let len = 1; ; len++) {
        const entries = PHRASES.get(key);
        if (entries !== undefined) {
          for (const en of entries) {
            hits[en.cat].push({ s: i, e: i + len - 1, core: en.core });
            if (en.cat === "abstract") abstract.add(key);
          }
        }
        if (i + len >= n || !PREFIXES.has(key)) break;
        key += " " + t[i + len]!;
      }
    }
    const reached = (c: Cat, lo: number, hi: number) => startsIn(hits[c], lo, hi);
    const found = new Map<SafetyTier, boolean>(); // tier -> fired because of a core phrase
    const note = (tier: SafetyTier, core: boolean) => found.set(tier, (found.get(tier) ?? false) || core);
    let careKind: "health" | "distress" | null = null;

    // ---- CRISIS: a closed phrase with the person inside it, not followed by the words of a joke
    for (const h of hits.crisis) {
      if (reached("crisisStop", h.e + 1, h.e + 1)) continue;
      note("crisis", h.core);
    }

    // ---- URGENT: a symptom, a person and a "now". A text about patients (an abstract, a case report) is not a person in an emergency.
    const abstractLike = abstract.size >= 2;
    if (!abstractLike) {
      // what is said of a case that is not happening ("what should I do WHEN a patient is not breathing") is no emergency
      const hypothetical = (h: Hit): boolean => reached("conditional", h.s - 3, h.s - 1) !== undefined;
      const personNear = (h: Hit, anyone: boolean): boolean => {
        const lo = h.s - NEAR;
        const hi = h.e + NEAR;
        if (reached("person", lo, hi) || reached("appeal", lo, hi)) return true;
        // another person, by a word for them: "he" and "she" only count where the state carries its own "now" (a case report says "he suddenly developed")
        for (let at = startsIn(hits.personBody, lo, hi); at !== undefined; ) {
          if (anyone || !PRONOUNS.has(t[at.s]!)) return true;
          const next = startsIn(hits.personBody, at.s + 1, hi);
          if (next === undefined || next === at) break;
          at = next;
        }
        return false;
      };
      // a "now" is no emergency when it sits beside a word of studying ("I am studying chest pain right now")
      const nowNear = (h: Hit): boolean => {
        const lo = h.s - NEAR;
        const hi = h.e + NEAR;
        for (const list of [hits.now, hits.appeal]) {
          for (let at = startsIn(list, lo, hi); at !== undefined; ) {
            if (!reached("study", at.s - STUDY_BEFORE, at.e + STUDY_AFTER) && t[at.e + 1] !== "that") return true;
            const next = startsIn(list, at.s + 1, hi);
            if (next === undefined || next === at) break;
            at = next;
          }
        }
        return false;
      };
      for (const h of hits.symNow) if (!hypothetical(h) && personNear(h, true)) note("urgent", h.core);
      for (const h of hits.symNowBody) if (!hypothetical(h) && startsIn(hits.personBody, h.s - NEAR, h.e + NEAR)) note("urgent", true);
      for (const h of hits.sym) if (!hypothetical(h) && nowNear(h) && personNear(h, false)) note("urgent", h.core);
      for (const h of hits.symAlone) if (!hypothetical(h)) note("urgent", h.core);
      for (const h of hits.chestPlace) {
        if (hypothetical(h) || !reached("chestFeel", h.s - 4, h.e + 4) || !reached("spread", h.s - 10, h.e + 10) || !nowNear(h) || !personNear(h, false)) continue;
        note("urgent", true);
      }
    }

    // ---- the first person of the lines below: "my" that begins "my patients" or "my thesis" is a professional, not a person with a story
    const selfNear = (lo: number, hi: number): boolean => {
      for (let at = startsIn(hits.self, lo, hi); at !== undefined; ) {
        const after = t[at.e + 1];
        if (after === undefined || !NOT_RELATION.has(after)) return true;
        const next = startsIn(hits.self, at.s + 1, hi);
        if (next === undefined || next === at) break;
        at = next;
      }
      return false;
    };

    // a relative is a person with a story too ("papa ko diabetes hai"), as "my father" is; a word for another person that is only "he" or "she" is not
    const ownNear = (lo: number, hi: number): boolean => {
      if (selfNear(lo, hi)) return true;
      for (let at = startsIn(hits.personBody, lo, hi); at !== undefined; ) {
        if (!PRONOUNS.has(t[at.s]!)) return true;
        const next = startsIn(hits.personBody, at.s + 1, hi);
        if (next === undefined || next === at) break;
        at = next;
      }
      return false;
    };

    // ---- DECISION: a first person, a way of asking what to take, and a medicine near it
    for (const h of hits.decisionFrame) {
      if (reached("decisionStop", h.e + 1, h.e + 1)) continue;
      if (selfNear(h.s - 14, h.e + 3) && reached("medicine", h.s - 14, h.e + 10)) {
        note("decision", false);
        break;
      }
    }

    // ---- CARE: a health situation or a feeling of the writer, and a question to the research
    if (hits.lookup.length > 0) {
      let health = false;
      for (const h of hits.health) if (ownNear(h.s - 10, h.e + 4)) health = true;
      if (!health) {
        for (const h of hits.condition) {
          // "I have diabetes", "my father has diabetes" (the verb before it), and "papa ko diabetes hai" (the verb after it)
          const lead = reached("conditionLead", h.s - 3, h.s - 1) ?? reached("conditionLead", h.e + 1, h.e + 2);
          if (lead !== undefined && ownNear(h.s - 10, h.e + 4)) {
            health = true;
            break;
          }
        }
      }
      if (!health) {
        for (const h of hits.medicineLead) {
          if (reached("medicine", h.e + 1, h.e + 6) && selfNear(h.s - 8, h.e + 4)) {
            health = true;
            break;
          }
        }
      }
      let distress = hits.feelingSelf.length > 0;
      for (const h of hits.feeling) if (selfNear(h.s - 8, h.e + 3)) distress = true;
      if (distress || health) {
        careKind = distress ? "distress" : "health";
        note("care", false);
      }
    }

    // ---- HELP: a call for help with no topic left, or a distress message with none
    const covered = new Uint8Array(n);
    for (const c of ["help", "feeling", "feelingSelf", "lookup", "self", "person", "personBody", "now", "appeal", "symNow", "sym", "health"] as const) {
      for (const h of hits[c]) for (let k = h.s; k <= h.e; k++) covered[k] = 1;
    }
    let leftover: string | null = null;
    const topicLeft = (): boolean => {
      if (leftover === null) {
        const rest: string[] = [];
        for (let k = 0; k < n; k++) if (covered[k] !== 1 && t[k] !== END && !FILLER.has(t[k]!)) rest.push(t[k]!);
        leftover = rest.join(" ");
      }
      return subjectWords(leftover).length > 0;
    };
    if (hits.help.length > 0) {
      const core = hits.help.some((h) => h.core);
      if (!topicLeft()) note("help", core);
    }
    if (careKind === "distress" && !topicLeft()) {
      // a distress message that asks the research of nothing in particular is answered like a call for help, and not with the question "what would you like to look up?"
      found.delete("care");
      careKind = null;
      note("help", false);
    }

    const tiers = SAFETY_TIERS.filter((tier) => found.has(tier));
    return { tiers, core: tiers.filter((tier) => found.get(tier) === true), top: tiers[0] ?? null, careKind: tiers.includes("care") ? careKind : null };
  } catch {
    return NOTHING();
  }
}

/* ---------------------------------------------------------------- what the page does about it */

export type LanePlan = {
  /** The reply that takes the place of the papers (Auto only): crisis and help get the same sort of card; urgent has the button. */
  reply: "crisis" | "urgent" | "help" | null;
  /** Auto, a personal medicine decision: the papers are shown and no written answer and no background are made. */
  withhold: boolean;
  /** The lines drawn above the answer and the papers, one for each kind, in the order crisis, urgent, decision, care. */
  notices: SafetyNoticeKind[];
  /** What is counted for the message (closed names): `lane_*` for a tier that acted, `would_*` for one that was only read. */
  names: string[];
};

/** The plan of a message the lane does nothing about (a shared value: nobody changes it). */
export const NO_PLAN: LanePlan = { reply: null, withhold: false, notices: [], names: [] };
const none = (): LanePlan => ({ reply: null, withhold: false, notices: [], names: [] });

/**
 * What the lane does for a reading, in a position of its flag and for the way the message came (Auto, or a search the person chose). Off: nothing. Shadow: nothing but the names `would_*`, for an Auto
 * message (a search chosen by hand is not read in shadow). Core: only the tiers urgent, crisis and help, and only when an unmistakable phrase fired; every other hit is counted as `would_*`. On: every tier acts.
 * A search chosen by hand never gets a reply and never has its answer withheld: it gets lines (the crisis line, the urgent line for urgent or help, the decision line, the care line). In Auto the strongest of
 * crisis, urgent and help replaces the papers, a decision withholds the answer and keeps the papers, and care adds a line; a decision and a care story show only the decision line.
 */
export function planLane(read: SafetyRead, position: FlagPosition, mode: "auto" | "hand"): LanePlan {
  if (position === "off" || read.tiers.length === 0) return none();
  if (position === "shadow") return mode === "auto" ? { reply: null, withhold: false, notices: [], names: read.tiers.map((t) => `would_${t}`) } : none();
  const acts = (tier: SafetyTier): boolean => position === "on" || ((tier === "crisis" || tier === "urgent" || tier === "help") && read.core.includes(tier));
  const names = read.tiers.map((t) => (acts(t) ? `lane_${t}` : `would_${t}`));
  const acting = read.tiers.filter(acts);
  if (mode === "auto") {
    const reply = (["crisis", "urgent", "help"] as const).find((t) => acting.includes(t)) ?? null;
    if (reply) return { reply, withhold: false, notices: [], names };
    if (acting.includes("decision")) return { reply: null, withhold: true, notices: ["safety_decision"], names };
    if (acting.includes("care")) return { reply: null, withhold: false, notices: ["safety_care"], names };
    return { reply: null, withhold: false, notices: [], names };
  }
  const notices: SafetyNoticeKind[] = [];
  if (acting.includes("crisis")) notices.push("safety_crisis");
  if (acting.includes("urgent") || acting.includes("help")) notices.push("safety_urgent");
  if (acting.includes("decision")) notices.push("safety_decision");
  else if (acting.includes("care")) notices.push("safety_care");
  return { reply: null, withhold: false, notices, names };
}
