/**
 * The new look (docs/design/unified-workspace.md, phases W1 to W6) is the product since W6. The switch that kept the old pages until then stays for one release as a way back,
 * and is removed together with the old pages once the new look has been stable (docs/design/w6.md):
 *   open any page with ?ws=0  to use the old pages (remembered in this browser)
 *   open any page with ?ws=1  to return to the new look
 * The switch is read once when the page loads; there is nothing on the server.
 */
const KEY = "scholar.ws";

function read(): boolean {
  try {
    const param = new URLSearchParams(location.search).get("ws");
    if (param === "1" || param === "0") {
      if (param === "0") localStorage.setItem(KEY, "0");
      else localStorage.removeItem(KEY);
      const p = new URLSearchParams(location.search);
      p.delete("ws");
      const qs = p.toString();
      history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash);
      return param === "1";
    }
    return localStorage.getItem(KEY) !== "0";
  } catch {
    // storage blocked: the way back cannot be remembered, so only the page that carries ?ws=0 shows the old pages
    return new URLSearchParams(location.search).get("ws") !== "0";
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
