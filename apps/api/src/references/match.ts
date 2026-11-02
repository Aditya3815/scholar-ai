/**
 * Pure matching logic for the Reference Verifier: given the text of a reference exactly as a scholar pasted it, and a
 * candidate record from Crossref/OpenAlex, decide whether they are the same paper. No network, no LLM.
 *
 * Verification needs the title to be covered AND at least one independent confirmation (author or year) AND no
 * contradiction. A made-up reference that borrows a real title but invents authors therefore comes back as `mismatch`,
 * never `verified`.
 */

export type Candidate = {
  doi: string | null;
  title: string;
  /** Family names, in order (first author first). Empty when the record has none (e.g. corporate author). */
  authorFamilies: string[];
  authors: string[];
  year: number | null;
  venue: string | null;
  /** Only on a record fetched to be told by where it was printed (a reference that gives no title): its volume, and its first page or article number. */
  volume?: string | null;
  pages?: string[];
};

export type MatchChecks = {
  /** Share of the record's title words that appear in the reference text (0..1). */
  title: number;
  /** true/false = one of the first 3 authors does / does not appear; null = the record has no authors to compare. */
  author: boolean | null;
  /** true/false = a year in the reference is within +-1 of the record's year; null = unknown. */
  year: boolean | null;
  /** How far the nearest year printed in the reference is from the record's (undefined: the reference prints none, or the record has none). */
  yearOff?: number;
  /** The reference gives the beginning of the record's title and leaves out the rest (a dropped subtitle): "A decomposable attention model" for "... for Natural Language Inference". */
  shortened?: boolean;
  /** The reference gives no title: the record was matched by the first author, the year, the volume and the first page. */
  locator?: boolean;
};

/**
 * verified    title covered + author confirmed + year not contradicting
 * title_only  a record with (nearly) this title exists but authors/year disagree, or nothing independent confirms it
 * different   the record is about something else
 * no_authors  title (and year) match but the record lists no authors at all, so the authors cannot be checked. Never `verified`:
 *             letters, comments and stubs often share the exact title of the real paper and carry no authors.
 */
export type MatchVerdict = "verified" | "title_only" | "different" | "no_authors";

const GROUP_NAME = /\b(collaborat\w*|consortium|committee|investigators|working group|study group|task force|writing group|network|initiative|commission)\b/i;

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const tokenize = (s: string): string[] => fold(s).match(/[\p{L}\p{N}]+/gu) ?? [];

const tidyDoi = (raw: string): string => raw.replace(/%0[ad][^]*$/i, "").replace(/\s+/g, "").replace(/[\u2010-\u2013]/g, "-").replace(/[.,;:)\]}>'"]+$/, "").toLowerCase();

/**
 * The DOI a reference names, as one or two readings, the likelier first. A PDF that wrapped a DOI onto the next line leaves a space where the line broke: after a hyphen
 * ("…2016- 12210", "S0022- 0302(06)72335-9") that is certain; after a dot or a slash ("doi:10.1145/3498361. 3538933", "…I3DA48870. 2021.9610916") it is the likelier reading when what
 * follows is a number, but "…abc.5. 2019 IEEE Conference" is a sentence that ends, so the DOI as printed is the second reading. A "%0A" (an encoded line break in a pasted link) ends it.
 */
