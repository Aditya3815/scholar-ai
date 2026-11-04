import { test } from "node:test";
import assert from "node:assert/strict";
import { BEGIN, END, HOLD, NEVER, classify, countBy, mergeRows, parseLive, readRows, renderRows, replaceBlock } from "./trending-subfields.mjs";

const sub = (id, name, field = "Computer Science", domain = "Physical Sciences", fieldId = 17, domainId = 3) => ({
  id: `https://openalex.org/subfields/${id}`,
  display_name: name,
  field: { id: `https://openalex.org/fields/${fieldId}`, display_name: field },
  domain: { id: `https://openalex.org/domains/${domainId}`, display_name: domain },
});
const LIVE = parseLive([
  { results: [sub(1702, "Artificial Intelligence"), sub(2746, "Surgery", "Medicine", "Health Sciences", 27, 4), sub(2808, "Neurology", "Neuroscience", "Life Sciences", 28, 1)] },
  { results: [sub(2200, "General Engineering", "Engineering", "Physical Sciences", 22, 3)] },
]);

test("parseLive reads pages of OpenAlex's answer into rows, sorted by domain, field and id", () => {
  assert.deepEqual(LIVE.map((r) => r.id), [2746, 2808, 1702, 2200]);
  assert.deepEqual(LIVE[2], { id: 1702, name: "Artificial Intelligence", fieldId: 17, field: "Computer Science", domainId: 3, domain: "Physical Sciences" });
});

test("parseLive refuses what is not a subfield, and a subfield twice", () => {
  assert.throws(() => parseLive([{ results: [{ id: "x" }] }]), /not a subfield/);
  assert.throws(() => parseLive([{ results: [sub(1702, "AI")] }, { results: [sub(1702, "AI")] }]), /twice/);
  assert.deepEqual(parseLive([{}]), []);
});

test("classify: the whole health domain is held, the named clinical and contested subfields are held, the catch-alls are never looked at, the rest is allowed", () => {
  assert.deepEqual(classify({ id: 9999, name: "Anything", domain: "Health Sciences" }), ["hold", "health domain"]);
  assert.deepEqual(classify({ id: 3600, name: "General Health Professions", domain: "Health Sciences" }), ["hold", "health domain"]);
  assert.deepEqual(classify({ id: 2808, name: "Neurology", domain: "Life Sciences" }), ["hold", "clinical"]);
  assert.deepEqual(classify({ id: 2200, name: "General Engineering", domain: "Physical Sciences" }), ["never", "catch-all"]);
  assert.deepEqual(classify({ id: 1702, name: "Artificial Intelligence", domain: "Physical Sciences" }), ["allow", ""]);
});

test("classify does not carry a decision to another subfield when OpenAlex reuses an id under another name", () => {
  const [policy, why] = classify({ id: 2808, name: "Something Else", domain: "Life Sciences" });
  assert.equal(policy, "hold");
  assert.match(why, /review: was Neurology/);
  assert.equal(classify({ id: 2200, name: "Other", domain: "Physical Sciences" })[0], "hold");
});

test("the rules name no id twice", () => {
  const ids = [...HOLD, ...NEVER].map(([id]) => id);
  assert.equal(new Set(ids).size, ids.length);
});

test("a first run uses the rules", () => {
  const { rows, added, removed } = mergeRows(LIVE, null);
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.id, r.policy])), { 2746: "hold", 2808: "hold", 2200: "never", 1702: "allow" });
  assert.deepEqual([added, removed], [[], []]);
});

test("a later run keeps every decision in the file, even one the owner changed against the rules", () => {
  const existing = new Map([
    [1702, { name: "Artificial Intelligence", policy: "hold", why: "owner: wait" }],
    [2746, { name: "Surgery", policy: "allow", why: "" }],
    [2808, { name: "Neurology", policy: "hold", why: "clinical" }],
    [2200, { name: "General Engineering", policy: "allow", why: "" }],
  ]);
  const { rows } = mergeRows(LIVE, existing);
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.id, r.policy])), { 2746: "allow", 2808: "hold", 2200: "allow", 1702: "hold" });
  assert.equal(rows.find((r) => r.id === 1702).why, "owner: wait");
});

