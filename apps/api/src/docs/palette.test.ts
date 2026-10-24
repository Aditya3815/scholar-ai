import { describe, expect, it } from "vitest";
import { paletteMatch, paletteRank } from "@scholar/shared";

const C = (label: string, group = "Go to", keywords?: string) => ({ label, group, keywords });
const LIST = [C("Home"), C("My Workspace"), C("Library"), C("Dark theme", "Theme", "night"), C("Light theme", "Theme"), C("Open another paper beside this one", "This paper", "split compare two"), C("Glaucoma screening with deep learning", "Your papers")];

describe("paletteMatch", () => {
  it("no words matches everything", () => {
    expect(paletteMatch(C("Home"), "")).toBe(true);
    expect(paletteMatch(C("Home"), "   ")).toBe(true);
  });
  it("every word must start a word of the label, the keywords or the group", () => {
    expect(paletteMatch(C("Dark theme", "Theme", "night"), "dar")).toBe(true);
    expect(paletteMatch(C("Dark theme", "Theme", "night"), "night")).toBe(true);
    expect(paletteMatch(C("Dark theme", "Theme", "night"), "dark night")).toBe(true);
    expect(paletteMatch(C("Dark theme", "Theme", "night"), "dark day")).toBe(false);
    expect(paletteMatch(C("Dark theme", "Theme"), "theme")).toBe(true);
  });
  it("a word may also be inside the label", () => {
    expect(paletteMatch(C("Glaucoma screening"), "ucom")).toBe(true);
  });
  it("is not case sensitive, and punctuation in a label does not hide a word", () => {
    expect(paletteMatch(C("Notes (3)"), "NOTES")).toBe(true);
    expect(paletteMatch(C("Check-in/out"), "out")).toBe(true);
  });
  it("Hindi words work", () => {
    expect(paletteMatch(C("मोतियाबिंद पर लेख", "Your papers"), "मोति")).toBe(true);
  });
});

describe("paletteRank", () => {
  it("puts a label that starts with the query first, then one with a word that does, then the rest", () => {
    const r = paletteRank([C("Open settings"), C("Settings"), C("Reset all", "x", "settings")], "settings").map((c) => c.label);
    expect(r).toEqual(["Settings", "Open settings", "Reset all"]);
  });
  it("keeps the given order among equals, and drops what does not match", () => {
    expect(paletteRank(LIST, "theme").map((c) => c.label)).toEqual(["Dark theme", "Light theme"]);
    expect(paletteRank(LIST, "zzz")).toEqual([]);
  });
  it("finds a command by its keywords", () => {
    expect(paletteRank(LIST, "split").map((c) => c.label)).toEqual(["Open another paper beside this one"]);
  });
  it("an empty query returns everything in order", () => {
    expect(paletteRank(LIST, "")).toEqual(LIST);
  });
});
