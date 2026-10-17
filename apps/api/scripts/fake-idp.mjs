// A fake identity provider (Google-like plus ORCID-like under /orcid) for tests. It ENFORCES PKCE (the token request's
// code_verifier must hash to the authorize request's code_challenge) and the client secret, and codes are single use.
import http from "node:http";
import crypto from "node:crypto";

export async function startFakeIdp(port = 9911) {
  const codes = new Map(); // code -> { challenge, orcid }
  let user = { sub: "g-111", email: "scholar@example.com", email_verified: true, name: "Test Scholar" };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const isOrcid = url.pathname.startsWith("/orcid");
    const path = url.pathname.replace(/^\/orcid/, "");

    if (path === "/authorize" || path === "/oauth/authorize") {
      const code = crypto.randomBytes(8).toString("hex");
      codes.set(code, { challenge: url.searchParams.get("code_challenge"), orcid: isOrcid });
      const back = new URL(url.searchParams.get("redirect_uri"));
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state"));
      res.writeHead(302, { Location: back.toString() }).end();
    } else if (path === "/token" || path === "/oauth/token") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const p = new URLSearchParams(body);
      const entry = codes.get(p.get("code"));
      codes.delete(p.get("code"));
      const verifierOk = entry && crypto.createHash("sha256").update(p.get("code_verifier") ?? "").digest("base64url") === entry.challenge;
      const secretOk = p.get("client_secret") === "dev-secret";
      if (!entry || !verifierOk || !secretOk) {
        res.writeHead(400, { "Content-Type": "application/json" }).end('{"error":"invalid_grant"}');
        return;
      }
      const payload = entry.orcid
        ? { access_token: "at-orcid", orcid: "0000-0002-1825-0097", name: "Josiah Carberry" }
        : { access_token: "at-google" };
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(payload));
    } else if (path === "/userinfo") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(user));
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(port, resolve));
  return {
    setUser(next) { user = next; },
    close() { server.close(); },
  };
}
