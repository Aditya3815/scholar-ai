/**
 * The Markdown a Notebook text block is written in (docs/design/paper-reader.md, 19.4), and nothing more: headings (#, ##, ###), **bold**, *italic*, ++underline++ (and <u>underline</u>,
 * which notes written before 20 Nov 2026 hold: both are read, the toolbar writes ++), ==mark==,
 * "- " and "1. " lists, paragraphs and line breaks. A pure parser from the text to tokens: the page draws the tokens as React elements and never puts an HTML string into the page,
 * so a block cannot run a script and nothing has to be sanitised. Everything else (links, pictures, any other tag) is a token of plain text: it shows as it was typed.
 * A backslash before * = + < or \ makes it a plain character. Imports nothing.
 */

export type MdInline = { t: "text"; s: string } | { t: "br" } | { t: "b" | "i" | "u" | "mark"; c: MdInline[] };
export type MdBlock =
  | { t: "h"; level: 1 | 2 | 3; c: MdInline[] }
  | { t: "p"; c: MdInline[] }
  | { t: "ul"; items: MdInline[][] }
  | { t: "ol"; start: number; items: MdInline[][] };

const HEADING = /^(#{1,3}) +(?! )(.*)$/;
const BULLET = /^ {0,3}- +(?! )(.*)$/;
const NUMBERED = /^ {0,3}(\d{1,9})[.)] +(?! )(.*)$/;

/** The marks that wrap text, in the order they are tried at one place: ** before *, so "**" is never read as two italics. */
const MARKS: { open: string; close: string; t: "b" | "i" | "u" | "mark" }[] = [
  { open: "**", close: "**", t: "b" },
  { open: "==", close: "==", t: "mark" },
  { open: "++", close: "++", t: "u" },
  { open: "<u>", close: "</u>", t: "u" },
  { open: "*", close: "*", t: "i" },
];
const ESCAPABLE = new Set(["*", "=", "+", "<", "\\"]);

const escaped = (s: string, at: number) => s[at - 1] === "\\" && s[at - 2] !== "\\";

/**
 * Where `m` closes after `from`, or -1. A closing mark touches its text (it does not follow a space) and is not escaped. Stars are read by runs: a single * closes an italic, two close a
 * bold, and a run of three or more closes the inner one first ("***x***" is a bold italic, "*a **b***" an italic holding a bold): an italic takes the run's last star, a bold its last two.
 */
function closer(s: string, from: number, m: (typeof MARKS)[number]): number {
  if (m.t === "b" || m.t === "i") {
    for (let a = s.indexOf("*", from); a >= 0; ) {
      let b = a;
      while (s[b] === "*") b++;
      let start = a;
      if (escaped(s, a)) start++;
      const len = b - start;
      const at = m.t === "i" ? (len === 1 || len >= 3 ? b - 1 : -1) : len >= 2 ? b - 2 : -1;
      if (at > from && at >= start && !/\s/.test(s[start - 1] ?? " ")) return at;
      a = s.indexOf("*", b);
    }
    return -1;
  }
  for (let j = s.indexOf(m.close, from); j >= 0; j = s.indexOf(m.close, j + 1)) {
    if (j === from || escaped(s, j)) continue;
    if ((m.t === "mark" || m.open === "++") && /\s/.test(s[j - 1]!)) continue;
    return j;
  }
  return -1;
}

/** The inline tokens of one line or paragraph (line breaks inside it are given as "\n"). */
export function parseInline(s: string): MdInline[] {
  const out: MdInline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", s: buf });
    buf = "";
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === "\\" && i + 1 < s.length && ESCAPABLE.has(s[i + 1]!)) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (ch === "\n") {
      flush();
      out.push({ t: "br" });
      i++;
      continue;
    }
    let matched = false;
    for (const m of MARKS) {
      if (!s.startsWith(m.open, i)) continue;
      const inner = i + m.open.length;
      // an opening mark touches its text ("2 * 3" is not italic)
      if (inner >= s.length || (m.open !== "<u>" && /\s/.test(s[inner]!))) continue;
      const j = closer(s, inner, m);
      if (j < 0) continue;
      flush();
      out.push({ t: m.t, c: parseInline(s.slice(inner, j)) });
      i = j + m.close.length;
      matched = true;
      break;
    }
    if (matched) continue;
    buf += ch;
    i++;
  }
  flush();
  return out;
}

