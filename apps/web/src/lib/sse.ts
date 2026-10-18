/**
 * Reads a server-sent-events response body and hands each event's JSON to `onEvent`. (EventSource cannot be used: it only does GET,
 * and the question is a POST.) Resolves when the stream ends; rejects if the connection breaks or `signal` aborts.
 */
export async function readSse<T>(res: Response, onEvent: (e: T) => void, signal?: AbortSignal): Promise<void> {
  if (!res.body) throw new TypeError("no response body");
  const reader = res.body.getReader();
  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });
  const decoder = new TextDecoder();
  let buf = "";
  const flush = (block: string) => {
    const data = block.split("\n").find((l) => l.startsWith("data:"));
    if (!data) return;
    try {
      onEvent(JSON.parse(data.slice(5)) as T);
    } catch {
      /* a malformed event is skipped; the stream carries on */
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        flush(buf.slice(0, i));
        buf = buf.slice(i + 2);
      }
    }
    if (buf.trim()) flush(buf);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
}
