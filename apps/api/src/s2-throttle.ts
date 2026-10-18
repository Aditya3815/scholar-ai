import { DurableObject } from "cloudflare:workers";
import { reserveSlot } from "./throttle";

/**
 * One global instance serialises Semantic Scholar calls to the key's limit of 1 request/second. Workers isolates share no
 * memory, so a limiter inside the Worker cannot be exact; a Durable Object is the single place all of them agree on.
 */
export class S2Throttle extends DurableObject {
  /** Milliseconds the caller must wait before calling Semantic Scholar, or null if the queue is too long to be worth it. */
  async reserve(maxWaitMs: number, intervalMs = 1000): Promise<number | null> {
    const nextFree = (await this.ctx.storage.get<number>("nextFree")) ?? 0;
    const slot = reserveSlot(Date.now(), nextFree, maxWaitMs, intervalMs);
    if (!slot) return null;
    await this.ctx.storage.put("nextFree", slot.nextFree);
    return slot.waitMs;
  }
}
