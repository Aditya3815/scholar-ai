import type { Complete } from "../docs/qa";
import { AllProvidersFailedError, QuotaError } from "../llm";

/** One failed attempt the way the gateway writes it down (gateway.ts): which provider, and the error's own text. */
const failedWith = (error: string) => new AllProvidersFailedError([{ provider: "workersai", model: "stub", ok: false, ms: 1, error }]);

/**
 * The router's model, offline (tests and the local end-to-end run only: QA_STUB=1 with ENABLE_DEV_ROUTES=1). It reads the message between the triple quotes and decides by words:
 * "idea", "novel" or "naya" is an idea; "reference" or "bibliograph" a list to check; "uploaded", "workspace" or "pdf" a paper of the reader's; "unsure" is a doubtful answer,
 * "garbled" an invalid one, "boom" a failure; anything else is a search, whose English query is the first words behind "translated:".
 *
 * It reads the LAST triple-quoted block (the message: a follow-up prompt has the earlier turns before it, as one line each, and the message is always last, in its own block). For a follow-up (the call labelled
 * `chat_route_ctx`) it reads the earlier turns from their prefixed lines (`H1 {...}`, `C1 {...}`) and answers from the CURRENT message only: "simpler", "shorter", "hindi", "hinglish", "english" or "explain" ask for the same
 * papers again in another form; "newtopic" is a different topic; a year after "after", "since", "from" or "baad" is `year_from`, after "before" or "until" `year_to`, any other year both; anything else is a refinement, whose
 * standalone question and search words are the earlier topic and the message's words. "restatefail" makes the question carry a number nobody wrote (the server must refuse it), "bleedtopic" makes the search words of a new topic carry
 * the old topic's, "barereading" is a refinement whose question the model left as the message (only its search words are the earlier topic's).
 *
 * A call that FAILS, the five ways the follow-up failure policy (R5, docs/design/intent-and-state.md, 4.6) is tested with: "routertimeout" (the provider did not answer in time), "routermalformed" (a
 * reply that is not JSON, every time it is asked: the router asks again once and fails again), "routerquota" (the day's allowance is used up), "routerrefused" (the provider says no) and "routerempty" (a
 * reply with no text at all: the gateway answers it as it answers any text with no JSON in it, so at this edge it is the same error as a malformed reply, with the same two attempts). Each throws what the
 * gateway throws (gateway.ts), so `routeFollowUp` sees what it sees in production. "boom" is any other failure.
 */
export const stubRoute: Complete = async ({ user, label }) => {
  const blocks = [...user.matchAll(/"""\n([\s\S]*?)\n"""/g)];
  const text = blocks.at(-1)?.[1] ?? "";
  if (/\bboom\b/i.test(text)) throw new Error("the model failed");
  if (/\broutertimeout\b/i.test(text)) throw failedWith("timeout");
  if (/\brouter(?:malformed|empty)\b/i.test(text)) throw failedWith("no JSON in output");
  if (/\brouterquota\b/i.test(text)) throw new QuotaError("daily AI quota reached (60000/60000 tokens); resets 00:00 UTC");
  if (/\brouterrefused\b/i.test(text)) throw failedWith("HTTP 403: the request was refused");
  if (/\bgarbled\b/i.test(text)) return { model: "stub", json: { mode: "banana", confidence: 0.99, search_query: "" } };
  if (/\bunsure\b/i.test(text)) return { model: "stub", json: { mode: "idea", confidence: 0.3, search_query: "" } };
  if (/\b(?:idea|novel|naya)\b/i.test(text)) return { model: "stub", json: { mode: "idea", confidence: 0.9, search_query: "" } };
  if (/reference|bibliograph/i.test(text)) return { model: "stub", json: { mode: "verify", confidence: 0.9, search_query: "" } };
  if (/uploaded|workspace|\bpdf\b/i.test(text)) return { model: "stub", json: { mode: "paper", confidence: 0.9, search_query: "" } };
  if (label !== "chat_route_ctx") return { model: "stub", json: { mode: "search", confidence: 0.9, search_query: `translated: ${text.split(/\s+/).slice(0, 5).join(" ")}` } };
  return { model: "stub", json: stubFollowUp(user, text) };
};

