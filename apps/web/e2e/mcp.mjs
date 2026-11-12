// The MCP server's pages in a real browser: the consent page an AI app sends a person to (written by the Worker, no script) and Settings, Connected apps, with axe on both, in light and dark, on
// a desktop and a phone, and the Disconnect button. Needs the server on: `scripts/integration.mjs --browser --run=mcp-on` starts the Worker with MCP=on and a local OAUTH_KV (production's "beta", the default run, skips it). Pictures go to e2e/shots/ (or SHOTS_DIR).
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { BASE, at, axeCheck, countFailure, desk, finish, launch, ok, startIdp } from "./lib/browser.mjs";

const OUT = process.env.SHOTS_DIR ? process.env.SHOTS_DIR.replace(/[\\/]?$/, "/") : fileURLToPath(new URL("./shots/", import.meta.url));
mkdirSync(OUT, { recursive: true });

if (at("MCP", "off")) {
  console.log("the MCP server is off in this run: nothing to look at");
  process.exit(0);
}

const idp = await startIdp();
idp.setUser({ sub: "mcp-ui-1", email: "asha@example.edu", email_verified: true, name: "Asha Verma" });
const browser = await launch();
const ctx = await browser.newContext(desk(1280, 900));
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
// the app's own address after Allow or Cancel: nothing listens there in a test, so the browser is answered here
await ctx.route("http://localhost:9933/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Back in the app</title><p>Back in the app</p>" }));

const axe = (label) => axeCheck(page, label, { said: true });
const b64 = (b) => Buffer.from(b).toString("base64url");
const form = (o) => new URLSearchParams(o).toString();

/** An app registers itself and builds the address it sends a person to. */
async function authorizeUrl(name, scope = "papers:read references:verify") {
  const client = await (await fetch(`${BASE}/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://localhost:9933/callback"], client_name: name, client_uri: "https://claude.ai", token_endpoint_auth_method: "none" }) })).json();
  const challenge = b64(crypto.createHash("sha256").update(b64(crypto.randomBytes(32))).digest());
  return `${BASE}/oauth/authorize?${form({ response_type: "code", client_id: client.client_id, redirect_uri: "http://localhost:9933/callback", scope, state: "st", code_challenge: challenge, code_challenge_method: "S256", resource: `${BASE}/mcp` })}`;
}

try {
  console.log("the authorization pages");
  const url = await authorizeUrl("Claude");
  for (const [w, h, tag] of [[1280, 900, "desktop"], [390, 844, "phone"]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(url, { waitUntil: "load" });
      await page.screenshot({ path: `${OUT}mcp-signin-${tag}-${scheme}.png`, fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  ok(await page.getByRole("heading", { name: "Sign in to connect Claude" }).isVisible(), "signed out: the page offers the website's sign-in first");
  await axe("sign-in page");
  await page.getByRole("link", { name: "Continue with Google" }).click();
  await page.getByRole("heading", { name: "Claude wants to use Sodhsetu for you" }).waitFor({ timeout: 15000 });
  ok(true, "after signing in, the same request comes back as the consent page");
  for (const [w, h, tag] of [[1280, 900, "desktop"], [390, 844, "phone"]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({ path: `${OUT}mcp-consent-${tag}-${scheme}.png`, fullPage: true });
    }
    const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    ok(wide, `consent page, ${tag}: no sideways scrolling`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await axe("consent page, light");
  await page.emulateMedia({ colorScheme: "dark" });
  await axe("consent page, dark");
  ok(await page.getByText("Signed in as Asha Verma").isVisible(), "it says who is signed in");
  ok(await page.getByText("localhost:9933").isVisible(), "...and where the person goes back to");
  const back = page.waitForRequest((r) => r.url().startsWith("http://localhost:9933/callback"), { timeout: 15000 });
  await page.getByRole("button", { name: "Allow" }).click();
  const req = await back.catch(async (e) => {
    console.log(`        (still at ${page.url()}: ${(await page.locator("h1").first().textContent().catch(() => ""))})`);
    throw e;
  });
  ok(new URL(req.url()).searchParams.has("code") && new URL(req.url()).searchParams.get("state") === "st", "Allow goes back to the app with a code and its state");

  console.log("an app that asks for the library (Phase 2)");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(await authorizeUrl("Library Helper", "papers:read library:read library:write"), { waitUntil: "load" });
  await page.getByRole("heading", { name: "Library Helper wants to use Sodhsetu for you" }).waitFor({ timeout: 15000 });
  ok(await page.getByText("See the papers saved in your Sodhsetu library").isVisible() && await page.getByText("Save papers to your Sodhsetu library").isVisible(), "the consent page names both library permissions");
  ok((await page.getByText("Not available yet").count()) === 0, "...and nothing is marked not available");
  for (const [w, h, tag] of [[1280, 900, "desktop"], [390, 844, "phone"]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({ path: `${OUT}mcp-consent-library-${tag}-${scheme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await axe("consent page with the library, light");
  await page.emulateMedia({ colorScheme: "dark" });
  await axe("consent page with the library, dark");
  const back2 = page.waitForRequest((r) => r.url().startsWith("http://localhost:9933/callback"), { timeout: 15000 });
  await page.getByRole("button", { name: "Allow" }).click();
  ok(new URL((await back2).url()).searchParams.has("code"), "Allow goes back to the app with a code");

  console.log("Settings, Connected apps");
  await page.emulateMedia({ colorScheme: "light" });
  for (const [w, h, tag] of [[1280, 900, "desktop"], [390, 844, "phone"]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const theme of ["light", "dark"]) {
      await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
      await page.evaluate((t) => { localStorage.setItem("theme", t); document.documentElement.setAttribute("data-theme", t); }, theme);
      const sec = page.locator("section.settings-sec", { has: page.getByRole("heading", { name: "Connected apps" }) });
      await sec.waitFor({ timeout: 15000 });
      await sec.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await sec.screenshot({ path: `${OUT}mcp-settings-${tag}-${theme}.png` });
      if (tag === "desktop") await axe(`Settings with Connected apps, ${theme}`);
    }
  }
  const sec = page.locator("section.settings-sec", { has: page.getByRole("heading", { name: "Connected apps" }) });
  ok(await sec.getByText("Claude", { exact: true }).isVisible(), "the connected app is listed by name");
  ok(await sec.getByText("Library Helper", { exact: true }).isVisible() && await sec.getByText(/see the papers saved in your sodhsetu library; save papers to your sodhsetu library/i).isVisible(), "an app with the library says it can see and save the library's papers");
  ok(await sec.getByText(/\/mcp/).first().isVisible(), "the section says which address to add in an app");
  await sec.getByRole("button", { name: "Disconnect Claude" }).click();
  await sec.getByText("Claude", { exact: true }).waitFor({ state: "detached", timeout: 10000 });
  await sec.getByRole("button", { name: "Disconnect Library Helper" }).click();
  await sec.getByText("No app is connected.").waitFor({ timeout: 10000 });
  ok(true, "Disconnect removes each from the list");
  ok(errors.length === 0, `no page error${errors.length ? `: ${errors.join(" | ")}` : ""}`);
} catch (e) {
  console.error(e);
  countFailure();
} finally {
  await browser.close();
  idp.close();
}
finish("all MCP page checks passed");
