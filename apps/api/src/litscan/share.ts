import { LITSCAN_MAX_SHARES, viewFromEvents, type LitscanPublic } from "@scholar/shared";
import { fromSqliteTime } from "../library/validate";
import { eventsAfter, itemsOf, type ScanRow } from "./store";

/**
 * A read-only link to a scan (migration 0021). The token is the whole credential, like any shared link, so it is long and random; it is found only through a scan that has not expired, and
 * what it shows is `LitscanPublic`: the topic, the plan, the checked report, the dates. No id, no person, no allowance, no way to change anything.
 */
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type ShareResult = { ok: true; token: string } | { ok: false; reason: "running" | "limit" };

/** Turns sharing on for a scan of this person that has ended. Asking again returns the link that exists. */
export async function createShare(db: D1Database, scan: Pick<ScanRow, "id" | "state">, userId: string): Promise<ShareResult> {
  if (scan.state === "running") return { ok: false, reason: "running" };
  const have = await shareOf(db, scan.id);
  if (have) return { ok: true, token: have };
  const n = await db.prepare("SELECT COUNT(*) AS n FROM litscan_shares s JOIN litscans c ON c.id = s.scan_id WHERE s.user_id = ?1 AND c.expires_at > datetime('now')").bind(userId).first<{ n: number }>();
  if ((n?.n ?? 0) >= LITSCAN_MAX_SHARES) return { ok: false, reason: "limit" };
  const token = newToken();
  // a scan can have one link: if two clicks race, the second insert is ignored and the first link is the one both get
  await db.prepare("INSERT OR IGNORE INTO litscan_shares (token, scan_id, user_id) VALUES (?1, ?2, ?3)").bind(token, scan.id, userId).run();
  return { ok: true, token: (await shareOf(db, scan.id)) ?? token };
}

/** The scan's link, if it has one. */
export async function shareOf(db: D1Database, scanId: string): Promise<string | null> {
  return (await db.prepare("SELECT token FROM litscan_shares WHERE scan_id = ?1").bind(scanId).first<{ token: string }>())?.token ?? null;
}

/** Turns sharing off. Returns whether there was a link. */
export async function revokeShare(db: D1Database, scanId: string, userId: string): Promise<boolean> {
  const r = await db.prepare("DELETE FROM litscan_shares WHERE scan_id = ?1 AND user_id = ?2").bind(scanId, userId).run();
  return (r.meta?.changes ?? 0) > 0;
}

/** What anyone with the link may read; null when the link is wrong, was turned off, or the scan has expired (all look the same). */
export async function publicScan(db: D1Database, token: string): Promise<LitscanPublic | null> {
  if (!SHARE_TOKEN.test(token)) return null;
  const row = await db
    .prepare("SELECT c.* FROM litscan_shares s JOIN litscans c ON c.id = s.scan_id WHERE s.token = ?1 AND c.expires_at > datetime('now')")
    .bind(token)
    .first<ScanRow>();
  if (!row) return null;
  const items = itemsOf(row);
  const view = viewFromEvents(await eventsAfter(db, row.id, 0), items.length);
  return {
    topic: row.topic,
    language: row.language,
    items,
    state: row.state,
    total: items.length,
    parts: Object.values(view.parts).sort((a, b) => a.idx - b.idx),
    createdAt: new Date(fromSqliteTime(row.created_at)).toISOString(),
    expiresAt: new Date(fromSqliteTime(row.expires_at)).toISOString(),
    ...(row.scope === "india" ? { scope: row.scope } : {}),
  };
}
