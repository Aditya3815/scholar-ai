import type { Complete } from "../../platform/llm/port";
import { AllProvidersFailedError } from "../../platform/llm";

/**
 * The Understand step's model and its conversation reply, offline (app/stand-ins.ts gives them to a test run: QA_STUB=1 with ENABLE_DEV_ROUTES=1, never production). They read the prompt's
 * own lines and decide by words, as described at each.
 */


const failedWith = (error: string) => new AllProvidersFailedError([{ provider: "workersai", model: "stub", ok: false, ms: 1, error }]);

/** The last turn of the ledger block that listed papers, and how many (read from the prompt's own lines: "Turn 3: ..." and "  paper 2: ..."). */
function ledgerOf(prompt: string): { lastTurn: number; papersTurn: number; papers: number; topic: string } {
  const lines = prompt.split("\n");
  let lastTurn = 0;
  let papersTurn = 0;
  let papers = 0;
  let current = 0;
  let topic = "";
  for (const l of lines) {
    const t = /^Turn (\d+)(?: \(older\))?:\s*(?:user said:\s*)?(.*)$/.exec(l);
    if (t) {
      current = Number(t[1]);
      lastTurn = current;
      continue;
    }
    const u = /^\s+understood as: (?:search|refine_search)(?:: (.*))?$/.exec(l);
    if (u && u[1]) topic = u[1];
    if (/^\s+paper \d+:/.test(l)) {
      if (papersTurn !== current) papers = 0;
      papersTurn = current;
      papers++;
    }
  }
  return { lastTurn, papersTurn, papers, topic };
}

const ORDINALS: [RegExp, number][] = [
  [/\b(?:first|pehl[ae]|pahl[ae])\b/i, 1],
  [/\b(?:second|dusr[aei]|doosr[aei])\b/i, 2],
  [/\b(?:third|teesr[aei]|tisr[aei])\b/i, 3],
];

/**
 * The Understand model, offline. It reads the message (the last triple-quoted block) and the ledger lines before it, and answers by words:
 *   "undtimeout" / "undgarbled" / "unddown": a call that times out, a reply that is not valid twice, every model down (the fail policy);
 *   "undclarify": the model's own question; "undunsure": a search it is only 0.6 sure of (the "Did you want this?" line);
 *   "literature review", "lit scan", "review chahiye": offer the literature scan; "reference", "bibliograph": Check references; "idea", "novel": Idea Check; "uploaded", "my pdf": the person's paper;
 *   "cricket", "kaise ho", "kya kar sakte", "aur batao", "undchat": conversation;
 * and with papers in the ledger: a year after "baad", "after" or "since" refines the last search from that year; "first/second/third paper" (pehla, dusra, teesra) asks about that paper; "simple", "samjhao",
 * "explain" ask about the papers again; "hindi mein" is the same answer in Hindi. Anything else is a search of the message's words. Never a fact of its own: a stand-in for what the real model decides.
 */
