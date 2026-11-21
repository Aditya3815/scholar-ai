import { useEffect, useRef, useState } from "react";
import { buildInviteEmail, type InviteRole } from "@scholar/shared";
import "./email-preview.css";

/**
 * The preview of the invitation e-mail in the Share dialog (docs/design/paper-share.md, S4): the very HTML the Worker sends (@scholar/shared invite-email.ts), with the picture of the first
 * page given as a data: address where the e-mail names its inline part. A chunk of its own, fetched when the owner opens "Preview e-mail". It is drawn in a sandboxed frame that may run no
 * script (allow-same-origin only, so that the dialog can read its height); the colours follow the system's light or dark setting, as most mail apps do.
 */
export type PreviewPicture = { dataUrl: string; width: number; height: number };

export default function EmailPreview({ inviterName, title, role, to, note, link, picture }: { inviterName: string; title: string; role: InviteRole; to: string; note: string; link: string; picture: Promise<PreviewPicture | null> }) {
  const [pic, setPic] = useState<PreviewPicture | null>(null);
  const [height, setHeight] = useState(420);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    let live = true;
    void picture.then((p) => live && setPic(p));
    return () => {
      live = false;
    };
  }, [picture]);
  const mail = buildInviteEmail({
    inviterName,
    paperTitle: title,
    role,
    to,
    note,
    link,
    picture: pic ? { src: pic.dataUrl, width: pic.width, height: pic.height } : null,
  });
  /** The frame as tall as the e-mail, and its links shown but not followed (a preview is not the place to open the paper). */
  const fit = () => {
    const win = frame.current?.contentWindow;
    const doc = frame.current?.contentDocument;
    if (!win || !doc?.body) return;
    const measure = () => setHeight(Math.ceil(doc.body.getBoundingClientRect().height));
    measure();
    new ((win as unknown as typeof globalThis).ResizeObserver ?? ResizeObserver)(measure).observe(doc.body);
    doc.addEventListener("click", (e) => (e.target as Element | null)?.closest?.("a") && e.preventDefault());
  };
  return (
    <div className="sh-preview" id="sh-preview">
      <dl className="sh-preview-head">
        <div>
          <dt>From</dt>
          <dd>Sodhsetu &lt;invites@notify.sodhsetu.in&gt;</dd>
        </div>
        <div>
          <dt>Subject</dt>
          <dd>{mail.subject}</dd>
        </div>
      </dl>
      <iframe ref={frame} className="sh-preview-frame" title="Preview of the invitation e-mail" sandbox="allow-same-origin" srcDoc={mail.html} style={{ height }} onLoad={fit} />
    </div>
  );
}
