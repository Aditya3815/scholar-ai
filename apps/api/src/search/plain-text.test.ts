import type { Paper } from "@scholar/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryStore, type CacheStore } from "../cache/store";
import { applyDoiChecks } from "./doi-check";
import { searchEnvFrom, type SearchBindings } from "./env";
import { runProvider } from "./index";
import { mergeAndRank } from "./merge";
import { crossref } from "./crossref";
import { normalizeTitle, plainPaper, plainText, stripJats } from "./normalize";
import type { Provider, ProviderPaper, SearchEnv } from "./types";

/**
 * plainText (normalize.ts): what a provider sends as a title, venue, author or abstract, made into the text a person reads. The strings below are real ones (r3-trace.txt, 3 Nov 2026), or built from
 * code points where a character does not survive being typed. The idempotence checks run over every title, venue and author of the provider lists saved by the probes (eval/probe-strings.json.gz) and
 * over every Crossref record of the recorded eval fixtures (eval/fixtures.json.gz), offline.
 * The probe fixture is frozen: the 3 Nov 2026 probe files it was cut from were session-local and nothing in the repository rebuilds it. To add strings, add them to the arrays of the same shape in the file
 * (a JSON object of "title", "venue", "author" and "abstract" lists, gzipped); do not regenerate it from a live search.
 */

const cp = (...n: number[]) => String.fromCodePoint(...n);
const ZWSP = cp(0x200b), ZWNJ = cp(0x200c), ZWJ = cp(0x200d), LRM = cp(0x200e), RLM = cp(0x200f), RLO = cp(0x202e), PDF = cp(0x202c), RLI = cp(0x2067), PDI = cp(0x2069);
const WJ = cp(0x2060), BOM = cp(0xfeff), LS = cp(0x2028), PS = cp(0x2029), NEL = cp(0x85), NBSP = cp(0xa0), THIN = cp(0x2009), NUL = cp(0);
const TAB5 = "\t".repeat(5);

/** The title Crossref sends for 10.4135/9781506380674.n9 (a newline and five tab characters inside it). */
const TAB_TITLE = "You Get More Excited About\n" + TAB5 + "Data When . . . You Can Do Something About It";
const VENUE = "Chemical &amp; Engineering News Archive";

describe("plainText: the real strings", () => {
  it("decodes the entity of a Crossref venue", () => {
    expect(plainText(VENUE)).toBe("Chemical & Engineering News Archive");
  });

  it("makes the newline and five tabs of a Crossref title one space", () => {
    expect(plainText(TAB_TITLE)).toBe("You Get More Excited About Data When . . . You Can Do Something About It");
  });

  it("decodes &amp;amp; (Crossref escapes twice) in two passes, and no further", () => {
    expect(plainText("R&amp;amp;D")).toBe("R&D");
    expect(plainText("&amp;amp;")).toBe("&");
    expect(plainText("&amp;amp;amp;")).toBe("&amp;");
    expect(plainText("&amp;lt;b&amp;gt;")).toBe("<b>");
  });

  it("turns the numeric carriage return of an abstract into a space", () => {
    expect(plainText("shorten life expectancy. &#x0D; Methods This paper")).toBe("shorten life expectancy. Methods This paper");
    expect(plainText("one&#13;two")).toBe("one two");
    expect(plainText("one&#x0D;&#x0A;two&#9;three")).toBe("one two three");
  });

  it("keeps a real '<' in a title, and does not strip tags after decoding", () => {
    expect(plainText("Why p < 0.05 is not enough: a<b and c>d")).toBe("Why p < 0.05 is not enough: a<b and c>d");
    expect(plainText("Liraglutide for Children 6 to &lt;12 Years of Age with Obesity")).toBe("Liraglutide for Children 6 to <12 Years of Age with Obesity");
    expect(plainText("&lt;b&gt;bold&lt;/b&gt;", { tags: true })).toBe("<b>bold</b>");
    expect(plainText("NSCLC (&lt;1%) and Anisotropy &gt;1 MHz", { tags: true })).toBe("NSCLC (<1%) and Anisotropy >1 MHz");
  });

  it("strips tags only when asked to (an abstract), before decoding", () => {
    const jats = "<jats:title>Abstract</jats:title><jats:p>Dose &lt;5 mg of <jats:italic>E. coli</jats:italic> and R&amp;amp;D &#x0D;</jats:p>";
    expect(plainText(jats, { tags: true })).toBe("Abstract Dose <5 mg of E. coli and R&D");
    expect(plainText("TiO<sub>2</sub> sol-gel")).toBe("TiO<sub>2</sub> sol-gel"); // the plan: a title is not stripped
    expect(plainText("a <!-- x > y --> b", { tags: true })).toBe("a y --> b"); // a comment ends at its first ">", as before
    expect(plainText("p <0.05 and q< 3 and 2 > 1", { tags: true })).toBe("p <0.05 and q< 3 and 2 > 1"); // a "<" that does not start a tag is text
    expect(plainText("no closing <i never ends", { tags: true })).toBe("no closing <i never ends");
  });

  it("strips tags once, never after decoding: a decoded tag is text on purpose, so a second look with tags would take it away and the search's look (no tags) does not", () => {
    expect(plainText("&lt;script&gt;alert(1)&lt;/script&gt;", { tags: true })).toBe("<script>alert(1)</script>");
    expect(plainText("&lt;b&gt;x", { tags: true })).toBe("<b>x");
    expect(plainText("<b>x", { tags: true })).toBe("x");
    expect(plainText(plainText("&lt;b&gt;x", { tags: true }), { tags: true })).toBe("x"); // not idempotent with tags, which is why nothing calls it twice with tags
    expect(plainText("<" + ZWSP + "b>x", { tags: true })).toBe("<b>x"); // a zero-width character that went out made the tag, after the tags had been looked for
    for (const s of ["&lt;b&gt;x", "<" + ZWSP + "b>x", "<jats:p>&lt;i&gt;n&lt;/i&gt; &amp;lt;5</jats:p>"]) {
      const abstract = plainText(s, { tags: true }); // an abstract: stripJats, then the search's own look
      expect(plainText(abstract)).toBe(abstract);
    }
  });

  it("keeps Devanagari with ZWJ and ZWNJ (Hindi and Persian need them)", () => {
    const ksha = cp(0x915, 0x94d, 0x200d, 0x937); // KA, VIRAMA, ZWJ, SSA: the half form
    const mi = cp(0x645, 0x6cc, 0x200c, 0x634, 0x648, 0x62f);
    expect(plainText(ksha)).toBe(ksha);
    expect(plainText(mi)).toBe(mi);
    expect(plainText(`  ${ksha}\n${ZWNJ}${mi} `)).toBe(`${ksha} ${ZWNJ}${mi}`);
    expect(plainText(cp(0x1f469, 0x200d, 0x1f52c))).toBe(cp(0x1f469, 0x200d, 0x1f52c)); // woman scientist: an emoji sequence joined by ZWJ
  });

  it("removes direction and zero-width characters", () => {
    expect(plainText(`a${RLO}b${PDF}c${LRM}d${RLM}e${RLI}f${PDI}g`)).toBe("abcdefg");
    expect(plainText(`zero${ZWSP}width${WJ}${BOM}word`)).toBe("zerowidthword");
    expect(plainText(`${BOM}Title`)).toBe("Title");
    expect(plainText(`&am${ZWSP}p;`)).toBe("&"); // an entity written across a zero-width character is the entity
    expect(plainText("&am&#x200B;p;")).toBe("&"); // ... and so is one a decoded zero-width character breaks
    expect(plainText("a&#x202E;b")).toBe("ab");
  });

  it("makes control characters, U+2028 and U+2029 a space, and collapses white space", () => {
    expect(plainText("a" + LS + "b" + PS + "c" + NEL + "d" + NUL + "e" + cp(0x0b) + "f")).toBe("a b c d e f");
    expect(plainText(`  a${NBSP}${NBSP}b${THIN}c\t\t\nd  `)).toBe("a b c d");
    expect(plainText(`x${cp(0x7f)}y${cp(0x9c)}z`)).toBe("x y z");
  });

  it("keeps surrogate pairs and combining marks, and composes to NFC", () => {
    const x = "x" + cp(0x301); // no precomposed form: the mark must stay
    expect(plainText(x)).toBe(x);
    expect(plainText("a" + cp(0x1f600) + "b")).toBe("a" + cp(0x1f600) + "b");
    expect(plainText("e" + cp(0x301))).toBe(cp(0xe9));
    expect(plainText(cp(0x915, 0x93e, 0x947))).toBe(cp(0x915, 0x93e, 0x947));
    expect(plainText("&#x1F600;")).toBe(cp(0x1f600));
  });

  it("decodes the fixed set of named and numeric entities, and nothing else", () => {
    expect(plainText("&nbsp;a&ensp;b&thinsp;c")).toBe("a b c");
    expect(plainText("Jos&eacute; M&uuml;ller &ndash; the &ldquo;best&rdquo;&hellip; &alpha;-&beta; &yuml;&szlig;")).toBe("Jos" + cp(0xe9) + " M" + cp(0xfc) + "ller " + cp(0x2013) + " the " + cp(0x201c) + "best" + cp(0x201d) + cp(0x2026) + " " + cp(0x3b1) + "-" + cp(0x3b2) + " " + cp(0xff) + cp(0xdf));
    expect(plainText("&#8217;&#x2019;&#x2013;&#x26;&#38;&#x0026;")).toBe(cp(0x2019, 0x2019, 0x2013) + "&&&");
    for (const kept of ["&NA;", "&bogus;", "&toString;", "&valueOf;", "&amp", "&#;", "&#x;", "&#xD800;", "&#xDFFF;", "&#x110000;", "&#99999999;", "AT&T and R&D", "&amp ;", "& amp;"]) expect(plainText(kept)).toBe(kept);
    expect(plainText("a&#0;b")).toBe("a b"); // NUL is a control character
  });

  it("composes NFC without ever making a string longer, except where Unicode excludes a letter from composing", () => {
    const qa = cp(0x958); // DEVANAGARI QA: canonically two characters (KA and NUKTA), never composed
    expect(plainText(qa)).toBe(cp(0x915, 0x93c));
    expect(plainText(qa)).toBe(qa.normalize("NFC"));
  });
});

