import { MAX_EARLIER_CHARS, MAX_EARLIER_ENTRIES, MAX_EARLIER_QUERY_CHARS, MAX_EARLIER_QUESTION_CHARS, type EarlierQuestion } from "./chat-context";
import { askedTurns, cutWhole, oneLine, type AssistantMsg, type ChatMsg, type IndexEntry } from "./chat-state";
import { needsContext } from "./route";

/**
 * Chat to chat (docs/design/chat-actions-context.md, section 6). What the browser may carry from one chat to another, decided here as pure functions so that it is tested without a browser:
 * the few words kept with each chat so that the device can find it, which chats may be drawn on, what counts as related, what is built from them, and whose chats they are.
 *
 * Everything here is made from what the person typed. An answer, an Idea Check, a pasted list, small talk and background from general knowledge are never read (`askedTurns` is the only door), nothing
 * is written by a model, and nothing is sent anywhere by this file: the browser decides, shows what it used on the reply, and the server only reads what it is given (`earlier`, at most three questions).
 */

/** The chats the rail lists. The memory draws only on these: a chat the person cannot see is never used (the privacy page promises "the thirty latest" are kept; the rail shows six). */
export const RAIL_CHATS = 6;
/** How many words are kept with a chat, and the most characters they may take in the entry. A few words, not the text. */
export const MEMORY_WORDS = 24;
const MEMORY_WORD_CHARS = 400;
/** How many chats are opened for one message: the best of the chats that relate. */
export const MEMORY_CHATS = 3;
/**
 * How much a message must share with a chat (or a question) to relate to it, as the sum of the weights of the words they have in common (a word that few chats have weighs about 1.5; one that nearly
 * every chat has, 0.07 to 0.2). Below it nothing is carried: an unrelated question matches nothing. A word that most of a person's chats share ("india") does not relate a message to them alone.
 */
export const MEMORY_FLOOR = 0.3;
/** Recency orders what relates and never makes anything relate: a chat a month old counts about three quarters as much as one from today, a very old one half. */
const HALF_LIFE_DAYS = 30;
const DAY_MS = 86_400_000;
const MAX_OWNER_CHARS = 100;

/** A chat of the list as the rail and the memory read it: who it belongs to, the words it is found by, whether the person left it out. */
export type MemoryEntry = IndexEntry & { owner?: string; kw?: string; nomem?: true };

/* ---------------------------------------------------------------- the words a chat is found by */

// Little words of English, Hinglish (Hindi in Roman letters) and Hindi, and the general words of research that every chat has: none of them says what a chat is about. The Hinglish list is the one the
// language rules of route.ts use (copied: those lists are not exported, and that file is not this one's to change), with the pronouns and pointers of the follow-up rules; a word that can be a topic
// ("diet", "drug", "cost", "children") is never in it. Words of under three characters are not listed: `contentWords` drops them anyway.
const STOP = new Set(
  (
    "about above after again against all also and any are because been before being below between both but can cannot could did does doing done down during each few for " +
    "from further had has have having her here hers him his how into its just more most nor not off once only other our out over own same she should some such than that " +
    "the their them then there these they this those through too under until very was were what when where which while who whom why will with would you your yours tell " +
    "give show shown find found get got make made please want need know like using use used based new old recent latest current best good better versus via per many much " +
    "lot lots anything something one two three first second third last next previous earlier another else instead still yet ever even really actually maybe around " +
    // the general words of research
    "study studies research paper papers article articles effect effects review reviews analysis role impact evidence result results method methods approach approaches " +
    "data model models system systems trial trials outcome outcomes " +
    // Hinglish
    "mein par tak hai hain hota hoti hote tha thi kya kaise kyun kyon kaun kab kahan kitna kitne kitni nahi nahin aur lekin magar mere mera meri hum humne hamare maine " +
    "tum aap karo kar karna karke kare kiya kiye chahiye dikhao dikha batao bata bataiye batayiye dhundo dhoondo khojo samjhao likho likhna dekho padho wala wali wale " +
    "yeh woh liye baare bare bhi sirf bahut thoda kuch koi sab abhi phir fir isme usme inme unme kaisa zyada jyada accha achha acche asar upar neeche saath bina jaanch " +
    "jaanchna mujhe tumhe unhe inhe sunao suno chahta chahti raha rahi rahe hoga hogi kaha kaafi kaam nuksan fayda tarah jaise jab agar pehle baad wahi yahi sabhi saare " +
    "saari aise aisa kisi kisne kiska apne apna apni uska uski uske iska iski iske unka unki unke inka inki inke naya nayi tune usne yaar bhai " +
    // Hindi
    "में हैं क्या कैसे कौन कहाँ कितना कितने कितनी नहीं लेकिन मगर मेरे मेरा मेरी तुम करो करना किया चाहिए दिखाओ बताओ बताइए ढूंढो खोजो समझाओ लिखो देखो वाला वाली वाले लिए " +
    "बारे सिर्फ बहुत थोड़ा कुछ कोई अभी फिर इसमें उसमें असर ज़्यादा ज्यादा अच्छा ऊपर नीचे साथ बिना मुझे तुम्हें उन्हें इन्हें रहा रही रहे होगा होगी होता होती होते उसका " +
    "उसकी उसके इसका इसकी इसके उनका उनकी उनके तरह जैसे अगर पहले बाद वही यही सभी सारे सारी ऐसे ऐसा किसी"
  ).split(" "),
);
const TOKEN = /[\p{L}\p{M}\p{N}]+/gu;

