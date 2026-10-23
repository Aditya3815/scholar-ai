import { describe, expect, it } from "vitest";
import {
  OCR_ACCEPT_BELOW,
  OCR_MAX_TOKENS,
  OCR_MIN_TEXT_CHARS,
  OCR_WARN_BELOW,
  cleanReading,
  comparable,
  disagreement,
  disputedNumbers,
  editDistance,
  isScanned,
  judgePage,
  looksBlank,
  looksLooping,
  mergeScanInfo,
  needsReading,
  pictureSize,
  numbersIn,
  readingOrder,
} from "@scholar/shared";

const PAGE =
  "Soil moisture was measured at 38 sites across the district between March 2018 and June 2019. The mean value rose to 4.2 percent, and the authors checked each reading against the field notes. " +
  "Further sampling at the northern stations confirmed the trend, and the discussion relates it to earlier surveys of the same districts, which had reported values below 3.1 percent. " +
  "Table 2 lists the stations, the dates of sampling and the instrument used at each one, and the appendix repeats the raw readings for anyone who wishes to recompute the means.";

/** Replaces `n` evenly spaced letters, so two texts differ by exactly n characters. */
function damage(text: string, n: number): string {
  const chars = [...text];
  const step = Math.floor(chars.length / (n + 1));
  for (let k = 1; k <= n; k++) {
    const i = k * step;
    chars[i] = chars[i] === "q" ? "z" : "q";
  }
  return chars.join("");
}
const reading = (text: string, cutOff = false) => ({ text, cutOff });

describe("cleanReading", () => {
  it("takes the chatter off a model's answer and leaves the page's own words", () => {
    expect(cleanReading("Here is the transcription of the page:\n\n## Introduction\nWe **measured** soil moisture.  \n")).toBe("Introduction\nWe measured soil moisture.");
    expect(cleanReading("```text\nline one\nline two\n```")).toBe("line one\nline two");
    expect(cleanReading("**Transcribed Text:**\n\nThe quick brown fox")).toBe("The quick brown fox");
  });
  it("keeps what is really on the page: a footnote star, a hash inside a word, numbers and Devanagari", () => {
    expect(cleanReading("the largest sum of mischief do* in the world")).toBe("the largest sum of mischief do* in the world");
    expect(cleanReading("written in C# and F#, see item #4")).toBe("written in C# and F#, see item #4");
    expect(cleanReading("भूमिका\n\nतिरालिस वर्षों के अंतराल")).toBe("भूमिका\n\nतिरालिस वर्षों के अंतराल");
  });
  it("normalises line ends and a byte-order mark, and squeezes runs of blank lines", () => {
    expect(cleanReading("﻿one\r\ntwo\r\n\r\n\r\n\r\nthree")).toBe("one\ntwo\n\nthree");
  });
  it("does not remove a first line that is part of the page", () => {
    expect(cleanReading("Transcription errors in optical readers\nare discussed here.")).toBe("Transcription errors in optical readers\nare discussed here.");
  });
  it("copes with nothing", () => {
    expect(cleanReading("")).toBe("");
    expect(cleanReading(undefined as unknown as string)).toBe("");
    expect(cleanReading("   \n\n  ")).toBe("");
  });
});

describe("comparable", () => {
  it("treats a superscript and a plain digit, curly and straight quotes, dashes and ligatures as the same", () => {
    expect(comparable("note² “quoted” – ﬁnal")).toBe(comparable("note2 \"quoted\" - final"));
  });
  it("ignores where lines and spaces fall, and capitals", () => {
    expect(comparable("The Lamp\nof  Truth")).toBe(comparable("the lamp of truth"));
    expect(comparable("by taking")).toBe(comparable("bytaking"));
  });
  it("reads Devanagari digits as digits", () => {
    expect(comparable("१९७८")).toBe("1978");
  });
  it("keeps Devanagari letters and combining marks as they are", () => {
    expect(comparable("पंडित मुकुटधर")).toBe("पंडितमुकुटधर");
    expect(comparable("पंडित")).not.toBe(comparable("पडित"));
  });
});