/** Every name plainText decodes, with its code point as Python's html.entities.html5 gives it: an independent table, because the one in normalize.ts is built from lists and offsets. */
const ENTITY_REFERENCE = `
Aacute:c1 aacute:e1 Acirc:c2 acirc:e2 acute:b4 AElig:c6 aelig:e6 Agrave:c0 agrave:e0 Alpha:391 alpha:3b1 amp:26 apos:27 Aring:c5 aring:e5 ast:2a asymp:2248 Atilde:c3
atilde:e3 Auml:c4 auml:e4 bdquo:201e Beta:392 beta:3b2 brvbar:a6 bull:2022 Ccedil:c7 ccedil:e7 cedil:b8 cent:a2 Chi:3a7 chi:3c7 circ:2c6 copy:a9 curren:a4 Dagger:2021
dagger:2020 darr:2193 deg:b0 Delta:394 delta:3b4 divide:f7 Eacute:c9 eacute:e9 Ecirc:ca ecirc:ea Egrave:c8 egrave:e8 emsp:2003 ensp:2002 Epsilon:395 epsilon:3b5
equiv:2261 Eta:397 eta:3b7 ETH:d0 eth:f0 Euml:cb euml:eb euro:20ac fnof:192 frac12:bd frac14:bc frac34:be Gamma:393 gamma:3b3 ge:2265 gt:3e harr:2194 hellip:2026
Iacute:cd iacute:ed Icirc:ce icirc:ee iexcl:a1 Igrave:cc igrave:ec infin:221e int:222b Iota:399 iota:3b9 iquest:bf isin:2208 Iuml:cf iuml:ef Kappa:39a kappa:3ba
Lambda:39b lambda:3bb laquo:ab larr:2190 ldquo:201c le:2264 lowast:2217 lrm:200e lsaquo:2039 lsquo:2018 lt:3c macr:af mdash:2014 micro:b5 middot:b7 minus:2212 Mu:39c
mu:3bc nabla:2207 nbsp:a0 ndash:2013 ne:2260 not:ac Ntilde:d1 ntilde:f1 Nu:39d nu:3bd Oacute:d3 oacute:f3 Ocirc:d4 ocirc:f4 OElig:152 oelig:153 Ograve:d2 ograve:f2
Omega:3a9 omega:3c9 Omicron:39f omicron:3bf ordf:aa ordm:ba Oslash:d8 oslash:f8 Otilde:d5 otilde:f5 Ouml:d6 ouml:f6 para:b6 part:2202 permil:2030 Phi:3a6 phi:3c6 Pi:3a0
pi:3c0 plusmn:b1 pound:a3 Prime:2033 prime:2032 prop:221d Psi:3a8 psi:3c8 quot:22 radic:221a raquo:bb rarr:2192 rdquo:201d reg:ae Rho:3a1 rho:3c1 rlm:200f rsaquo:203a
rsquo:2019 sbquo:201a Scaron:160 scaron:161 sect:a7 shy:ad Sigma:3a3 sigma:3c3 sigmaf:3c2 sim:223c sum:2211 sup1:b9 sup2:b2 sup3:b3 szlig:df Tau:3a4 tau:3c4 there4:2234
Theta:398 theta:3b8 thinsp:2009 THORN:de thorn:fe tilde:2dc times:d7 trade:2122 Uacute:da uacute:fa uarr:2191 Ucirc:db ucirc:fb Ugrave:d9 ugrave:f9 uml:a8 Upsilon:3a5
upsilon:3c5 Uuml:dc uuml:fc Xi:39e xi:3be Yacute:dd yacute:fd yen:a5 Yuml:178 yuml:ff Zeta:396 zeta:3b6 zwj:200d zwnj:200c
`;

