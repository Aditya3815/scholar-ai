import { describe, expect, it } from "vitest";
import { parseNotebookMd } from "@scholar/shared";
import { activeMarks, continueList, isOn, toggleHeading, toggleList, toggleMark, type Edit } from "./md-edit";

/** "a [b] c" is the value with the selection between the brackets (a cursor: "a [] c"). */
const at = (s: string): Edit => {
  const start = s.indexOf("[");
  const end = s.indexOf("]") - 1;
  return { value: s.replace("[", "").replace("]", ""), start, end };
};
const show = (e: Edit) => `${e.value.slice(0, e.start)}[${e.value.slice(e.start, e.end)}]${e.value.slice(e.end)}`;

describe("the toolbar's marks: wrap and unwrap", () => {
  it("wraps a selection in each mark, keeping the selection on the words", () => {
    expect(show(toggleMark(at("a [word] c"), "b"))).toBe("a **[word]** c");
    expect(show(toggleMark(at("a [word] c"), "i"))).toBe("a *[word]* c");
    // underline is written ++word++ since 20 Nov 2026 (one syntax with the renderer and the exports)
    expect(show(toggleMark(at("a [word] c"), "u"))).toBe("a ++[word]++ c");
    expect(show(toggleMark(at("a [word] c"), "mark"))).toBe("a ==[word]== c");
  });

  it("unwraps when the marks are just outside the selection, or at its ends", () => {
    expect(show(toggleMark(at("a **[word]** c"), "b"))).toBe("a [word] c");
    expect(show(toggleMark(at("a [**word**] c"), "b"))).toBe("a [word] c");
    expect(show(toggleMark(at("a ++[w]++ c"), "u"))).toBe("a [w] c");
    expect(show(toggleMark(at("a [++w++] c"), "u"))).toBe("a [w] c");
    // an underline of the old kind (<u>) is read as one and taken away by the toolbar
    expect(show(toggleMark(at("a <u>[w]</u> c"), "u"))).toBe("a [w] c");
    expect(show(toggleMark(at("a [<u>w</u>] c"), "u"))).toBe("a [w] c");
    expect(activeMarks(at("a <u>[w]</u> c")).has("u")).toBe(true);
    expect(show(toggleMark(at("a ==[w]== c"), "mark"))).toBe("a [w] c");
  });

  it("tells bold from italic by the run of stars (a bold italic is both)", () => {
    expect(show(toggleMark(at("**[w]**"), "i"))).toBe("***[w]***");
    expect(show(toggleMark(at("***[w]***"), "i"))).toBe("**[w]**");
    expect(show(toggleMark(at("***[w]***"), "b"))).toBe("*[w]*");
    expect([...activeMarks(at("***[w]***"))].sort()).toEqual(["b", "i"]);
    expect([...activeMarks(at("**[w]**"))]).toEqual(["b"]);
    expect([...activeMarks(at("plain [w]"))]).toEqual([]);
  });

  it("keeps spaces at the selection's ends outside the marks, so the result is read as a mark", () => {
    const e = toggleMark(at("a[ word ]c"), "b");
    expect(e.value).toBe("a **word** c");
    expect(parseNotebookMd(e.value)).toEqual([{ t: "p", c: [{ t: "text", s: "a " }, { t: "b", c: [{ t: "text", s: "word" }] }, { t: "text", s: " c" }] }]);
  });

  it("with nothing selected: an empty pair with the cursor inside, and pressed again it goes", () => {
    const e = toggleMark(at("say []"), "b");
    expect(show(e)).toBe("say **[]**");
    expect(show(toggleMark(e, "b"))).toBe("say []");
  });
});

describe("the toolbar's lines: heading and lists", () => {
  it("H makes the touched lines a heading, and plain again", () => {
    const e = toggleHeading(at("Intro[]\nnext"));
    expect(e.value).toBe("# Intro\nnext");
    expect(isOn(e, "h")).toBe(true);
    expect(toggleHeading(e).value).toBe("Intro\nnext");
  });

  it("a bullet or numbered list of the touched lines (blank lines left alone), and off again; one kind replaces the other", () => {
    const sel = { value: "one\ntwo\n\nthree", start: 0, end: 14 };
    const ul = toggleList(sel, "ul");
    expect(ul.value).toBe("- one\n- two\n\n- three");
    expect(isOn(ul, "ul")).toBe(true);
    const ol = toggleList(ul, "ol");
    expect(ol.value).toBe("1. one\n2. two\n\n3. three");
    expect(toggleList(ol, "ol").value).toBe("one\ntwo\n\nthree");
  });

  it("Enter at the end of a list item continues the list; on an empty item it ends it; elsewhere it is a plain Enter", () => {
    expect(show(continueList(at("- milk[]"))!)).toBe("- milk\n- []");
    expect(show(continueList(at("1. one\n2. two[]"))!)).toBe("1. one\n2. two\n3. []");
    expect(show(continueList(at("- milk\n- []"))!)).toBe("- milk\n[]");
    expect(continueList(at("- mi[]lk"))).toBeNull();
    expect(continueList(at("plain[]"))).toBeNull();
    expect(continueList(at("- [milk]"))).toBeNull();
  });
});