describe("editDistance", () => {
  it("is the usual edit distance", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("abc", "")).toBe(3);
    expect(editDistance("same", "same")).toBe(0);
    expect(editDistance("flaw", "lawn")).toBe(2);
  });
  it("is symmetric", () => {
    expect(editDistance("sunday", "saturday")).toBe(editDistance("saturday", "sunday"));
  });
  it("counts code points, not UTF-16 units", () => {
    expect(editDistance("a😀b", "a😃b")).toBe(1);
    expect(editDistance("का", "की")).toBe(1);
  });
  it("stops early once the distance is certainly above the limit", () => {
    expect(editDistance("a".repeat(500), "b".repeat(500), 10)).toBe(11);
    expect(editDistance("abcdef", "abcdxf", 3)).toBe(1);
    expect(editDistance("short", "a much much longer text", 3)).toBe(4);
  });
});

describe("disagreement", () => {
  it("is 0 for the same text and for two empty ones", () => {
    expect(disagreement(PAGE, PAGE)).toBe(0);
    expect(disagreement("", "")).toBe(0);
    expect(disagreement("  \n ", "")).toBe(0);
  });
  it("is the share of characters that differ", () => {
    const n = comparable(PAGE).length;
    expect(disagreement(PAGE, damage(PAGE, 5))).toBeCloseTo(5 / n, 3);
  });
  it("is not moved by line breaks, spacing or capitals", () => {
    expect(disagreement(PAGE, PAGE.replace(/\. /g, ".\n").toUpperCase())).toBe(0);
  });
  it("is high for texts about different things, and never above 1", () => {
    const d = disagreement(PAGE, "Quarterly harbour figures for berth occupancy and vessel arrivals over the preceding five years, by terminal.");
    expect(d).toBeGreaterThan(0.5);
    expect(d).toBeLessThanOrEqual(1);
    expect(disagreement("abc", "")).toBe(1);
  });
  it("with a ceiling, only says the texts are far apart", () => {
    expect(disagreement(PAGE, "x".repeat(400), 0.2)).toBeGreaterThanOrEqual(0.2);
  });
});

describe("numbers", () => {
  it("finds numbers as written, without a closing full stop", () => {
    expect(numbersIn("in 2019. The value 0.01 and 1,200 sites (n = 38), p<0.05.")).toEqual(["2019", "0.01", "1,200", "38", "0.05"]);
    expect(numbersIn("No digits here")).toEqual([]);
  });
  it("reads Devanagari digits and superscripts as digits", () => {
    expect(numbersIn("छत्तीसगढ़ी जागरण गीत (१९७८)")).toEqual(["1978"]);
    expect(numbersIn("note²")).toEqual(["2"]);
  });
  it("names the numbers one reading has and the other does not", () => {
    expect(disputedNumbers("rose from 2005 to 2020, 38 sites", "rose from 2003 to 2020, 38 sites")).toEqual(["2005", "2003"]);
    expect(disputedNumbers("0.01 level", "0.011 level")).toEqual(["0.01", "0.011"]);
  });
  it("counts how often, not just whether", () => {
    expect(disputedNumbers("4 and 4", "4")).toEqual(["4"]);
    expect(disputedNumbers("2019 2019", "2019 2019")).toEqual([]);
  });
  it("lists at most twelve", () => {
    const a = Array.from({ length: 30 }, (_, i) => String(100 + i)).join(" ");
    expect(disputedNumbers(a, "")).toHaveLength(12);
  });
});

describe("looksLooping", () => {
  it("catches one sentence said over and over", () => {
    expect(looksLooping("The sample was dried at room temperature. ".repeat(40))).toBe(true);
    expect(looksLooping("Сельскохозяйственного института в Каменском. ".repeat(30))).toBe(true);
  });
  it("catches one character repeated many times", () => {
    expect(looksLooping("results " + "ा".repeat(40) + " follow")).toBe(true);
  });
  it("lets ordinary text through, including a long page", () => {
    expect(looksLooping(PAGE)).toBe(false);
    expect(looksLooping(PAGE.repeat(1))).toBe(false);
    expect(looksLooping("")).toBe(false);
  });
  it("does not mistake a list of references that share publisher names for a loop", () => {
    const refs = Array.from({ length: 40 }, (_, i) => `Author${i}, A. (${1980 + i}). A study of topic number ${i * 7} in language learning. Cambridge: Cambridge University Press.`).join("\n");
    expect(looksLooping(refs)).toBe(false);
  });
  it("does not mistake dot leaders in a contents page for a loop", () => {
    expect(looksLooping("Chapter one " + ".".repeat(80) + " 12\nChapter two " + "-".repeat(60) + " 40\nChapter three " + "_".repeat(50) + " 77")).toBe(false);
  });
  it("does not call a short text a loop", () => {
    expect(looksLooping("yes yes yes yes yes")).toBe(false);
  });
});

