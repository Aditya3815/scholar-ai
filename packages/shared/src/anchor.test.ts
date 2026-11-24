import { describe, expect, it } from "vitest";
import { findQuote, closest, fold, foldSpans, locateInSpans } from "./anchor";

/**
 * The text layer of a page as pdf.js makes it from a TeX paper (packages/test-support/make-hard-pdf.mjs, the owner's report of 21 Nov 2026): every piece in another font or size is a
 * piece of its own ("r" "1", "ˆ" "z" "(k" "−" "1)"), ligatures come as one glyph or as letters, a word is hyphenated across two lines, and a TeX accent is a glyph of its own ("na¨" "ıve").
 * Our own words; no published paper is copied.
 */
const LEFT = [
  "1 Introduction",
  "We study how a model ﬁnds structure in long documents. A",
  "learned code book gives a compact repre-",
  "sentation of each passage, and the ﬂow of",
  "information between levels is made explicit. The eﬀect",
  "of a coarse level on a finer one is easy to read. Unlike a",
  "na¨",
  "ıve baseline, the model keeps every level.",
  "We train with a single objective and report results",
  "on three benchmarks of long scientific text.",
];
const CAPTION = [
  "Figure 4:", " ", "Two-stage training. (a) A multiscale residual",
  "quantiser encodes the input into codes", " ", "r", "1", ",", " ", "…", ",", " ", "r", "K",
  "and reconstructs it. (b) The transformer predicts every",
  "code of level", " ", "k", " ", "at once from the cumulative reconstruction",
  "ˆ", "z", "(k", "−", "1)", ", resized to", " ", "ℓ", " ", "k", " ", "positions. Block-diagonal attention",
  "confines each block to itself, and the loss is a sum over",
  "levels weighted by", " ", "α", "k", " ", "with", " ", "α", "k", " ", "> 0.",
];
const PAGE = [...LEFT, ...CAPTION];
const page = foldSpans(PAGE);
const at = (quote: string, opts = {}) => findQuote(page, quote, opts);
/** The text a part covers, read back from the pieces (what the browser's range would hold). */
const covered = (spans: readonly string[], a: { first: { span: number; start: number }; last: { span: number; end: number } }) => {
  if (a.first.span === a.last.span) return spans[a.first.span]!.slice(a.first.start, a.last.end);
  let s = spans[a.first.span]!.slice(a.first.start);
  for (let i = a.first.span + 1; i < a.last.span; i++) s += spans[i];
  return s + spans[a.last.span]!.slice(0, a.last.end);
};

describe("fold: what a quote and a page are compared as", () => {
  it("ligatures, math letters, accents, spacing accents, hyphens, spaces and punctuation", () => {
    expect(fold("ﬁnds the ﬂow, the eﬀect")).toBe("findstheflowtheeffect");
    expect(fold("𝑧̂ and ℓ𝑘 and r₁ and x²")).toBe("zandlkandr1andx2");
    expect(fold("ˆz(k−1)")).toBe("zk1");
    expect(fold("na¨ıve café café")).toBe("naivecafecafe");
    expect(fold("repre-\nsentation repre­sentation re​pre")).toBe("representationrepresentationrepre");
    expect(fold("Αλφα αλφα")).toBe("αλφααλφα");
  });
});

describe("findQuote: the owner's report — a figure caption with math", () => {
  it("the whole caption as the browser's selection reads it is found exactly, from its first piece to its last", () => {
    // what window.getSelection().toString() gives for the pieces (spaces collapsed, as the reader stores it)
    const sel = CAPTION.join("").replace(/\s+/g, " ");
    const a = at(sel)!;
    expect(a.how).toBe("exact");
    expect(PAGE[a.parts[0]!.first.span]).toBe("Figure 4:");
    expect(PAGE[a.parts[0]!.last.span]).toBe("> 0.");
  });
  it("the quote card's text with its odd glyphs (r1,…,rK, ˆz(k−1), ℓk) is found, and marks exactly that stretch", () => {
    const quote = "rK and reconstructs it. (b) The transformer predicts every code of level k at once from the cumulative reconstruction ˆz(k−1), resized to ℓk positions.";
    const a = at(quote)!;
    expect(a.how).toBe("exact");
    expect(a.parts).toHaveLength(1);
    const text = covered(PAGE, a.parts[0]!);
    expect(text.startsWith("rK")).toBe(true);
    expect(text.endsWith("positions")).toBe(true);
  });
  it("the same with the math written the way a model or a copy writes it (ẑ, ℓ_k, r_1, ..., r_K)", () => {
    expect(at("codes r_1, ..., r_K and reconstructs it")?.how).toBe("exact");
    expect(at("the cumulative reconstruction ẑ^(k-1), resized to ℓ_k positions")?.how).toBe("exact");
  });
  it("the old word matcher lost this caption: the words split by the pieces ('r' '1' against 'r1') broke its run (regression)", () => {
    const sel = CAPTION.join("").replace(/\s+/g, " ");
    expect(locateInSpans(PAGE, sel)).not.toBeNull();
  });
});

