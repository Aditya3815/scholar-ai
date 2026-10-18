import type { VerifyItem } from "./verify";
import { STATUS, bucketOf, statusOf } from "./refStatus";

/** A spreadsheet treats a cell starting with = + - @ as a formula; prefix those so a pasted reference cannot run anything. */
const cell = (v: string | number | null | undefined) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export function reportCsv(items: VerifyItem[]): string {
  const head = ["#", "Status", "Retracted", "Reference", "Explanation", "Matched title", "Matched authors", "Matched year", "Matched DOI"];
  const rows = items.map((it, i) => {
    const m = it.verdict?.match;
    return [
      i + 1,
      statusOf(it).label,
      it.verdict?.retracted ? "yes" : "",
      it.input,
      it.verdict?.reason ?? it.error ?? "",
      m?.title,
      m?.authors.join("; "),
      m?.year,
      m?.doi ? `https://doi.org/${m.doi}` : "",
    ].map(cell).join(",");
  });
  // BOM so Excel opens non-ASCII author names correctly.
  return "﻿" + [head.map(cell).join(","), ...rows].join("\r\n") + "\r\n";
}

/** Plain-text list of what needs a second look, ready to paste into a message to a supervisor or co-author. */
export function attentionText(items: VerifyItem[]): string {
  const flagged = items.map((it, i) => ({ it, n: i + 1 })).filter(({ it }) => bucketOf(it) === "attention" || it.verdict?.retracted);
  if (flagged.length === 0) return "";
  return flagged
    .map(({ it, n }) => `${n}. ${it.input}\n   ${it.verdict?.retracted ? "RETRACTED. " : ""}${STATUS[it.verdict?.status ?? "unverifiable"].label}: ${it.verdict?.reason ?? ""}`)
    .join("\n\n");
}

export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
