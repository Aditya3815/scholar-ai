import type { Profile, ProviderId } from "./providers";

export type SessionUser = {
  id: string;
  name: string | null;
  email: string | null;
  orcid: string | null;
  avatarUrl: string | null;
  role: "scholar" | "professor" | "admin";
  providers: ProviderId[];
};

export type ResolveResult = { userId: string; created: boolean } | { error: "identity_taken" | "link_target_missing" };

/**
 * Finds or creates the user for a verified provider profile.
 *  - Known identity -> that user (or, in link mode, an error if it belongs to someone else).
 *  - Link mode (user already signed in) -> attach the identity to the current user.
 *  - New login -> attach to an existing user ONLY if the provider says the email is verified (Google); otherwise create.
 *    Unverified emails are never stored, so nobody can squat an address they do not own.
 */
export async function resolveUser(
  db: D1Database,
  provider: ProviderId,
  p: Profile,
  linkUserId: string | null,
): Promise<ResolveResult> {
  const existing = await db
    .prepare("SELECT user_id FROM identities WHERE provider = ?1 AND subject = ?2")
    .bind(provider, p.subject)
    .first<{ user_id: string }>();

  if (existing) {
    if (linkUserId && existing.user_id !== linkUserId) return { error: "identity_taken" };
    await db
      .prepare(
        "UPDATE users SET last_login_at = datetime('now'), name = COALESCE(name, ?2), avatar_url = COALESCE(avatar_url, ?3) WHERE id = ?1",
      )
      .bind(existing.user_id, p.name, p.avatarUrl)
      .run();
    return { userId: existing.user_id, created: false };
  }

  if (linkUserId) {
    const target = await db
      .prepare("SELECT id FROM users WHERE id = ?1 AND deleted_at IS NULL")
      .bind(linkUserId)
      .first<{ id: string }>();
    if (!target) return { error: "link_target_missing" };
    await db.batch([
      db.prepare("INSERT INTO identities (provider, subject, user_id) VALUES (?1, ?2, ?3)").bind(provider, p.subject, linkUserId),
      db.prepare("UPDATE users SET orcid = COALESCE(orcid, ?2) WHERE id = ?1").bind(linkUserId, p.orcid),
    ]);
    return { userId: linkUserId, created: false };
  }

  if (p.email && p.emailVerified) {
    const byEmail = await db
      .prepare("SELECT id FROM users WHERE email = ?1 AND deleted_at IS NULL")
      .bind(p.email)
      .first<{ id: string }>();
    if (byEmail) {
      await db.batch([
        db.prepare("INSERT INTO identities (provider, subject, user_id) VALUES (?1, ?2, ?3)").bind(provider, p.subject, byEmail.id),
        db.prepare("UPDATE users SET last_login_at = datetime('now'), orcid = COALESCE(orcid, ?2) WHERE id = ?1").bind(byEmail.id, p.orcid),
      ]);
      return { userId: byEmail.id, created: false };
    }
  }

  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        "INSERT INTO users (id, email, email_verified, name, avatar_url, orcid, last_login_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))",
      )
      .bind(id, p.emailVerified ? p.email : null, p.emailVerified ? 1 : 0, p.name, p.avatarUrl, p.orcid),
    db.prepare("INSERT INTO identities (provider, subject, user_id) VALUES (?1, ?2, ?3)").bind(provider, p.subject, id),
  ]);
  return { userId: id, created: true };
}
