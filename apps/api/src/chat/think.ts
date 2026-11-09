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
/**
 * A search the person chose by hand (Search papers, "Use my exact words", "Search for these words anyway", a year chip taken off): nothing was understood, the words are searched as written, so the line says
 * so as the page without the block does ("Searching papers, as you chose."), with no "I understood" label (a note) and with Change, as that line has.
 */
export function chosenSearch(l: Lang): ThinkLine | null {
  const t = { en: "Searching papers, as you chose", hinglish: "Aapke chune hisaab se papers dhundh raha hoon", hi: "आपके चुनने के हिसाब से शोध-पत्र खोज रहा हूँ" }[lang(l)];
  return line("chosen", "note", t, undefined, ["change"]);
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
/**
 * M5: what the Understand step understood, in its own words (`status`: the one line a model writes, checked on the server: no citation, no link, nothing of a paper). Inside “ ” quotes, so that a year in it
 * ("after 2020") is the model's words and not a number the line states. The page puts "I understood:" before it.
 */
export function understoodModel(status: string, actions: ThinkAction[]): ThinkLine | null {
  return line("understood", "understood", q(status), undefined, actions);
}
/** M5: the reading was only between 0.45 and 0.75 sure, or the rules decided: the question the design asks prominently, with Change. */
export function confirmLine(l: Lang): ThinkLine | null {
  const t = { en: "Did you want this?", hinglish: "Aapko ye chahiye tha?", hi: "क्या आपको यही चाहिए था?" }[lang(l)];
  return line("confirm", "note", t, undefined, ["change"]);
}
/** M5: the model could not be used (it did not answer in time, its reading was not valid twice, every model was down), so the rules decided. A visitor past the day's free readings is told to sign in. */
export function fellBack(l: Lang, visitorCap = false): ThinkLine | null {
  const t = visitorCap
    ? { en: "Today's free understanding is used up, so the rules decided. Sign in for more", hinglish: "Aaj ki free samajh khatam ho gayi, isliye rules ne tay kiya. Aur ke liye sign in karein", hi: "आज की मुफ़्त समझ ख़त्म हो गई, इसलिए नियमों ने तय किया। और के लिए साइन इन करें" }[lang(l)]
    : { en: "I could not understand this well, so I searched for papers", hinglish: "Main theek se samajh nahi paaya, isliye papers dhundhe", hi: "मैं ठीक से समझ नहीं पाया, इसलिए पेपर खोजे" }[lang(l)];
  return line("unsure", "note", t, undefined, ["change"]);
}
/** M5: a question about papers already in the chat: no new search; how many of them were found again by their DOI and are read now (their abstracts). */
export function fromEarlier(l: Lang, papers: number): ThinkLine | null {
  const t = {
    en: `No new search: using ${papers} ${papers === 1 ? "paper" : "papers"} from earlier in this chat, looked up again by DOI`,
    hinglish: `Naya search nahi: is chat ke ${papers} papers, DOI se dobara dekhe`,
    hi: `नई खोज नहीं: इस चैट के ${papers} शोध-पत्र, DOI से दोबारा देखे`,
  }[lang(l)];
  return line("earlier", "note", t, { papers });
}
/** M5: one question back to the person instead of a guess (the choices are below the block). */
export function asking(l: Lang): ThinkLine | null {
  const t = { en: "Asking you one question before searching", hinglish: "Search se pehle aapse ek sawaal", hi: "खोजने से पहले आपसे एक सवाल" }[lang(l)];
  return line("asking", "note", t);
}

/* ---------------------------------------------------------------- tools run in the reply (CHAT_TOOLS, chat/tools.ts) */

const TOOL_NAMES = {
  verify: { en: "Check references", hinglish: "Check references", hi: "संदर्भ जाँच" },
  retractions: { en: "Check retractions", hinglish: "Retraction check", hi: "वापसी (retraction) जाँच" },
  ask_paper: { en: "Ask this paper", hinglish: "Ask this paper", hi: "इस शोध-पत्र से पूछें" },
  ask_doc: { en: "Ask your paper", hinglish: "Aapke paper se poochna", hi: "आपके शोध-पत्र से पूछना" },
} as const;
export type ToolName = keyof typeof TOOL_NAMES;

/**
 * What the message was understood as when a tool runs in the reply: the tool's name, and that it runs here (not offered). With Change, as every understood line has. `unsure` (the Understand step was only
 * 0.45 to 0.75 sure) puts the confidence question in the SAME line, so that there is one line with one Change, not two.
 */
export function understoodToolRun(l: Lang, tool: ToolName, unsure = false): ThinkLine | null {
  const k = lang(l);
  const name = TOOL_NAMES[tool][k];
  const t = { en: `${name}, run here`, hinglish: `${name}, yahin chala raha hoon`, hi: `${name}, यहीं चला रहा हूँ` }[k];
  const ask = unsure ? { en: ". Did you want this?", hinglish: ". Aapko ye chahiye tha?", hi: "। क्या आपको यही चाहिए था?" }[k] : "";
  return line("understood", "understood", t + ask, undefined, ["change"]);
}
/** A list of references is checked: how many, and where (no AI). How many were left out over the limit, when any were. */
export function toolChecking(l: Lang, references: number, skipped: number): ThinkLine | null {
  const k = lang(l);
  const over = skipped > 0 ? { en: ` (${skipped} over the limit left out)`, hinglish: ` (${skipped} limit se zyada, chhod diye)`, hi: ` (${skipped} सीमा से ज़्यादा, छोड़े)` }[k] : "";
  const t = { en: `Checking ${references} ${references === 1 ? "reference" : "references"} at Crossref and OpenAlex${over}`, hinglish: `${references} references Crossref aur OpenAlex par check kar raha hoon${over}`, hi: `${references} संदर्भ Crossref और OpenAlex पर जाँच रहा हूँ${over}` }[k];
  return line("tool", "note", t, { references, ...(skipped > 0 ? { skipped } : {}) });
}
/** What the check came to: the buckets of the Check references page, each only when it has any. */
export function toolChecked(l: Lang, c: { verified: number; mismatch: number; notFound: number; unchecked: number }): ThinkLine | null {
  const k = lang(l);
  const all = c.verified + c.mismatch + c.notFound + c.unchecked;
  const parts = [
    c.verified > 0 ? { en: `${c.verified} verified`, hinglish: `${c.verified} verified`, hi: `${c.verified} सत्यापित` }[k] : "",
    c.mismatch > 0 ? { en: `${c.mismatch} with details that differ`, hinglish: `${c.mismatch} mein details alag`, hi: `${c.mismatch} में विवरण अलग` }[k] : "",
    c.notFound > 0 ? { en: `${c.notFound} not found`, hinglish: `${c.notFound} nahi mile`, hi: `${c.notFound} नहीं मिले` }[k] : "",
    c.unchecked > 0 ? { en: `${c.unchecked} could not be checked`, hinglish: `${c.unchecked} check nahi ho paaye`, hi: `${c.unchecked} जाँचे नहीं जा सके` }[k] : "",
  ].filter(Boolean);
  const t = { en: `${all} checked: ${parts.join(", ")}`, hinglish: `${all} check kiye: ${parts.join(", ")}`, hi: `${all} जाँचे: ${parts.join(", ")}` }[k];
  return line("tool_result", "note", t, { checked: all, verified: c.verified, mismatch: c.mismatch, notFound: c.notFound, unchecked: c.unchecked });
}
/** DOIs are looked up for retractions at Crossref (its data carries the Retraction Watch database). */
export function toolRetractions(l: Lang, dois: number): ThinkLine | null {
  const t = { en: `Checking ${dois} ${dois === 1 ? "DOI" : "DOIs"} for retractions at Crossref`, hinglish: `${dois} DOI ka retraction Crossref par check kar raha hoon`, hi: `${dois} DOI की वापसी (retraction) Crossref पर जाँच रहा हूँ` }[lang(l)];
  return line("tool", "note", t, { dois });
}
export function toolRetractionsDone(l: Lang, c: { retracted: number; clear: number; unknown: number }): ThinkLine | null {
  const k = lang(l);
  const parts = [
    { en: `${c.retracted} retracted`, hinglish: `${c.retracted} retracted`, hi: `${c.retracted} वापस लिए गए` }[k],
    c.clear > 0 ? { en: `${c.clear} not retracted`, hinglish: `${c.clear} retracted nahi`, hi: `${c.clear} वापस नहीं लिए गए` }[k] : "",
    c.unknown > 0 ? { en: `${c.unknown} could not be checked`, hinglish: `${c.unknown} check nahi ho paaye`, hi: `${c.unknown} जाँचे नहीं जा सके` }[k] : "",
  ].filter(Boolean);
  return line("tool_result", "note", parts.join(", "), { retracted: c.retracted, clear: c.clear, unknown: c.unknown });
}
/** One paper is read to answer: its full text where it can be read (or, for the person's own paper, its pages). The title goes inside quotes, so a year in it is not a number the line states. */
export function toolAsking(l: Lang, title: string | null, own: boolean): ThinkLine | null {
  const k = lang(l);
  const what = title ? q(title) : own ? { en: "your paper", hinglish: "aapka paper", hi: "आपका शोध-पत्र" }[k] : { en: "the paper", hinglish: "paper", hi: "शोध-पत्र" }[k];
  const t = own
    ? { en: `Reading ${what} to answer`, hinglish: `Jawab ke liye ${what} padh raha hoon`, hi: `जवाब के लिए ${what} पढ़ रहा हूँ` }[k]
    : { en: `Reading the full text of ${what} where it can be read, to answer`, hinglish: `Jawab ke liye ${what} ka full text padh raha hoon (jahan mil sake)`, hi: `जवाब के लिए ${what} का पूरा पाठ पढ़ रहा हूँ (जहाँ मिल सके)` }[k];
  return line("tool", "reading", t);
}
/** How the paper's answer ended: how many quotes it rests on (each checked word for word), or that the paper does not say, or that it could not be answered. */
export function toolAnswered(l: Lang, a: { quotes: number; found: boolean; verified: boolean } | null): ThinkLine | null {
  const k = lang(l);
  if (!a) return line("tool_result", "note", { en: "No answer could be made this time", hinglish: "Is baar jawab nahi ban paaya", hi: "इस बार जवाब नहीं बन पाया" }[k]);
  if (!a.found) return line("tool_result", "checked", { en: "The paper does not answer this, so nothing was made up", hinglish: "Paper iska jawab nahi deta, isliye kuch nahi banaya", hi: "शोध-पत्र इसका जवाब नहीं देता, इसलिए कुछ नहीं बनाया" }[k]);
  const t = a.verified
    ? { en: `${a.quotes} ${a.quotes === 1 ? "quote" : "quotes"}, each found word for word in the text`, hinglish: `${a.quotes} quotes, har ek text mein shabd-ba-shabd mila`, hi: `${a.quotes} उद्धरण, हर एक पाठ में शब्दशः मिला` }[k]
    : { en: `${a.quotes} ${a.quotes === 1 ? "quote" : "quotes"}; not every one was found in the text`, hinglish: `${a.quotes} quotes; har ek text mein nahi mila`, hi: `${a.quotes} उद्धरण; हर एक पाठ में नहीं मिला` }[k];
  return line("tool_result", "checked", t, { quotes: a.quotes });
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
