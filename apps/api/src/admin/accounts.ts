/**
 * Finding the account an admin means to erase (for someone who cannot sign in to delete it themselves). By e-mail address or ORCID iD only: those are
 * what a person can tell us. What was typed is used for one lookup and is never stored or logged.
 */
export type AccountRef = { kind: "email"; value: string } | { kind: "orcid"; value: string };

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const ORCID = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;
const ORCID_URL = /^https?:\/\/(?:www\.)?orcid\.org\/(\d{4}-\d{4}-\d{4}-\d{3}[\dXx])\/?$/i;

export function parseAccountRef(input: unknown): AccountRef | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (s.length < 5 || s.length > 254) return null;
  const url = ORCID_URL.exec(s);
  if (url) return { kind: "orcid", value: url[1]!.toUpperCase() };
  if (ORCID.test(s.toUpperCase())) return { kind: "orcid", value: s.toUpperCase() };
  if (EMAIL.test(s)) return { kind: "email", value: s.toLowerCase() };
  return null;
}

export type Found = { id: string; role: "scholar" | "professor" | "admin" };

/** The one account that has this address or iD (both are unique among accounts that are not deleted). */
export async function findAccount(db: D1Database, ref: AccountRef): Promise<Found | null> {
  const sql = ref.kind === "email" ? "SELECT id, role FROM users WHERE lower(email) = ?1 AND deleted_at IS NULL" : "SELECT id, role FROM users WHERE orcid = ?1 AND deleted_at IS NULL";
  return (await db.prepare(sql).bind(ref.value).first<Found>()) ?? null;
}
