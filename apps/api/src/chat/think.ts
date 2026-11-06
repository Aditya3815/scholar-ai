import { ROUTE_NAMES, thinkIsHonest, type Lang, type ProviderStatus, type RouteMode, type ThinkAction, type ThinkLine } from "@scholar/shared";

/**
 * The words of the Thinking block's lines (design PDF, "Thinking dikhana"; packages/shared/src/think.ts says the rules). Templates only, filled with the counts of the stage that ran: English, and Hindi or
 * Hinglish when the message was written in one. The person's words and the search words go inside “ ” quotes, so that a year in them is never taken for a number the line states.
 * `line` drops a line whose text states a number that is not in its counts (it never happens with these templates; the guard makes a slip impossible to ship as a false line).
 */
type L = "en" | "hi" | "hinglish";
const lang = (l: Lang): L => (l === "hi" || l === "hinglish" ? l : "en");
const q = (s: string) => `“${s.replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().slice(0, 200)}”`;

function line(id: string, kind: ThinkLine["kind"], text: string, counts?: Record<string, number>, actions?: ThinkAction[]): ThinkLine | null {
  const l: ThinkLine = { id, kind, text, ...(counts ? { counts } : {}), ...(actions && actions.length ? { actions } : {}) };
  return thinkIsHonest(l) ? l : null;
}

/** What the message was understood as, for a search. `about` is what is looked for (the restated question of a follow-up, or the words searched). The page puts "I understood:" before every understood line. */
export function understoodSearch(l: Lang, about: string, actions: ThinkAction[]): ThinkLine | null {
  const t = { en: `you are looking for papers on ${q(about)}`, hinglish: `aap ${q(about)} par papers dhundh rahe ho`, hi: `आप ${q(about)} पर शोध-पत्र खोज रहे हैं` }[lang(l)];
  return line("understood", "understood", t, undefined, actions);
}
/** A greeting, thanks or a question about the box: understood as conversation, and so nothing was searched. */
export function understoodChat(l: Lang): ThinkLine | null {
  const t = { en: "a conversation, so nothing was searched", hinglish: "baat-cheet, isliye search nahi kiya", hi: "बातचीत, इसलिए कुछ नहीं खोजा" }[lang(l)];
  return line("understood", "understood", t, undefined, ["change"]);
}
/** Another tool's work (a list of references, an idea): offered, not started. */
export function understoodTool(l: Lang, mode: RouteMode): ThinkLine | null {
  const name = ROUTE_NAMES[mode];
  const t = { en: `${name}: it is offered below, not started`, hinglish: `${name}: neeche offer kiya hai, shuru nahi kiya`, hi: `${name}: नीचे सुझाया है, शुरू नहीं किया` }[lang(l)];
  return line("understood", "understood", t, undefined, ["change"]);
}
/** The rules could not tell, so the safe default ran: said plainly, with Change. */
export function notSure(l: Lang): ThinkLine | null {
  const t = { en: "I was not sure what you wanted, so I searched for papers", hinglish: "Main theek se samajh nahi paaya, isliye papers dhundhe", hi: "मैं ठीक से समझ नहीं पाया, इसलिए शोध-पत्र खोजे" }[lang(l)];
  return line("unsure", "note", t);
}
/** The words the indexes were asked. */
export function searched(l: Lang, query: string): ThinkLine | null {
  const t = { en: `Searched for ${q(query)}`, hinglish: `Search kiya: ${q(query)}`, hi: `खोजा: ${q(query)}` }[lang(l)];
  return line("searched", "searched", t, { queries: 1 });
}

