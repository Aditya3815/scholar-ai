import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FOLLOW_UP_TOKENS_ESTIMATE, MAX_CHAT_BODY_BYTES, PRIVACY_VERSION, TRENDING_MAX_CHIPS, TRENDING_POOL_MAX_DAYS, YEAR_FILTER_SEARCH_LIMIT } from "@scholar/shared";
import { QUERYABLE_SUBFIELDS, SUBFIELDS } from "@scholar/shared/src/subfield-policy";
import { TREND, VERIFY } from "@scholar/shared/src/trending";
import { JOB_SPECS } from "./jobs";
import { FOLLOW_UP_OUTCOMES } from "./outcomes";
import { TRENDING_LIMITS } from "./trending/job";
import { TRENDING_KEYS } from "./trending/store";

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
const RETIRED_VERSIONS = ["2026-10-draft-13", "2026-11-draft-14"];

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

  it("lists what the browser keeps now (edited versions and the account note) in the retention table, and no longer the words or the copies of the removed earlier-chats feature", () => {
    expect(PAGE).toMatch(/the version it replaced and the messages that followed it/);
    expect(PAGE).toContain("A note of which account the chat belongs to, kept with each chat.");
    expect(PAGE).toContain("A private chat is not kept at all");
    expect(PAGE).toContain("So you can come back to them and go back to a version you edited");
    // gone with the feature (6 Nov 2026, design PDF M1): chat-memory.ts parseIndex drops `kw` and `nomem`, chat-state.ts trimForStorage drops a reply's `earlier`, lib/chat.ts removes `scholar.earlier`
    expect(PAGE).not.toMatch(/A few words taken from your questions/);
    expect(PAGE).not.toMatch(/A reply that used questions from an earlier chat/);
    expect(PAGE).not.toContain("your choice about using earlier chats");
    expect(PAGE).toContain("Your reading preferences (theme, text size) stay in your browser.");
  });

  it("says that nothing of another chat is sent, and no longer describes the removed earlier-chats feature (routes.ts ignores `earlier`; lib/chat.ts sends only `history`)", () => {
    expect(PAGE).toContain("Nothing from another chat is ever sent with a message: each chat leans only on its own earlier messages.");
    expect(PAGE).not.toMatch(/Use my earlier chats in Settings \(it is off unless you turn it on\)/);
    expect(PAGE).not.toMatch(/If you continue from a chat, its last three questions go to our server/);
    expect(PAGE).not.toMatch(/Earlier chats\. Only if you choose/);
    expect(PAGE).not.toMatch(/does not use other chats and is not used by them/);
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
    expect(PAGE).toContain("Latest change (6 November 2026): the prompt box on Home no longer uses your earlier chats.");
    expect(PAGE).toContain("a message carries only earlier messages of its own conversation, and the few words that were kept with each chat so that your device could find it are removed from your browser");
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

  it("says that nothing of one chat goes with a message in another, and has no switch for earlier chats any more (removed 6 Nov 2026)", () => {
    expect(SETTINGS).toContain("Nothing of one chat is sent with a message in another.");
    expect(SETTINGS).not.toContain("Use my earlier chats");
    expect(SETTINGS).not.toContain("useEarlierChats");
  });
});

/**
 * The runbook's section on the context switch is read by whoever has to switch it off on a bad day: its numbers and names must be the code's (docs/design/chat-actions-context.md, "As built"). The code's
 * own constants are imported, so a change of a limit that leaves the runbook behind fails here.
 */
const RUNBOOK = read("../../../docs/runbook.md");
// each section ends where the next begins, so that a sentence in one cannot stand in for a missing one in the other
const CONTEXT_SECTION = RUNBOOK.slice(RUNBOOK.indexOf("## Context between messages, and Copy and Edit"), RUNBOOK.indexOf("## The Trending list"));
const TRENDING_SECTION = RUNBOOK.slice(RUNBOOK.indexOf("## The Trending list"), RUNBOOK.indexOf("## Staging"));
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

  it("says what the switch does and does not do (history is neither read nor refused; the browser still sends it), and that `earlier` is ignored for good", () => {
    expect(CONTEXT_SECTION).toMatch(/With it set, `history` is neither read nor refused/);
    expect(CONTEXT_SECTION).toMatch(/The browser does not know about the switch/);
    expect(CONTEXT_SECTION).toMatch(/the server ignores it unread when an old open tab still does/);
  });

  it("says that a variable set by hand is replaced by the next deploy, and that staging needs its own entry, for both switches", () => {
    for (const section of [CONTEXT_SECTION, JUDGE_SECTION]) {
      expect(section).toMatch(/replaced at the next deploy|replaces what was set by hand/);
      expect(section).toContain("env.staging.vars");
    }
  });
});