/** The blocks of a text: headings, lists (a run of items of one kind) and paragraphs (lines together, kept as line breaks), parted by blank lines. */
export function parseNotebookMd(md: string): MdBlock[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: MdBlock[] = [];
  let para: string[] = [];
  const endPara = () => {
    if (para.length) out.push({ t: "p", c: parseInline(para.join("\n")) });
    para = [];
  };
  for (const line of lines) {
    const h = HEADING.exec(line);
    const ul = BULLET.exec(line);
    const ol = NUMBERED.exec(line);
    if (!line.trim()) {
      endPara();
      continue;
    }
    if (h) {
      endPara();
      out.push({ t: "h", level: h[1]!.length as 1 | 2 | 3, c: parseInline(h[2]!.trim()) });
      continue;
    }
    if (ul || ol) {
      endPara();
      const last = out[out.length - 1];
      if (ul) {
        if (last?.t === "ul") last.items.push(parseInline(ul[1]!));
        else out.push({ t: "ul", items: [parseInline(ul[1]!)] });
      } else {
        if (last?.t === "ol") last.items.push(parseInline(ol![2]!));
        else out.push({ t: "ol", start: Number(ol![1]), items: [parseInline(ol![2]!)] });
      }
      continue;
    }
    para.push(line);
  }
  endPara();
  return out;
}

/** The text of tokens without their marks (a block's name for a screen reader, the page picker's first words). */
export function mdPlainText(md: string): string {
  const flat = (c: MdInline[]): string => c.map((x) => (x.t === "text" ? x.s : x.t === "br" ? " " : flat(x.c))).join("");
  return parseNotebookMd(md)
    .map((b) => (b.t === "h" || b.t === "p" ? flat(b.c) : b.items.map(flat).join(" ")))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The text of a block exactly as the page puts it into the DOM (`element.textContent` of what MdView draws): every text token, in order, with nothing between them (a line break is an
 * element with no text, and list numbers and bullets are CSS). Ink on notes (25) keeps its anchors as offsets in it, so the screen, the PDF and the Word file read them alike.
 */
export function mdPlain(md: string): string {
  const flat = (c: MdInline[]): string => c.map((x) => (x.t === "text" ? x.s : x.t === "br" ? "" : flat(x.c))).join("");
  return parseNotebookMd(md)
    .map((b) => (b.t === "h" || b.t === "p" ? flat(b.c) : b.items.map(flat).join("")))
    .join("");
}

/* ---------------------------------------------------------------- the source, styled (the text field while it is written in) */

/** A piece of a block's source: its characters as typed, whether they are a mark (drawn faint), and the styles of the text it is in. Together the pieces are the source, character for character. */
export type MdRun = { s: string; mark: boolean; b: boolean; i: boolean; u: boolean; hl: boolean; h: boolean };
type Style = Omit<MdRun, "s" | "mark">;
const PLAIN: Style = { b: false, i: false, u: false, hl: false, h: false };

function sourceInline(s: string, st: Style, out: MdRun[]) {
  let buf = "";
  const flush = () => {
    if (buf) out.push({ s: buf, mark: false, ...st });
    buf = "";
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === "\\" && i + 1 < s.length && ESCAPABLE.has(s[i + 1]!)) {
      flush();
      out.push({ s: "\\", mark: true, ...st });
      buf += s[i + 1];
      i += 2;
      continue;
    }
    let matched = false;
    for (const m of MARKS) {
      if (!s.startsWith(m.open, i)) continue;
      const inner = i + m.open.length;
      if (inner >= s.length || (m.open !== "<u>" && /\s/.test(s[inner]!))) continue;
      const j = closer(s, inner, m);
      if (j < 0) continue;
      flush();
      const next = { ...st, [m.t === "mark" ? "hl" : m.t]: true };
      out.push({ s: m.open, mark: true, ...st });
      sourceInline(s.slice(inner, j), next, out);
      out.push({ s: m.close, mark: true, ...st });
      i = j + m.close.length;
      matched = true;
      break;
    }
    if (matched) continue;
    buf += ch;
    i++;
  }
  flush();
}

