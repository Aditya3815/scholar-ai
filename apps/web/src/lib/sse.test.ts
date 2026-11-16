import { describe, expect, it } from "vitest";
import { readSse } from "./sse";
import { sse } from "../test/fake-net";

/** The page's event-stream reader (docs/design/untangle.md, F9): how it splits a stream into events, what it skips, how it stops, and bug B1. */

const read = async (res: Response, onEvent: (e: unknown) => void = () => {}, signal?: AbortSignal) => {
  const seen: unknown[] = [];
  await readSse(res, (e) => (seen.push(e), onEvent(e)), signal);
  return seen;
};

describe("readSse", () => {
  it("hands each event's JSON on, in order; a blank line ends an event and only its data: line is read", async () => {
    const res = sse([{ type: "a" }, "event: b\ndata: {\"type\":\"b\"}\n\n", ": keep-alive\n\n", { type: "c", n: 1 }]);
    expect(await read(res)).toEqual([{ type: "a" }, { type: "b" }, { type: "c", n: 1 }]);
  });

  it("reads an event split across chunks, and a last event with no blank line after it", async () => {
    const res = sse(["data: {\"ty", "pe\":\"a\"}\n", "\ndata: {\"type\":\"b\"}"]);
    expect(await read(res)).toEqual([{ type: "a" }, { type: "b" }]);
  });

  it("skips an event whose JSON does not parse, and carries on", async () => {
    const res = sse(["data: {not json\n\n", { type: "after" }]);
    expect(await read(res)).toEqual([{ type: "after" }]);
  });

  it("rejects with an AbortError when the signal aborts, and stops reading", async () => {
    const ctl = new AbortController();
    const seen: unknown[] = [];
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(`data: {"type":"a"}\n\n`));
      },
    });
    const p = readSse(new Response(stream), (e) => {
      seen.push(e);
      ctl.abort();
    }, ctl.signal);
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(seen).toEqual([{ type: "a" }]);
  });

  it("throws a TypeError for a reply without a body", async () => {
    await expect(readSse(new Response(null), () => {})).rejects.toBeInstanceOf(TypeError);
  });
});