describe("findQuote: ligatures, hyphenation, accents, two columns", () => {
  it("a ligature glyph on the page and plain letters in the quote, and the other way round", () => {
    expect(at("how a model finds structure")?.how).toBe("exact");
    expect(at("on a ﬁner one is easy")?.how).toBe("exact");
    expect(at("the flow of information")?.how).toBe("exact");
    expect(at("The effect of a coarse level")?.how).toBe("exact");
  });
  it("a word hyphenated across two lines: the server's text (joined) and a selection (with the hyphen and the line end)", () => {
    const joined = at("learned code book gives a compact representation of each passage")!;
    expect(joined.how).toBe("exact");
    expect(PAGE[joined.parts[0]!.first.span]).toBe(LEFT[2]);
    expect(PAGE[joined.parts[0]!.last.span]).toBe(LEFT[3]);
    expect(at("a compact repre- sentation of each")?.how).toBe("exact");
  });
  it("a TeX accent drawn as its own glyph ('na¨' 'ıve') and an accent in the quote", () => {
    const a = at("Unlike a naïve baseline, the model keeps every level.")!;
    expect(a.how).toBe("exact");
    expect(covered(PAGE, a.parts[0]!).startsWith("Unlike")).toBe(true);
  });
  it("a combining accent after its letter is inside the marked stretch", () => {
    const spans = ["the café was full of readers"];
    const a = findQuote(foldSpans(spans), "the café")!;
    expect(spans[0]!.slice(a.parts[0]!.first.start, a.parts[0]!.last.end)).toBe("the café");
  });
  it("soft hyphens and zero-width characters in the page change nothing", () => {
    expect(findQuote(foldSpans(["a multi­scale resi​dual model of text"]), "a multiscale residual model")?.how).toBe("exact");
  });
  it("a selection from the foot of the left column to the top of the right one (the pieces' order) is one stretch", () => {
    const a = at("on three benchmarks of long scientific text. Figure 4: Two-stage training.")!;
    expect(a.how).toBe("exact");
    expect(PAGE[a.parts[0]!.first.span]).toBe(LEFT[9]);
    expect(PAGE[a.parts[0]!.last.span]).toBe("Two-stage training. (a) A multiscale residual");
  });
  it("gives the exact characters inside a long piece, not the whole line", () => {
    const a = at("model keeps every")!;
    expect(covered(PAGE, a.parts[0]!)).toBe("model keeps every");
  });
  it("a superscript that pdf.js put after its line (out of reading order) is still found, closely", () => {
    const spans = ["the cumulative reconstruction z, resized to the positions of the next level", "(k−1)"];
    const a = findQuote(foldSpans(spans), "the cumulative reconstruction z(k−1), resized to the positions of the next level")!;
    expect(a.how).toBe("close");
    expect(a.parts[0]!.first.span).toBe(0);
  });
});

