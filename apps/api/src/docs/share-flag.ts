import { flag, type FlagEnv } from "../platform/switches";
import type { EnvPick } from "../platform/env";

/**
 * The switch of sharing a paper's workspace (docs/design/paper-share.md, section 8): the Worker variable `SHARE` is `off`, `dark` or `on`, and unset is off. It is read through the registry's
 * reader (src/platform/switches.ts), so a value that is not exactly one of them is off and the KV key `flag:SHARE` can only lower it.
 *
 *   off   nothing of it exists: its routes answer 404, a paper is its owner's alone, the page shows no Share button (byte for byte as before).
 *   dark  the accounts named in `SHARE_BETA_USERS` may share their papers; the people they share with need not be named (a paper is shared when its OWNER may share).
 *   on    everyone may share.
 */
export type ShareFlagEnv = FlagEnv & EnvPick<never, "SHARE" | "SHARE_BETA_USERS">;

export const shareBetaUsers = (env: ShareFlagEnv | undefined): string[] => (env?.SHARE_BETA_USERS ?? "").split(/[\s,]+/).filter(Boolean);

/** Is sharing on for anybody (dark or on)? Off, its routes do not exist and no paper is shared. */
export async function shareSwitchedOn(env: ShareFlagEnv | undefined): Promise<boolean> {
  const p = (await flag(env ?? {}, "SHARE")).position;
  return p === "dark" || p === "on";
}

/** May this account share its papers (and are the papers it shared open to the people it named)? */
export async function shareOnFor(env: ShareFlagEnv | undefined, ownerId: string): Promise<boolean> {
  const r = await flag(env ?? {}, "SHARE");
  return r.position === "on" || (r.position === "dark" && shareBetaUsers(env).includes(ownerId));
}
