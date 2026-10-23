import { AlertTriangle, Loader2, Pause, Play, ScanLine } from "lucide-react";
import { OCR_ACCEPT_BELOW, OCR_WARN_BELOW, type DocumentInfo, type OcrWhy, type ScanInfo, type ScanPage } from "@scholar/shared";

const WHY: Record<OcrWhy, string> = {
  models_disagree: "the two readings did not agree",
  lengths_differ: "the two readings were of very different length",
  repeating: "a model got stuck repeating itself",
  cut_off: "a reading ran out of room",
  second_reading_failed: "a reading could not be completed",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const percent = (d: number | null) => (d === null ? "" : `${Math.max(0.1, d * 100).toFixed(d < 0.1 ? 1 : 0)}%`);

function PageChips({ pages, onGo, tone }: { pages: ScanPage[]; onGo: (page: number) => void; tone: "warn" | "bad" }) {
  return (
    <span className="scan-chips">
      {pages.slice(0, 40).map((p) => (
        <button key={p.page} type="button" className="scan-chip" data-tone={tone} onClick={() => onGo(p.page)} aria-label={`Page ${p.page}${p.why ? `: ${WHY[p.why]}` : p.disagreement !== null ? `: the two readings differ on ${percent(p.disagreement)}` : ""}. Open it`} title={p.why ? WHY[p.why] : p.disagreement !== null ? `The two readings differ on ${percent(p.disagreement)} of the characters` : undefined}>
          p.{p.page}
        </button>
      ))}
      {pages.length > 40 && <span className="scan-more">and {pages.length - 40} more</span>}
    </span>
  );
}

/**
 * Says what the paper is (a scan), how well it was read, and what is left to do. A scan is read by models, so every number and name in it comes with the
 * reminder to check it on the page; pages that could not be read reliably are named, not hidden.
 */
export function ScanBanner({ doc, scan, running, onContinue, onPause, onGo }: { doc: DocumentInfo; scan: ScanInfo; running: boolean; onContinue: () => void; onPause: () => void; onGo: (page: number) => void }) {
  const used = scan.read + scan.warned;
  const warned = scan.items.filter((p) => p.status === "warn");
  const bad = scan.items.filter((p) => p.status === "unreliable");
  const numbers = warned.concat(scan.items.filter((p) => p.status === "ok")).filter((p) => p.disputed.length > 0);
  const left = scan.pending.length;
  const limit = scan.usedToday >= scan.perDay;
  const tone = left > 0 ? "busy" : bad.length > 0 || doc.status === "failed" ? "warn" : "ok";

  return (
    <section className="scan" data-tone={tone} aria-label="About this scanned paper">
      <div className="scan-head">
        <span className="scan-ico" aria-hidden="true">
          {running ? <Loader2 className="spin" size={18} /> : <ScanLine size={18} />}
        </span>
        <div className="scan-title">
          <p className="scan-line">
            <strong>Read from a scan.</strong> Words and numbers were read from page pictures by two AI models that check each other. Check numbers against the page.
          </p>
          <p className="scan-sub" role="status" aria-live="polite">
            {running
              ? `Reading… ${plural(used + bad.length + scan.empty, "page")} of ${scan.pages} done${left > 0 ? `, ${left} to go` : ""}.`
              : left > 0
                ? `${plural(left, "page")} still to be read.`
                : `${plural(used, "page")} of ${scan.pages} could be used${scan.empty > 0 ? `, ${plural(scan.empty, "page")} had nothing on ${scan.empty === 1 ? "it" : "them"}` : ""}.`}
            {" "}
            {scan.usedToday > 0 || left > 0 ? `${scan.usedToday} of ${scan.perDay} pages used today.` : ""}
          </p>
        </div>
        {left > 0 &&
          (running ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onPause}>
              <Pause size={14} aria-hidden="true" />
              <span>Pause</span>
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={onContinue} disabled={limit} title={limit ? "Today's limit is used. You can continue tomorrow." : undefined}>
              <Play size={14} aria-hidden="true" />
              <span>{limit ? "Continue tomorrow" : "Continue reading"}</span>
            </button>
          ))}
      </div>

      {warned.length > 0 && (
        <p className="scan-note" data-tone="warn">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>
            Read with doubt ({Math.round(OCR_ACCEPT_BELOW * 100)}% to {Math.round(OCR_WARN_BELOW * 100)}% of the characters differ between the two readings): <PageChips pages={warned} onGo={onGo} tone="warn" />
          </span>
        </p>
      )}
      {bad.length > 0 && (
        <p className="scan-note" data-tone="bad">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>
            Not read reliably, so left out of answers and the reference check: <PageChips pages={bad} onGo={onGo} tone="bad" />. A sharper scan (150 dpi or better, straight, no shadow) usually helps.
          </span>
        </p>
      )}
      {numbers.length > 0 && (
        <p className="scan-note" data-tone="warn">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>
            The two readings gave different numbers on {numbers.slice(0, 12).map((p, i) => <span key={p.page}>{i > 0 ? "; " : ""}<button type="button" className="link-btn" onClick={() => onGo(p.page)}>page {p.page}</button> ({p.disputed.slice(0, 4).join(" or ")})</span>)}. Check these on the page.
          </span>
        </p>
      )}
      {doc.status === "failed" && doc.error && (
        <p className="scan-note" data-tone="bad" role="alert">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>{doc.error}</span>
        </p>
      )}
      <p className="scan-fine">Highlighting and notes need selectable text, which a scan does not have. Questions are answered from the text that was read.</p>
    </section>
  );
}
