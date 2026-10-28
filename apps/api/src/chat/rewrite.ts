/**
 * The deterministic part of making a claim say only what its sentences say (docs/design/claim-support.md, "Shortening a claim"). The judge may offer, for a claim it calls `partial`, a
 * shorter version of the claim. Words written by a model reach the reader only if they pass this check and then a second reading says the shorter claim is fully supported. This
 * check cannot know whether the new sentence is true; it makes sure that the shorter claim **adds nothing**: no word, no number, no negation the claim and its sentences do not
 * already have, no negation of the claim kept in words but turned the other way (a whole negated clause may be taken out), none of the claim's hedges lost, the same script, and not so short that little of the claim is left.
 */

export type RewriteReason = "empty" | "same" | "brackets" | "length" | "words" | "numbers" | "negation" | "hedge" | "script";
export type RewriteCheck = { ok: true } | { ok: false; reason: RewriteReason; detail?: string };

const tokens = (s: string): string[] => s.normalize("NFKC").toLowerCase().replace(/(\w)n['’]t/g, "$1 not").match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];

/** Function words that may appear in a shorter claim without being in the claim (English; other scripts are checked by length). */
const FREE = new Set("the and for with that this from was were are has had have its but can who how per via due than also into their which such these those been being not nor then there here they them his her she him you your our whose whom may".split(" "));
// "not", "nor" and "may" are here only so that the word rule does not report them: negations and hedges have rules of their own below. Quantity words (all, any, each, some, one, over ...) are not free: a shorter claim must not bring them.
const NEGATIONS = new Set(["no", "not", "nor", "never", "none", "neither", "without", "cannot", "nothing", "nahi", "nahin", "नहीं", "नही", "न", "बिना", "नहि"]);
const HEDGES = ["may", "might", "could", "possibly", "possible", "probably", "likely", "suggest", "appear", "seem", "associated", "association", "correlat", "potential", "preliminary", "tentative", "unclear", "uncertain", "mixed", "modest", "shayad", "संभावित", "सकता", "सकती", "सकते", "शायद"];

/** The negations of a text ("doesn't" is read as "does not"). */
const negations = (s: string): string[] => {
  const found = tokens(s).filter((t) => NEGATIONS.has(t));
  if (/n['’]t\b/i.test(s)) found.push("n't");
  return [...new Set(found)].sort();
};
/**
 * A negation of the claim may be missing from the shorter claim only if what it negated is missing too (a clause taken out whole: "..., though its impact was not quantified"). The
 * words after it (four letters or more, by their first four letters; the next five of them) must not be in the shorter claim; otherwise the claim was turned the other way.
 */
const negatedStays = (original: string, rewrite: string): boolean => {
  const ot = tokens(original);
  const rs = new Set(tokens(rewrite).filter((w) => w.length >= 4).map((w) => w.slice(0, 4)));
  return ot.some((t, i) => {
    if (!NEGATIONS.has(t)) return false;
    // what the negation is about: the words after it that the claim does not already have before it ("it helped adults, and did not help children": children)
    const before = new Set(ot.slice(0, i).filter((w) => w.length >= 4).map((w) => w.slice(0, 4)));
    return ot.slice(i + 1, i + 8).filter((w) => w.length >= 4 && !before.has(w.slice(0, 4))).slice(0, 5).some((w) => rs.has(w.slice(0, 4)));
  });
};
const hedgesIn = (s: string): string[] => {
  const t = tokens(s);
  return HEDGES.filter((h) => t.some((w) => w === h || (h.length >= 4 && w.startsWith(h))));
};
const scriptOf = (s: string): "devanagari" | "latin" | "other" => {
  const dev = (s.match(/[ऀ-ॿ]/g) ?? []).length;
  const lat = (s.match(/[A-Za-z]/g) ?? []).length;
  return dev > lat ? "devanagari" : lat > 0 ? "latin" : "other";
};
const numbersIn = (s: string): string[] => (s.normalize("NFKC").replace(/[−–—]/g, "-").replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []);

const known = (word: string, allowed: ReadonlySet<string>, prefixes: ReadonlySet<string>): boolean => allowed.has(word) || (word.length >= 5 && prefixes.has(word.slice(0, 5)));

/**
 * Is `rewrite` a claim that says no more than `original` and its supporting `sentences`? `original` is the claim without its marks. Never throws.
 */
export function checkRewrite(original: string, rewrite: string, sentences: readonly string[]): RewriteCheck {
  const r = rewrite.replace(/\s+/g, " ").trim();
  if (!r || !original) return { ok: false, reason: "empty" };
  if (/[[\]]/.test(r)) return { ok: false, reason: "brackets" };
  const o = original.replace(/\s+/g, " ").trim();
  const ot = tokens(o);
  const rt = tokens(r);
  if (rt.join(" ") === ot.join(" ")) return { ok: false, reason: "same" };
  if (scriptOf(r) !== scriptOf(o)) return { ok: false, reason: "script" };
  const evidence = sentences.join(" ");
  const allowed = new Set([...ot, ...tokens(evidence)]);
  const prefixes = new Set([...allowed].filter((w) => w.length >= 5).map((w) => w.slice(0, 5)));
  const latin = scriptOf(o) === "latin";
  // nothing new: a word of three letters or more (four or more outside the Latin script) that neither the claim nor its sentences have
  for (const w of rt) {
    if (/\d/.test(w)) continue; // numbers have their own rule
    if (w.length < (latin ? 3 : 4) || FREE.has(w) || known(w, allowed, prefixes)) continue;
    return { ok: false, reason: "words", detail: w };
  }
  // numbers: each one is written as it is in the claim or in a sentence
  const have = new Set([...numbersIn(o), ...numbersIn(evidence)]);
  for (const n of numbersIn(r)) if (!have.has(n)) return { ok: false, reason: "numbers", detail: n };
  // a negation is not added, and one of the claim is not lost while what it negated stays; the claim's hedges are kept
  const on = negations(o);
  const rn = negations(r);
  const added = rn.filter((x) => !on.includes(x));
  const lostNeg = on.filter((x) => !rn.includes(x));
  if (added.length > 0 || (lostNeg.length > 0 && negatedStays(o, r))) return { ok: false, reason: "negation", detail: `${on.join(",") || "none"} -> ${rn.join(",") || "none"}` };
  const rh = hedgesIn(r);
  const lostHedges = hedgesIn(o).filter((h) => !rh.includes(h));
  if (lostHedges.length > 0) return { ok: false, reason: "hedge", detail: lostHedges.join(",") };
  // shorter or about as long, and enough of the claim left
  if (rt.length > ot.length * 1.1 + 2 || rt.length < Math.max(3, Math.ceil(ot.length * 0.4))) return { ok: false, reason: "length", detail: `${rt.length} of ${ot.length} words` };
  return { ok: true };
}
