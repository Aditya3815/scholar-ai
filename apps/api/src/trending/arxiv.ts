import { phraseKey, type SecondSource } from "@scholar/shared/src/trending";
import { withGate } from "../gate";
import { SourceError, getText, type CallBudget, type Http } from "./sources";

/**
 * The arXiv half of the Trending job's fetch layer (docs/design/chatview-and-trending.md, T3 and T5): how many submissions have a phrase in them in the last 30 days, in the 30 days before,
 * and in the same 30 days a year earlier (364 days, so the same weekdays). A count is `opensearch:totalResults` of a query for one paper.
 *
 * arXiv's rules (https://info.arxiv.org/help/api/tou.html): one request every three seconds, one after the other (the `pace` function waits), a descriptive User-Agent with a contact address.
 * The rule is arXiv's, not the job's: the open-access ingest asks export.arxiv.org too (src/oa/sources.ts, through the shared lane `arxiv` of src/gate: one start every 3.2 s, one at a time, for every
 * isolate), so every request here is made inside that lane as well, and arXiv never sees two of our callers closer than the lane allows. The job's own pause stays: it keeps the job's three requests of a
 * phrase and the next phrase's apart without leaning on the lane. A request is acquired, made and released one at a time, so a lease (40 s) always covers the request's own 30 s.
 * A bad query or an overloaded server is answered with an Atom feed whose only entry is titled "Error", sometimes with HTTP 200: that is an error here, never "1 result".
 * Everything is plain text patterns: the feed is a fixed, simple format, and nothing in it is shown to anyone (only its number is read).
 */
const API = "https://export.arxiv.org/api/query";
/** The longest the job waits for the shared lane before it counts the request as failed (the request's own limit of 30 s starts at the call, and the lane's queue is a visitor or two at most). */
const LANE_WAIT_MS = 10_000;
const DAY_MS = 864e5;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export type ArxivDeps = {
  http: Http;
  mailto: string;
  budget: CallBudget;
  /** Resolves when a request may start (`makePacer(3100, ...)`: one in three seconds). Called before every request, retries included. */
  pace: () => Promise<void>;
  /** Whether a request takes its turn in the shared lane `arxiv` (default yes). Off only for the local run on stand-ins, where nothing real is asked and a lane's real seconds would only slow it. */
  lane?: boolean;
};
export type ArxivWindow = { from: string; to: string };
export type ArxivCounts = SecondSource & { previous: number };

const stamp = (t: number, hhmm: string): string => `${new Date(t).toISOString().slice(0, 10).replace(/-/g, "")}${hhmm}`;

/** The three windows for a day "YYYY-MM-DD", in arXiv's YYYYMMDDHHMM (GMT): 30 whole days ending yesterday, the 30 before, and the first one 364 days earlier. */
export function arxivWindows(asOf: string): { recent: ArxivWindow; previous: ArxivWindow; yearAgo: ArxivWindow } {
  const m = DAY.exec(asOf);
  const day = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== asOf) throw new RangeError(`not a day: ${String(asOf)}`);
  const span = (lastDay: number): ArxivWindow => ({ from: stamp(lastDay - 29 * DAY_MS, "0000"), to: stamp(lastDay, "2359") });
  const yesterday = day - DAY_MS;
  return { recent: span(yesterday), previous: span(yesterday - 30 * DAY_MS), yearAgo: span(yesterday - 364 * DAY_MS) };
}

/** The number of submissions that match, from an answer. Throws `SourceError` for an Error entry (whatever the HTTP status was) and for a feed with no readable total. */
export function parseArxivCount(xml: string): number {
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entry = m[1]!;
    const id = /<id>\s*([^<]*?)\s*<\/id>/.exec(entry)?.[1] ?? "";
    const title = /<title>\s*([^<]*?)\s*<\/title>/.exec(entry)?.[1] ?? "";
    if (id.includes("/api/errors") || (title === "Error" && !id.includes("/abs/"))) throw new SourceError("arxiv", "error_entry");
  }
  const total = /<opensearch:totalResults[^>]*>\s*(\d+)\s*<\/opensearch:totalResults>/.exec(xml)?.[1];
  if (total === undefined) throw new SourceError("arxiv", "shape", undefined, "no total");
  return Number(total);
}

/** One query: the phrase as plain words in quotes (nothing of the phrase's own can be an operator), submitted in the window. */
function searchQuery(phrase: string, w: ArxivWindow): string {
  const words = phraseKey(phrase).slice(0, 200);
  if (!/\p{L}/u.test(words)) throw new RangeError("no words in the phrase");
  return `all:"${words}" AND submittedDate:[${w.from} TO ${w.to}]`;
}

async function count(d: ArxivDeps, phrase: string, w: ArxivWindow): Promise<number> {
  const params = new URLSearchParams({ search_query: searchQuery(phrase, w), start: "0", max_results: "1" });
  // one request at a time, three seconds apart: the pause comes before each try, so a retry waits too
  const http: Http = { ...d.http, fetch: (async (url: RequestInfo | URL, init?: RequestInit) => (await d.pace(), d.lane === false ? d.http.fetch(url, init) : withGate("arxiv", LANE_WAIT_MS, () => d.http.fetch(url, init)))) as typeof fetch };
  const xml = await getText(http, "arxiv", `${API}?${params}`, { headers: { "User-Agent": `Sodhsetu/1.0 (+https://sodhsetu.in; mailto:${d.mailto})`, Accept: "application/atom+xml" } }, d.budget);
  return parseArxivCount(xml);
}

/** Submissions with the phrase: the last 30 days, the 30 before, and a year ago (three requests, in that order). */
export async function arxivCounts(d: ArxivDeps, phrase: string, asOf: string): Promise<ArxivCounts> {
  const w = arxivWindows(asOf);
  const recent = await count(d, phrase, w.recent);
  const previous = await count(d, phrase, w.previous);
  const yearAgo = await count(d, phrase, w.yearAgo);
  return { recent, previous, yearAgo };
}
