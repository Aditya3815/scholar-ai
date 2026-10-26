/**
 * Reads the text of a paper from JATS XML, the format of PubMed Central and Europe PMC full text. No XML library: what we need is small (the title, the abstract, the licence,
 * and the sections of the body with their paragraphs, tables and figure captions), and a tolerant reader that never throws on a broken file is easier to trust than a strict
 * one. The file is read into a light tree (a broken file is closed where it ends, a stray closing tag is ignored) and the text is taken from the tree.
 *
 * Left out on purpose: the reference list and everything after the body (`<back>`), the numbers of citations ("[1-3]"), formulas (their markup is not text), graphics,
 * and the cells of a table beyond its first 40 rows.
 */
export type JatsSection = {
  /** "Methods" or "Methods > Participants"; null for the paragraphs before the first heading. */
  title: string | null;
  text: string;
};
export type Jats = { title: string | null; abstract: string | null; license: string | null; sections: JatsSection[]; truncated: boolean };

export const MAX_JATS_CHARS = 600_000;
const MAX_TABLE_ROWS = 40;
const MAX_ROW_CHARS = 400;
const MAX_DEPTH = 200;

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ", ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", times: "×", plusmn: "±", deg: "°", micro: "µ", alpha: "α", beta: "β" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1]!.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** The licence as one of a few words: cc0, cc-by, cc-by-sa, cc-by-nc, cc-by-nc-sa, cc-by-nd, cc-by-nc-nd, or "other" for something we cannot place; null for nothing. */
export function normaliseLicense(raw: string | null | undefined): string | null {
  const s = raw?.toLowerCase().replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (/creativecommons\.org\/publicdomain\/zero|\bcc0\b|\bcc[ -]?zero\b|public domain/.test(s)) return "cc0";
  const url = /creativecommons\.org\/licenses\/([a-z-]+)/.exec(s)?.[1];
  const m = /\bcc[ -]?by(?:[ -]?(nc))?(?:[ -]?(sa|nd))?\b/.exec(url ? `cc ${url}` : s);
  if (m) return ["cc-by", m[1], m[2]].filter(Boolean).join("-");
  if (/creative commons attribution/.test(s)) {
    const nc = /non-?commercial/.test(s);
    const sa = /share-?alike/.test(s);
    const nd = /no-?derivs|no derivative/.test(s);
    return ["cc-by", nc ? "nc" : "", sa ? "sa" : "", nd ? "nd" : ""].filter(Boolean).join("-");
  }
  return "other";
}
/** Licences under which the PDF itself may be shown to others (the text is used for answering whatever the licence is). */
export const isPermissiveLicense = (l: string | null | undefined) => l === "cc0" || l === "cc-by" || l === "cc-by-sa";

/* ---------------------------------------------------------------- the tree */

type El = { name: string; attrs: string; kids: (El | string)[] };
const isEl = (n: El | string): n is El => typeof n !== "string";

