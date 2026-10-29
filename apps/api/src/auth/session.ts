import { randomToken, sha256Hex } from "./oauth";
import type { ProviderId } from "./providers";
import type { SessionUser } from "./users";

export const SESSION_TTL_SECONDS = 30 * 24 * 3600;
/** Cookie name "sid"; on HTTPS it is sent with the __Host- prefix (Secure, Path=/, no Domain). */
export const SESSION_COOKIE = "sid";

/** The browser holds a random token; the database only holds its SHA-256, so a DB leak yields no usable cookies. */
export async function createSession(db: D1Database, userId: string, userAgent: string | undefined): Promise<string> {
  const token = randomToken(32);
  await db
    .prepare("INSERT INTO sessions (id, user_id, expires_at, user_agent) VALUES (?1, ?2, datetime('now', ?3), ?4)")
    .bind(await sha256Hex(token), userId, `+${SESSION_TTL_SECONDS} seconds`, userAgent?.slice(0, 200) ?? null)
    .run();
  return token;
}

type Row = {
  id: string;
  name: string | null;
  email: string | null;
  orcid: string | null;
  avatar_url: string | null;
  role: SessionUser["role"];
  privacy_ack: string | null;
  stale: number;
  providers: string | null;
};

export async function userFromSession(db: D1Database, token: string | undefined): Promise<SessionUser | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const sid = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT u.id, u.name, u.email, u.orcid, u.avatar_url, u.role, u.privacy_ack,
              (s.last_seen_at < datetime('now', '-1 day')) AS stale,
              (SELECT group_concat(DISTINCT provider) FROM identities WHERE user_id = u.id) AS providers
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ?1 AND s.expires_at > datetime('now') AND u.deleted_at IS NULL`,
    )
    .bind(sid)
    .first<Row>();
  if (!row) return null;

  // Slide the session only when it is a day old: keeps D1 writes low.
  if (row.stale) {
    await db
      .prepare("UPDATE sessions SET last_seen_at = datetime('now'), expires_at = datetime('now', ?2) WHERE id = ?1")
      .bind(sid, `+${SESSION_TTL_SECONDS} seconds`)
      .run();
  }
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    orcid: row.orcid,
    avatarUrl: row.avatar_url,
    role: row.role,
    providers: row.providers ? (row.providers.split(",") as ProviderId[]) : [],
    privacyAck: row.privacy_ack,
  };
}

export async function destroySession(db: D1Database, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.prepare("DELETE FROM sessions WHERE id = ?1").bind(await sha256Hex(token)).run();
}