describe("plainText: the entity table", () => {
  const table = ENTITY_REFERENCE.split(/\s+/).filter(Boolean).map((e) => [e.split(":")[0]!, parseInt(e.split(":")[1]!, 16)] as const);

  it("has every name of the reference with the code point the reference gives it (a wrong offset in a list fails here, name by name)", () => {
    expect(table).toHaveLength(207);
    // compared with the character itself, so a name for a space or an invisible character is held to the same cleaning
    expect(table.filter(([name, code]) => plainText(`x&${name};y`) !== plainText(`x${cp(code)}y`)).map(([name]) => name)).toEqual([]);
    expect(table.filter(([name]) => plainText(`x&${name};y`) === `x&${name};y`)).toEqual([]);
  });

  it("decodes the letters of Latin Extended-A that HTML 4 names (Czech, Croatian, Turkish and French names), and zwj, zwnj, lrm and rlm", () => {
    expect(plainText("&Scaron;ime and Hr&aacute;&scaron;")).toBe(cp(0x160) + "ime and Hr" + cp(0xe1, 0x161));
    expect(plainText("C&oelig;ur &OElig; &Yuml; &fnof; &circ; &tilde;")).toBe("C" + cp(0x153) + "ur " + cp(0x152, 0x20, 0x178, 0x20, 0x192, 0x20, 0x2c6, 0x20, 0x2dc));
    expect(plainText("a&zwj;b&zwnj;c")).toBe("a" + ZWJ + "b" + ZWNJ + "c"); // kept, as the characters themselves are
    expect(plainText("a&lrm;b&rlm;c")).toBe("abc"); // direction marks go, as the characters themselves do
  });

  it("decodes a name only as it is spelt (case counts), and leaves a name it does not know", () => {
    for (const kept of ["&EACUTE;", "&Amp;", "&nbsp", "&Alpha ;", "&OELIG;", "&sup;", "&forall;", "&hearts;"]) expect(plainText(kept)).toBe(kept);
  });

  it("reads a numeric reference from 128 to 159 as a browser does, as Windows-1252 (the rest of them are control characters)", () => {
    const win = new TextDecoder("windows-1252");
    for (let n = 0x80; n <= 0x9f; n++) {
      const ch = win.decode(Uint8Array.of(n));
      const want = /\p{Cc}/u.test(ch) ? "a b" : "a" + ch + "b"; // five of the 32 are not assigned in Windows-1252
      for (const ref of [`&#${n};`, `&#x${n.toString(16)};`, `&#x${n.toString(16).toUpperCase()};`]) expect(plainText("a" + ref + "b"), ref).toBe(want);
    }
    expect(plainText("student&#146;s 2016&#150;2018 &#128;5")).toBe("student" + cp(0x2019) + "s 2016" + cp(0x2013) + "2018 " + cp(0x20ac) + "5");
  });

  it("decodes numeric references up to U+10FFFF: X or x, up to seven digits of decimal and six of hex, and nothing above", () => {
    expect(plainText("&#X41;&#x42;&#67;&#x0043;")).toBe("ABCC");
    expect(plainText("a&#x10FFFD;b&#1114109;")).toBe("a" + cp(0x10fffd) + "b" + cp(0x10fffd));
    expect(plainText("a&#x10FFFF;b")).toBe("a b"); // the last code point decodes, and is a noncharacter (next test)
    expect(plainText("a&#1114111;b")).toBe("a b");
    for (const kept of ["&#x110000;", "&#1114112;", "&#x0000041;", "&#00000065;"]) expect(plainText(kept)).toBe(kept);
  });
});