/**
 * The runbook's section on the Trending list is read on the day a wrong phrase is on the Home page, or the job has failed: the names, the limits and the counts in it must be the code's. The numbers the
 * code keeps as constants are imported (`TRENDING_LIMITS`, `TREND`, `VERIFY`, the policy table); the two that it keeps private (`KV_OPS`, `PER_DOMAIN`) are read from its source.
 */
const JOB_SOURCE = read("./trending/job.ts");
const privateNumber = (name: string): number => Number(new RegExp(`const ${name} = (\\d+);`).exec(JOB_SOURCE)?.[1]);
const KV_OPS = privateNumber("KV_OPS");
const PER_DOMAIN = privateNumber("PER_DOMAIN");
const n = (x: number) => x.toLocaleString("en-US");

describe("the runbook's section on the Trending list, after the code", () => {
  it("has a section of its own, which the section before it does not borrow from", () => {
    expect(TRENDING_SECTION.length).toBeGreaterThan(5000);
    expect(RUNBOOK.indexOf("## The Trending list")).toBeGreaterThan(RUNBOOK.indexOf("## Context between messages, and Copy and Edit"));
    expect(CONTEXT_SECTION).not.toContain("trending:v1");
    expect(Number.isInteger(KV_OPS) && Number.isInteger(PER_DOMAIN)).toBe(true);
  });

  it("names the route, the keys, the variable, the job and its heartbeat as the code has them, and says what the page does with the list today", () => {
    expect(TRENDING_SECTION).toContain("`GET /api/v1/home/trending`");
    expect(TRENDING_SECTION).toContain("`Cache-Control: public, max-age=300`");
    for (const key of [TRENDING_KEYS.file, TRENDING_KEYS.off, TRENDING_KEYS.pool, TRENDING_KEYS.scan, TRENDING_KEYS.deny]) expect(TRENDING_SECTION).toContain(`\`${key}\``);
    expect(TRENDING_KEYS.batch("<day>", "<n>" as never)).toBe("trending:v1:scan:<day>:<n>");
    expect(TRENDING_SECTION).toContain("`trending:v1:scan:<day>:<n>`");
    expect(TRENDING_SECTION).toContain("`TRENDING`");
    expect(TRENDING_SECTION).toContain("`--var TRENDING:off`");
    expect(Object.keys(JOB_SPECS)).toContain("trending");
    expect(read("./index.ts")).toMatch(/cron\("trending", \(\) => runTrendingFromEnv\(env, controller\.scheduledTime\)\)/);
    expect(read("../migrations/0025_trending_job.sql")).toContain("INSERT INTO job_runs (name, last_ok_at) VALUES ('trending', datetime('now'))");
    expect(TRENDING_SECTION).toContain("`0025_trending_job.sql`");
  });

  it("says the Home page reads the list, because it does: the page's client is the one place under apps/web/src that names the route, the Home page uses it, and the section says what keeps the first deploy dark", () => {
    const webSrc = fileURLToPath(new URL("../../web/src/", import.meta.url));
    // (the unit tests' type set has only readdirSync and readFileSync of node:fs: a path that cannot be listed is a file)
    const walk = (path: string): string[] => {
      let names: string[];
      try {
        names = readdirSync(path);
      } catch {
        return /\.(ts|tsx)$/.test(path) ? [path] : [];
      }
      return names.flatMap((name) => walk(join(path, name)));
    };
    const slash = (p: string) => p.split(String.fromCharCode(92)).join("/");
    const naming = walk(webSrc).filter((f) => readFileSync(f, "utf8").includes("home/trending"));
    expect(naming.map((f) => slash(f).slice(slash(webSrc).length))).toEqual(["lib/trending.ts"]);
    expect(read("../../web/src/workspace/HomePage.tsx")).toMatch(/from "\.\.\/lib\/trending"/);
    expect(read("../../web/src/workspace/HomePage.tsx")).toMatch(/askForTrending\(\)/);
    // the runbook must not tell whoever reads it on a bad day that no visitor can see a list
    expect(TRENDING_SECTION).not.toContain("does not read this list yet");
    expect(TRENDING_SECTION).not.toContain("no visitor can see a list today");
    expect(TRENDING_SECTION).not.toContain("protects nothing visible");
    expect(TRENDING_SECTION).not.toContain("Today nothing shows it");
    expect(TRENDING_SECTION).toContain("The Home page reads this list");
    // ... and says how the launch is kept hidden: the variable the committed configuration sets, with the value it really has (read from the file, not typed here)
    const committed = JSON.parse(
      read("../wrangler.jsonc")
        .split("\n")
        .filter((l) => !/^\s*\/\//.test(l))
        .join("\n"),
    ) as { vars?: { TRENDING?: string } };
    expect(["dark", "off"], "the committed TRENDING value").toContain(committed.vars?.TRENDING);
    expect(TRENDING_SECTION).toContain(`\`"TRENDING": "${committed.vars?.TRENDING}"\``);
    expect(TRENDING_SECTION).toContain("LAUNCH DARK");
  });

  it("states the limits of the run, the scan and the pool as the code has them", () => {
    expect(TRENDING_SECTION).toContain(`${n(TRENDING_LIMITS.runCalls)} calls a run`);
    expect(TRENDING_SECTION).toContain(`${n(TRENDING_LIMITS.scanCalls)} for one scan`);
    expect(TRENDING_SECTION).toContain(`${KV_OPS} KV operations`);
    expect(TRENDING_SECTION).toContain(`${TRENDING_LIMITS.wallMs / 60_000} minutes before no new work starts and ${TRENDING_LIMITS.hardStopMs / 60_000} before the searches stop`);
    expect(TRENDING_SECTION).toContain(`a search counts as ${TRENDING_LIMITS.searchCost}`);
    expect(TRENDING_SECTION).toContain(`one request every ${TRENDING_LIMITS.arxivGapMs / 1000} seconds`);
    expect(TRENDING_SECTION).toContain(`${TRENDING_LIMITS.concurrency} at a time`);
    expect(TRENDING_SECTION).toContain(`${TRENDING_LIMITS.batchSubfields} subfields`);
    expect(TRENDING_SECTION).toContain(`${TRENDING_LIMITS.poolGlobal} phrases (${TRENDING_LIMITS.poolIndia} for India)`);
    expect(TRENDING_SECTION).toContain(`under ${TRENDING_LIMITS.poolMin} phrases is refused`);
    expect(TRENDING_SECTION).toContain(`${TRENDING_LIMITS.scanMaxAgeDays} days`);
    expect(TRENDING_SECTION).toContain(`${TRENDING_LIMITS.poolEveryDays} days old`);
  });

  it("states the thresholds of the list as the code has them (windows, arXiv, hysteresis, caps, the file's life, the verifier)", () => {
    expect(TRENDING_SECTION).toContain(`${TREND.windowDays} days that end ${TREND.endsDaysAgo} days before the day`);
    expect(TRENDING_SECTION).toContain(`at least ${TREND.confirm.minGrowth} times and at least ${TREND.confirm.minRecent}`);
    expect(TRENDING_SECTION).toContain(`${TREND.hysteresis.factor} times higher`);
    expect(TRENDING_SECTION).toContain(`at most ${TRENDING_MAX_CHIPS}, one a field, four a domain`);
    expect(PER_DOMAIN).toBe(4);
    expect(TRENDING_SECTION).toContain(`only if ${TREND.minPublish} phrases are left`);
    expect(TRENDING_SECTION).toContain(`generated plus ${TREND.validHours} hours`);
    expect(TRENDING_SECTION).toContain(`${TRENDING_POOL_MAX_DAYS} days`);
    expect(TRENDING_SECTION).toContain(`at least ${VERIFY.minResults} results, ${VERIFY.minAbstracts} with abstracts`);
    expect(TRENDING_SECTION).toContain(`${YEAR_FILTER_SEARCH_LIMIT} results`);
  });

  it("states the policy table's counts and the scan's calls as the table has them", () => {
    const allowed = SUBFIELDS.filter((s) => s.policy === "allow").length;
    const calls = (QUERYABLE_SUBFIELDS.length + allowed) * 2;
    expect(TRENDING_SECTION).toContain(`${QUERYABLE_SUBFIELDS.length} subfields that are not \`never\``);
    expect(TRENDING_SECTION).toContain(`${allowed} allowed subfields`);
    expect(TRENDING_SECTION).toContain(`: **${calls}**`);
    expect(TRENDING_SECTION).toContain(`${Math.ceil(QUERYABLE_SUBFIELDS.length / TRENDING_LIMITS.batchSubfields)} batches`);
  });

  it("does not say the job asks a source it does not (Shodhganga is read through OpenAlex), and says what OpenAlex's key budget means for it", () => {
    expect(TRENDING_SECTION).not.toContain("OpenAlex India, DOAJ and Shodhganga");
    expect(TRENDING_SECTION).toContain("Shodhganga is read through OpenAlex");
    expect(TRENDING_SECTION).toContain("shares the key's day");
  });
});
