import { AnimatePresence, m } from "motion/react";
import { FileSearch, LockKeyhole, ShieldCheck, Sparkles, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import type { DocumentInfo } from "@scholar/shared";
import { useAuth } from "../../lib/auth";
import { PAPERS_NAME } from "../../lib/workspace";
import { loadDocs, removeDoc, resetDocs, useDocs } from "../../lib/documents";
import { PRIVACY_VERSION } from "@scholar/shared";
import { easeOut, stagger } from "../../lib/motion";
import { ConfirmDialog } from "../ConfirmDialog";
import { ProviderButtons } from "../ProviderButtons";
import { PrivacyCard } from "../legal/PrivacyCard";
import { DocCard } from "./DocCard";
import { UploadZone } from "./UploadZone";

const rise = (i: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, ease: easeOut, delay: 0.08 + stagger(i, 0.09) },
});

const HOW = [
  { Icon: FileSearch, title: "Ask in plain words", body: "Ask what a paper found, how it was done, or where a number comes from. Hindi and other Indian languages work too." },
  { Icon: ShieldCheck, title: "Every source is checked", body: "An answer shows the exact passage it came from, and we verify that passage really is in your paper. Click it to jump to the page." },
  { Icon: LockKeyhole, title: "Private to you", body: "Your PDFs and questions are visible only to your account, are never used to train AI, and can be deleted any time." },
];

export function PapersPage({ onOpen }: { onOpen: (id: string) => void }) {
  const { status, user } = useAuth();
  const docs = useDocs();
  const [toDelete, setToDelete] = useState<DocumentInfo | null>(null);

  useEffect(() => {
    if (status !== "ready") return;
    if (user) void loadDocs();
    else resetDocs();
  }, [status, user?.id]);

  const full = !!docs.usage && docs.usage.count >= docs.usage.maxCount;
  const acked = user?.privacyAck === PRIVACY_VERSION;

  return (
    <div className="papers">
      <section className="vhead" aria-labelledby="papers-h">
        <div className="orbs" aria-hidden="true">
          <span className="orb orb-1" />
          <span className="orb orb-2" />
        </div>
        <m.p className="eyebrow" {...rise(0)}>{PAPERS_NAME}</m.p>
        <m.h1 id="papers-h" className="vtitle" {...rise(1)}>
          Ask your papers anything. Get answers you can{" "}
          <span className="hero-em">
            check
            <svg className="hero-underline" viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden="true">
              <m.path d="M3 8c22-6 48-7 62-4s34 3 52-1" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: easeOut, delay: 0.7 }} />
            </svg>
          </span>
          .
        </m.h1>
        <m.p className="vsub" {...rise(2)}>
          Upload a PDF, read it here, and ask questions. Each answer points to the exact passage, so you can verify it in one click.
        </m.p>
      </section>

      {status === "loading" ? (
        <div className="empty" aria-busy="true"><span className="pulse-dot" /></div>
      ) : !user ? (
        <m.div className="card papers-gate" {...rise(3)}>
          <span className="principle-ico" aria-hidden="true"><LockKeyhole size={20} /></span>
          <h2 className="papers-gate-title">Sign in to upload papers</h2>
          <p>Your papers are private to your account, so we need to know it is you. It takes one click.</p>
          <ProviderButtons />
        </m.div>
      ) : (
        <>
          <PrivacyCard kind="papers" />
          <m.div {...rise(3)}>
            <UploadZone disabled={full || !acked} reason={full ? `You have reached ${docs.usage!.maxCount} papers. Delete one to add another.` : !acked ? "Read the note above first." : undefined} />
          </m.div>

          {docs.status === "error" && (
            <div className="empty" role="alert">
              <WifiOff size={28} aria-hidden="true" />
              <p className="empty-title">We could not load your papers</p>
              <p>{docs.error}</p>
              <button type="button" className="btn btn-primary" onClick={() => void loadDocs()}>Try again</button>
            </div>
          )}

          {docs.status === "ready" && docs.items.length === 0 && (
            <m.ul className="principles vhow" aria-label="How it works" initial="hidden" animate="show">
              {HOW.map(({ Icon, title, body }, i) => (
                <m.li key={title} className="card principle" {...rise(4 + i)}>
                  <span className="principle-ico" aria-hidden="true"><Icon size={20} /></span>
                  <h2 className="principle-title">{title}</h2>
                  <p>{body}</p>
                </m.li>
              ))}
            </m.ul>
          )}

          {docs.items.length > 0 && (
            <section className="papers-list" aria-labelledby="mine-h">
              <div className="papers-list-head">
                <h2 id="mine-h" className="papers-h2">
                  <Sparkles size={16} aria-hidden="true" /> Your papers
                </h2>
                {docs.usage && <p className="papers-usage">{docs.usage.count} of {docs.usage.maxCount} · {(docs.usage.bytes / 1024 / 1024).toFixed(1)} MB used</p>}
              </div>
              <ul className="dgrid" aria-label="Your papers">
                <AnimatePresence initial>
                  {docs.items.map((d, i) => (
                    <DocCard key={d.id} doc={d} index={i} onOpen={onOpen} onDelete={setToDelete} />
                  ))}
                </AnimatePresence>
              </ul>
            </section>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete this paper?"
        description={<>“{toDelete?.title}”, its extracted text and your questions about it will be permanently deleted. This cannot be undone.</>}
        confirmLabel="Delete paper"
        onConfirm={async () => {
          if (toDelete) await removeDoc(toDelete.id);
        }}
      />
    </div>
  );
}
