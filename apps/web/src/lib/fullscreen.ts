import { useSyncExternalStore } from "react";

/**
 * The browser's full screen (the Fullscreen API), for the reader. What is on screen is asked of the browser, never counted by the page: Esc and the browser's own controls can
 * leave full screen without the page being told, so the page follows `fullscreenchange`. The old Safari names (iPad) are used where the standard ones are missing; an iPhone
 * has neither, and there the page offers no button.
 */
type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitFullscreenEnabled?: boolean; webkitExitFullscreen?: () => Promise<void> | void };
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const fsDoc = () => document as FsDocument;
export const fullscreenAvailable = () => typeof document !== "undefined" && !!(document.fullscreenEnabled || fsDoc().webkitFullscreenEnabled);
const fullscreenOn = () => typeof document !== "undefined" && !!(document.fullscreenElement || fsDoc().webkitFullscreenElement);

const subscribe = (notify: () => void) => {
  document.addEventListener("fullscreenchange", notify);
  document.addEventListener("webkitfullscreenchange", notify);
  return () => {
    document.removeEventListener("fullscreenchange", notify);
    document.removeEventListener("webkitfullscreenchange", notify);
  };
};

/** The whole page, so everything the page shows (menus, dialogs, the palette) is still shown: an element in full screen would hide whatever is drawn outside it. */
export function enterFullscreen() {
  const el = document.documentElement as FsElement;
  try {
    const asked = el.requestFullscreen ? el.requestFullscreen({ navigationUI: "hide" }) : el.webkitRequestFullscreen?.();
    // refused (not from a press, or the page is in a frame): nothing changes, and `fullscreenchange` never comes
    void Promise.resolve(asked).catch(() => {});
  } catch {
    /* the same */
  }
}

export function leaveFullscreen() {
  if (!fullscreenOn()) return;
  try {
    const asked = document.exitFullscreen ? document.exitFullscreen() : fsDoc().webkitExitFullscreen?.();
    void Promise.resolve(asked).catch(() => {});
  } catch {
    /* already out */
  }
}

export const toggleFullscreen = () => (fullscreenOn() ? leaveFullscreen() : enterFullscreen());

/** `available`: the browser allows it here. `on`: it is in full screen now. */
export function useFullscreen() {
  const on = useSyncExternalStore(subscribe, fullscreenOn, () => false);
  return { available: fullscreenAvailable(), on };
}
