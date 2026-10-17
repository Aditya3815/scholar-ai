import { m } from "motion/react";
import { PROVIDER_LABELS, type ProviderStatus } from "@scholar/shared";
import { AlertTriangle, BadgeCheck, ShieldCheck, Zap } from "lucide-react";
import type { SearchState } from "../lib/search";
import { easeOut } from "../lib/motion";

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

function Tick() {
  // Check mark "draw" hota hai: path length 0 -> 1
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <m.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, ease: easeOut }} />
    </svg>
  );
}

function Chip({ label, status, pending }: { label: string; status?: ProviderStatus; pending: boolean }) {
  const state = pending ? "pending" : status?.ok ? "ok" : "error";
  return (
    <m.li
      className="src-chip"
      data-state={state}
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: easeOut }}
      title={status?.error}
    >
      <span className="src-ico" aria-hidden="true">
        {state === "pending" && <span className="pulse-dot" />}
        {state === "ok" && (status?.cached ? <Zap size={14} /> : <Tick />)}
        {state === "error" && <AlertTriangle size={14} />}
      </span>
      <span className="src-name">{label}</span>
      {status && (
        <span className="src-meta">
          {status.ok ? `${status.count} · ${status.cached ? "cached" : fmtMs(status.ms)}` : "unavailable"}
        </span>
      )}
    </m.li>
  );
}

export function SourceStatus({ state }: { state: SearchState }) {
  const ids = Object.keys(PROVIDER_LABELS) as (keyof typeof PROVIDER_LABELS)[];
  const loading = state.status === "loading";
  const finished = ids.filter((id) => state.providers[id]).length;

  let summary = "";
  if (loading) summary = `Searching… ${finished} of ${ids.length} sources responded`;
  else if (state.status === "done") {
    const first = state.firstResultMs != null && state.firstResultMs < (state.tookMs ?? 0) ? ` · first results in ${fmtMs(state.firstResultMs)}` : "";
    summary = `${state.results.length} papers in ${fmtMs(state.tookMs ?? 0)}${first}`;
  }

  const rc = state.retractionCheck;
  const dc = state.doiCheck;
  return (
    <div className="src-wrap">
      <p className="src-summary" role="status" aria-live="polite">
        {summary}
      </p>
      <ul className="src-list" aria-label="Sources">
        {ids.map((id) => (
          <Chip key={id} label={PROVIDER_LABELS[id]} status={state.providers[id]} pending={loading && !state.providers[id]} />
        ))}
        <m.li className="src-chip" data-state={dc ? (dc.ok ? "ok" : "error") : "pending"} layout title={dc?.ok ? "Every DOI is checked against Crossref and doi.org; DOIs that do not exist, or belong to a different record, are removed." : dc?.error}>
          <span className="src-ico" aria-hidden="true">
            {!dc ? (loading ? <span className="pulse-dot" /> : null) : dc.ok ? <BadgeCheck size={14} /> : <AlertTriangle size={14} />}
          </span>
          <span className="src-name">DOI check</span>
          {dc && <span className="src-meta">{dc.ok ? (dc.count > 0 ? `${dc.count} removed` : "all valid") : "unavailable"}</span>}
        </m.li>
        <m.li className="src-chip" data-state={rc ? (rc.ok ? "ok" : "error") : "pending"} layout title={rc?.error}>
          <span className="src-ico" aria-hidden="true">
            {!rc ? (loading ? <span className="pulse-dot" /> : null) : rc.ok ? <ShieldCheck size={14} /> : <AlertTriangle size={14} />}
          </span>
          <span className="src-name">Retraction check</span>
          {rc && <span className="src-meta">{rc.ok ? (rc.count > 0 ? `${rc.count} flagged` : "none flagged") : "unavailable"}</span>}
        </m.li>
      </ul>
    </div>
  );
}
