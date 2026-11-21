/**
 * The invitation e-mail of a shared paper (docs/design/paper-share.md, S4): its subject, a hidden preheader, the HTML and the plain text, written once here so that the Worker sends exactly
 * what the owner's Share dialog shows in its preview. Imports nothing.
 *
 * It is kept apart from share.ts (the limits are there) so that the page fetches it only with the dialog's preview.
 *
 * The HTML follows what renders in Gmail (web and Android), Outlook (desktop and web) and Apple Mail: tables for the layout, every style inline (the <style> block only adds the dark
 * colours and the phone padding, for the clients that read it), at most 600 px wide, the system's fonts, no remote picture (the wordmark is text, the page picture an inline part), a
 * button that is a link with a coloured cell around it. Every string the owner wrote (their name, the paper's title, the note) is escaped, kept to its length and cleaned of control and
 * direction-changing characters.
 */

export type InviteRole = "viewer" | "commenter" | "editor";

/** The picture of the paper's first page: `src` is `cid:<INVITE_PICTURE_CID>` in the sent e-mail, a data: address in the dialog's preview. */
export type InvitePictureRef = { src: string; width: number; height: number };

export type InviteEmailInput = {
  inviterName: string;
  paperTitle: string;
  role: InviteRole;
  /** The address the invitation opens (the paper's page). */
  link: string;
  /** The invited address: the e-mail says to sign in with it. */
  to: string;
  note?: string | null;
  picture?: InvitePictureRef | null;
};

export type InviteEmail = { subject: string; preheader: string; html: string; text: string };

/** The Content-ID of the page picture (an inline part of the message, never a public address). */
export const INVITE_PICTURE_CID = "paper-page-1@sodhsetu";
/** The longest note the e-mail shows (the route refuses one over INVITE_NOTE_MAX, share.ts; this module imports nothing, so it only caps what it is given). */
const NOTE_SHOWN_MAX = 2000;

/** The colours of the e-mail: tokens.css (Light and Dark), written out, as mail has no variables. */
const C = {
  bg: "#f3f1eb",
  surface: "#ffffff",
  soft: "#fbfaf7",
  text: "#16181d",
  muted: "#565a63",
  border: "#e5e1d8",
  borderStrong: "#cfc9bb",
  accent: "#3548c8",
  accentFg: "#ffffff",
  accentSoft: "#e8ebfa",
} as const;
const D = { bg: "#0f1115", surface: "#171a20", soft: "#1f232b", text: "#ecece8", muted: "#a3a6ae", border: "#2a2f39", accent: "#93a6ff", accentFg: "#0b1030", accentSoft: "#1d2447" } as const;

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans','Noto Sans Devanagari',sans-serif";
const SERIF = "Georgia,'Times New Roman','Noto Serif Devanagari',serif";

const ROLE_SENTENCE: Record<InviteRole, string> = {
  viewer: "You can view it.",
  commenter: "You can view it and add comments.",
  editor: "You can view it, add comments and edit its highlights and notes.",
};

/* ---------------------------------------------------------------- cleaning */