describe("judgePage", () => {
  it("uses a page the two models agree on, and keeps the first reading cleaned", () => {
    const v = judgePage(reading("**Heading**\n" + PAGE + "  "), reading("Heading\n" + PAGE));
    expect(v.status).toBe("ok");
    expect(v.disagreement).toBeLessThan(OCR_ACCEPT_BELOW);
    expect(v.text).toBe("Heading\n" + PAGE);
    expect(v.why).toBeUndefined();
  });
  it("uses a page with doubt when they differ a little", () => {
    const n = comparable(PAGE).length;
    const v = judgePage(reading(PAGE), reading(damage(PAGE, Math.ceil(n * 0.05))));
    expect(v.status).toBe("warn");
    expect(v.disagreement).toBeGreaterThanOrEqual(OCR_ACCEPT_BELOW);
    expect(v.disagreement).toBeLessThan(OCR_WARN_BELOW);
    expect(v.text).toBe(PAGE);
  });
  it("uses a page just under each limit and refuses one just over", () => {
    const n = comparable(PAGE).length;
    expect(judgePage(reading(PAGE), reading(damage(PAGE, Math.floor(n * OCR_ACCEPT_BELOW) - 1))).status).toBe("ok");
    expect(judgePage(reading(PAGE), reading(damage(PAGE, Math.ceil(n * OCR_ACCEPT_BELOW) + 1))).status).toBe("warn");
    expect(judgePage(reading(PAGE), reading(damage(PAGE, Math.floor(n * OCR_WARN_BELOW) - 2))).status).toBe("warn");
    const over = judgePage(reading(PAGE), reading(damage(PAGE, Math.ceil(n * OCR_WARN_BELOW) + 2)));
    expect(over.status).toBe("unreliable");
    expect(over.why).toBe("models_disagree");
  });
  it("refuses a page the models read as different things, and keeps no text", () => {
    const other = "Quarterly figures for the harbour authority show berth occupancy and vessel arrivals for the preceding five years, split by terminal and by month, with the busiest weeks shaded in the accompanying chart and a note on dredging. " +
      "Freight handled at the container terminal grew faster than bulk cargo, while the passenger ferry service lost two routes and gained one, as the authority explains in its annual statement to the shipping ministry in the capital.";
    const v = judgePage(reading(PAGE), reading(other));
    expect(v).toMatchObject({ status: "unreliable", why: "models_disagree", text: "" });
    expect(v.disagreement).toBeGreaterThan(OCR_WARN_BELOW);
  });
  it("refuses a page when one model could not be reached (it cannot be checked)", () => {
    expect(judgePage(reading(PAGE), null)).toMatchObject({ status: "unreliable", why: "second_reading_failed", text: "" });
    expect(judgePage(null, reading(PAGE))).toMatchObject({ status: "unreliable", why: "second_reading_failed" });
    expect(judgePage(null, null).why).toBe("second_reading_failed");
  });
  it("refuses a page when a model ran out of room, however well the start agrees", () => {
    expect(judgePage(reading(PAGE, true), reading(PAGE))).toMatchObject({ status: "unreliable", why: "cut_off" });
    expect(judgePage(reading(PAGE), reading(PAGE, true)).why).toBe("cut_off");
    expect(OCR_MAX_TOKENS).toBeGreaterThan(1900);
  });
  it("refuses a page that one model answered with a loop (as one did on a real scan)", () => {
    const loop = "Сельскохозяйственного института в Каменском. ".repeat(60);
    expect(judgePage(reading(PAGE), reading(loop))).toMatchObject({ status: "unreliable", why: "repeating" });
    expect(judgePage(reading(loop), reading(loop)).why).toBe("repeating");
  });
  it("refuses a page when one answer is far longer than the other", () => {
    const more = "A second section turns to the laboratory work: reagents were prepared fresh each morning, filters were weighed twice, balances were calibrated against certified masses, and every deviation from the written protocol was initialled by the supervisor before the next batch was started. Temperatures in the drying ovens stayed within one degree of the set value throughout.";
    expect(judgePage(reading(PAGE), reading(PAGE + " " + more + " " + more.split("").reverse().join(""))).why).toBe("lengths_differ");
    expect(judgePage(reading(PAGE), reading("The soil.")).why).toBe("lengths_differ");
  });
  it("calls a page with nothing on it empty, and a page one model left empty unreliable", () => {
    expect(judgePage(reading(""), reading(" \n "))).toMatchObject({ status: "empty", text: "", disagreement: 0 });
    expect(judgePage(reading(PAGE), reading("")).status).toBe("unreliable");
    expect(judgePage(reading(""), reading(PAGE)).status).toBe("unreliable");
  });
  it("names numbers the two models read differently, even on a page that is used", () => {
    const a = PAGE;
    const b = PAGE.replace("2019", "2017");
    const v = judgePage(reading(a), reading(b));
    expect(v.status).not.toBe("unreliable");
    expect(v.disputed).toEqual(["2019", "2017"]);
  });
  it("is the same whichever model is asked first", () => {
    const b = damage(PAGE, 8);
    expect(judgePage(reading(PAGE), reading(b)).disagreement).toBe(judgePage(reading(b), reading(PAGE)).disagreement);
  });
  it("copes with Hindi, with Hindi mixed with English, and with text that is not Latin at all", () => {
    const hi = "तिरालिस वर्षों के अंतराल को समसामयिक संदर्भों के निकष पर निरखना और साम्य–वैषम्य को परखना शोध की नयी स्थापना के रूप में देखा जाना चाहिए। इस दृष्टि से पंडित मुकुटधर पाण्डेय और डॉ. विमल कुमार पाठक के व्यक्तित्व की परिक्रमा।";
    expect(judgePage(reading(hi), reading(hi)).status).toBe("ok");
    expect(judgePage(reading(hi), reading(hi.replace("निरखना", "निरखने").replace("परखना", "परखने").replace("नयी", "नई").replace("परिक्रमा", "परिक्रम"))).status).toBe("warn");
    const mixed = "The term अथ “now” in the sūtra indicates a commencement, and points out that a dissertation is to be offered on the science of words.";
    expect(judgePage(reading(mixed), reading(mixed)).status).toBe("ok");
  });
});