/**
 * A word as it is compared: lower case, and for a plain Latin word without its plural and its -ing ("costs" and "cost", "screening" and "screen", "diseases" and "disease", "studies" and "study"). Words
 * that only end alike are kept apart ("analysis", "virus", "class"), as are words of another script. Applied once, to both sides of a comparison; the words that are kept with a chat are not changed by it.
 */
export function wordKey(word: string): string {
  let t = word.toLowerCase();
  if (!/^[a-z0-9]+$/.test(t)) return t;
  if (t.length > 4 && t.endsWith("ies")) t = `${t.slice(0, -3)}y`;
  else if (t.length > 3 && t.endsWith("s") && !/(?:ss|us|is)$/.test(t)) t = t.slice(0, -1);
  if (t.length > 5 && t.endsWith("ing")) t = t.slice(0, -3);
  return t;
}

/**
 * The words of a text that say what it is about: lower case, in the order they first appear, none twice (or in two forms), without little words, general words of research, numbers (a year is not a
 * topic) and anything under three letters. A word with a digit in it (covid19, b12) is kept. Invisible characters are out first, so that a zero-width space does not cut a word in two.
 */
export function contentWords(text: string): string[] {
  if (typeof text !== "string") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of oneLine(text).normalize("NFKC").toLowerCase().match(TOKEN) ?? []) {
    if ([...w].length < 3 || /^\p{N}+$/u.test(w) || STOP.has(w)) continue;
    const k = wordKey(w);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w);
  }
  return out;
}

/**
 * The few words kept with a chat (`kw` on its entry in the list) so that the device can find it later: the words of the person's own questions and of the English words their searches used, the newest
 * questions' first, at most `MEMORY_WORDS` and 400 characters. From `askedTurns` and nothing else, so never from an answer, an Idea Check, a pasted list, small talk or background, and never from a version
 * of a message that was replaced. Empty when the chat has nothing to be found by. Pure.
 */
export function keywordsFor(msgs: readonly ChatMsg[]): string {
  const turns = askedTurns(msgs);
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = turns.length - 1; i >= 0 && out.length < MEMORY_WORDS; i--) {
    for (const w of contentWords(`${turns[i]!.question} ${turns[i]!.searchQuery ?? ""}`)) {
      const k = wordKey(w);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(w);
      if (out.length === MEMORY_WORDS) break;
    }
  }
  while (out.length > 1 && out.join(" ").length > MEMORY_WORD_CHARS) out.pop();
  return out.join(" ");
}

/* ---------------------------------------------------------------- the list of chats, and whose they are */

/**
 * The list of chats as it comes back out of storage (it can hold anything: another build's fields, a hand edit). An entry needs an id, a title and a time; the owner, the words and the exclusion are kept
 * only when they are what they should be, a field that is not known is kept as it is (a newer build's: touching a chat must not lose it), and at most `max` entries are kept, in the order stored.
 */
export function parseIndex(raw: unknown, max: number): MemoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: MemoryEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const { owner, kw, nomem, ...rest } = e as Record<string, unknown>;
    if (typeof rest.id !== "string" || typeof rest.title !== "string" || typeof rest.updatedAt !== "number") continue;
    out.push({
      ...rest,
      id: rest.id,
      title: rest.title,
      updatedAt: rest.updatedAt,
      ...(typeof owner === "string" && owner.length > 0 && owner.length <= MAX_OWNER_CHARS ? { owner } : {}),
      ...(typeof kw === "string" && kw.length > 0 && kw.length <= MEMORY_WORD_CHARS ? { kw } : {}),
      ...(nomem === true ? { nomem: true as const } : {}),
    });
    if (out.length === max) break;
  }
  return out;
}

