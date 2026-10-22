/**
 * Reference Verifier: types shared by the API and the web app, plus the splitter that turns whatever a scholar pastes
 * (a numbered list, a Word bibliography, a BibTeX file) into one string per reference.
 */

/**
 *  verified      the reference matches a real record: title covered, plus author or year, nothing contradicting
 *  mismatch      a real record resembles it (or its DOI exists) but the details disagree
 *  not_found     nothing in Crossref/OpenAlex matches; a cited DOI that does not resolve ends up here too
 *  unverifiable  we could not decide (databases unreachable, or the record has no authors to compare)
 *  unparsed      too short or not recognisable as a reference
 */
export type RefStatus = "verified" | "mismatch" | "not_found" | "unverifiable" | "unparsed";

export type RefRecord = {
  doi: string | null;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
};

export type RefChecks = {
  /** Share of the record's title words found in the reference text, 0..1. */
  title: number;
  /** true/false = an author does / does not appear in the reference; null = the record has no authors to compare. */
  author: boolean | null;
  year: boolean | null;
};

export type RefVerdict = {
  input: string;
  status: RefStatus;
  reason: string;
  confidence: number;
  match: RefRecord | null;
  checks: RefChecks | null;
  retracted?: boolean;
  cached?: boolean;
};

/** At most this many references are checked per run (each is one request, a few at a time). */
export const MAX_REFERENCES = 60;
export const MAX_REFERENCE_CHARS = 1000;
/** Most references kept from one uploaded paper (surveys and theses can have several hundred), and so the most checked for it. */
export const MAX_PAPER_REFERENCES = 600;

const MARKER = /^\s*(?:\[\s*\d{1,3}\s*\]|\(\s*\d{1,3}\s*\)|\d{1,3}\s*[.)]|[•·▪◦*-])\s+/;
/** "Smith, J." / "Smith, John" / "Kumar, R.K." / "van der Berg, A." */
const AUTHOR_START = /^(?:[\p{Lu}][\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,2}),\s+(?:\p{Lu}\.|\p{Lu}[\p{L}'’-]{2,})/u;
/** Vancouver: "Smith AB, Jones C." */
const VANCOUVER_START = /^[\p{Lu}][\p{L}'’-]+\s+\p{Lu}{1,3}[,.]/u;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** One BibTeX entry's fields, enough to rebuild a readable reference. Handles nested braces such as {{CRISPR}}. */
function bibFields(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z]+)\s*=\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    let i = re.lastIndex;
    const open = body[i];
    let value = "";
    if (open === "{") {
      let depth = 0;
      for (; i < body.length; i++) {
        if (body[i] === "{") depth++;
        else if (body[i] === "}" && --depth === 0) break;
      }
      value = body.slice(re.lastIndex + 1, i);
      re.lastIndex = i + 1;
    } else if (open === '"') {
      const end = body.indexOf('"', i + 1);
      if (end < 0) break;
      value = body.slice(i + 1, end);
      re.lastIndex = end + 1;
    } else {
      const end = body.slice(i).search(/[,\n}]/);
      value = body.slice(i, end < 0 ? undefined : i + end);
      re.lastIndex = i + value.length;
    }
    out[m[1]!.toLowerCase()] = squash(value.replace(/[{}]/g, "").replace(/\\&/g, "&"));
  }
  return out;
}

function fromBibtex(text: string): string[] {
  return text
    .split(/^\s*@(?=\w+\s*\{)/m)
    .slice(1)
    .map((chunk) => {
      const f = bibFields(chunk.slice(chunk.indexOf("{") + 1));
      if (!f.title) return "";
      const authors = f.author ? f.author.split(/\s+and\s+/i).join("; ") : "";
      const venue = f.journal ?? f.booktitle ?? f.publisher ?? "";
      return squash([authors, f.year ? `(${f.year})` : "", f.title + ".", venue ? venue + "." : "", f.doi ? `https://doi.org/${f.doi}` : ""].filter(Boolean).join(" "));
    })
    .filter(Boolean);
}

/** Split pasted text into references. Pure and forgiving: the UI shows what was detected so a wrong split is visible. */
export function splitReferences(raw: string): string[] {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  if (/^\s*@\w+\s*\{/m.test(text)) {
    const bib = fromBibtex(text);
    if (bib.length) return bib;
  }

  const blocks = text.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
  let entries: string[];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  if (blocks.length >= 2 && blocks.length >= lines.length / 4) {
    // Blank lines between entries (typical when copied from Word); lines inside one block are a wrapped entry.
    entries = blocks.map(squash);
  } else if (lines.filter((l) => MARKER.test(l)).length >= 2) {
    // Numbered or bulleted: a marker starts a new entry, other lines continue the previous one.
    entries = [];
    for (const line of lines) {
      if (MARKER.test(line) || entries.length === 0) entries.push(line);
      else entries[entries.length - 1] += " " + line;
    }
  } else {
    const starts = lines.filter((l) => AUTHOR_START.test(l) || VANCOUVER_START.test(l)).length;
    if (starts >= 2 && starts < lines.length) {
      // Wrapped entries without markers: a line that begins like an author list starts a new entry.
      entries = [];
      for (const line of lines) {
        if (AUTHOR_START.test(line) || VANCOUVER_START.test(line) || entries.length === 0) entries.push(line);
        else entries[entries.length - 1] += " " + line;
      }
    } else {
      entries = lines; // one entry per line
    }
  }
  return entries.map((e) => squash(e.replace(MARKER, ""))).filter(Boolean);
}
