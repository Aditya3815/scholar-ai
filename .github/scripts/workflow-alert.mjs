// Turns a failed workflow into a GitHub issue (GitHub e-mails everyone watching the repository) and closes it again when the workflow passes.
//   node .github/scripts/workflow-alert.mjs auto      reads NEEDS (the `needs` context as JSON) to decide: any failure -> open or update, all good -> close
//   node .github/scripts/workflow-alert.mjs failure   |   success     decide by hand
// One open issue per workflow, titled "Workflow failed: <name>". A workflow that keeps failing adds at most one comment every few hours (an hourly
// check must not write 24 comments a day). If GitHub itself refuses (missing permission, rate limit) this prints a warning and exits 0: the run is
// already red, and the alert must never be the thing that hides why.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const LABEL = "workflow-failure";
export const COMMENT_EVERY_HOURS = 6;

export const titleFor = (workflow) => `Workflow failed: ${String(workflow ?? "unknown").replace(/[\r\n]+/g, " ").trim().slice(0, 100) || "unknown"}`;

/** What happened, in one word: failure if any job failed, success if every job passed or was skipped, else nothing (cancelled, or no jobs). */
export function outcomeOf(needsJson) {
  let needs;
  try {
    needs = JSON.parse(needsJson ?? "{}");
  } catch {
    return "none";
  }
  const results = Object.values(needs ?? {}).map((n) => n?.result);
  if (results.length === 0) return "none";
  if (results.includes("failure")) return "failure";
  if (results.includes("cancelled")) return "none";
  return results.every((r) => r === "success" || r === "skipped") ? "success" : "none";
}

/** Plain text from the environment only: no secrets are ever put in an issue. */
export function describeRun(env) {
  const url = `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${env.GITHUB_REPOSITORY ?? ""}/actions/runs/${env.GITHUB_RUN_ID ?? ""}`;
  const detail = String(env.ALERT_DETAIL ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, 500);
  const lines = [
    `Run: ${url}`,
    `Branch: ${env.GITHUB_REF_NAME ?? "?"} · commit ${String(env.GITHUB_SHA ?? "").slice(0, 7) || "?"} · triggered by ${env.GITHUB_EVENT_NAME ?? "?"}`,
    ...(detail ? ["", detail] : []),
  ];
  return { url, text: lines.join("\n") };
}

const hoursSince = (iso, now) => (now - Date.parse(iso)) / 3_600_000;

/**
 * @param {"failure"|"success"|"none"} outcome
 * @param {Record<string,string|undefined>} env  GITHUB_* values (and optional ALERT_DETAIL)
 * @param {(args: string[]) => string} gh        runs `gh` and returns its output; throws on failure
 */
export function alert(outcome, env, gh, now = Date.now()) {
  const log = [];
  if (outcome === "none") return ["nothing to do"];
  if (env.GITHUB_EVENT_NAME === "pull_request") return ["pull request: no alerts"];
  const title = titleFor(env.GITHUB_WORKFLOW);
  const { url, text } = describeRun(env);

  const openIssues = () =>
    JSON.parse(gh(["issue", "list", "--state", "open", "--limit", "200", "--json", "number,title"]) || "[]")
      .filter((i) => i.title === title) // exact: a similar title is a different workflow
      .map((i) => i.number)
      .sort((a, b) => a - b);

  if (outcome === "failure") {
    const found = openIssues();
    if (found.length > 0) {
      const number = found[0];
      const info = JSON.parse(gh(["issue", "view", String(number), "--json", "comments,createdAt"]) || "{}");
      const last = (info.comments ?? []).at(-1)?.createdAt ?? info.createdAt;
      if (last && hoursSince(last, now) < COMMENT_EVERY_HOURS) {
        log.push(`#${number} already open and updated ${hoursSince(last, now).toFixed(1)} h ago: not commenting again`);
        return log;
      }
      gh(["issue", "comment", String(number), "--body", `Still failing.\n\n${text}`]);
      log.push(`commented on #${number}`);
      return log;
    }
    try {
      gh(["label", "create", LABEL, "--color", "B60205", "--description", "A scheduled or main-branch workflow failed", "--force"]);
    } catch {
      log.push("could not create the label (carrying on without it)");
    }
    const body = `${text}\n\nThis issue closes itself when the workflow passes again.`;
    let created;
    try {
      created = gh(["issue", "create", "--title", title, "--body", body, "--label", LABEL]);
    } catch {
      created = gh(["issue", "create", "--title", title, "--body", body]);
    }
    log.push(`opened ${created.trim()}`);
    // Two runs failing together may each have opened one: the lowest number stays, the others are closed as duplicates.
    const mine = Number(/\/(\d+)\s*$/.exec(created.trim())?.[1]);
    const all = openIssues();
    if (all.length > 1 && Number.isFinite(mine) && mine !== all[0]) {
      gh(["issue", "close", String(mine), "--reason", "not planned", "--comment", `Duplicate of #${all[0]}.`]);
      gh(["issue", "comment", String(all[0]), "--body", `Failed again.\n\n${text}`]);
      log.push(`closed #${mine} as a duplicate of #${all[0]}`);
    }
    return log;
  }

  // success
  for (const number of openIssues()) {
    gh(["issue", "close", String(number), "--reason", "completed", "--comment", `Passing again: ${url}`]);
    log.push(`closed #${number}`);
  }
  if (log.length === 0) log.push("no open alert to close");
  return log;
}

const realGh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

export function main(argv, env, gh = realGh, out = console) {
  const mode = argv[2];
  const outcome = mode === "auto" ? outcomeOf(env.NEEDS) : mode === "failure" || mode === "success" ? mode : null;
  if (!outcome) {
    out.error("usage: workflow-alert.mjs auto|failure|success");
    return 2;
  }
  try {
    for (const line of alert(outcome, env, gh)) out.log(line);
  } catch (e) {
    out.log(`::warning::The alert could not be sent or updated: ${String(e?.stderr || e?.message || e).slice(0, 300)}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv, process.env));
