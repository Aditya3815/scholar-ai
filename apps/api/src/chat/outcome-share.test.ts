import { describe, expect, it } from "vitest";
import { chatRefusalShare, type AnswerOutcomeRow } from "@scholar/shared";
import { FLOOR_OUTCOMES, FOLLOW_UP_OUTCOMES, UNREAD_OUTCOMES } from "../outcomes";

/**
 * The line at the top of /admin ("the model wrote an answer that our own check then refused in X of Y questions"). The server books a message that came with the turns before it under the names of
 * FOLLOW_UP_OUTCOMES instead of "answered" and "not_grounded"; the share has to count those too, or it covers only the first message of every chat and refusals of follow-ups drop out of it.
 */
const chat = (outcome: string, n: number): AnswerOutcomeRow => ({ feature: "chat", outcome, n });

describe("chatRefusalShare", () => {
  it("counts the first messages as it always did", () => {
    expect(chatRefusalShare([chat("answered", 30), chat("not_grounded", 10), chat("not_answered", 5), chat("nothing_found", 9)])).toEqual({ attempted: 45, refused: 10, unsplit: 0 });
  });

  it("counts follow-ups too: 30 first messages with 10 refused and 70 follow-ups with 35 refused are 45 of 100, not 10 of 30", () => {
    const rows = [chat("answered", 20), chat("not_grounded", 10), chat(FOLLOW_UP_OUTCOMES.answered, 35), chat(FOLLOW_UP_OUTCOMES.notGrounded, 35)];
    expect(chatRefusalShare(rows)).toEqual({ attempted: 100, refused: 45, unsplit: 0 });
  });

  it("does not guess for the follow-ups that were booked without saying how they ended (a restatement not used, turns ignored): they are counted apart", () => {
    const rows = [chat("answered", 10), chat("not_grounded", 2), chat(FOLLOW_UP_OUTCOMES.rewriteFailed, 7), chat(FOLLOW_UP_OUTCOMES.contextIgnored, 4)];
    expect(chatRefusalShare(rows)).toEqual({ attempted: 12, refused: 2, unsplit: 11 });
  });

  it("reads only the prompt box", () => {
    expect(chatRefusalShare([{ feature: "oa_ask", outcome: "not_grounded", n: 50 }, chat("answered", 1)])).toEqual({ attempted: 1, refused: 0, unsplit: 0 });
  });

  it("is zero for no rows", () => expect(chatRefusalShare([])).toEqual({ attempted: 0, refused: 0, unsplit: 0 }));

  // R9: a list with no strong paper is not given to the writer, so no model was asked and nothing was refused: the reason is not_answered on the wire, but the count has a name of its own so that the headline
  // does not move for a reason that has nothing to do with the model (the plan, 4.9). The names of the failure policy (R5) are left out for the same reason.
  it("leaves the relevance floor's own ending out of all three numbers, as it leaves the failure policy's", () => {
    expect(FLOOR_OUTCOMES.skipped).toBe("floor_skipped");
    const base = [chat("answered", 30), chat("not_grounded", 10), chat("not_answered", 5), chat(FOLLOW_UP_OUTCOMES.rewriteFailed, 2)];
    const want = chatRefusalShare(base);
    expect(want).toEqual({ attempted: 45, refused: 10, unsplit: 2 });
    expect(chatRefusalShare([...base, chat(FLOOR_OUTCOMES.skipped, 40)])).toEqual(want);
    expect(chatRefusalShare([...base, chat(FLOOR_OUTCOMES.skipped, 40), chat(UNREAD_OUTCOMES.unread, 3), chat(UNREAD_OUTCOMES.shadow, 4)])).toEqual(want);
  });
});
