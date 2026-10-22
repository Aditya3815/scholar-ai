import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMENT_EVERY_HOURS, alert, describeRun, main, outcomeOf, titleFor } from "./workflow-alert.mjs";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const ago = (h) => new Date(NOW - h * 3_600_000).toISOString();
const ENV = { GITHUB_WORKFLOW: "Q&A quality (real models)", GITHUB_RUN_ID: "42", GITHUB_REPOSITORY: "o/r", GITHUB_SERVER_URL: "https://github.com", GITHUB_REF_NAME: "main", GITHUB_SHA: "abcdef1234567", GITHUB_EVENT_NAME: "schedule" };

/** A fake `gh` over a list of open issues; records every call. */
function fakeGh(issues = [], opts = {}) {
  const calls = [];
  let nextNumber = opts.nextNumber ?? 100;
  const gh = (args) => {
    calls.push(args);
    const [a, b] = args;
    if (a === "issue" && b === "list") return JSON.stringify(issues.map(({ number, title }) => ({ number, title })));
    if (a === "issue" && b === "view") {
      const i = issues.find((x) => String(x.number) === args[2]);
      return JSON.stringify({ createdAt: i?.createdAt ?? ago(100), comments: (i?.comments ?? []).map((c) => ({ createdAt: c })) });
    }
    if (a === "label") {
      if (opts.labelFails) throw new Error("no permission");
      return "";
    }
    if (a === "issue" && b === "create") {
      if (opts.createWithLabelFails && args.includes("--label")) throw new Error("label not found");
      const number = nextNumber++;
      issues.push({ number, title: args[args.indexOf("--title") + 1] });
      return `https://github.com/o/r/issues/${number}\n`;
    }
    if (a === "issue" && (b === "comment" || b === "close")) return "";
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };
  return { gh, calls, issues };
}
const verbs = (calls) => calls.map((c) => c.slice(0, 2).join(" "));

test("the title names the workflow, on one line, and is bounded", () => {
  assert.equal(titleFor("CI"), "Workflow failed: CI");
  assert.equal(titleFor("a\nb\r\nc"), "Workflow failed: a b c");
  assert.equal(titleFor("x".repeat(500)).length, "Workflow failed: ".length + 100);
  assert.equal(titleFor(undefined), "Workflow failed: unknown");
  assert.equal(titleFor("   "), "Workflow failed: unknown");
});

test("outcomeOf: any failure fails; all passed or skipped succeeds; cancelled or nothing does nothing", () => {
  const n = (...r) => JSON.stringify(Object.fromEntries(r.map((x, i) => [`j${i}`, { result: x }])));
  assert.equal(outcomeOf(n("success", "failure")), "failure");
  assert.equal(outcomeOf(n("success", "success")), "success");
  assert.equal(outcomeOf(n("success", "skipped")), "success");
  assert.equal(outcomeOf(n("cancelled", "success")), "none");
  assert.equal(outcomeOf(n("failure", "cancelled")), "failure"); // a real failure is not hidden by a cancellation
  assert.equal(outcomeOf(n("skipped", "skipped")), "success");
  assert.equal(outcomeOf("{}"), "none");
  assert.equal(outcomeOf("not json"), "none");
  assert.equal(outcomeOf(undefined), "none");
  assert.equal(outcomeOf("null"), "none");
});

test("describeRun has the run link, branch, short commit and trigger, and cleans the detail", () => {
  const { url, text } = describeRun({ ...ENV, ALERT_DETAIL: "health returned 503\u0000\u0007 \n retry" });
  assert.equal(url, "https://github.com/o/r/actions/runs/42");
  assert.match(text, /Run: https:\/\/github\.com\/o\/r\/actions\/runs\/42/);
  assert.match(text, /main · commit abcdef1 · triggered by schedule/);
  assert.doesNotMatch(text, /[\u0000\u0007]/);
  assert.ok(describeRun({ ...ENV, ALERT_DETAIL: "x".repeat(2000) }).text.length < 700);
  assert.doesNotMatch(describeRun({}).text, /undefined/);
});

test("a first failure looks for an open issue, then creates the label and one issue with it, then checks for duplicates", () => {
  const f = fakeGh();
  const log = alert("failure", ENV, f.gh, NOW);
  assert.deepEqual(verbs(f.calls), ["issue list", "label create", "issue create", "issue list"]);
  const create = f.calls[2];
  assert.equal(create[create.indexOf("--title") + 1], "Workflow failed: Q&A quality (real models)");
  assert.ok(create.includes("--label"));
  assert.match(create[create.indexOf("--body") + 1], /actions\/runs\/42/);
  assert.match(log.join("\n"), /opened https:\/\/github\.com\/o\/r\/issues\/100/);
});

test("a failure while one is already open comments, once the last comment is old enough", () => {
  const f = fakeGh([{ number: 7, title: "Workflow failed: Q&A quality (real models)", createdAt: ago(30), comments: [ago(10)] }]);
  alert("failure", ENV, f.gh, NOW);
  assert.deepEqual(verbs(f.calls), ["issue list", "issue view", "issue comment"]);
  assert.equal(f.calls[2][2], "7");
  assert.match(f.calls[2][4], /Still failing/);
});

