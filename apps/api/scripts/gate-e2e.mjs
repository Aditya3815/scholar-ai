// Shared lane integration test (V5): the real Worker and the real (local) Durable Object, through the dev-only route /api/v1/dev/gate.
// Ten calls sent at once to the Crossref lane must start one at a time (340 ms apart), never more than three together, and none may be lost.
// `npm run integration -w apps/api` starts everything. The CORE lane (a minute-long window, a daily allowance that the object keeps) is covered by unit tests:
// its state survives between runs, which would make a repeated local run depend on the one before.
const APP = process.env.APP ?? "http://localhost:8788";
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };
const burst = async (body) => {
  const res = await fetch(`${APP}/api/v1/dev/gate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, ...(await res.json()) };
};

try {
  console.log("a refused name");
  ok((await burst({ name: "nonsense", n: 1 })).status === 400, "an unknown lane is refused");

  console.log("ten calls at once to the Crossref lane");
  const t0 = Date.now();
  const r = await burst({ name: "crossref", n: 10, holdMs: 150, maxWaitMs: 10_000 });
  const starts = r.results.filter((x) => "startedAt" in x).map((x) => x.startedAt).sort((a, b) => a - b);
  const gaps = starts.slice(1).map((s, i) => s - starts[i]);
  ok(starts.length === 10, `all ten were let through (${starts.length}); none refused (${r.results.length - starts.length})`);
  ok(r.peak <= 3, `never more than three in flight together (peak ${r.peak})`);
  // The lane spaces starts 340 ms apart. A start time is read from a clock that stands still while the Worker computes, so two neighbours can look closer than they were (236 ms and
  // 198 ms were seen on CI); with no spacing at all the gaps would be near zero, which is what this must catch. The spread below checks the spacing on average.
  ok(Math.min(...gaps) >= 120, `each started about 340 ms after the one before, never less than 120 (smallest gap ${Math.min(...gaps)} ms)`);
  ok(starts.at(-1) - starts[0] >= 9 * 300, `so the ten took about 3 seconds, not an instant (${starts.at(-1) - starts[0]} ms of spread, ${Date.now() - t0} ms in all)`);

  console.log("calls that take long are held to three at a time");
  const slow = await burst({ name: "crossref", n: 5, holdMs: 900, maxWaitMs: 15_000 });
  ok(slow.results.every((x) => "startedAt" in x) && slow.peak === 3, `five calls of 0.9 s: all served, and exactly three at the most together (peak ${slow.peak})`);

  console.log("a caller that cannot wait is turned away, not queued");
  const short = await burst({ name: "crossref", n: 8, holdMs: 0, maxWaitMs: 400 });
  const refused = short.results.filter((x) => "refused" in x);
  const served = short.results.filter((x) => "startedAt" in x);
  ok(served.length >= 1 && served.length <= 3, `only the calls that fit inside 400 ms went through (${served.length})`);
  ok(refused.length >= 5 && refused.every((x) => /busy|asked us to wait/.test(x.refused)), `the others were refused with a reason (${refused.length}: ${refused[0]?.refused})`);

  console.log("the lane is not left blocked");
  await new Promise((res) => setTimeout(res, 1_500));
  const after = await burst({ name: "crossref", n: 3, holdMs: 0, maxWaitMs: 5_000 });
  ok(after.results.every((x) => "startedAt" in x), "after a pause three more calls go through (places of refused callers were not kept, finished calls released theirs)");
} catch (e) {
  console.error(e);
  failures++;
}
console.log(failures ? `\n${failures} FAILED` : "\ngate integration passed");
process.exit(failures ? 1 : 0);