/** The earlier turns of a follow-up prompt: what the person asked, what the last answer searched, and the questions of earlier chats (each on a line of its own, behind its prefix). */
function earlierTurns(user: string): { asked: string[]; searched: string[]; before: string[] } {
  const asked: string[] = [];
  const searched: string[] = [];
  const before: string[] = [];
  // only inside their fences: the message (which cannot hold a fence, router.ts makes its delimiters harmless) is never read as an earlier turn, whatever lines it has
  const turns = /<<<EARLIER_TURNS\n([\s\S]*?)\nEARLIER_TURNS>>>/.exec(user)?.[1] ?? "";
  const chats = /<<<EARLIER_CHATS\n([\s\S]*?)\nEARLIER_CHATS>>>/.exec(user)?.[1] ?? "";
  const lines = (block: string, prefix: string) => [...block.matchAll(new RegExp(`^${prefix}\\d+ (\\{.*\\})$`, "gm"))].flatMap((m) => {
    try {
      return [JSON.parse(m[1]!) as { role?: string; text?: string; search?: string; question?: string }];
    } catch {
      return [];
    }
  });
  for (const o of lines(turns, "H")) {
    if (o.role === "user" && o.text) asked.push(o.text);
    else if (o.role === "assistant" && o.search) searched.push(o.search);
  }
  for (const o of lines(chats, "C")) before.push(o.search || o.question || "");
  return { asked, searched, before };
}

/** What the stand-in says about a follow-up (see the comment on `stubRoute`). */
function stubFollowUp(user: string, text: string) {
  const { asked, searched, before } = earlierTurns(user);
  // the topic: what the last reply searched, else the last question, else the best question of an earlier chat (the browser sends the best first)
  const prior = (searched.at(-1) ?? asked.at(-1) ?? before[0] ?? "").trim();
  const year = /\b(?:19|20)\d{2}\b/.exec(text)?.[0];
  const range = year ? (/\b(?:after|since|from|onwards|baad)\b|बाद/i.test(text) ? { year_from: Number(year), year_to: 0 } : /\b(?:before|until|till)\b|पहले/i.test(text) ? { year_from: 0, year_to: Number(year) } : { year_from: Number(year), year_to: Number(year) }) : { year_from: 0, year_to: 0 };
  const language = /\bhinglish\b/i.test(text) ? "hinglish" : /\bhindi\b|हिंदी|हिन्दी/i.test(text) ? "hi" : /\benglish\b/i.test(text) ? "en" : "";
  const same = /\b(?:simpler|simply|shorter|longer|explain|summari[sz]e|hindi|hinglish|english)\b|सरल|हिंदी|हिन्दी/i.test(text);
  const topic = /\bnewtopic\b/i.test(text);
  const bare = /\bbarereading\b/i.test(text);
  const devanagari = /[ऀ-ॿ]/.test(text);
  const own = text.split(/\s+/).slice(0, 12).join(" ");
  if (topic) return { mode: "search", confidence: 0.9, intent: "new", question: text, search_query: /\bbleedtopic\b/i.test(text) ? `${own} ${prior}`.split(/\s+/).slice(0, 12).join(" ") : `translated: ${text.split(/\s+/).slice(0, 5).join(" ")}`, year_from: 0, year_to: 0, answer_language: "" };
  // the standalone question: the earlier topic and the message's words (the message alone for Hindi in Devanagari, which an English topic cannot be joined to)
  const merged = devanagari || bare ? text : `${prior} ${/\brestatefail\b/i.test(text) ? "1987 " : ""}${text}`.trim().slice(0, 200);
  return {
    mode: "search",
    confidence: 0.9,
    intent: same ? "same_papers" : "refine",
    question: merged,
    search_query: same ? "" : bare ? prior : `${prior} ${own}`.trim().split(/\s+/).slice(0, 12).join(" "),
    ...range,
    answer_language: language,
  };
}