test("an hourly failure does not write an hourly comment", () => {
  const f = fakeGh([{ number: 7, title: "Workflow failed: Q&A quality (real models)", createdAt: ago(30), comments: [ago(COMMENT_EVERY_HOURS - 1)] }]);
  const log = alert("failure", ENV, f.gh, NOW);
  assert.deepEqual(verbs(f.calls), ["issue list", "issue view"]);
  assert.match(log.join(""), /not commenting again/);
});

test("with no comments yet, the age of the issue itself counts", () => {
  const fresh = fakeGh([{ number: 7, title: "Workflow failed: Q&A quality (real models)", createdAt: ago(1), comments: [] }]);
  alert("failure", ENV, fresh.gh, NOW);
  assert.equal(verbs(fresh.calls).includes("issue comment"), false);
  const old = fakeGh([{ number: 7, title: "Workflow failed: Q&A quality (real models)", createdAt: ago(20), comments: [] }]);
  alert("failure", ENV, old.gh, NOW);
  assert.equal(verbs(old.calls).includes("issue comment"), true);
});

test("an issue for a different workflow, or one with a similar title, is not touched", () => {
  const f = fakeGh([{ number: 3, title: "Workflow failed: CI" }, { number: 4, title: "Workflow failed: Q&A quality (real models) extra" }, { number: 5, title: "Something else" }]);
  alert("failure", ENV, f.gh, NOW);
  assert.ok(verbs(f.calls).includes("issue create"));
  assert.equal(verbs(f.calls).includes("issue comment"), false);
});

test("two runs failing together leave one issue: the later one closes itself as a duplicate", () => {
  const f = fakeGh([{ number: 90, title: "Workflow failed: Q&A quality (real models)", createdAt: ago(0), comments: [] }], { nextNumber: 91 });
  // the other run's issue appeared after our own check for an existing one: simulate by listing it only on the second list call
  let lists = 0;
  const gh = (args) => {
    if (args[0] === "issue" && args[1] === "list" && lists++ === 0) return "[]";
    return f.gh(args);
  };
  const log = alert("failure", ENV, gh, NOW);
  assert.match(log.join("\n"), /closed #91 as a duplicate of #90/);
  const close = f.calls.find((c) => c[1] === "close");
  assert.deepEqual(close.slice(0, 3), ["issue", "close", "91"]);
});

test("if the label cannot be created or used, the issue is still opened", () => {
  const f = fakeGh([], { labelFails: true, createWithLabelFails: true });
  const log = alert("failure", ENV, f.gh, NOW);
  assert.ok(f.calls.some((c) => c[1] === "create" && !c.includes("--label")));
  assert.match(log.join("\n"), /opened/);
});

test("success closes every open issue for this workflow, with a link to the passing run, and nothing else", () => {
  const f = fakeGh([{ number: 7, title: "Workflow failed: Q&A quality (real models)" }, { number: 8, title: "Workflow failed: Q&A quality (real models)" }, { number: 9, title: "Workflow failed: CI" }]);
  alert("success", ENV, f.gh, NOW);
  const closed = f.calls.filter((c) => c[1] === "close").map((c) => c[2]);
  assert.deepEqual(closed, ["7", "8"]);
  assert.match(f.calls.find((c) => c[1] === "close").join(" "), /Passing again: https:\/\/github\.com\/o\/r\/actions\/runs\/42/);
});

test("success with nothing open does nothing", () => {
  const f = fakeGh();
  assert.deepEqual(alert("success", ENV, f.gh, NOW), ["no open alert to close"]);
  assert.deepEqual(verbs(f.calls), ["issue list"]);
});

test("pull requests and 'none' never alert", () => {
  const f = fakeGh();
  alert("failure", { ...ENV, GITHUB_EVENT_NAME: "pull_request" }, f.gh, NOW);
  alert("none", ENV, f.gh, NOW);
  assert.equal(f.calls.length, 0);
});

const sink = () => {
  const lines = [];
  return { lines, log: (l) => lines.push(l), error: (l) => lines.push(`E:${l}`) };
};

test("main: a GitHub error becomes a warning and the exit code is 0, so the original failure stays the visible one", () => {
  const out = sink();
  const code = main(["node", "x", "failure"], ENV, () => {
    throw Object.assign(new Error("boom"), { stderr: "Resource not accessible by integration" });
  }, out);
  assert.equal(code, 0);
  assert.match(out.lines.join("\n"), /::warning::The alert could not be sent or updated: Resource not accessible/);
});

test("main: auto reads NEEDS; a wrong or missing mode is a usage error", () => {
  const f = fakeGh();
  const out = sink();
  assert.equal(main(["node", "x", "auto"], { ...ENV, NEEDS: JSON.stringify({ check: { result: "failure" } }) }, f.gh, out), 0);
  assert.ok(verbs(f.calls).includes("issue create"));
  assert.equal(main(["node", "x", "bogus"], ENV, f.gh, out), 2);
  assert.equal(main(["node", "x"], ENV, f.gh, out), 2);
});

test("the issue never contains anything from the environment other than the listed run facts", () => {
  const f = fakeGh();
  alert("failure", { ...ENV, GH_TOKEN: "ghs_SECRET", CLOUDFLARE_API_TOKEN: "cf_SECRET" }, f.gh, NOW);
  assert.doesNotMatch(JSON.stringify(f.calls), /SECRET/);
});
