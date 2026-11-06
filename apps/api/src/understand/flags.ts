/**
 * Gate flags of the understanding releases (docs/design/intent-and-state.md: P3, 4.0 and H0 item 1). Every new behaviour has one switch with three positions, `off` (today, byte for byte), `shadow`
 * (compute and count, change nothing on the wire) and `on`; the safety lane also has `core`, between `shadow` and `on`, and the relevance floor has `writer` in the same place. The Worker variable says where a flag starts and it is **unset is off**:
 * the release commit sets `shadow` or `on` in the `vars` block of wrangler.jsonc. A value that is not exactly one of the positions (`ON`, `true`, an empty string) is off and reported as a bad value,
 * because a flag turns behaviour on and a typo must not; the case is strict on purpose.
 *
 * A Worker cannot change its own variable, so a tripwire or a breaker acts through KV: the key `flag:<NAME>` in the `CACHE` namespace (the one the public lookups and the Trending switch share; the keys
 * here are not under the cache's `v1:` prefix, so throwing the cache away leaves them alone) holds a position, and the flag stands at the lower of that and the variable. An override can never raise a flag:
 * that takes a deploy. It is read as leniently as a person types it in a hurry (case and spaces do not matter), because it cannot raise whatever it says.
 *
 * Cost, and what the chat path can rely on: with the variable `off` (every flag today) there is no KV read at all, since nothing can be lowered below off. Otherwise one read per name per isolate per 30
 * seconds (requests that ask at the same moment share it), asked with KV's own shortest edge cache (30 s), so an override reaches a place in about a minute. A read that has not answered in
 * FLAG_KV_TIMEOUT_MS is given up on and counts as unreadable, so a KV that hangs costs a request that long once per 30 seconds and not its whole wait. Nothing here throws (for an env object, or none at all:
 * an undefined env is read as an empty one) and nothing writes: a KV that cannot be read leaves the variable as it is (or, if an override was read before, keeps that one until KV answers), and the result
 * says so, for the caller to count. A flag that must act on the wire (a tripwire) uses the result's `position`; counting a bad value, an override or an unreadable KV is the caller's job (R3's counters).
 *
 * A key that holds something that is not a position (`of`, `"off"` with its quotes, an empty string) is ignored and reported as `badOverride`: the flag stays where the variable puts it. Whoever writes an
 * override (the owner in an incident, the scheduled check) reads the key back, or watches that counter, to see that it took. Whether a malformed key should lower the flag to off instead, as the Trending
 * switch does for any present value, is not settled: off is not obviously the safe position for the safety lane, and it is the owner's call (docs/design/intent-and-state.md, 4.2 and 4.5).
 */

/**
 * In order, lowest first: an override can move a flag only to the left. `core` (the safety lane), `writer` (the relevance floor, R9) and `beta` (the MCP server: on for an allowlist of accounts) are each
 * the middle position of ONE flag and are never allowed together for one, so where they stand relative to each other is not used.
 */
export const FLAG_POSITIONS = ["off", "shadow", "beta", "core", "writer", "on"] as const;
export type FlagPosition = (typeof FLAG_POSITIONS)[number];

/** How long an isolate keeps what KV said about one flag, a read that failed included. A read at time t answers every call before t + 30 000 ms; at t + 30 000 the next call reads again. */
export const FLAG_CACHE_MS = 30_000;
/** How long a KV read may take before flagOf gives up on it: well above a normal read (tens of milliseconds), well under what a person waits for the first token. */
export const FLAG_KV_TIMEOUT_MS = 400;
/** KV's `cacheTtl` cannot be under 30 seconds, and a lowering should not wait longer than it must. */
const KV_EDGE_SECONDS = 30;

export const flagKey = (name: string): string => `flag:${name}`;

/** What flagOf uses of a KV namespace, so the Worker's `env.CACHE` fits and a test needs only `get`. */
export type FlagKv = { get(key: string, options: { type: "text"; cacheTtl: number }): Promise<string | null> };
/** What flagOf asks of an env: the KV binding is `CACHE`. A flag's variable is its own name, read from whatever else the env has, so a Worker's `Bindings` (a type alias or an interface) is passed as it is. */
export type FlagEnv = { CACHE?: FlagKv };

type Read = { text: unknown; unreadable: boolean };
type Seen = { at: number; read: Promise<Read>; /** the last text a read of this name returned (null: no key); undefined until one has */ last: unknown };
export type FlagCache = Map<string, Seen>;
/**
 * The isolate's own cache, one per KV namespace object: a Worker has one `env.CACHE` for the life of its isolate, and a test file that builds several never has one answer another. If a runtime ever
 * handed a new binding object to each request, this cache would never hit and each request would read KV (a cost, not a wrong answer); the cache would then be keyed on the name alone again.
 */
let isolateCaches = new WeakMap<FlagKv, FlagCache>();
function isolateCacheOf(kv: FlagKv): FlagCache {
  let cache = isolateCaches.get(kv);
  if (!cache) isolateCaches.set(kv, (cache = new Map()));
  return cache;
}
/** For tests that use the isolate's own cache: forget everything it holds, for every namespace. */
export const resetFlagCache = (): void => {
  isolateCaches = new WeakMap();
};

