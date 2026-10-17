import type { Paper } from "@scholar/shared";

export type CiteStyle = "apa" | "ieee" | "bibtex" | "ris";

export const CITE_STYLES: { id: CiteStyle; label: string }[] = [
  { id: "apa", label: "APA 7" },
  { id: "ieee", label: "IEEE" },
  { id: "bibtex", label: "BibTeX" },
  { id: "ris", label: "RIS" },
];

/*
 * Citations metadata se banti hain, kabhi LLM se nahi. Author names providers se display strings aate hain, isliye
 * given/family heuristic se alag hote hain ("Family, Given" ya "Given Family"). Phase 1: structured names + CSL.
 */
type Name = { family: string; given: string };

function parseName(display: string): Name {
  const s = display.trim().replace(/\s+/g, " ");
  if (s.includes(",")) {
    const [family, given = ""] = s.split(",", 2);
    return { family: family!.trim(), given: given.trim() };
  }
  const parts = s.split(" ");
  if (parts.length === 1) return { family: parts[0]!, given: "" };
  return { family: parts[parts.length - 1]!, given: parts.slice(0, -1).join(" ") };
}

const initials = (given: string) =>
  given
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((g) => `${g[0]!.toUpperCase()}.`)
    .join(" ");

const doiUrl = (p: Paper) => (p.doi ? `https://doi.org/${p.doi}` : null);

function apa(p: Paper): string {
  const names = p.authors.map(parseName).map((n) => (n.given ? `${n.family}, ${initials(n.given)}` : n.family));
  let authors = "";
  if (names.length === 1) authors = names[0]!;
  else if (names.length > 1 && names.length <= 20) authors = `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
  else if (names.length > 20) authors = `${names.slice(0, 19).join(", ")}, ... ${names[names.length - 1]}`;
  const parts = [authors ? `${authors}` : null, `(${p.year ?? "n.d."}).`, `${p.title.replace(/\.$/, "")}.`];
  if (p.venue) parts.push(`${p.venue}.`);
  const url = doiUrl(p);
  if (url) parts.push(url);
  return parts.filter(Boolean).join(" ");
}

function ieee(p: Paper): string {
  const names = p.authors.map(parseName).map((n) => (n.given ? `${initials(n.given)} ${n.family}` : n.family));
  let authors = "";
  if (names.length === 1) authors = names[0]!;
  else if (names.length === 2) authors = `${names[0]} and ${names[1]}`;
  else if (names.length > 2 && names.length <= 6) authors = `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  else if (names.length > 6) authors = `${names[0]} et al.`;
  const bits = [authors ? `${authors},` : null, `"${p.title.replace(/\.$/, "")},"`];
  if (p.venue) bits.push(`${p.venue},`);
  if (p.year) bits.push(`${p.year}${p.doi ? "," : "."}`);
  if (p.doi) bits.push(`doi: ${p.doi}.`);
  return bits.filter(Boolean).join(" ");
}

const bibEscape = (s: string) => s.replace(/([&%$#_])/g, "\\$1");

function bibtex(p: Paper): string {
  const first = p.authors[0] ? parseName(p.authors[0]).family : "anon";
  const word = p.title.match(/[A-Za-z]{4,}/)?.[0] ?? "paper";
  const key = `${first}${p.year ?? ""}${word}`.toLowerCase().replace(/[^a-z0-9]/g, "");
  const fields: [string, string | null][] = [
    ["title", `{${bibEscape(p.title)}}`],
    ["author", p.authors.length ? `{${p.authors.map(parseName).map((n) => (n.given ? `${n.family}, ${n.given}` : n.family)).join(" and ")}}` : null],
    ["journal", p.venue ? `{${bibEscape(p.venue)}}` : null],
    ["year", p.year ? `{${p.year}}` : null],
    ["doi", p.doi ? `{${p.doi}}` : null],
    ["url", doiUrl(p) ? `{${doiUrl(p)}}` : null],
  ];
  const body = fields
    .filter(([, v]) => v)
    .map(([k, v]) => `  ${k} = ${v}`)
    .join(",\n");
  return `@article{${key},\n${body}\n}`;
}

function ris(p: Paper): string {
  const lines = ["TY  - JOUR"];
  for (const a of p.authors) {
    const n = parseName(a);
    lines.push(`AU  - ${n.given ? `${n.family}, ${n.given}` : n.family}`);
  }
  lines.push(`TI  - ${p.title}`);
  if (p.venue) lines.push(`JO  - ${p.venue}`);
  if (p.year) lines.push(`PY  - ${p.year}`);
  if (p.doi) lines.push(`DO  - ${p.doi}`);
  const url = doiUrl(p);
  if (url) lines.push(`UR  - ${url}`);
  lines.push("ER  - ");
  return lines.join("\n");
}

export function formatCitation(p: Paper, style: CiteStyle): string {
  switch (style) {
    case "apa":
      return apa(p);
    case "ieee":
      return ieee(p);
    case "bibtex":
      return bibtex(p);
    case "ris":
      return ris(p);
  }
}
