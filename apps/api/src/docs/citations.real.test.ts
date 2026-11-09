/**
 * How well in-text citations are found and linked on REAL papers (docs/design/reader-citations.md). Not part of the normal run: it needs a folder of PDFs.
 *   CITE_PDFS=<folder of .pdf> [CITE_OUT=<report.json>] npx vitest run src/docs/citations.real.test.ts      (in apps/api)
 * Reads each PDF with pdf.js as the browser does (the same shared code: analyzePaper for the stored list, labelledReferenceList for the labels, joinPieces and
 * findInTextCitations for each page), and reports per paper: the references, whether their labels could be used, the citations found and how many were linked,
 * and a sample of linked ones to read by eye (precision is judged by reading, not by this script).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  alignLabels,
  analyzePaper,
  buildCiteIndex,
  findInTextCitations,
  groupLines,
  isListMarker,
  joinPieces,
  labelledReferenceList,
  labelsUsable,
  linkCitation,
  rawItems,
  type Line,
  type TextPiece,
} from "@scholar/shared";

const DIR = process.env.CITE_PDFS;

describe.skipIf(!DIR)("in-text citations on real PDFs", () => {
  it("reports detection and linking", { timeout: 600_000 }, async () => {
    // pdf.js's own types disagree with the Workers types this package compiles with: it is used here through a narrow shape
    type PdfDoc = { numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }>; cleanup: () => void }>; loadingTask?: { destroy?: () => Promise<void> } };
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as { getDocument: (o: object) => { promise: Promise<PdfDoc> } };
    const report: unknown[] = [];
    for (const f of readdirSync(DIR!).filter((x) => x.toLowerCase().endsWith(".pdf")).sort()) {
      // (this package's typings know readFileSync only with an encoding; with none it gives the bytes)
      const buf = (readFileSync as unknown as (p: string) => Uint8Array)(join(DIR!, f));
      const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise;
      const lines: Line[] = [];
      const pages: TextPiece[][] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        lines.push(...groupLines(rawItems(content.items as never), n));
        pages.push(
          (content.items as { str?: string; transform?: number[]; width?: number; height?: number; hasEOL?: boolean }[])
            .filter((it) => typeof it.str === "string" && it.str !== "" && it.transform)
            .map((it) => ({ str: it.str!, x: it.transform![4]!, y: it.transform![5]!, w: it.width ?? 0, h: Math.abs(it.height ?? it.transform![3] ?? 10) || 10, eol: it.hasEOL })),
        );
        page.cleanup();
      }
      const info = analyzePaper({ lines, pages: doc.numPages });
      const read = labelledReferenceList(lines, doc.numPages);
      const a = alignLabels(info.references, read);
      const usable = labelsUsable(info.references, a);
      const idx = buildCiteIndex(info.references, usable ? a.labels : null);
      const firstRefPage = a.pages.find((p) => p !== null) ?? doc.numPages + 1;
      const kinds = { num: { found: 0, linked: 0 }, key: { found: 0, linked: 0 }, ay: { found: 0, linked: 0 } };
      const linkedSample: string[] = [];
      const unlinkedSample: string[] = [];
      const cited = new Set<number>();
      let markers = 0;
      // a loose count to judge what is MISSED (recall): "et al." with a year close after it, and number brackets, in the pages before the list; each counted once
      // when a linked citation covers it
      const loose = { etAl: 0, etAlLinked: 0, brackets: 0, bracketsLinked: 0 };
      const missed: string[] = [];
      pages.forEach((pieces, i) => {
        const { text } = joinPieces(pieces);
        const cites = findInTextCitations(text, idx.style);
        const covered = (at: number) => cites.some((c) => c.start <= at && at < c.end + 2 && linkCitation(c, idx));
        if (i + 1 < firstRefPage) {
          for (const m of text.matchAll(/et\.?\s?al\.?,?\s*[([]?\s*(?:19|20)\d\d/g)) {
            loose.etAl++;
            if (covered(m.index!)) loose.etAlLinked++;
            else if (missed.length < 40) missed.push(`p${i + 1} ${text.slice(Math.max(0, m.index! - 50), m.index! + 25).replace(/\s+/g, " ")}`);
          }
          for (const m of text.matchAll(/(?<![\p{L}\p{N}=∈])\[\s*\d{1,3}(?:\s*[,–-]\s*\d{1,3})*\s*\]/gu)) {
            loose.brackets++;
            if (covered(m.index! + 1)) loose.bracketsLinked++;
          }
        }
        for (const c of cites) {
          const kind = c.targets[0]!.kind;
          const linked = linkCitation(c, idx);
          if (linked && linked.length === 1 && i + 1 >= firstRefPage && isListMarker(text, c, info.references[linked[0]!]!)) {
            markers++;
            continue;
          }
          kinds[kind].found++;
          if (linked) {
            kinds[kind].linked++;
            linked.forEach((x) => cited.add(x));
            if (linkedSample.length < 400) linkedSample.push(`p${i + 1} ${c.text}  ->  ${linked.map((x) => `#${x + 1} ${info.references[x]!.slice(0, 70)}`).join(" || ")}`);
          } else if (unlinkedSample.length < 400) unlinkedSample.push(`p${i + 1} ${c.text}  ::  ${text.slice(Math.max(0, c.start - 40), c.end + 20).replace(/\s+/g, " ")}`);
        }
      });
      report.push({
        file: f,
        pages: doc.numPages,
        references: info.references.length,
        labelled: a.labels.filter(Boolean).length,
        aligned: a.aligned,
        usable,
        style: idx.style,
        markersSkipped: markers,
        kinds,
        loose,
        missed,
        entriesCited: cited.size,
        linkedSample,
        unlinkedSample,
        ...(process.env.CITE_DEBUG ? { list: info.references.map((t, k) => `${a.labels[k] ?? "-"} p${a.pages[k] ?? "?"} ${t.slice(0, 100)}`) } : {}),
      });
      await doc.loadingTask?.destroy?.();
    }
    if (process.env.CITE_OUT) writeFileSync(process.env.CITE_OUT, JSON.stringify(report, null, 2));
    for (const r of report as { file: string; references: number; usable: boolean; kinds: Record<string, { found: number; linked: number }>; entriesCited: number }[]) {
      console.log(`${r.file.padEnd(24)} refs ${String(r.references).padStart(3)} labels ${r.usable ? "yes" : "no "}  num ${r.kinds.num!.linked}/${r.kinds.num!.found}  key ${r.kinds.key!.linked}/${r.kinds.key!.found}  ay ${r.kinds.ay!.linked}/${r.kinds.ay!.found}  entries cited ${r.entriesCited}/${r.references}`);
    }
    expect(report.length).toBeGreaterThan(0);
  });
});