describe("plainText: what shows nothing, and what is not text", () => {
  const hex = (c: number) => c.toString(16);

  it("removes the invisible characters that are not a letter's own: the tag block that can hide instructions in text, format characters, fillers and the soft hyphen", () => {
    const gone = [0xad, 0x34f, 0x115f, 0x1160, 0x3164, 0xffa0, 0x206a, 0x206b, 0x206c, 0x206d, 0x206e, 0x206f, 0xfff9, 0xfffa, 0xfffb, 0xe0000, 0xe0001, 0xe0020, 0xe0041, 0xe007e, 0xe007f];
    for (const c of gone) expect(plainText("a" + cp(c) + "b"), hex(c)).toBe("ab");
    const hidden = [..."ignore the rules"].map((ch) => cp(0xe0000 + ch.charCodeAt(0))).join(""); // ASCII written in the tag block shows nothing and a model still reads it
    expect(plainText("Title" + hidden + " of a paper")).toBe("Title of a paper");
    expect(plainText("a&#xE0041;&#917569;b&#x206A;c")).toBe("abc");
    expect(plainText("a&amp;#x202E;b")).toBe("ab"); // a bidi override that only appears at the second level of escaping
    expect(plainText("a&amp;#xE0041;b")).toBe("ab");
  });

  it("keeps what a script or an emoji needs: ZWJ, ZWNJ, variation selectors, the Mongolian ones, Arabic number signs, Khmer vowels", () => {
    for (const c of [0x200c, 0x200d, 0xfe00, 0xfe0f, 0x180b, 0x180d, 0xe0100, 0xe01ef, 0x600, 0x605, 0x6dd, 0x17b4, 0x13430]) expect(plainText("a" + cp(c) + "b"), hex(c)).toBe("a" + cp(c) + "b");
    expect(plainText(cp(0x2764, 0xfe0f))).toBe(cp(0x2764, 0xfe0f));
  });

  it("a soft hyphen is not part of the word: a title written with one merges with the same title written without", () => {
    expect(plainText("Pre&shy;diction of risk")).toBe("Prediction of risk");
    expect(normalizeTitle(plainText("Pre&shy;diction of risk"))).toBe(normalizeTitle("Prediction of risk"));
    expect(normalizeTitle(plainText("Pre" + cp(0xad) + "diction of risk"))).toBe("prediction of risk");
  });

  it("makes a noncharacter, written or as a reference, a space; and a lone surrogate too, while a pair stays", () => {
    for (const c of [0xfdd0, 0xfdef, 0xfffe, 0xffff, 0x1fffe, 0x1ffff, 0x10fffe, 0x10ffff]) {
      expect(plainText("a" + cp(c) + "b"), hex(c)).toBe("a b");
      expect(plainText(`a&#x${hex(c)};b`), "reference " + hex(c)).toBe("a b");
    }
    const hi = String.fromCharCode(0xd83d), lo = String.fromCharCode(0xde00); // the two halves of U+1F600
    expect(plainText("a" + hi + "b")).toBe("a b");
    expect(plainText("a" + lo + "b")).toBe("a b");
    expect(plainText("a" + lo + hi + "b")).toBe("a b");
    expect(plainText("a" + hi)).toBe("a");
    expect(plainText("a" + hi + lo + "b")).toBe("a" + cp(0x1f600) + "b");
    for (const s of ["a" + hi + "b", "a" + lo + hi + "b", "a&#xFFFF;b"]) expect(() => encodeURIComponent(plainText(s))).not.toThrow(); // it throws on a lone surrogate: nothing a later TextEncoder or JSON.stringify would have to repair
  });
});