describe("which pages need reading", () => {
  it("a page with almost no text needs reading", () => {
    expect(needsReading(0)).toBe(true);
    expect(needsReading(OCR_MIN_TEXT_CHARS - 1)).toBe(true);
    expect(needsReading(OCR_MIN_TEXT_CHARS)).toBe(false);
  });
  it("a document is a scan when at least half of its pages have no text, so a text paper with a scanned figure page is left alone", () => {
    expect(isScanned([])).toBe(false);
    expect(isScanned([0, 0, 0, 0])).toBe(true);
    expect(isScanned([0, 3000, 0, 2800])).toBe(true);
    expect(isScanned([0, 3000, 2900, 2800])).toBe(false);
    expect(isScanned([2400, 2500, 0])).toBe(false);
    expect(isScanned([0])).toBe(true);
  });
  it("reads the first pages and the last ones first (title, DOI and references), then the rest", () => {
    expect(readingOrder([1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4, 5]);
    expect(readingOrder(Array.from({ length: 20 }, (_, i) => i + 1))).toEqual([1, 2, 3, 15, 16, 17, 18, 19, 20, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(readingOrder([9, 3, 3, 1])).toEqual([1, 3, 9]);
    expect(readingOrder([])).toEqual([]);
  });
});

describe("looksBlank", () => {
  const field = (n: number, tone: number, noise: number) => Array.from({ length: n }, (_, i) => tone + (((i * 7919) % 11) - 5) * (noise / 5));
  it("a white sheet, an off-white sheet and a sheet with scanner noise are blank", () => {
    expect(looksBlank(field(50_000, 255, 0))).toBe(true);
    expect(looksBlank(field(50_000, 238, 6))).toBe(true);
    expect(looksBlank(field(50_000, 120, 12))).toBe(true); // a grey scan of nothing
    expect(looksBlank(field(50_000, 8, 4))).toBe(true); // a black sheet (scanner lid)
  });
  it("a page with a few lines of text is not blank", () => {
    const page = field(135_000, 240, 4);
    for (let line = 0; line < 3; line++) for (let i = 0; i < 1500; i++) page[20_000 + line * 9000 + i] = 30; // three dark strokes
    expect(looksBlank(page)).toBe(false);
  });
  it("a page with a single short line is still not blank", () => {
    const page = field(135_000, 240, 4);
    for (let i = 0; i < 400; i++) page[60_000 + i] = 40;
    expect(looksBlank(page)).toBe(false);
  });
  it("a page with only a faint speck or two is blank", () => {
    const page = field(135_000, 240, 4);
    for (let i = 0; i < 5; i++) page[1000 + i] = 20;
    expect(looksBlank(page)).toBe(true);
  });
  it("a page that is mostly a dark photograph with light text is not blank", () => {
    const page = field(100_000, 40, 6);
    for (let i = 0; i < 3000; i++) page[10_000 + i] = 230;
    expect(looksBlank(page)).toBe(false);
  });
  it("nothing at all is blank", () => {
    expect(looksBlank([])).toBe(true);
  });
});

describe("pictureSize", () => {
  it("an A4 page is drawn at 150 dpi: about 1,240 x 1,754", () => {
    expect(pictureSize(595, 842)).toEqual({ width: 1239, height: 1754 });
    expect(pictureSize(595.28, 841.89)).toEqual({ width: 1240, height: 1754 });
  });
  it("a small page is drawn at 150 dpi, not enlarged to fill the limit", () => {
    expect(pictureSize(300, 400)).toEqual({ width: 625, height: 833 });
  });
  it("a large page, a landscape page and a poster are brought inside the limits, keeping their shape", () => {
    const big = pictureSize(1200, 1700);
    expect(big.width).toBeLessThanOrEqual(1240);
    expect(big.height).toBeLessThanOrEqual(1754);
    expect(big.width / big.height).toBeCloseTo(1200 / 1700, 2);
    const wide = pictureSize(842, 595);
    expect(wide.width).toBeLessThanOrEqual(1754);
    expect(wide.height).toBeLessThanOrEqual(1754);
    expect(wide.width).toBe(1240);
    const poster = pictureSize(3000, 5000);
    expect(Math.max(poster.width, poster.height)).toBeLessThanOrEqual(1754);
  });
  it("copes with a page that reports no size", () => {
    expect(pictureSize(0, 0)).toEqual({ width: 1239, height: 1754 });
    expect(pictureSize(Number.NaN, -5)).toEqual({ width: 1239, height: 1754 });
  });
});

describe("mergeScanInfo", () => {
  const info = (over: object = {}) => ({ pages: 5, title: "T", doi: null, arxiv: null, outline: [], headings: [], references: [] as string[], referencesSource: "none" as const, metadata: null, ...over });
  it("takes the DOI and the references from the scan when the paper has none", () => {
    const m = mergeScanInfo(info(), info({ doi: "10.1/x", references: ["A. B. (2000). A title that is long enough."], referencesSource: "pdf" }));
    expect(m).toMatchObject({ title: "T", doi: "10.1/x", referencesSource: "pdf" });
    expect(m.references).toHaveLength(1);
  });
  it("keeps what the paper already has, such as a list the reader corrected", () => {
    const m = mergeScanInfo(info({ doi: "10.9/own", references: ["Mine. (1999). Corrected by hand and long enough."], referencesSource: "pdf" }), info({ doi: "10.1/x", references: ["a", "b"], referencesSource: "pdf" }));
    expect(m.doi).toBe("10.9/own");
    expect(m.references).toEqual(["Mine. (1999). Corrected by hand and long enough."]);
  });
  it("uses the scan as it is when there was nothing before", () => {
    const s = info({ doi: "10.1/x" });
    expect(mergeScanInfo(null, s)).toBe(s);
  });
});
