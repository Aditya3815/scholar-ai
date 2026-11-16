/**
 * The Markdown a Notebook text block is written in (docs/design/paper-reader.md, 19.4), and nothing more: headings (#, ##, ###), **bold**, *italic*, <u>underline</u>, ==mark==,
 * "- " and "1. " lists, paragraphs and line breaks. A pure parser from the text to tokens: the page draws the tokens as React elements and never puts an HTML string into the page,
 * so a block cannot run a script and nothing has to be sanitised. Everything else (links, pictures, any other tag) is a token of plain text: it shows as it was typed.
 * A backslash before * = < or \ makes it a plain character. Imports nothing.
 */

export type MdInline = { t: "text"; s: string } | { t: "br" } | { t: "b" | "i" | "u" | "mark"; c: MdInline[] };
export type MdBlock =
  | { t: "h"; level: 1 | 2 | 3; c: MdInline[] }
  | { t: "p"; c: MdInline[] }
  | { t: "ul"; items: MdInline[][] }
  | { t: "ol"; start: number; items: MdInline[][] };

const HEADING = /^(#{1,3}) +(.*)$/;
const BULLET = /^ {0,3}- +(.*)$/;
const NUMBERED = /^ {0,3}(\d{1,9})[.)] +(.*)$/;

/** The marks that wrap text, in the order they are tried at one place: ** before *, so "**" is never read as two italics. */
const MARKS: { open: string; close: string; t: "b" | "i" | "u" | "mark" }[] = [
  { open: "**", close: "**", t: "b" },
  { open: "==", close: "==", t: "mark" },
  { open: "<u>", close: "</u>", t: "u" },
  { open: "*", close: "*", t: "i" },
];
const ESCAPABLE = new Set(["*", "=", "<", "\\"]);

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
    if (m.t === "mark" && /\s/.test(s[j - 1]!)) continue;
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
