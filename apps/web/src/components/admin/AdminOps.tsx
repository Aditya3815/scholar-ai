import { CircleAlert, CircleCheck, DatabaseBackup, FolderSearch, UserX } from "lucide-react";
import { useState } from "react";
import type { IntegrityReport, JobState, JobStatus } from "@scholar/shared";

const JOB_NAME: Record<string, string> = { maintenance: "Daily clean-up", retraction_check: "Retraction re-check of saved papers" };
const STATE_TEXT: Record<JobState, string> = {
  ok: "On time",
  failing: "The last run failed",
  stuck: "Started and did not finish",
  overdue: "Did not run in time",
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "never");

/** The scheduled jobs and whether each ran on time. The same states are what /api/v1/health/jobs reports to an uptime check. */
export function Jobs({ jobs }: { jobs: JobStatus[] }) {
  const bad = jobs.filter((j) => j.state !== "ok");
  return (
    <section className="card admin-sec" aria-labelledby="jobs-h">
      <h2 id="jobs-h" className="admin-h2">Scheduled jobs</h2>
      {jobs.length === 0 ? (
        <p className="admin-lead">No heartbeat could be read just now.</p>
      ) : bad.length === 0 ? (
        <p className="admin-lead">Every scheduled job ran on time.</p>
      ) : (
        <p className="admin-test-result" data-state="failed" role="alert">
          {bad.map((j) => `${JOB_NAME[j.name] ?? j.name}: ${STATE_TEXT[j.state].toLowerCase()}`).join(". ")}. See the runbook, “Alerts”.
        </p>
      )}
      {jobs.length > 0 && (
        <table className="admin-table">
          <caption>Each job leaves a heartbeat every time it runs</caption>
          <thead>
            <tr><th scope="col">Job</th><th scope="col">State</th><th scope="col">Last good run</th><th scope="col" className="num">Runs</th><th scope="col" className="num">Failed</th></tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.name}>
                <td>{JOB_NAME[j.name] ?? j.name}</td>
                <td>
                  <span className="admin-job" data-state={j.state}>
                    {j.state === "ok" ? <CircleCheck size={15} aria-hidden="true" /> : <CircleAlert size={15} aria-hidden="true" />}
                    {STATE_TEXT[j.state]}
                  </span>
                  {j.lastError && <span className="admin-job-err"> ({j.lastError})</span>}
                </td>
                <td>{when(j.lastOkAt)}</td>
                <td className="num">{j.runs.toLocaleString("en-IN")}</td>
                <td className="num">{j.failures.toLocaleString("en-IN")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

type Check = { state: "idle" | "running" | "done" | "failed"; report?: IntegrityReport };
type Reapply = { state: "idle" | "confirm" | "running" | "done" | "failed"; markers?: number; erased?: number; failed?: number };

/** Checks to run after a restore, or when storage grows more than expected. Neither shows a person's name or paper text. */
export function DataChecks() {
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [reapply, setReapply] = useState<Reapply>({ state: "idle" });

  const runCheck = async () => {
    setCheck({ state: "running" });
    try {
      const res = await fetch("/api/v1/admin/integrity", { credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      setCheck({ state: "done", report: (await res.json()) as IntegrityReport });
    } catch {
      setCheck({ state: "failed" });
    }
  };
  const runReapply = async () => {
    setReapply({ state: "running" });
    try {
      const res = await fetch("/api/v1/admin/reapply-deletions", { method: "POST", credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as { markers: number; erased: number; failed: number };
      setReapply({ state: j.failed > 0 ? "failed" : "done", ...j });
    } catch {
      setReapply({ state: "failed" });
    }
  };

  const r = check.report;
  const problems = r ? r.missingFiles + r.missingCovers + r.orphanFiles : 0;
  return (
    <section className="card admin-sec" aria-labelledby="checks-h">
      <h2 id="checks-h" className="admin-h2">Data checks</h2>
      <p className="admin-lead">Run these after a database restore, or when storage grows more than expected.</p>

      <div className="admin-test">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void runCheck()} disabled={check.state === "running"} aria-busy={check.state === "running"}>
          <FolderSearch size={15} aria-hidden="true" />
          <span>{check.state === "running" ? "Comparing…" : "Compare papers with stored files"}</span>
        </button>
        <p role="status" className="admin-test-result" data-state={check.state === "failed" || (r && (problems > 0 || r.truncated)) ? "failed" : check.state === "done" ? "ok" : "idle"}>
          {check.state === "failed" && "The check could not run. Try again."}
          {r && r.truncated && `There are more than ${r.files.toLocaleString("en-IN")} files, too many to compare in one go; the counts below are not reliable.`}
          {r && !r.truncated && problems === 0 && `All ${r.documents.toLocaleString("en-IN")} papers and ${r.files.toLocaleString("en-IN")} files match.`}
          {r && !r.truncated && problems > 0 && `${r.missingFiles} paper(s) without a file, ${r.missingCovers} without a cover, ${r.orphanFiles} file(s) without a paper.`}
        </p>
      </div>
      {r && !r.truncated && problems > 0 && (
        <p className="admin-lead">
          Paper ids to look up: {[...r.samples.missingFiles.map((s) => `${s} (no file)`), ...r.samples.missingCovers.map((s) => `${s} (no cover)`), ...r.samples.orphanFiles.map((s) => `${s} (no paper)`)].join(", ")}
          {problems > 10 ? ", and more" : ""}. Files and papers younger than {r.graceMinutes} minutes are not judged.
        </p>
      )}
      {r && r.unrecognised > 0 && <p className="admin-lead">{r.unrecognised} file(s) under docs/ are not in the shape the app writes and were not judged.</p>}

      <div className="admin-test admin-test-gap">
        {reapply.state === "confirm" ? (
          <>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void runReapply()}>
              <span>Yes, erase them again</span>
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReapply({ state: "idle" })}>
              <span>Cancel</span>
            </button>
            <p className="admin-test-result" role="status">This permanently erases every account that was deleted before and has come back. Only do it right after a restore.</p>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReapply({ state: "confirm" })} disabled={reapply.state === "running"} aria-busy={reapply.state === "running"}>
              <DatabaseBackup size={15} aria-hidden="true" />
              <span>{reapply.state === "running" ? "Re-applying…" : "Re-apply deletions after a restore"}</span>
            </button>
            <p role="status" className="admin-test-result" data-state={reapply.state === "failed" ? "failed" : reapply.state === "done" ? "ok" : "idle"}>
              {reapply.state === "done" && `${reapply.markers} deletion marker(s) found; ${reapply.erased} account(s) that had come back were erased again.`}
              {reapply.state === "failed" && (reapply.failed ? `${reapply.erased} erased, ${reapply.failed} could not be erased. Run it again.` : "It could not run. Try again.")}
            </p>
          </>
        )}
      </div>
    </section>
  );
}

type Erase = { state: "idle" | "confirm" | "running" | "done" | "failed"; message?: string };

/**
 * For a request to delete someone's data when they cannot sign in to do it themselves. Same erasure as "Delete my account" (files, papers, library,
 * reports, sign-in, and a deletion marker so that a restore cannot bring it back). The address typed is sent once and not kept.
 */
export function EraseAccount() {
  const [who, setWho] = useState("");
  const [erase, setErase] = useState<Erase>({ state: "idle" });
  const ready = who.trim().length >= 5;

  const run = async () => {
    setErase({ state: "running" });
    try {
      const res = await fetch("/api/v1/admin/erase-account", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account: who, confirm: "ERASE" }) });
      if (res.ok) {
        setWho("");
        return setErase({ state: "done", message: "The account and everything in it were erased. The person is signed out." });
      }
      const j = (await res.json().catch(() => null)) as { title?: string; detail?: string } | null;
      setErase({ state: "failed", message: [j?.title, j?.detail].filter(Boolean).join(". ") || "It could not be erased. Try again." });
    } catch {
      setErase({ state: "failed", message: "It could not be erased. Try again." });
    }
  };

  return (
    <section className="card admin-sec" aria-labelledby="erase-h">
      <h2 id="erase-h" className="admin-h2">Erase an account</h2>
      <p className="admin-lead">For a request to delete someone's data when they cannot sign in to do it themselves. Papers, files, library, reports and sign-in are erased and cannot be brought back. Admins cannot be erased here.</p>
      <div className="admin-erase">
        <label className="admin-erase-label" htmlFor="erase-who">E-mail address or ORCID iD of the person</label>
        <input
          id="erase-who"
          className="admin-erase-input"
          type="text"
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          value={who}
          onChange={(e) => {
            setWho(e.target.value);
            if (erase.state !== "running") setErase({ state: "idle" });
          }}
          placeholder="name@university.edu or 0000-0002-1825-0097"
          aria-describedby="erase-note"
        />
        {erase.state === "confirm" ? (
          <div className="admin-test">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void run()}>
              <span>Yes, erase it for good</span>
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setErase({ state: "idle" })}>
              <span>Cancel</span>
            </button>
            <p className="admin-test-result" role="status">This erases the account for “{who.trim()}” permanently. Check the spelling.</p>
          </div>
        ) : (
          <div className="admin-test">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setErase({ state: "confirm" })} disabled={!ready || erase.state === "running"} aria-busy={erase.state === "running"}>
              <UserX size={15} aria-hidden="true" />
              <span>{erase.state === "running" ? "Erasing…" : "Erase this account…"}</span>
            </button>
            <p id="erase-note" role="status" className="admin-test-result" data-state={erase.state === "failed" ? "failed" : erase.state === "done" ? "ok" : "idle"}>
              {erase.message}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
