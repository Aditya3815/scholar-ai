import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FOLLOW_UP_TOKENS_ESTIMATE, MAX_CHAT_BODY_BYTES, PRIVACY_VERSION } from "@scholar/shared";
import { FOLLOW_UP_OUTCOMES } from "./outcomes";

/**
 * Pins the privacy text of 2 Nov 2026 (docs/design/chat-actions-context.md, section 7): the prompt box began to send earlier messages to the AI service, so what the page says is
 * sent had to change, and the version with it (how-we-work.md: a change in what the text promises bumps `PRIVACY_VERSION`). These are source reads, like the migration check in
 * `library/retraction.test.ts`: the page is a React file in the web workspace, which this workspace does not render, so the test reads it the way a person would, without the tags.
 * A sentence worded differently later will fail here on purpose: the promise has to be re-read, not only the words.
 */

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const plain = (jsx: string) =>
  jsx
    .replace(/<[^>]*>/g, "")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const LEGAL_TS = read("../../../packages/shared/src/legal.ts");
const PAGE = plain(read("../../web/src/components/legal/LegalPages.tsx"));

/** Every version this text has replaced: when it changes in a way that matters again, add the version it replaces here, so a forgotten bump fails. */
const RETIRED_VERSIONS = ["2026-10-draft-13"];

describe("PRIVACY_VERSION", () => {
  it("keeps the exact line that the staging script reads", () => {
    expect(LEGAL_TS).toMatch(/^export const PRIVACY_VERSION = "[^"]+";$/m);
    // the script's own pattern, taken from the script, so a change on either side is noticed
    const script = read("../scripts/staging-session.mjs");
    expect(script).toContain('/PRIVACY_VERSION = "([^"]+)"/');
    expect(/PRIVACY_VERSION = "([^"]+)"/.exec(LEGAL_TS)?.[1]).toBe(PRIVACY_VERSION);
  });

  it("is not a version the text has already left behind (it is bumped in the same release as the text)", () => {
    expect(RETIRED_VERSIONS).not.toContain(PRIVACY_VERSION);
  });
});

