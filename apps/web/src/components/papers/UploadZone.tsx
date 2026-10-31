import { AnimatePresence, m } from "motion/react";
import { AlertCircle, FileUp, Loader2, Pause, Play, RefreshCw, X } from "lucide-react";
import { Suspense, lazy, useEffect, useRef, useState, type DragEvent } from "react";
import { continueScan, dismissJob, pauseScan, retryJob, startUpload, useJobs, type Job } from "../../lib/documents";
import { easeOut, spring, springPop } from "../../lib/motion";
import { riveAllowed } from "../../lib/rive-env";

// two pictures drawn by Rive files (docs/design/rive-ideas.md); their runtime is a chunk of its own, fetched only when a picture is wanted and allowed. Both have the page's own icon as a fallback.
const Reading = lazy(() => import("./Reading"));
const DropBox = lazy(() => import("./DropBox"));

const STEPS: { id: Job["step"]; label: string }[] = [
  { id: "reading", label: "Read" },
  { id: "uploading", label: "Upload" },
  { id: "indexing", label: "Index" },
];
// A paper of page pictures has a different last step: its pages are read one by one, by models, which is the long part.
const SCAN_STEPS: typeof STEPS = [
  { id: "reading", label: "Read" },
  { id: "uploading", label: "Upload" },
  { id: "scanning", label: "Read the pages" },
];
const order = (s: Job["step"], steps: typeof STEPS) => (s === "done" ? 3 : s === "error" ? -1 : steps.findIndex((x) => x.id === s || (s === "paused" && x.id === "scanning") || (s === "indexing" && x.id === "scanning" && steps === SCAN_STEPS)));

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function Tick() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <m.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3, ease: easeOut }} />
    </svg>
  );
}

function JobRow({ job }: { job: Job }) {
  const steps = job.scanned ? SCAN_STEPS : STEPS;
  const at = order(job.step, steps);
  const failed = job.step === "error";
  const done = job.step === "done";
  const paused = job.step === "paused";
  const [scene] = useState(riveAllowed);
  const icon = (
    <span className="job-ico" aria-hidden="true">
      {failed ? <AlertCircle size={18} /> : done ? <Tick /> : paused ? <Pause size={18} /> : <Loader2 className="spin" size={18} />}
    </span>
  );
  return (
    <m.li
      className="job"
      data-state={failed ? "error" : done ? "done" : paused ? "paused" : "busy"}
      layout="position"
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.2 } }}
      transition={spring}
    >
      <div className="job-top">
        {scene ? (
          <span className="job-scene" aria-hidden="true">
            <Suspense fallback={icon}>
              <Reading step={job.step} progress={job.progress} fallback={icon} />
            </Suspense>
          </span>
        ) : (
          icon
        )}
        <div className="job-name">
          <p className="job-file">{job.name}</p>
          <p className="job-detail" role={failed ? "alert" : "status"} aria-live="polite">
            {failed ? job.error : job.detail} <span className="job-size">· {kb(job.size)}</span>
          </p>
        </div>
        {job.step === "scanning" && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => pauseScan(job.key)}>
            <Pause size={14} aria-hidden="true" />
            <span>Pause</span>
          </button>
        )}
        {paused && job.docId && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void continueScan({ id: job.docId!, filename: job.name, sizeBytes: job.size })}>
            <Play size={14} aria-hidden="true" />
            <span>Continue</span>
          </button>
        )}
        {failed && job.retryable && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void retryJob(job.key)}>
            <RefreshCw size={14} aria-hidden="true" />
            <span>Try again</span>
          </button>
        )}
        {(failed || done || paused) && (
          <button type="button" className="icon-btn icon-btn-sm" aria-label={`Dismiss ${job.name}`} onClick={() => dismissJob(job.key)}>
            <X size={15} aria-hidden="true" />
          </button>
        )}
      </div>

      {!failed && (
        <>
          <ol className="job-steps" aria-label="Progress">
            {steps.map((s, i) => (
              <li key={s.id} data-state={at > i ? "done" : at === i ? "now" : "todo"}>
                <span className="job-dot" aria-hidden="true">
                  {at > i ? <Tick /> : at === i ? <span className="pulse-dot" /> : null}
                </span>
                {s.label}
              </li>
            ))}
          </ol>
          <div className="vbar" role="progressbar" aria-label={`${job.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(((Math.max(at, 0) + (done ? 0 : job.progress)) / 3) * 100)} data-done={done}>
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
  // a file was just dropped (for the picture, for about a second), and whether pictures may be shown at all
  const [dropped, setDropped] = useState(false);
  const droppedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [scene] = useState(riveAllowed);
  useEffect(() => () => clearTimeout(droppedTimer.current), []);

  const take = (files: FileList | File[] | null) => {
    if (!files || disabled) return;
    for (const f of Array.from(files).slice(0, 5)) void startUpload(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(0);
    setDropped(true);
    clearTimeout(droppedTimer.current);
    droppedTimer.current = setTimeout(() => setDropped(false), 1300);
    take(e.dataTransfer.files);
  };

  // the icon the zone always had; the picture of the box shows over it when it has been drawn, and it stays when the picture cannot be shown
  const fileIcon = (
    <m.span className="uz-ico" aria-hidden="true" animate={over > 0 ? { y: [0, -8, 0], scale: 1.1 } : { y: 0, scale: 1 }} transition={over > 0 ? { y: { repeat: Infinity, duration: 0.9, ease: "easeInOut" }, scale: springPop } : springPop}>
      <FileUp size={26} />
    </m.span>
  );

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
        {scene ? (
          <span className="uz-scene-box" aria-hidden="true">
            <Suspense fallback={fileIcon}>
              <DropBox over={over > 0} dropped={dropped} off={!!disabled} fallback={fileIcon} />
            </Suspense>
          </span>
        ) : (
          fileIcon
        )}
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
