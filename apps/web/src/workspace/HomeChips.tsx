import { ArrowUpLeft } from "lucide-react";
import { useId, useState } from "react";
import { yearRangeWords } from "@scholar/shared";
import { chipCounts, rowFacts, rowWindows, type ShownChip, type TrendingRow } from "@scholar/shared/src/trending-row";

/**
 * The Try chips: example searches the owner chose (starters.ts). A click sends one. The same row is under the box on Home, under a reply to small talk and under a search that found no paper; `disabled`
 * while a reply is being written (a second message waits for the first, so a click would do nothing). Its label is its group's name, so a screen reader says "Try" before the chips.
 */
export function TryChips({ chips, onPick, disabled = false, label = "Try" }: { chips: readonly string[]; onPick: (text: string) => void; disabled?: boolean; label?: string }) {
  const id = useId();
  if (chips.length === 0) return null;
  return (
    <div className="hm-starters" role="group" aria-labelledby={`${id}-h`}>
      <span className="hm-try" id={`${id}-h`}>{label}</span>
      {chips.map((s) => (
        <button key={s} type="button" className="chip-btn" disabled={disabled} onClick={() => onPick(s)}>{s}</button>
      ))}
    </div>
  );
}

/**
 * The Trending row (docs/design/chatview-and-trending.md, T1, T7, T9): topics that have more journal papers than a year ago, taken from open data by a scheduled job, the same for everyone. A chip is a phrase
 * and nothing more: pressing it FILLS the box with those exact words (it sends nothing; the person changes them if they like and presses search). The small arrow on it says "goes into the box". Its
 * accessible name is its words (what is written on it), and what it is made of, the two counts, is its description. "Why these?" opens the definition: a button with `aria-expanded`, not a tooltip.
 */
export function TrendingChips({ row, onFill }: { row: TrendingRow; onFill: (chip: ShownChip, viaKeyboard: boolean) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const india = row.chips.some((c) => c.group === "in");
  const since = row.chips[0]!.sinceYear;
  const windows = rowWindows(row);
  return (
    <>
      <div className="hm-starters hm-trending" role="group" aria-labelledby={`${id}-h`}>
        <span className="hm-try" id={`${id}-h`}>Trending</span>
        {row.chips.map((c, i) => (
          <span key={c.text} className="hm-tchip">
            <button type="button" className="chip-btn chip-fill" aria-describedby={`${id}-f${i}`} onClick={(e) => onFill(c, e.detail === 0)}>
              {c.text}
              <ArrowUpLeft size={13} aria-hidden="true" />
            </button>
            <span className="sr-only" id={`${id}-f${i}`}>{rowFacts(row, c)}</span>
          </span>
        ))}
        <button type="button" className="link-btn hm-why-btn" aria-expanded={open} aria-controls={`${id}-why`} onClick={() => setOpen((o) => !o)} onKeyDown={(e) => { if (e.key === "Escape" && open) setOpen(false); }}>
          Why these?
        </button>
      </div>
      <div id={`${id}-why`} className="hm-why" hidden={!open}>
        {open && (
          <>
            <p>
              Topics with more journal papers than a year ago (and, for computing, mathematics and physics, more arXiv submissions in the last 30 days than in the same 30 days a year ago). Source: OpenAlex and arXiv,
              updated {row.updated}. The same file for everyone; with Indian sources on, topics from papers with an Indian author come first. We do not use what you searched. More papers is not better papers: nothing here
              is checked until you search.
            </p>
            <p>
              A chip puts its words in the box, with a “Papers from {yearRangeWords(since) ?? `${since} or later`}” filter beside it so that the search is of recent papers; you can take the filter off. Change the words if you like, then press search.
              {india && " The topics marked India in the list below come from papers with an author at an Indian institution."}
            </p>
            <p>
              The counts are of journal articles with an abstract and fewer than 60 authors, not retracted, in one subfield of OpenAlex’s own list of subjects (each line names its field){windows ? `, counted ${windows}` : ""}.
              Each line gives the count for the first dates and then the count for the same dates a year earlier. They are lower than all of OpenAlex holds for the same words.
              The topic words are OpenAlex’s own keywords, which its indexing assigns to papers, with an AI model that reads each paper’s title and abstract; we use no AI for this list and do not change a word of it.
            </p>
            <ul>
              {row.chips.map((c) => (
                <li key={c.text}>
                  <b>{c.text}</b>{c.group === "in" ? " (India)" : ""}: {chipCounts(c)}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
