// The canonical form of a JSON document, for hashing the intent gates (docs/eval/intent-gates.json, scripts/intent-gates-hash.mjs).
// The hash must be the same on Windows and on Linux and for a CRLF or an LF checkout, so it is taken from the parsed value, never from the file's bytes:
// keys in code-unit order, two-space indent, one final line feed, numbers as JSON.stringify writes them (so 0.90 and 0.9 are one number).
// Not normalised on purpose: two strings that differ in code points (an e with an accent, one code point or two) are two different gates and two hashes.

const BOM = 0xfeff;
const isPlainObject = (v) => {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

function write(value, pad, path) {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return String(value);
    case "string":
      return JSON.stringify(value); // well-formed: a lone surrogate comes out as ASCII, so two different ones never share UTF-8 bytes
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("not a JSON value (a number that is not finite) at " + path);
      return JSON.stringify(value);
    case "object": {
      const inner = pad + "  ";
      if (Array.isArray(value)) {
        if (value.length === 0) return "[]";
        return "[\n" + value.map((v, i) => inner + write(v, inner, path + "[" + i + "]")).join(",\n") + "\n" + pad + "]";
      }
      if (!isPlainObject(value)) throw new TypeError("not a JSON value (an object that is not plain) at " + path);
      const keys = Object.keys(value).sort();
      if (keys.length === 0) return "{}";
      return "{\n" + keys.map((k) => inner + JSON.stringify(k) + ": " + write(value[k], inner, path + "." + k)).join(",\n") + "\n" + pad + "}";
    }
    default:
      throw new TypeError("not a JSON value (" + typeof value + ") at " + path);
  }
}

/** The canonical text of a value parsed from JSON. Throws TypeError for anything JSON cannot hold, instead of dropping it. */
export function canonicalJson(value) {
  return write(value, "", "$") + "\n";
}

/** JSON.parse that ignores a byte order mark (an editor on Windows may add one). */
export function parseJsonText(text) {
  return JSON.parse(text.charCodeAt(0) === BOM ? text.slice(1) : text);
}

/** The canonical text of a JSON file's content, whatever its line endings, indentation or key order. */
export function canonicalFromText(text) {
  return canonicalJson(parseJsonText(text));
}
