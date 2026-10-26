/**
 * The new look (docs/design/unified-workspace.md, phase W1) is behind a switch until it is approved, so the product everyone uses today does not change under them.
 *   open any page with ?ws=1  to turn the new look on (remembered in this browser)
 *   open any page with ?ws=0  to turn it off again
 * The switch is read once when the page loads; there is nothing on the server.
 */
const KEY = "scholar.ws";

function read(): boolean {
  try {
    const param = new URLSearchParams(location.search).get("ws");
    if (param === "1" || param === "0") {
      if (param === "1") localStorage.setItem(KEY, "1");
      else localStorage.removeItem(KEY);
      const p = new URLSearchParams(location.search);
      p.delete("ws");
      const qs = p.toString();
      history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash);
      return param === "1";
    }
    return localStorage.getItem(KEY) === "1";
  } catch {
    // storage blocked: the switch cannot be remembered, so only the page that carries ?ws=1 shows the new look
    return new URLSearchParams(location.search).get("ws") === "1";
  }
}

export const WORKSPACE: boolean = typeof location === "undefined" ? false : read();

/** What the section of your own papers is called: "My Workspace" in the new look (you draw and highlight on the papers there), "My papers" in the old one. */
export const PAPERS_NAME = WORKSPACE ? "My Workspace" : "My papers";

/** A one-line hand-off from the home box to a tool page that keeps its own draft (read once, then removed). */
const HANDOFF = "scholar.handoff";
export function putHandoff(tool: "verify" | "idea", text: string) {
  try {
    sessionStorage.setItem(HANDOFF, JSON.stringify({ tool, text }));
  } catch {
    /* private mode: the tool opens empty */
  }
}
export function takeHandoff(tool: "verify" | "idea"): string {
  try {
    const raw = sessionStorage.getItem(HANDOFF);
    if (!raw) return "";
    const v = JSON.parse(raw) as { tool?: string; text?: string };
    if (v.tool !== tool) return "";
    sessionStorage.removeItem(HANDOFF);
    return typeof v.text === "string" ? v.text : "";
  } catch {
    return "";
  }
}

/**
 * Things the intro page may promise only once the product does them. Each is switched on in the phase that builds it
 * (docs/design/unified-workspace.md), so the page never says something the product cannot do yet.
 */
export const FEATURES = {
  /** W3: the router and the answers understand Roman-letter Hinglish and Hindi. */
  hinglish: true,
} as const;

/**
 * Built and tested, but set aside for now (decision of 25 Oct): naming the highlight colours, and reading two papers side by side. Their code stays; they are off
 * for everyone. To look at one, put its name in this browser's storage: localStorage.setItem("scholar.parked", "names,split") (the test of each does exactly that).
 */
function parkedOn(name: string): boolean {
  try {
    return (localStorage.getItem("scholar.parked") ?? "").split(",").map((x) => x.trim()).includes(name);
  } catch {
    return false;
  }
}
export const PARKED = {
  colourNames: typeof localStorage === "undefined" ? false : parkedOn("names"),
  splitView: typeof localStorage === "undefined" ? false : parkedOn("split"),
} as const;
