// The JSONC reader of the integration runner (scripts/lib/jsonc.mjs) against wrangler.jsonc and the cases the old whole-line filter could not read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseJsonc, stripJsonc } from "./jsonc.mjs";

test("wrangler.jsonc reads as the whole-line filter read it", () => {
  const text = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
  const old = JSON.parse(text.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n"));
  assert.deepEqual(parseJsonc(text), old);
});

test("comments at the end of a line, block comments and trailing commas", () => {
  assert.deepEqual(parseJsonc('{\n  "a": 1, // one\n  /* two */ "b": [1, 2,],\n}\n'), { a: 1, b: [1, 2] });
  assert.deepEqual(parseJsonc('{ "a": 1 /* a\nlong\ncomment */ }'), { a: 1 });
});

test("strings are left alone: // and /* inside one, an escaped quote, a comma before a brace", () => {
  assert.deepEqual(parseJsonc('{ "url": "https://x.example/a", "glob": "/*", "q": "say \\"hi\\" // not a comment", "t": ",}" }'), { url: "https://x.example/a", glob: "/*", q: 'say "hi" // not a comment', t: ",}" });
});

test("line numbers stay where they were", () => {
  const text = '{\n /* a\n b */\n "x": 1 // c\n}';
  assert.equal(stripJsonc(text).split("\n").length, text.split("\n").length);
});

test("an unclosed string or comment is an error, not a silent cut", () => {
  assert.throws(() => stripJsonc('{ "a": "b }'), SyntaxError);
  assert.throws(() => stripJsonc("{ /* a }"), SyntaxError);
});
