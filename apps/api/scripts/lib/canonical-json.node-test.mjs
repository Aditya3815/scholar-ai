import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalFromText, canonicalJson } from "./canonical-json.mjs";

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const BACKSLASH = String.fromCharCode(92);
const BOM = String.fromCharCode(0xfeff);

test("key order does not matter, at any depth", () => {
  const a = { b: 1, a: { y: [1, 2, { d: 4, c: 3 }], x: "s" } };
  const b = { a: { x: "s", y: [1, 2, { c: 3, d: 4 }] }, b: 1 };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(canonicalJson(a), canonicalJson(JSON.parse(canonicalJson(a))));
});

test("array order does matter", () => {
  assert.notEqual(canonicalJson({ a: [1, 2] }), canonicalJson({ a: [2, 1] }));
});

test("the output is one fixed shape: sorted keys, two-space indent, one final LF and nothing after it", () => {
  const out = canonicalJson({ b: [1], a: null });
  assert.equal(out, ["{", '  "a": null,', '  "b": [', "    1", "  ]", "}"].join(LF) + LF);
  assert.ok(!out.includes(CR));
});

test("a CRLF file and an LF file of the same JSON canonicalise to the same text", () => {
  const lf = ["{", '  "b": 1,', '  "a": "x",', '  "list": [1, 2]', "}", ""].join(LF);
  const crlf = lf.split(LF).join(CR + LF);
  assert.notEqual(lf, crlf);
  assert.equal(canonicalFromText(crlf), canonicalFromText(lf));
  assert.equal(canonicalFromText(lf + LF + LF), canonicalFromText(lf)); // trailing blank lines too
  assert.equal(canonicalFromText(lf.split(LF).join(CR)), canonicalFromText(lf)); // an old-Mac lone CR between tokens
});

test("a byte order mark at the start of the file is not part of the JSON", () => {
  const text = '{"a": 1}' + LF;
  assert.equal(canonicalFromText(BOM + text), canonicalFromText(text));
});

test("the indentation and spacing of the file do not matter", () => {
  assert.equal(canonicalFromText('{"a":1,"b":[1,2]}'), canonicalFromText('{ "a" : 1 ,' + LF + '   "b" : [ 1 , 2 ] }'));
});

test("a line break inside a string is the same in the file whatever the checkout", () => {
  // JSON cannot hold a raw line break inside a string: it is written as backslash-n, which is the same bytes under CRLF and LF
  const text = '{"note": "a' + BACKSLASH + "n" + 'b"}';
  const value = JSON.parse(text);
  assert.equal(value.note, "a" + LF + "b");
  assert.equal(canonicalFromText(text.replace(": ", ":" + CR + LF + "  ")), canonicalFromText(text));
});

test("numbers are written the way JSON.stringify writes them, so 0.90 and 0.9, 1.0 and 1, 1e2 and 100 are one gate", () => {
  assert.equal(canonicalFromText('{"t": 0.90}'), canonicalFromText('{"t": 0.9}'));
  assert.equal(canonicalFromText('{"t": 1.0}'), canonicalFromText('{"t": 1}'));
  assert.equal(canonicalFromText('{"t": 1e2}'), canonicalFromText('{"t": 100}'));
  assert.notEqual(canonicalFromText('{"t": 0.9}'), canonicalFromText('{"t": 0.91}'));
  assert.ok(canonicalJson({ t: -0 }).includes('"t": 0'));
});

test("unicode: keys sort by UTF-16 code unit, text is kept as it is, astral characters are not escaped", () => {
  const e = String.fromCharCode(0xe9); // e with acute, one code point
  const grin = String.fromCodePoint(0x1f600);
  const out = canonicalJson({ [e]: 1, z: 2, a: grin });
  assert.ok(out.indexOf('"a"') < out.indexOf('"z"'));
  assert.ok(out.indexOf('"z"') < out.indexOf('"' + e + '"')); // U+00E9 sorts after ASCII
  assert.ok(out.includes(grin));
  assert.ok(!out.includes(BACKSLASH + "u"));
});

test("unicode: two strings that look the same but are not the same code points stay two hashes (no normalisation)", () => {
  const nfc = String.fromCharCode(0xe9);
  const nfd = "e" + String.fromCharCode(0x301);
  assert.notEqual(canonicalJson({ a: nfc }), canonicalJson({ a: nfd }));
});

test("a lone surrogate is written as ASCII, so two different ones never collapse to the same UTF-8 bytes", () => {
  const hi = String.fromCharCode(0xd83d);
  const lo = String.fromCharCode(0xde00);
  const a = canonicalJson({ s: hi });
  const b = canonicalJson({ s: lo });
  assert.notEqual(a, b);
  assert.notEqual(Buffer.from(a, "utf8").toString("hex"), Buffer.from(b, "utf8").toString("hex"));
  for (const ch of a + b) assert.ok(ch.codePointAt(0) < 0x80);
});

test("the quote, the backslash and control characters round-trip", () => {
  const nasty = 'q"' + BACKSLASH + "tab" + String.fromCharCode(9) + "bell" + String.fromCharCode(7) + "end";
  const out = canonicalJson({ s: nasty });
  assert.equal(JSON.parse(out).s, nasty);
});

test("what is not JSON is refused instead of being dropped", () => {
  assert.throws(() => canonicalJson({ a: undefined }), TypeError);
  assert.throws(() => canonicalJson({ a: Number.NaN }), TypeError);
  assert.throws(() => canonicalJson({ a: Infinity }), TypeError);
  assert.throws(() => canonicalJson({ a: () => 1 }), TypeError);
  assert.throws(() => canonicalJson({ a: new Map() }), TypeError);
  assert.throws(() => canonicalJson({ a: 10n }), TypeError);
  assert.throws(() => canonicalJson(undefined), TypeError);
});

test("text that is not JSON says so", () => {
  assert.throws(() => canonicalFromText("{not json"), SyntaxError);
  assert.throws(() => canonicalFromText(""), SyntaxError);
});

test("a top-level array, string, number and null work too", () => {
  assert.equal(canonicalJson([2, 1]), ["[", "  2,", "  1", "]"].join(LF) + LF);
  assert.equal(canonicalJson("x"), '"x"' + LF);
  assert.equal(canonicalJson(null), "null" + LF);
  assert.equal(canonicalJson(5), "5" + LF);
});
