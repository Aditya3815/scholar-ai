/**
 * Every switch of the Worker, declared once (docs/design/untangle.md, F6), and the readers that every read of a switch goes through: `flag(env, name)` for a gate, `killSwitch(env, name)` for a kill
 * switch. SWITCHES (at the end of this file) says, for each name, its kind, its positions, its KV key and whether the privacy page has a sentence for it (legal-match.test.ts); a reader takes only a
 * name of the registry, and what a name may be set to is read from there, not written at the call. What each switch does is documented on its variable (platform/env.ts).
 *
 * Two kinds:
 *   - gate: unset is off. The variable says where it starts, a value that is not exactly one of its positions is off (and reported), and the KV key `flag:<NAME>` can only lower it. Below.
 *   - kill: on unless the variable says otherwise (a rollback that needs no new code). Whether the variable is read as written or trimmed and in any case, and whether a KV key can lower it, is
 *     the switch's own row of SWITCHES; a kill switch's KV key is read by the code that owns it (Trending reads it in the same KV operation as its file), through `lowerByKey`.
 *
 * This file is platform: it imports nothing (so a Node script loads it as it is, with the types stripped: scripts read SWITCHES for the positions of a run), and `understand/` may import its types
 * (legal-match.test.ts rule 3: it never reaches a network client; it takes the KV namespace as an argument and reads from it).
 */

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