const attrOf = (attrs: string, name: string): string | undefined => {
  const m = new RegExp(`(?:^|\\s)(?:[\\w-]+:)?${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(attrs);
  return m ? (m[1] ?? m[2]) : undefined;
};

function parseTree(xml: string): El {
  const root: El = { name: "#root", attrs: "", kids: [] };
  const stack: El[] = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)|</gi;
  for (const m of xml.matchAll(re)) {
    const [, cdata, closing, rawName, attrs = "", selfClose, text] = m;
    const top = stack[stack.length - 1]!;
    if (cdata !== undefined) top.kids.push(cdata);
    else if (text !== undefined) top.kids.push(decodeEntities(text));
    else if (rawName) {
      const name = rawName.toLowerCase();
      if (!closing) {
        const el: El = { name, attrs, kids: [] };
        top.kids.push(el);
        if (!selfClose && stack.length < MAX_DEPTH) stack.push(el);
      } else {
        const at = stack.map((e) => e.name).lastIndexOf(name);
        if (at > 0) stack.length = at; // closes it and anything left open inside it; a stray closing tag matches nothing and is ignored
      }
    }
  }
  return root;
}

const find = (el: El, name: string): El | undefined => {
  for (const k of el.kids) {
    if (!isEl(k)) continue;
    const hit = k.name === name ? k : find(k, name);
    if (hit) return hit;
  }
  return undefined;
};
const findAll = (el: El, name: string, out: El[] = []): El[] => {
  for (const k of el.kids) if (isEl(k)) {
    if (k.name === name) out.push(k);
    findAll(k, name, out);
  }
  return out;
};
const child = (el: El, name: string): El | undefined => el.kids.find((k): k is El => isEl(k) && k.name === name);

/** Elements whose content is not part of what a paper says. */
const SKIPPED = new Set(["tex-math", "mml:math", "math", "inline-graphic", "graphic", "media", "object-id", "supplementary-material", "email", "ref-list", "alternatives"]);
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** The text inside an element, as one line: citations to the reference list and formulas are dropped, the rest keeps its words (italics, sub- and superscripts, links). */
function textOf(el: El): string {
  let out = "";
  const walk = (n: El | string) => {
    if (typeof n === "string") {
      out += n;
      return;
    }
    if (SKIPPED.has(n.name) || (n.name === "xref" && attrOf(n.attrs, "ref-type") === "bibr")) return;
    const block = n.name === "p" || n.name === "list-item" || n.name === "title" || n.name === "label";
    if (block) out += " ";
    n.kids.forEach(walk);
    if (block) out += " ";
  };
  walk(el);
  return squash(out);
}

function tableText(table: El): string {
  const lines: string[] = [];
  for (const tr of findAll(table, "tr")) {
    if (lines.length >= MAX_TABLE_ROWS) break;
    const cells = tr.kids.filter((k): k is El => isEl(k) && (k.name === "td" || k.name === "th")).map(textOf).filter(Boolean);
    if (cells.length > 0) lines.push(cells.join(" | ").slice(0, MAX_ROW_CHARS));
  }
  return lines.join("\n");
}

/** A figure or table: its label and caption, and for a table its first rows. */
function floatText(el: El): string {
  const label = child(el, "label");
  const caption = child(el, "caption");
  const head = squash(`${label ? textOf(label) : ""} ${caption ? textOf(caption) : ""}`);
  const table = el.name === "table-wrap" ? find(el, "table") : undefined;
  return [head, table ? tableText(table) : ""].filter(Boolean).join("\n");
}

export function parseJats(xml: string): Jats {
  const root = parseTree(xml);
  const article = find(root, "article") ?? root;

  const titleEl = find(find(article, "title-group") ?? { name: "", attrs: "", kids: [] }, "article-title");
  const title = titleEl ? textOf(titleEl) || null : null;

  // the abstract: the first one that is the paper's own summary (not a table-of-contents blurb or a graphical abstract)
  let abstract: string | null = null;
  for (const a of findAll(article, "abstract")) {
    const type = attrOf(a.attrs, "abstract-type");
    if (type && type !== "summary" && type !== "main") continue;
    const paras = findAll(a, "p").map(textOf).filter(Boolean);
    if (paras.length > 0) {
      abstract = paras.join(" ");
      break;
    }
  }

  // the licence: a link or a type on the element, else the wording of its paragraph
  let license: string | null = null;
  for (const l of [...findAll(article, "license"), ...findAll(article, "license_ref"), ...findAll(article, "ali:license_ref")]) {
    const found = normaliseLicense(attrOf(l.attrs, "href") ?? attrOf(l.attrs, "license-type")) ?? normaliseLicense(textOf(l));
    if (found && (license === null || license === "other")) license = found;
  }

  const sections: JatsSection[] = [];
  let chars = 0;
  let truncated = false;
  const emit = (trail: string[], paras: string[]) => {
    const text = paras.filter(Boolean).join("\n\n").trim();
    paras.length = 0;
    if (!text) return;
    if (chars + text.length > MAX_JATS_CHARS) {
      truncated = true;
      return;
    }
    chars += text.length;
    sections.push({ title: trail.length > 0 ? trail.join(" > ") : null, text });
  };
  const walk = (sec: El, trail: string[]) => {
    const own: string[] = [];
    for (const k of sec.kids) {
      if (!isEl(k)) continue;
      if (k.name === "sec") {
        emit(trail, own); // what came before a sub-section is its own piece, in reading order
        const t = child(k, "title");
        walk(k, [...trail, ...(t && textOf(t) ? [textOf(t)] : [])]);
      } else if (k.name === "p" || k.name === "disp-quote" || k.name === "def-list" || k.name === "list") {
        own.push(textOf(k));
      } else if (k.name === "fig" || k.name === "table-wrap") {
        own.push(floatText(k));
      } else if (k.name === "boxed-text") {
        const t = child(k, "caption") ?? child(k, "title");
        own.push([t ? textOf(t) : "", ...k.kids.filter((x): x is El => isEl(x) && (x.name === "p" || x.name === "list")).map(textOf)].filter(Boolean).join(" "));
      }
    }
    emit(trail, own);
  };
  const body = find(article, "body");
  if (body) walk(body, []);

  return { title, abstract, license, sections, truncated };
}
