/**
 * What the Home page does with the Trending file once it has it (docs/design/chatview-and-trending.md, T1, T4, T9, T10, T12): which chips the row shows and in what order, the facts behind each chip, when a
 * copy kept on the device may be used, what to do with an answer from the server, and what filling the box does to a draft the person has typed. All of it is pure (the page draws it, and keeps nothing
 * that is not here), so it is tested without a browser (trending-row.test.ts).
 *
 * It is imported by its own path and is not in `index.ts`; the page's first-load script carries only what the Home page uses of it.
 */
import { isSinceYear } from "./chat-state";
import { TRENDING_MAX_CHIPS, isFresh, parseTrending, pickChips, type TrendingChip, type TrendingGroupName, type TrendingPayload } from "./trending-client";

/** Chips in the row, and the fewest that make a row: a row of one chip is not shown. */
export const TRENDING_ROW_SIZE = 4;
export const TRENDING_ROW_MIN = 2;
/**
 * A copy of the list kept on the device is used for at most this long (the list itself is good for 48 hours). This is also how long the kill switch can take to reach a device whose fetch keeps failing: the
 * copy is cleared when the server says "disabled" (or the list has run out), and a device that cannot ask, or is not answered within 2.5 s, keeps it. A device that does ask shows the row ONCE more (the
 * screen that is drawn from the copy), then not. A shorter age is a one-line change, at the price of a row that is not there at the first paint (a layout shift the design avoids): the owner's choice.
 */
export const DEVICE_COPY_MAX_AGE_MS = 24 * 3_600_000;

const DAY = 864e5;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A day "YYYY-MM-DD" as a time (UTC midnight), NaN for anything that is not a real day (a parser would roll "02-30" over into March). */
function dayMs(s: unknown): number {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN;
  const t = Date.parse(s);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s ? t : NaN;
}
const isoDay = (t: number): string => new Date(t).toISOString().slice(0, 10);