/** What flagOf is told about a flag's middle positions. `flag(env, name)` derives the three from the positions SWITCHES gives the name; only a test of the reader itself writes them. */
export type FlagOptions = {
  /** The flag has a `core` position (the safety lane). */
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

/* ---------------------------------------------------------------- the registry */

/** The positions of a kill switch, lowest first: `dark` (Trending) is the middle one, where the work goes on and nobody is shown it. */
export const KILL_POSITIONS = ["off", "dark", "on"] as const;
export type KillPosition = (typeof KILL_POSITIONS)[number];

type GateSpec = {
  kind: "gate";
  /** The positions the variable may hold, lowest first (the reader always takes off, shadow and on; a middle one is the flag's own). */
  positions: readonly FlagPosition[];
  /** The privacy page has a sentence for this switch, pinned by legal-match.test.ts (FLAG_SENTENCES); false: none is needed today. */
  sentence: boolean;
};
type KillSpec = {
  kind: "kill";
  /** The positions, lowest first; anything else the variable holds (or none) is `on`. */
  positions: readonly KillPosition[];
  /** "exact": only the very text of a position counts (`OFF` is on). "trimmed": spaces around and the case do not matter. */
  read: "exact" | "trimmed";
  /** A KV key whose presence, with any value, lowers the switch to `to`; null: the variable alone. */
  kv: { key: string; to: KillPosition } | null;
  sentence: boolean;
};
export type SwitchSpec = GateSpec | KillSpec;

const gate = <const P extends readonly FlagPosition[]>(positions: P, sentence = false) => ({ kind: "gate", positions, sentence }) as const;

/**
 * Every switch, once. A gate's KV key is `flag:<NAME>` (flagKey); a kill switch's is in its row. What each one does: its variable in platform/env.ts. The order of the rows is not used.
 * A new switch is one row here (and its variable in env.ts); its readers then take the name, and a name that is not here does not compile.
 */
export const SWITCHES = {
  CHAT_COUNTERS: gate(["off", "shadow", "on"]),
  CHAT_FAILPOLICY: gate(["off", "shadow", "on"]),
  /** the safety lane: `core` answers only the unmistakable phrases */
  CHAT_SAFETY: gate(["off", "shadow", "core", "on"]),
  CHAT_CLEAN: gate(["off", "shadow", "on"]),
  /** the relevance floor: `writer` acts only on what the writer reads */
  CHAT_FLOOR: gate(["off", "shadow", "writer", "on"]),
  CHAT_THINK: gate(["off", "shadow", "on"]),
  CHAT_UNDERSTAND: gate(["off", "shadow", "on"], true),
  CHAT_UNDERSTAND_VISITORS: gate(["off", "shadow", "on"], true),
  CHAT_TOOLS: gate(["off", "shadow", "on"], true),
  /** the MCP server: `beta` lets in the accounts of MCP_BETA_USERS; `shadow` is a position the reader takes and the server treats as off */
  MCP: gate(["off", "shadow", "beta", "on"], true),
  MCP_CHECK_CLAIM: gate(["off", "shadow", "beta", "on"]),
  CHAT_JUDGE: { kind: "kill", positions: ["off", "on"], read: "exact", kv: null, sentence: false },
  CHAT_CONTEXT: { kind: "kill", positions: ["off", "on"], read: "exact", kv: null, sentence: false },
  SEARCH_PLAINTEXT: { kind: "kill", positions: ["off", "on"], read: "exact", kv: null, sentence: false },
  /** "off" stops the daily job and hides the list; "dark" runs the job and hides the list; the KV key hides the list and leaves the job running (dark) */
  TRENDING: { kind: "kill", positions: ["off", "dark", "on"], read: "trimmed", kv: { key: "trending:v1:off", to: "dark" }, sentence: false },
} as const satisfies Record<string, SwitchSpec>;

export type SwitchName = keyof typeof SWITCHES;
export type GateName = { [N in SwitchName]: (typeof SWITCHES)[N]["kind"] extends "gate" ? N : never }[SwitchName];
export type KillName = { [N in SwitchName]: (typeof SWITCHES)[N]["kind"] extends "kill" ? N : never }[SwitchName];
/** The positions one switch has. */
export type PositionOf<N extends SwitchName> = (typeof SWITCHES)[N]["positions"][number];

export const SWITCH_NAMES = Object.keys(SWITCHES) as SwitchName[];
export const isSwitchName = (name: unknown): name is SwitchName => typeof name === "string" && Object.prototype.hasOwnProperty.call(SWITCHES, name);

/** The KV key that can lower a switch: `flag:<NAME>` for a gate, the row's key for a kill switch that has one, else null. */
export function kvKeyOf(name: SwitchName): string | null {
  const spec: SwitchSpec = SWITCHES[name];
  return spec.kind === "gate" ? flagKey(name) : (spec.kv?.key ?? null);
}

/** Where a gate stands for this request: flagOf, told the middle positions this name has. Unset is off; an off flag reads nothing from KV. */
export function flag<E extends object>(env: E & FlagEnv, name: GateName, options: Pick<FlagOptions, "now" | "cache"> = {}): Promise<FlagReading> {
  const positions: readonly FlagPosition[] = SWITCHES[name].positions;
  return flagOf(env, name, { ...options, allowCore: positions.includes("core"), allowWriter: positions.includes("writer"), allowBeta: positions.includes("beta") });
}

/** Where a kill switch's variable puts it: a position of its row (read as the row says), and `on` for anything else or nothing. Reads no KV and never throws. */
export function killSwitch<N extends KillName>(env: { readonly [K in N]?: unknown } | undefined, name: N): PositionOf<N> {
  const spec: KillSpec = SWITCHES[name];
  const raw = env?.[name];
  const value = spec.read === "exact" ? raw : typeof raw === "string" ? raw.trim().toLowerCase() : raw;
  return ((spec.positions as readonly unknown[]).includes(value) ? value : "on") as PositionOf<N>;
}

/** A kill switch after its KV key was read: `text` is what the key holds (null or undefined: no key). Present, with any value, lowers it to the row's position; it never raises. */
export function lowerByKey<N extends KillName>(name: N, position: PositionOf<N>, text: unknown): PositionOf<N> {
  const kv = (SWITCHES[name] as KillSpec).kv;
  if (!kv || text === null || text === undefined) return position;
  return (KILL_POSITIONS.indexOf(kv.to) < KILL_POSITIONS.indexOf(position as KillPosition) ? kv.to : position) as PositionOf<N>;
}