// C0 and C1 controls, and the marks that turn the direction of text (a title must not be able to reverse the words around it)
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/** One line, no control characters, at most `max` characters (an ellipsis when it was cut). */
export function inviteLine(s: unknown, max: number): string {
  const one = (typeof s === "string" ? s : "").replace(/[\r\n\t]+/g, " ").replace(CONTROLS, "").replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/** The owner's note: line breaks kept (at most one empty line in a row), no other control characters, trimmed. Null when empty. The length is checked by the caller. */
export function cleanInviteNote(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(CONTROLS, "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t || null;
}

/** HTML text and attribute values. */
export const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Only an http(s) address may be a link; anything else becomes the site's own address. */
function safeLink(link: string): string {
  try {
    const u = new URL(link);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : "https://sodhsetu.in/";
  } catch {
    return "https://sodhsetu.in/";
  }
}

/* ---------------------------------------------------------------- the message */

export function buildInviteEmail(input: InviteEmailInput): InviteEmail {
  const who = inviteLine(input.inviterName, 80) || "Someone";
  const title = inviteLine(input.paperTitle, 200) || "Untitled paper";
  const to = inviteLine(input.to, 254);
  const note = cleanInviteNote(input.note)?.slice(0, NOTE_SHOWN_MAX) ?? null;
  const link = safeLink(input.link);
  const home = new URL(link).origin;
  const role = ROLE_SENTENCE[input.role];

  const subject = `${who} shared “${inviteLine(title, 80)}” with you`;
  const preheader = note ? `“${inviteLine(note, 110)}” ${role}` : `${role} Open it on Sodhsetu.`;

  const e = escapeHtml;
  const noteHtml = note ? e(note).replace(/\n/g, "<br>") : "";
  const sign = to ? `Sign in with Google as <span style="color:${C.text}" class="t">${e(to)}</span> to open it.` : "Sign in with Google using this e-mail address to open it.";

  // the page: the picture, or a neutral page-shaped block with a few grey lines
  const PAGE_W = 128;
  const pic = input.picture && input.picture.width > 0 && input.picture.height > 0 ? input.picture : null;
  const picH = pic ? Math.round((PAGE_W * pic.height) / pic.width) : 166;
  const bar = (w: number, h = 6, color: string = C.border) =>
    `<tr><td style="padding:0 0 7px 0"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="${w}%"><tr><td class="bar" height="${h}" style="height:${h}px;line-height:${h}px;font-size:0;background:${color};border-radius:3px">&nbsp;</td></tr></table></td></tr>`;
  const page = pic
    ? `<a href="${e(link)}" style="text-decoration:none"><img src="${e(pic.src)}" width="${PAGE_W}" height="${picH}" alt="The first page of “${e(title)}”" class="page" style="display:block;width:${PAGE_W}px;height:auto;max-width:${PAGE_W}px;border:1px solid ${C.borderStrong};border-radius:4px;background:#ffffff;color:${C.muted};font:12px/16px ${SANS}"></a>`
    : `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="${PAGE_W}" class="page" style="width:${PAGE_W}px;border:1px solid ${C.borderStrong};border-radius:4px;background:#ffffff"><tr><td class="ph" height="${picH}" valign="top" style="height:${picH}px;padding:16px 14px" aria-hidden="true"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">${bar(80, 8, C.borderStrong)}${bar(55, 8, C.borderStrong)}<tr><td style="padding:4px 0 0 0;font-size:0;line-height:0">&nbsp;</td></tr>${bar(100)}${bar(92)}${bar(100)}${bar(70)}${bar(100)}${bar(86)}</table></td></tr></table>`;

  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${e(subject)}</title>
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table{border-collapse:collapse}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
a.btn-a:hover{opacity:.92}
@media (max-width:620px){
.wrap{padding:12px 8px!important}
.pad{padding-left:20px!important;padding-right:20px!important}
.h1{font-size:21px!important;line-height:28px!important}
.cardpad{padding:12px!important}
.pagecol{width:96px!important}
img.page{width:96px!important;max-width:96px!important}
table.page{width:96px!important}
.ph{height:124px!important;padding:12px 10px!important}
.titlecol{padding-left:14px!important}
.title{font-size:16px!important;line-height:22px!important}
}
@media (prefers-color-scheme:dark){
.bg{background:${D.bg}!important}
.card{background:${D.surface}!important;border-color:${D.border}!important}
.soft{background:${D.soft}!important;border-color:${D.border}!important}
.note{background:${D.soft}!important;border-left-color:${D.accent}!important}
.t,.h1,.title,.title a{color:${D.text}!important}
.m{color:${D.muted}!important}
.mark{background:${D.accent}!important;color:${D.accentFg}!important}
.word{color:${D.text}!important}
.btn{background:${D.accent}!important}
.btn-a{background:${D.accent}!important;color:${D.accentFg}!important;border-color:${D.accent}!important}
.lnk{color:${D.accent}!important}
.line{border-top-color:${D.border}!important}
}
[data-ogsc] .bg{background:${D.bg}!important}
[data-ogsc] .card{background:${D.surface}!important;border-color:${D.border}!important}
[data-ogsc] .soft,[data-ogsc] .note{background:${D.soft}!important}
[data-ogsc] .t,[data-ogsc] .h1,[data-ogsc] .title a,[data-ogsc] .word{color:${D.text}!important}
[data-ogsc] .m{color:${D.muted}!important}
[data-ogsc] .btn,[data-ogsc] .btn-a{background:${D.accent}!important;color:${D.accentFg}!important}
[data-ogsc] .lnk{color:${D.accent}!important}
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${C.bg};color:${C.text}">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.bg}">${e(preheader)}${"&#8199;&#847;&zwnj;&nbsp;".repeat(60)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="bg" style="background:${C.bg}">
<tr><td align="center" class="wrap" style="padding:32px 16px">
<!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td style="padding:0 4px 16px 4px">
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
<td class="mark" width="28" height="28" align="center" valign="middle" style="width:28px;height:28px;background:${C.accent};color:${C.accentFg};border-radius:8px;font:700 16px/28px ${SERIF};text-align:center">S</td>
<td class="word" style="padding-left:10px;font:600 20px/28px ${SERIF};letter-spacing:-0.2px;color:${C.text}">Sodhsetu</td>
</tr></table>
</td></tr>
<tr><td class="card" style="background:${C.surface};border:1px solid ${C.border};border-radius:14px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
<tr><td class="pad" style="padding:32px 36px 8px 36px;font-family:${SANS}">
<h1 class="h1" style="margin:0 0 8px 0;font:600 23px/30px ${SANS};color:${C.text}">${e(who)} shared a paper with you</h1>
<p class="m" style="margin:0;font:15px/22px ${SANS};color:${C.muted}">${e(role)}</p>
</td></tr>
${
  note
    ? `<tr><td class="pad" style="padding:20px 36px 0 36px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td class="note" style="background:${C.soft};border-left:3px solid ${C.accent};border-radius:0 8px 8px 0;padding:14px 16px">
<p class="m" style="margin:0 0 4px 0;font:600 12px/16px ${SANS};color:${C.muted};letter-spacing:.3px">${e(who)} wrote</p>
<p class="t" dir="auto" style="margin:0;font:15px/23px ${SANS};color:${C.text}">${noteHtml}</p>
</td></tr></table>
</td></tr>`
    : ""
}
<tr><td class="pad" style="padding:20px 36px 0 36px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td class="soft cardpad" style="background:${C.soft};border:1px solid ${C.border};border-radius:12px;padding:16px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
<td class="pagecol" width="${PAGE_W}" valign="top" style="width:${PAGE_W}px">${page}</td>
<td class="titlecol" valign="top" style="padding:4px 0 0 18px;font-family:${SANS}">
<p class="m" style="margin:0 0 6px 0;font:600 11px/16px ${SANS};letter-spacing:.8px;text-transform:uppercase;color:${C.muted}">Paper · PDF</p>
<p class="title" dir="auto" style="margin:0 0 10px 0;font:600 18px/25px ${SERIF};color:${C.text};word-break:break-word"><a href="${e(link)}" style="color:${C.text};text-decoration:none">${e(title)}</a></p>
<p class="m" style="margin:0;font:13px/19px ${SANS};color:${C.muted}">Shared by ${e(who)}</p>
</td>
</tr></table>
</td></tr></table>
</td></tr>
<tr><td class="pad" style="padding:24px 36px 0 36px">
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td class="btn" bgcolor="${C.accent}" style="background:${C.accent};border-radius:8px">
<a href="${e(link)}" class="btn-a" style="display:inline-block;padding:12px 24px;font:600 15px/20px ${SANS};color:${C.accentFg};background:${C.accent};text-decoration:none;border-radius:8px;border:1px solid ${C.accent}">Open the paper</a>
</td></tr></table>
<p class="m" style="margin:14px 0 0 0;font:14px/21px ${SANS};color:${C.muted}">${sign}</p>
</td></tr>
<tr><td class="pad" style="padding:24px 36px 28px 36px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td class="line" style="border-top:1px solid ${C.border};padding-top:16px">
<p class="m" style="margin:0;font:13px/19px ${SANS};color:${C.muted}">If the button does not work, paste this address into your browser:<br><a href="${e(link)}" class="lnk" style="color:${C.accent};word-break:break-all">${e(link)}</a></p>
</td></tr></table>
</td></tr>
</table>
</td></tr>
<tr><td style="padding:20px 8px 0 8px">
<p class="m" style="margin:0 0 6px 0;font:12px/18px ${SANS};color:${C.muted}">You got this e-mail because ${e(who)} shared a paper with ${to ? e(to) : "this address"} on Sodhsetu. If you were not expecting it, you can ignore it: nothing happens unless you open the link.</p>
<p class="m" style="margin:0;font:12px/18px ${SANS};color:${C.muted}">Sent by <a href="${e(home)}" class="lnk" style="color:${C.accent};text-decoration:none">Sodhsetu</a> on behalf of ${e(who)}.</p>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;

  const text = [
    `${who} shared a paper with you on Sodhsetu`,
    "",
    `“${title}”`,
    role,
    ...(note ? ["", `${who} wrote:`, ...note.split("\n").map((l) => (l ? `> ${l}` : ">"))] : []),
    "",
    `Open the paper: ${link}`,
    to ? `Sign in with Google as ${to} to open it.` : "Sign in with Google using this e-mail address to open it.",
    "",
    "--",
    `You got this e-mail because ${who} shared a paper with ${to || "this address"} on Sodhsetu. If you were not expecting it, you can ignore it: nothing happens unless you open the link.`,
    `Sent by Sodhsetu (${home}) on behalf of ${who}.`,
  ].join("\n");

  return { subject, preheader, html, text };
}