describe("plainText: marks, and the one thing NFC cannot be trusted with", () => {
  const M = cp(0x301), D = cp(0x323);

  it("keeps at most 30 combining marks in a row (the Stream-Safe Text Format of UAX #15), counted after what goes out is gone and after references are decoded", () => {
    expect(plainText("a" + M.repeat(100))).toBe(("a" + M.repeat(30)).normalize("NFC"));
    expect(plainText("a" + (M + ZWSP).repeat(100))).toBe(("a" + M.repeat(30)).normalize("NFC"));
    expect(plainText("a" + "&#x301;".repeat(100))).toBe(("a" + M.repeat(30)).normalize("NFC"));
    expect(plainText("a" + (M + D).repeat(50))).toBe(("a" + (M + D).repeat(15)).normalize("NFC")); // marks that NFC reorders
    const z = plainText("a" + M.repeat(31) + " b" + M.repeat(31));
    expect(z).toBe(("a" + M.repeat(30) + " b" + M.repeat(30)).normalize("NFC")); // each run on its own
    expect(plainText(z)).toBe(z);
  });

  it("does not touch a run that is real: thirty marks, Devanagari with its vowel signs, nukta and virama, Thai with tone marks, Zalgo of a few marks", () => {
    expect(plainText("a" + M.repeat(30))).toBe(("a" + M.repeat(30)).normalize("NFC"));
    const hindi = cp(0x915, 0x93c, 0x94d, 0x937, 0x93f, 0x902, 0x20, 0x92a, 0x94d, 0x930, 0x94d, 0x93e, 0x901);
    expect(plainText(hindi)).toBe(hindi.normalize("NFC"));
    const thai = cp(0xe01, 0xe49, 0xe32, 0x20, 0xe21, 0xe48, 0xe32, 0xe31, 0xe48);
    expect(plainText(thai)).toBe(thai);
    const zalgo = "H" + cp(0x300, 0x301, 0x302, 0x303, 0x304, 0x305, 0x306, 0x307, 0x308, 0x309, 0x30a, 0x30b, 0x30c, 0x30d, 0x30e, 0x30f);
    expect(plainText(zalgo)).toBe(zalgo.normalize("NFC"));
  });

  it("a title that is all marks costs no more than a normal one once cleaned, in plainText and in normalizeTitle (NFKD, the same quadratic)", () => {
    const t0 = performance.now();
    normalizeTitle(plainText("a" + M.repeat(100_000) + D.repeat(100_000)));
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("plainText: bad input", () => {
  it("never throws on null, undefined or something that is not a string", () => {
    for (const bad of [null, undefined, 0, 12, NaN, true, {}, [], ["a"], () => "x", Symbol("s"), 10n]) expect(plainText(bad as never)).toBe("");
    expect(plainText("", { tags: true })).toBe("");
    expect(plainText("   ")).toBe("");
    expect(plainText(null, { tags: true })).toBe("");
  });

  it("is not longer than its input (the one exception is NFC, checked above)", () => {
    const strings = ["", "a", "&amp;", "&#1;", "<a>", "<a b='c'>", "&#x1F600;", "&amp;amp;amp;", "x" + cp(0x301), TAB_TITLE, VENUE, "\n\n\n", ZWSP + ZWSP, "&#x0D;"];
    for (const s of strings) for (const tags of [false, true]) expect(plainText(s, { tags }).length).toBeLessThanOrEqual(s.length);
  });

  it("answers a 1 MB hostile input in linear time (no backtracking)", () => {
    // A scan that is quadratic on 1 MB runs for hours, and a test that never returns tells nobody what broke: so every input is first timed at 25,000 and at 100,000 characters (linear takes four times as long, quadratic sixteen).
    const hostile: [string, (n: number) => string][] = [
      ["open angle brackets", (n) => "<".repeat(n)],
      ["tag starts that never close", (n) => "<a".repeat(n / 2)],
      ["one huge tag", (n) => "<a" + "x".repeat(n) + ">"],
      ["a tag start before every letter, one close at the end", (n) => "a<b".repeat(n / 3) + ">"],
      ["a letter and a space, then a tag start", (n) => ("a " + "<").repeat(n / 3)],
      ["ampersands", (n) => "&".repeat(n)],
      ["entities", (n) => "&amp;".repeat(n / 5)],
      ["numeric entity starts", (n) => "&#".repeat(n / 2)],
      ["hex entity starts", (n) => "&#x".repeat(n / 3)],
      ["long entity names", (n) => ("&" + "a".repeat(100)).repeat(n / 101)],
      ["one long entity name", (n) => "&" + "a".repeat(n)],
      ["newlines", (n) => cp(10).repeat(n)],
      ["alternating white space", (n) => (" " + cp(9)).repeat(n / 2)],
      ["zero-width characters", (n) => ZWSP.repeat(n)],
      ["direction characters", (n) => RLO.repeat(n)],
      ["combining marks", (n) => "e" + cp(0x301).repeat(n)],
      // NFC reorders marks into canonical order, and V8's String.normalize is quadratic on a run that has to be reordered: the marks above are already in order and cost nothing
      ["combining marks that alternate and must be reordered", (n) => "a" + cp(0x301, 0x323).repeat(n / 2)],
      ["combining marks in descending order", (n) => "a" + cp(0x301).repeat(n / 2) + cp(0x323).repeat(n / 2)],
      ["reordered marks with a zero-width character between each pair", (n) => "a" + (cp(0x301) + ZWSP + cp(0x323) + ZWSP).repeat(n / 4)],
      ["reordered marks written as references", (n) => "a" + "&#x301;&#x323;".repeat(n / 14)],
      ["reordered marks at the second level of escaping", (n) => "a" + "&amp;#x301;&amp;#x323;".repeat(n / 22)],
      ["marks that decompose into two", (n) => "a" + cp(0x344).repeat(n / 2) + cp(0x323).repeat(n / 2)],
    ];
    const run = (text: string, tags: boolean) => {
      const t0 = performance.now();
      const out = plainText(text, { tags });
      return { ms: performance.now() - t0, out };
    };
    for (const [name, make] of hostile) {
      for (const tags of [false, true]) {
        const small = run(make(25_000), tags).ms;
        const big = run(make(100_000), tags).ms;
        expect(big, `${name} (tags ${tags}): ${small.toFixed(1)} ms for 25,000 characters, ${big.toFixed(1)} ms for 100,000`).toBeLessThan(Math.max(100, 8 * small));
      }
    }
    for (const [name, make] of hostile) {
      const text = make(1_000_000);
      for (const tags of [false, true]) {
        const { ms, out } = run(text, tags);
        expect(ms, `${name} (tags ${tags}) took ${Math.round(ms)} ms`).toBeLessThan(1500);
        expect(out.length).toBeLessThanOrEqual(2 * text.length); // not String.normalize(text) as the idempotence tests below do: on these inputs that call is the quadratic one
      }
    }
  }, 120_000);
});

describe("stripJats (calls plainText)", () => {
  it("still gives the abstract of a Crossref JATS string, without its heading", () => {
    expect(stripJats("<jats:title>Abstract</jats:title><jats:p>Text &amp; more</jats:p>")).toBe("Text & more");
    expect(stripJats("<jats:p>Abstract\nBackground: x &lt; y &amp;amp; z</jats:p>")).toBe("Background: x < y & z");
    expect(stripJats("<jats:p>R&amp;amp;D &#x0D; and &#x2019;s</jats:p>")).toBe("R&D and " + cp(0x2019) + "s");
  });
  it("gives null for nothing", () => {
    expect(stripJats(null)).toBeNull();
    expect(stripJats(undefined)).toBeNull();
    expect(stripJats("")).toBeNull();
    expect(stripJats("<jats:p> </jats:p>")).toBeNull();
    expect(stripJats("Abstract")).toBeNull();
  });
});

/* ------------------------- idempotence ------------------------- */

// The Worker type set has no Node types (src/test-node.d.ts shims only what the other tests read), so the two modules this file needs are loaded by a name that is not a literal.
const nodeFs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL): Uint8Array };
const nodeZlib = (await import(/* @vite-ignore */ "node:" + "zlib")) as { gunzipSync(data: Uint8Array): { toString(encoding: "utf8"): string } };
const readGz = (path: string): unknown => JSON.parse(nodeZlib.gunzipSync(nodeFs.readFileSync(new URL(path, import.meta.url))).toString("utf8"));

type Probe = { about: string; title: string[]; venue: string[]; author: string[]; abstract: string[] };
const probe = readGz("../../eval/probe-strings.json.gz") as Probe;

/** Every title, venue and author string of every Crossref record the eval recorded (searches and single lookups). */
function recordedCrossref() {
  const raw = readGz("../../eval/fixtures.json.gz") as Record<string, { b: string }>;
  const title = new Set<string>(), venue = new Set<string>(), author = new Set<string>();
  let records = 0;
  for (const [key, fx] of Object.entries(raw)) {
    if (!key.includes("api.crossref.org/works")) continue;
    let body: { message?: { items?: unknown[]; DOI?: string } };
    try {
      body = JSON.parse(fx.b);
    } catch {
      continue;
    }
    const items = (body.message?.items ?? (body.message?.DOI ? [body.message] : [])) as { title?: string[]; "container-title"?: string[]; author?: { given?: string; family?: string; name?: string }[] }[];
    for (const it of items) {
      records++;
      if (it.title?.[0]) title.add(it.title[0]);
      if (it["container-title"]?.[0]) venue.add(it["container-title"][0]);
      for (const a of it.author ?? []) author.add(a.name ?? [a.given, a.family].filter(Boolean).join(" "));
    }
  }
  return { records, title: [...title], venue: [...venue], author: [...author].filter(Boolean) };
}

const grows = (s: string, out: string) => out.length > Math.max(s.length, s.normalize("NFC").length);

describe("plainText is idempotent", () => {
  it("over every title, venue and author of the saved probe files", () => {
    const all = [...probe.title, ...probe.venue, ...probe.author];
    expect(all.length).toBeGreaterThan(15000); // the fixture is the real thing, not an empty list
    const bad = all.filter((s) => plainText(plainText(s)) !== plainText(s));
    expect(bad.slice(0, 5)).toEqual([]);
    expect(all.filter((s) => grows(s, plainText(s))).slice(0, 5)).toEqual([]);
    // it changed something, or this checks nothing
    expect(all.filter((s) => plainText(s) !== s).length).toBeGreaterThan(50);
  });

  it("over the abstracts of the probe files that held an entity or a control character (cleaned as stripJats does, then as the search does)", () => {
    expect(probe.abstract.length).toBeGreaterThan(50);
    for (const s of probe.abstract) {
      const once = plainText(s, { tags: true });
      expect(plainText(once), s.slice(0, 80)).toBe(once);
      expect(grows(s, once)).toBe(false);
    }
  });

  it("over every Crossref record of the recorded eval fixtures", () => {
    const r = recordedCrossref();
    expect(r.records).toBeGreaterThan(10000);
    const all = [...r.title, ...r.venue, ...r.author];
    const bad = all.filter((s) => plainText(plainText(s)) !== plainText(s));
    expect(bad.slice(0, 5)).toEqual([]);
    expect(all.filter((s) => grows(s, plainText(s))).slice(0, 5)).toEqual([]);
    expect(r.venue.filter((s) => /&amp;/.test(s)).length).toBeGreaterThan(20); // dirt that is really there
    expect(all.filter((s) => /[\t\n\r]/.test(s)).length).toBeGreaterThan(20);
  });

  it("over random strings built from the dirt we know (entities up to two levels deep, tags, control and zero-width characters)", () => {
    const pool = [
      "a", "B" + cp(0xe9), "Hindi", "x y", " ", "  ", "\t", "\n", "\r\n", "&", "<", ">", "p < 0.05", "<i>", "</i>", "<jats:p>", "<br/>",
      "&amp;", "&lt;", "&gt;", "&quot;", "&#39;", "&#x0D;", "&#13;", "&#x26;", "&amp;amp;", "&amp;lt;", "&amp;#x0D;", "&nbsp;", "&eacute;", "&NA;", "&bogus;", "&#xD800;", "&#x1F600;", "&#x200B;", "&#x202E;",
      ZWSP, ZWNJ, ZWJ, RLO, LRM, BOM, LS, NEL, NBSP, THIN, "e" + cp(0x301), cp(0x915, 0x94d, 0x200d, 0x937), cp(0x1f469, 0x200d, 0x1f52c), cp(0x958),
      "&#146;", "&shy;", "&#xFFFF;", "&Scaron;", "&amp;#x202E;", "&amp;#x301;", cp(0xad), cp(0xe0041), cp(0xfffe), cp(0x344), cp(0x323), cp(0x301), String.fromCharCode(0xd83d), String.fromCharCode(0xde00),
    ];
    let seed = 20261104; // mulberry32: the same strings on every run
    const next = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let changed = 0;
    for (let i = 0; i < 6000; i++) {
      const n = 1 + Math.floor(next() * 12);
      let s = "";
      for (let k = 0; k < n; k++) s += pool[Math.floor(next() * pool.length)]!;
      const once = plainText(s);
      expect(plainText(once), JSON.stringify(s)).toBe(once);
      expect(grows(s, once), JSON.stringify(s)).toBe(false);
      const stripped = plainText(s, { tags: true }); // an abstract: stripJats first, then the search's own pass
      expect(plainText(stripped), JSON.stringify(s)).toBe(stripped);
      if (once !== s) changed++;
    }
    expect(changed).toBeGreaterThan(3000);
  });

  it("is idempotent on a run of marks that NFC makes two of (U+0344): the cut is made again after NFC", () => {
    for (const s of ["a" + cp(0x344).repeat(40), "a" + (cp(0x344) + cp(0x323)).repeat(40), cp(0xf73).repeat(40)]) {
      const once = plainText(s);
      expect(plainText(once)).toBe(once);
      expect([...once].filter((c) => /\p{M}/u.test(c)).length).toBeLessThanOrEqual(30);
    }
  });

  it("stops after two levels of escaping, which is the plan's limit (a third level is left for the reader to see)", () => {
    expect(plainText(plainText("&amp;amp;amp;"))).toBe("&"); // one more look decodes the third level: the plan's two passes, applied twice
    expect(plainText("&amp;amp;amp;")).toBe("&amp;");
  });

  it("an abstract is decoded twice by stripJats at the adapter and twice more when the search reads it: four levels, and titles, venues and authors two", () => {
    expect(stripJats("&amp;amp;amp;amp;")).toBe("&amp;amp;");
    expect(plainText(stripJats("&amp;amp;amp;amp;"))).toBe("&");
    expect(plainText("&amp;amp;amp;amp;")).toBe("&amp;amp;");
  });
});

/* ------------------------- runProvider ------------------------- */

const DIRTY: ProviderPaper = {
  doi: "10.4135/9781506380674.n9",
  pmid: null,
  title: TAB_TITLE,
  authors: ["Jos&eacute; Rao", `Smith,${NBSP}J.`, ZWSP, "  "],
  year: 2014,
  venue: VENUE,
  abstract: "Dose &lt;5 mg and R&amp;amp;D &#x0D; when n<m and k>j.",
  citationCount: 3,
  oaUrl: null,
  retracted: false,
  workType: "book-chapter",
  url: null,
};
const CLEAN: ProviderPaper = {
  ...DIRTY,
  title: "You Get More Excited About Data When . . . You Can Do Something About It",
  authors: ["Jos" + cp(0xe9) + " Rao", "Smith, J."],
  venue: "Chemical & Engineering News Archive",
  abstract: "Dose <5 mg and R&D when n<m and k>j.",
};

/** A store that remembers every key it was asked for. */
function spyStore() {
  const inner = memoryStore();
  const keys: string[] = [];
  const store: CacheStore = {
    get: async (k) => (keys.push(k), inner.get(k)),
    set: async (k, v, ttl, source) => (keys.push(k), inner.set(k, v, ttl, source)),
  };
  return { store, inner, keys };
}
const provider = (name: string, list: ProviderPaper[], calls = { n: 0 }): Provider => ({
  name,
  search: async () => {
    calls.n++;
    return structuredClone(list);
  },
});
const envOf = (store: CacheStore, over: Partial<SearchEnv> = {}): SearchEnv => ({ store, CROSSREF_MAILTO: "t@example.org", ...over });

/** The key of "cancer therapy" at Crossref, as it was before plainText existed: written out, so a change of the key fails here. */
const KEY = "search:crossref:96994cc2d3b12eda8667cdea5bb9e634";

describe("runProvider cleans what a provider answered", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("cleans a fresh answer, and keeps the cache key it always had", async () => {
    const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(["cancer therapy", "20"].join(NUL))))].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(KEY).toBe("search:crossref:" + sha.slice(0, 32)); // computed apart from cacheKey: the first 32 hex digits of SHA-256 of the normalised query, a NUL and the page size
    const { store, keys } = spyStore();
    const calls = { n: 0 };
    const r = await runProvider(provider("crossref", [DIRTY], calls), "Cancer  Therapy", envOf(store));
    expect(r.value).toEqual([CLEAN]);
    expect(r.status).toMatchObject({ ok: true, count: 1, cached: false });
    expect(new Set(keys)).toEqual(new Set([KEY]));
  });

  it("cleans an answer that is already in the cache (written before plainText existed), under the same key", async () => {
    const { store, inner, keys } = spyStore();
    await inner.set(KEY, JSON.stringify([DIRTY]), 3600);
    const calls = { n: 0 };
    const r = await runProvider(provider("crossref", [], calls), "cancer therapy", envOf(store));
    expect(calls.n).toBe(0); // it was a hit: the key is the one the old entry was written under
    expect(r.status.cached).toBe(true);
    expect(r.value).toEqual([CLEAN]);
    expect(new Set(keys)).toEqual(new Set([KEY]));
  });

  it("cleans the second read of a fresh answer too, and what is kept is what the adapter returned", async () => {
    const { store, inner } = spyStore();
    const calls = { n: 0 };
    const p = provider("crossref", [DIRTY], calls);
    const first = await runProvider(p, "cancer therapy", envOf(store));
    const second = await runProvider(p, "cancer therapy", envOf(store));
    expect(calls.n).toBe(1);
    expect(second.status.cached).toBe(true);
    expect(second.value).toEqual(first.value);
    expect(second.value).toEqual([CLEAN]);
    expect((JSON.parse((await inner.get(KEY))!) as ProviderPaper[])[0]!.venue).toBe(VENUE); // cleaned on read: turning the switch off needs no cache to be dropped
  });

  it("SEARCH_PLAINTEXT=off gives back the title, venue, authors and abstract the adapter returned, fresh and cached", async () => {
    const { store } = spyStore();
    const p = provider("crossref", [DIRTY]);
    const fresh = await runProvider(p, "cancer therapy", envOf(store, { SEARCH_PLAINTEXT: "off" }));
    expect(fresh.value).toEqual([DIRTY]);
    const cachedRead = await runProvider(p, "cancer therapy", envOf(store, { SEARCH_PLAINTEXT: "off" }));
    expect(cachedRead.status.cached).toBe(true);
    expect(cachedRead.value).toEqual([DIRTY]);
    const back = await runProvider(p, "cancer therapy", envOf(store)); // the switch off, then unset: the same cache gives the cleaned text
    expect(back.value).toEqual([CLEAN]);
    const other = await runProvider(p, "cancer therapy", envOf(store, { SEARCH_PLAINTEXT: "on" })); // only the word "off" is the switch
    expect(other.value).toEqual([CLEAN]);
  });

  it("does not strip what looks like a tag from an abstract it reads (tags went out in the adapter, before the text was decoded)", async () => {
    const r = await runProvider(provider("crossref", [{ ...DIRTY, abstract: "when n<m and k>j then x &lt;b and c&gt; d" }]), "q", envOf(memoryStore()));
    expect(r.value[0]!.abstract).toBe("when n<m and k>j then x <b and c> d");
  });

  it("keeps null as null, makes an empty text null, leaves the other fields, and does not touch the list it was given", async () => {
    const given: ProviderPaper = { ...DIRTY, venue: null, abstract: `${ZWSP}${NBSP}`, authors: [], doi: null, workType: undefined };
    const copy = structuredClone(given);
    const out = plainPaper(given);
    expect(out).toMatchObject({ venue: null, abstract: null, authors: [], doi: null, year: 2014, citationCount: 3, retracted: false, pmid: null, oaUrl: null });
    expect(given).toEqual(copy);
    expect(plainPaper({ ...DIRTY, venue: "" }).venue).toBeNull();
    expect(plainPaper({ ...DIRTY, workType: "book-chapter", url: "https://example.org/a" })).toMatchObject({ workType: "book-chapter", url: "https://example.org/a" });
  });

  it("answers a cached entry of the wrong shape without throwing", async () => {
    const { store, inner } = spyStore();
    await inner.set(KEY, JSON.stringify([{ title: "T", authors: "x", venue: 7, abstract: {} }]), 3600);
    const r = await runProvider(provider("crossref", []), "cancer therapy", envOf(store));
    expect(r.value[0]).toMatchObject({ title: "T", authors: [], venue: null, abstract: null });
  });

  it("skips what is not a record in a cached list (null, a number, a string), and reads a cached value that is not a list as no papers", async () => {
    const { store, inner } = spyStore();
    await inner.set(KEY, JSON.stringify([null, DIRTY, 5, "x", true]), 3600);
    const r = await runProvider(provider("crossref", []), "cancer therapy", envOf(store));
    expect(r.value).toEqual([CLEAN]);
    expect(r.status).toMatchObject({ ok: true, count: 1, cached: true });
    for (const stored of [{}, "text", 5, null, true, { length: 3 }]) {
      const s = spyStore();
      await s.inner.set(KEY, JSON.stringify(stored), 3600);
      const got = await runProvider(provider("crossref", [DIRTY]), "cancer therapy", envOf(s.store));
      expect(got.value, JSON.stringify(stored)).toEqual([]);
      expect(got.status).toMatchObject({ ok: true, count: 0, cached: true });
    }
  });

  it("drops a record whose title is nothing once cleaned (every adapter drops an empty title), and counts what it returns; with the switch off it keeps what came", async () => {
    const list: ProviderPaper[] = [{ ...DIRTY, title: "  &nbsp; " }, { ...DIRTY, title: ZWSP }, DIRTY, { ...DIRTY, title: "&#xFFFF;", doi: null }, { ...DIRTY, title: "&amp;" }];
    const r = await runProvider(provider("crossref", list), "cancer therapy", envOf(memoryStore()));
    expect(r.value.map((p) => p.title)).toEqual([CLEAN.title, "&"]);
    expect(r.status).toMatchObject({ ok: true, count: 2 });
    const off = await runProvider(provider("crossref", list), "cancer therapy", envOf(memoryStore(), { SEARCH_PLAINTEXT: "off" }));
    expect(off.value).toHaveLength(5);
    expect(off.status.count).toBe(5);
  });
});

