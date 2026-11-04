import { ANSWER_LANGUAGES, MAX_LEFT, MAX_LEFT_CHARS, MAX_LEFT_PERSON, MAX_NOTE_PHRASE, MAX_READING_CHARS, NOTE_KINDS, withoutLeft, type MessageReading as Reading, type NoteKind } from "@scholar/shared";

/**
 * `checkReading(reading, text)` (docs/design/intent-and-state.md, 3.2): runs on the server before a Reading is sent, and is pure. A Reading that fails it is dropped, and the message is searched as written, with the
 * old line and nothing new. What it holds the Reading to is what makes the line the page draws TRUE of the message:
 *  - the fields are exactly those R8 sets (a Reading with a field of a later release, an unknown key, another version, is refused);
 *  - every piece of `left` is an exact piece of the message, in order, at most five (twelve for the personal-details strip, which takes out a word here and there) and at most 40 characters each;
 *  - the topic is exactly the message less those pieces (`withoutLeft`), never empty and never longer than the message; with no piece it is the message itself;
 *  - every note is of a kind of the closed list, once, and a phrase that a note names is an exact piece of the message (at most 60 characters); the personal note names none;
 *  - the answer language, if there is one, is one the router knows;
 *  - the whole holds at most 600 characters.
 */
const KEYS: ReadonlySet<string> = new Set(["v", "source", "topic", "left", "notes", "answerLanguage"]);
const KINDS: ReadonlySet<string> = new Set(NOTE_KINDS);

export function checkReading(reading: Reading, text: string): boolean {
  try {
    if (typeof reading !== "object" || reading === null || typeof text !== "string") return false;
    if (Object.keys(reading).some((k) => !KEYS.has(k))) return false;
    if (reading.v !== 1 || (reading.source !== "rules" && reading.source !== "model" && reading.source !== "resolver")) return false;
    const message = text.replace(/\s+/g, " ").trim();
    if (typeof reading.topic !== "string" || reading.topic === "" || reading.topic.length > message.length) return false;
    if (!Array.isArray(reading.left) || !Array.isArray(reading.notes)) return false;
    const personal = reading.notes.some((n) => n?.kind === "person");
    if (reading.left.length > (personal ? MAX_LEFT_PERSON : MAX_LEFT)) return false;
    if (reading.left.some((p) => typeof p !== "string" || p.trim() === "" || p.length > MAX_LEFT_CHARS)) return false;
    const expected = reading.left.length === 0 ? message : withoutLeft(message, reading.left);
    if (expected === null || reading.topic !== expected) return false;
    const seen = new Set<NoteKind>();
    let chars = reading.topic.length + reading.left.join("").length;
    for (const n of reading.notes) {
      if (typeof n !== "object" || n === null || !KINDS.has(n.kind) || seen.has(n.kind)) return false;
      if (Object.keys(n).some((k) => k !== "kind" && k !== "phrase")) return false;
      seen.add(n.kind);
      if (n.phrase !== undefined) {
        if (typeof n.phrase !== "string" || n.phrase === "" || n.phrase.length > MAX_NOTE_PHRASE || n.kind === "person" || n.kind === "all" || n.kind === "order" || !message.includes(n.phrase)) return false;
        chars += n.phrase.length;
      }
    }
    if (reading.answerLanguage !== undefined && !(ANSWER_LANGUAGES as readonly string[]).includes(reading.answerLanguage)) return false;
    return chars <= MAX_READING_CHARS;
  } catch {
    return false;
  }
}
