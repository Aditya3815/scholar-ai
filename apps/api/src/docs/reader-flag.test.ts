import { describe, expect, it } from "vitest";
import { readerBetaUsers, readerOnFor } from "./reader-flag";
import { positionOfVariable } from "../platform/switches";

const kv = (value: string | null) => ({ get: async () => value }) as unknown as KVNamespace;

describe("the switch of the new Paper Reader (READER)", () => {
  it("is off when unset, and off for any value that is not exactly dark or on", async () => {
    expect(await readerOnFor(undefined, "u-1")).toBe(false);
    expect(await readerOnFor({}, "u-1")).toBe(false);
    for (const v of ["ON", "Dark", "true", "", "shadow", "beta", "core", "writer", " on"]) expect(await readerOnFor({ READER: v, READER_BETA_USERS: "u-1" }, "u-1"), v).toBe(false);
  });

  it("dark shows the new reader only to the accounts of READER_BETA_USERS; on to everyone", async () => {
    const dark = { READER: "dark", READER_BETA_USERS: " u-1, u-2\nu-3 " };
    expect(readerBetaUsers(dark)).toEqual(["u-1", "u-2", "u-3"]);
    expect(await readerOnFor(dark, "u-3")).toBe(true);
    expect(await readerOnFor(dark, "u-9")).toBe(false);
    expect(await readerOnFor({ READER: "dark" }, "u-1")).toBe(false);
    expect(await readerOnFor({ READER: "on" }, "u-9")).toBe(true);
  });

  it("can only be lowered by the KV key flag:READER, never raised", async () => {
    expect(await readerOnFor({ READER: "on", CACHE: kv("off") } as never, "u-1")).toBe(false);
    expect(await readerOnFor({ READER: "on", READER_BETA_USERS: "u-1", CACHE: kv(" DARK ") } as never, "u-1")).toBe(true);
    expect(await readerOnFor({ READER: "on", READER_BETA_USERS: "u-1", CACHE: kv("dark") } as never, "u-2")).toBe(false);
    expect(await readerOnFor({ READER: "dark", READER_BETA_USERS: "u-1", CACHE: kv("on") } as never, "u-2")).toBe(false);
    expect(await readerOnFor({ READER: "off", CACHE: kv("on") } as never, "u-1")).toBe(false);
  });

  it("the shared reader knows dark only for a flag that asks for it", () => {
    expect(positionOfVariable("dark", false)).toEqual({ position: "off", bad: true });
    expect(positionOfVariable("dark", false, false, true)).toEqual({ position: "off", bad: true });
    expect(positionOfVariable("dark", false, false, false, true)).toEqual({ position: "dark", bad: false });
  });
});