export function doiCandidates(text: string): string[] {
  const m = /10\.\d{4,9}\/(?:\s(?=[^\s"<>]*\d))?[^\s"<>]+/i.exec(text);
  if (!m) return [];
  let raw = m[0];
  let rest = text.slice(m.index + raw.length);
  let uncertain = false;
  for (let i = 0; i < 2; i++) {
    const next = /^\s+([^\s"<>]+)/.exec(rest);
    if (!next) break;
    const last = raw[raw.length - 1]!;
    const afterHyphen = /[-\u2010-\u2013]/.test(last);
    if (!afterHyphen && !((last === "." || last === "/") && /^\d/.test(next[1]!))) break;
    uncertain ||= !afterHyphen;
    raw += next[1]!;
    rest = rest.slice(next[0].length);
  }
  const joined = tidyDoi(raw);
  const plain = tidyDoi(m[0]);
  return uncertain && plain !== joined ? [joined, plain] : [joined];
}

/** "https://doi.org/10.1000/ABC.", "doi:10.1000/abc)" -> "10.1000/abc" */
export function extractDoi(text: string): string | null {
  return doiCandidates(text)[0] ?? null;
}

/**
 * Words a PDF broke across lines come out as "im- age recognition" / "Convolu- tional": rejoin them. A hyphen that really is part of
 * a compound before "and", "or" ("pre- and post-test") stays.
 */
export const joinHyphenated = (text: string): string => text.replace(/(\p{L}{2,})-\s+(?!(?:and|or|to|vs|und|et)\b)(\p{Ll}{2,})/gu, "$1$2");

/** "arXiv:1607.06450v2", "arxiv.org/abs/1706.03762", "CoRR, abs/1409.0473" -> "1607.06450" (new-style ids only, version dropped). */
export function extractArxivId(text: string): string | null {
  const m = text.match(/(?:arxiv[^\d]{0,30}|\babs\/)(\d{4}\.\d{4,5})(?:v\d+)?/i);
  return m && /^(\d{2})(0[1-9]|1[0-2])\./.test(m[1]!) ? m[1]! : null;
}

/** The DOI arXiv (through DataCite) gives every preprint. */
export const arxivDoi = (id: string): string => `10.48550/arxiv.${id}`;

/** Year a preprint first appeared, read from its arXiv DOI ("…arxiv.1706.03762" -> 2017); null for any other DOI. */
export function arxivYear(doi: string | null): number | null {
  const m = doi ? /^10\.48550\/arxiv\.(\d{2})(0[1-9]|1[0-2])\./i.exec(doi) : null;
  return m ? 2000 + Number(m[1]) : null;
}

/** Plausible publication years mentioned in the text (1900-2099), in order of appearance. */
export function extractYears(text: string): number[] {
  // Strip DOIs first: "10.1016/j.cell.2015.03.017" contains year-like fragments.
  const clean = text.replace(/10\.\d{4,9}\/[^\s"<>]+/gi, " ");
  return [...clean.matchAll(/(?<![\d])(19\d{2}|20\d{2})(?![\d])/g)].map((m) => Number(m[1]));
}

/** The longest run of consecutive words of `needle` that appears, in order and unbroken, in `haystack`: its length and where it starts. */
function locateRun(needle: string[], haystack: string[]): { len: number; start: number } {
  let best = { len: 0, start: -1 };
  let prev = new Array<number>(haystack.length + 1).fill(0);
  for (const n of needle) {
    const cur = new Array<number>(haystack.length + 1).fill(0);
    for (let j = 1; j <= haystack.length; j++) {
      if (haystack[j - 1] === n) {
        cur[j] = prev[j - 1]! + 1;
        if (cur[j]! > best.len) best = { len: cur[j]!, start: j - cur[j]! };
      }
    }
    prev = cur;
  }
  return best;
}

const longestRun = (needle: string[], haystack: string[]): number => locateRun(needle, haystack).len;

/**
 * The words of a reference, read the way the record writes its title. A PDF breaks words ("im- age"), loses a space ("filtersimultaneous") or adds one ("Under water"), and a hyphen at
 * the end of a line may be a real one ("attention- based") or a soft one ("ma- chine"): nothing in the reference says which, and rejoining every break guesses wrong for the real ones.
 * The record does say: two neighbouring words that make one word of its title are that word, and one word that makes two neighbouring words of its title is those two. Nothing else changes,
 * so a reference whose words are not the record's still does not match.
 */
export function alignTokens(ref: string[], title: string[]): string[] {
  const want = new Set(title);
  const pairs = new Map<string, [string, string]>();
  for (let i = 0; i + 1 < title.length; i++) pairs.set(title[i]! + title[i + 1]!, [title[i]!, title[i + 1]!]);
  const out: string[] = [];
  for (let i = 0; i < ref.length; i++) {
    const w = ref[i]!;
    const next = ref[i + 1];
    if (next !== undefined && !(want.has(w) && want.has(next)) && want.has(w + next)) {
      out.push(w + next);
      i++;
    } else if (!want.has(w) && pairs.has(w)) out.push(...pairs.get(w)!);
    else out.push(w);
  }
  return out;
}

/**
 * The years a reference prints as its own, without those that belong to the title of the record it is compared with ("... during 2006-2015: A Scientometrics Study"): a real year in a title
 * stands two or three years from a paper's own and must not stand in for it, or a reference whose year was moved would pass for the real one. A year that is printed twice (once in
 * the title, once as the year) keeps the second.
 */
function printedYears(refText: string, title: string): number[] {
  const years = extractYears(refText);
  // only when the title is in the reference: a reference that gives no title has the year as its own, whatever the record's title says
  const have = new Set(tokenize(refText));
  const words = tokenize(title).filter((t) => t.length > 1);
  if (words.length === 0 || words.filter((t) => have.has(t)).length / words.length < 0.5) return years;
  for (const y of extractYears(title)) {
    const i = years.indexOf(y);
    if (i >= 0) years.splice(i, 1);
  }
  return years;
}

export function checkMatch(refText: string, c: Candidate): MatchChecks {
  const refTokens = new Set(tokenize(refText)); // the names of authors are compared with the words as they are printed
  const allTitle = tokenize(c.title);
  const refWords = alignTokens(tokenize(refText), allTitle);
  const titleWords = new Set(refWords);

  const titleTokens = allTitle.filter((t) => t.length > 1 || /\p{N}/u.test(t));
  let title = titleTokens.length === 0 ? 0 : titleTokens.filter((t) => titleWords.has(t)).length / titleTokens.length;
  // The title words must also appear TOGETHER, in order, the way a title is written: a short generic record title
  // ("Consensus in Blockchain") is otherwise "covered" by any long reference that happens to contain those words scattered
  // through a different title. Allow some drift (typos, a dropped subtitle): the longest run must cover most of the title.
  const run = locateRun(allTitle, refWords);
  if (allTitle.length > 0 && run.len / allTitle.length < 0.75) title = Math.min(title, 0.4);
  // A record whose title is the name of the VENUE the reference was published in ("Advances in Neural Information Processing
  // Systems 19", "Neural Networks", a conference's proceedings) sits right after "In" in the reference. That is where a venue is
  // named, never where a title is, so it says nothing about the cited paper.
  else if (run.len >= 2 && run.start > 0 && refWords[run.start - 1] === "in" && allTitle[0] !== "in") title = Math.min(title, 0.4);
  // A very short record title that is only a fragment of the reference's own, much longer title ("Blockchain Consensus" inside
  // "Quantum-inspired blockchain consensus for rural healthcare records") is a coincidence, not the same paper.
  const own = allTitle.length > 0 && allTitle.length <= 3 ? guessTitle(refText) : null;
  if (own) {
    const ownTokens = tokenize(own);
    if (allTitle.length < ownTokens.length * 0.6 && longestRun(allTitle, ownTokens) === allTitle.length) title = Math.min(title, 0.4);
  }

  // A reference may give only the beginning of the title ("A decomposable attention model" for "A Decomposable Attention Model for Natural Language Inference"): what it prints as its title is
  // the start of the record's. The verdict then asks for the authors AND the year, as it does for a short title.
  let shortened = false;
  if (title < 0.85 && allTitle.length > 3) {
    const own = searchTitle(refText);
    const ownWords = own ? alignTokens(tokenize(own), allTitle) : [];
    shortened = ownWords.filter((t) => t.length > 1).length >= 3 && ownWords.length < allTitle.length && ownWords.every((t, i) => t === allTitle[i]);
    // or the record has words the reference leaves out in the middle ("COVID-19" for "Coronavirus Disease 2019 (COVID-19)"): all of the reference's title is in the record's, in order, and it is
    // most of it
    if (!shortened && ownWords.filter((t) => t.length > 1).length >= 4 && ownWords.length < allTitle.length && ownWords.length / allTitle.length >= 0.7) {
      let at = 0;
      shortened = ownWords.every((t) => (at = allTitle.indexOf(t, at) + 1) > 0);
    }
    if (shortened) title = Math.max(title, 0.9);
  }

  let author: boolean | null = null;
  // A registry that lists only a group ("Antimicrobial Resistance Collaborators") while people cite the lead authors: the
  // authors cannot be compared, which is different from them disagreeing.
  const onlyGroups = c.authorFamilies.length > 0 && c.authorFamilies.every((f) => GROUP_NAME.test(f));
  // A manuscript copied from a journal's page can carry the letter of the author's affiliation after the name ("Lia", "Wangc", "Zhanga,1"): one letter a to e after the surname is that
  const printed = (t: string) => refTokens.has(t) || (t.length >= 2 && "abcde".split("").some((l) => refTokens.has(t + l)));
  if (c.authorFamilies.length > 0) {
    const named = c.authorFamilies.slice(0, 3).some((fam) => {
      const toks = tokenize(fam).filter((t) => t.length > 1);
      if (toks.length === 0) return false;
      // family names: every word must appear; organisation names ("World Health Organization") may be abbreviated or reordered
      // group names need every word: their words ("Antimicrobial Resistance") often also occur in the paper's title
      const need = onlyGroups || toks.length <= 2 ? toks.length : Math.ceil(toks.length * 0.6);
      return toks.filter(printed).length >= need;
    });
    // group-only records: naming the group confirms; citing individuals is simply not comparable (null), not a contradiction
    author = onlyGroups ? (named ? true : null) : named;
  }

  let year: boolean | null = null;
  let yearOff: number | undefined;
  if (c.year != null) {
    const years = printedYears(refText, c.title);
    // a reference that prints no year of its own has nothing to compare: unknown, not "differs"
    if (years.length > 0) {
      year = years.some((y) => Math.abs(y - c.year!) <= 1);
      yearOff = Math.min(...years.map((y) => Math.abs(y - c.year!)));
    }
  }
  return { title, author, year, yearOff, ...(shortened ? { shortened } : {}) };
}

/**
 * A reference that gives no title ("Abdo, A. A., et al. 2009a, ApJ, 699, 976", "D. Finkelstein, Phys. Rev. 110, 965 (1958)": physics, astronomy and chemistry are written so) has nothing to
 * compare a title with. It is told by who, when and where: the first author's family name, a year within one of the record's, the volume and the first page (or article number) of the
 * record must all be in the reference. Only for a reference whose title cannot be read: with a title, a wrong title on a real page is a different reference, not this one.
 */
export function checkLocator(refText: string, c: Candidate): boolean {
  if (!c.volume || !c.pages || c.pages.length === 0) return false;
  const tokens = new Set(tokenize(refText));
  const volume = tokenize(c.volume);
  if (volume.length === 0 || !volume.every((t) => tokens.has(t))) return false;
  const page = c.pages.map((p) => tokenize(p)[0]).find((p): p is string => !!p && tokens.has(p));
  // "1" and "3" are in nearly every reference; a volume and a page that say something are at least three characters together ("17, 2" is a journal with article numbers)
  if (!page || volume.join("").length + page.length < 3) return false;
  return checkIdentified(refText, c);
}

/**
 * Who and when, and nothing else: the record's first author and a year within one of its are in the reference, and the reference has no words of its own besides. For a reference that gives no title
 * but names where it was printed (`checkLocator`) or an identifier that is a record by itself (an arXiv id). A reference that has a title of its own is not told by that: a made-up title on a real
 * page is another reference. What is left once the record's authors and the words of its journal's name (an abbreviation is the start of one: "Phys." "Rev.") are taken away is at most the journal's
 * acronym ("ApJ").
 */
export function checkIdentified(refText: string, c: Candidate): boolean {
  if (c.year == null || c.authorFamilies.length === 0) return false;
  const tokens = new Set(tokenize(refText));
  const family = tokenize(c.authorFamilies[0]!).filter((t) => t.length > 1);
  if (family.length === 0 || !family.every((t) => tokens.has(t))) return false;
  if (!printedYears(refText, c.title).some((y) => Math.abs(y - c.year!) <= 1)) return false;
  const known = new Set([...c.authors, ...c.authorFamilies].flatMap(tokenize));
  const journal = tokenize(c.venue ?? "");
  const rest = [...tokens].filter((t) => /^\p{L}{3,}$/u.test(t) && !known.has(t) && !FILLER.has(t) && !journal.some((w) => w.startsWith(t)));
  return rest.length <= 1;
}

const FILLER = new Set(["and", "the", "von", "van", "der", "den", "del", "dos", "bin", "ibn", "et", "al"]);

/** The family name at the head of a reference, for asking Crossref about its first author: "A. Einstein, ..." and "Abdo, A. A., ..." both give the surname. null when there is none. */
export function firstAuthorFamily(text: string): string | null {
  const head = text.split(/[,;&]|\band\b|\bet al\b/i)[0] ?? "";
  const words = (head.match(/[\p{L}'’-]+/gu) ?? []).filter((w) => w.length > 1);
  return words.sort((a, b) => b.length - a.length)[0] ?? null;
}

/** The year printed in the reference that is nearest to the record's, for saying what the two years are. */
export const nearestYear = (text: string, year: number, title: string): number | null => printedYears(text, title).sort((a, b) => Math.abs(a - year) - Math.abs(b - year))[0] ?? null;

export function verdict(c: Candidate, k: MatchChecks): MatchVerdict {
  const titleTokens = tokenize(c.title).filter((t) => t.length > 1 || /\p{N}/u.test(t));
  const short = titleTokens.length < 3; // "Deep learning": generic, demand both confirmations
  const needTitle = short ? 0.95 : 0.85;
  // A record whose whole title is one word ("ry", "Introduction") resembles every reference that happens to contain it: it can confirm
  // a reference (with author and year) but is never reported as "a real paper with a very similar title".
  if (titleTokens.length < 2) return k.title >= needTitle && k.author === true && k.year === true ? "verified" : "different";
  if (k.shortened) return k.author === true && k.year === true ? "verified" : "title_only";
  if (k.title < needTitle) return k.title >= 0.5 ? "title_only" : "different";

  // A year two off, with the whole title and an author confirmed, is a paper first put online or in a conference a year or two before the issue the record dates it by (and the other way
  // round for a citation of the later version). Three years or more is a difference worth a look.
  if (k.year === false && k.author === true && !short && k.title >= 0.95 && (k.yearOff ?? 99) <= 2) return "verified";
  if (k.author === false || k.year === false) return "title_only"; // contradicted by the record
  if (k.author === null) return k.year === true ? "no_authors" : "title_only"; // nothing to confirm the authors against
  if (short) return k.author === true && k.year === true ? "verified" : "title_only";
  return "verified"; // author confirmed (author === true), year true or unknown
}

// an opening quote inside does not belong to the title: a PDF prints a colon as “ now and then ("CEH-YOLO “A composite enhanced ...”")
const QUOTED_TITLE = /[“"]([^“”"]{12,300})[”"]/;

/**
 * Best guess at the title inside a pasted reference, for a title-focused search. Handles quoted titles (IEEE) and
 * sentence-structured styles (APA, Vancouver): the longest sentence that does not look like an author list.
 * Returns null when it cannot isolate one (e.g. "Smith et al., Title, Journal 2020" with no sentence breaks).
 */
export function guessTitle(text: string): string | null {
  const quoted = text.match(QUOTED_TITLE);
  if (quoted) return quoted[1]!.replace(/[,.\s]+$/, "").trim();

  const plain = text.replace(/https?:\/\/\S+|doi:\s*\S+|10\.\d{4,9}\/\S+/gi, " ").replace(/\s+/g, " ").trim();
  const parts = plain.split(/(?<=[.?!])\s+(?=[\p{Lu}\p{N}“"(\[])/u).map((s) => s.trim()).filter(Boolean);
  let best: string | null = null;
  let bestWords = 0;
  for (const p of parts) {
    const words = p.split(/\s+/);
    if (words.length < 4 || words.length > 40) continue;
    const initials = words.filter((w) => /^\p{Lu}\.?,?$|^\p{Lu}\p{Lu}$/u.test(w)).length; // "M", "J.", "AB": author initials
    if (initials / words.length > 0.25) continue; // reads like an author list
    if (/^\(?\d{4}\)?\.?$/.test(p)) continue;
    if (words.length > bestWords) {
      best = p.replace(/[.\s]+$/, "");
      bestWords = words.length;
    }
  }
  // up to its own full stop: "Network in network. arXiv:1312.4400, 2013" is one part when the venue starts in lower case
  return best && best.length < plain.length * 0.95 ? tidyTitle(firstSentence(best)) : null;
}

const NAME_JOINERS = /^(and|&|et|al\.?|de|van|von|der|den|di|da|la|le|du|dos|del|bin|ibn)$/i;

/** "Jimmy Lei Ba, Jamie Ryan Kiros, and Geoffrey E Hinton": capitalised words with commas or "and". */
const TITLE_WORDS = new Set(["for", "of", "in", "on", "with", "from", "to", "via", "using", "towards", "toward", "the", "an", "by", "at", "is", "are", "how", "what", "why"]);

export function looksLikeAuthors(s: string): boolean {
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  // a list of names has none of these: "VisualBERT: A Simple and Performant Baseline for Vision and Language" is a title however many of its words are capitalised
  if (words.some((w) => TITLE_WORDS.has(w))) return false;
  const nameLike = words.filter((w) => /^\p{Lu}/u.test(w) || NAME_JOINERS.test(w)).length;
  return nameLike / words.length >= 0.9 && (/,/.test(s) || /\band\b|&/.test(s));
}

/**
 * For styles that put the authors first ("Authors. Title. Venue, year."), the sentence that follows the author list, even when it is
 * short ("Layer normalization."), which guessTitle skips. null when the text does not look like that.
 */
export function titleAfterAuthors(text: string): string | null {
  const plain = text.replace(/https?:\/\/\S+|doi:\s*\S+|10\.\d{4,9}\/\S+/gi, " ").replace(/\s+/g, " ").trim();
  const parts = plain.split(/(?<=[.?!])\s+(?=[\p{Lu}\p{N}“"(\[])/u).map((x) => x.trim()).filter(Boolean);
  const bare = (x: string) => x.replace(/[.\s]+$/, "");
  // a single full name ("Alex Graves") is an author list only as the very first part of the reference
  const isName = (x: string) => /^\p{Lu}[\p{L}'’-]+(\s\p{Lu}[\p{L}'’.-]*){1,2}$/u.test(bare(x));
  const i = parts.findIndex((x, k) => looksLikeAuthors(bare(x)) || (k === 0 && isName(x)));
  let j = i + 1;
  // "... and Alexander M. Rush." splits after the initial and leaves the surname alone as a one-word part
  while (i >= 0 && j < parts.length && bare(parts[j]!).split(/\s+/).length === 1) j++;
  // the title ends at its own full stop, even when the venue after it starts in lower case ("... normalization. arXiv preprint ...")
  const next = i >= 0 ? parts[j]?.split(/(?<=[.?!])\s+(?=\p{Ll})/u)[0]?.replace(/[.\s]+$/, "") : undefined;
  const words = next ? next.split(/\s+/).length : 0;
  return next && words >= 2 && words <= 30 && !/^in\s/i.test(next) ? next : null;
}

/** Words that end in a full stop inside a title without ending it. An initial ("L. X Gossypium") does not end a sentence either; an acronym that ends the title ("... in HCI. Journal of ...") does. */
const ABBREVIATION = /^(vs|et al|no|nr|fig|eq|vol|pp|dr|mr|mrs|ms|st|jr|sr|cf|ca|inc|ltd|co|approx|e\.g|i\.e)$/i;

/** The first sentence of `s`: it ends at the first full stop that is not an abbreviation or an initial, whatever follows ("... Agents. npj Digital Medicine", "... for AI. In: NeurIPS"). */
function firstSentence(s: string): string {
  for (const m of s.matchAll(/[.?!]\s+/gu)) {
    const before = s.slice(0, m.index).split(/\s+/).pop() ?? "";
    if (m[0][0] === "." && (/^\p{Lu}$/u.test(before) || ABBREVIATION.test(before))) continue;
    return s.slice(0, m.index! + 1);
  }
  return s;
}

const tidyTitle = (t: string): string => t.replace(/\s*\(\s*(?:19|20)\d{2}[a-z]?\s*\)\s*$/, "").replace(/[.\s]+$/, "").trim();

/**
 * The title of a reference that has its authors first and joins them to the title with a colon ("Bahdanau, D., Cho, K., Bengio, Y.: Neural machine translation ... In: ICLR (2015)", the style
 * of Springer's proceedings: ECCV, MICCAI, ...) or with the year in brackets ("Vaswani A, Shazeer N et al (2017) Attention is all you need. In: ..."). Without this the author list stays glued to
 * the title, and a search for the title needs every one of those names to be in it. null when the reference is not written like that.
 */
function titleAfterAuthorBlock(text: string): string | null {
  const plain = text.replace(/https?:\/\/\S+|doi:\s*\S+|10\.\d{4,9}\/\S+/gi, " ").replace(/\s+/g, " ").trim();
  const names = (head: string) => /\p{Lu}[\p{L}'’-]+,\s*\p{Lu}\./u.test(head) || /\b\p{Lu}\.\s*\p{Lu}[\p{L}'’-]+/u.test(head) || looksLikeAuthors(head.replace(/[.]/g, ""));
  const colon = /^(.{3,1200}?\b\p{Lu}\.)\s*:\s+(?=\p{L})/u.exec(plain);
  const bracket = /^(.{6,600}?)\s\(\s*(?:19|20)\d{2}[a-z]?\s*\)\s*[.,:]?\s+(?=\p{L})/u.exec(plain);
  const m = colon && names(colon[1]!) ? colon : bracket && names(bracket[1]!) ? bracket : null;
  if (!m) return null;
  const title = tidyTitle(firstSentence(plain.slice(m[0].length)));
  return title.split(/\s+/).length >= 2 && !looksLikeAuthors(title) ? title : null;
}

/**
 * Something that reads as the title of a work, not as what is left of a reference when the authors are taken away: "2009a, ApJ, 699, 976", "110, 965 (1958)", "Abbott et al., Phys". A title has
 * at least two words of three letters or more (a number or a code in it is fine: "COVID-19: a 2020 review"), and "et al" is a list of authors.
 */
const plausibleTitle = (t: string | null): string | null => (t && t.split(/\s+/).filter((w) => (w.match(/\p{L}/gu) ?? []).length >= 3).length >= 2 && !/\bet al\b/i.test(t) ? t : null);

/**
 * The title to search for: the sentence after the author list when the reference is written authors-first (it also finds short
 * titles), otherwise guessTitle, unless that turned out to be the author list itself. null when the reference has none (physics, astronomy and chemistry
 * references are "Author, Journal volume, page (year)").
 */
export const searchTitle = (text: string): string | null => plausibleTitle(findTitle(text));

function findTitle(text: string): string | null {
  if (QUOTED_TITLE.test(text)) return guessTitle(text); // IEEE style: the quotes say where the title is
  const joined = titleAfterAuthorBlock(text);
  if (joined) return joined;
  const after = titleAfterAuthors(text);
  // "McMurray, J. J. V., Solomon, S. D., ..." splits at every initial; what follows the first author part can be more of the list
  if (after && !looksLikeAuthors(after)) return after;
  const guess = guessTitle(text);
  return guess && !looksLikeAuthors(guess) ? guess : null;
}

/**
 * A title for a search that needs every word to be in the record's title. A word a PDF broke at the end of a line ("attention- based", "Convolu- tional") is a real compound or a
 * soft break and the reference does not say which, so either reading is a guess that leaves the search empty when it is wrong: the words on both sides of a break are left out and the rest
 * finds the paper. With fewer than three words left the title is returned as it was.
 */
export function dropBrokenWords(title: string): string {
  const words = title.split(/\s+/);
  const kept: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (/\p{L}-$/u.test(words[i]!) && /^\p{Ll}/u.test(words[i + 1] ?? "")) i++;
    else kept.push(words[i]!);
  }
  return kept.length === words.length || kept.length < 3 ? title : kept.join(" ");
}

/**
 * `title` was read from the reference with its line breaks rejoined; this finds it again in the reference as printed (where "attention- based" still has its break) so that the words around
 * a break can be left out of a search. The title is read from the rejoined text because a break inside an author's name ("Morgen- stern. 2011.") breaks the sentences of the text as printed and
 * returns the venue for the title. When it is not found, or has no break, the title itself.
 */
export function spacedTitle(title: string, printed: string): string {
  if (title.length > 300) return title;
  const escape = (ch: string) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // between any two characters of the title the PDF may have put a break: a hyphen and white space
  const re = new RegExp([...title].map((ch) => (/\s/.test(ch) ? "\\s+" : escape(ch))).join("(?:-\\s+)?"), "iu");
  const m = re.exec(printed);
  return m && /-\s+\p{Ll}/u.test(m[0]) ? m[0] : title;
}

export type SourceKind = "web" | "book" | "report" | "thesis" | "patent";

const JOURNAL_SIGNS = /\b(journal|j\.|proc\.|proceedings|transactions|letters|review|annals|vol\.?\s*\d|\d+\s*\(\d+\)|\d+\s*:\s*\d+\s*[-–]\s*\d+)/i;
const PUBLISHER = /\b(press|publishers?|publishing|wiley|elsevier|mcgraw[- ]hill|prentice|pearson|routledge|sage publications|springer[- ]verlag|isbn)\b/i;
const REPORT = /\b(report|white paper|handbook|census|guidelines|situation report|ministry|government of|world health organi[sz]ation|unicef|unesco|nddb|policy brief|working paper)\b/i;
const THESIS = /\b(ph\.?\s?d\.?|doctoral|master'?s|m\.?\s?tech|dissertation|thesis)\b/i;
// a patent is cited by its office or its number ("U.S. Patent No. 12,494,214", "Patent Application No. 18/739,899"); the word alone is also in the title of papers about patents
const PATENT = /\b(?:u\.?s\.?|us|eu|ep|wo|jp|cn|kr|de|gb|indian)\.?\s+patent\b|\bpatents?\s+(?:application\s+)?(?:no\.?|number|nos\.?)\s*[A-Z]{0,3}\s?\d/i;

/**
 * What a reference without a DOI most likely is, when it is not a journal article: a web page, a book, a report or a thesis. Crossref and OpenAlex mostly do not
 * list these, so "not found" for them says little, and the answer should say that instead of sounding like an accusation. null = it reads like an article.
 */
export function referenceKind(text: string): SourceKind | null {
  if (extractDoi(text)) return null;
  if (PATENT.test(text)) return "patent";
  if (/https?:\/\/|\bwww\./i.test(text) && !JOURNAL_SIGNS.test(text.replace(/https?:\/\/\S+/g, " "))) return "web";
  if (THESIS.test(text)) return "thesis";
  if (JOURNAL_SIGNS.test(text)) return null;
  if (PUBLISHER.test(text)) return "book";
  if (REPORT.test(text)) return "report";
  return null;
}

export const confidence = (k: MatchChecks): number =>
  Math.round((0.6 * k.title + 0.25 * (k.author ? 1 : 0) + 0.15 * (k.year ? 1 : 0)) * 100) / 100;

/** Best candidate = highest title coverage, then author/year confirmations. */
export function pickBest(refText: string, cands: Candidate[]): { cand: Candidate; checks: MatchChecks } | null {
  let best: { cand: Candidate; checks: MatchChecks; rank: number } | null = null;
  for (const cand of cands) {
    const checks = checkMatch(refText, cand);
    const rank = checks.title * 10 + (checks.author ? 2 : 0) + (checks.year ? 1 : 0);
    if (!best || rank > best.rank) best = { cand, checks, rank };
  }
  return best && { cand: best.cand, checks: best.checks };
}