/** "4 November 2026" for a day "2026-11-04"; null for anything that is not a day. */
export function dateWords(day: unknown): string | null {
  const t = dayMs(day);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * The two windows of dates a chip's counts are made in, as the job counts them (`trendWindows` in trending.ts, which the page does not import: the test holds the two to the same dates): A is 91 days that
 * end 45 days before the day the list is for (the newest weeks are under-indexed), B is the same dates 364 days earlier. Null for a day that is not a day.
 */
export function countWindows(asOf: unknown): { a: { from: string; to: string }; b: { from: string; to: string } } | null {
  const day = dayMs(asOf);
  if (!Number.isFinite(day)) return null;
  const to = day - 45 * DAY;
  const from = to - 90 * DAY;
  const shift = 364 * DAY;
  return { a: { from: isoDay(from), to: isoDay(to) }, b: { from: isoDay(from - shift), to: isoDay(to - shift) } };
}

/** "22 June to 20 September 2026": the year of the start is left out when it is the year of the end. */
function span(w: { from: string; to: string }): string {
  const from = dateWords(w.from)!;
  const to = dateWords(w.to)!;
  return `${w.from.slice(0, 4) === w.to.slice(0, 4) ? from.replace(/ \d{4}$/, "") : from} to ${to}`;
}

/** What a chip's counts are counts of (the job's filter, apps/api/src/trending/openalex.ts `oaFilter`): inside ONE subfield, so the sentence says where; the India list counts papers with an Indian author. */
export type FactChip = Pick<TrendingChip, "a" | "b" | "field"> & { group?: TrendingGroupName };
const where = (chip: FactChip): string => `in one subfield of ${chip.field}`;

/**
 * The two windows of dates, in words, for the whole list: "from 22 June to 20 September 2026, against 23 June to 21 September 2025". Null when the day is not a day.
 */
export function windowWords(asOf: unknown): string | null {
  const w = countWindows(asOf);
  return w ? `from ${span(w.a)}, against ${span(w.b)}` : null;
}

/**
 * The counts behind a chip, as a sentence: "452 journal papers with an abstract, in one subfield of Computer Science, from 22 June to 20 September 2026, against 176 from 23 June to 21 September 2025."
 * Shown as the chip's accessible description, so what the chip is made of can be read, and it says what the numbers are counts OF: the job counts inside one subfield, with an abstract (the same keyword over
 * every subfield has more than twice as many papers, so "journal papers" alone understated the topic); for the India list, papers with an author at an Indian institution. Null when the day is not a day.
 */
export function chipFacts(chip: FactChip, asOf: unknown): string | null {
  const w = countWindows(asOf);
  if (!w) return null;
  const of = chip.group === "in" ? "journal papers with an abstract and an author at an Indian institution" : "journal papers with an abstract";
  return `${chip.a.toLocaleString("en-US")} ${of}, ${where(chip)}, from ${span(w.a)}, against ${chip.b.toLocaleString("en-US")} from ${span(w.b)}.`;
}

/** The short form for the Why panel's list, which says the windows once above it: "452 against 176, in one subfield of Computer Science" (and, for the India list, ", papers with an Indian author"). */
export function chipCounts(chip: FactChip): string {
  return `${chip.a.toLocaleString("en-US")} against ${chip.b.toLocaleString("en-US")}, ${where(chip)}${chip.group === "in" ? ", papers with an Indian author" : ""}`;
}

/** A chip as the row shows it: the file's chip and the list it came from. */
export type ShownChip = TrendingChip & { group: TrendingGroupName };
/**
 * The row: the day the list was made for, that day in words, the day the weekly pool (and so every count) was made, and the chips in the order they are shown. The two days differ by 0 to 13: the
 * file is made every day, the counts once a week.
 */
export type TrendingRow = { asOf: string; poolAsOf: string; updated: string; chips: ShownChip[] };

/** The facts behind a chip of this row, with the dates the counts were really made in (the pool's day, not the file's). Null when the pool's day is not a day. */
export const rowFacts = (row: Pick<TrendingRow, "poolAsOf">, chip: FactChip): string | null => chipFacts(chip, row.poolAsOf);
/** The two windows of this row's counts, in words (the pool's day, not the file's). Null when the pool's day is not a day. */
export const rowWindows = (row: Pick<TrendingRow, "poolAsOf">): string | null => windowWords(row.poolAsOf);

/**
 * The row for a payload, or null when there is none to show: no list, a list that is not fresh (switched off, past `validUntil`, a pool older than 14 days), or fewer than two chips that can be
 * searched. A stale or missing feed is never shown as trending. The chips are today's pick (`pickChips`: by the file's own date, so the same all day and for everybody, and not by the clock).
 * With the Indian sources on, the Indian list comes first and the global list fills the rest; with them off the Indian list is not used. A phrase in both is shown once, in the Indian list's place.
 * A chip whose year is after the year it is now (by the clock given) is left out: the server answers 400 to a year that has not come. Never throws, never changes its input.
 */
export function trendingRow(p: TrendingPayload | null, now: number | Date, india: boolean, size: number = TRENDING_ROW_SIZE): TrendingRow | null {
  try {
    if (!p || typeof p !== "object" || !isFresh(p, now)) return null;
    const year = new Date(+now).getUTCFullYear();
    const usable = (list: unknown): TrendingChip[] =>
      (Array.isArray(list) ? (list as TrendingChip[]) : []).filter((c) => !!c && typeof c.text === "string" && isSinceYear(c.sinceYear) && c.sinceYear <= year).slice(0, TRENDING_MAX_CHIPS);
    const inn = india ? usable(p.groups?.in?.chips) : [];
    const first: ShownChip[] = pickChips(inn, p.asOf, Math.min(size, inn.length)).map((c) => ({ ...c, group: "in" }));
    const shown = new Set(first.map((c) => c.text.toLowerCase()));
    const rest: ShownChip[] = pickChips(usable(p.groups?.global?.chips).filter((c) => !shown.has(c.text.toLowerCase())), p.asOf, size - first.length).map((c) => ({ ...c, group: "global" }));
    const chips = [...first, ...rest];
    return chips.length >= TRENDING_ROW_MIN ? { asOf: p.asOf, poolAsOf: p.poolAsOf, updated: dateWords(p.asOf) ?? p.asOf, chips } : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- the copy kept on the device */

/** What is written to the device: the payload as the page's reader makes it (the contract's fields and nothing else) and when it was kept. Nothing a person did is in it. "" for a payload that is not one. */
export function deviceCopyOf(p: TrendingPayload, now: number): string {
  const clean = parseTrending(p);
  return clean ? JSON.stringify({ savedAt: now, payload: clean }) : "";
}

/**
 * The list kept on the device, or null: nothing kept, text that is not what was written, a time that is not a time or is in the future (a clock that was wrong), older than 24 hours, a payload the reader
 * refuses, or one that is no longer fresh. Never throws.
 */
export function readDeviceCopy(raw: string | null | undefined, now: number | Date): TrendingPayload | null {
  try {
    if (typeof raw !== "string" || raw === "") return null;
    const o = JSON.parse(raw) as { savedAt?: unknown; payload?: unknown } | null;
    const saved = o?.savedAt;
    if (typeof saved !== "number" || !Number.isFinite(saved)) return null;
    const age = +now - saved;
    if (!(age >= 0 && age <= DEVICE_COPY_MAX_AGE_MS)) return null;
    const p = parseTrending(o?.payload);
    return p && isFresh(p, now) ? p : null;
  } catch {
    return null;
  }
}

/**
 * What to do with the server's answer: "save" a fresh list for the next time the page is opened; "clear" the copy on the device when the server says there is no list now (switched off, none, or one that
 * has run out), so that the copy does not outlive the answer it was kept from (it does outlive the kill switch for a device that is not answered: see DEVICE_COPY_MAX_AGE_MS); "ignore" an answer that is not a
 * list at all (a failure, a page that is not ours), which says nothing about the copy.
 */
export function decideFetched(p: TrendingPayload | null, now: number | Date): "save" | "clear" | "ignore" {
  if (!p) return "ignore";
  return isFresh(p, now) ? "save" : "clear";
}

/* ---------------------------------------------------------------- filling the box */

/**
 * What belongs to the text in the box besides the text: `since`, the year a Trending chip said the papers start from ("From 2025 on", a chip beside the box with a button to take it away); `filled`, the exact
 * text the last chip put in the box (so that text which is still exactly that is known not to be the person's); and `undo`, the text (and year) a chip replaced when the box held something the person had
 * written, kept so that it can be put back.
 */
export type Draft = { since: number | null; filled: string | null; undo: { text: string; since: number | null } | null };
export const NO_DRAFT: Draft = { since: null, filled: null, undo: null };

/**
 * A Trending chip is pressed: its exact text goes into the box and sets the year filter, and nothing is sent. A box that holds text the person wrote (or changed after a chip filled it) is replaced, but what was
 * there is kept in `undo` with its year, so that it is never destroyed silently; a box that is empty, or that still holds exactly what an earlier chip put there, keeps nothing new (an earlier draft stays
 * recoverable through a second chip). Returns the new text of the box and the new draft. Pure.
 */
export function fillChip(text: string, d: Draft, chip: { text: string; sinceYear: number }): { text: string; draft: Draft } {
  const theirs = text.trim() !== "" && text !== d.filled;
  return { text: chip.text, draft: { since: chip.sinceYear, filled: chip.text, undo: theirs ? { text, since: d.since } : d.undo } };
}

/** "Put back what I wrote": the kept text, and the draft as it was before the chip (its year included). Null when nothing was kept. */
export function putBack(d: Draft): { text: string; draft: Draft } | null {
  return d.undo ? { text: d.undo.text, draft: { since: d.undo.since, filled: null, undo: null } } : null;
}

/** The year filter and what was kept belong to a box that has text in it: an emptied box starts clean. A box that still has text is left as it is (an edited chip keeps its filter, which stays visible). */
export function reconcileDraft(text: string, d: Draft): Draft {
  return text.trim() === "" && (d.since !== null || d.filled !== null || d.undo !== null) ? NO_DRAFT : d;
}
