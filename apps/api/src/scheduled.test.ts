import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The scheduled handler (src/index.ts). Cloudflare documents that the runtime waits for the promise the handler RETURNS, up to the 15 minutes a Cron Trigger may last; for work handed to
 * `ctx.waitUntil` and left to run after the handler has returned it documents only that it "should settle before the invocation completes" (the 30 seconds it gives are for a response sent
 * or a client that went away, and a cron has neither). The Trending job runs for minutes, so the handler has to hold on to its work itself.
 */

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {},
  WorkflowEntrypoint: class {},
  WorkerEntrypoint: class {},
  RpcTarget: class {},
}));
vi.mock("cloudflare:workflows", () => ({ NonRetryableError: class extends Error {} }));

const jobs = vi.hoisted(() => ({
  trending: vi.fn<() => Promise<unknown>>(),
  maintenance: vi.fn<() => Promise<unknown>>(),
  retraction: vi.fn<() => Promise<unknown>>(),
}));
vi.mock("./trending/job", () => ({ runTrendingFromEnv: jobs.trending }));
vi.mock("./maintenance", () => ({ runMaintenance: jobs.maintenance }));
vi.mock("./library/retraction", () => ({ recheckRetractions: jobs.retraction }));
vi.mock("./jobs", async (orig) => ({ ...(await orig<typeof import("./jobs")>()), runJob: async (_db: unknown, _name: string, job: () => Promise<unknown>) => job() }));

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  vi.restoreAllMocks();
  jobs.maintenance.mockResolvedValue({});
  jobs.retraction.mockResolvedValue({});
  jobs.trending.mockResolvedValue({});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the scheduled handler", () => {
  it("does not return before the three jobs are over: the Trending job's minutes are inside the promise the runtime waits for", async () => {
    const worker = (await import("./index")).default;
    let release!: () => void;
    jobs.trending.mockReturnValue(new Promise<void>((r) => (release = r)));
    const waitUntil = vi.fn();
    const env = { DB: {}, CROSSREF_MAILTO: "ops@example.org" } as never;
    let returned = false;
    const done = Promise.resolve(worker.scheduled({ scheduledTime: Date.now(), cron: "17 3 * * *" } as ScheduledController, env, { waitUntil } as unknown as ExecutionContext)).then(() => {
      returned = true;
    });
    await flush();
    expect(jobs.maintenance).toHaveBeenCalledTimes(1);
    expect(jobs.retraction).toHaveBeenCalledTimes(1);
    expect(jobs.trending).toHaveBeenCalledTimes(1);
    expect(returned, "the handler returned while the Trending job was still running").toBe(false);
    release();
    await done;
    expect(returned).toBe(true);
  });

  it("a job that fails is reported and does not stop the others, and the handler still returns", async () => {
    const worker = (await import("./index")).default;
    jobs.trending.mockRejectedValue(new Error("openalex: http HTTP 429"));
    const env = { DB: {}, CROSSREF_MAILTO: "ops@example.org" } as never;
    await expect(Promise.resolve(worker.scheduled({ scheduledTime: Date.now(), cron: "17 3 * * *" } as ScheduledController, env, { waitUntil: vi.fn() } as unknown as ExecutionContext))).resolves.toBeUndefined();
    expect(jobs.maintenance).toHaveBeenCalledTimes(1);
    expect(jobs.retraction).toHaveBeenCalledTimes(1);
  });
});
