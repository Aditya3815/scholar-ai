// Shrinks and PRIVACY-SCRUBS API responses before they are stored as fixtures (public repository).
//  - keeps only the fields our code reads (smaller file, and nothing incidental is published);
//  - removes every e-mail address: OpenAlex affiliation strings and Crossref author fields carry researchers' contact emails.
// Idempotent: applying it again to an already trimmed body changes nothing.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
export const scrubEmails = (s) => s.replace(EMAIL, "redacted@example.invalid");

export const CROSSREF_KEEP = ["DOI", "title", "author", "issued", "container-title", "update-to", "type", "is-referenced-by-count"];

export function trimBody(url, text) {
  // arXiv answers with an Atom feed, not JSON: the abstracts are not needed to measure recall, so they are not stored
  if (url.includes("export.arxiv.org")) return scrubEmails(text.replace(/<summary>[\s\S]*?<\/summary>/g, "<summary></summary>"));
  try {
    const j = JSON.parse(text);
    if (url.includes("api.openalex.org")) {
      for (const r of j.results ?? []) {
        r.abstract_inverted_index = null;
        if (r.authorships) r.authorships = r.authorships.map((a) => ({ author: { display_name: a?.author?.display_name ?? null } }));
        if (r.primary_location) r.primary_location = { source: { display_name: r.primary_location.source?.display_name ?? null } };
        if (r.open_access) r.open_access = { oa_url: r.open_access.oa_url ?? null };
      }
    }
    if (url.includes("api.semanticscholar.org")) {
      for (const r of j.data ?? []) {
        r.abstract = null;
        if (r.authors) r.authors = r.authors.map((a) => ({ name: a?.name ?? null }));
      }
    }
    if (url.includes("api.crossref.org")) {
      const slim = (it) => {
        const out = Object.fromEntries(Object.entries(it).filter(([k]) => CROSSREF_KEEP.includes(k)));
        if (out.author) out.author = out.author.map((a) => ({ given: a.given, family: a.family, name: a.name }));
        return out;
      };
      if (j.message?.items) j.message.items = j.message.items.map(slim);
      else if (j.message?.DOI) j.message = slim(j.message);
    }
    return scrubEmails(JSON.stringify(j));
  } catch {
    return scrubEmails(text);
  }
}
