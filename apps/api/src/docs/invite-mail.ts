import { ROLE_LABEL, type MemberRole } from "@scholar/shared";
import type { EnvPick } from "../platform/env";
import { standIns } from "../platform/dev";

/**
 * The invitation e-mail (docs/design/paper-share.md, phase S4), through a small port so that tests and local runs use a stand-in. It says who shared which paper, the role and the link, and
 * nothing else: never a note, a highlight, a comment or anything written in the paper. It is sent through Cloudflare Email Service (the `send_email` binding EMAIL, from the subdomain
 * notify.sodhsetu.in, whose DKIM, SPF and MX records are published). The address is used only to send this one invitation; nothing about the message is logged but that it went or failed.
 */
export type InviteMail = { to: string; paperTitle: string; inviterName: string; role: MemberRole; link: string };
/** Sends one invitation; true when it was handed to the e-mail service. Never throws. */
export type InviteMailer = (m: InviteMail) => Promise<boolean>;

export const INVITE_FROM = { name: "Sodhsetu", email: "invites@notify.sodhsetu.in" } as const;

const ROLE_WORDS: Record<MemberRole, string> = { viewer: "view it", commenter: "view it and comment on it", editor: "view it, comment on it and edit its highlights and notes" };
const html = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
/** One line, no control characters, at most `max` characters: what a header or a line of the message may hold. */
const line = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** The message: a subject, plain text and simple HTML. */
export function inviteMessage(m: InviteMail): { subject: string; text: string; html: string } {
  const who = line(m.inviterName, 80) || "Someone";
  const title = line(m.paperTitle, 200) || "a paper";
  const subject = line(`${who} shared "${title}" with you on Sodhsetu`, 240);
  const text = [
    `${who} shared "${title}" with you on Sodhsetu.`,
    `You can ${ROLE_WORDS[m.role]} (${ROLE_LABEL[m.role]}).`,
    "",
    `Open it: ${m.link}`,
    "",
    "Sign in with Google using this e-mail address to open it.",
    "If you did not expect this, you can ignore this e-mail.",
  ].join("\n");
  const body = [
    `<p>${html(who)} shared <strong>${html(title)}</strong> with you on Sodhsetu.</p>`,
    `<p>You can ${html(ROLE_WORDS[m.role])} (${html(ROLE_LABEL[m.role])}).</p>`,
    `<p><a href="${html(m.link)}">Open the paper</a></p>`,
    "<p>Sign in with Google using this e-mail address to open it.</p>",
    `<p style="color:#666">If you did not expect this, you can ignore this e-mail.</p>`,
  ].join("\n");
  return { subject, text, html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">${body}</body></html>` };
}

/** The binding as this module uses it (the Worker's `SendEmail`). */
export type EmailBinding = { send(message: { from: { name: string; email: string }; to: string; subject: string; text: string; html: string }): Promise<unknown> };

export function bindingMailer(binding: EmailBinding): InviteMailer {
  return async (m) => {
    try {
      await binding.send({ from: { ...INVITE_FROM }, to: m.to, ...inviteMessage(m) });
      return true;
    } catch (e) {
      // the reason only: never the address, the paper or the link
      console.error(JSON.stringify({ level: "error", msg: "invite_mail_failed", error: e instanceof Error ? e.name : "unknown" }));
      return false;
    }
  };
}

/** The local stand-in (ENABLE_DEV_ROUTES=1 and QA_STUB=1): nothing leaves the machine; what would have been sent is kept for the tests of this isolate. */
export const sentByStandIn: InviteMail[] = [];
export const standInMailer: InviteMailer = async (m) => {
  sentByStandIn.push(m);
  if (sentByStandIn.length > 50) sentByStandIn.shift();
  return true;
};

/** The mailer of this Worker: the stand-in for local runs and tests, the EMAIL binding otherwise, and none when there is no binding (the dialog then offers "Copy invite"). */
export function mailerFor(env: EnvPick<never, "ENABLE_DEV_ROUTES" | "QA_STUB" | "EMAIL">): InviteMailer | null {
  if (standIns(env)) return standInMailer;
  return env.EMAIL ? bindingMailer(env.EMAIL as unknown as EmailBinding) : null;
}
