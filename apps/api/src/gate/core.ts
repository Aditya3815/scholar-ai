/**
 * One shared "lane" to a service that limits how fast it may be asked (V5).
 *
 * Workers isolates share no memory, so a limiter written inside the Worker is only exact for one isolate; with several running, each one thinks
 * it is alone and together they go over the service's limit. The scheduler below is the decision ("may a call start now, and if not, in how
 * long?"). It is pure (time is given to it) so every rule can be tested without a clock; `GateCore` adds the waiting in order; the Durable Object
 * in `api-gate.ts` is the one place all isolates ask.
 */
export type GateConfig = {
  /** Smallest gap between two calls starting. */
  minIntervalMs: number;
  /** Calls in flight at once. */
  maxConcurrent: number;
  /** At most `max` calls start in any `ms` (a service that counts per minute rather than per second). */
  window?: { max: number; ms: number };
  /** Calls per UTC day (a service with a daily allowance). */
  dailyBudget?: number;
  /** A call that never reported back (the Worker died) stops counting as in flight after this long. */
  leaseMs: number;
};

export type GateState = { day: number; used: number; closedUntil: number; nextStart: number; starts: number[] };
export const freshState = (): GateState => ({ day: -1, used: 0, closedUntil: 0, nextStart: 0, starts: [] });

export type Take = { ok: true; lease: string } | { ok: false; reason: "wait" | "concurrency" | "closed" | "budget"; retryInMs: number };

const DAY_MS = 86_400_000;
/** While waiting for a call in flight to finish nothing says when that will be, so the lane looks again this often. */
export const POLL_MS = 25;

export class Scheduler {
  private leases = new Map<string, number>(); // lease id -> when it stops counting
  private seq = 0;

  constructor(readonly cfg: GateConfig, private st: GateState = freshState()) {}

  take(now: number): Take {
    for (const [id, expires] of this.leases) if (expires <= now) this.leases.delete(id);
    const day = Math.floor(now / DAY_MS);
    if (day !== this.st.day) {
      this.st.day = day;
      this.st.used = 0;
    }
    if (this.st.closedUntil > now) return { ok: false, reason: "closed", retryInMs: this.st.closedUntil - now };
    if (this.cfg.dailyBudget !== undefined && this.st.used >= this.cfg.dailyBudget) return { ok: false, reason: "budget", retryInMs: (day + 1) * DAY_MS - now };
    if (this.leases.size >= this.cfg.maxConcurrent) {
      const soonestExpiry = Math.min(...this.leases.values()) - now;
      return { ok: false, reason: "concurrency", retryInMs: Math.max(1, Math.min(POLL_MS, soonestExpiry)) };
    }
    if (now < this.st.nextStart) return { ok: false, reason: "wait", retryInMs: this.st.nextStart - now };
    const w = this.cfg.window;
    if (w) {
      this.st.starts = this.st.starts.filter((t) => t > now - w.ms);
      if (this.st.starts.length >= w.max) return { ok: false, reason: "wait", retryInMs: this.st.starts[0]! + w.ms - now };
    }
    this.st.nextStart = now + this.cfg.minIntervalMs;
    if (w) this.st.starts.push(now);
    this.st.used++;
    const lease = `${now}-${this.seq++}`;
    this.leases.set(lease, now + this.cfg.leaseMs);
    return { ok: true, lease };
  }

  release(lease: string): void {
    this.leases.delete(lease);
  }

  /** The service itself said "not before then" (a 429 with a reset time): nobody starts a call until it has passed. */
  closeUntil(until: number): void {
    this.st.closedUntil = Math.max(this.st.closedUntil, until);
  }

  inFlight(): number {
    return this.leases.size;
  }

  state(): GateState {
    return { ...this.st, starts: [...this.st.starts] };
  }
}

export type Acquired = { ok: true; lease: string } | { ok: false; reason: "busy" | "budget" | "closed"; retryInMs: number };

export type GateDeps = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Called after the state changes, so a Durable Object can keep it across restarts. */
  save?: (state: GateState) => void | Promise<void>;
};

/**
 * `Scheduler` plus waiting in turn. Callers are served first come, first served; a caller whose wait cannot end within `maxWaitMs` is
 * turned away at once (a search that would wait a minute is better off without that source) instead of holding its place in the line.
 */
export class GateCore {
  readonly scheduler: Scheduler;
  private line: number[] = [];
  private tickets = 0;

  constructor(cfg: GateConfig, private deps: GateDeps, state?: GateState) {
    this.scheduler = new Scheduler(cfg, state);
  }

  async acquire(maxWaitMs: number): Promise<Acquired> {
    const deadline = this.deps.now() + Math.max(0, maxWaitMs);
    const ticket = this.tickets++;
    this.line.push(ticket);
    try {
      for (;;) {
        const now = this.deps.now();
        const myTurn = this.line[0] === ticket;
        let waitMs = POLL_MS;
        if (myTurn) {
          const r = this.scheduler.take(now);
          if (r.ok) {
            await this.deps.save?.(this.scheduler.state());
            return { ok: true, lease: r.lease };
          }
          // a wait that is known to be longer than the time left is not worth starting
          if (r.reason !== "concurrency" && now + r.retryInMs > deadline) return { ok: false, reason: r.reason === "wait" ? "busy" : r.reason, retryInMs: r.retryInMs };
          waitMs = r.retryInMs;
        }
        const left = deadline - now;
        if (left <= 0) return { ok: false, reason: "busy", retryInMs: POLL_MS };
        await this.deps.sleep(Math.max(1, Math.min(waitMs, left)));
      }
    } finally {
      this.line.splice(this.line.indexOf(ticket), 1);
    }
  }

  release(lease: string): void {
    this.scheduler.release(lease);
  }

  async closeUntil(until: number): Promise<void> {
    this.scheduler.closeUntil(until);
    await this.deps.save?.(this.scheduler.state());
  }
}
