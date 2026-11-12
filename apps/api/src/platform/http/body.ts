import type { Context } from "hono";

/** A body read with a limit: over it (`tooLarge`), or what it says. */
export type Read<T> = { tooLarge: true } | { tooLarge: false; value: T };

/**
 * The body as bytes, refused when it is over `maxBytes`: by its Content-Length where it has one, and by counting the bytes as they arrive where it has not (a chunked body has no length, and a
 * length can be a lie); reading stops at the limit. No body is an empty one.
 */
export async function readBytes(c: Context, maxBytes: number): Promise<Read<Uint8Array>> {
  if (Number(c.req.header("content-length") ?? 0) > maxBytes) return { tooLarge: true };
  const reader = c.req.raw.body?.getReader();
  if (!reader) return { tooLarge: false, value: new Uint8Array(0) };
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return { tooLarge: true };
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.byteLength;
  }
  return { tooLarge: false, value: bytes };
}

/** The body as text (UTF-8), with the limit of `readBytes`. */
export async function readText(c: Context, maxBytes: number): Promise<Read<string>> {
  const read = await readBytes(c, maxBytes);
  return read.tooLarge ? read : { tooLarge: false, value: new TextDecoder().decode(read.value) };
}

/**
 * Every JSON body of the API is read here. A body that is not JSON (or no body) is `null`. With `maxBytes` the body is refused over that size, by its length and by counting (`readBytes`), and the
 * route answers `tooLarge` with its own words. Without it the body is read as it always was (Hono's `c.req.json()`): a route with no limit of its own gets none here.
 */
export function readJson(c: Context): Promise<unknown>;
export function readJson(c: Context, maxBytes: number): Promise<Read<unknown>>;
export async function readJson(c: Context, maxBytes?: number): Promise<unknown> {
  if (maxBytes === undefined) return c.req.json().catch(() => null);
  const read = await readText(c, maxBytes);
  if (read.tooLarge) return read;
  try {
    return { tooLarge: false, value: JSON.parse(read.value) as unknown };
  } catch {
    return { tooLarge: false, value: null };
  }
}