/**
 * The chats of this browser that belong to whoever is here. A chat is stamped with the id of the person who made it (`owner`); one made before that was kept, or by a visitor, has none, and stays: it
 * becomes the first signed-in person's who opens it.
 * - A chat of a DIFFERENT signed-in person is `dropped` (it goes: that is positive evidence that somebody else is at this browser, the shared-computer case).
 * - When nobody is signed in (`null`) the chats of any person are `held`, not dropped: a session that ends by running out (the cookie lasts 30 days) is not a sign-out, and the person's chats must still be
 *   there when they sign in again. Held chats are not shown, not drawn on and not offered to anyone, and they stay in storage until their person is back or another person signs in. Only an explicit
 *   sign-out and "Delete all" remove them without a person to compare with.
 * While it is not yet known who is here (`undefined`: the page has not asked) nothing is hidden or taken away. Pure; the list it is given is not changed.
 */
export function ownedBy<E extends { owner?: string }>(index: readonly E[], owner: string | null | undefined): { kept: E[]; dropped: E[]; held: E[] } {
  if (owner === undefined) return { kept: [...index], dropped: [], held: [] };
  const kept: E[] = [];
  const dropped: E[] = [];
  const held: E[] = [];
  for (const e of index) (e.owner === undefined || e.owner === owner ? kept : owner === null ? held : dropped).push(e);
  return { kept, dropped, held };
}

/**
 * The list as it is written back when this page can see only part of it: what it shows, then the chats it holds back (those of a person who is not here, and those of another person that a tab with an
 * old idea of who is here cannot see), at most `max` in all. Writing only what a page shows would delete the rest from the browser's list; when there is no room for all of it the held chats go first, the
 * oldest first, and come back as `dropped` so that their records can be deleted with them. Pure.
 */
export function withHeld<E extends { updatedAt: number }>(visible: readonly E[], held: readonly E[], max: number): { list: E[]; dropped: E[] } {
  const room = Math.max(0, max - visible.length);
  const newest = [...held].sort((a, b) => b.updatedAt - a.updatedAt);
  return { list: [...visible, ...newest.slice(0, room)], dropped: newest.slice(room) };
}

/**
 * The chats an open page holds in memory that another tab has since taken out of the list (it deleted one, cleared them, or signed out): they must not stay on this page, where the next save would write them
 * back. A chat being answered here and a private one (never in the list) are not let go.
 */
export function goneFromIndex(held: Iterable<string>, index: readonly { id: string }[], keep: ReadonlySet<string>): string[] {
  const listed = new Set(index.map((e) => e.id));
  return [...held].filter((id) => !listed.has(id) && !keep.has(id));
}

/* ---------------------------------------------------------------- which chats relate to a message */

/** What a message is looked up with. `owner` is who is here (a chat of anyone else is never used); `currentId` the chat the message is being sent in (never drawn on itself). */
export type Recall = { message: string; index: readonly MemoryEntry[]; owner: string | null | undefined; currentId: string | null; now: number };

/** The chats a message may draw on: the rail's latest six, this person's own (a chat with no owner yet is theirs only once they open it), not left out, not the open one. */
function candidates(r: Recall): MemoryEntry[] {
  if (typeof r.owner !== "string") return [];
  return r.index.slice(0, RAIL_CHATS).filter((e) => e.id !== r.currentId && e.nomem !== true && e.owner === r.owner);
}

const keysOf = (text: string): Set<string> => new Set(contentWords(text).map(wordKey));
const ageWeight = (updatedAt: number, now: number): number => 0.5 + 0.5 * 2 ** (-Math.max(0, now - updatedAt) / DAY_MS / HALF_LIFE_DAYS);

/** How many of the person's chats have each word: what makes a rare word weigh more than a common one. At least six chats are assumed, so that two chats that share a word do not make it common. */
function weights(index: readonly MemoryEntry[]): { docs: Map<string, Set<string>>; idf: (key: string) => number; avg: number } {
  const docs = new Map<string, Set<string>>();
  const df = new Map<string, number>();
  for (const e of index) {
    if (!e.kw) continue;
    const keys = new Set(e.kw.split(" ").filter(Boolean).map(wordKey));
    docs.set(e.id, keys);
    for (const k of keys) df.set(k, (df.get(k) ?? 0) + 1);
  }
  const n = Math.max(docs.size, 6);
  const sizes = [...docs.values()].map((d) => d.size);
  return { docs, idf: (k) => Math.log(1 + (n - (df.get(k) ?? 0) + 0.5) / ((df.get(k) ?? 0) + 0.5)), avg: sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 1 };
}

