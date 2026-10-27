import { describe, expect, it } from "vitest";
import { contentStems, isRelevant, matchOf } from "./relevance";

const paper = (title: string, abstract: string | null = null) => ({ title, abstract });

describe("what a search is about", () => {
  it("keeps the distinct subject words, as their first five letters, and drops filler and study-design words", () => {
    expect(contentStems("mobile phone screen time children visual symptoms refractive error")).toEqual(["mobil", "phone", "scree", "time", "child", "visua", "sympt", "refra", "error"]);
    expect(contentStems("systematic review of randomized trial of air pollution")).toEqual(["air", "pollu"]);
  });
  it("treats a typographic hyphen like any hyphen, and folds case and accents", () => {
    expect(contentStems("Land‑use regression, MÉTHODES")).toEqual(["land", "regre", "metho"]);
  });
});

describe("is a paper about the sub-question", () => {
  const q = "mobile phone screen time children visual symptoms refractive error";
  it("rejects the papers a live search returned that were only about phones", () => {
    expect(isRelevant(q, paper("Blast Eye Injury After Mobile Phone Battery Explosion", "Injuries from mobile phone blasts have been on the rise in recent years."))).toBe(false);
    expect(isRelevant(q, paper("A mobile phone text-based intervention to reduce HIV risk among truckers in Kenya"))).toBe(false);
  });
  it("accepts a paper that uses at least half of the terms", () => {
    expect(isRelevant(q, paper("Screen time and refractive error in children", "Children with more mobile phone screen time had more visual symptoms and a higher error rate in refraction."))).toBe(true);
  });
  it("needs two terms even when half of a long query is one or two words", () => {
    expect(isRelevant("asthma children air pollution exposure", paper("Asthma", "A review of asthma."))).toBe(false);
    expect(isRelevant("asthma children air pollution exposure", paper("Air pollution and asthma in children", "Exposure was measured."))).toBe(true);
  });
  it("matches a word by its first five letters (children / child, measurement / measure)", () => {
    expect(isRelevant("child asthma exposure measurement", paper("Measuring exposure", "Asthma in children."))).toBe(true);
  });
  it("lets everything through when the query has nothing to compare (the check only removes what it can show is off the subject), and works for one term", () => {
    expect(isRelevant("study of the review", paper("Anything"))).toBe(true);
    expect(isRelevant("tuberculosis", paper("Tuberculosis vaccines"))).toBe(true);
    expect(isRelevant("tuberculosis", paper("Malaria vaccines"))).toBe(false);
  });
  it("reports how many terms matched", () => {
    expect(matchOf("air pollution asthma", paper("Air pollution", "and more"))).toEqual({ matched: 2, total: 3 });
  });
});
