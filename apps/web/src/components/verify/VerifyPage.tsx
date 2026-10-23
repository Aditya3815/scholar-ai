import { AnimatePresence, m } from "motion/react";
import { BadgeCheck, SearchCheck, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { easeOut, stagger } from "../../lib/motion";
import { takeHandoff } from "../../lib/workspace";
import { bucketOf, tally } from "../../lib/refStatus";
import { useVerify } from "../../lib/verify";
import { RefCard } from "./RefCard";
import { ReferenceInput } from "./ReferenceInput";
import { VerifySummary, type Filter } from "./VerifySummary";

const DRAFT_KEY = "scholar.verify.draft";

/** Real papers plus two that look right but are not: shows what each verdict means in 10 seconds. */
const EXAMPLE = `[1] Watson, J. D., & Crick, F. H. C. (1953). Molecular structure of nucleic acids: A structure for deoxyribose nucleic acid. Nature, 171, 737–738.
[2] LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521, 436–444.
[3] Kumar, V., & Iyer, S. (2015). Deep learning. Nature, 521, 436–444.
[4] Sharma, R., & Mehta, K. (2022). Quantum-inspired blockchain consensus for rural healthcare records in India. Journal of Distributed Health Systems, 14(3), 211–229.`;

const rise = (i: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, ease: easeOut, delay: 0.08 + stagger(i, 0.09) },
});

const HOW = [
  { Icon: BadgeCheck, title: "Verified", body: "The title and at least one of author or year match a real record in Crossref or OpenAlex, and nothing contradicts it." },
  { Icon: TriangleAlert, title: "Details don’t match", body: "A real paper with this title exists, but the authors or year differ. This is the classic pattern of an AI-made reference." },
  { Icon: SearchCheck, title: "Not found", body: "No match in Crossref. That can mean the reference is made up, or that it is a book, thesis or regional journal that Crossref does not index." },
];

function readDraft(): string {
  try {
    return sessionStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

export function VerifyPage() {
  const { state, start, recheck, stop, clear } = useVerify();
  const [text, setText] = useState(() => takeHandoff("verify") || readDraft());
  const [filter, setFilter] = useState<Filter>("all");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, text);
    } catch {
      /* private mode: the draft just is not remembered */
    }
  }, [text]);

  const t = tally(state.items);
  const hasRun = state.items.length > 0;
  const progress = `Checking ${state.items.length - t.pending} of ${state.items.length}`;

  const run = useCallback(
    (entries: string[]) => {
      setFilter("all");
      void start(entries);
      window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }), 60);
    },
    [start],
  );

  const shown = useMemo(
    () => state.items.map((it, i) => ({ it, i })).filter(({ it }) => filter === "all" || bucketOf(it) === filter),
    [state.items, filter],
  );

  const recheckBad = () => void recheck(state.items.filter((it) => bucketOf(it) === "unchecked" && it.verdict?.status !== "unparsed").map((it) => it.id));

  return (
    <div className="verify">
      <section className="vhead" aria-labelledby="verify-h">
        <div className="orbs" aria-hidden="true">
          <span className="orb orb-1" />
          <span className="orb orb-2" />
        </div>
        <m.p className="eyebrow" {...rise(0)}>Reference Verifier</m.p>
        <m.h1 id="verify-h" className="vtitle" {...rise(1)}>
          Is every reference in your thesis{" "}
          <span className="hero-em">
            real
            <svg className="hero-underline" viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden="true">
              <m.path d="M3 8c22-6 48-7 62-4s34 3 52-1" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: easeOut, delay: 0.7 }} />
            </svg>
          </span>
          ?
        </m.h1>
        <m.p className="vsub" {...rise(2)}>
          Paste your bibliography. Each entry is looked up in Crossref and OpenAlex, and anything that does not match a real paper is flagged. Nothing is guessed or written by AI.
        </m.p>
      </section>

      <m.div {...rise(3)}>
        <ReferenceInput
          value={text}
          onChange={setText}
          onSubmit={run}
          running={state.running}
          progress={progress}
          onExample={() => { setText(EXAMPLE); inputRef.current?.focus(); }}
          onClear={() => { setText(""); clear(); setFilter("all"); inputRef.current?.focus(); }}
          inputRef={inputRef}
        />
      </m.div>

      {!hasRun && (
        <ul className="principles vhow" aria-label="How verdicts work">
          {HOW.map(({ Icon, title, body }, i) => (
            <m.li key={title} className="card principle" {...rise(4 + i)}>
              <span className="principle-ico" aria-hidden="true"><Icon size={20} /></span>
              <h2 className="principle-title">{title}</h2>
              <p>{body}</p>
            </m.li>
          ))}
        </ul>
      )}

      <div ref={resultsRef} className="vresults">
        {hasRun && <VerifySummary state={state} filter={filter} onFilter={setFilter} onRecheck={recheckBad} onStop={stop} />}

        {hasRun && (
          <ul className="refs" aria-busy={state.running} aria-label="Reference results">
            <AnimatePresence initial>
              {shown.map(({ it, i }) => (
                <RefCard key={it.id} item={it} index={i} onRecheck={(id) => void recheck([id])} />
              ))}
            </AnimatePresence>
          </ul>
        )}
        {hasRun && shown.length === 0 && (
          <div className="empty">
            <p className="empty-title">Nothing in this group</p>
            <button type="button" className="btn btn-ghost" onClick={() => setFilter("all")}>Show all</button>
          </div>
        )}
      </div>
    </div>
  );
}
