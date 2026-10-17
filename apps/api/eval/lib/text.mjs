// Shared by the dataset builders and the eval harness (plain .mjs so both node scripts and vitest can import it).

/** Crossref titles can contain markup and line breaks: "<scp>COVID</scp>\n ‐19 ...". */
export function cleanTitle(t) {
  return t
    .replace(/<[^>]+>/g, "")
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\s+-\s*(?=\d)/g, "-") // "COVID -19" left behind after stripping the <scp> tag
    .trim();
}

/** What a researcher would type: the original title, without the publisher's "RETRACTED:" banner. */
export function stripRetractionBanner(t) {
  return t.replace(/^(retracted( article)?|retraction( notice)?)\s*[:\-–]\s*/i, "").trim();
}

const initials = (given) =>
  (given ?? "")
    .split(/[\s.-]+/)
    .filter(Boolean)
    .map((g) => g[0].toUpperCase() + ".")
    .join(" ");
const initialsCompact = (given) => (given ?? "").split(/[\s.-]+/).filter(Boolean).map((g) => g[0].toUpperCase()).join("");

export const REF_STYLES = ["apa+doi", "apa", "ieee+doi", "vancouver", "messy"];

/**
 * A reference string as a scholar might paste it, in five formats. Index decides the format so the dataset mixes styles:
 * two with a DOI, three without (the verifier then has to find the paper from the text alone).
 */
export function formatRef(p, i) {
  const style = REF_STYLES[i % REF_STYLES.length];
  const a = p.authors;
  switch (style) {
    case "apa+doi":
    case "apa": {
      const names = a.map((x) => (x.given ? `${x.family}, ${initials(x.given)}` : x.family));
      const list = names.length > 1 ? `${names.slice(0, -1).join(", ")}, & ${names.at(-1)}` : names[0];
      return `${list} (${p.year}). ${p.title}. ${p.venue ?? ""}.${style === "apa+doi" ? ` https://doi.org/${p.doi}` : ""}`.replace(/\s+\./g, ".");
    }
    case "ieee+doi": {
      const names = a.slice(0, 3).map((x) => `${initials(x.given)} ${x.family}`.trim());
      const list = a.length > 3 ? `${names[0]} et al.` : names.join(", ");
      return `${list}, “${p.title},” ${p.venue ?? ""}, ${p.year}, doi: ${p.doi}.`;
    }
    case "vancouver": {
      const names = a.slice(0, 6).map((x) => `${x.family} ${initialsCompact(x.given)}`.trim());
      return `${names.join(", ")}${a.length > 6 ? ", et al" : ""}. ${p.title}. ${p.venue ?? ""}. ${p.year}.`;
    }
    default:
      return `${a[0].family} et al., ${p.title}, ${p.venue ?? ""} ${p.year}`;
  }
}
