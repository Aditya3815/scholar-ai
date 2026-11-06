import { describe, expect, it } from "vitest";
import { understandFlag } from "./understand-flag";

const kv = (value: string | null) => ({ get: async () => value });

describe("CHAT_UNDERSTAND", () => {
  it("is off when unset, and off (reported bad) for anything that is not off, shadow or on", async () => {
    expect((await understandFlag({})).position).toBe("off");
    for (const v of ["ON", "true", "", "core", "writer"]) {
      const r = await understandFlag({ CHAT_UNDERSTAND: v });
      expect(r.position, v).toBe("off");
      expect(r.badVariable, v).toBe(true);
    }
  });

  it("reads shadow and on", async () => {
    expect((await understandFlag({ CHAT_UNDERSTAND: "shadow" }, { cache: new Map() })).position).toBe("shadow");
    expect((await understandFlag({ CHAT_UNDERSTAND: "on" }, { cache: new Map() })).position).toBe("on");
  });

  it("lets a KV override only lower it", async () => {
    expect((await understandFlag({ CHAT_UNDERSTAND: "on", CACHE: kv("shadow") }, { cache: new Map() })).position).toBe("shadow");
    expect((await understandFlag({ CHAT_UNDERSTAND: "shadow", CACHE: kv("on") }, { cache: new Map() })).position).toBe("shadow");
    expect((await understandFlag({ CHAT_UNDERSTAND: "on", CACHE: kv("off") }, { cache: new Map() })).position).toBe("off");
  });

  it("does not read KV when off", async () => {
    let reads = 0;
    await understandFlag({ CACHE: { get: async () => (reads++, "on") } }, { cache: new Map() });
    expect(reads).toBe(0);
  });
});
