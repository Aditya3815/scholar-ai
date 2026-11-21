import { firstPageJpeg, type PDFDocumentProxy } from "./pdf";

/**
 * The picture of the first page in a share invitation (docs/design/paper-share.md, S4): 300 px wide, shown at 128 px (sharp on a screen of twice the density), at most `maxBytes`. A text
 * page is about 25 to 40 KB at 0.8; a page with a photograph steps down the qualities until it fits.
 */
export type InvitePicture = { dataUrl: string; base64: string; width: number; height: number };
export async function renderInvitePicture(pdf: PDFDocumentProxy, width: number, maxBytes: number): Promise<InvitePicture | null> {
  const p = await firstPageJpeg(pdf, width, maxBytes, [0.8, 0.7, 0.6, 0.5, 0.4]);
  if (!p) return null;
  // as a data: address (the dialog's preview) and as base64 (the request)
  const dataUrl = await new Promise<string | null>((done) => {
    const r = new FileReader();
    r.onload = () => done(String(r.result));
    r.onerror = () => done(null);
    r.readAsDataURL(p.blob);
  });
  return dataUrl ? { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(",") + 1), width: p.width, height: p.height } : null;
}
