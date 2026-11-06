import { SCOPES, type Scope } from "./scopes";

/**
 * The pages of the authorization step (src/mcp/oauth.ts), written by the Worker itself: a person reaches them from their AI app, before the website's code is involved, and they must work with no
 * script at all. Everything that came from the app (its name, its address, where it sends the person back) is escaped: an app registers itself, so its name is whatever it says it is, and the page
 * shows the address the person goes back to, so that an app that calls itself "Claude" but sends people elsewhere can be seen for what it is. Colours are the website's own (apps/web/src/styles).
 */

const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

const hostOf = (url: string): string => {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

const STYLE = `
:root{color-scheme:light dark;--bg:#fbfaf7;--surface:#fff;--text:#16181d;--muted:#5b616e;--border:#e5e1d8;--accent:#3548c8;--accent-fg:#fff;--accent-soft:#e8ebfa;--warn:#8a5a00}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--surface:#171a20;--text:#ecece8;--muted:#a3a8b3;--border:#2a2f39;--accent:#93a6ff;--accent-fg:#0b1030;--accent-soft:#1d2447;--warn:#f0c36b}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif;min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:48px 16px}
main{width:100%;max-width:440px;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px 24px}
.brand{display:flex;align-items:center;gap:10px;font-weight:650;font-size:15px;margin:0 0 20px}
.mark{width:28px;height:28px;border-radius:8px;background:var(--accent);color:var(--accent-fg);display:grid;place-items:center;font-size:15px;font-weight:700}
h1{font-size:21px;line-height:1.3;margin:0 0 8px}
p{margin:0 0 14px}
.muted{color:var(--muted);font-size:14px}
ul{list-style:none;padding:0;margin:0 0 18px;border:1px solid var(--border);border-radius:12px}
li{padding:11px 14px;border-top:1px solid var(--border);font-size:15px}
li:first-child{border-top:0}
li small{display:block;color:var(--muted);font-size:13px}
li.no{color:var(--muted)}
.who{background:var(--accent-soft);border-radius:10px;padding:10px 12px;font-size:14px;margin:0 0 18px;overflow-wrap:anywhere}
.row{display:flex;gap:10px;flex-wrap:wrap}
button,.btn{flex:1 1 140px;min-height:44px;border-radius:10px;font:inherit;font-weight:600;cursor:pointer;text-align:center;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;padding:0 16px}
.primary{background:var(--accent);color:var(--accent-fg);border:1px solid var(--accent)}
.secondary{background:transparent;color:var(--text);border:1px solid var(--border)}
button:focus-visible,.btn:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
code{font:13px ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}
.fine{margin:18px 0 0;font-size:13px;color:var(--muted)}
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Sodhsetu</title><style>${STYLE}</style></head><body><main><p class="brand"><span class="mark" aria-hidden="true">S</span>Sodhsetu</p>${body}</main></body></html>`;
}

export function consentPage(a: { handle: string; clientName: string; clientUri: string | null; redirectUri: string; requested: string[]; granted: Scope[]; user: string }): string {
  const known = Object.keys(SCOPES) as Scope[];
  const asked = a.requested.length === 0 ? a.granted : a.requested;
  const items = asked
    .map((s) => {
      const label = (known as string[]).includes(s) ? SCOPES[s as Scope] : s;
      return (a.granted as string[]).includes(s) ? `<li>${esc(label)}</li>` : `<li class="no">${esc(label)}<small>Not available yet: it will not be allowed.</small></li>`;
    })
    .join("");
  const site = a.clientUri ? `<p class="muted">The app says it is from <code>${esc(hostOf(a.clientUri))}</code>.</p>` : "";
  return page(
    `Allow ${a.clientName}`,
    `<h1>${esc(a.clientName)} wants to use Sodhsetu for you</h1>
${site}<p class="muted">After you answer, you go back to <code>${esc(hostOf(a.redirectUri))}</code>.</p>
<p>It will be able to:</p>
<ul>${items}</ul>
<p class="who">Signed in as <strong>${esc(a.user)}</strong></p>
<form method="post" action="/oauth/authorize">
<input type="hidden" name="handle" value="${esc(a.handle)}">
<div class="row"><button class="secondary" type="submit" name="decision" value="deny">Cancel</button><button class="primary" type="submit" name="decision" value="allow">Allow</button></div>
</form>
<p class="fine">What the app sends (a search, a list of references, DOIs) is checked the same way as on the website. Sodhsetu keeps counts of what was used, never what was sent. You can disconnect the app at any time in Settings, under Connected apps.</p>`,
  );
}

export function signInPage(clientName: string, providers: { label: string; href: string }[]): string {
  const buttons = providers.map((p) => `<a class="btn primary" href="${esc(p.href)}">Continue with ${esc(p.label)}</a>`).join("");
  return page(
    "Sign in",
    `<h1>Sign in to connect ${esc(clientName)}</h1>
<p class="muted">${esc(clientName)} wants to use Sodhsetu. Sign in first; you will then see what it asks for and can say yes or no.</p>
<div class="row">${buttons || `<p class="muted">Sign-in is not available right now.</p>`}</div>`,
  );
}

export function closedBetaPage(clientName: string): string {
  return page(
    "Closed beta",
    `<h1>Connecting apps is in a closed beta</h1>
<p class="muted">${esc(clientName)} cannot be connected to this account yet. Connecting AI apps to Sodhsetu is open to a few accounts while it is tested, and will open to everyone after that.</p>`,
  );
}

export function errorPage(title: string, detail: string): string {
  return page(title, `<h1>${esc(title)}</h1><p class="muted">${esc(detail)}</p>`);
}