/** The weight of the words a message and a text have in common (`evidence`: what the floor is held against), and the same ordered like BM25 (a short text that holds them counts for more than a long one). */
function overlap(query: ReadonlySet<string>, doc: ReadonlySet<string>, idf: (key: string) => number, avg: number): { evidence: number; rank: number } {
  let evidence = 0;
  for (const k of query) if (doc.has(k)) evidence += idf(k);
  const k1 = 1.2;
  const b = 0.75;
  return { evidence, rank: (evidence * (k1 + 1)) / (1 + k1 * (1 - b + (b * doc.size) / Math.max(avg, 1))) };
}

/**
 * Which earlier chats a new message relates to: the ids of at most three, the best first. A chat relates when it was drawn on at all (`candidates`) and shares words with the message to at least the floor;
 * the order is how well, then how recent, then the id (so that a tie is not a coin toss). A message with no words of its own, and an unrelated one, relate to nothing. Pure and cheap: it reads the few
 * words kept on each entry, never a chat.
 */
export function recallChats(r: Recall): string[] {
  const query = keysOf(r.message);
  const from = candidates(r);
  if (query.size === 0 || from.length === 0) return [];
  const w = weights(r.index);
  return from
    .flatMap((e) => {
      const doc = w.docs.get(e.id);
      if (!doc) return [];
      const o = overlap(query, doc, w.idf, w.avg);
      return o.evidence >= MEMORY_FLOOR ? [{ e, score: o.rank * ageWeight(e.updatedAt, r.now) }] : [];
    })
    .sort((a, b) => b.score - a.score || b.e.updatedAt - a.e.updatedAt || (a.e.id < b.e.id ? -1 : 1))
    .slice(0, MEMORY_CHATS)
    .map((x) => x.e.id);
}

const hasLetter = (s: string) => /[\p{L}\p{N}]/u.test(s);

/**
 * Questions made fit to be sent as `earlier`, inside what the server reads and keeps (it would refuse the whole message for a question without a word in it): each on one line, nothing invisible, the question
 * and its search words cut to 200 characters on a whole character, an entry without a word dropped, at most three, and the last ones dropped until all of it is at most 800 characters. Only a question and
 * its search words: any other key of what is given is left behind.
 */
export function fitEarlier(list: readonly EarlierQuestion[]): EarlierQuestion[] {
  const out: EarlierQuestion[] = [];
  for (const e of list) {
    const question = typeof e?.question === "string" ? cutWhole(oneLine(e.question), MAX_EARLIER_QUESTION_CHARS).trim() : "";
    if (question.length < 2 || !hasLetter(question)) continue;
    const searchQuery = typeof e.searchQuery === "string" ? cutWhole(oneLine(e.searchQuery), MAX_EARLIER_QUERY_CHARS).trim() : "";
    out.push({ question, ...(searchQuery && hasLetter(searchQuery) ? { searchQuery } : {}) });
    if (out.length === MAX_EARLIER_ENTRIES) break;
  }
  const size = () => out.reduce((n, x) => n + x.question.length + (x.searchQuery?.length ?? 0), 0);
  while (out.length > 1 && size() > MAX_EARLIER_CHARS) out.pop();
  return out;
}

/**
 * The questions to carry for a message, from the chats that relate to it (`recallChats`): each question of those chats (as `found` has them, the person's own, from `askedTurns`) that shares words with the
 * message to at least the floor, the best first, no question twice, at most three, fit for sending. A chat that `recallChats` did not allow is ignored even if it is given. Pure.
 */
export function pickEarlier(r: Recall, found: readonly { id: string; turns: readonly EarlierQuestion[] }[]): EarlierQuestion[] {
  const allowed = new Set(recallChats(r));
  const query = keysOf(r.message);
  if (allowed.size === 0 || query.size === 0) return [];
  const w = weights(r.index);
  const updated = new Map(r.index.map((e) => [e.id, e.updatedAt]));
  const rows = found.flatMap((f) => (allowed.has(f.id) ? f.turns.map((t, at) => ({ t, at, id: f.id, doc: keysOf(`${t.question} ${t.searchQuery ?? ""}`) })) : []));
  if (rows.length === 0) return [];
  const avg = rows.reduce((n, x) => n + x.doc.size, 0) / rows.length;
  const seen = new Set<string>();
  const picked = rows
    .flatMap((x) => {
      const o = overlap(query, x.doc, w.idf, avg);
      return o.evidence >= MEMORY_FLOOR ? [{ ...x, score: o.rank * ageWeight(updated.get(x.id) ?? 0, r.now) }] : [];
    })
    .sort((a, b) => b.score - a.score || (updated.get(b.id) ?? 0) - (updated.get(a.id) ?? 0) || b.at - a.at || (a.t.question < b.t.question ? -1 : 1))
    .filter((x) => {
      const key = oneLine(x.t.question).toLowerCase();
      return seen.has(key) ? false : (seen.add(key), true);
    })
    .map((x) => ({ question: x.t.question, ...(x.t.searchQuery ? { searchQuery: x.t.searchQuery } : {}) }));
  return fitEarlier(picked);
}

