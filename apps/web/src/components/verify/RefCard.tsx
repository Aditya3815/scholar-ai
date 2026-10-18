import { m } from "motion/react";
import { ExternalLink, Eye, Info, RefreshCw, ShieldAlert } from "lucide-react";
import { useState } from "react";
import type { Paper, RefChecks, RefRecord } from "@scholar/shared";
import { easeOut, springPop, stagger } from "../../lib/motion";
import { openPreview } from "../../lib/preview";
import { statusOf } from "../../lib/refStatus";
import type { VerifyItem } from "../../lib/verify";
import { CiteMenu } from "../CiteMenu";

/** The record we matched, as a Paper, so the existing cite menu can format it. */
const asPaper = (r: RefRecord): Paper => ({
  id: r.doi ? `doi:${r.doi}` : `t:${r.title}`,
  doi: r.doi,
  pmid: null,
  title: r.title,
  authors: r.authors,
  year: r.year,
  venue: r.venue,
  abstract: null,
  citationCount: null,
  oaUrl: null,
  retracted: false,
  retractionSources: [],
  sources: ["crossref"],
  score: 0,
});

const authorLine = (a: string[]) => (a.length === 0 ? "No authors listed" : a.length <= 4 ? a.join(", ") : `${a.slice(0, 3).join(", ")} et al.`);

/** What was compared, in words, so a verdict is never a black box. Each pill has an icon-free text meaning of its own. */
function Checks({ checks }: { checks: RefChecks }) {
  const items: { ok: boolean | null; text: string }[] = [
    { ok: checks.title >= 0.8, text: checks.title >= 0.95 ? "Title matches" : `Title ${Math.round(checks.title * 100)}% matches` },
    { ok: checks.author, text: checks.author === null ? "Record lists no authors" : checks.author ? "Author matches" : "Authors differ" },
    { ok: checks.year, text: checks.year === null ? "Year not compared" : checks.year ? "Year matches" : "Year differs" },
  ];
  return (
    <ul className="ref-checks" aria-label="What was compared">
      {items.map(({ ok, text }, i) => (
        <m.li key={text} className="ref-check" data-ok={ok === null ? "na" : String(ok)} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: easeOut, delay: 0.12 + i * 0.06 }}>
          <span className="ref-check-mark" aria-hidden="true">{ok === null ? "–" : ok ? "✓" : "✕"}</span>
          {text}
        </m.li>
      ))}
    </ul>
  );
}

function StatusIcon({ item }: { item: VerifyItem }) {
  const s = statusOf(item);
  const key = item.state === "done" ? item.verdict?.status : item.state;
  return (
    <m.span key={key} className="ref-ico" data-tone={item.state === "done" || item.state === "error" ? s.tone : "pending"} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={springPop} aria-hidden="true">
      {item.state === "queued" || item.state === "checking" ? (
        <span className={item.state === "checking" ? "pulse-dot" : "queued-dot"} />
      ) : item.verdict?.status === "verified" ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9.5" />
          <m.path d="M7.5 12.5l3.2 3.2 5.8-6.4" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, ease: easeOut, delay: 0.1 }} />
        </svg>
      ) : (
        <s.Icon size={20} />
      )}
    </m.span>
  );
}

export function RefCard({ item, index, onRecheck }: { item: VerifyItem; index: number; onRecheck: (id: number) => void }) {
  const [full, setFull] = useState(false);
  const s = statusOf(item);
  const v = item.verdict;
  const settled = item.state === "done" || item.state === "error";
  const pending = item.state === "queued" || item.state === "checking";
  const doiHref = v?.match?.doi ? `https://doi.org/${v.match.doi}` : null;
  const canRecheck = item.state === "error" || v?.status === "unverifiable";

  const headline = pending ? (item.state === "checking" ? "Checking…" : "Waiting") : s.label;

  return (
    <m.li
      className="card ref"
      data-state={item.state}
      data-bucket={settled ? s.bucket : "pending"}
      data-status={v?.status}
      data-retracted={v?.retracted ? "true" : undefined}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.16 } }}
      transition={{ duration: 0.38, ease: easeOut, delay: stagger(index) }}
    >
      <div className="ref-head">
        <StatusIcon item={item} />
        <p className="ref-status" data-tone={settled ? s.tone : "pending"}>{headline}</p>
        {v?.cached && <span className="ref-cached" title="Answered from a recent identical check">recent</span>}
        <span className="ref-num" aria-label={`Reference ${index + 1}`}>#{index + 1}</span>
      </div>

      <p className={`ref-input ${full ? "" : "clamp"}`}>{item.input}</p>
      {item.input.length > 190 && (
        <button type="button" className="link-btn" aria-expanded={full} onClick={() => setFull((f) => !f)}>
          {full ? "Show less" : "Show full reference"}
        </button>
      )}

      {pending && (
        <div className="ref-skeleton" aria-hidden="true">
          <span className="sk sk-body" />
          <span className="sk sk-body sk-short" />
        </div>
      )}

      {settled && (
        <m.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: easeOut, delay: 0.08 }}>
          <p className="ref-reason" role={item.state === "error" ? "alert" : undefined}>{v?.reason ?? item.error}</p>

          {v?.retracted && (
            <m.div className="retract" role="alert" initial={{ opacity: 0, x: 0 }} animate={{ opacity: 1, x: [0, -6, 6, -4, 4, 0] }} transition={{ duration: 0.5, delay: 0.2 }}>
              <ShieldAlert size={18} aria-hidden="true" />
              <div>
                <strong>This paper has been retracted.</strong> Do not cite it without reading the retraction notice.
                <span className="retract-src"> Flagged by Crossref / Retraction Watch.</span>
              </div>
            </m.div>
          )}

          {v?.status === "not_found" && s.help && (
            <p className="ref-help">
              <Info size={15} aria-hidden="true" />
              <span>{s.help}</span>
            </p>
          )}

          {v?.match && (
            <div className="ref-match">
              <p className="ref-match-label">{v.status === "verified" ? "Matched record" : "Closest real record"}</p>
              <p className="ref-match-title">{v.match.title}</p>
              <p className="ref-match-meta">
                {authorLine(v.match.authors)}
                {v.match.year ? ` · ${v.match.year}` : ""}
                {v.match.venue ? ` · ${v.match.venue}` : ""}
              </p>
            </div>
          )}

          {v?.match && v.checks && <Checks checks={v.checks} />}

          {(v?.match || canRecheck) && (
            <div className="actions">
              {v?.match && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => openPreview({ ...asPaper(v.match!), retracted: !!v.retracted, retractionSources: v.retracted ? ["crossref-retraction-watch"] : [] })}>
                  <Eye size={15} aria-hidden="true" />
                  <span>Preview record</span>
                </button>
              )}
              {v?.match && v.status !== "not_found" && <CiteMenu paper={asPaper(v.match)} />}
              {doiHref && (
                <a className="btn btn-ghost btn-sm" href={doiHref} target="_blank" rel="noreferrer noopener">
                  <ExternalLink size={15} aria-hidden="true" />
                  <span>Open DOI</span>
                </a>
              )}
              {canRecheck && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRecheck(item.id)}>
                  <RefreshCw size={15} aria-hidden="true" />
                  <span>Check again</span>
                </button>
              )}
            </div>
          )}
        </m.div>
      )}
    </m.li>
  );
}
