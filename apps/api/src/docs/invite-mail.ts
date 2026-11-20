import { INVITE_PICTURE_CID, buildInviteEmail, type MemberRole } from "@scholar/shared";
import type { EnvPick } from "../platform/env";
import { standIns } from "../platform/dev";
import type { InvitePicture } from "./invite-picture";

/**
 * The invitation e-mail (docs/design/paper-share.md, phase S4), through a small port so that tests and local runs use a stand-in. It says who shared which paper, the role, the owner's
 * note when they wrote one, a picture of the paper's first page when the dialog sent one, and the link; never a highlight, a comment or anything else written in the paper. The words and
 * the HTML are shared with the dialog's preview (@scholar/shared invite-email.ts). It is sent through Cloudflare Email Service (the `send_email` binding EMAIL, from the subdomain
 * notify.sodhsetu.in, whose DKIM, SPF and MX records are published), as the binding's message builder: the subject, the plain text and the HTML as alternatives, and the picture as an
 * inline part the HTML names by its Content-ID (the service writes the MIME and encodes the headers). The address, the note and the picture are used only to send this one invitation and
 * are not kept; nothing about the message is logged but that it went or failed.
 */
export type InviteMail = { to: string; paperTitle: string; inviterName: string; role: MemberRole; link: string; note?: string | null; picture?: InvitePicture | null };
/** Sends one invitation; true when it was handed to the e-mail service. Never throws. */
export type InviteMailer = (m: InviteMail) => Promise<boolean>;

export const INVITE_FROM = { name: "Sodhsetu", email: "invites@notify.sodhsetu.in" } as const;

/** What the binding is given (the Worker's EmailMessageBuilder, as this module uses it). */
export type InviteMessage = {
  from: { name: string; email: string };
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: { disposition: "inline"; contentId: string; filename: string; type: "image/jpeg"; content: Uint8Array }[];
};

/** The message for one invitation. */
export function inviteMessage(m: InviteMail): InviteMessage {
  const pic = m.picture ?? null;
  const mail = buildInviteEmail({
    inviterName: m.inviterName,
    paperTitle: m.paperTitle,
    role: m.role,
    link: m.link,
    to: m.to,
    note: m.note ?? null,
    picture: pic ? { src: `cid:${INVITE_PICTURE_CID}`, width: pic.width, height: pic.height } : null,
  });
  return {
    from: { ...INVITE_FROM },
    to: m.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    ...(pic ? { attachments: [{ disposition: "inline" as const, contentId: INVITE_PICTURE_CID, filename: "first-page.jpg", type: "image/jpeg" as const, content: pic.bytes }] } : {}),
  };
}

/** The binding as this module uses it (the Worker's `SendEmail`). */
export type EmailBinding = { send(message: InviteMessage): Promise<unknown> };

export function bindingMailer(binding: EmailBinding): InviteMailer {
  return async (m) => {
    try {
      await binding.send(inviteMessage(m));
      return true;
    } catch (e) {
      // the reason only: never the address, the paper, the note or the link
      console.error(JSON.stringify({ level: "error", msg: "invite_mail_failed", error: e instanceof Error ? e.name : "unknown" }));
      return false;
    }
  };
}

/** The local stand-in (ENABLE_DEV_ROUTES=1 and QA_STUB=1): nothing leaves the machine; the messages that would have been sent are kept for the tests of this isolate. */
export const sentByStandIn: InviteMessage[] = [];
export const standInMailer: InviteMailer = async (m) => {
  sentByStandIn.push(inviteMessage(m));
  if (sentByStandIn.length > 20) sentByStandIn.shift();
  return true;
};

/** The mailer of this Worker: the stand-in for local runs and tests, the EMAIL binding otherwise, and none when there is no binding (the dialog then offers "Copy invite"). */
export function mailerFor(env: EnvPick<never, "ENABLE_DEV_ROUTES" | "QA_STUB" | "EMAIL">): InviteMailer | null {
  if (standIns(env)) return standInMailer;
  const binding = env.EMAIL;
  // the message as the binding's builder takes it (a type error here when the two part ways)
  return binding ? bindingMailer({ send: (message) => binding.send(message) }) : null;
}
