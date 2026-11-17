import { NOTE_COLORS, type Legend, type NoteColor } from "@scholar/shared";

/**
 * What the four highlight colours mean in the new Paper Reader (docs/design/paper-reader.md, section 5). The stored colour does not change (a highlight still keeps yellow, green, blue or
 * pink, so nothing needs a migration): the meaning is a label put on it. `letter` is shown wherever only a dot would show, so that nobody has to tell the colours apart; `token` is the
 * dot's colour in our own UI, one per theme (tokens.css), at least 3:1 against --surface and --surface-2 (contrast.mjs checks it). The marks on the page keep their own --hl-* colours.
 */
export type Meaning = { color: NoteColor; name: string; letter: string; token: string; hint: string };

export const MEANINGS: Record<NoteColor, Meaning> = {
  yellow: { color: "yellow", name: "Key idea", letter: "K", token: "--mean-key", hint: "a central claim or idea" },
  green: { color: "green", name: "Method", letter: "M", token: "--mean-method", hint: "how it was done" },
  blue: { color: "blue", name: "Question", letter: "Q", token: "--mean-question", hint: "something to ask or check" },
  pink: { color: "pink", name: "Result", letter: "R", token: "--mean-result", hint: "what was found" },
};

/** The meanings in the order of the colours (yellow, green, blue, pink). */
export const MEANING_LIST: Meaning[] = NOTE_COLORS.map((c) => MEANINGS[c]);

/** The meanings as a legend: what the highlights list, its Markdown and a question about the highlights use while the new reader is on screen. */
export const MEANING_LEGEND: Legend = { yellow: MEANINGS.yellow.name, green: MEANINGS.green.name, blue: MEANINGS.blue.name, pink: MEANINGS.pink.name };