export const stubUnderstand: Complete = async ({ user }) => {
  const blocks = [...user.matchAll(/"""\n([\s\S]*?)\n"""/g)];
  const text = (blocks.at(-1)?.[1] ?? "").trim();
  const record = blocks.length >= 2 ? (blocks.at(-2)?.[1] ?? "") : "";
  const l = text.toLowerCase();
  if (/\bundtimeout\b/.test(l)) throw failedWith("timeout");
  if (/\bundgarbled\b/.test(l)) return { model: "stub", json: { intent: "banana" } };
  if (/\bunddown\b/.test(l)) throw failedWith("HTTP 503");
  const language = /[ऀ-ॿ]/.test(text) ? "hi" : /\b(?:hai|kya|mein|ke|ka|ki|batao|samjhao|baad|dusre|sirf|aur|chahiye|kaise)\b/.test(l) ? "hinglish" : "en";
  const base = { language, standalone: text.slice(0, 200), refers_to: null, tool: null, clarify: null, search: null };
  const status = (s: string) => ({ en: s, hinglish: s, hi: s })[language as "en"];
  const ledger = ledgerOf(record);
  if (/\bundclarify\b/.test(l)) return { model: "stub", json: { ...base, intent: "clarify", status: status("I need to check what you mean"), clarify: { question: "Which topic should I look for papers on?", choices: ["Machine learning in health", "Machine learning in farming"] }, confidence: 0.5 } };
  if (/literature review|lit scan|literature scan|review chahiye/.test(l)) return { model: "stub", json: { ...base, intent: "offer_tool", tool: "litscan", status: status("You want a literature review"), confidence: 0.9 } };
  if (/reference|bibliograph/.test(l)) return { model: "stub", json: { ...base, intent: "offer_tool", tool: "verify", status: status("You want your references checked"), confidence: 0.9 } };
  if (/\b(?:idea|novel)\b/.test(l)) return { model: "stub", json: { ...base, intent: "offer_tool", tool: "idea", status: status("You want to know if your idea is new"), confidence: 0.9 } };
  if (/uploaded|my pdf/.test(l)) return { model: "stub", json: { ...base, intent: "ask_paper", status: status("A question about your uploaded paper"), confidence: 0.9 } };
  if (/cricket|kaise ho|kya kar sakte|aur batao|\bundchat\b|\bundleak\b/.test(l)) return { model: "stub", json: { ...base, intent: "chat", status: status("Conversation, no search"), confidence: 0.95 } };
  if (ledger.papers > 0) {
    const year = /(?:baad|after|since)\D{0,12}((?:19|20)\d{2})|((?:19|20)\d{2})\D{0,12}(?:ke baad|baad|onwards|or later)/.exec(l);
    if (year) {
      const y = Number(year[1] ?? year[2]);
      const topic = ledger.topic || text;
      return { model: "stub", json: { ...base, intent: "refine_search", standalone: `${topic} from ${y}`.slice(0, 200), status: status(`The last search, from ${y} on`), search: { queries: [topic.slice(0, 100)], year_from: y, year_to: null, indian_sources: null }, confidence: 0.9 } };
    }
    const ord = ORDINALS.find(([re]) => re.test(l));
    if (ord && /paper|wala|wale|study|one/.test(l)) return { model: "stub", json: { ...base, intent: "ask_results", status: status(`A question about paper ${ord[1]} above`), refers_to: { turn: ledger.papersTurn, papers: [ord[1]] }, confidence: 0.88 } };
    if (/simple|samjhao|explain|hindi mein|in hindi/.test(l)) return { model: "stub", json: { ...base, intent: "ask_results", language: /hindi/.test(l) ? "hi" : language, status: status("A question about the papers above"), refers_to: { turn: ledger.papersTurn, papers: [] }, confidence: 0.9 } };
  }
  const words = text.replace(/^(?:ab|now)\s+/i, "").split(/\s+/).slice(0, 8).join(" ");
  const confidence = /\bundunsure\b/.test(l) ? 0.6 : 0.9;
  const query = words.replace(/\bundunsure\b/gi, "").replace(/\s+/g, " ").trim() || words;
  return { model: "stub", json: { ...base, intent: "search", status: status(`You want papers on ${query.toLowerCase()}`), search: { queries: [query], year_from: null, year_to: null, indian_sources: null }, confidence } };
};

/** The conversation reply, offline: a fixed reply per language; "undleak" makes it cite a paper (the post-check must throw it away and the message is searched instead). */
export const stubChatReply: Complete = async ({ user }) => {
  const text = [...user.matchAll(/"""\n([\s\S]*?)\n"""/g)].at(-1)?.[1] ?? "";
  if (/\bundleak\b/i.test(text)) return { model: "stub", json: { reply: "Smith et al. (2020) showed that this works." } };
  const hinglish = /Reply language: hinglish/.test(user);
  const hindi = /Reply language: hi /.test(user);
  if (/cricket/i.test(text)) return { model: "stub", json: { reply: "I help with research, not sports scores. Shall I find papers on sports science instead?" } };
  return { model: "stub", json: { reply: hindi ? "सब बढ़िया है! आप किस विषय पर शोध कर रहे हैं?" : hinglish ? "Sab badhiya! Aap kis topic par research kar rahe ho?" : "All good, thanks! What topic are you researching?" } };
};

