/**
 * "Tell me when it is done" for a literature scan, with the browser's own notifications: nothing is sent to a server and no address is needed. It works while the page stays open in a tab
 * (in the background is fine); closing the tab ends it, and the scan itself is found again in the list of the last day's scans. The notification carries counts, never the topic, so it is
 * safe to show on a screen others can see. The choice is kept in this browser; the browser's own permission can take it back at any time.
 */
const KEY = "scholar.notify.scan";

type Support = "unsupported" | "default" | "granted" | "denied";

export function notifySupport(): Support {
  try {
    if (typeof Notification === "undefined") return "unsupported";
    return Notification.permission as Support;
  } catch {
    return "unsupported";
  }
}

export function notifyWanted(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setNotifyWanted(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* a convenience only */
  }
}

/** Asks the browser for permission (it has to follow a click). Resolves with whether notifications may be shown now. */
export async function askNotifyPermission(): Promise<boolean> {
  const now = notifySupport();
  if (now === "granted") return true;
  if (now !== "default") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

/** Shows one notification when the person is not looking at the page. Returns whether it was shown. */
export function showScanNotice(args: { id: string; title: string; body: string }): boolean {
  if (notifySupport() !== "granted" || !document.hidden) return false;
  try {
    const n = new Notification(args.title, { body: args.body, tag: `scan-${args.id}` });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}