describe("SEARCH_PLAINTEXT reaches the search through searchEnvFrom", () => {
  const bindings = (over: Partial<SearchBindings> = {}): SearchBindings => ({ DB: {} as D1Database, S2_THROTTLE: {} as SearchBindings["S2_THROTTLE"], CROSSREF_MAILTO: "t@example.org", ...over });
  it("reads it once, from the bindings", () => {
    expect(searchEnvFrom(bindings({ SEARCH_PLAINTEXT: "off" })).SEARCH_PLAINTEXT).toBe("off");
    expect(searchEnvFrom(bindings()).SEARCH_PLAINTEXT).toBeUndefined();
  });
});

/* ------------------------- the DOI check reads the same text ------------------------- */

const paperOf = (title: string, doi = "10.1234/x"): Paper => ({
  id: `doi:${doi}`, doi, pmid: null, title, authors: ["A. One"], year: 2020, venue: "J", abstract: null, citationCount: 1, oaUrl: null,
  retracted: false, retractionSources: [], sources: ["crossref"], score: 0.1,
});

describe("applyDoiChecks compares a title that is plain text with the one Crossref registered", () => {
  // Crossref's batch answer (and the 7-day cache of it) holds the title as Crossref sent it, entities and all; the record it is compared with has been through plainText
  const raws = ["Gl&uuml;ck", "Caf&eacute; Society", "Schr&#246;dinger Equation", "Se&ntilde;or &Uuml;ber", "Na&iuml;ve Bayes", "Tom &amp; Jerry in Medicine", "The   Spaced" + cp(10, 9) + "Title &amp;amp; More"];
  it.each(raws)("keeps the DOI of %s", (raw) => {
    const p = paperOf(plainText(raw));
    expect(applyDoiChecks([p], { "10.1234/x": { status: "registered", title: raw } })).toBe(0);
    expect([p.doi, p.doiStatus]).toEqual(["10.1234/x", "verified"]);
  });
  it.each(raws)("keeps the DOI of %s when the record's own title was not cleaned (the Idea Check semantic lane)", (raw) => {
    const p = paperOf(raw);
    expect(applyDoiChecks([p], { "10.1234/x": { status: "registered", title: raw } })).toBe(0);
    expect(p.doi).toBe("10.1234/x");
  });
  it("still removes a DOI whose registered title is another paper's", () => {
    const p = paperOf(plainText("Gl&uuml;ck in the time of cholera"));
    expect(applyDoiChecks([p], { "10.1234/x": { status: "registered", title: "A review of graph neural networks for protein function" } })).toBe(1);
    expect([p.doi, p.doiStatus]).toEqual([null, "dropped_conflict"]);
  });
});

