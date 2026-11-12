import { flag, type FlagEnv } from "../platform/switches";
import type { EnvPick } from "../platform/env";

/**
 * The switch of the new Paper Reader (docs/design/paper-reader.md, section 15): the Worker variable `READER` is `off`, `dark` or `on`, and unset is off. It is read through the registry's reader
 * (src/platform/switches.ts), so a value that is not exactly one of them is off and the KV key `flag:READER` can only lower it.
 *
 *   off   every paper opens in today's reader, as before the new one existed.
 *   dark  the new reader for the accounts named in `READER_BETA_USERS` (account ids, separated by commas or spaces, as MCP_BETA_USERS is read), today's reader for everyone else.
 *   on    the new reader for everyone.
 *
 * Nothing is stored or sent because of it: the page is told `features.reader` on GET /api/v1/documents/:id, the request it already makes for a paper.
 */
export type ReaderFlagEnv = FlagEnv & EnvPick<never, "READER" | "READER_BETA_USERS">;

/** The account ids of the dark position, as the variable lists them. */
export const readerBetaUsers = (env: ReaderFlagEnv | undefined): string[] => (env?.READER_BETA_USERS ?? "").split(/[\s,]+/).filter(Boolean);

/** Does this account get the new reader? */
export async function readerOnFor(env: ReaderFlagEnv | undefined, userId: string): Promise<boolean> {
  const r = await flag(env ?? {}, "READER");
  return r.position === "on" || (r.position === "dark" && readerBetaUsers(env).includes(userId));
}