describe("findQuote: a passage an answer cites", () => {
  it("a quote a model joined with an ellipsis: each piece, in order, one stretch when they are close", () => {
    const a = at("We study how a model finds structure in long documents ... a compact representation of each passage")!;
    expect(a.how).toBe("pieces");
    expect(a.parts).toHaveLength(1);
    expect(PAGE[a.parts[0]!.first.span]).toBe(LEFT[1]);
    expect(PAGE[a.parts[0]!.last.span]).toBe(LEFT[3]);
  });
  it("pieces far apart are marked as two stretches, not everything between them", () => {
    const filler = Array.from({ length: 40 }, (_, i) => `filler sentence number ${i} says nothing that matters here.`);
    const spans = ["The first claim is that coarse levels carry the topic.", ...filler, "The second claim is that fine levels carry the wording."];
    const a = findQuote(foldSpans(spans), "coarse levels carry the topic […] fine levels carry the wording")!;
    expect(a.how).toBe("pieces");
    expect(a.parts).toHaveLength(2);
    expect(a.parts[0]!.first.span).toBe(0);
    expect(a.parts[1]!.first.span).toBe(spans.length - 1);
  });
  it("a quote paraphrased slightly (a word changed, one left out) is found closely", () => {
    const a = at("The transformer predicts each code of level k at once from the cumulative reconstruction")!;
    expect(a.how).toBe("close");
    expect(covered(PAGE, a.parts[0]!).startsWith("The transformer")).toBe(true);
    expect(at("We study how the model finds structure in long documents")?.how).toBe("close");
  });
  it("a quote rewritten more freely: the most similar sentence of the page when asked for (a citation), nothing for a highlight", () => {
    const loose = "the loss sums over the levels, weighted by alpha k, and attention keeps each block to itself";
    expect(at(loose)).toBeNull();
    const a = at(loose, { sentence: true })!;
    expect(a.how).toBe("sentence");
    expect(covered(PAGE, a.parts[0]!)).toContain("confines each block to itself");
  });
  it("a selection that ran over onto the next page: the part that is on this page", () => {
    const a = at("We train with a single objective and report results on three benchmarks of long scientific text and the words that are on the following page only")!;
    expect(a.how).toBe("part");
    expect(PAGE[a.parts[0]!.first.span]).toBe(LEFT[8]);
  });
  it("nothing for a quote that is not on the page, a one-word quote, an empty one, or a page with no text", () => {
    expect(at("quantum chromodynamics of the strong interaction at low energies")).toBeNull();
    expect(at("quantum chromodynamics of the strong interaction at low energies", { sentence: true })).toBeNull();
    expect(at("transformer")).toBeNull();
    expect(at("   ")).toBeNull();
    expect(findQuote(foldSpans([]), "anything at all here")).toBeNull();
    expect(findQuote(foldSpans(["", "  "]), "anything at all here")).toBeNull();
  });
  it("text that is there twice: the first place", () => {
    const spans = ["the model is good and", "the model is good"];
    expect(findQuote(foldSpans(spans), "the model is good")!.parts[0]!.first.span).toBe(0);
  });
});

describe("closest: the near-match search", () => {
  /** The textbook table, for comparison: the fewest edits of q against any stretch of hay. */
  const brute = (hay: string, q: string) => {
    let prev = Array.from({ length: q.length + 1 }, (_, i) => i);
    let best = prev[q.length]!;
    for (let j = 1; j <= hay.length; j++) {
      const cur = [0];
      for (let i = 1; i <= q.length; i++) cur[i] = Math.min(prev[i - 1]! + (q[i - 1] === hay[j - 1] ? 0 : 1), prev[i]! + 1, cur[i - 1]! + 1);
      best = Math.min(best, cur[q.length]!);
      prev = cur;
    }
    return best;
  };
  it("finds the same distance as the full table, and its stretch has that distance", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pick = (n: number, abc: string) => Array.from({ length: n }, () => abc[Math.floor(rnd() * abc.length)]).join("");
    for (let t = 0; t < 300; t++) {
      const hay = pick(20 + Math.floor(rnd() * 60), "abcd");
      const q = pick(4 + Math.floor(rnd() * 12), "abcd");
      const k = Math.floor(rnd() * 5);
      const want = brute(hay, q);
      const got = closest(hay, q, k);
      if (want > k) expect(got === null || got.err > k).toBe(true);
      else {
        expect(got?.err).toBe(want);
        expect(brute(hay.slice(got!.from, got!.to), q)).toBeLessThanOrEqual(want);
      }
    }
  });
  it("is quick enough for a dense page and a long quote", () => {
    const words = "model level code block attention residual quantiser coarse fine reconstruction transformer training loss".split(" ");
    let s = 1;
    const text = Array.from({ length: 2500 }, () => words[(s = (s * 48271) % 2147483647) % words.length]).join(" ");
    const quote = "a quote of six hundred letters or so that is nowhere on this page but looks like it, ".repeat(7);
    const t0 = performance.now();
    expect(findQuote(foldSpans([text]), quote, { sentence: true })).toBeNull();
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
