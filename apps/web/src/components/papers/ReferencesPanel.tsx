import { AnimatePresence, m } from "motion/react";
import { BookMarked, FileSearch, Loader2, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PaperInfo } from "@scholar/shared";
import { easeOut } from "../../lib/motion";
import { bucketOf, tally } from "../../lib/refStatus";
import { useVerify } from "../../lib/verify";
import { RefCard } from "../verify/RefCard";
import { VerifySummary, type Filter } from "../verify/VerifySummary";

/** More than the Reference Verifier page allows at once: a paper's own list is usually 20 to 80 entries, reviews more. */
const MAX_PER_PAPER = 120;

/**
 * The paper's own reference list, each entry checked against Crossref and OpenAlex by the Reference Verifier. Answers the questions
 * a reader has about a paper: does it cite things that do not exist, mix up details, or cite retracted work?
 */
export function ReferencesPanel({ info, analyzing }: { info: PaperInfo | null; analyzing: boolean }) {
  const { state, start, recheck, stop } = useVerify();
  const [filter, setFilter] = useState<Filter>("all");
  const started = useRef<string | null>(null);
  const refs = info?.references ?? [];
  const key = `${refs.length}:${refs[0]?.slice(0, 40) ?? ""}`;

  // Start checking the first time this paper's list is shown. A repeat visit is instant: answers are cached on the server.
  useEffect(() => {
    if (refs.length === 0 || started.current === key) return;
    started.current = key;
    void start(refs, MAX_PER_PAPER);
  }, [key, refs, start]);

  const t = tally(state.items);
  const retracted = useMemo(() => state.items.map((it, i) => ({ it, n: i + 1 })).filter(({ it }) => it.verdict?.retracted), [state.items]);
  const shown = useMemo(() => state.items.map((it, i) => ({ it, i })).filter(({ it }) => filter === "all" || bucketOf(it) === filter), [state.items, filter]);
  const recheckBad = () => void recheck(state.items.filter((it) => bucketOf(it) === "unchecked" && it.verdict?.status !== "unparsed").map((it) => it.id));

  const source = info?.referencesSource === "crossref" ? "from Crossref (this PDF's own list could not be read)" : "found in this PDF";

  return (
    <section className="ask refs-panel" aria-label="References of this paper">
      <header className="ask-head">
        <h2 className="ask-title">
          <BookMarked size={16} aria-hidden="true" /> References
        </h2>
        <p className="ask-sub">
          {analyzing && !info ? (
            <>
              <Loader2 className="spin" size={14} aria-hidden="true" /> Reading this paper’s reference list…
            </>
          ) : refs.length > 0 ? (
            <>
              {refs.length} {refs.length === 1 ? "reference" : "references"} {source}. Each one is looked up in Crossref and OpenAlex.
            </>
          ) : (
            <>No reference list was found in this PDF.</>
          )}
        </p>
      </header>

      <div className="ask-scroll refs-scroll">
        {analyzing && !info && (
          <div className="refs-wait" aria-hidden="true">
            <span className="sk sk-title" />
            <span className="sk sk-body" />
            <span className="sk sk-body sk-short" />
          </div>
        )}

        {info && refs.length === 0 && (
          <m.div className="ask-empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: easeOut }}>
            <span className="principle-ico" aria-hidden="true">
              <FileSearch size={20} />
            </span>
            <p className="ask-empty-title">No references found</p>
            <p className="ask-hint">
              The PDF has no heading we can recognise as “References” (some theses and scanned papers do not). If you have the list, paste it into{" "}
              <a href="/verify">Verify references</a> and it is checked the same way.
            </p>
          </m.div>
        )}

        <AnimatePresence initial={false}>
          {retracted.length > 0 && (
            <m.div className="retract" role="alert" initial={{ opacity: 0, x: 0 }} animate={{ opacity: 1, x: [0, -6, 6, -4, 4, 0] }} transition={{ duration: 0.5, delay: 0.15 }}>
              <ShieldAlert size={18} aria-hidden="true" />
              <div>
                <strong>
                  This paper cites {retracted.length} retracted {retracted.length === 1 ? "work" : "works"}.
                </strong>{" "}
                See {retracted.map(({ n }) => `#${n}`).join(", ")} below. A retraction means the cited result should not be relied on.
              </div>
            </m.div>
          )}
        </AnimatePresence>

        {state.items.length > 0 && (
          <>
            <VerifySummary state={state} filter={filter} onFilter={setFilter} onRecheck={recheckBad} onStop={stop} inPanel />
            <ul className="refs refs-list" aria-busy={state.running} aria-label="Checked references">
              {shown.map(({ it, i }) => (
                <RefCard key={it.id} item={it} index={i} onRecheck={(id) => void recheck([id])} />
              ))}
            </ul>
            {shown.length === 0 && <p className="ask-hint">Nothing in this group.</p>}
          </>
        )}
        {t.pending === 0 && t.attention + t.unchecked > 0 && !state.running && (
          <p className="ask-fine">“Not found” often just means the work is a preprint, book or thesis that Crossref does not index.</p>
        )}
      </div>
    </section>
  );
}