describe("the privacy page after earlier messages are sent to the AI service", () => {
  it("no longer says that the background call gets the question alone, or that Auto reads only to choose a tool", () => {
    expect(PAGE).not.toContain("your question alone is also sent to the same AI service for a short background");
    expect(PAGE).not.toContain("only to decide which tool it belongs to and, when it is not written in English, to put the topic");
    // and what replaced them
    expect(PAGE).toContain("only to decide which tool it belongs to, to read what a follow-up refers to");
    expect(PAGE).toContain("when it is not written in English or leans on an earlier message, to put the topic into English search words");
    expect(PAGE).toContain("your question alone (for a follow-up, as it was rewritten to stand on its own, with no earlier message) is also sent to the same AI service for a short background");
  });

  it("says that the search words of a follow-up can carry words of earlier messages, and where the person sees them", () => {
    expect(PAGE).toMatch(/search words can carry topic words from your earlier messages/);
    expect(PAGE).toContain("shown on the answer as “I searched for”");
  });

  it("says what goes with a follow-up in the same conversation, how many, who reads which part, and who does not get it", () => {
    // what the browser sends to our server (apps/web/src/lib/chat.ts run, contextBefore in packages/shared/src/chat-state.ts), only for a signed-in person, in Auto
    expect(PAGE).toMatch(/When you are signed in and write in Auto, your browser sends the last earlier questions of that conversation \(up to three\)/);
    expect(PAGE).toMatch(/the years it was limited to and the titles and years of the papers its answer cited/);
    expect(PAGE).toMatch(/up to the first 500 characters of the latest answer \(without its source numbers, links and DOIs\), to our server with every new message after the first/);
    // what the AI service reads of it (apps/api/src/chat/router.ts routerContextPrompt: no answer text; routes.ts: the answer start goes to the writer only for same_papers)
    expect(PAGE).toMatch(/The AI service reads the questions, search words and titles only when the new message cannot stand alone/);
    expect(PAGE).toMatch(/it is never given an earlier answer for that/);
    expect(PAGE).toMatch(/When the message asks about the answer itself .{0,80}the start of the latest answer is also given to the AI that writes the new answer/);
    expect(PAGE).toMatch(/never as evidence/);
    // the writer and the background are asked the standalone question, which can carry words of the earlier messages (routes.ts: askedOf)
    expect(PAGE).toMatch(/are asked the question as it was rewritten to stand on its own \(or, for a message left as it was, together with the English search words made for it\), and either can carry words from the earlier messages/);
    expect(PAGE).toMatch(/The check that reads each claim against its sentence, and Check strictly, are not given your earlier messages/);
    expect(PAGE).toMatch(/We do not keep them/);
    // the old, wider sentences are gone
    expect(PAGE).not.toContain("are sent with the new one to the same AI service, each with");
    expect(PAGE).not.toContain("Check strictly and the background answer are not given your earlier messages");
  });

  it("says that a visitor who is not signed in sends no earlier message (lib/chat.ts run: history and earlier only when the page knows who is here)", () => {
    expect(PAGE).toContain("If you are not signed in, nothing is sent to an AI service and your browser sends no earlier message");
  });

  it("says that a search you start from a follow-up's exact words, or by removing a year filter, is a search you chose, with no earlier message", () => {
    expect(PAGE).toMatch(/If you press “Use these exact words” under a follow-up, or remove a year filter, the words shown are searched as they are shown, as a search you chose yourself: no earlier message goes with it/);
  });

  it("says that the AI log holds counts and the kind of call, tied to the account (llm_usage keeps subject, task, model, tokens, label, time, ok)", () => {
    expect(PAGE).not.toContain("the AI log holds only a count of tokens");
    expect(PAGE).toContain("the AI log holds only counts and the kind of call (tokens, the model, the name of the call, how long it took, whether it worked), tied to your account, never a word of what you wrote");
    expect(PAGE).toContain("the AI log holds only counts and the kind of call, never a word of what you wrote");
  });

  it("lists the search services as the code has them (five in the regular search: OpenAlex, Semantic Scholar, Crossref, PubMed, DOAJ)", () => {
    expect(PAGE).not.toContain("Four services are searched at once");
    expect(PAGE).toContain("Five services are searched at once and duplicates are merged by DOI");
  });

  it("says what the export holds and what it does not (account/routes.ts: no usage rows, and the chats are in the browser)", () => {
    expect(PAGE).not.toContain("You get everything about your account as one file");
    expect(PAGE).toMatch(/You get your account details, library, uploaded papers with your questions, notes and drawings, reports, literature scans and retraction notices as one file\. The counts of your AI use \(tokens, never your text\) and the chats in your browser are not in it/);
  });

  it("says what is never carried: an Idea Check, a long message, and any earlier message under a tool chosen by hand", () => {
    expect(PAGE).toMatch(/Nothing from an Idea Check, and no message longer than 300 characters/);
    expect(PAGE).toContain("Nothing about the idea is stored by us, and it is not sent again with a later question");
    expect(PAGE).toContain("When you choose Search papers yourself, no earlier message is sent");
    expect(PAGE).toContain("When you choose a tool yourself, Auto does not read what you write, and no earlier message is sent");
  });

  it("says that Copy sends nothing and that an edited message's earlier version stays in the browser and is never sent", () => {
    expect(PAGE).toMatch(/Copying a message or an answer happens in your browser and sends nothing/);
    expect(PAGE).toMatch(/stay in your browser \(up to five versions of a message are kept\) until you delete the chat, and are never sent anywhere/);
  });

  it("says that earlier chats are used only on a choice, that the switch is off unless turned on, and what they never include", () => {
    expect(PAGE).toMatch(/Only if you choose to continue from an earlier chat, or turn on Use my earlier chats in Settings \(it is off unless you turn it on\)/);
    expect(PAGE).toMatch(/up to three of your earlier questions, each with the English words it was searched with, go with a new question in Auto when you are signed in/);
    expect(PAGE).toMatch(/chosen on your device/);
    expect(PAGE).toMatch(/never an earlier answer, an Idea Check or a pasted list/);
    expect(PAGE).toMatch(/shown on the answer, and you can remove them and ask again without them/);
    expect(PAGE).toMatch(/nothing from another chat is sent/);
  });

  it("says which chats and which messages: the chip sends its chat's last three questions with every message, the switch picks from the six latest and only for a message that cannot stand alone (chat-memory.ts earlierFor, candidates)", () => {
    expect(PAGE).toMatch(/If you continue from a chat, its last three questions go to our server with every message of the new chat/);
    expect(PAGE).toMatch(/With the switch, they are chosen on your device from your six latest chats \(not one you left out, not a private chat, and not one kept before this feature that you have not opened since\), and only for a message that cannot stand alone/);
    expect(PAGE).toMatch(/The AI service reads them only to work out what the new message refers to, and only when the message cannot stand alone/);
    // the plain truth about the line that shows them (ChatView.tsx shows it on a search; a message sent to another tool was read the same way and shows nothing)
    expect(PAGE).toMatch(/When they were read for a search, they are shown on the answer/);
    expect(PAGE).toMatch(/when the message turned out to be for another tool they were read in the same way and nothing is shown/);
    expect(PAGE).toMatch(/A private chat is not kept, does not use other chats and is not used by them/);
    expect(PAGE).not.toContain("from the chats kept in this browser are sent");
  });

  it("lists what the browser keeps now (edited versions, the words and the account note that find earlier chats, the copy in a reply) in the retention table", () => {
    expect(PAGE).toMatch(/the version it replaced and the messages that followed it/);
    expect(PAGE).toMatch(/A few words taken from your questions and from the English words they were searched with, and a note of which account the chat belongs to, kept with each chat so that your device can find earlier chats/);
    // deleting the earlier chat does not take its questions out of the reply that used them (chat.ts deleteChat; chat-state.ts trimForStorage keeps `earlier`)
    expect(PAGE).toMatch(/A reply that used questions from an earlier chat keeps those questions \(up to three\), with the English words they were searched with, so that it can show what it used, until its own chat is deleted, even if the earlier chat is deleted first/);
    expect(PAGE).toContain("A private chat is not kept at all");
    expect(PAGE).toContain("your choice about using earlier chats (kept with your account number, so that another person who signs in on this browser starts with it off) stay in your browser");
  });

  it("says when the chats are removed and what a sign-in that only runs out does (chat.ts setChatOwner: held, not deleted; another person's sign-in and sign-out remove)", () => {
    expect(PAGE).toContain("Removed when you sign out, when a different person signs in on this browser, from Settings, when you delete the chat, or when you clear the browser's data");
    expect(PAGE).toContain("If your sign-in only runs out, the chats stay in this browser, out of sight, until you sign in again");
    expect(PAGE).toContain("The thirty latest are kept (chats that are out of sight are the first to go when there is no room)");
    expect(PAGE).toContain("a follow-up carries a few earlier questions, and the start of the latest answer, through our servers without keeping them");
  });

  it("says in 'Changes' that the chat does not ask first, and what changed", () => {
    expect(PAGE).toMatch(/before you upload a paper, check an idea or run a literature scan, and we will say here what changed/);
    expect(PAGE).toMatch(/The prompt box on Home does not ask first/);
    expect(PAGE).toContain("Latest change (2 November 2026)");
  });

  it("keeps the promises that are still true (nothing is weakened to fit)", () => {
    expect(PAGE).toContain("What you ask and the answers are kept only in your browser.");
    expect(PAGE).toContain("Kept only in your browser, never on our servers");
    expect(PAGE).toContain("The thirty latest are kept");
    expect(PAGE).toContain("Your papers, questions and ideas are never sent to any other AI service");
    expect(PAGE).toContain("Not stored. The text is read, a search is planned, and nothing is kept");
    expect(PAGE).toContain("a count of tokens, the model, the kind of request, how long it took, whether it worked), tied to your account but never the text");
  });
});

