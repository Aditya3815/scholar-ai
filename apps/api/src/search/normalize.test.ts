import { describe, expect, it } from "vitest";
import { normalizeDoi } from "./normalize";

describe("normalizeDoi", () => {
  it.each([
    ["https://doi.org/10.1051/bioconf/202621302009/pdf", "10.1051/bioconf/202621302009"],
    ["10.1002/abc.123/full", "10.1002/abc.123"],
    ["10.1016/J.CELL.2015.03.017.", "10.1016/j.cell.2015.03.017"],
    ["10.1007/s11263-019-01228-7/epdf", "10.1007/s11263-019-01228-7"],
    ["not a doi", null],
  ])("%s", (raw, expected) => expect(normalizeDoi(raw)).toBe(expected));
});
