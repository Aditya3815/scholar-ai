import { m } from "motion/react";
import { Download, RefreshCw, ShieldAlert, Square } from "lucide-react";
import { easeOut, spring, springPop } from "../../lib/motion";
import { attentionText, reportCsv } from "../../lib/refReport";
import { downloadText } from "../../lib/download";
import { BUCKETS, tally, type Bucket } from "../../lib/refStatus";
import type { VerifyState } from "../../lib/verify";
import { CopyButton } from "../CiteMenu";

export type Filter = "all" | Bucket;

/** A count that rolls in when it changes (not a count-up from 0: these change while results stream in). */
const Num = ({ n }: { n: number }) => (
  <m.span key={n} className="chip-n" initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={springPop}>
    {n}
  </m.span>
);

export function VerifySummary({
  state,
  filter,
  onFilter,
  onRecheck,
  onStop,
  inPanel = false,
}: {
  state: VerifyState;
  filter: Filter;
  onFilter: (f: Filter) => void;
  onRecheck: () => void;
  onStop: () => void;
  /** Inside a scrolling side panel: not pinned under the page header. */
  inPanel?: boolean;
}) {
  const t = tally(state.items);
  const total = state.items.length;
  const settled = total - t.pending;
  const done = !state.running && t.pending === 0;
  const flagged = attentionText(state.items);

  // One atomic message for assistive tech (not a bare number in a live region).
  const message = done
    ? `${total} ${total === 1 ? "reference" : "references"} checked: ${t.verified} verified, ${t.attention} need attention, ${t.unchecked} could not be checked.`
    : `Checking references: ${settled} of ${total} done.`;
  const allGood = done && t.attention === 0 && t.unchecked === 0 && t.retracted === 0 && total > 0;

  const counts: Record<Filter, number> = { all: total, verified: t.verified, attention: t.attention, unchecked: t.unchecked };

  return (
    <>
    <m.section className={`card vsum${inPanel ? " vsum-panel" : ""}`} aria-label="Summary" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: easeOut }}>
      <div className="vsum-top">
        <p className="vsum-headline" role="status" aria-atomic="true">
          <span className="sr-only">{message}</span>
          <span aria-hidden="true">
            {done ? (allGood ? "Every reference matches a real paper" : `${total} ${total === 1 ? "reference" : "references"} checked`) : `Checked ${settled} of ${total}`}
          </span>
        </p>
        {state.running && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onStop}>
            <Square size={13} aria-hidden="true" />
            <span>Stop</span>
          </button>
        )}
      </div>

      <div className="vbar" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={settled} data-done={done}>
        <m.span className="vbar-fill" initial={false} animate={{ width: total ? `${(settled / total) * 100}%` : "0%" }} transition={spring} />
      </div>

      <div className="filters" role="group" aria-label="Show">
        <button type="button" className="chip-btn" aria-pressed={filter === "all"} onClick={() => onFilter("all")}>
          All <Num n={counts.all} />
        </button>
        {BUCKETS.map((b) => (
          <button key={b.id} type="button" className="chip-btn" data-bucket={b.id} aria-pressed={filter === b.id} disabled={counts[b.id] === 0 && filter !== b.id} onClick={() => onFilter(filter === b.id ? "all" : b.id)}>
            {b.label} <Num n={counts[b.id]} />
          </button>
        ))}
      </div>
    </m.section>

    <div className="vtools">
      {t.retracted > 0 && !inPanel && (
        <m.p className="vsum-retract" role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: easeOut }}>
          <ShieldAlert size={16} aria-hidden="true" />
          {t.retracted === 1 ? "1 reference in your list has been retracted." : `${t.retracted} references in your list have been retracted.`}
        </m.p>
      )}

      {state.skipped > 0 && (
        <p className="vsum-note">Only the first {state.items.length} references were checked. Run the other {state.skipped} as a second list in Verify references.</p>
      )}

      {settled > 0 && (
        <div className="actions vsum-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadText("reference-check.csv", reportCsv(state.items), "text/csv;charset=utf-8")}>
            <Download size={15} aria-hidden="true" />
            <span>Download report (CSV)</span>
          </button>
          {flagged && <CopyButton text={flagged} label="Copy flagged references" />}
          {t.unchecked > 0 && !state.running && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onRecheck}>
              <RefreshCw size={15} aria-hidden="true" />
              <span>Check {t.unchecked} again</span>
            </button>
          )}
        </div>
      )}
    </div>
    </>
  );
}
