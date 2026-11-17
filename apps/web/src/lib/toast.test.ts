import { describe, expect, it } from "vitest";
import { TOAST_MAX_WAITING, createToastQueue } from "./toast";

/** A fake clock: a timer runs when `advance` passes its time. */
function clock() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    set: (fn: () => void, ms: number) => {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clear: (id: number) => void timers.delete(id),
    now: () => now,
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].fn();
      }
      now = end;
    },
  };
}

describe("the reader's toasts (docs/design/paper-reader.md, 11)", () => {
  it("shows one at a time, each for 4 seconds, in order", () => {
    const c = clock();
    const q = createToastQueue(c);
    q.push("one");
    q.push("two");
    expect(q.current()?.text).toBe("one");
    expect(q.waitingCount()).toBe(1);
    c.advance(3999);
    expect(q.current()?.text).toBe("one");
    c.advance(1);
    expect(q.current()?.text).toBe("two");
    c.advance(4000);
    expect(q.current()).toBeNull();
  });

  it("Undo runs its action once and closes the toast", () => {
    const c = clock();
    const q = createToastQueue(c);
    let undone = 0;
    const id = q.push("Highlight removed", { label: "Undo", run: () => undone++ });
    expect(q.current()?.action?.label).toBe("Undo");
    q.act(id);
    q.act(id);
    expect(undone).toBe(1);
    expect(q.current()).toBeNull();
  });

  it("a second action (Open beside Undo) runs alone, once, and closes the toast too", () => {
    const c = clock();
    const q = createToastQueue(c);
    const ran: string[] = [];
    const id = q.push('Added to "Notes"', { label: "Undo", run: () => ran.push("undo") }, { label: "Open", run: () => ran.push("open") });
    expect(q.current()?.more?.label).toBe("Open");
    q.act(id, "more");
    q.act(id, "more");
    expect(ran).toEqual(["open"]);
    expect(q.current()).toBeNull();
  });

  it("stops its clock while pointed at or focused, and then goes on with the time it had left", () => {
    const c = clock();
    const q = createToastQueue(c);
    q.push("one");
    c.advance(3000);
    q.pause(true);
    c.advance(60_000);
    expect(q.current()?.text).toBe("one");
    q.pause(false);
    c.advance(999);
    expect(q.current()?.text).toBe("one");
    c.advance(1);
    expect(q.current()).toBeNull();
  });

  it("while paused, the next toast does not run its clock either", () => {
    const c = clock();
    const q = createToastQueue(c);
    q.push("one");
    q.pause(true);
    q.push("two");
    c.advance(10_000);
    expect(q.current()?.text).toBe("one");
    q.dismiss();
    c.advance(10_000);
    expect(q.current()?.text).toBe("two");
    q.pause(false);
    c.advance(4000);
    expect(q.current()).toBeNull();
  });

  it("keeps only the last few waiting, and a waiting toast can be taken out of the line", () => {
    const c = clock();
    const q = createToastQueue(c);
    q.push("shown");
    const ids = ["a", "b", "c", "d", "e"].map((t) => q.push(t));
    expect(q.waitingCount()).toBe(TOAST_MAX_WAITING);
    q.dismiss(ids[4]);
    expect(q.waitingCount()).toBe(TOAST_MAX_WAITING - 1);
    q.dismiss();
    expect(q.current()?.text).toBe("c");
  });
});
