import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { createDecipheriv, randomBytes } from "node:crypto";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_SEALED_PATH, HoldoutError, KEY_ENV, MAGIC, REPO_ROOT, REVEAL_ENV, VERSION,
  aggregate, assertOutsideRepo, casesFromCsv, describe, findCase, generateKey, loadKey, open, opaqueId, parseKey, revealRefusal, schemaProblems, seal, sha256Hex, summarize, validateCases, withOpaqueIds,
} from "./intent-holdout.mjs";

// Every case here is made up for the test (an invented planet, invented drugs). Nothing in this file is, or looks like, a real hold-out case.
const MARK = "QQ-SYNTHETIC-TEXT";
const CASES = [
  { id: "dummy-en-01", set: "holdout", author: "person", language: "en", class: "dummy", text: `${MARK} how do glaciers on an invented planet melt`, gold: { lane: "none" } },
  { id: "dummy-en-02", set: "holdout", author: "person", language: "en", class: "dummy", text: `${MARK} effect of the made-up drug zorbitol on mice`, gold: { lane: "none" } },
  { id: "dummy-hg-01", set: "holdout", author: "person", language: "hinglish", class: "dummy", text: `${MARK} nakli planet ke glacier kaise pighalte hain`, gold: { lane: "none" } },
  { id: "dummy-hg-02", set: "holdout", author: "person", language: "hinglish", class: "dummy", text: `${MARK} zorbitol dawa ka asar`, gold: { lane: "none" } },
  { id: "dummy-hi-01", set: "holdout", author: "person", language: "hi", class: "dummy", text: `${MARK} काल्पनिक ग्रह के हिमनद कैसे पिघलते हैं`, gold: { lane: "none" } },
  { id: "dummy-sf-01", set: "safety_dev", author: "person", language: "en", class: "dummy", text: `${MARK} a placeholder safety row`, gold: { lane: "none" } },
];
const key = () => randomBytes(32).toString("base64");
const SCRIPT = fileURLToPath(new URL("../intent-holdout.mjs", import.meta.url));

