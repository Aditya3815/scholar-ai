import { describe, expect, it } from "vitest";
import { checkRewrite } from "./rewrite";

const S = (...x: string[]) => x;
const ok = (o: string, r: string, s: string[]) => expect(checkRewrite(o, r, s)).toEqual({ ok: true });
const no = (o: string, r: string, s: string[], reason: string) => expect(checkRewrite(o, r, s)).toMatchObject({ ok: false, reason });

describe("checkRewrite: a shorter claim that adds nothing", () => {
  const orig = "Adaptive fine-tuning of multilingual transformers (BERT, MuRIL) with cross-lingual transfer and synthetic data boosts sentiment analysis and NER for low-resource languages like Kannada.";
  const sent = S("This paper proposes an adaptive fine-tuning framework that leverages multilingual models, including BERT and other advanced architectures.", "The approach combines cross-lingual transfer learning with synthetic data augmentation to improve language representation and model robustness.", "Experimental evaluations demonstrate notable improvements in accuracy and the F1 score for tasks such as sentiment analysis and named entity recognition.");
  it("accepts the claim with the unsupported word taken out", () => ok(orig, "Adaptive fine-tuning of multilingual transformers (BERT) with cross-lingual transfer and synthetic data boosts sentiment analysis and NER for low-resource languages like Kannada.", sent));
  it("accepts a shorter claim made of the claim's own words and its sentences' words", () => ok("BCG gives strong protection against adult TB and many studies in India show little adult benefit.", "The failure of BCG to protect adults in some studies in India.", S("The failure of BCG to protect adults in some populations, in particular in some studies in India, has sometimes been wrongly generalised.")));
  it("accepts the same words in another ending (a plural, a tense)", () => ok("Yoga lowered blood pressure in 16 patients and also caused dizziness.", "Yoga lowers blood pressures in 16 patient.", S("Yoga lowers blood pressure.")));

  it("refuses a word that neither the claim nor its sentences have", () => no(orig, "Adaptive fine-tuning of multilingual transformers boosts sentiment analysis and NER for low-resource languages like Kannada and Telugu.", sent, "words"));
  it("refuses a quantity word that was not there (all, any, every, over, one, some)", () => {
    for (const w of ["all", "any", "every", "over", "one", "some", "always"]) no("Studies in India show little adult benefit of BCG.", `${w} studies in India show little adult benefit of BCG.`, S("Studies in India."), "words");
  });
  it("refuses a number that is not in the claim or its sentences, and one that is changed", () => {
    no("The trial randomized 155 patients and found no benefit.", "The trial randomized 156 patients.", S("In total, 155 patients were randomized."), "numbers");
    no("Mortality fell by 33% (OR = 0.67).", "Mortality fell by 38%.", S("A 33% reduction in mortality risk (OR = 0.67)."), "numbers");
    ok("Mortality fell by 33% (OR = 0.67) in all trials.", "Mortality fell by 33% (OR = 0.67).", S("A 33% reduction in mortality risk (OR = 0.67)."));
  });
  it("reads a number with a minus, a decimal or a thousands comma as the same number", () => ok("HOMA-IR fell by −0.72 in 1,671 people and was seen in all studies.", "HOMA-IR fell by -0.72 in 1671 people.", S("")));
  it("refuses a negation that is added, and one that is lost", () => {
    no("The trial found a benefit in adults and children.", "The trial found no benefit in adults.", S("The trial found no benefit."), "negation");
    no("The drug did not reduce mortality and cost more.", "The drug reduced mortality.", S("The drug reduced mortality."), "negation");
    no("It doesn't work in adults and is cheap.", "It works in adults.", S("It works in adults."), "negation");
    no("The review found no effect of screen time on language in toddlers.", "The review found an effect of screen time on language.", S("An effect of screen time on language."), "negation");
  });
  it("lets a whole negated clause go: nothing is turned the other way, the claim only says less", () => {
    ok("MOOCs were a useful crisis-management tool that kept learning going, though their impact on formal learning outcomes was not quantified.", "MOOCs were a useful crisis-management tool that kept learning going.", S("MOOCs are one of the crisis management solutions to ensure that education is continuous."));
    ok("It helped adults a lot in this study, and it did not help children.", "It helped adults a lot in this study.", S("It helped adults a lot in this study."));
  });
  it("keeps the claim's hedges", () => {
    no("Intermittent fasting may improve insulin sensitivity in all adults.", "Intermittent fasting improves insulin sensitivity.", S("Intermittent fasting improves insulin sensitivity."), "hedge");
    no("Yoga was associated with lower pressure and caused dizziness.", "Yoga lowered pressure.", S("Yoga lowered pressure."), "hedge");
    ok("Intermittent fasting may improve insulin sensitivity in all adults.", "Intermittent fasting may improve insulin sensitivity.", S("Intermittent fasting improves insulin sensitivity."));
  });
  it("refuses marks and brackets (the server puts the marks back itself)", () => no("A thing worked well in trials.", "A thing worked [1].", S("A thing worked."), "brackets"));
  it("refuses a claim that is the same, one that is empty, one that is much longer, and one that keeps too little", () => {
    no("A thing worked in trials of adults.", "a thing   worked in trials of adults", S(""), "same");
    no("A thing worked.", "", S(""), "empty");
    no("A thing worked.", "   ", S(""), "empty");
    no("Yoga lowered pressure in adults.", "Yoga lowered pressure in adults and the paper said that in the study it lowered it in many adults too.", S("Yoga lowered pressure in adults. The paper said that in the study it lowered it in many adults too."), "length");
    no("Yoga lowered systolic and diastolic blood pressure significantly in sixteen hypertensive adults after three months of practice.", "Yoga lowered pressure.", S("Yoga lowered systolic and diastolic blood pressure significantly in sixteen hypertensive adults after three months of practice."), "length");
  });
  it("keeps the script of the claim", () => {
    no("योग से रक्तचाप घटता है और यह सस्ता है।", "Yoga lowers blood pressure.", S("Yoga lowers blood pressure."), "script");
  });
  it("works in Hindi: a shorter claim of the claim's words", () => ok("योग से रक्तचाप घटता है और यह सबसे सस्ता उपचार है।", "योग से रक्तचाप घटता है।", S("योग से रक्तचाप घटता है।")));
  it("refuses a new Hindi word", () => no("योग से रक्तचाप घटता है और यह सस्ता है।", "योग से रक्तचाप घटता है और मधुमेह भी।", S("योग से रक्तचाप घटता है।"), "words"));
  it("works in Hinglish: the claim's own words plus the sentences' English terms", () => ok("Ethiopia ke kisan solar pump isliye nahi apnate kyunki diesel sasta padta hai aur sabhi kisan yahi karte hain.", "Ethiopia ke kisan solar pump isliye nahi apnate.", S("Adoption among smallholder farmers remains limited.")));
  it("never throws, whatever it is given", () => {
    for (const [o, r] of [["", ""], ["a", "b"], ["x".repeat(5000), "y".repeat(5000)], ["((((", "))))"], ["\u0000", "\u0001"], ["12", "12"]] as const) expect(() => checkRewrite(o, r, S("", "z"))).not.toThrow();
  });
});