/** Counts of a search so far, or at its end: how many sources there are, how many answered, how many records they gave, how many papers are listed, how many of those are retracted. */
export function searchCounts(providers: Record<string, ProviderStatus>, listed: number, retracted: number): { sources: number; answered: number; records: number; kept: number; retracted: number } {
  const all = Object.values(providers ?? {});
  return { sources: all.length, answered: all.filter((p) => p.ok).length, records: all.reduce((n, p) => n + (p.ok && Number.isFinite(p.count) ? p.count : 0), 0), kept: listed, retracted };
}
/** "3 of 5 sources answered, 12 papers so far" while the sources answer; at the end, what was found, kept and marked. */
export function found(l: Lang, c: ReturnType<typeof searchCounts>, final: boolean): ThinkLine | null {
  const k = lang(l);
  if (!final) {
    const t = { en: `${c.answered} of ${c.sources} sources answered, ${c.kept} papers so far`, hinglish: `${c.sources} mein se ${c.answered} sources ne jawab diya, abhi tak ${c.kept} papers`, hi: `${c.sources} में से ${c.answered} स्रोतों ने जवाब दिया, अब तक ${c.kept} शोध-पत्र` }[k];
    return line("found", "found", t, { answered: c.answered, sources: c.sources, kept: c.kept });
  }
  const marked = c.retracted > 0 ? { en: `; ${c.retracted} retracted, marked`, hinglish: `; ${c.retracted} retracted, mark kiya`, hi: `; ${c.retracted} वापस लिया गया, चिह्नित` }[k] : "";
  const t = {
    en: `${c.answered} of ${c.sources} sources answered with ${c.records} records; duplicates joined, ${c.kept} papers listed${marked}`,
    hinglish: `${c.sources} mein se ${c.answered} sources se ${c.records} records mile; duplicates jode, ${c.kept} papers rakhe${marked}`,
    hi: `${c.sources} में से ${c.answered} स्रोतों से ${c.records} रिकॉर्ड मिले; दोहराव जोड़े, ${c.kept} शोध-पत्र रखे${marked}`,
  }[k];
  return line("found", "found", t, { answered: c.answered, sources: c.sources, records: c.records, kept: c.kept, ...(c.retracted > 0 ? { retracted: c.retracted } : {}) });
}
/** Only when the reader stage runs: how many abstracts it reads. */
export function reading(l: Lang, abstracts: number): ThinkLine | null {
  const t = { en: `Reading ${abstracts} ${abstracts === 1 ? "abstract" : "abstracts"}`, hinglish: `${abstracts} abstracts padh raha hoon`, hi: `${abstracts} सार पढ़ रहा हूँ` }[lang(l)];
  return line("reading", "reading", t, { abstracts });
}
/** The answer is being written (from the abstracts), or the labelled background (not from a paper). */
export function writing(l: Lang, background = false): ThinkLine | null {
  const t = background
    ? { en: "Writing a short background from general knowledge (not from a paper)", hinglish: "General knowledge se chhota background likh raha hoon (paper se nahi)", hi: "सामान्य जानकारी से छोटी पृष्ठभूमि लिख रहा हूँ (शोध-पत्र से नहीं)" }[lang(l)]
    : { en: "Writing the answer from the abstracts", hinglish: "Abstracts se jawab likh raha hoon", hi: "सारों से जवाब लिख रहा हूँ" }[lang(l)];
  return line(background ? "background" : "writing", "writing", t);
}
/** Only when the judge gave verdicts: how many claims were read against their sentences, and what came of them. */
export function checked(l: Lang, c: { claims: number; leftOut: number; rewritten: number }): ThinkLine | null {
  const k = lang(l);
  const kept = Math.max(0, c.claims - c.leftOut);
  const extra = [
    c.leftOut > 0 ? { en: `${c.leftOut} left out`, hinglish: `${c.leftOut} hataya`, hi: `${c.leftOut} हटाया` }[k] : "",
    c.rewritten > 0 ? { en: `${c.rewritten} shortened`, hinglish: `${c.rewritten} chhota kiya`, hi: `${c.rewritten} छोटा किया` }[k] : "",
  ].filter(Boolean);
  const t = {
    en: `${c.claims} ${c.claims === 1 ? "claim" : "claims"} read against the sentences they cite: ${kept} kept${extra.length ? `, ${extra.join(", ")}` : ""}`,
    hinglish: `${c.claims} ${c.claims === 1 ? "claim" : "claims"} apne sentences se check kiye: ${kept} rakhe${extra.length ? `, ${extra.join(", ")}` : ""}`,
    hi: `${c.claims} दावे अपने वाक्यों से जाँचे: ${kept} रखे${extra.length ? `, ${extra.join(", ")}` : ""}`,
  }[k];
  return line("checked", "checked", t, { claims: c.claims, kept, ...(c.leftOut > 0 ? { leftOut: c.leftOut } : {}), ...(c.rewritten > 0 ? { rewritten: c.rewritten } : {}) });
}
