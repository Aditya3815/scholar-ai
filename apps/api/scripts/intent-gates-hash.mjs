// The SHA-256 of the intent gates file (docs/eval/intent-gates.json) in its canonical form (scripts/lib/canonical-json.mjs): the same on Windows and Linux, CRLF or LF.
// The release commit that freezes the gates carries this hash in its message (plan 8.5, gate freeze), written as the CANONICAL SHA-256: the hash of the canonical form, not of the file's bytes, so
// `sha256sum docs/eval/intent-gates.json` gives another value. It changes when "frozen" is set to true: freeze first, then compute the hash.
//   node scripts/intent-gates-hash.mjs                 prints the hash and nothing else
//   node scripts/intent-gates-hash.mjs --verbose       also prints the file, its sizes, the number of gates and whether it is frozen
//   node scripts/intent-gates-hash.mjs path/to.json    hashes another file (a test does)
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonicalJson, parseJsonText } from "./lib/canonical-json.mjs";

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const file = args.find((a) => !a.startsWith("--")) ?? fileURLToPath(new URL("../../../docs/eval/intent-gates.json", import.meta.url));

try {
  const text = readFileSync(file, "utf8");
  const doc = parseJsonText(text);
  const canonical = canonicalJson(doc);
  console.log(createHash("sha256").update(canonical, "utf8").digest("hex"));
  if (verbose) {
    console.log("the hash above is the canonical SHA-256: of the canonical form (keys sorted, 2-space indent, LF), not of the file's bytes, so sha256sum of the file gives another value");
    console.log("file: " + file);
    console.log("bytes: " + Buffer.byteLength(text, "utf8") + ", canonical bytes: " + Buffer.byteLength(canonical, "utf8"));
    console.log("version: " + doc.version);
    console.log("frozen: " + doc.frozen);
    console.log("gates: " + (Array.isArray(doc.gates) ? doc.gates.length : "none"));
  }
} catch (e) {
  console.error("intent-gates-hash: " + (e instanceof Error ? e.message : String(e)));
  process.exitCode = 1;
}
