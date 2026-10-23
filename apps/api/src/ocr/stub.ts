import type { PageReader, PageRead } from "./read";

/**
 * Offline stand-in for the two models, used ONLY by tests and the local end-to-end run (QA_STUB=1 together with ENABLE_DEV_ROUTES=1, neither of
 * which is ever set in production). It does not look at the picture. What a page "says" is decided by the page number, or, for finer control in
 * API tests, by a JSON comment inside the JPEG: {"first": "...", "second": "...", "cutOff": true, "fail": "first" | "second" | "both"}.
 *
 *   page 3, 10, ...  the models differ by about 4% and on one number         -> read with doubt ("warn")
 *   page 4, 11, ...  the models read different things                        -> not read reliably
 *   page 5, 12, ...  no text on the page                                     -> empty
 *   page 6, 13, ...  the first model repeats one sentence                    -> not read reliably (repeating)
 *   any other page   the models agree                                        -> read
 */
export const stubPageText = (page: number) =>
  `Page ${page} of the scanned report describes soil moisture in region R${page}. The mean value rose to 4.2 percent in 2019 across 38 sites, and the authors checked each reading against the field notes. ` +
  `Further sampling at station S${page} confirmed the trend, and the discussion on this page relates it to earlier surveys of the same districts.`;

type Override = { first?: string; second?: string; cutOff?: boolean; fail?: string };
function parseOverride(comment: string | null): Override | null {
  if (!comment) return null;
  try {
    const v = JSON.parse(comment) as unknown;
    return v && typeof v === "object" ? (v as Override) : null;
  } catch {
    return null;
  }
}

/** The same page with a few letters wrong in a dozen words and one number: about 3% of its characters differ. */
const misread = (t: string) =>
  t
    .replace("2019", "2018")
    .replace(/soil/g, "sail")
    .replace("mean", "mea")
    .replace("field", "feld")
    .replace("authors", "authers")
    .replace("sampling", "sampeling")
    .replace("confirmed", "confirmd")
    .replace("discussion", "discusion")
    .replace("earlier", "earlir")
    .replace("surveys", "survays")
    .replace("districts", "distrcts")
    .replace("checked", "chekced")
    .replace("station", "statoin");
/** A page about something else, of about the same length, for the case where the two models cannot both be right. */
const otherPage =
  "Quarterly figures for the harbour authority show berth occupancy and vessel arrivals for the preceding five years, split by terminal and by month, with the busiest weeks shaded in the chart. " +
  "Freight handled at the container terminal grew faster than bulk cargo, while the ferry service lost two routes and gained one, as the authority explains in its annual statement.";

export const stubReader: PageReader = async (_image, { page, comment }) => {
  const override = parseOverride(comment);
  const base = stubPageText(page);
  const rule = page % 7;
  let first = override?.first ?? base;
  let second = override?.second ?? base;
  if (!override) {
    if (rule === 3) second = misread(base);
    if (rule === 4) second = otherPage;
    if (rule === 5) first = second = "";
    if (rule === 6) first = "The sample was dried. ".repeat(40);
  }
  const fail = override?.fail;
  const read: PageRead = {
    first: fail === "first" || fail === "both" ? null : { text: first, cutOff: override?.cutOff === true },
    second: fail === "second" || fail === "both" ? null : { text: second, cutOff: false },
    neurons: 150,
    errors: [fail === "first" || fail === "both" ? "first:stub" : "", fail === "second" || fail === "both" ? "second:stub" : ""].filter(Boolean),
  };
  return read;
};
