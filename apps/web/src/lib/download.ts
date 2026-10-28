/** Hands a file to the browser to save. Nothing is sent anywhere. One place for every download of the app (it was written three times). */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(filename: string, text: string, type = "text/plain;charset=utf-8"): void {
  downloadBlob(filename, new Blob([text], { type }));
}
