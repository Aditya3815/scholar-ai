import { AnimatePresence, m } from "motion/react";
import { AlertCircle, FileUp, Loader2, RefreshCw, X } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { dismissJob, retryJob, startUpload, useJobs, type Job } from "../../lib/documents";
import { easeOut, spring, springPop } from "../../lib/motion";

const STEPS: { id: Job["step"]; label: string }[] = [
  { id: "reading", label: "Read" },
  { id: "uploading", label: "Upload" },
  { id: "indexing", label: "Index" },
];
const order = (s: Job["step"]) => (s === "done" ? 3 : s === "error" ? -1 : STEPS.findIndex((x) => x.id === s));

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function Tick() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <m.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3, ease: easeOut }} />
    </svg>
  );
}

function JobRow({ job }: { job: Job }) {
  const at = order(job.step);
  const failed = job.step === "error";
  const done = job.step === "done";
  return (
    <m.li
      className="job"
      data-state={failed ? "error" : done ? "done" : "busy"}
      layout="position"
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.2 } }}
      transition={spring}
    >
      <div className="job-top">
        <span className="job-ico" aria-hidden="true">
          {failed ? <AlertCircle size={18} /> : done ? <Tick /> : <Loader2 className="spin" size={18} />}
        </span>
        <div className="job-name">
          <p className="job-file">{job.name}</p>
          <p className="job-detail" role={failed ? "alert" : "status"} aria-live="polite">
            {failed ? job.error : job.detail} <span className="job-size">· {kb(job.size)}</span>
          </p>
        </div>
        {failed && job.retryable && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void retryJob(job.key)}>
            <RefreshCw size={14} aria-hidden="true" />
            <span>Try again</span>
          </button>
        )}
        {(failed || done) && (
          <button type="button" className="icon-btn icon-btn-sm" aria-label={`Dismiss ${job.name}`} onClick={() => dismissJob(job.key)}>
            <X size={15} aria-hidden="true" />
          </button>
        )}
      </div>

      {!failed && (
        <>
          <ol className="job-steps" aria-label="Progress">
            {STEPS.map((s, i) => (
              <li key={s.id} data-state={at > i ? "done" : at === i ? "now" : "todo"}>
                <span className="job-dot" aria-hidden="true">
                  {at > i ? <Tick /> : at === i ? <span className="pulse-dot" /> : null}
                </span>
                {s.label}
              </li>
            ))}
          </ol>
          <div className="vbar" role="progressbar" aria-label={`${job.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(((Math.max(at, 0) + job.progress) / 3) * 100)} data-done={done}>
            <m.span className="vbar-fill" initial={false} animate={{ width: `${Math.min(100, ((Math.max(at, 0) + (done ? 0 : job.progress)) / 3) * 100)}%` }} transition={spring} />
          </div>
        </>
      )}
    </m.li>
  );
}

/** Drag a PDF in, or click / press Enter to choose one. Each file shows its own steps while it is read, uploaded and indexed. */
export function UploadZone({ disabled, reason }: { disabled?: boolean; reason?: string }) {
  const jobs = useJobs();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(0);

  const take = (files: FileList | File[] | null) => {
    if (!files || disabled) return;
    for (const f of Array.from(files).slice(0, 5)) void startUpload(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(0);
    take(e.dataTransfer.files);
  };

  return (
    <div className="uz-wrap">
      <m.button
        type="button"
        className="uz"
        data-over={over > 0}
        disabled={disabled}
        aria-label="Upload PDF papers. Drag files here or press Enter to choose files."
        onClick={() => input.current?.click()}
        onDragEnter={(e) => { e.preventDefault(); setOver((n) => n + 1); }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setOver((n) => Math.max(0, n - 1))}
        onDrop={onDrop}
        whileTap={{ scale: 0.995 }}
      >
        <m.span className="uz-ico" aria-hidden="true" animate={over > 0 ? { y: [0, -8, 0], scale: 1.1 } : { y: 0, scale: 1 }} transition={over > 0 ? { y: { repeat: Infinity, duration: 0.9, ease: "easeInOut" }, scale: springPop } : springPop}>
          <FileUp size={26} />
        </m.span>
        <span className="uz-title">{over > 0 ? "Drop to upload" : "Drop PDFs here, or click to choose"}</span>
        <span className="uz-sub">{disabled ? reason : "Up to 25 MB and 500 pages each. Your papers stay private to your account."}</span>
      </m.button>
      <input ref={input} type="file" accept="application/pdf,.pdf" multiple className="sr-only" tabIndex={-1} aria-label="Choose PDF files" onChange={(e) => { take(e.target.files); e.target.value = ""; }} />

      <ul className="jobs" aria-label="Uploads in progress">
        <AnimatePresence initial={false}>
          {jobs.map((j) => (
            <JobRow key={j.key} job={j} />
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
