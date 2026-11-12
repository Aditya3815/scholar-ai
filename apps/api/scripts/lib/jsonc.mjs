// Reads JSON with comments, as wrangler.jsonc is written: `//` and `/* */` comments anywhere outside a string (a whole line or the end of one), and a comma before a closing bracket.
// The integration runner reads wrangler.jsonc with it (scripts/lib/test-worker.mjs), so a comment at the end of a line no longer stops every local run (docs/design/untangle.md, F24, [ti] H11).

/** The text with its comments blanked out (a newline is kept, so line numbers stay) and trailing commas dropped; strings are left exactly as they are. */
export function stripJsonc(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      // a string, to its closing quote (a backslash escapes the next character)
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      if (j >= n) throw new SyntaxError(`an unclosed string starts at offset ${i}`);
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) throw new SyntaxError(`an unclosed comment starts at offset ${i}`);
      out += text.slice(i, end + 2).replace(/[^\n]/g, " ");
      i = end + 2;
    } else {
      out += c;
      i++;
    }
  }
  // a comma followed only by white space before } or ] (comments are already blank here, strings cannot hold a bare `,}` that this would touch: it only removes a comma outside them)
  return removeTrailingCommas(out);
}

function removeTrailingCommas(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === ",") {
      let j = i + 1;
      while (j < n && /\s/.test(text[j])) j++;
      if (text[j] === "}" || text[j] === "]") out += " ";
      else out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** JSON.parse after stripJsonc. */
export const parseJsonc = (text) => JSON.parse(stripJsonc(text));
