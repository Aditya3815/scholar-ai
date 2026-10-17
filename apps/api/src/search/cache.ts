/** D1 `api_cache` table par chhota read-through cache. Failure cache ka kaam nahi bigadta. */

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function cacheKey(source: string, ...parts: string[]): Promise<string> {
  return `${source}:${(await sha256(parts.join("\u0000"))).slice(0, 32)}`;
}

export async function cached<T>(
  db: D1Database,
  source: string,
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<{ value: T; hit: boolean }> {
  try {
    const row = await db
      .prepare("SELECT payload FROM api_cache WHERE key = ?1 AND expires_at > datetime('now')")
      .bind(key)
      .first<{ payload: string }>();
    if (row) return { value: JSON.parse(row.payload) as T, hit: true };
  } catch (err) {
    console.warn("cache read failed", err);
  }

  const value = await load();

  try {
    await db
      .prepare(
        "INSERT OR REPLACE INTO api_cache (key, source, payload, expires_at) VALUES (?1, ?2, ?3, datetime('now', ?4))",
      )
      .bind(key, source, JSON.stringify(value), `+${ttlSeconds} seconds`)
      .run();
  } catch (err) {
    console.warn("cache write failed", err);
  }
  return { value, hit: false };
}