/* ------------------------- the real adapter, and the file a person takes away ------------------------- */

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const CROSSREF_JSON = {
  message: {
    items: [
      { DOI: "10.4135/9781506380674.n9", title: [TAB_TITLE], author: [{ given: "Jos&eacute;", family: "Rao" }], issued: { "date-parts": [[2014]] }, "container-title": [VENUE], "is-referenced-by-count": 0 },
      { DOI: "10.1021/cen-v058n019.ifc", title: ["We can tell you all about 1-Formylpiperidine."], issued: { "date-parts": [[1980]] }, "container-title": [VENUE], "is-referenced-by-count": 0 },
    ],
  },
};
const CITE_PATH = "/@fs" + decodeURIComponent(new URL("../../../web/src/lib/" + "cite.ts", import.meta.url).pathname);
type Cite = { formatCitation: (p: unknown, style: "apa" | "ieee" | "bibtex" | "ris") => string };

describe("through the real Crossref adapter, to the RIS file", () => {
  afterEach(() => vi.unstubAllGlobals());
  const tagLine = /^[A-Z][A-Z0-9] {2}- /;

  async function risOf(over: Partial<SearchEnv>) {
    vi.stubGlobal("fetch", async () => json(CROSSREF_JSON));
    const list = (await runProvider(crossref, "tabs and entities", envOf(memoryStore(), over))).value;
    const papers = mergeAndRank({ crossref: list }, 20);
    const { formatCitation } = (await import(/* @vite-ignore */ CITE_PATH)) as Cite;
    return { papers, ris: formatCitation(papers[0], "ris") };
  }

  it("gives a clean paper, and an RIS record with no line break inside a field", async () => {
    const { papers, ris } = await risOf({});
    expect(papers[0]!.title).toBe("You Get More Excited About Data When . . . You Can Do Something About It");
    expect(papers[0]!.venue).toBe("Chemical & Engineering News Archive");
    expect(papers[0]!.authors).toEqual(["Jos" + cp(0xe9) + " Rao"]);
    expect(ris.split("\n").every((l) => tagLine.test(l)), ris).toBe(true);
    expect(ris).toContain("TI  - You Get More Excited About Data When . . . You Can Do Something About It\n");
    expect(ris).toContain("JO  - Chemical & Engineering News Archive\n");
  });

  it("with the switch off the title splits the RIS record again (so the check above can fail)", async () => {
    const { ris } = await risOf({ SEARCH_PLAINTEXT: "off" });
    expect(ris.split("\n").some((l) => !tagLine.test(l))).toBe(true);
    expect(ris).toContain("Chemical &amp; Engineering");
  });

  it("the switch does not reach the abstract the Crossref adapter reads (stripJats runs at fetch time, with no env): with it off the title is raw and that abstract is still cleaned", async () => {
    vi.stubGlobal("fetch", async () => json({ message: { items: [{ DOI: "10.1234/c", title: ["T &amp; U"], abstract: "<jats:p>Caf&eacute; &amp;amp; p&lt;0.05 R&amp;D</jats:p>", issued: { "date-parts": [[2002]] } }] } }));
    const off = (await runProvider(crossref, "t", envOf(memoryStore(), { SEARCH_PLAINTEXT: "off" }))).value[0]!;
    expect(off.title).toBe("T &amp; U");
    expect(off.abstract).toBe("Caf" + cp(0xe9) + " & p<0.05 R&D");
  });

  it("two Crossref records that differ only by an entity are one paper after cleaning", async () => {
    vi.stubGlobal("fetch", async () => json({ message: { items: [
      { DOI: "10.1234/a", title: ["Tom &amp; Jerry in Medicine"], issued: { "date-parts": [[2001]] } },
      { DOI: "10.1234/b", title: ["Tom & Jerry in Medicine"], issued: { "date-parts": [[2001]] } },
    ] } }));
    const store = memoryStore();
    const off = mergeAndRank({ crossref: (await runProvider(crossref, "tom", envOf(store, { SEARCH_PLAINTEXT: "off" }))).value }, 20);
    const on = mergeAndRank({ crossref: (await runProvider(crossref, "tom", envOf(store))).value }, 20);
    expect([off.length, on.length]).toEqual([2, 1]); // normalizeTitle made "amp" a word of the first title
  });
});
