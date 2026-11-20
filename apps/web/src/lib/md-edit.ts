/**
 * The Notebook's formatting toolbar, as pure functions of a text field's value and selection (docs/design/paper-reader.md, 19.4): each takes { value, start, end } and gives the new value
 * and the selection to put back. Bold, italic, underline and mark wrap the selection, or unwrap it when it is wrapped already (the marks just outside it, or at its two ends); with nothing
 * selected they put an empty pair with the cursor inside, or take an empty pair away. Heading and the two lists act on whole lines. Enter at the end of a list item continues the list;
 * Enter on an empty item ends it. The Markdown is packages/shared/src/notebook-md.ts's.
 */
export type Edit = { value: string; start: number; end: number };
export type Mark = "b" | "i" | "u" | "mark";

const PAIR: Record<Mark, [string, string]> = { b: ["**", "**"], i: ["*", "*"], u: ["++", "++"], mark: ["==", "=="] };
/** Underline as notes written before 20 Nov 2026 hold it: read, and taken away by the toolbar, but never written. */
const OLD_U: [string, string] = ["<u>", "</u>"];

/** How many stars stand just before `at` (looking left) or from `at` (looking right). */
const starsBefore = (s: string, at: number) => {
  let n = 0;
  while (at - n - 1 >= 0 && s[at - n - 1] === "*") n++;
  return n;
};
const starsFrom = (s: string, at: number) => {
  let n = 0;
  while (s[at + n] === "*") n++;
  return n;
};

/** Is [start, end) wrapped in `m` from the outside? For stars the run is counted: an italic is 1 or 3 stars, a bold 2 or 3 (a bold italic is both). */
function wrappedOutside(e: Edit, m: Mark, pair: [string, string] = PAIR[m]): boolean {
  const [open, close] = pair;
  if (m === "b" || m === "i") {
    const before = starsBefore(e.value, e.start);
    const after = starsFrom(e.value, e.end);
    const n = Math.min(before, after);
    return m === "b" ? n >= 2 : n === 1 || n >= 3;
  }
  return e.value.slice(e.start - open.length, e.start) === open && e.value.slice(e.end, e.end + close.length) === close;
}

/** Does the selection itself start and end with `m`? */
function wrappedInside(e: Edit, m: Mark, pair: [string, string] = PAIR[m]): boolean {
  const [open, close] = pair;
  const sel = e.value.slice(e.start, e.end);
  if (sel.length < open.length + close.length + 1) return false;
  if (m === "b" || m === "i") {
    const n = Math.min(starsFrom(sel, 0), starsBefore(sel, sel.length));
    return m === "b" ? n >= 2 : n === 1 || n >= 3;
  }
  return sel.startsWith(open) && sel.endsWith(close);
}

/** The marks that are on for this selection (the toolbar's aria-pressed). */
export function activeMarks(e: Edit): Set<Mark> {
  const on = new Set<Mark>();
  for (const m of Object.keys(PAIR) as Mark[]) if (wrappedOutside(e, m) || wrappedInside(e, m)) on.add(m);
  if (wrappedOutside(e, "u", OLD_U) || wrappedInside(e, "u", OLD_U)) on.add("u");
  return on;
}

/** Bold, italic, underline or mark on the selection: wraps it, or unwraps it when it is wrapped. Spaces at the selection's ends stay outside the marks. */
export function toggleMark(e: Edit, m: Mark): Edit {
  // an underline of the old kind is taken away as it is
  if (m === "u" && (wrappedOutside(e, m, OLD_U) || wrappedInside(e, m, OLD_U))) return unwrap(e, OLD_U, wrappedOutside(e, m, OLD_U));
  const [open, close] = PAIR[m];
  const { value } = e;
  if (wrappedOutside(e, m)) {
    return { value: value.slice(0, e.start - open.length) + value.slice(e.start, e.end) + value.slice(e.end + close.length), start: e.start - open.length, end: e.end - open.length };
  }
  if (wrappedInside(e, m)) {
    const inner = value.slice(e.start + open.length, e.end - close.length);
    return { value: value.slice(0, e.start) + inner + value.slice(e.end), start: e.start, end: e.start + inner.length };
  }
  // keep the spaces at the ends outside: "**word **" would not be bold
  let s = e.start;
  let t = e.end;
  while (s < t && /\s/.test(value[s]!)) s++;
  while (t > s && /\s/.test(value[t - 1]!)) t--;
  if (s === t) {
    // nothing selected: an empty pair, the cursor inside
    return { value: value.slice(0, e.start) + open + close + value.slice(e.end), start: e.start + open.length, end: e.start + open.length };
  }
  return { value: value.slice(0, s) + open + value.slice(s, t) + close + value.slice(t), start: s + open.length, end: t + open.length };
}