export type FlagOptions = {
  /** The names whose caller says they have a `core` position (the safety lane): a caller writes one reader per flag, so that this is said once. */
  allowCore?: boolean;
  /** The same for a `writer` position (the relevance floor, R9): only the writer's gate acts, with no reorder and no line; it stands between `shadow` and `on`. */
  allowWriter?: boolean;
  /** The same for a `beta` position (the MCP server, src/mcp/flag.ts: on only for the accounts on an allowlist); it stands between `shadow` and `on`. */
  allowBeta?: boolean;
  /** For a test: the clock (milliseconds) and the cache. */
  now?: () => number;
  cache?: FlagCache;
};

export type FlagReading = {
  /** Where the flag stands: what the code acts on. */
  position: FlagPosition;
  /** What the variable alone says. */
  variable: FlagPosition;
  /** The variable is set to something that is not a position this flag has: it counted as off. */
  badVariable: boolean;
  /** The position the KV override holds, when it was read and is well formed (it may be at or above the variable, and then it changed nothing). */
  override: FlagPosition | null;
  /** The key holds something that is not a position (or is not text): it was ignored. */
  badOverride: boolean;
  /** KV could not be read (it threw or rejected). */
  kvUnreadable: boolean;
};

/** The variable's reading, shared with the disclosure test (legal-match.test.ts) so that "on" in the committed config means what it means in the Worker. Unset (undefined or null) is off and not bad. */
export function positionOfVariable(value: unknown, allowCore: boolean, allowWriter = false, allowBeta = false): { position: FlagPosition; bad: boolean } {
  if (value === undefined || value === null) return { position: "off", bad: false };
  if (value === "off" || value === "shadow" || value === "on" || (allowCore && value === "core") || (allowWriter && value === "writer") || (allowBeta && value === "beta")) return { position: value, bad: false };
  return { position: "off", bad: true };
}

const rank = (p: FlagPosition): number => FLAG_POSITIONS.indexOf(p);

function overrideOf(text: unknown, allowCore: boolean, allowWriter: boolean, allowBeta: boolean): FlagPosition | null {
  if (typeof text !== "string") return null;
  const p = positionOfVariable(text.trim().toLowerCase(), allowCore, allowWriter, allowBeta);
  return p.bad ? null : p.position;
}

/** The KV answer for a name, from the cache while it is younger than FLAG_CACHE_MS. The promise it returns never rejects. */
function readOverride(kv: FlagKv, name: string, now: number, cache: FlagCache): Promise<Read> {
  const seen = cache.get(name);
  const age = seen ? now - seen.at : -1;
  if (seen && age >= 0 && age < FLAG_CACHE_MS) return seen.read;
  const fresh: Seen = { at: now, read: Promise.resolve({ text: null, unreadable: false }), last: seen?.last };
  fresh.read = (async (): Promise<Read> => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      // the loser of the race keeps a handler (the race attaches one), so a late rejection is not an unhandled one
      const timedOut = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("flag read timed out")), FLAG_KV_TIMEOUT_MS);
      });
      const text = await Promise.race([kv.get(flagKey(name), { type: "text", cacheTtl: KV_EDGE_SECONDS }), timedOut]);
      fresh.last = text ?? null;
      return { text: fresh.last, unreadable: false };
    } catch {
      // A read that fails or hangs keeps the last answer that worked, so a tripwire is not let go of because KV blinked; with none, there is no override.
      return { text: fresh.last === undefined ? null : fresh.last, unreadable: true };
    } finally {
      clearTimeout(timer);
    }
  })();
  cache.set(name, fresh);
  return fresh.read;
}

export async function flagOf<E extends object>(env: E & FlagEnv, name: string, options: FlagOptions = {}): Promise<FlagReading> {
  const allowCore = options.allowCore === true;
  const allowWriter = options.allowWriter === true;
  const allowBeta = options.allowBeta === true;
  const vars = (env ?? {}) as Record<string, unknown>; // Hono hands a route an undefined env when a test calls app.request without one (sse.ts reads it the same way)
  const { position: variable, bad } = positionOfVariable(vars[name], allowCore, allowWriter, allowBeta);
  const reading: FlagReading = { position: variable, variable, badVariable: bad, override: null, badOverride: false, kvUnreadable: false };
  const kv = (vars as FlagEnv).CACHE;
  // Nothing can be lowered below off, so an off flag (every flag today) does not read KV.
  if (variable === "off" || !kv) return reading;
  const { text, unreadable } = await readOverride(kv, name, (options.now ?? Date.now)(), options.cache ?? isolateCacheOf(kv));
  reading.kvUnreadable = unreadable;
  if (text === null) return reading;
  const override = overrideOf(text, allowCore, allowWriter, allowBeta);
  if (override === null) {
    reading.badOverride = true;
    return reading;
  }
  reading.override = override;
  if (rank(override) < rank(variable)) reading.position = override;
  return reading;
}
