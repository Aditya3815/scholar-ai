import { crossrefHeaders } from "./crossref";
import { normalizeDoi } from "./normalize";
import type { SearchEnv } from "./types";

type NoticeItem = { "update-to"?: { DOI?: string; type?: string }[] };

/**
 * Ek Crossref call mein sab DOIs ka retraction check (Retraction Watch data Crossref mein hai).
 * `updates:<doi>` ek hi naam ke filters OR hote hain, `update-type:retraction` se AND.
 * Result: retraction notices; unke `update-to` mein retracted paper ka DOI hota hai.
 */
export async function findRetracted(
  dois: string[],
  env: SearchEnv,
  signal: AbortSignal,
): Promise<string[]> {
  // DOI mein comma ho toh filter syntax toot jaata hai; aise rare DOIs skip (unknown rahenge).
  const usable = [...new Set(dois)].filter((d) => !d.includes(","));
  if (usable.length === 0) return [];

  const filter = [...usable.map((d) => `updates:${d}`), "update-type:retraction"].join(",");
  const params = new URLSearchParams({
    filter,
    rows: "100",
    select: "DOI,update-to",
    mailto: env.CROSSREF_MAILTO,
  });
  const res = await fetch(`https://api.crossref.org/works?${params}`, {
    signal,
    headers: crossrefHeaders(env),
  });
  if (!res.ok) throw new Error(`Crossref retraction HTTP ${res.status}`);
  const body = (await res.json()) as { message?: { items?: NoticeItem[] } };

  const retracted = new Set<string>();
  for (const notice of body.message?.items ?? []) {
    for (const u of notice["update-to"] ?? []) {
      const doi = normalizeDoi(u.DOI);
      if (doi && u.type === "retraction" && usable.includes(doi)) retracted.add(doi);
    }
  }
  return [...retracted];
}