/**
 * What a reply that the person has taken a question off ("Remove") may be asked again with: the questions that `now` says would be carried at this moment (what `earlierFor` chooses with the switch, the
 * chip and the chats as they are NOW) and that are still among those the person left on the reply (`left`), in `now`'s order. A question the person removed never comes back, and one that is no longer
 * allowed (the switch is off, the chip is gone, the chat it came from was deleted) is not sent just because it is stored on the reply. Pure.
 */
export function leftOfEarlier(now: readonly EarlierQuestion[], left: readonly EarlierQuestion[]): EarlierQuestion[] {
  const kept = new Set(left.map((q) => q.question));
  return now.filter((q) => kept.has(q.question));
}

/** The last three searches of a chat the person chose to continue from, the newest first (what is to be sent with every message of the new chat), fit for sending. */
export const lastQuestions = (turns: readonly EarlierQuestion[]): EarlierQuestion[] => fitEarlier([...turns].reverse());

/**
 * What a reply says it used from other chats: the questions it was sent with, as many as the server says a model read (`context.earlier`). Nothing when no model read them (the rules settled the message,
 * the person was not signed in, the switch is off at the server) or when none were sent. Defensive about what comes out of storage.
 */
export function earlierUsed(m: AssistantMsg): EarlierQuestion[] {
  const read = m.context?.earlier;
  if (typeof read !== "number" || !(read > 0) || !Array.isArray(m.earlier)) return [];
  return m.earlier.filter((q): q is EarlierQuestion => !!q && typeof q.question === "string" && q.question.trim() !== "").slice(0, Math.floor(read));
}

/* ---------------------------------------------------------------- what is carried for one message */

/**
 * Everything `earlierFor` is told about the message and about this browser. `on` is the switch "Use my earlier chats" (off unless the person turned it on); `from` the chat they chose to continue from (the
 * chip); `index` the list of chats as it is stored NOW; `load` reads one chat's messages (from memory or from the browser's storage) and may fail.
 */
export type EarlierRequest = {
  message: string;
  mode: "auto" | "search";
  anyway?: boolean;
  owner: string | null | undefined;
  /** False when this browser would not keep the chats: there is then nothing to use. */
  kept: boolean;
  on: boolean;
  /** A private chat neither draws on other chats nor is drawn on. */
  isPrivate: boolean;
  from?: { source: string } | null;
  index: readonly MemoryEntry[];
  currentId: string | null;
  now: number;
  load: (id: string) => Promise<readonly ChatMsg[] | null>;
};

/**
 * The questions of other chats to send with ONE message, or none (the usual answer). Only in Auto (the server refuses them in a search the reader chose, and with "anyway"), only for a person who is signed
 * in, only when this browser keeps the chats, never in a private chat. A chat the person CHOSE to continue from gives its last three questions with every message, whatever the message says: it was asked
 * for by name (so it may be one that was left out of memory, or kept before chats had an owner, but never another person's, and never the open chat itself). Otherwise, only with the switch on, and only
 * for a message that a model would read with earlier turns (`needsContext`: one that stands alone is not sent with anything, because nothing would read it), the questions of the chats that relate to it and
 * nothing when none does, in which case no chat is even opened. It never throws: a chat that cannot be read is skipped.
 */
export async function earlierFor(o: EarlierRequest): Promise<EarlierQuestion[]> {
  try {
    if (o.mode !== "auto" || o.anyway || o.isPrivate || !o.kept || typeof o.owner !== "string") return [];
    if (o.from) {
      const e = o.index.find((x) => x.id === o.from!.source);
      if (!e || e.id === o.currentId || (e.owner !== undefined && e.owner !== o.owner)) return [];
      const msgs = await o.load(e.id).catch(() => null);
      return msgs ? lastQuestions(askedTurns(msgs)) : [];
    }
    if (!o.on || !needsContext(o.message)) return [];
    const r: Recall = { message: o.message, index: o.index, owner: o.owner, currentId: o.currentId, now: o.now };
    const ids = recallChats(r);
    if (ids.length === 0) return [];
    const found = await Promise.all(ids.map(async (id) => ({ id, turns: askedTurns((await o.load(id).catch(() => null)) ?? []) })));
    return pickEarlier(r, found);
  } catch {
    return [];
  }
}
