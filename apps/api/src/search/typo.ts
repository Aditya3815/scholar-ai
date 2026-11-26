import { VOCAB_EN } from "./vocab-en";

/**
 * Typos in a search, mended without a model (the day's allowance may be used, and a search engine does not read "lerning"): a word of five letters or more, in small letters, that is not an English word
 * (not in the 56,000 of vocab-en.ts) and is one letter away from one (two letters for a word of eight or more) is taken for a slip and written as that word. Capital letters (a name), digits, short words,
 * acronyms known to be words of research (`KEEP`) and anything that is already a word are left alone. Of several candidates the nearest wins, then the most common. The search of a person who wrote it right is
 * never changed; the search of a person who wrote a word that only looks like a slip can be put back with "exact words" on the page. Pure and the same for everyone.
 */

const KEEP = new Set(
  "crispr cas9 covid sars mrna pytorch tensorflow keras scikit numpy pandas llms gans cnns rnns lstms bert gpt chatgpt openai deepseek llama mistral gemini claude nlp kubernetes docker github blockchain ethereum bitcoin metaverse fintech edtech agritech biotech nanotech cybersecurity ransomware malware ".split(" "),
);

/** The words by first letter and length, with their rank (the order of the list: lower is more common). Built on the first use. */
let buckets: Map<string, { w: string; rank: number }[]> | null = null;
let rankOf: Map<string, number> | null = null;
function build(): void {
  if (buckets) return;
  const words = VOCAB_EN.split(" ");
  rankOf = new Map(words.map((w, i) => [w, i]));
  buckets = new Map();
  words.forEach((w, rank) => {
    const k = w[0]!;
    const list = buckets!.get(k);
    if (list) list.push({ w, rank });
    else buckets!.set(k, [{ w, rank }]);
  });
}

/** Edits to turn a into b (insert, delete, replace, or swap two neighbours), or max + 1 once it is clear it is more than max. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2: number[] = [];
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2]! + 1);
      cur[j] = d;
      if (d < best) best = d;
    }
    if (best > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j]!;
    prev = cur;
  }
  return prev[b.length]!;
}

/** A word of the list this far down is a common one: two of them side by side are a compound, and not two scraps of a list. */
const COMMON_RANK = 15_000;
const PREFIXES = new Set(["pre", "post", "non", "sub", "bio", "geo", "eco", "neo", "uni", "bi", "tri", "co", "re", "un", "de", "ex", "semi", "self", "meta", "multi", "cross", "inter", "intra", "micro", "macro", "mono", "poly", "auto", "neuro", "proto", "anti", "over", "under", "hyper", "hypo", "para", "peri", "trans", "ultra", "super", "mid"]);
const SUFFIXES = ["s", "es", "ed", "d", "ing", "ly", "al", "ally", "ic", "ical", "ics", "ive", "ion", "ions", "ional", "ization", "isation", "er", "ers", "ness", "ment", "ments", "ity", "able", "ous", "ian", "ism", "ist", "ists"];

/** A word that is made of words: two of the list joined ("pretraining", "radiographs") or one with an ending ("convolutional", "optimizers"). Rare scientific words are mostly such, and are not slips. */
function madeOfWords(word: string): boolean {
  const common = (w: string): boolean => (rankOf!.get(w) ?? Infinity) < COMMON_RANK;
  for (let i = 2; i <= word.length - 4; i++) {
    const head = word.slice(0, i);
    const tail = word.slice(i);
    if (i >= 4 ? common(head) && common(tail) : PREFIXES.has(head) && tail.length >= 5 && common(tail)) return true;
  }
  // a stem of six letters or more is no scrap of the list ("convolution"); a shorter one counts only when it is a common word (not "nuer")
  const stemOk = (stem: string): boolean => rankOf!.has(stem) && (stem.length >= 6 || common(stem));
  for (const suffix of SUFFIXES) {
    if (!word.endsWith(suffix) || word.length - suffix.length < 4) continue;
    const stem = word.slice(0, -suffix.length);
    if (stemOk(stem) || stemOk(stem + "e") || (stem.length > 4 && stem.at(-1) === stem.at(-2) && stemOk(stem.slice(0, -1)))) return true;
  }
  return false;
}

/** A word this far down the list is rare enough to be a slip of a far commoner one that is one letter away ("machin" for "machine"). */
const RARE_FROM_RANK = 25_000;
const MUCH_COMMONER = 20;

/** The word a slip was meant to be, or null when `word` is not a slip (see the top of the file). */
export function mendWord(word: string): string | null {
  if (!/^[a-z]{5,18}$/.test(word) || KEEP.has(word)) return null;
  build();
  const own = rankOf!.get(word);
  // a word of the list is left alone unless it is a rare one with a much commoner neighbour (one letter away)
  if (own !== undefined && own < RARE_FROM_RANK) return null;
  if (madeOfWords(word)) return null;
  const max = own !== undefined ? 1 : word.length >= 8 ? 2 : 1;
  let best: { w: string; d: number; rank: number } | null = null;
  // a slip keeps the first letter far more often than not; looking only there keeps this to a few hundred words
  for (const c of buckets!.get(word[0]!) ?? []) {
    if (Math.abs(c.w.length - word.length) > max) continue;
    if (own !== undefined && c.rank * MUCH_COMMONER >= own) continue;
    const d = editDistance(word, c.w, max);
    if (d > max) continue;
    if (!best || d < best.d || (d === best.d && c.rank < best.rank)) best = { w: c.w, d, rank: c.rank };
  }
  return best?.w ?? null;
}

/** The text with its slips mended, or null when nothing was changed. Only plain English: the caller does not give it Hindi, Hinglish or text with anything but letters, digits and ordinary punctuation. */
export function mendTypos(text: string): string | null {
  if (!/^[\x20-\x7e]+$/.test(text)) return null;
  let changed = false;
  const out = text.replace(/[A-Za-z]+/g, (token) => {
    const fixed = mendWord(token);
    if (fixed === null) return token;
    changed = true;
    return fixed;
  });
  return changed ? out : null;
}
