import { DOCX_MIME, buildDocx, buildReviewDocx, type LitscanLanguage, type Report } from "@scholar/shared";

/**
 * The review as a Word file, made in the browser (docs/design/docx-export.md): the parts come from the shared writer, and fflate (already in the app, loaded only here) zips them.
 * Nothing is sent to a server. The zip's own dates are the review's date, so the same review gives the same file.
 */
export async function reviewDocxBlob(args: { appName: string; generatedAt: string; topic: string; language: LitscanLanguage; report: Report; indian?: boolean }): Promise<Blob> {
  const { zipSync, strToU8 } = await import("fflate");
  const parts = buildDocx(buildReviewDocx(args));
  const mtime = new Date(args.generatedAt);
  const files = Object.fromEntries(Object.entries(parts).map(([path, xml]) => [path, [strToU8(xml), { level: 6 as const, mtime: Number.isNaN(mtime.getTime()) ? new Date(0) : mtime }] as [Uint8Array, { level: 6; mtime: Date }]]));
  return new Blob([zipSync(files) as BlobPart], { type: DOCX_MIME });
}
