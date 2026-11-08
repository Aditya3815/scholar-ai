import { useEffect, useSyncExternalStore } from "react";

/**
 * The words a screen reader is told about the conversation ("Answer ready, 5 papers.", "Message copied", "Version 2 of 3"): ONE polite status line for the whole conversation, and not one or more for each of its
 * turns (a conversation of twenty replies had sixty, each mounted already filled when a conversation was opened again, which a screen reader may or may not speak). The line is in the page, empty, from the moment the
 * conversation is, and what is said is written into it a moment after it was emptied: the same words said twice are not read again, so a new message empties the line first and writes it 100 ms later, and the line is
 * emptied again after `keepMs`.
 *
 * Two things said close together do not trample one another: the one that comes later waits until the first has been in the line for `SHOWN_AT_LEAST` ms (long enough to be taken up), and then they follow in
 * the order they were said. Nothing said here is ever kept or sent anywhere; it is the words of the page, for the page.
 */
let words = "";
const listeners = new Set<() => void>();
const write = (next: string) => {
  words = next;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const GAP_MS = 100;
const SHOWN_AT_LEAST = 1200;
type Item = { text: string; keepMs: number; key?: string };
let queue: Item[] = [];
/** The write of the words that are about to be put into the line, and the move to whatever comes after them. */
let writeTimer = 0;
let advanceTimer = 0;
/** When the words now in the line (or about to be) were, or will be, written: 0 while nothing is being said. */
let writtenAt = 0;
/** What is in the line now, or about to be. */
let current: Item | null = null;

/** Say the next thing that waits (empty line first), or empty the line when nothing waits. */
function next() {
  window.clearTimeout(writeTimer);
  window.clearTimeout(advanceTimer);
  const item = queue.shift();
  current = item ?? null;
  if (!item) {
    writtenAt = 0;
    write("");
    return;
  }
  write("");
  writtenAt = performance.now() + GAP_MS;
  writeTimer = window.setTimeout(() => write(item.text), GAP_MS);
  // when something else is already waiting this one is up for only as long as it takes to be taken up
  advanceTimer = window.setTimeout(next, GAP_MS + (queue.length > 0 ? Math.min(item.keepMs, SHOWN_AT_LEAST) : item.keepMs));
}

/**
 * Tell the reader something, politely. With a `key`, words that only matter until the next of their kind (the Thinking block's stage: "Searching…", then "Reading the papers…") replace any of the same
 * key that still wait, so a fast reply does not queue five stage words that would hold back what comes after them ("Answer ready", "Message copied") by seconds.
 */
export function announce(text: string, keepMs = 4000, key?: string) {
  if (!text) return;
  if (key) queue = queue.filter((q) => q.key !== key);
  queue.push({ text, keepMs, key });
  if (writtenAt === 0) return next();
  // something is being said: this waits until that has been in the line long enough (what is about to be written still is)
  window.clearTimeout(advanceTimer);
  advanceTimer = window.setTimeout(next, Math.max(0, writtenAt + SHOWN_AT_LEAST - performance.now()));
}

/** Words of a key are not said any more (the stage words of a reply that has finished): those that wait are dropped, and if such words are in the line now, the line moves on to what comes next at once. */
export function forget(key: string) {
  queue = queue.filter((q) => q.key !== key);
  if (current?.key === key) next();
}

/** Nothing is left over for the next conversation that is shown. */
function reset() {
  window.clearTimeout(writeTimer);
  window.clearTimeout(advanceTimer);
  queue = [];
  current = null;
  writtenAt = 0;
  write("");
}

/** The line itself: one of these, in the conversation. */
export function Announcer() {
  const text = useSyncExternalStore(subscribe, () => words, () => "");
  useEffect(() => reset, []);
  return (
    <p className="sr-only" role="status" aria-live="polite" data-announcer="">
      {text}
    </p>
  );
}