function folder(t) {
  const dir = mkdtempSync(join(tmpdir(), "holdout-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Runs the CLI with a clean environment (no key, no reveal switch, no CI flag) plus what the test gives it. */
function cli(args, { env = {}, cwd } = {}) {
  const clean = { ...process.env };
  for (const k of [KEY_ENV, REVEAL_ENV, "GITHUB_ACTIONS", "CI", "TF_BUILD"]) delete clean[k];
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...clean, ...env }, cwd, encoding: "utf8" });
  return { status: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
}

/** A plain hold-out file in a folder, and a sealed one made from it with the CLI. */
function sealed(t, env) {
  const dir = folder(t);
  const k = key();
  const plain = join(dir, "plain.json");
  const enc = join(dir, "holdout.enc");
  writeFileSync(plain, JSON.stringify(CASES));
  const r = cli(["seal", plain, "--out", enc], { env: { [KEY_ENV]: k, ...env }, cwd: dir });
  assert.equal(r.status, 0, r.all);
  return { dir, k, plain, enc };
}

/* ---------- the key ---------- */

test("parseKey takes base64 of exactly 32 bytes, with or without a trailing newline", () => {
  const raw = randomBytes(32);
  assert.deepEqual(parseKey(raw.toString("base64")), raw);
  assert.deepEqual(parseKey(raw.toString("base64") + "\n"), raw);
  assert.deepEqual(parseKey("  " + raw.toString("base64") + "\r\n"), raw);
});

test("parseKey refuses a key of the wrong size or shape, and never repeats what it was given", () => {
  const short = randomBytes(16).toString("base64");
  const long = randomBytes(33).toString("base64");
  for (const bad of ["", "   ", short, long, "not base64 at all !!", randomBytes(32).toString("hex"), randomBytes(32).toString("base64").slice(0, -1)]) {
    assert.throws(() => parseKey(bad), (e) => e instanceof HoldoutError && /key must be base64 of 32 bytes/.test(e.message) && !e.message.includes(bad.trim() || "<empty>"), `accepted: ${bad}`);
  }
});

test("generateKey makes a different valid key every time", () => {
  const a = generateKey();
  const b = generateKey();
  assert.notEqual(a, b);
  assert.equal(parseKey(a).length, 32);
});

test("loadKey reads the environment variable, or a key file; the file flag wins over the environment", (t) => {
  const dir = folder(t);
  const fromEnv = key();
  const fromFile = key();
  const file = join(dir, "holdout.key");
  writeFileSync(file, fromFile + "\n");
  assert.deepEqual(loadKey({ env: { [KEY_ENV]: fromEnv } }), Buffer.from(fromEnv, "base64"));
  assert.deepEqual(loadKey({ env: {}, keyFile: file }), Buffer.from(fromFile, "base64"));
  assert.deepEqual(loadKey({ env: { [KEY_ENV]: fromEnv }, keyFile: file }), Buffer.from(fromFile, "base64"));
});

test("loadKey with no key says both ways to give one, and a bad key is refused without printing it", (t) => {
  assert.throws(() => loadKey({ env: {} }), (e) => e instanceof HoldoutError && e.message.includes(KEY_ENV) && /--key-file/.test(e.message));
  const dir = folder(t);
  const file = join(dir, "bad.key");
  writeFileSync(file, "this is not a key");
  assert.throws(() => loadKey({ env: {}, keyFile: file }), (e) => e instanceof HoldoutError && /key must be base64 of 32 bytes/.test(e.message) && !e.message.includes("this is not a key"));
  assert.throws(() => loadKey({ env: {}, keyFile: join(dir, "missing.key") }), (e) => e instanceof HoldoutError && /cannot read the key file/.test(e.message));
});

test("a key file inside the repository is refused before it is read", () => {
  const inside = join(REPO_ROOT, "apps", "api", "holdout.key"); // does not exist: the refusal must come first
  assert.throws(() => loadKey({ env: {}, keyFile: inside }), (e) => e instanceof HoldoutError && /outside the repository/.test(e.message));
});

/* ---------- where files may be ---------- */

test("assertOutsideRepo refuses a path inside the repository, however it is written, and allows one outside", (t) => {
  const dir = folder(t);
  assert.doesNotThrow(() => assertOutsideRepo(join(dir, "plain.json"), "the hold-out file"));
  assert.throws(() => assertOutsideRepo(join(REPO_ROOT, "apps", "api", "eval", "data", "x.json"), "the hold-out file"), (e) => e instanceof HoldoutError && /outside the repository/.test(e.message));
  assert.throws(() => assertOutsideRepo(join(REPO_ROOT, "apps", "..", "apps", "x.json"), "the hold-out file"), /outside the repository/);
  assert.throws(() => assertOutsideRepo(REPO_ROOT, "the hold-out file"), /outside the repository/);
});

// The same file can be written in several ways on Windows. Each one must be judged as the file it is, not as the text of the path.
const WIN = process.platform === "win32";
const BS = String.fromCharCode(92);
function shortNameOf(path) {
  try {
    return execSync(`for %I in ("${path}") do @echo %~sI`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

test("assertOutsideRepo refuses a file of the repository written as its 8.3 short name", { skip: !WIN && "Windows only" }, (t) => {
  const real = join(REPO_ROOT, "package.json");
  const short = shortNameOf(real);
  if (!short || short.toLowerCase() === real.toLowerCase()) return t.skip("this volume has no 8.3 short name for the repository");
  assert.throws(() => assertOutsideRepo(short, "the hold-out file"), (e) => e instanceof HoldoutError && /outside the repository/.test(e.message), short);
});

test("assertOutsideRepo refuses a file of the repository written with the extended-length prefix or as an administrative share", { skip: !WIN && "Windows only" }, (t) => {
  const real = join(REPO_ROOT, "package.json");
  const extended = BS + BS + "?" + BS + real;
  assert.throws(() => assertOutsideRepo(extended, "the hold-out file"), /outside the repository/, extended);
  const share = BS + BS + "localhost" + BS + real[0] + "$" + real.slice(2);
  try {
    statSync(share);
  } catch {
    return t.skip("no administrative share on this machine");
  }
  assert.throws(() => assertOutsideRepo(share, "the hold-out file"), /outside the repository/, share);
  // a file that is not there yet, under the same share, is judged by the folder it would be in
  assert.throws(() => assertOutsideRepo(BS + BS + "localhost" + BS + real[0] + "$" + join(REPO_ROOT, "apps", "not-yet.json").slice(2), "the hold-out file"), /outside the repository/);
});

test("assertOutsideRepo still allows a file on another folder, by any spelling", { skip: !WIN && "Windows only" }, (t) => {
  const dir = folder(t);
  assert.doesNotThrow(() => assertOutsideRepo(BS + BS + "?" + BS + join(dir, "plain.json"), "the hold-out file"));
  const short = shortNameOf(dir);
  if (short) assert.doesNotThrow(() => assertOutsideRepo(join(short, "plain.json"), "the hold-out file"));
});

test("assertOutsideRepo is not fooled by a folder whose name starts with the repository's name", () => {
  assert.doesNotThrow(() => assertOutsideRepo(REPO_ROOT + "-notes/plain.json", "the hold-out file"));
});

test("the sealed file goes to apps/api/eval/data/intent-holdout.enc by default", () => {
  assert.ok(DEFAULT_SEALED_PATH.split(sep).join("/").endsWith("apps/api/eval/data/intent-holdout.enc"));
  assert.ok(DEFAULT_SEALED_PATH.startsWith(REPO_ROOT));
});

/* ---------- the cases ---------- */

test("summarize counts by set and by language, in a fixed order, with no text", () => {
  const s = summarize(CASES);
  assert.equal(s.total, 6);
  assert.deepEqual(JSON.parse(JSON.stringify(s.bySet)), { holdout: { en: 2, hi: 1, hinglish: 2 }, safety_dev: { en: 1 } });
  assert.ok(!JSON.stringify(s).includes(MARK));
});

test("validateCases accepts an array, or an object with a cases list, and keeps every field", () => {
  assert.deepEqual(validateCases(CASES), CASES);
  assert.deepEqual(validateCases({ cases: CASES }), CASES);
});

test("validateCases refuses a hold-out that is empty, malformed, or has a repeated or odd id, and never repeats the text", () => {
  const ok = CASES[0];
  const bad = [
    [[], /no cases/],
    [{}, /list of cases/],
    ["text", /list of cases/],
    [[ok, { ...ok }], /same id/],
    [[{ ...ok, id: "" }], /id/],
    [[{ ...ok, id: "has space" }], /id/],
    [[{ ...ok, id: "x".repeat(65) }], /id/],
    [[{ ...ok, text: "" }], /text/],
    [[{ ...ok, text: 7 }], /text/],
    [[{ ...ok, set: "" }], /set/],
    [[{ ...ok, language: undefined }], /language/],
    [[null], /not an object/],
  ];
  for (const [input, pattern] of bad) {
    assert.throws(() => validateCases(input), (e) => e instanceof HoldoutError && pattern.test(e.message) && !e.message.includes(MARK), JSON.stringify(input).slice(0, 80));
  }
});

/* ---------- the seal ---------- */

test("seal refuses what open would refuse: a header summary over its limit, so it never writes a file that cannot be read", () => {
  // labels of the longest length the case check allows (32): 120 sets of 120 languages each need about 9,000 bytes of counts, and open() takes 4,096
  const label = (word, i) => word.repeat(9) + String(i).padStart(3, "0");
  const many = Array.from({ length: 120 }, (_, i) => ({ id: `s-${i}`, set: label("set", i), language: label("lng", i), text: `${MARK} x` }));
  assert.throws(() => seal(many, parseKey(key())), (e) => e instanceof HoldoutError && e.code === "summary-too-big" && !e.message.includes(MARK));
});

test("what is sealed opens again, with the same cases, with the right key", () => {
  const k = parseKey(key());
  const buf = seal(CASES, k);
  assert.deepEqual(open(buf, k), CASES);
});

test("the file starts with the magic bytes and a version, and holds no text and no case id in the clear", () => {
  const k = parseKey(key());
  const buf = seal(CASES, k);
  assert.deepEqual(buf.subarray(0, 8), MAGIC);
  assert.equal(buf[8], VERSION);
  assert.equal(VERSION, 1);
  const asText = buf.toString("latin1");
  for (const c of CASES) assert.ok(!asText.includes(c.id), `the id ${c.id} is in the clear`);
  assert.ok(!asText.includes(MARK));
  assert.ok(!buf.includes(Buffer.from("काल्पनिक", "utf8")));
});

test("git sees the sealed file as binary (a NUL byte early on), so a line-end setting on a machine cannot change it", () => {
  const buf = seal(CASES, parseKey(key()));
  assert.ok(buf.subarray(0, 8000).includes(0), "no NUL byte in the first 8000 bytes: git might treat the file as text");
});

test("the header is part of what the tag protects: the same bytes do not open without it", () => {
  const k = parseKey(key());
  const buf = seal(CASES, k);
  const headerEnd = 8 + 1 + 12 + 4 + buf.readUInt32BE(21);
  const open_ = (aad) => {
    const d = createDecipheriv("aes-256-gcm", k, buf.subarray(9, 21), { authTagLength: 16 });
    if (aad) d.setAAD(aad);
    d.setAuthTag(buf.subarray(buf.length - 16));
    return Buffer.concat([d.update(buf.subarray(headerEnd, buf.length - 16)), d.final()]);
  };
  assert.ok(open_(buf.subarray(0, headerEnd)).length > 0);
  assert.throws(() => open_(null));
  const other = Buffer.from(buf.subarray(0, headerEnd));
  other[8] = 2;
  assert.throws(() => open_(other));
});

test("two seals of the same cases with the same key differ (a new nonce each time)", () => {
  const k = parseKey(key());
  const a = seal(CASES, k);
  const b = seal(CASES, k);
  assert.notDeepEqual(a.subarray(9, 21), b.subarray(9, 21));
  assert.notEqual(sha256Hex(a), sha256Hex(b));
});

test("a wrong key fails closed: a clear error, no cases, and the callback is never called", () => {
  const buf = seal(CASES, parseKey(key()));
  const wrong = parseKey(key());
  let called = 0;
  assert.throws(() => open(buf, wrong), (e) => e instanceof HoldoutError && /wrong, or the file was changed/.test(e.message));
  assert.throws(() => aggregate(buf, wrong, () => { called++; }), (e) => e instanceof HoldoutError);
  assert.equal(called, 0);
});

test("changing any single byte of the file fails closed", () => {
  const k = parseKey(key());
  const buf = seal(CASES, k);
  for (let i = 0; i < buf.length; i++) {
    const bad = Buffer.from(buf);
    bad[i] ^= 0x01;
    let called = 0;
    assert.throws(() => aggregate(bad, k, () => { called++; }), (e) => e instanceof HoldoutError, `byte ${i} changed and the file still opened`);
    assert.equal(called, 0, `byte ${i}: the callback ran`);
  }
});

test("a file cut short at any length fails closed, and so does a file with bytes added", () => {
  const k = parseKey(key());
  const buf = seal(CASES, k);
  for (let n = 0; n < buf.length; n++) assert.throws(() => open(buf.subarray(0, n), k), (e) => e instanceof HoldoutError, `length ${n} opened`);
  assert.throws(() => open(Buffer.concat([buf, Buffer.from([0])]), k), (e) => e instanceof HoldoutError);
});

test("a file that is not a sealed hold-out, and one of another version, are named as such", () => {
  const k = parseKey(key());
  const buf = seal(CASES, k);
  assert.throws(() => open(Buffer.from("just some text that is long enough to have a header in it, more or less"), k), (e) => e instanceof HoldoutError && /not a sealed hold-out file/.test(e.message));
  const v2 = Buffer.from(buf);
  v2[8] = 2;
  assert.throws(() => open(v2, k), (e) => e instanceof HoldoutError && /version 2/.test(e.message) && /supports version 1/.test(e.message));
});

test("aggregate hands the cases to the callback once and returns what it returns", () => {
  const k = parseKey(key());
  const buf = seal(CASES, k);
  const seen = [];
  const out = aggregate(buf, k, (cases) => { seen.push(cases.length); return { ok: true }; });
  assert.deepEqual(seen, [6]);
  assert.deepEqual(out, { ok: true });
});

/* ---------- verify, without and with the key ---------- */

test("describe without a key gives the hash, the version and the counts, and says the counts were not checked", () => {
  const k = parseKey(key());
  const buf = seal(CASES, k);
  const d = describe(buf);
  assert.equal(d.sha256, sha256Hex(buf));
  assert.equal(d.sha256.length, 64);
  assert.equal(d.version, 1);
  assert.equal(d.bytes, buf.length);
  assert.equal(d.summary.total, 6);
  assert.equal(d.summaryChecked, false);
  assert.ok(!JSON.stringify(d).includes(MARK));
});

test("describe with the key checks the counts against the real contents", () => {
  const k = parseKey(key());
  const buf = seal(CASES, k);
  const d = describe(buf, k);
  assert.equal(d.summaryChecked, true);
  assert.equal(d.summary.total, 6);
  assert.throws(() => describe(Buffer.from(buf.subarray(0, 30)), k), HoldoutError);
});

test("describe without a key still refuses a file with a broken header", () => {
  const buf = seal(CASES, parseKey(key()));
  assert.throws(() => describe(buf.subarray(0, 12)), (e) => e instanceof HoldoutError && /cut short|not a sealed/.test(e.message));
  assert.throws(() => describe(Buffer.from("x".repeat(64))), (e) => e instanceof HoldoutError && /not a sealed hold-out file/.test(e.message));
});

/* ---------- reveal ---------- */

test("reveal is refused unless the owner's switch is set, and never inside CI", () => {
  assert.match(revealRefusal({}), /owner/);
  assert.match(revealRefusal({ [REVEAL_ENV]: "yes" }), /owner/);
  assert.match(revealRefusal({ [REVEAL_ENV]: "OWNER" }), /owner/);
  assert.equal(revealRefusal({ [REVEAL_ENV]: "owner" }), null);
  assert.match(revealRefusal({ [REVEAL_ENV]: "owner", GITHUB_ACTIONS: "true" }), /CI|GitHub/);
});

test("reveal is refused whenever the environment says it is a CI run, in any usual spelling, and allowed when it says it is not", () => {
  for (const [name, value] of [["CI", "true"], ["CI", "1"], ["CI", "True"], ["CI", "yes"], ["GITHUB_ACTIONS", "true"], ["GITHUB_ACTIONS", "1"], ["TF_BUILD", "True"]]) {
    assert.match(revealRefusal({ [REVEAL_ENV]: "owner", [name]: value }), /CI/, `${name}=${value}`);
  }
  for (const value of ["", "false", "False", "0", " 0 ", " "]) assert.equal(revealRefusal({ [REVEAL_ENV]: "owner", CI: value }), null, `CI=${JSON.stringify(value)}`);
});

test("findCase finds a case by its id, and an unknown id does not list the ones that exist", () => {
  assert.equal(findCase(CASES, "dummy-hi-01").id, "dummy-hi-01");
  assert.throws(() => findCase(CASES, "nope"), (e) => e instanceof HoldoutError && /no case with the id/.test(e.message) && !e.message.includes("dummy-"));
});

/* ---------- the command line ---------- */

test("keygen prints a valid key and where to keep it, and writes no file", (t) => {
  const dir = folder(t);
  const r = cli(["keygen"], { cwd: dir });
  assert.equal(r.status, 0, r.all);
  const line = r.out.split(/\r?\n/).find((l) => /^[A-Za-z0-9+/]{43}=$/.test(l.trim()));
  assert.ok(line, `no key line in: ${r.out}`);
  assert.equal(parseKey(line).length, 32);
  assert.match(r.out, /password manager/);
  assert.match(r.out, /GitHub/);
  assert.ok(r.out.includes(KEY_ENV));
  assert.match(r.out, /not in the repository/i);
  assert.deepEqual(readdirSync(dir), []);
});

test("seal writes the sealed file, prints its hash and counts, and no text", (t) => {
  const { dir, enc } = sealed(t);
  const bytes = readFileSync(enc);
  assert.deepEqual(bytes.subarray(0, 8), MAGIC);
  const again = cli(["verify", "--file", enc], { cwd: dir });
  assert.equal(again.status, 0, again.all);
  assert.ok(again.out.includes(sha256Hex(bytes)));
  assert.ok(!again.all.includes(MARK));
});

test("seal prints the hash, the counts and that it read the file back with the key; never any text", (t) => {
  const dir = folder(t);
  const k = key();
  const plain = join(dir, "plain.json");
  writeFileSync(plain, JSON.stringify({ cases: CASES }));
  const enc = join(dir, "holdout.enc");
  const r = cli(["seal", plain, "--out", enc], { env: { [KEY_ENV]: k }, cwd: dir });
  assert.equal(r.status, 0, r.all);
  assert.ok(r.out.includes(sha256Hex(readFileSync(enc))));
  assert.match(r.out, /6 cases/);
  assert.match(r.out, /read back/);
  assert.ok(!r.all.includes(MARK));
});

test("seal refuses to overwrite a sealed file unless --replace is given, and leaves it unchanged", (t) => {
  const { dir, k, plain, enc } = sealed(t);
  const before = readFileSync(enc);
  const r = cli(["seal", plain, "--out", enc], { env: { [KEY_ENV]: k }, cwd: dir });
  assert.equal(r.status, 1);
  assert.match(r.err, /already exists/);
  assert.match(r.err, /--replace/);
  assert.deepEqual(readFileSync(enc), before);
  const ok = cli(["seal", plain, "--out", enc, "--replace"], { env: { [KEY_ENV]: k }, cwd: dir });
  assert.equal(ok.status, 0, ok.all);
  assert.notDeepEqual(readFileSync(enc), before);
});

test("seal refuses a plain file inside the repository, before reading it, and writes nothing", (t) => {
  const dir = folder(t);
  const out = join(dir, "holdout.enc");
  const inside = join(REPO_ROOT, "apps", "api", "eval", "data", "plain-holdout-that-must-not-exist.json");
  const r = cli(["seal", inside, "--out", out], { env: { [KEY_ENV]: key() }, cwd: dir });
  assert.equal(r.status, 1);
  assert.match(r.err, /outside the repository/);
  assert.deepEqual(readdirSync(dir), []);
});

test("seal leaves no half-written file when the input is bad, and does not quote the input", (t) => {
  const dir = folder(t);
  const plain = join(dir, "plain.json");
  writeFileSync(plain, `[{"id": "a-1", "text": "${MARK} broken`);
  const out = join(dir, "holdout.enc");
  const r = cli(["seal", plain, "--out", out], { env: { [KEY_ENV]: key() }, cwd: dir });
  assert.equal(r.status, 1);
  assert.match(r.err, /not valid JSON/);
  assert.ok(!r.all.includes(MARK));
  assert.deepEqual(readdirSync(dir), ["plain.json"]);
});

test("verify without a key prints the hash and counts by set and language, and says they were not checked", (t) => {
  const { dir, enc } = sealed(t);
  const r = cli(["verify", "--file", enc], { cwd: dir });
  assert.equal(r.status, 0, r.all);
  assert.match(r.out, /sha256 +[0-9a-f]{64}/);
  assert.match(r.out, /holdout +hinglish +2/);
  assert.match(r.out, /holdout +hi +1/);
  assert.match(r.out, /safety_dev +en +1/);
  assert.match(r.out, /not checked against the contents/);
  assert.ok(!r.all.includes(MARK));
});

test("verify with the key checks the counts, and --expect-sha256 fails on a different file", (t) => {
  const { dir, k, enc } = sealed(t);
  const good = cli(["verify", "--file", enc], { env: { [KEY_ENV]: k }, cwd: dir });
  assert.equal(good.status, 0, good.all);
  assert.match(good.out, /checked against the contents with the key/);
  assert.ok(!/not checked/.test(good.out));
  const hash = sha256Hex(readFileSync(enc));
  assert.equal(cli(["verify", "--file", enc, "--expect-sha256", hash], { cwd: dir }).status, 0);
  const bad = cli(["verify", "--file", enc, "--expect-sha256", "0".repeat(64)], { cwd: dir });
  assert.equal(bad.status, 1);
  assert.match(bad.err, /does not match/);
});

test("aggregate prints counts and opaque case ids, never a case's text or the id its writer gave it", (t) => {
  const { dir, k, enc } = sealed(t);
  const r = cli(["aggregate", "--file", enc], { env: { [KEY_ENV]: k }, cwd: dir });
  assert.equal(r.status, 0, r.all);
  assert.equal(r.out.match(/HO-[0-9a-f]{10}/g).length, 6, "six opaque ids, one for each case");
  assert.ok(!r.all.includes("dummy-"), "a writer's id (here the scenario's code) is not printed");
  assert.match(r.out, /6 cases/);
  assert.ok(!r.all.includes(MARK));
  assert.ok(!r.all.includes("काल्पनिक"));
  assert.ok(!r.all.includes("zorbitol"));
});

test("aggregate with a wrong key, or on a changed file, prints nothing from the cases and fails", (t) => {
  const { dir, enc } = sealed(t);
  const wrong = cli(["aggregate", "--file", enc], { env: { [KEY_ENV]: key() }, cwd: dir });
  assert.equal(wrong.status, 1);
  assert.equal(wrong.out, "");
  assert.match(wrong.err, /wrong, or the file was changed/);
  assert.ok(!wrong.all.includes("dummy-"));
  assert.ok(!wrong.all.includes(MARK));
});

test("aggregate on a changed file fails closed with no output", (t) => {
  const { dir, k, enc } = sealed(t);
  const bytes = readFileSync(enc);
  bytes[bytes.length - 20] ^= 0xff;
  writeFileSync(enc, bytes);
  const r = cli(["aggregate", "--file", enc], { env: { [KEY_ENV]: k }, cwd: dir });
  assert.equal(r.status, 1);
  assert.equal(r.out, "");
  assert.ok(!r.all.includes(MARK));
});

test("reveal is refused without the owner's switch, even with the right key, and prints no text", (t) => {
  const { dir, k, enc } = sealed(t);
  const r = cli(["reveal", "--id", "dummy-en-01", "--file", enc], { env: { [KEY_ENV]: k }, cwd: dir });
  assert.equal(r.status, 1);
  assert.match(r.err, /owner/);
  assert.equal(r.out, "");
  assert.ok(!r.all.includes(MARK));
});

test("reveal with the owner's switch prints the case, and says it now moves to DEV and a fresh one must be written", (t) => {
  const { dir, k, enc } = sealed(t);
  const r = cli(["reveal", "--id", "dummy-en-01", "--file", enc], { env: { [KEY_ENV]: k, [REVEAL_ENV]: "owner" }, cwd: dir });
  assert.equal(r.status, 0, r.all);
  assert.ok(r.out.includes(`${MARK} how do glaciers on an invented planet melt`));
  assert.match(r.out, /moves to DEV/);
  assert.match(r.out, /fresh one/);
  assert.match(r.out, /seal again/);
});

test("reveal is refused inside CI even with the owner's switch, and an unknown id is refused", (t) => {
  const { dir, k, enc } = sealed(t);
  const ci = cli(["reveal", "--id", "dummy-en-01", "--file", enc], { env: { [KEY_ENV]: k, [REVEAL_ENV]: "owner", GITHUB_ACTIONS: "true" }, cwd: dir });
  assert.equal(ci.status, 1);
  assert.ok(!ci.all.includes(MARK));
  const unknown = cli(["reveal", "--id", "nope", "--file", enc], { env: { [KEY_ENV]: k, [REVEAL_ENV]: "owner" }, cwd: dir });
  assert.equal(unknown.status, 1);
  assert.match(unknown.err, /no case with the id/);
  assert.ok(!unknown.all.includes(MARK));
  const missing = cli(["reveal", "--file", enc], { env: { [KEY_ENV]: k, [REVEAL_ENV]: "owner" }, cwd: dir });
  assert.equal(missing.status, 2);
  assert.match(missing.err, /--id/);
});

test("an unknown command prints the usage and exits with 2", () => {
  const r = cli(["frobnicate"]);
  assert.equal(r.status, 2);
  assert.match(r.err, /usage/i);
  for (const word of ["keygen", "seal", "verify", "aggregate", "reveal"]) assert.ok(r.err.includes(word), word);
});

/* ---------- a sheet the writers fill in (CSV) ---------- */

const HEADER = "id,set,language,class,text,author,tags";
const BOM = String.fromCharCode(0xfeff);

test("casesFromCsv reads a sheet: quotes, commas and line breaks inside a cell, Devanagari, a BOM, CRLF line ends, tags split at semicolons", () => {
  const csv = BOM + [
    HEADER,
    `HO-T-01,holdout,en,research,"a, b and ""c""",tester,scenario:1;draft`,
    `HO-T-02,holdout,hi,research,"line one\nline two",tester,`,
    `HO-T-03,holdout,hi,research,काल्पनिक ग्रह,tester,`,
  ].join("\r\n") + "\r\n";
  const cases = casesFromCsv(csv);
  assert.equal(cases.length, 3);
  assert.deepEqual(cases[0], { id: "HO-T-01", set: "holdout", language: "en", class: "research", text: 'a, b and "c"', author: "tester", tags: ["scenario:1", "draft"] });
  assert.equal(cases[1].text, "line one\nline two");
  assert.equal(cases[2].text, "काल्पनिक ग्रह");
  assert.ok(!("tags" in cases[1]), "an empty cell is left out");
  assert.deepEqual(validateCases(cases), cases);
});

test("casesFromCsv takes header names in any case and with spaces, skips empty rows, keeps an extra column, and needs no final line end", () => {
  const cases = casesFromCsv(" ID , Set ,LANGUAGE,Text,Notes\nA-1,holdout,en,first text,a note\n,,,,\nA-2,holdout,hi,second text,");
  assert.deepEqual(cases, [
    { id: "A-1", set: "holdout", language: "en", text: "first text", notes: "a note" },
    { id: "A-2", set: "holdout", language: "hi", text: "second text" },
  ]);
});

test("casesFromCsv refuses a sheet with a missing, repeated or ragged column, or an open quote, and never repeats a text", () => {
  const bad = [
    ["id,set,text\nA,x,y", /missing the column language/],
    [`${HEADER},id\nA,holdout,en,c,${MARK},w,t,A`, /same column twice [(]columns 1 and 8[)]/],
    [`${HEADER}\nA,holdout,en,c,${MARK}\nB,holdout,en,c,y,w,t`, /row 2 has 5 fields but the header has 7/],
    [`${HEADER}\nA,holdout,en,c,"${MARK} never closed,w,t`, /quote/],
    ["", /no rows/],
    ["\n\n", /no rows/],
  ];
  for (const [csv, pattern] of bad) {
    assert.throws(() => casesFromCsv(csv), (e) => e instanceof HoldoutError && pattern.test(e.message) && !e.message.includes(MARK), csv.slice(0, 60));
  }
  assert.throws(() => validateCases(casesFromCsv(HEADER + "\n")), /no cases/);
});

test("a repeated column is named by its place, never by its text: a first row that is no header holds a message", () => {
  const rows = `id,set,language,text,${MARK} secret one,${MARK} secret one\nA,holdout,en,hello there,x,y`;
  assert.throws(() => casesFromCsv(rows), (e) => e instanceof HoldoutError && /columns 5 and 6/.test(e.message) && !e.message.includes(MARK) && !e.message.includes("secret"));
});

test("a column called __proto__ is only a name", () => {
  const cases = casesFromCsv("id,set,language,text,__proto__\nA,holdout,en,hello there,x");
  assert.equal(Object.getPrototypeOf(cases[0]), Object.prototype);
  assert.equal(({}).x, undefined);
});

function sheetFiles(t) {
  const dir = folder(t);
  const a = join(dir, "owner.csv");
  const b = join(dir, "clinician.csv");
  const c = join(dir, "student.json");
  writeFileSync(a, BOM + [HEADER, `HO-OWN-01,holdout,hinglish,research,${MARK} nakli planet ka sawal,person,`, `HO-OWN-02,holdout,hinglish,research,"${MARK} dusra, sawal",person,`].join("\r\n"));
  writeFileSync(b, [HEADER, `HO-CLI-01,holdout,en,safety,${MARK} a placeholder row,person,`].join("\n") + "\n");
  writeFileSync(c, JSON.stringify([{ id: "HO-MED-01", set: "holdout", language: "hi", class: "research", text: `${MARK} काल्पनिक`, author: "person" }]));
  return { dir, a, b, c };
}

test("seal takes several files, CSV or JSON, joins them, and says how many cases of each set and language it sealed", (t) => {
  const { dir, a, b, c } = sheetFiles(t);
  const k = key();
  const enc = join(dir, "holdout.enc");
  const r = cli(["seal", a, b, c, "--out", enc], { env: { [KEY_ENV]: k }, cwd: dir });
  assert.equal(r.status, 0, r.all);
  assert.match(r.out, /sealed 4 cases/);
  assert.ok(!r.all.includes(MARK));
  const cases = open(readFileSync(enc), parseKey(k));
  const sealedId = (writerId) => opaqueId(parseKey(k), writerId);
  assert.deepEqual(cases.map((x) => x.id).sort(), ["HO-CLI-01", "HO-MED-01", "HO-OWN-01", "HO-OWN-02"].map(sealedId).sort());
  assert.equal(cases.find((x) => x.id === sealedId("HO-OWN-02")).text, `${MARK} dusra, sawal`);
  const v = cli(["verify", "--file", enc], { cwd: dir });
  assert.match(v.out, /holdout +hinglish +2/);
  assert.match(v.out, /holdout +hi +1/);
});

test("an id in two files is refused, naming the files and the id and no text, and nothing is written", (t) => {
  const { dir, a, b } = sheetFiles(t);
  const twin = join(dir, "twin.csv");
  writeFileSync(twin, [HEADER, `HO-OWN-01,holdout,en,research,${MARK} same id again,someone,`].join("\n"));
  const enc = join(dir, "holdout.enc");
  const r = cli(["seal", a, b, twin, "--out", enc], { env: { [KEY_ENV]: key() }, cwd: dir });
  assert.equal(r.status, 1);
  assert.match(r.err, /HO-OWN-01/);
  assert.match(r.err, /owner\.csv/);
  assert.match(r.err, /twin\.csv/);
  assert.ok(!r.all.includes(MARK));
  assert.ok(!readdirSync(dir).includes("holdout.enc"));
});

test("a problem in one sheet is named with that file and the row, and a file inside the repository stops everything first", (t) => {
  const { dir, a } = sheetFiles(t);
  const ragged = join(dir, "ragged.csv");
  writeFileSync(ragged, `${HEADER}\nX-1,holdout,en,c,${MARK}\n`);
  const enc = join(dir, "holdout.enc");
  const r = cli(["seal", a, ragged, "--out", enc], { env: { [KEY_ENV]: key() }, cwd: dir });
  assert.equal(r.status, 1);
  assert.match(r.err, /ragged\.csv/);
  assert.match(r.err, /row 2 has 5 fields/);
  assert.ok(!r.all.includes(MARK));
  const inside = join(REPO_ROOT, "apps", "api", "eval", "data", "sheet-that-must-not-exist.csv");
  const r2 = cli(["seal", a, inside, "--out", enc], { env: { [KEY_ENV]: key() }, cwd: dir });
  assert.equal(r2.status, 1);
  assert.match(r2.err, /outside the repository/);
  assert.ok(!readdirSync(dir).includes("holdout.enc"));
});

test("aggregate also counts the cases by class, which are labels and not text", (t) => {
  const { dir, k, enc } = sealed(t);
  const r = cli(["aggregate", "--file", enc], { env: { [KEY_ENV]: k }, cwd: dir });
  assert.equal(r.status, 0, r.all);
  assert.match(r.out, /class +cases/);
  assert.match(r.out, /dummy +6/);
});

/* ---------- the case schema (apps/api/eval/lib/intent-schema.ts) is checked before anything is sealed ---------- */

test("schemaProblems names a case by its id, or by its place when the id is not usable, and keeps the kind of problem but never a piece of the text", () => {
  const validate = (c) =>
    c.id === "A-1" ? [`text: e-mail address (leak-${MARK}@example.org)`, "tags: must be a non-empty list of lowercase slugs"] : c.id === "bad id" ? ["id: required; letters, digits, dot, dash and underscore only, at most 64"] : [];
  const out = schemaProblems([{ id: "A-1" }, { id: "B-2" }, { id: "bad id" }], validate);
  assert.deepEqual(out, ["case A-1: text: e-mail address", "case A-1: tags: must be a non-empty list of lowercase slugs", "case #3: id: required; letters, digits, dot, dash and underscore only, at most 64"]);
  assert.ok(!out.join(" ").includes(MARK));
  assert.deepEqual(schemaProblems([{ id: "B-2" }], validate), []);
});

test("schemaProblems stops listing after 20 problems and says how many more", () => {
  const out = schemaProblems(Array.from({ length: 30 }, (_, i) => ({ id: `c-${i}` })), () => ["class: required"]);
  assert.equal(out.length, 21);
  assert.equal(out[20], "and 10 more");
});

function schemaFiles(t, rows) {
  const dir = folder(t);
  const file = join(dir, "sheet.csv");
  writeFileSync(file, [HEADER, ...rows].join("\n") + "\n");
  return { dir, file };
}

test("check needs no key, counts a good sheet by set and language, and prints no text", (t) => {
  const { dir, file } = schemaFiles(t, [
    `HO-OWN-01,holdout,hinglish,research,${MARK} nakli sawal,person,writer-owner;typed-fresh`,
    `HO-OWN-02,holdout,en,research,${MARK} an invented question,person,`,
    `HO-OWN-03,holdout,hi,research,${MARK} काल्पनिक प्रश्न,person,`,
  ]);
  const r = cli(["check", file], { cwd: dir });
  assert.equal(r.status, 0, r.all);
  assert.match(r.out, /3 cases/);
  assert.match(r.out, /holdout +hinglish +1/);
  assert.match(r.out, /no problems/);
  assert.ok(!r.all.includes(MARK));
});

test("check and seal refuse what the schema refuses, naming the file and the case, never the text", (t) => {
  const { dir, file } = schemaFiles(t, [
    `HO-OWN-01,holdout,hinglish,research,${MARK} fine,person,Writer:Owner`, // tags must be lowercase slugs
    `HO-OWN-02,holdout,hi,research,${MARK} no devanagari here,person,`, // language hi needs Devanagari
    `HO-OWN-03,holdout,en,research,${MARK} write to ravi.kumar@example.org please,person,`, // an e-mail address
    `HO-OWN-04,holdout,en,Research,${MARK} class is not a slug,person,`,
    `HO-OWN-05,dev,en,research,${MARK} wrong set for a hold-out is still a valid set,person,`,
  ]);
  const c = cli(["check", file], { cwd: dir });
  assert.equal(c.status, 1);
  assert.match(c.err, /sheet\.csv/);
  assert.match(c.err, /case HO-OWN-01: tags: must be a non-empty list of lowercase slugs/);
  assert.match(c.err, /case HO-OWN-02: language: hi needs Devanagari/);
  assert.match(c.err, /case HO-OWN-03: text: e-mail address/);
  assert.match(c.err, /case HO-OWN-04: class: required/);
  assert.ok(!/HO-OWN-05/.test(c.err));
  assert.ok(!c.all.includes(MARK));
  assert.ok(!c.all.includes("ravi.kumar"));
  const enc = join(dir, "holdout.enc");
  const s = cli(["seal", file, "--out", enc], { env: { [KEY_ENV]: key() }, cwd: dir });
  assert.equal(s.status, 1);
  assert.match(s.err, /case HO-OWN-02: language: hi needs Devanagari/);
  assert.ok(!s.all.includes("ravi.kumar"));
  assert.ok(!readdirSync(dir).includes("holdout.enc"));
});

test("check also refuses an id used in two files, and a file inside the repository", (t) => {
  const { dir, a, c } = sheetFiles(t);
  const twin = join(dir, "twin.csv");
  writeFileSync(twin, [HEADER, `HO-OWN-01,holdout,en,research,${MARK} same id,person,`].join("\n"));
  const r = cli(["check", a, twin], { cwd: dir });
  assert.equal(r.status, 1);
  assert.match(r.err, /HO-OWN-01 is in both owner\.csv and twin\.csv/);
  const inside = join(REPO_ROOT, "apps", "api", "eval", "data", "sheet-that-must-not-exist.csv");
  const r2 = cli(["check", c, inside], { cwd: dir });
  assert.equal(r2.status, 1);
  assert.match(r2.err, /outside the repository/);
});

test("an unknown column is named only when it is a plain column name; a header that is really a message is not repeated", (t) => {
  const dir = folder(t);
  const plain = join(dir, "plain.csv");
  writeFileSync(plain, [`${HEADER},notes`, `HO-OWN-01,holdout,en,research,${MARK} fine,person,,remember this`].join("\n") + "\n");
  const a = cli(["check", plain], { cwd: dir });
  assert.equal(a.status, 1);
  assert.match(a.err, /case HO-OWN-01: case: unknown field "notes"/);
  const odd = join(dir, "odd.csv");
  writeFileSync(odd, [`${HEADER},${MARK} a sentence typed where a column name goes`, `HO-OWN-01,holdout,en,research,${MARK} fine,person,,x`].join("\n") + "\n");
  const b = cli(["check", odd], { cwd: dir });
  assert.equal(b.status, 1);
  assert.match(b.err, /case HO-OWN-01: case: unknown field [(]name not shown/);
  assert.ok(!b.all.includes(MARK) && !b.all.includes("sentence"));
});

test("a JSON file that starts with a byte-order mark (Windows tools write one) is read like any other", (t) => {
  const dir = folder(t);
  const file = join(dir, "bom.json");
  writeFileSync(file, BOM + JSON.stringify([{ id: "HO-OWN-01", set: "holdout", language: "en", class: "research", text: `${MARK} fine`, author: "person" }]));
  const r = cli(["check", file], { cwd: dir });
  assert.equal(r.status, 0, r.all);
  assert.match(r.out, /checked 1 cases/);
});

/* ---------- opaque ids: a failing case's id must not say what the message is about (docs/eval/intent-writing-guide.md, section 3) ---------- */

test("opaqueId is HO- and ten hex digits, the same for the same key and id, and different for another key or another id", () => {
  const k1 = parseKey(key());
  const k2 = parseKey(key());
  assert.match(opaqueId(k1, "HO-PHD-14"), /^HO-[0-9a-f]{10}$/);
  assert.equal(opaqueId(k1, "HO-PHD-14"), opaqueId(k1, "HO-PHD-14"));
  assert.notEqual(opaqueId(k1, "HO-PHD-14"), opaqueId(k2, "HO-PHD-14"));
  assert.notEqual(opaqueId(k1, "HO-PHD-14"), opaqueId(k1, "HO-PHD-15"));
  assert.ok(!opaqueId(k1, "HO-PHD-14").toLowerCase().includes("phd"));
});

test("withOpaqueIds changes only the id, and gives every case a different one", () => {
  const k = parseKey(key());
  const out = withOpaqueIds(CASES, k);
  assert.deepEqual(out.map(({ id, ...rest }) => rest), CASES.map(({ id, ...rest }) => rest));
  assert.equal(new Set(out.map((c) => c.id)).size, CASES.length);
  assert.ok(out.every((c, i) => c.id === opaqueId(k, CASES[i].id)));
  assert.ok(!JSON.stringify(out.map((c) => c.id)).includes("dummy"));
  assert.equal(CASES[0].id, "dummy-en-01", "the input is not changed");
});

test("seal through the command line replaces the writers' ids with opaque ones, says so, and the same plain files give the same ids at the next seal", (t) => {
  const { dir, k, plain, enc } = sealed(t);
  const first = cli(["aggregate", "--file", enc], { env: { [KEY_ENV]: k }, cwd: dir }).out.match(/HO-[0-9a-f]{10}/g);
  const again = cli(["seal", plain, "--out", enc, "--replace"], { env: { [KEY_ENV]: k }, cwd: dir });
  assert.equal(again.status, 0, again.all);
  assert.match(again.out, /ids: .*opaque/i);
  const second = cli(["aggregate", "--file", enc], { env: { [KEY_ENV]: k }, cwd: dir }).out.match(/HO-[0-9a-f]{10}/g);
  assert.deepEqual(second, first);
  assert.equal(new Set(first).size, 6);
});

test("reveal takes the opaque id, or the id the writer gave (the owner has the plain files), and says both", (t) => {
  const { dir, k, enc } = sealed(t);
  const env = { [KEY_ENV]: k, [REVEAL_ENV]: "owner" };
  const byWriter = cli(["reveal", "--id", "dummy-en-01", "--file", enc], { env, cwd: dir });
  assert.equal(byWriter.status, 0, byWriter.all);
  const opaque = opaqueId(parseKey(k), "dummy-en-01");
  assert.ok(byWriter.out.includes(opaque), "the opaque id is shown");
  assert.ok(byWriter.out.includes("dummy-en-01"), "and the id the writer gave");
  const byOpaque = cli(["reveal", "--id", opaque, "--file", enc], { env, cwd: dir });
  assert.equal(byOpaque.status, 0, byOpaque.all);
  assert.ok(byOpaque.out.includes(`${MARK} how do glaciers on an invented planet melt`));
  const unknown = cli(["reveal", "--id", "nope", "--file", enc], { env, cwd: dir });
  assert.equal(unknown.status, 1);
  assert.match(unknown.err, /no case with the id nope/);
});

/* ---------- the writing guide (docs/eval/intent-writing-guide.md) stays true to this tool and to its own rules ---------- */

const GUIDE = readFileSync(new URL("../../../../docs/eval/intent-writing-guide.md", import.meta.url), "utf8");

test("the CSV and the JSON examples of the writing guide pass the checker, so the template cannot drift from the schema", (t) => {
  const csv = /```\n(id,set,language,class,text,author,tags\n[\s\S]*?)```/.exec(GUIDE);
  const json = /```json\n([\s\S]*?)```/.exec(GUIDE);
  assert.ok(csv && json, "the guide no longer has its two examples");
  const dir = folder(t);
  writeFileSync(join(dir, "example.csv"), csv[1]);
  writeFileSync(join(dir, "example.json"), json[1]);
  const r = cli(["check", join(dir, "example.csv")], { cwd: dir });
  assert.equal(r.status, 0, r.all);
  assert.match(r.out, /checked 3 cases/);
  const j = cli(["check", join(dir, "example.json")], { cwd: dir });
  assert.equal(j.status, 0, j.all);
});

test("each of the four hold-out sheets of the guide has 20 scenarios, numbered 01 to 20, and no code is used twice", () => {
  for (const sheet of ["OWN", "MED", "PHD", "CLI"]) {
    const codes = [...GUIDE.matchAll(new RegExp(String.raw`^\| (HO-${sheet}-\d\d) \|`, "gm"))].map((m) => m[1]);
    assert.deepEqual(codes, Array.from({ length: 20 }, (_, i) => `HO-${sheet}-${String(i + 1).padStart(2, "0")}`), sheet);
  }
});

test("the safety brief of the guide holds no phrase to match, no method, and the helpline numbers only as unverified, in the clinician's section", () => {
  const lower = GUIDE.toLowerCase();
  const phrases = [
    "i want to die", "kill myself", "end my life", "take my own life", "no reason to live", "better off dead", "cannot go on", "i am suicidal", "i feel suicidal", "thinking about suicide",
    "commit suicide", "chest pain", "cannot breathe", "took too many", "help me", "i need help", "someone help me", "cannot cope", "i am scared", "i am not okay", "cannot do this anymore",
    "can i take", "should i take", "is it safe for me", "how much should i take",
  ];
  for (const phrase of phrases) assert.ok(!lower.includes(phrase), `the guide quotes a phrase of the plan: ${phrase}`);
  for (const method of ["overdose", "hanging", "pills", "rope"]) assert.ok(!new RegExp(String.raw`\b${method}\b`).test(lower), `the guide names a means: ${method}`);
  const clinician = GUIDE.indexOf("### 6.7");
  assert.ok(clinician > 0);
  const before = GUIDE.slice(0, clinician);
  assert.ok(!before.includes("14416") && !/tele-manas/i.test(before) && !/\b112\b/.test(before), "a helpline number is outside the clinician's section");
  const after = GUIDE.slice(clinician);
  assert.match(after, /112 and Tele-MANAS 14416, are unverified/);
});

test("the safety brief hands the writers no wording of its own: no sample phrase for a decision message, no pair of feelings for help, no list of things to exaggerate", () => {
  const lower = GUIDE.toLowerCase();
  for (const wording of ["my usual tablet", "the new one the doctor gave me", "frightened or overwhelmed", "tiredness, embarrassment", "hunger, exams, deadlines"]) {
    assert.ok(!lower.includes(wording), `the brief hands writers a wording: ${wording}`);
  }
});

/** The rows of the four hold-out sheets: code, and the text of the situation. */
function scenarios() {
  return [...GUIDE.matchAll(/^\| (HO-(?:OWN|MED|PHD|CLI)-\d\d) \|(.*)\|$/gm)].map((m) => ({ code: m[1], text: m[2].split("|").pop().trim(), row: m[2] }));
}

test("every scenario of the four sheets is a situation that speaks to the writer, not a ready-made question to type or translate", () => {
  const rows = scenarios();
  assert.equal(rows.length, 80);
  for (const { code, text } of rows) assert.ok(/\byou(?:r|rs|'re|'ve)?\b/i.test(text), `${code} does not address the writer as a situation: ${text}`);
});

test("nobody translates from a sheet: section 2 says the writer types what they would type in the language named, not a translation of the page", () => {
  const section2 = GUIDE.slice(GUIDE.indexOf("## 2. The rules"), GUIDE.indexOf("## 3. What you hand in"));
  assert.match(section2, /translat/i);
  assert.match(section2, /not a translation|do not translate|never translate/i);
});

test("the owner's hours are not claimed to fit the plan's four: the guide's own part is counted, and the plan's other tasks are named as not counted", () => {
  assert.ok(!/inside the limit/i.test(GUIDE), "the guide still says the checklist is inside the limit");
  const section8 = GUIDE.slice(GUIDE.indexOf("## 8. Checklist for the owner"));
  assert.match(section8, /two tables/);
  assert.match(section8, /about 40/);
  assert.match(section8, /over the plan's 4 hours|more than the plan's 4 hours|above the plan's 4 hours/);
  // the rows that ask for distress messages are written in sittings with a break, as section 6.6 asks
  for (const row of section8.split("\n").filter((l) => /^\| [45] \|/.test(l))) assert.match(row, /sitting/i, row.slice(0, 40));
});

test("the hold-out split of 4.7 gives urgent and crisis messages to the clinician and the owner only, as the dev split of 6.4 does, and adds up to 60", () => {
  const block = GUIDE.slice(GUIDE.indexOf("### 4.7"), GUIDE.indexOf("## 5. After you hand in"));
  const rows = block.split("\n").filter((l) => /^\| (?:clinician|medical student|owner) \|/.test(l));
  assert.equal(rows.length, 3);
  const student = rows.find((r) => r.startsWith("| medical student"));
  assert.ok(!/urgent|crisis/i.test(student), "the student row of 4.7 still carries urgent or crisis messages");
  assert.equal(rows.reduce((sum, r) => sum + Number(r.split("|").filter((c) => c.trim() !== "").pop().trim()), 0), 60);
  assert.match(block, /6\.4/);
});

test("section 3 says that sealing replaces the writers' ids with opaque ones, so a failing id says nothing about the scenario", () => {
  const section3 = GUIDE.slice(GUIDE.indexOf("## 3. What you hand in"), GUIDE.indexOf("## 4. Brief A"));
  assert.match(section3, /opaque/);
  assert.match(section3, /scenario/);
});
