import { ArrowDownUp, Calendar, LockOpen, RotateCcw, User } from "lucide-react";
import { useId } from "react";
import { NO_REFINE, isRefined, type Refine } from "../lib/refine";

const SORTS: { id: Refine["sort"]; label: string }[] = [
  { id: "relevance", label: "Best match" },
  { id: "cited", label: "Most cited" },
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
];

const yearOf = (v: string): number | null => {
  const n = Number(v);
  return v.trim() !== "" && Number.isInteger(n) && n >= 1000 && n <= 2999 ? n : null;
};

/** Sort and narrow the papers of a reply, on the page, at once (no new search). Year range, author, open access, order. */
export function ResultFilters({ value, onChange, shown, total, span }: { value: Refine; onChange: (r: Refine) => void; shown: number; total: number; span: { min: number; max: number } | null }) {
  const id = useId();
  const set = (patch: Partial<Refine>) => onChange({ ...value, ...patch });
  return (
    <div className="rf" role="group" aria-label="Sort and filter these papers">
      <label className="rf-field" htmlFor={`${id}-sort`}>
        <ArrowDownUp size={14} aria-hidden="true" />
        <span className="sr-only">Sort by</span>
        <select id={`${id}-sort`} value={value.sort} onChange={(e) => set({ sort: e.target.value as Refine["sort"] })}>
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </label>
      <span className="rf-field rf-years">
        <Calendar size={14} aria-hidden="true" />
        <label className="sr-only" htmlFor={`${id}-from`}>From year</label>
        <input id={`${id}-from`} inputMode="numeric" maxLength={4} placeholder={span ? String(span.min) : "From"} value={value.from ?? ""} onChange={(e) => set({ from: yearOf(e.target.value) })} />
        <span aria-hidden="true">–</span>
        <label className="sr-only" htmlFor={`${id}-to`}>To year</label>
        <input id={`${id}-to`} inputMode="numeric" maxLength={4} placeholder={span ? String(span.max) : "To"} value={value.to ?? ""} onChange={(e) => set({ to: yearOf(e.target.value) })} />
      </span>
      <label className="rf-field rf-author" htmlFor={`${id}-author`}>
        <User size={14} aria-hidden="true" />
        <span className="sr-only">Author</span>
        <input id={`${id}-author`} type="search" placeholder="Author" value={value.author} onChange={(e) => set({ author: e.target.value })} autoComplete="off" />
      </label>
      <button type="button" className="rf-chip" aria-pressed={value.openOnly} onClick={() => set({ openOnly: !value.openOnly })}>
        <LockOpen size={14} aria-hidden="true" />
        <span>Free to read</span>
      </button>
      {isRefined(value) && (
        <>
          <span className="rf-count" role="status">{shown} of {total}</span>
          <button type="button" className="rf-chip" onClick={() => onChange(NO_REFINE)}>
            <RotateCcw size={14} aria-hidden="true" />
            <span>Reset</span>
          </button>
        </>
      )}
    </div>
  );
}