test("a subfield that is new to the file is held, never allowed, even where the rules would allow it; health and catch-alls follow their rules", () => {
  const existing = new Map([[2808, { name: "Neurology", policy: "hold", why: "clinical" }]]);
  const { rows, added } = mergeRows(LIVE, existing);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by[1702].policy, "hold");
  assert.match(by[1702].why, /new in OpenAlex/);
  assert.equal(by[2746].policy, "hold");
  assert.equal(by[2200].policy, "never");
  assert.deepEqual(added.sort(), ["1702 Artificial Intelligence", "2200 General Engineering", "2746 Surgery"]);
});

test("a renamed subfield is held again with a note, and a subfield that left is reported", () => {
  const existing = new Map([
    [1702, { name: "AI (old name)", policy: "allow", why: "" }],
    [2746, { name: "Surgery", policy: "hold", why: "health domain" }],
    [2808, { name: "Neurology", policy: "hold", why: "clinical" }],
    [2200, { name: "General Engineering", policy: "never", why: "catch-all" }],
    [5555, { name: "Gone", policy: "allow", why: "" }],
  ]);
  const { rows, renamed, removed } = mergeRows(LIVE, existing);
  const ai = rows.find((r) => r.id === 1702);
  assert.equal(ai.policy, "hold");
  assert.match(ai.why, /review: was AI \(old name\)/);
  assert.deepEqual(renamed, ["1702: AI (old name) -> Artificial Intelligence"]);
  assert.deepEqual(removed, ["5555 Gone"]);
});

const TEMPLATE = `export type X = 1;\n${BEGIN}\nconst ROWS: readonly Row[] = [];\n${END}\nexport const Y = 2;\n`;

test("the rows written into a file are the rows read back, and the rest of the file is untouched", () => {
  const { rows } = mergeRows(LIVE, null);
  const text = replaceBlock(TEMPLATE, renderRows(rows));
  assert.ok(text.startsWith("export type X = 1;\n"));
  assert.ok(text.endsWith(`${END}\nexport const Y = 2;\n`));
  const back = readRows(text);
  assert.equal(back.size, 4);
  assert.deepEqual(back.get(1702), { name: "Artificial Intelligence", fieldId: 17, field: "Computer Science", domainId: 3, domain: "Physical Sciences", policy: "allow", why: "" });
  assert.equal(back.get(2746).policy, "hold");
  // writing again, from what was read, changes nothing
  assert.equal(replaceBlock(text, renderRows(mergeRows(LIVE, back).rows)), text);
});

test("replaceBlock keeps the file's CRLF line endings, and readRows reads them", () => {
  const crlf = TEMPLATE.replace(/\n/g, "\r\n");
  const out = replaceBlock(crlf, renderRows(mergeRows(LIVE, null).rows));
  assert.ok(!/[^\r]\n/.test(out), "a lone LF in a CRLF file");
  assert.equal(readRows(out).size, 4);
});

test("readRows and replaceBlock refuse a file without the markers, and a row that is not a row", () => {
  assert.throws(() => readRows("nothing here"), /markers/);
  assert.throws(() => replaceBlock("nothing here", ""), /markers/);
  assert.throws(() => readRows(`${BEGIN}\n  [1, "x"],\n${END}`), /not a row/);
});

test("names with quotes and commas survive the round trip", () => {
  const odd = parseLive([{ results: [sub(1, 'Health, Toxicology and "Mutagenesis"')] }]);
  const text = replaceBlock(TEMPLATE, renderRows(mergeRows(odd, null).rows));
  assert.equal(readRows(text).get(1).name, 'Health, Toxicology and "Mutagenesis"');
});

test("countBy", () => {
  assert.deepEqual(countBy([{ p: "a" }, { p: "b" }, { p: "a" }], "p"), { a: 2, b: 1 });
});
