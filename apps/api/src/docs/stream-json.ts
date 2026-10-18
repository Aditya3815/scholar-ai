/**
 * The model writes {"found":…,"answer":"…","evidence":[…]} one token at a time. This pulls the text of the "answer" field out of
 * that growing JSON as it arrives, so the reader can watch the answer being written while the evidence part is still coming.
 * It understands JSON string escapes (\n, \", \uXXXX) even when a piece ends in the middle of one.
 */
export class AnswerFieldStreamer {
  private buf = "";
  private pos = 0; // how much of `buf` has been consumed
  private state: "seek" | "inside" | "done" = "seek";

  /** Feed the next piece of the JSON; returns the new characters of the answer text (possibly empty). */
  push(piece: string): string {
    if (this.state === "done") return "";
    this.buf += piece;
    let out = "";

    if (this.state === "seek") {
      const m = /"answer"\s*:\s*"/.exec(this.buf);
      if (!m) {
        // Keep only a tail that could still be the start of the key, so the buffer does not grow without bound.
        if (this.buf.length > 200) this.buf = this.buf.slice(-40);
        return "";
      }
      this.pos = m.index + m[0].length;
      this.state = "inside";
    }

    while (this.pos < this.buf.length) {
      const c = this.buf[this.pos]!;
      if (c === '"') {
        this.state = "done";
        this.buf = "";
        return out;
      }
      if (c !== "\\") {
        out += c;
        this.pos++;
        continue;
      }
      // an escape: wait until the whole sequence is here
      const next = this.buf[this.pos + 1];
      if (next === undefined) break;
      if (next === "u") {
        const hex = this.buf.slice(this.pos + 2, this.pos + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(parseInt(hex, 16) || 0xfffd);
        this.pos += 6;
        continue;
      }
      const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\", "/": "/" };
      out += map[next] ?? next;
      this.pos += 2;
    }
    // drop what is already consumed
    this.buf = this.buf.slice(this.pos);
    this.pos = 0;
    return out;
  }
}
