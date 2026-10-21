import { m } from "motion/react";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { PRIVACY_VERSION } from "@scholar/shared";
import { useAuth } from "../../lib/auth";
import { acknowledgePrivacy } from "../../lib/legal";
import { easeOut } from "../../lib/motion";
import { showNotice } from "../../lib/notice";

const POINTS = {
  papers: [
    "Your PDF, the text read from it and your questions are private to your account. Nobody else can see them.",
    "A private AI service (Cloudflare Workers AI) reads the relevant passages to answer. Your papers are never used to train AI and never sent to any other AI service.",
    "They stay until you delete the paper or your account. Deleting removes the file and the text straight away.",
  ],
  ideas: [
    "Your idea is read by a private AI service (Cloudflare Workers AI) to plan a search. It is never used to train AI, never sent to any other AI service, and it is not stored.",
    "Before anything is searched, you see exactly what will be sent to OpenAlex and Semantic Scholar, and can change it. Your idea and your file are not part of it.",
    "Nothing about a check is kept, unless you choose to send a report.",
  ],
} as const;

/**
 * Shown once, before the first upload or idea check: what happens to what you give us, in three lines, with a link to the full text. Agreeing is
 * recorded against the account with the version of the text, and the server refuses uploads and idea checks until it has been recorded.
 */
export function PrivacyCard({ kind }: { kind: keyof typeof POINTS }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!user || user.privacyAck === PRIVACY_VERSION) return null;

  const agree = async () => {
    setBusy(true);
    try {
      await acknowledgePrivacy();
    } catch (e) {
      showNotice(e instanceof Error ? e.message : "That could not be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <m.section className="card privacy-card" aria-labelledby="privacy-card-h" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: easeOut }}>
      <div className="privacy-card-head">
        <span className="principle-ico" aria-hidden="true"><ShieldCheck size={20} /></span>
        <h2 id="privacy-card-h" className="privacy-card-title">Before you start: how your {kind === "papers" ? "papers are" : "ideas are"} handled</h2>
      </div>
      <ul className="privacy-card-list">
        {POINTS[kind].map((p) => (
          <li key={p}>
            <Check size={16} aria-hidden="true" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <p className="privacy-card-fine">
        The full text: <a href="/privacy" target="_blank" rel="noopener">Privacy policy</a> and <a href="/how-we-verify" target="_blank" rel="noopener">How we verify</a>. You can export or delete everything in Settings and data, any time.
      </p>
      <button type="button" className="btn btn-primary" onClick={() => void agree()} disabled={busy} aria-busy={busy}>
        {busy ? <Loader2 className="spin" size={16} aria-hidden="true" /> : null}
        <span>I understand, continue</span>
      </button>
    </m.section>
  );
}
