import { DurableObject } from "cloudflare:workers";
import { GateCore, freshState, type Acquired, type GateState } from "./core";
import { GATES, type GateName, type RemoteGate } from "./index";

/**
 * The one place every isolate asks before calling a rate-limited service (V5). One Durable Object per lane (`getByName("crossref")`).
 * Its state (today's count, the calls of the last minute, "closed until") is kept in storage, so a restart of the object does not forget
 * that CORE was already asked nine times this minute.
 */
export class ApiGate extends DurableObject implements RemoteGate {
  private cores = new Map<GateName, Promise<GateCore>>();

  private core(name: GateName): Promise<GateCore> {
    if (!(name in GATES)) throw new Error(`unknown gate ${String(name)}`);
    let core = this.cores.get(name);
    if (!core) {
      core = this.ctx.storage.get<GateState>(`state:${name}`).then(
        (saved) =>
          new GateCore(
            GATES[name],
            { now: () => Date.now(), sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)), save: (s) => this.ctx.storage.put(`state:${name}`, s) },
            { ...freshState(), ...saved },
          ),
      );
      this.cores.set(name, core);
    }
    return core;
  }

  async acquire(name: GateName, maxWaitMs: number): Promise<Acquired> {
    return (await this.core(name)).acquire(Math.min(Math.max(0, Number(maxWaitMs) || 0), 30_000));
  }
  async release(name: GateName, lease: string): Promise<void> {
    (await this.core(name)).release(String(lease));
  }
  async closeUntil(name: GateName, until: number): Promise<void> {
    // never trust a caller to close the lane for more than a day
    await (await this.core(name)).closeUntil(Math.min(Number(until) || 0, Date.now() + 86_400_000));
  }
}

/** The Durable Object as `withGate` wants it. */
export const remoteGate = (ns: DurableObjectNamespace<ApiGate>): RemoteGate => ({
  acquire: (name, maxWaitMs) => ns.getByName(name).acquire(name, maxWaitMs),
  release: (name, lease) => ns.getByName(name).release(name, lease),
  closeUntil: (name, until) => ns.getByName(name).closeUntil(name, until),
});