/**
 * The Settings page says the same things in fewer words (apps/web/src/components/SettingsDialog.tsx): what a person reads there must be as true as the page. Read like the page, without the tags.
 */
const SETTINGS = plain(read("../../web/src/components/SettingsDialog.tsx"));

describe("the Settings help text for chats", () => {
  it("says what a follow-up carries, to whom, and when it is read", () => {
    expect(SETTINGS).toContain(
      "A follow-up carries your last few earlier questions of the same chat, the words they were searched with and, when you ask about the answer itself, the start of the last answer, to our server; the private AI service, which does not keep them, reads them only when the new message needs them",
    );
    expect(SETTINGS).not.toContain("A follow-up carries your last few earlier questions of the same chat to the private AI service");
  });

  it("says when the chats are removed, and that a sign-in that only runs out keeps them out of sight", () => {
    expect(SETTINGS).toContain("They are removed when you sign out, when a different person signs in on this browser, or with the button below");
    expect(SETTINGS).toContain("If your sign-in only runs out, they stay here, out of sight, until you sign in again");
    expect(SETTINGS).toContain("They are not part of the copy of your data you can download, because we do not have them");
  });

  it("says which chats the switch uses, for which messages, what is shown, and where the choice lives (memory.ts: the account id is stored)", () => {
    expect(SETTINGS).toContain("Off unless you turn it on");
    expect(SETTINGS).toContain("a new question in Auto that cannot stand alone can be sent with up to three of your earlier questions");
    expect(SETTINGS).toContain("picked on this device from the chats listed under Recent (the latest six; a chat kept before this switch existed is used only after you open it)");
    expect(SETTINGS).toContain("Never their answers, ideas or lists");
    expect(SETTINGS).toContain("When a search used them, the answer shows them, and you can remove them");
    expect(SETTINGS).toContain("A private chat does not use other chats and is not used");
    expect(SETTINGS).toContain("This choice is kept on this device, with your account number, so another person who signs in here starts with it off");
  });
});

