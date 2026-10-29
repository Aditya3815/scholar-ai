import { describe, expect, it } from "vitest";
import { testD1 } from "../test-d1";
import { rememberOne } from "./remember";

const long = (n: number) => `A highlighted sentence that is long enough to be offered, number ${n}.`;
function setup(notes: { id: string; doc: string; quote: string }[]) {
  const t = testD1();
  t.sql.prepare("INSERT INTO users (id, email) VALUES ('u1','a@example.org'), ('u2','b@example.org')").run();
  t.sql.prepare("INSERT INTO documents (id, user_id, title, filename, size_bytes) VALUES ('d1','u1','Paper one','a.pdf',1), ('d2','u2','Paper two','b.pdf',1)").run();
  for (const n of notes) t.sql.prepare("INSERT INTO doc_notes (id, doc_id, page, quote) VALUES (?, ?, 1, ?)").run(n.id, n.doc, n.quote);
  return t;
}

describe("rememberOne", () => {
  it("someone with no highlights gets nothing, and so does someone whose highlights are all short", async () => {
    const { db } = setup([{ id: "n1", doc: "d1", quote: "too short" }]);
    expect(await rememberOne(db, "u1", 0, 100)).toEqual({ highlight: null, total: 0 });
    expect(await rememberOne(db, "nobody", 0, 100)).toEqual({ highlight: null, total: 0 });
  });
  it("gives the highlight with its paper and page, and the count of those that could be offered", async () => {
    const { db } = setup([{ id: "n1", doc: "d1", quote: long(1) }, { id: "n2", doc: "d1", quote: "short" }]);
    expect(await rememberOne(db, "u1", 0, 5)).toEqual({ highlight: { docId: "d1", title: "Paper one", page: 1, quote: long(1), note: "", color: "yellow" }, total: 1 });
  });
  it("is the same one all day, the next ones for skip 1, 2, ... and wraps round the list", async () => {
    const { db } = setup([1, 2, 3].map((i) => ({ id: `n${i}`, doc: "d1", quote: long(i) })));
    const at = async (skip: number, day = 3) => (await rememberOne(db, "u1", skip, day)).highlight!.quote;
    expect(await at(0)).toBe(long(1)); // 3 % 3 = 0
    expect(await at(0)).toBe(long(1));
    expect(await at(1)).toBe(long(2));
    expect(await at(2)).toBe(long(3));
    expect(await at(3)).toBe(long(1));
    expect(await at(0, 4)).toBe(long(2)); // tomorrow is another one
    expect(await at(-5)).toBe(long(1)); // a negative skip is no skip
  });
  it("never offers another person's highlight", async () => {
    const { db } = setup([{ id: "n1", doc: "d2", quote: long(1) }]);
    expect(await rememberOne(db, "u1", 0, 0)).toEqual({ highlight: null, total: 0 });
    expect((await rememberOne(db, "u2", 0, 0)).total).toBe(1);
  });
});
