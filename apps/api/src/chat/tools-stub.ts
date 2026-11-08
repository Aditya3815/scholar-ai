import type { RefVerdict } from "@scholar/shared";

/**
 * Check references, offline (tests and the local end-to-end run only: QA_STUB=1 together with ENABLE_DEV_ROUTES=1, as the chat's stand-in search). The reference's text says what happens:
 *   contains "Invented" or "Fabricated"   not found (no record)
 *   contains "Mismatch"                   a record exists, but its year differs
 *   contains "Unreachable"                the databases could not be reached (the call throws)
 * and every other reference is verified against a record made from its own words. Never used in production: the chat route picks it only with both switches.
 */
export async function stubVerify(input: string): Promise<RefVerdict> {
  await new Promise((r) => setTimeout(r, 30));
  if (/unreachable/i.test(input)) throw new Error("stub: Crossref and OpenAlex down");
  const year = Number(/\b(19|20)\d{2}\b/.exec(input)?.[0] ?? 2020);
  const title = (/[“"]([^”"]{8,})[”"]/.exec(input)?.[1] ?? input.replace(/^[^.]*\.\s*/, "").split(".")[0] ?? input).trim().slice(0, 200);
  const family = /^([\p{Lu}][\p{L}'’-]+)/u.exec(input)?.[1] ?? "Author";
  const match = { doi: `10.5555/ref.${Math.abs(hash(input)) % 100000}`, title, authors: [`A. ${family}`], year, venue: "Journal of Stand-in Records" };
  if (/invented|fabricated/i.test(input)) return { input, status: "not_found", reason: "No record in Crossref or OpenAlex matches this reference.", confidence: 0, match: null, checks: null };
  if (/mismatch/i.test(input)) return { input, status: "mismatch", reason: "A record with this title exists, but its year differs.", confidence: 0.5, match: { ...match, year: year - 3 }, checks: { title: 1, author: true, year: false, yearOff: 3 } };
  return { input, status: "verified", reason: "The record's title, an author and the year match.", confidence: 0.95, match, checks: { title: 1, author: true, year: true } };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