function unwrap(e: Edit, [open, close]: [string, string], outside: boolean): Edit {
  const { value } = e;
  if (outside) return { value: value.slice(0, e.start - open.length) + value.slice(e.start, e.end) + value.slice(e.end + close.length), start: e.start - open.length, end: e.end - open.length };
  const inner = value.slice(e.start + open.length, e.end - close.length);
  return { value: value.slice(0, e.start) + inner + value.slice(e.end), start: e.start, end: e.start + inner.length };
}

/** The lines the selection touches: where the first starts and where the last ends. */
function lineSpan(e: Edit): [number, number] {
  const from = e.value.lastIndexOf("\n", e.start - 1) + 1;
  let to = e.value.indexOf("\n", Math.max(e.end - (e.end > e.start && e.value[e.end - 1] === "\n" ? 1 : 0), e.start));
  if (to < 0) to = e.value.length;
  return [from, to];
}

/** Replaces the touched lines by `fn(lines)`; the selection covers the new lines. */
function onLines(e: Edit, fn: (lines: string[]) => string[]): Edit {
  const [from, to] = lineSpan(e);
  const lines = e.value.slice(from, to).split("\n");
  const out = fn(lines).join("\n");
  const value = e.value.slice(0, from) + out + e.value.slice(to);
  // one line and a cursor: the cursor moves with the line's start
  if (lines.length === 1 && e.start === e.end) {
    const caret = Math.max(from, e.start + (out.length - lines[0]!.length));
    return { value, start: caret, end: caret };
  }
  return { value, start: from, end: from + out.length };
}

const HEADING = /^#{1,3} /;
const BULLET = /^- /;
const NUMBER = /^\d{1,9}[.)] /;

/** H: the touched lines become a heading (#), or plain lines again when they all are one. */
export function toggleHeading(e: Edit): Edit {
  return onLines(e, (lines) => {
    const all = lines.every((l) => HEADING.test(l) || !l.trim());
    return lines.map((l) => (!l.trim() ? l : all ? l.replace(HEADING, "") : `# ${l.replace(HEADING, "").replace(BULLET, "").replace(NUMBER, "")}`));
  });
}

/** A bullet or a numbered list of the touched lines, or plain lines again when they all are that list already. */
export function toggleList(e: Edit, kind: "ul" | "ol"): Edit {
  const mark = kind === "ul" ? BULLET : NUMBER;
  return onLines(e, (lines) => {
    const full = lines.filter((l) => l.trim());
    const all = full.length > 0 && full.every((l) => mark.test(l));
    let n = 0;
    return lines.map((l) => {
      if (!l.trim()) return l;
      const bare = l.replace(BULLET, "").replace(NUMBER, "").replace(HEADING, "");
      if (all) return bare;
      n++;
      return kind === "ul" ? `- ${bare}` : `${n}. ${bare}`;
    });
  });
}

export function isOn(e: Edit, kind: "h" | "ul" | "ol"): boolean {
  const [from, to] = lineSpan(e);
  const lines = e.value.slice(from, to).split("\n").filter((l) => l.trim());
  const re = kind === "h" ? HEADING : kind === "ul" ? BULLET : NUMBER;
  return lines.length > 0 && lines.every((l) => re.test(l));
}

/**
 * Enter with the cursor at the end of a list item: a new item (the next number for a numbered list). On an item with nothing in it, the item is taken away and the list ends there.
 * null: not a list item, or not at its end, and Enter does what it always does.
 */
export function continueList(e: Edit): Edit | null {
  if (e.start !== e.end) return null;
  const from = e.value.lastIndexOf("\n", e.start - 1) + 1;
  let to = e.value.indexOf("\n", e.start);
  if (to < 0) to = e.value.length;
  if (e.start !== to) return null;
  const line = e.value.slice(from, to);
  const b = /^(\s{0,3})- (.*)$/.exec(line);
  const o = /^(\s{0,3})(\d{1,9})([.)]) (.*)$/.exec(line);
  if (!b && !o) return null;
  const rest = b ? b[2]! : o![4]!;
  if (!rest.trim()) {
    const value = e.value.slice(0, from) + e.value.slice(to);
    return { value, start: from, end: from };
  }
  const next = b ? `\n${b[1]}- ` : `\n${o![1]}${Number(o![2]) + 1}${o![3]} `;
  const value = e.value.slice(0, e.start) + next + e.value.slice(e.start);
  return { value, start: e.start + next.length, end: e.start + next.length };
}