/**
 * The source of a block as styled pieces, line by line, for the text field while it is written in: the page draws them under the field (whose own letters are clear), so the marks show faint
 * and the text they wrap shows underlined, marked or bold at once, and every character keeps its place (nothing is added or taken away, so the cursor stays where it is drawn).
 * A line's heading or list sign is a mark too. Paragraphs are read line by line here (a mark does not run over a line's end while it is typed).
 */
/** A line's sign with all the spaces after it, counted by hand (a regular expression with " +" here is slow on a long run of spaces, CodeQL). */
function withSpaces(line: string, m: RegExpExecArray | null): string {
  if (!m) return "";
  let end = m[0].length;
  while (line.charCodeAt(end) === 32) end++;
  return line.slice(0, end);
}

export function mdSourceRuns(md: string): MdRun[][] {
  return md.split("\n").map((line) => {
    const out: MdRun[] = [];
    const h = HEADING.exec(line);
    const lead = withSpaces(line, h ? /^#{1,3} /.exec(line) : /^ {0,3}(?:-|\d{1,9}[.)]) /.exec(line));
    if (lead) out.push({ s: lead, mark: true, ...PLAIN });
    sourceInline(line.slice(lead.length), { ...PLAIN, h: !!h }, out);
    return out;
  });
}

/* ---------------------------------------------------------------- a cursor in the source, in the text as drawn (another person's caret, docs/design/paper-live.md, 9) */

/**
 * Where a cursor in a block's source (`at`, an offset into its Markdown, as a text field gives it) falls in the text as drawn (mdPlain, what MdView puts into the DOM): the offset of the
 * character it stands before, and `after` when it ends a line (it is drawn after the character before it, so a cursor at a line's end stays on that line, and at the end of the text).
 * An offset past the source is its end. The source's characters are matched to the text in order, its marks skipped (mdSourceRuns says which they are); a cursor inside a mark goes to
 * the character after it. Never inside a character drawn as one with the one before it (a Devanagari vowel sign, a surrogate's second half).
 */
export function mdCaret(md: string, at: number): { at: number; after: boolean } {
  const plain = mdPlain(md);
  const shown = new Uint8Array(md.length);
  let i = 0;
  for (const line of mdSourceRuns(md)) {
    for (const r of line) {
      if (!r.mark) shown.fill(1, i, i + r.s.length);
      i += r.s.length;
    }
    i++;
  }
  // each character of the text at the first source character after the one before it: only those shown, else (a mark read across lines in a paragraph) any
  const match = (only: boolean): number[] | null => {
    const pos: number[] = [];
    for (let k = 0, j = 0; k < plain.length; k++, j++) {
      while (j < md.length && (md[j] !== plain[k] || (only && !shown[j]))) j++;
      if (j >= md.length) return null;
      pos.push(j);
    }
    return pos;
  };
  const pos = match(true) ?? match(false) ?? [];
  const a = Math.max(0, Math.min(Math.trunc(at) || 0, md.length));
  let p = 0;
  while (p < pos.length && pos[p]! < a) p++;
  while (p < plain.length && p > 0 && /[\p{M}\uDC00-\uDFFF]/u.test(plain[p]!)) p++;
  const after = p > 0 && (p >= pos.length || md.slice(a, pos[p]).includes("\n"));
  return { at: p, after };
}
