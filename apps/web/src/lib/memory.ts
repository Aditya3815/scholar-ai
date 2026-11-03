import { useSyncExternalStore } from "react";

/**
 * "Use my earlier chats" (Settings, under Chats; docs/design/chat-actions-context.md, section 6): off until the person turns it on, and remembered on THIS device like the switch for Indian sources. It is
 * a preference of the device, so it is not removed when chats are cleared or at sign-out (what it controls is read from the chats, which are).
 *
 * One difference from the Indian-sources switch, because this one changes what is SENT: what is stored is the id of the person who turned it on, not a bare "on". Another person who signs in on the same
 * computer finds it off and has to turn it on themselves; without that, their own earlier questions would go to the AI service on a choice they never made. Signed out, it is off.
 *
 * It is on only if the browser really kept the choice. A browser that will not store it (blocked storage, a private window that drops it) leaves it off, and `setEarlierChats` says so, so that the page can
 * tell the person: a switch that looks on and is forgotten at the next visit would be a promise the page cannot keep. Turning it off always takes effect, whether or not the removal could be stored.
 */
const KEY = "scholar.earlier";
const listeners = new Set<() => void>();
/**
 * The one thing this page remembers beside what storage says: that `who` turned it OFF here and the removal could not be stored. Storage is read on every answer, never copied, because what it
 * says can change under an open page (another tab turned it off, or another person signed in and turned it on for themselves) and a copy that kept "on" would send questions the person no longer
 * allows. A copy that kept "off" is harmless, but it is dropped as soon as storage agrees.
 */
let offHere: string | null = null;

const stored = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

/** Whether the person `who` (their account id; `null` or `undefined` when nobody is signed in or it is not known) has turned it on, on this device. */
export const earlierChatsOn = (who: string | null | undefined): boolean => {
  if (typeof who !== "string") return false;
  const value = stored();
  if (value !== who) {
    offHere = null;
    return false;
  }
  return offHere !== who;
};

/** Turn it on or off for `who`. Returns whether it is as asked: false only when it was to be turned on and the browser would not keep it (it stays off). */
export function setEarlierChats(on: boolean, who: string): boolean {
  let kept = true;
  try {
    if (on) localStorage.setItem(KEY, who);
    else localStorage.removeItem(KEY);
    kept = (localStorage.getItem(KEY) === who) === on;
  } catch {
    kept = false;
  }
  // Off must take effect here even when the removal did not stick; on counts only if the browser kept it (storage then says so).
  offHere = !on ? who : null;
  listeners.forEach((l) => l());
  return !on || kept;
}

export const useEarlierChats = (who: string | null | undefined): boolean =>
  useSyncExternalStore(
    (l) => {
      const onStorage = (e: StorageEvent) => {
        if (e.key !== KEY && e.key !== null) return;
        offHere = null;
        l();
      };
      listeners.add(l);
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(l);
        window.removeEventListener("storage", onStorage);
      };
    },
    () => earlierChatsOn(who),
    () => false,
  );