/**
 * The runbook's section on the context switch is read by whoever has to switch it off on a bad day: its numbers and names must be the code's (docs/design/chat-actions-context.md, "As built"). The code's
 * own constants are imported, so a change of a limit that leaves the runbook behind fails here.
 */
const RUNBOOK = read("../../../docs/runbook.md");
const CONTEXT_SECTION = RUNBOOK.slice(RUNBOOK.indexOf("## Context between messages, and Copy and Edit"), RUNBOOK.indexOf("## Staging"));
const JUDGE_SECTION = RUNBOOK.slice(RUNBOOK.indexOf("## The support judge"), RUNBOOK.indexOf("## The own domain"));

describe("the runbook after the code", () => {
  it("has a section for the context switch, bounded by the headings this test reads", () => {
    expect(CONTEXT_SECTION.length).toBeGreaterThan(1000);
    expect(JUDGE_SECTION.length).toBeGreaterThan(1000);
  });

  it("names the body limit, the pre-flight bar and the outcome and label names that the code has", () => {
    expect(CONTEXT_SECTION).toContain(`${MAX_CHAT_BODY_BYTES / 1024} KB`);
    expect(CONTEXT_SECTION).not.toContain("64 KB");
    expect(CONTEXT_SECTION).toContain(FOLLOW_UP_TOKENS_ESTIMATE.toLocaleString("en-US"));
    for (const name of Object.values(FOLLOW_UP_OUTCOMES)) expect(CONTEXT_SECTION).toContain(name);
    expect(CONTEXT_SECTION).toContain("chat_route_ctx");
  });

  it("says what the switch does and does not do (neither field is read or refused; the browser still sends; the chip and the Settings switch still look active)", () => {
    expect(CONTEXT_SECTION).toMatch(/history` and `earlier` are neither read nor refused/);
    expect(CONTEXT_SECTION).toMatch(/The browser does not know about the switch/);
    expect(CONTEXT_SECTION).toMatch(/the Settings switch "Use my earlier chats" still look active/);
  });

  it("says that a variable set by hand is replaced by the next deploy, and that staging needs its own entry, for both switches", () => {
    for (const section of [CONTEXT_SECTION, JUDGE_SECTION]) {
      expect(section).toMatch(/replaced at the next deploy|replaces what was set by hand/);
      expect(section).toContain("env.staging.vars");
    }
  });
});
