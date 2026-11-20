import { flag, type FlagEnv } from "../platform/switches";
import type { EnvPick } from "../platform/env";
import { shareBetaUsers, shareSwitchedOn, type ShareFlagEnv } from "./share-flag";

/**
 * The switch of live presence and live updates in a shared paper (docs/design/paper-live.md, section 2): the Worker variable `LIVE` is `off`, `dark` or `on`, and unset is off. It is read through
 * the registry's reader (src/platform/switches.ts), so a value that is not exactly one of them is off and the KV key `flag:LIVE` can only lower it. It needs SHARE: with SHARE off it is off too.
 *
 *   off   nothing connects: GET /api/v1/documents/:id/live answers 404, no write calls the room, the page is not told `features.live` (byte for byte as before).
 *   dark  only the papers whose OWNER is in SHARE_BETA_USERS (the accounts that may share at SHARE dark; no list of its own to keep), everyone on such a paper sees the others.
 *   on    every paper whose owner may share (SHARE on, or dark and listed).
 */
export type LiveFlagEnv = ShareFlagEnv & FlagEnv & EnvPick<never, "LIVE">;

/** Is LIVE on for anybody (dark or on), with SHARE on for anybody? Off: the route does not exist and nothing is sent to a room. */
export async function liveSwitchedOn(env: LiveFlagEnv | undefined): Promise<boolean> {
  const p = (await flag(env ?? {}, "LIVE")).position;
  return (p === "dark" || p === "on") && (await shareSwitchedOn(env));
}

/** Is the paper of this owner live (its people see each other, and its open windows get the changes)? */
export async function liveOnFor(env: LiveFlagEnv | undefined, ownerId: string): Promise<boolean> {
  const r = await flag(env ?? {}, "LIVE");
  if (r.position !== "on" && !(r.position === "dark" && shareBetaUsers(env).includes(ownerId))) return false;
  const s = await flag(env ?? {}, "SHARE");
  return s.position === "on" || (s.position === "dark" && shareBetaUsers(env).includes(ownerId));
}
