import { flagOf, type FlagEnv, type FlagOptions, type FlagReading } from "./flags";

/**
 * CHAT_UNDERSTAND (design of 6 Nov 2026, page 13): `off` | `shadow` | `on`, read through `flagOf` like every switch of the understanding releases: unset is off, a value that is not exactly one of
 * the three is off (and reported as bad), and a KV override (`flag:CHAT_UNDERSTAND` in CACHE) can only lower it. It has no `core` and no `writer` position.
 *
 *   off     today, byte for byte: the Understand step is not called (the golden tests of the stream hold this once it is wired);
 *   shadow  Understand runs beside the rules but the rules decide; only counts are kept (agreement, latency, fallback), never text;
 *   on      Understand decides, with the fail policy's fallback to the rules.
 *
 * Nothing reads it yet: the wiring into the chat route comes after M2 (the ledger and the think event).
 */
export const UNDERSTAND_FLAG = "CHAT_UNDERSTAND";

export type UnderstandEnv = FlagEnv & { CHAT_UNDERSTAND?: string };

export async function understandFlag(env: UnderstandEnv, options: Omit<FlagOptions, "allowCore" | "allowWriter"> = {}): Promise<FlagReading> {
  return flagOf(env, UNDERSTAND_FLAG, { ...options, allowCore: false, allowWriter: false });
}
