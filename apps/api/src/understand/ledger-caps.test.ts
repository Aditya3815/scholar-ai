import { describe, expect, it } from "vitest";
import { LEDGER_TITLE_CHARS, LEDGER_USER_CHARS } from "@scholar/shared";
import { readLedger } from "./ledger-input";

/** The server reads the ledger with the browser's caps (bug B20, decision 15: 300 characters of the person's words, 200 of a title), not caps of its own (600 and 250). */
describe("the ledger's caps are one set (B20)", () => {
  it("cuts the person's words at 300 and a title at 200, as the browser does when it builds the ledger", () => {
    const r = readLedger([{ turn: 1, user: "u".repeat(700), intent: "search", standalone: "q", reply: null, papers: [{ n: 1, id: null, doi: null, title: "t".repeat(400), year: 2020, first_author: null }] }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([LEDGER_USER_CHARS, LEDGER_TITLE_CHARS]).toEqual([300, 200]);
    expect(r.turns[0]!.user.length).toBe(LEDGER_USER_CHARS);
    expect(r.turns[0]!.papers[0]!.title.length).toBe(LEDGER_TITLE_CHARS);
  });
});
