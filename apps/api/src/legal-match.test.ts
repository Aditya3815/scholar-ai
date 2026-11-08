import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAst } from "vite";
import { positionOfVariable } from "./understand/flags";

// src/test-node.d.ts declares only the little of Node that the database stand-in uses; this file also needs these.
declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function statSync(path: string): { isFile(): boolean; isDirectory(): boolean };
  export function readdirSync(path: string, options: { recursive: true }): string[];
  export function mkdtempSync(prefix: string): string;
  export function mkdirSync(path: string, options: { recursive: true }): void;
  export function writeFileSync(path: string, data: string): void;
  export function rmSync(path: string, options: { recursive: true; force: true }): void;
}
declare module "node:path" {
  export function dirname(path: string): string;
  export function resolve(...parts: string[]): string;
  export function relative(from: string, to: string): string;
}

/**
 * The disclosure match (docs/design/intent-and-state.md, 10.2): what the privacy page says is true of the code. Read together with legal-text.test.ts, which pins the sentences of the page that exist;
 * this file pins the two ways a sentence and the code can come apart as the understanding releases land one flag at a time. It reads source, like that test, and shares its reading of the page.
 *
 *  (3) NO MODULE OF understand/ TALKS TO A NETWORK CLIENT. The rule, exactly:
 *      static, on the syntax tree (vite's parseAst, which vitest already carries), so a comment, a type and the text of a string are not code: a hostile message that contains "fetch(" is data, and
 *      understand/hostile-messages.ts is one. TypeScript that only names things (a type, an interface, an annotation, `typeof fetch`) is not walked into; the TypeScript that holds code is (TS_NODES_WITH_CODE:
 *      a cast and a non-null assertion, a namespace and an enum, a constructor's `private f = fetch`, `export =`, `import a = require()`):
 *        - no use of the name `fetch` (a call, a reference, a property such as `globalThis.fetch` or `env.ASSETS.fetch`, `a["fetch"]`, `const { fetch } = x`; defining an object key or a method of
 *          that name is not a use), no Workers AI binding (`.AI`, `["AI"]`, `const { AI } = env`), no dynamic `import(`, no `require(`, no use of `eval` in any form (`eval(t)`, `(0, eval)(t)`, `const e = eval`)
 *          and no `Function(` or `new Function(` (also through `(0, Function)`), no XMLHttpRequest, WebSocket, EventSource or sendBeacon;
 *        - every import is a sibling inside understand/ (each is checked on its own), `@scholar/shared` (not followed: it is the workspace's data and pure-function package, and its barrel names `fetch`
 *          in text), or a relative module elsewhere in apps/api/src, which is followed through its own relative imports and must pass the same site rule and the same import rule (a package it imports
 *          is refused, as a client could sit behind it). So `../search/normalize` (pure) is allowed and `../search/openalex` (a `fetch` call) or `../llm` (`env.AI`) is not, with no list of providers
 *          to keep up to date. Any other import (`hono`, `node:`, `cloudflare:`, `import a = require("x")`) is refused.
 *      Workers KV, D1 and R2 are our own storage, not a recipient the privacy page names, so they are not covered: flags.ts takes the KV namespace as an argument and reads from it.
 *      run time: every module is loaded afresh and every exported function of it is called with plain strings (a normal message, an empty one, one of 20 000 characters) in the shapes (text), (text, text),
 *        (env, text) and (text, env), with global `fetch` replaced by a function that records and throws and an `env` whose `AI` records and throws on any property. The trap is in place before the module is
 *        imported (what runs at import is seen) and stays for SETTLE_MS after the last call (a call scheduled by a short timer is seen). What it records fails the test even when the module catches the
 *        error. A grep for imports alone misses a global `fetch()` or an `env.AI` call, and a call path that only runs for some input is only seen if the input reaches it.
 *      What it cannot check: a function that needs a structured argument (a reading, a request) throws on a string and is skipped, so its own tests must carry the stub too; a class; code that builds
 *        the name of the client at run time (`Reflect.get(globalThis, "fetch")`, `globalThis["fe" + "tch"]`); a network call reached through `@scholar/shared`; a path that only some input reaches; a
 *        call that a timer or a promise chain makes later than SETTLE_MS (20 ms) after the last call returned. Every module of the folder must run at least one function on plain strings, or be listed
 *        in NO_FUNCTION_TO_CALL with the reason (hostile-messages.ts: data only), so an empty run is a decision and not a silent gap; the listing of the folder is proved on a folder built for the
 *        purpose and compared with a second walk of the real one.
 *
 *  (4) EVERY PRIVACY SENTENCE OF A RELEASE IS PINNED TO ITS OWN FLAG, in both directions: FLAG_SENTENCES says which sentence must be on the page when the flag of the committed `vars` block is `on` (or
 *      `core` or `on` for the safety lane), and the test fails for a sentence on the page whose flag is not on, and for a flag that is on whose sentence is missing. A flag at `on` or `core` in `vars` that
 *      has no row in FLAG_SENTENCES must be in FLAGS_WITHOUT_SENTENCE with the reason the page needs nothing for it. A flag deleted after 14 clean days moves its row to ALWAYS_ON, where the sentence
 *      must be present and its code path must exist with no flag; a row left in FLAG_SENTENCES whose flag nothing in apps/api/src names any more fails (the names are read from the syntax tree, so a
 *      comment that still mentions a deleted flag does not keep it alive).
 *      A SENTENCE IS A LITERAL RUN OF THE PAGE'S SOURCE TEXT. The page is read as source (tags removed, entities and `{" "}` decoded, white space squeezed), not as a reader sees it: a `{expression}`
 *      stays as written and the output of a component is not there. So a pinned sentence must stop before any `{expression}` and must not contain a brace (a row that does is refused). A sentence
 *      typed as rendered (`up to 100 at a time` for the source `up to {MAX_REFERENCES} at a time`) is found by throughExpression and reported, whatever its flag says; that check is a heuristic (one
 *      expression, at least 8 characters of the sentence tying it on one side), so the rule above is the guard and this is the net. A sentence made only of component output cannot be pinned at all.
 *      `vars` is read the way scripts/integration.mjs reads wrangler.jsonc (a filter that drops whole-line comments only), so a trailing `//` comment on a line fails here first, with its line number.
 *
 *  (1) and (2) of the plan need the reading of a message, which no release has added yet: they are todo below.
 */

const API_SRC = fileURLToPath(new URL("./", import.meta.url));
const UNDERSTAND = join(API_SRC, "understand");
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
// the separator of this machine's paths (a backslash on Windows), taken from a path rather than declared
const SEP = join("a", "b").charAt(1);
// The entities a page may use, as the characters a reader sees (built from their numbers, so that no escape sequence has to be typed in this file).
const ENTITIES: Readonly<Record<string, number>> = { apos: 39, quot: 34, amp: 38, lt: 60, gt: 62, nbsp: 160, lsquo: 8216, rsquo: 8217, ldquo: 8220, rdquo: 8221, ndash: 8211, mdash: 8212, hellip: 8230 };
const decodeEntity = (whole: string, body: string): string => {
  const code = body.startsWith("#x") || body.startsWith("#X") ? parseInt(body.slice(2), 16) : body.startsWith("#") ? parseInt(body.slice(1), 10) : ENTITIES[body];
  return code === undefined || !Number.isInteger(code) || code > 0x10ffff ? whole : String.fromCodePoint(code);
};
// Everything from a "<" to the next ">" goes, scanned and not matched: the same text as replacing /<[^>]*>/ once, and a text that is only read here, never put on a page.
const stripTags = (s: string): string => {
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "<") {
      const close = s.indexOf(">", i);
      if (close < 0) return out + s.slice(i);
      i = close + 1;
    } else {
      out += s[i];
      i += 1;
    }
  }
  return out;
};
// The page's source as text, close to what a reader sees: tags go, the entities and {" "} turn into what they render, white space is one space. It is still the SOURCE: a {expression} stays as written and
// component output is not there, which is why a pinned sentence is a literal run of the source (see (4) in the header and throughExpression below).
const plain = (jsx: string) =>
  stripTags(jsx)
    .replace(/\{" "\}/g, " ")
    .replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, decodeEntity)
    .replace(/\s+/g, " ");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

// ---- the checks ----

type Module = { label: string; source: string; dir: string };
// a node of the tree that vite's parseAst returns (ESTree, plus TS nodes for types)
type Node = { type: string; start: number; end: number; [key: string]: any };
const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string";
const parse = (source: string): Node => parseAst(source, { lang: "ts" }) as unknown as Node;

/** The TypeScript nodes that hold code which runs (or, for a module and an enum, whose body does): `x as T`, `x!`, `<T>x`, a namespace, an enum, a constructor's `private f = fetch`, `export = x`, `import a = require()`. */
const TS_NODES_WITH_CODE = new Set([
  "TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSInstantiationExpression", "TSTypeAssertion",
  "TSModuleDeclaration", "TSModuleBlock", "TSEnumDeclaration", "TSEnumBody", "TSEnumMember",
  "TSParameterProperty", "TSExportAssignment", "TSImportEqualsDeclaration", "TSExternalModuleReference",
  "TSAbstractMethodDefinition", "TSAbstractPropertyDefinition", "TSAbstractAccessorProperty",
]);

/**
 * Visits every node that exists at run time. The rest of TypeScript (a type, an annotation, an interface) is not walked into, because `typeof fetch` in a type is not a call; only the nodes of
 * TS_NODES_WITH_CODE are. `intoTypes` walks into everything, for finding the names a source mentions.
 */
function walk(node: Node, parent: Node | null, key: string, visit: (n: Node, parent: Node | null, key: string) => void, intoTypes = false): void {
  if (!intoTypes && node.type.startsWith("TS") && !TS_NODES_WITH_CODE.has(node.type)) return;
  visit(node, parent, key);
  for (const [k, v] of Object.entries(node)) {
    if (Array.isArray(v)) {
      for (const item of v) if (isNode(item)) walk(item, node, k, visit, intoTypes);
    } else if (isNode(v)) walk(v, node, k, visit, intoTypes);
  }
}

const nameOf = (n: unknown): string | null => (isNode(n) && n.type === "Identifier" ? n.name : null);
/** The text of `"x"` or of a template with no placeholder, for `a["fetch"]`. */
const literalOf = (n: unknown): string | null => {
  if (isNode(n) && n.type === "Literal" && typeof n.value === "string") return n.value;
  if (isNode(n) && n.type === "TemplateLiteral" && n.expressions.length === 0) return n.quasis[0].value.cooked;
  return null;
};

/** The name a call is made through, with `(0, f)` and `(f)` seen through: `(0, eval)(t)` calls eval as surely as `eval(t)`. */
function calleeName(callee: unknown): string | null {
  if (isNode(callee) && callee.type === "ParenthesizedExpression") return calleeName(callee.expression);
  if (isNode(callee) && callee.type === "SequenceExpression") return calleeName(callee.expressions[callee.expressions.length - 1]);
  return nameOf(callee);
}

/** The rule a node breaks, by the header: a use of fetch, of the AI binding, of a dynamic import or require, or of another network client. */
function ruleBrokenBy(n: Node, parent: Node | null, key: string): string | null {
  if (n.type === "ImportExpression") return "a dynamic import";
  if (n.type === "CallExpression" && calleeName(n.callee) === "require") return "require";
  // code made from a string can name anything
  if ((n.type === "CallExpression" || n.type === "NewExpression") && calleeName(n.callee) === "Function") return "code built at run time";
  if (n.type === "MemberExpression") {
    const prop = n.computed ? literalOf(n.property) : nameOf(n.property);
    if (prop === "fetch") return "fetch";
    if (prop === "AI") return "the AI binding";
    return prop === "sendBeacon" ? "another network client" : null;
  }
  // const { AI } = env, const { fetch: f } = binding
  if (n.type === "Property" && parent?.type === "ObjectPattern" && !n.computed && ["AI", "fetch"].includes(nameOf(n.key) ?? "")) return nameOf(n.key) === "AI" ? "the AI binding" : "fetch";
  if (n.type === "Identifier") {
    // the name of an object key or a method being written is not a use of anything
    const keyOfDefinition = ["Property", "MethodDefinition", "PropertyDefinition", "TSAbstractMethodDefinition", "TSAbstractPropertyDefinition"].includes(parent?.type ?? "") && key === "key" && !parent?.computed && !parent?.shorthand;
    const enumMember = parent?.type === "TSEnumMember" && key === "id";
    const memberName = parent?.type === "MemberExpression" && key === "property" && !parent.computed; // judged with its MemberExpression
    if (keyOfDefinition || enumMember || memberName) return null;
    if (n.name === "fetch") return "fetch";
    if (n.name === "eval") return "code built at run time"; // a call, `(0, eval)(t)`, or eval handed on in a variable: all are eval
    if (["XMLHttpRequest", "WebSocket", "EventSource"].includes(n.name)) return "another network client";
  }
  return null;
}

/** Where in the source of a module a network client is used, by the rule in the header: one line of text for each place. */
function networkSites(source: string): string[] {
  const found = new Map<string, string>();
  walk(parse(source), null, "", (n, parent, key) => {
    const rule = ruleBrokenBy(n, parent, key);
    if (!rule) return;
    const line = source.slice(0, n.start).split("\n").length;
    found.set(`${rule}@${line}`, `${rule} at line ${line}: ${source.slice(n.start, n.end).replace(/\s+/g, " ").slice(0, 60)}`);
  });
  return [...found.values()];
}

/** The modules a source imports (`import`, `import a = require("x")` and `export ... from`, not the type-only ones, which are gone at run time), as written. */
function importsOf(source: string): string[] {
  const found: string[] = [];
  for (const n of parse(source).body as Node[]) {
    if (n.type === "TSImportEqualsDeclaration") {
      if (n.moduleReference?.type === "TSExternalModuleReference" && n.importKind !== "type") found.push(n.moduleReference.expression.value);
      continue;
    }
    const typeOnlyImport = n.type === "ImportDeclaration" && (n.importKind === "type" || (n.specifiers.length > 0 && n.specifiers.every((s: Node) => s.importKind === "type")));
    const fromElsewhere = n.type === "ImportDeclaration" || ((n.type === "ExportNamedDeclaration" || n.type === "ExportAllDeclaration") && n.source !== null && n.exportKind !== "type");
    if (fromElsewhere && !typeOnlyImport) found.push(n.source.value);
  }
  return found;
}

/** The file a relative import names, or null. */
function fileOf(fromDir: string, specifier: string): string | null {
  const base = resolve(fromDir, specifier);
  for (const candidate of [base, `${base}.ts`, join(base, "index.ts")]) if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return null;
}

/** A module that understand/ imports from outside itself, and what it imports through relative paths, searched for the same sites. `chain` is how it was reached. */
function followed(file: string, chain: string, seen: Set<string>): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const here = `${chain} -> ${relative(API_SRC, file).split(SEP).join("/")}`;
  const source = readFileSync(file, "utf8");
  const problems = networkSites(source).map((s) => `${here}: ${s}`);
  for (const specifier of importsOf(source)) {
    if (specifier === "@scholar/shared") continue;
    if (!specifier.startsWith(".")) {
      // a package is not followed, so a network client could sit behind it: it is refused as it is in understand/ itself
      problems.push(`${here}: imports "${specifier}", which is allowed in understand/ only as @scholar/shared, a sibling, or a pure module of apps/api/src (a module reached from understand/ is held to the same rule)`);
      continue;
    }
    const next = fileOf(dirname(file), specifier);
    if (next) problems.push(...followed(next, here, seen));
  }
  return problems;
}

/** What is wrong with a module of understand/ by the import rule and the site rule, with what it imports followed. */
function understandProblems(m: Module): string[] {
  const problems = networkSites(m.source).map((s) => `${m.label}: ${s}`);
  const seen = new Set<string>();
  for (const specifier of importsOf(m.source)) {
    if (specifier === "@scholar/shared") continue;
    if (!specifier.startsWith(".")) {
      problems.push(`${m.label}: imports "${specifier}", which is allowed in understand/ only as @scholar/shared, a sibling, or a pure module of apps/api/src`);
      continue;
    }
    const file = fileOf(m.dir, specifier);
    if (!file) problems.push(`${m.label}: imports "${specifier}", which does not exist`);
    else if (!file.startsWith(UNDERSTAND + SEP)) problems.push(...followed(file, m.label, seen)); // a sibling is checked on its own
  }
  return problems;
}

/** A normal message with an address, a link and a number in it, an empty one, and one of 20 000 characters: the three kinds of input a message can be. */
const PLAIN_STRINGS = ["Help me, please? Papers on diabetes in India: https://example.org/a?b=1 someone@example.org +91 98765 43210", "", "x".repeat(20_000)];

/** How long the trap stays in place after the last call has returned, for a call a function scheduled for later (a short timer). A later call than that is not seen: the header says so. */
const SETTLE_MS = 20;

/** Calls what a module exports with plain strings, with fetch and the AI binding trapped, the module loaded inside the trap too. `touched` is what was called; `ran` the functions that returned under some call. */
async function touchedBy(load: () => Promise<Record<string, unknown>> | Record<string, unknown>): Promise<{ touched: string[]; ran: string[] }> {
  const touched = new Set<string>();
  const ran = new Set<string>();
  const trap = (what: string) => (): never => {
    touched.add(what);
    throw new Error(`${what} was called`);
  };
  // any call on the binding is recorded and throws; `then` is left alone so that handing the env to an async function does not trap it
  const ai = new Proxy({}, { get: (_target, prop) => (typeof prop === "string" && prop !== "then" ? trap(`env.AI.${prop}`) : undefined) });
  const env = { AI: ai };
  // put in place before the module is loaded and kept until a moment after the last call, so that a call made while loading, or scheduled for just after a function returns, is trapped too
  const saved = (globalThis as { fetch: unknown }).fetch;
  (globalThis as { fetch: unknown }).fetch = trap("fetch");
  try {
    let exported: Record<string, unknown> = {};
    try {
      exported = await load();
    } catch (error) {
      // a module that throws because its top level called the trap is reported as having touched it, not as an opaque failure; any other error is the module's own
      if (touched.size === 0) throw error;
    }
    for (const [name, fn] of Object.entries(exported)) {
      if (typeof fn !== "function" || /^class\b/.test(Function.prototype.toString.call(fn))) continue;
      for (const text of PLAIN_STRINGS) {
        for (const args of [[text], [text, text], [env, text], [text, env]]) {
          try {
            await fn(...args);
            ran.add(name);
          } catch {
            // a function that wants more than a string throws; what it touched is in `touched` either way
          }
        }
      }
    }
    await new Promise((settled) => setTimeout(settled, SETTLE_MS));
  } finally {
    (globalThis as { fetch: unknown }).fetch = saved;
  }
  return { touched: [...touched], ran: [...ran] };
}

type FlagSentence = { flag: string; sentence: string; /** the positions of the flag at which the sentence must be on the page (`shadow` too for a flag whose shadow already sends or keeps something new) */ at: readonly ("shadow" | "core" | "beta" | "on")[] };
type AlwaysOn = { sentence: string; /** the code that makes it true now that no flag guards it: a file of the repository and a piece of text that must be in it */ codePath: { file: string; contains: string } };
type Disclosure = {
  page: string;
  vars: Record<string, unknown>;
  flagSentences: readonly FlagSentence[];
  /** flag -> why the privacy page needs no new sentence for it */
  noSentence: Readonly<Record<string, string>>;
  alwaysOn: readonly AlwaysOn[];
  sources: readonly string[];
  codeFile: (file: string) => string | null;
};

/**
 * The names a source mentions in code, as whole words: identifiers (a type included), and the words inside its strings and templates (a flag is read as `env.CHAT_X` or named in `flagOf(env, "CHAT_X")`).
 * A comment is not code and is not read: a deleted flag leaves its comments behind, and they must not make it look alive.
 */
function namesIn(source: string): string[] {
  const found: string[] = [];
  const words = (text: unknown) => {
    if (typeof text === "string") found.push(...(text.match(/[A-Za-z0-9_]+/g) ?? []));
  };
  walk(
    parse(source),
    null,
    "",
    (n) => {
      if (n.type === "Identifier") found.push(n.name);
      else if (n.type === "Literal") words(n.value);
      else if (n.type === "TemplateElement") words(n.value.cooked);
    },
    true,
  );
  return found;
}

/**
 * True when the sentence is on the page only because a {expression} stands for some text: the source says "up to {MAX_REFERENCES} at a time", a reader sees "up to 100 at a time", and the sentence
 * was typed as the reader sees it. The page is read as source, so that sentence is never found, and for a flag that is off nothing would say so. Found by cutting the page at its expressions and
 * asking whether the sentence starts at the end of one piece and carries on at the start of the next, with at least MIN characters of the sentence tying it on one side. One expression only.
 */
function throughExpression(page: string, sentence: string): boolean {
  const MIN = 8;
  const pieces = page.split(/\{[^{}]*\}/);
  for (let i = 0; i + 1 < pieces.length; i++) {
    for (let k = 0; k < sentence.length; k++) {
      if (k > 0 && k < MIN) continue;
      if (!pieces[i]!.endsWith(sentence.slice(0, k))) continue;
      for (let m = k + 1; m <= sentence.length; m++) {
        if ((k >= MIN || sentence.length - m >= MIN) && pieces[i + 1]!.startsWith(sentence.slice(m))) return true;
      }
    }
  }
  return false;
}

/** Every way the page, the committed vars and the tables can disagree, one line each; none when they agree. */
function disclosureProblems(i: Disclosure): string[] {
  const problems: string[] = [];
  const page = squash(i.page);
  // the names the code uses, as whole words (CHAT_RESOLVER is not CHAT_RESOLVER_CLASSES); read only when there is a row to check
  const names = new Set<string>(i.flagSentences.length === 0 ? [] : i.sources.flatMap(namesIn));
  // a sentence is pinned as a literal run of the page's source: a brace in it cannot be (nobody reads one on the page), and one typed as rendered can only be found by luck
  const unpinnable = (who: string, sentence: string): string | null =>
    /[{}]/.test(sentence)
      ? `${who}: the sentence has a "{" or a "}" in it; pin a literal run of the page's source text, which stops before any {expression}: "${sentence}"`
      : !page.includes(sentence) && throughExpression(page, sentence)
        ? `${who}: the sentence is on the page only through a JSX expression (the source has a {...} where a reader sees words), so it can never be found as typed; pin the literal run of source text before or after it: "${sentence}"`
        : null;
  for (const row of i.flagSentences) {
    const sentence = squash(row.sentence);
    if (sentence === "") {
      problems.push(`${row.flag}: empty sentence (it would count as on the page everywhere)`);
      continue;
    }
    const unpinned = unpinnable(row.flag, sentence);
    if (unpinned) problems.push(unpinned);
    const value = i.vars[row.flag];
    const { position } = positionOfVariable(value, row.at.includes("core"), false, row.at.includes("beta"));
    const flagOn = (row.at as readonly string[]).includes(position);
    const present = page.includes(sentence);
    const needs = `needs ${row.at.join(" or ")}; vars has ${value === undefined ? "nothing" : JSON.stringify(value)}`;
    if (present && !flagOn) problems.push(`${row.flag}: the sentence is on the page but the flag is not on (${needs}): "${sentence}"`);
    if (!present && flagOn) problems.push(`${row.flag}: the flag is on but the sentence is not on the page (${needs}): "${sentence}"`);
    if (!names.has(row.flag)) problems.push(`${row.flag}: nothing in apps/api/src names this flag any more; if the flag was deleted, move the sentence to ALWAYS_ON: "${sentence}"`);
  }
  for (const row of i.alwaysOn) {
    const sentence = squash(row.sentence);
    const { file, contains } = row.codePath;
    if (sentence === "") problems.push(`always on: empty sentence (code path ${file})`);
    else {
      const unpinned = unpinnable("always on", sentence);
      if (unpinned) problems.push(unpinned);
      if (!page.includes(sentence)) problems.push(`always on: the sentence is not on the page: "${sentence}"`);
    }
    if (i.flagSentences.some((f) => squash(f.sentence) === sentence)) problems.push(`"${sentence}" is in both FLAG_SENTENCES and ALWAYS_ON`);
    const code = i.codeFile(file);
    if (code === null) problems.push(`always on: the file ${file} does not exist (the code path of "${sentence}")`);
    else if (!code.includes(contains)) problems.push(`always on: ${file} does not contain "${contains}" (the code path of "${sentence}")`);
  }
  // a flag that is on needs a decision about the page: a sentence, or a reason it needs none
  for (const [flag, reason] of Object.entries(i.noSentence)) {
    if (reason.trim() === "") problems.push(`${flag}: empty reason in FLAGS_WITHOUT_SENTENCE (say why the page needs no sentence for this flag)`);
    if (i.flagSentences.some((f) => f.flag === flag)) problems.push(`${flag}: is in both FLAG_SENTENCES and FLAGS_WITHOUT_SENTENCE`);
  }
  const decided = new Set([...i.flagSentences.map((f) => f.flag), ...Object.keys(i.noSentence)]);
  for (const [name, value] of Object.entries(i.vars)) {
    const { position, bad } = positionOfVariable(value, true, true, true);
    if (!bad && (position === "on" || position === "core" || position === "beta") && !decided.has(name)) {
      problems.push(`${name}: the committed vars has it at ${position}, and there is no row for it: add one to FLAG_SENTENCES (the sentence the page gets) or to FLAGS_WITHOUT_SENTENCE (why it needs none)`);
    }
  }
  return problems;
}

const BACKSLASH = String.fromCharCode(92);

/** The line numbers (from 1) of lines that carry a `//` comment after something, outside a string: the lines scripts/integration.mjs cannot read. Whole-line comments are fine. */
function trailingCommentLines(text: string): number[] {
  const found: number[] = [];
  text.split("\n").forEach((line, index) => {
    if (/^\s*\/\//.test(line)) return;
    let inString = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (inString) {
        if (ch === BACKSLASH) j++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === "/" && line[j + 1] === "/") {
        found.push(index + 1);
        return;
      }
    }
  });
  return found;
}

/** The `vars` block of wrangler.jsonc, read the way scripts/integration.mjs reads the file (lines 24-25: a filter that drops whole-line comments, then JSON.parse). Throws, naming the lines, on a trailing comment. */
function readVars(text: string): Record<string, unknown> {
  const trailing = trailingCommentLines(text);
  if (trailing.length > 0) {
    throw new Error(`wrangler.jsonc has a trailing // comment on line ${trailing.join(" and line ")}: scripts/integration.mjs drops only whole-line comments, so it could not parse the file and no local suite would start. Move the comment to a line of its own.`);
  }
  const cfg = JSON.parse(text.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n")) as { vars?: Record<string, unknown> };
  return cfg.vars ?? {};
}

// ---- end of the checks ----

/** One row per privacy sentence of a release: a literal run of the page's source text (as plain text, in one line), stopping before any {expression} (see (4) in the header). Empty until the first release writes its text (10.1). */
const FLAG_SENTENCES: readonly FlagSentence[] = [
  // M4/M5 (design PDF "Sodhsetu understanding, follow-ups and MCP"): with CHAT_UNDERSTAND at shadow or on, the page sends the turn ledger (replies and paper titles leave the browser) and counts are kept, so the
  // sentence is needed from shadow on. Written on 6 Nov 2026 and NOT on the page yet: it waits for the owner's read, and the privacy version moves with it.
  {
    flag: "CHAT_UNDERSTAND",
    sentence:
      "When you write in Auto, your browser also sends a short record of the earlier turns of the same chat (your earlier messages, the first 300 characters of each reply and the titles of the papers it listed), so that a message like “the second paper” or “only after 2020” can be understood. It goes only to the AI model run by Cloudflare (Workers AI), it is not kept, nothing from another chat is ever in it, and of how a message was understood we keep only counts, never your words.",
    at: ["shadow", "on"],
  },
  // M5: a visitor's Auto message is read by the private model too, with a daily cap kept under a one-way code of the day and the address (migration 0027). Waits for the owner's read.
  {
    flag: "CHAT_UNDERSTAND_VISITORS",
    sentence:
      "Even when you are not signed in, a message you write in Auto is sent to the AI model run by Cloudflare (Workers AI) so that it can be understood; it is not kept and not used for training. To limit how often this happens, we count these messages for the day under a one-way code made from your internet address and the date, which is deleted after two days.",
    at: ["on"],
  },
  // CHAT_TOOLS (docs/design/chat-tools.md, the owner's request of 9 Nov 2026): tools run in the reply. Written on 9 Nov 2026 and NOT on the page yet: it waits for the owner's read, and the privacy version
  // moves with it (the commit that sets "CHAT_TOOLS": "on" puts it under "Your papers and ideas").
  {
    flag: "CHAT_TOOLS",
    at: ["on"],
    sentence:
      "In Auto, when your message is a list of references, DOIs with a question about retraction, or a question about one paper of the conversation or one of your own papers, the tool runs in the reply itself instead of being offered: references are checked at Crossref and OpenAlex and DOIs at Crossref, exactly as on Check references; a question about a paper of the conversation is answered as Ask this paper answers it (only when you are signed in, and it counts against your daily AI allowance and the papers read for you each day); and a question about one of your own papers is answered as on that paper's page and kept with that paper's questions. Idea Check and the literature scan still start only when you choose them. A verdict (never your text) is kept for up to a day, and of the conversation we keep only counts of which tool ran.",
  },
  // The MCP server (src/mcp, docs "Sodhsetu understanding, follow-ups and MCP (design)", page 13). The sentence is written and waits for the owner's read: the commit that sets "MCP" to "beta"
  // or "on" in wrangler.jsonc puts it on the privacy page (under "What we send where") with the next PRIVACY_VERSION, and this row then holds the two together.
  {
    flag: "MCP",
    at: ["beta", "on"],
    sentence:
      "If you connect an AI app (such as Claude or ChatGPT) to your Sodhsetu account, what it sends to Sodhsetu's tools (a search, a list of references, DOIs, a question about a paper, a claim to check) is handled exactly as on this website: a search goes to the public indexes named above, references are checked at Crossref and OpenAlex and DOIs at Crossref, a question about a paper or a claim to check is sent with the paper's text to the AI model run by Cloudflare (Workers AI) and counts against your daily AI allowance, a verdict (never your text) is kept for up to a day, and we keep only counts: which tool was used, by which app, how long it took and whether it worked. An app you allow to use your library can see the papers you saved and save a paper you agreed to save. What the app does with the answers is up to that app and its own privacy terms. You can disconnect an app at any time in Settings, under Connected apps.",
  },
];
/** Flags that are on in the committed config and need no sentence on the page, each with the reason (nothing new is sent, kept or shown that the page does not already say). Empty until a release has one. */
const FLAGS_WITHOUT_SENTENCE: Readonly<Record<string, string>> = {};
/** Rows that have lost their flag after 14 clean days on: the sentence and the code that makes it true. Releases with no flag (R6b, T1) start here. */
const ALWAYS_ON: readonly AlwaysOn[] = [];

/** The modules of a folder at any depth (code files that are not tests or declarations), as paths relative to it with `/`, sorted. A file of a kind the checks cannot read is listed all the same, so it fails loudly. */
const listModules = (dir: string): string[] =>
  (readdirSync(dir, { recursive: true }) as string[])
    .map((f) => f.split(SEP).join("/"))
    .filter((f) => /\.[cm]?[jt]sx?$/.test(f) && !/\.test\.[cm]?[jt]sx?$/.test(f) && !f.endsWith(".d.ts"))
    .sort();
const understandFiles = (): string[] => listModules(UNDERSTAND);
/** Modules of understand/ that export no function a string can call, with the reason: a module that runs nothing is then a decision made here, and not a hole in the run-time check. */
const NO_FUNCTION_TO_CALL: Readonly<Record<string, string>> = {
  "hostile-messages.ts": "exports a list of messages and a canary string, no function",
  "lane-words.ts": "exports the phrase lists of the safety lane as data, no function (lane.ts, which reads them, is run here)",
  "frame-words.ts": "exports the word lists of the request-frame cleaner (R8) as data, no function (frame.ts, which reads them, is run here through cleanRequest)",
};
const moduleOf = (file: string): Module => ({ label: `understand/${file}`, source: readFileSync(join(UNDERSTAND, file), "utf8"), dir: dirname(join(UNDERSTAND, file)) });
/** A folder under node_modules/.cache (which git ignores, and which needs no Node type that this project does not declare) holding the given files; a name with a slash makes its folders. The caller removes it. */
function tempFolder(files: Record<string, string>): { dir: string; remove: () => void } {
  const cache = join(API_SRC, "..", "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(join(cache, "legal-match-"));
  for (const [name, text] of Object.entries(files)) {
    const file = join(dir, ...name.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}
// a module that is not saved in understand/: its source and where it would sit, so that its relative imports resolve
const fixture = (source: string, label = "fixture.ts"): Module => ({ label, source, dir: UNDERSTAND });

describe("(3) no module of understand/ imports a network client", () => {
  const files = understandFiles();

  it("finds the modules to check by listing the folder, so a module added later is covered with no edit here", () => {
    // read a second way (a walk of the folder entry by entry): a listing that dropped a module would differ from it
    const walkAgain = (dir: string, prefix = ""): string[] =>
      readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walkAgain(join(dir, name), prefix + name + "/") : [prefix + name]));
    const second = walkAgain(UNDERSTAND).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts")).sort();
    expect(files).toEqual(second);
    expect(files).toContain("flags.ts");
    // nothing in the folder is a kind of file this check cannot read
    expect(files.filter((f) => !f.endsWith(".ts"))).toEqual([]);
  });

  it("the listing takes every module at any depth and leaves out tests, declarations and files that are not code (proved on a folder it did not see before)", () => {
    const t = tempFolder({ "a.ts": "", "sub/b.ts": "", "sub/deep/c.ts": "", "d.test.ts": "", "sub/e.test.ts": "", "f.d.ts": "", "g.json": "{}", "h.md": "", "j.mjs": "" });
    try {
      expect(listModules(t.dir)).toEqual(["a.ts", "j.mjs", "sub/b.ts", "sub/deep/c.ts"]);
    } finally {
      t.remove();
    }
  });

  it.each(files)("understand/%s: no fetch, no AI binding, and every import is allowed", (file) => {
    expect(understandProblems(moduleOf(file))).toEqual([]);
  });

  // loaded afresh (resetModules), inside the trap, so that what runs when the module is imported is seen too
  const loadAfresh = (file: string) => async (): Promise<Record<string, unknown>> => {
    vi.resetModules();
    return (await import(/* @vite-ignore */ new URL(`./understand/${file}`, import.meta.url).href)) as Record<string, unknown>;
  };

  it.each(files)("understand/%s, loaded and called with plain strings while fetch and the AI binding throw, touches neither, and really ran a function (or is listed as having none)", async (file) => {
    const { touched, ran } = await touchedBy(loadAfresh(file));
    expect(touched).toEqual([]);
    const why = NO_FUNCTION_TO_CALL[file];
    if (why === undefined) expect(ran, `${file} ran no function on plain strings, so its run-time check is empty: if it has none a string can call, add it to NO_FUNCTION_TO_CALL with the reason`).not.toEqual([]);
    else expect(ran, `${file} is in NO_FUNCTION_TO_CALL ("${why}") but a function of it ran: take it out of the table`).toEqual([]);
  });

  it("NO_FUNCTION_TO_CALL names only modules that are in the folder", () => {
    for (const file of Object.keys(NO_FUNCTION_TO_CALL)) expect(files, file).toContain(file);
  });

  it("really calls what flags.ts exports (the run-time check is not empty: flagOf takes the env and a name, as strings, and runs)", async () => {
    const { touched, ran } = await touchedBy(loadAfresh("flags.ts"));
    expect(touched).toEqual([]);
    expect(ran).toEqual(expect.arrayContaining(["flagOf", "positionOfVariable", "flagKey"]));
  });
});

describe("the network check catches a module that is not clean (fixtures: sources held in strings, never saved in understand/)", () => {
  const src = (...lines: string[]) => lines.join("\n");

  it.each([
    ["a global fetch call", src("export async function q(text: string) {", '  return fetch("https://api.example.org/?q=" + text);', "}"), "fetch"],
    ["a fetch held in a variable", src("const f = globalThis.fetch;", "export const q = (t: string) => f(t);"), "fetch"],
    ["fetch as a property of a binding", src("export const q = (env: { ASSETS: { fetch(u: string): Promise<Response> } }, t: string) => env.ASSETS.fetch(t);"), "fetch"],
    ["env.AI.run", src("export async function q(env: { AI: Ai }, t: string) {", '  return env.AI.run("@cf/meta/model", { prompt: t });', "}"), "AI binding"],
    ["the AI binding taken out of the env", src("export function q(env: object, t: string) {", "  const { AI } = env as { AI: Ai };", "  return AI;", "}"), "AI binding"],
    ["the AI binding by name", src('export const q = (env: Record<string, unknown>) => env["AI"];'), "AI binding"],
    ["a dynamic import", src('export const q = () => import("../search/crossref");'), "dynamic import"],
    ["require", src('const x = require("node:https");', "export const q = x;"), "require"],
    ["eval", src("export const q = (t: string) => eval(t);"), "code built at run time"],
    ["new Function", src("export const q = (t: string) => new Function(t)();"), "code built at run time"],
    ["a WebSocket", src("export const q = (u: string) => new WebSocket(u);"), "another network client"],
    // TypeScript's own nodes that hold code that runs: skipping every node whose name starts with TS would not see these
    ["a namespace body", src("namespace N {", '  export const r = fetch("https://x.invalid");', "}"), "fetch"],
    ["an enum initializer", src('enum E { A = String(fetch("https://x.invalid")) }'), "fetch"],
    ["a parameter property's default", src("export class C {", "  constructor(private f = fetch) {}", "}"), "fetch"],
    ["export =", src("export = fetch;"), "fetch"],
    ["an indirect eval, (0, eval)", src("export const q = (t: string) => (0, eval)(t);"), "code built at run time"],
    ["eval held in a variable", src("const e = eval;", "export const q = (t: string) => e(t);"), "code built at run time"],
    ["an indirect Function, (0, Function)", src('export const q = (t: string) => (0, Function)("return " + t)();'), "code built at run time"],
    ["a call inside a cast and a non-null assertion", src("export const q = (t: string) => (fetch as unknown as (u: string) => Promise<Response>)(t)!;"), "fetch"],
  ])("static: %s", (_name, source, rule) => {
    const problems = understandProblems(fixture(source));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join("\n")).toContain(rule);
  });

  // the third column is the module the problem names, the fourth the rule it says was broken: a package is refused for being a package, a missing module is named as missing, a network module for its call
  const NOT_ALLOWED = "allowed in understand/ only as";
  it.each([
    ["a provider module of ../search/ that calls fetch", 'import { searchOpenAlex } from "../search/openalex";\nexport const q = searchOpenAlex;', "search/openalex", "fetch at line"],
    ["a module that uses env.AI", 'import { providersFor } from "../llm";\nexport const q = providersFor;', "llm/", "the AI binding at line"],
    ["a package", 'import { Hono } from "hono";\nexport const q = Hono;', "hono", NOT_ALLOWED],
    ["a node module", 'import { createHash } from "node:crypto";\nexport const q = createHash;', "node:crypto", NOT_ALLOWED],
    ["a cloudflare module", 'import { DurableObject } from "cloudflare:workers";\nexport const q = DurableObject;', "cloudflare:workers", NOT_ALLOWED],
    ["a package by import = require", 'import https = require("node:https");\nexport const q = https;', "node:https", NOT_ALLOWED],
    ["a side-effect import of a network module", 'import "../search/crossref";', "search/crossref", "at line"],
    ["an export from a network module", 'export { searchOpenAlex } from "../search/openalex";', "search/openalex", "fetch at line"],
    ["a module that does not exist", 'import { x } from "../search/no-such-module";\nexport const q = x;', "no-such-module", "does not exist"],
  ])("static, by what it imports: %s", (_name, source, mention, rule) => {
    const problems = understandProblems(fixture(source)).join("\n");
    expect(problems).toContain(mention);
    expect(problems).toContain(rule);
    // a missing module is only that: it is not also called a package
    if (rule === "does not exist") expect(problems).not.toContain(NOT_ALLOWED);
  });

  it("a module reached through a relative import is held to the same import rule: a package it imports is refused, so a network client behind it cannot hide (a type-only import and @scholar/shared are fine)", () => {
    const t = tempFolder({
      "uses-package.ts": 'import { get } from "some-http-client";\nexport const h = get;',
      "uses-node.ts": 'import { request } from "node:https";\nexport const h = request;',
      "types-and-shared.ts": 'import type { Hono } from "hono";\nimport { PRIVACY_VERSION } from "@scholar/shared";\nexport const h = (x: Hono | null) => PRIVACY_VERSION + String(x);',
      "chain.ts": 'import { h } from "./uses-package";\nexport const c = h;',
    });
    try {
      const through = (target: string): Module => ({ label: "fixture.ts", source: `import { h } from "${target}";\nexport const q = h;`, dir: t.dir });
      expect(understandProblems(through("./uses-package")).join("\n")).toContain('imports "some-http-client"');
      expect(understandProblems(through("./uses-node")).join("\n")).toContain('imports "node:https"');
      expect(understandProblems(through("./chain")).join("\n")).toContain('imports "some-http-client"');
      expect(understandProblems(through("./types-and-shared"))).toEqual([]);
    } finally {
      t.remove();
    }
  });

  it("lets through what is clean: comments, strings and types that name fetch or env.AI, a type-only import, a pure module outside the folder, a sibling and @scholar/shared", () => {
    const clean = src(
      "// never calls fetch() and never reads env.AI: a comment is not a call",
      "/* fetch(url) and env.AI.run( in a block comment */",
      'import type { Ai } from "@cloudflare/workers-types";',
      "type Fetcher = { fetch: typeof fetch; AI?: Ai };",
      'import { normalizeTitle } from "../search/normalize";',
      'import { positionOfVariable } from "./flags";',
      'import { PRIVACY_VERSION } from "@scholar/shared";',
      'const url = "https://example.org/a//b"; const text = "x";',
      "export function shape(text: string, env?: Fetcher) { return env ? 1 : normalizeTitle(text) + url + PRIVACY_VERSION + positionOfVariable(text, false).position; }",
    );
    expect(understandProblems(fixture(clean))).toEqual([]);
  });

  it("lets through the TypeScript that only names things: an ambient namespace and module, an enum member and an abstract method called fetch, a type of typeof fetch", () => {
    const clean = src(
      "declare namespace Ambient { type F = typeof fetch; const x: { AI: Ai } }",
      'declare module "somewhere" { export function fetch(): void }',
      "enum E { fetch = 1, AI = 2 }",
      "abstract class A { abstract fetch(): void; abstract AI: string }",
      "namespace Plain { export const n = 1 }",
      "export const q = (e: E, a: A, p: typeof Plain.n) => [e, a, p];",
    );
    expect(understandProblems(fixture(clean))).toEqual([]);
  });

  it("is not fooled by a `//` inside a string in front of a call (comments are removed by a real parser, not by a line filter)", () => {
    const problems = understandProblems(fixture('const base = "https://example.org"; export const q = () => fetch(base);'));
    expect(problems.join("\n")).toContain("fetch");
  });

  it("run time: a call to the global fetch is recorded", async () => {
    const { touched } = await touchedBy(() => fixtureExports('return { search(text) { return fetch("https://api.example.org/?q=" + text); } };'));
    expect(touched).toEqual(["fetch"]);
  });

  it("run time: a call whose error the module swallows is recorded all the same", async () => {
    const { touched } = await touchedBy(() => fixtureExports('return { search(text) { try { fetch("https://api.example.org/?q=" + text); } catch (e) { return null; } return text; } };'));
    expect(touched).toEqual(["fetch"]);
  });

  it("run time: a call on the AI binding of an env that is handed in is recorded", async () => {
    const { touched } = await touchedBy(() => fixtureExports('return { read(env, text) { return env.AI.run("@cf/meta/model", { prompt: text }); } };'));
    expect(touched).toEqual(["env.AI.run"]);
  });

  it("run time: a call that happens only after an await is recorded too", async () => {
    const { touched } = await touchedBy(() => fixtureExports('return { async search(text) { await Promise.resolve(); return fetch("https://api.example.org/?q=" + text); } };'));
    expect(touched).toEqual(["fetch"]);
  });

  // The real fetch is stood in for by a spy here, to see that a trap which is too late or too early lets a call through to it. The fixtures ask for a data: address, which needs no network even if a broken check let one through.
  const withSpyForRealFetch = async (run: (real: ReturnType<typeof vi.fn>) => Promise<void>) => {
    const real = vi.fn();
    const saved = (globalThis as { fetch: unknown }).fetch;
    (globalThis as { fetch: unknown }).fetch = real;
    try {
      await run(real);
    } finally {
      (globalThis as { fetch: unknown }).fetch = saved;
    }
  };

  it("run time: a call made while the module is being loaded, before any function is called, is recorded, and the real fetch is not reached", async () => {
    await withSpyForRealFetch(async (real) => {
      const { touched, ran } = await touchedBy(() => fixtureExports('try { fetch("data:text/plain,toplevel"); } catch (e) {} return { a() { return 1; } };'));
      expect(touched).toEqual(["fetch"]);
      expect(ran).toEqual(["a"]);
      expect(real).not.toHaveBeenCalled();
    });
  });

  it("run time: a module whose top level calls fetch and does not catch the error is reported as having touched it, and the real fetch is not reached", async () => {
    await withSpyForRealFetch(async (real) => {
      const { touched } = await touchedBy(() => fixtureExports('fetch("data:text/plain,toplevel"); return { a() { return 1; } };'));
      expect(touched).toEqual(["fetch"]);
      expect(real).not.toHaveBeenCalled();
    });
  });

  it("run time: a call scheduled for after the function has returned (a short timer) is recorded, and the real fetch is not reached", async () => {
    await withSpyForRealFetch(async (real) => {
      const { touched } = await touchedBy(() => fixtureExports('return { q(text) { setTimeout(() => { try { fetch("data:text/plain,later"); } catch (e) {} }, 5); return text; } };'));
      expect(touched).toEqual(["fetch"]);
      expect(real).not.toHaveBeenCalled();
    });
  });

  it("run time: a clean module is not blamed, and says which functions it ran and which it could not (one that needs a structured argument)", async () => {
    const { touched, ran } = await touchedBy(() => fixtureExports("return { shape(text) { return text.trim().toLowerCase(); }, needsAReading(reading) { return reading.words.length; } };"));
    expect(touched).toEqual([]);
    expect(ran).toEqual(["shape"]);
  });

  it("run time: fetch is put back afterwards, even when loading the module throws", async () => {
    const before = globalThis.fetch;
    await touchedBy(() => fixtureExports("return { a() { return 1; } };"));
    expect(globalThis.fetch).toBe(before);
    await expect(touchedBy(() => fixtureExports('throw new Error("no module");'))).rejects.toThrow("no module");
    expect(globalThis.fetch).toBe(before);
  });
});

/** The functions a source evaluates to, for a module that is only a string. */
function fixtureExports(body: string): Record<string, unknown> {
  return new Function(body)() as Record<string, unknown>;
}

describe("(4) the disclosure match: each privacy sentence is on the page exactly when its flag is on in the committed config", () => {
  // read inside each test, so that a trailing comment fails the test that names it and not the whole file
  const committedVars = () => readVars(read("../wrangler.jsonc"));

  const sources = (readdirSync(API_SRC, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts") && !f.includes("node_modules"))
    .map((f) => readFileSync(join(API_SRC, f), "utf8"));
  const codeFile = (file: string): string | null => (existsSync(join(REPO, file)) ? readFileSync(join(REPO, file), "utf8") : null);

  it("the reader of names can read every source file of apps/api/src, so that the first row added to a table does not meet a file it cannot parse", () => {
    expect(sources.length).toBeGreaterThan(100);
    for (const source of sources) expect(Array.isArray(namesIn(source))).toBe(true);
  });

  it("holds for the page, the committed vars block and the tables as they are", () => {
    const page = plain(read("../../web/src/components/legal/LegalPages.tsx"));
    expect(disclosureProblems({ page, vars: committedVars(), flagSentences: FLAG_SENTENCES, noSentence: FLAGS_WITHOUT_SENTENCE, alwaysOn: ALWAYS_ON, sources, codeFile })).toEqual([]);
  });

  describe("the logic, on fixtures", () => {
    const SENTENCE = "A message that describes an emergency is answered by the page itself and sent nowhere.";
    const base = (over: Partial<Disclosure>): Disclosure => ({
      page: `Intro. ${SENTENCE} Outro.`,
      vars: {},
      flagSentences: [{ flag: "CHAT_FIXTURE", sentence: SENTENCE, at: ["on"] }],
      noSentence: {},
      alwaysOn: [],
      sources: ['const p = await flagOf(env, "CHAT_FIXTURE");'],
      codeFile: () => null,
      ...over,
    });

    it("fails when the sentence is on the page and its flag is not on (shadow, off, unset, a bad value, core where the flag has none)", () => {
      for (const v of [{ CHAT_FIXTURE: "shadow" }, { CHAT_FIXTURE: "off" }, {}, { CHAT_FIXTURE: "ON" }, { CHAT_FIXTURE: "core" }]) {
        const problems = disclosureProblems(base({ vars: v }));
        expect(problems, JSON.stringify(v)).toHaveLength(1);
        expect(problems[0]).toMatch(/CHAT_FIXTURE: the sentence is on the page but the flag is not on/);
      }
    });

    it("fails when the flag is on and its sentence is not on the page", () => {
      const problems = disclosureProblems(base({ vars: { CHAT_FIXTURE: "on" }, page: "Intro. Outro." }));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/CHAT_FIXTURE: the flag is on but the sentence is not on the page/);
    });

    it("passes when the page and the flag agree: on with the sentence, and not on without it", () => {
      expect(disclosureProblems(base({ vars: { CHAT_FIXTURE: "on" } }))).toEqual([]);
      for (const v of [{ CHAT_FIXTURE: "shadow" }, { CHAT_FIXTURE: "off" }, {}]) expect(disclosureProblems(base({ vars: v, page: "Intro. Outro." }))).toEqual([]);
    });

    it("finds a sentence whatever the white space of the page or the table, and does not find a sentence that is only part of one", () => {
      expect(disclosureProblems(base({ vars: { CHAT_FIXTURE: "on" }, page: "Intro.   A message that describes  an emergency is answered by the page itself and sent nowhere.  Outro." }))).toEqual([]);
      expect(disclosureProblems(base({ vars: { CHAT_FIXTURE: "on" }, flagSentences: [{ flag: "CHAT_FIXTURE", sentence: "A message that describes an emergency  is answered by the page\n itself and sent nowhere.", at: ["on"] }] }))).toEqual([]);
      expect(disclosureProblems(base({ vars: { CHAT_FIXTURE: "on" }, page: "Intro. A message that describes an emergency is answered by the page. Outro." })).join()).toMatch(/flag is on but the sentence is not on the page/);
    });

    it("for the safety lane the sentence is there at core and at on, and at no other position", () => {
      const row = { flagSentences: [{ flag: "CHAT_FIXTURE", sentence: SENTENCE, at: ["core", "on"] as const }] };
      for (const p of ["core", "on"]) {
        expect(disclosureProblems(base({ ...row, vars: { CHAT_FIXTURE: p } }))).toEqual([]);
        expect(disclosureProblems(base({ ...row, vars: { CHAT_FIXTURE: p }, page: "Intro." })).join()).toMatch(/flag is on but the sentence is not on the page/);
      }
      for (const p of ["shadow", "off"]) {
        expect(disclosureProblems(base({ ...row, vars: { CHAT_FIXTURE: p } })).join()).toMatch(/sentence is on the page but the flag is not on/);
        expect(disclosureProblems(base({ ...row, vars: { CHAT_FIXTURE: p }, page: "Intro." }))).toEqual([]);
      }
    });

    it("reads the variable the way the Worker does, so 'on' means one thing in both places", () => {
      // "ON" is a bad value for the Worker (off), so the sentence has to be absent for it
      expect(positionOfVariable("ON", false).position).toBe("off");
      expect(disclosureProblems(base({ vars: { CHAT_FIXTURE: "ON" }, page: "Intro." }))).toEqual([]);
    });

    it("fails when a row is left in FLAG_SENTENCES but nothing in the code names its flag (it was deleted: the row moves to ALWAYS_ON); a longer name that contains it does not count", () => {
      expect(disclosureProblems(base({ vars: { CHAT_FIXTURE: "on" }, sources: [] })).join()).toMatch(/CHAT_FIXTURE: nothing in apps\/api\/src names this flag.*ALWAYS_ON/);
      expect(disclosureProblems(base({ vars: { CHAT_FIXTURE: "on" }, sources: ['flagOf(env, "CHAT_FIXTURE_TWO")'] })).join()).toMatch(/nothing in apps\/api\/src names this flag/);
    });

    it("does not count a flag's name in a comment as the flag still being in the code (a deleted flag leaves its comments behind), but counts it in a string, an identifier, a property of env and a type", () => {
      const on = { CHAT_FIXTURE: "on" };
      const comments = ["// CHAT_FIXTURE was deleted last week", "/* flagOf(env, 'CHAT_FIXTURE') and env.CHAT_FIXTURE */\nexport const x = 1;"];
      expect(disclosureProblems(base({ vars: on, sources: comments })).join()).toMatch(/CHAT_FIXTURE: nothing in apps\/api\/src names this flag.*ALWAYS_ON/);
      for (const code of ['flagOf(env, "CHAT_FIXTURE");', "const lane = env.CHAT_FIXTURE;", "const CHAT_FIXTURE = 1;", "type Bindings = { CHAT_FIXTURE?: string };", "const key = `flag:${'CHAT_FIXTURE'}`;"]) {
        expect(disclosureProblems(base({ vars: on, sources: [code] })), code).toEqual([]);
      }
    });

    describe("a flag that is on in the committed vars needs a row: its sentence (FLAG_SENTENCES) or the reason it needs none (FLAGS_WITHOUT_SENTENCE)", () => {
      const REASON = "it only reorders results the person already sees; nothing new is sent anywhere";
      const none = (over: Partial<Disclosure>) => base({ flagSentences: [], sources: [], ...over });

      it("fails for a flag at on or core that is in neither table", () => {
        for (const position of ["on", "core"]) {
          const problems = disclosureProblems(none({ vars: { CHAT_OTHER: position } }));
          expect(problems, position).toHaveLength(1);
          expect(problems[0]).toMatch(/CHAT_OTHER: .*no row/);
        }
      });

      it("does not fail for a flag that is off or shadow, a value that is not a position (a bad value is off), or a variable that is not a flag", () => {
        for (const value of ["off", "shadow", "ON", "true", "1", "", 1, null]) expect(disclosureProblems(none({ vars: { CHAT_OTHER: value } })), JSON.stringify(value)).toEqual([]);
      });

      it("passes when the table gives the reason, and fails for an empty reason or for a flag that is in both tables", () => {
        expect(disclosureProblems(none({ vars: { CHAT_OTHER: "on" }, noSentence: { CHAT_OTHER: REASON } }))).toEqual([]);
        expect(disclosureProblems(none({ vars: { CHAT_OTHER: "on" }, noSentence: { CHAT_OTHER: "  " } })).join()).toMatch(/CHAT_OTHER: .*empty reason/);
        const both = base({ vars: { CHAT_FIXTURE: "on" }, noSentence: { CHAT_FIXTURE: REASON } });
        expect(disclosureProblems(both).join()).toMatch(/CHAT_FIXTURE: .*in both FLAG_SENTENCES and FLAGS_WITHOUT_SENTENCE/);
      });

      it("a flag with a sentence row is not asked for a second row", () => {
        expect(disclosureProblems(base({ vars: { CHAT_FIXTURE: "on" } }))).toEqual([]);
      });
    });

    describe("a sentence is pinned as the page's source text, because the page is read as source and not as a reader sees it", () => {
      const BODY = "For each reference you paste (up to";
      const rendered = "For each reference you paste (up to 100 at a time), we look for a real record.";
      const page = `Intro. <p>For each reference you paste (up to {MAX_REFERENCES} at a time), we look for a real record.</p> Outro.`;
      const row = (sentence: string) => [{ flag: "CHAT_FIXTURE", sentence, at: ["on"] as const }];

      it("refuses a sentence that has a { or a } in it: no reader sees braces, so it can only be matched by luck", () => {
        const problems = disclosureProblems(base({ page: plain(page), flagSentences: row("For each reference you paste (up to {MAX_REFERENCES} at a time)"), vars: { CHAT_FIXTURE: "on" } }));
        expect(problems.join()).toMatch(/CHAT_FIXTURE: .*literal.*\{/);
      });

      it("fails for a sentence that is on the page only through an expression (as rendered it says 100, the source says {MAX_REFERENCES}), also when its flag is off, where it used to be silent", () => {
        for (const vars of [{}, { CHAT_FIXTURE: "shadow" }, { CHAT_FIXTURE: "on" }]) {
          const problems = disclosureProblems(base({ page: plain(page), flagSentences: row(rendered), vars })).join();
          expect(problems, JSON.stringify(vars)).toMatch(/CHAT_FIXTURE: .*only through a JSX expression/);
        }
      });

      it("catches the same when the expression is first in the sentence (a product name) or last", () => {
        expect(disclosureProblems(base({ page: plain("<p>{LEGAL.product} keeps nothing about you.</p>"), flagSentences: row("Sodhsetu keeps nothing about you."), vars: {} })).join()).toMatch(/only through a JSX expression/);
        expect(disclosureProblems(base({ page: plain("<p>Write to us at {LEGAL.contactEmail}</p>"), flagSentences: row("Write to us at someone@example.org"), vars: {} })).join()).toMatch(/only through a JSX expression/);
      });

      it("takes a sentence pinned as the literal run before the expression: found when it is there, and then it is the flag's business", () => {
        expect(disclosureProblems(base({ page: plain(page), flagSentences: row(BODY), vars: { CHAT_FIXTURE: "on" } }))).toEqual([]);
        expect(disclosureProblems(base({ page: plain(page), flagSentences: row(BODY), vars: {} })).join()).toMatch(/the sentence is on the page but the flag is not on/);
      });

      it("does not cry wolf: a sentence that is simply not on a page that has expressions is not 'through an expression'", () => {
        const problems = disclosureProblems(base({ page: plain("<p>{LEGAL.product} keeps nothing. Contact: {LEGAL.contactEmail}.</p>"), vars: {} }));
        expect(problems).toEqual([]);
      });

      it("reads {\" \"} as the space it renders, and the entities of a page as the characters they render (so a sentence typed as a reader sees it can be found)", () => {
        const RSQUO = String.fromCharCode(0x2019);
        const MDASH = String.fromCharCode(0x2014);
        expect(plain('<p>Contact:{" "}<a href="x">us</a>: don&apos;t &amp; won&rsquo;t &#8212; &#x2014; &mdash;&nbsp;&quot;ok&quot; &lt;b&gt;</p>')).toBe(
          `Contact: us: don't & won${RSQUO}t ${MDASH} ${MDASH} ${MDASH} "ok" <b>`,
        );
        // one pass: an escaped ampersand is not decoded a second time
        expect(plain("<p>&amp;lt;</p>")).toBe("&lt;");
      });
    });

    it("ALWAYS_ON: the sentence must be on the page, and its code path must exist and say what the row says", () => {
      const row: AlwaysOn = { sentence: SENTENCE, codePath: { file: "apps/api/src/chat/lane.ts", contains: "export function answerEmergency" } };
      const code = (file: string) => (file === "apps/api/src/chat/lane.ts" ? "export function answerEmergency(m: string) {}" : null);
      const always = (over: Partial<Disclosure>) => base({ flagSentences: [], alwaysOn: [row], codeFile: code, ...over });
      expect(disclosureProblems(always({}))).toEqual([]);
      expect(disclosureProblems(always({ page: "Intro." })).join()).toMatch(/always on: the sentence is not on the page/);
      expect(disclosureProblems(always({ codeFile: () => null })).join()).toMatch(/always on: the file apps\/api\/src\/chat\/lane.ts does not exist/);
      expect(disclosureProblems(always({ codeFile: () => "export function somethingElse() {}" })).join()).toMatch(/always on: apps\/api\/src\/chat\/lane.ts does not contain "export function answerEmergency"/);
    });

    it("refuses a table that cannot be trusted: an empty sentence (it is 'on the page' everywhere) and a sentence in both tables", () => {
      expect(disclosureProblems(base({ flagSentences: [{ flag: "CHAT_FIXTURE", sentence: "  ", at: ["on"] }], vars: { CHAT_FIXTURE: "on" } })).join()).toMatch(/empty sentence/);
      const both = base({ vars: { CHAT_FIXTURE: "on" }, alwaysOn: [{ sentence: SENTENCE, codePath: { file: "x.ts", contains: "x" } }], codeFile: () => "x" });
      expect(disclosureProblems(both).join()).toMatch(/in both FLAG_SENTENCES and ALWAYS_ON/);
    });
  });

  describe("the vars block is read the way scripts/integration.mjs reads wrangler.jsonc", () => {
    it("the committed file has no trailing comment on any line, and its vars block is an object", () => {
      const text = read("../wrangler.jsonc");
      expect(trailingCommentLines(text)).toEqual([]);
      const vars = committedVars();
      expect(vars).toBeTypeOf("object");
      expect(Array.isArray(vars)).toBe(false);
    });

    it("drops whole-line comments, as the script's filter does, and returns vars", () => {
      const text = ['{', '  // a whole-line comment, with "quotes" and a //', '  "name": "x",', '  "vars": { "A": "on", "URL": "https://example.org/a" },', '  "other": 1', '}'].join("\n");
      expect(trailingCommentLines(text)).toEqual([]);
      expect(readVars(text)).toEqual({ A: "on", URL: "https://example.org/a" });
    });

    it("fails, naming the line, when a vars line has a trailing // comment (the script would stop reading the file, so every local suite would)", () => {
      const oneLine = ['{', '  "vars": { "CHAT_X": "shadow" }, // switched on for the trial', '  "other": 1', '}'].join("\n");
      expect(trailingCommentLines(oneLine)).toEqual([2]);
      expect(() => readVars(oneLine)).toThrow(/trailing.*line 2/);
      const many = ['{', '  "vars": {', '    "CHAT_A": "shadow",', '    "CHAT_B": "on" // the second', '  }', '}'].join("\n");
      expect(trailingCommentLines(many)).toEqual([4]);
      expect(() => readVars(many)).toThrow(/line 4/);
    });

    it("does not take a // inside a string for a comment, nor an escaped quote for the end of one", () => {
      const BS = String.fromCharCode(92); // a backslash, built from its number
      const text = ['{', '  "vars": { "A": "say ' + BS + '"hi' + BS + '" // not a comment", "B": "http://example.org", "C": "one ' + BS + '" // here" }', '}'].join("\n");
      expect(trailingCommentLines(text)).toEqual([]);
      expect(Object.keys(readVars(text))).toEqual(["A", "B", "C"]);
    });

    it("gives {} for a file with no vars block", () => {
      expect(readVars("{ \"name\": \"x\" }")).toEqual({});
    });
  });
});

describe("(1) and (2) of 10.2, the reading of a message (added by R8)", () => {
  // docs/design/intent-and-state.md, 10.2 (line 920), item list on line 922. R8 adds the reading, and both are proved by running the real handler with the stand-in network, which a source-reading file cannot do:
  // chat/clean-route.test.ts, "the words searched are the Reading's topic or the message ... (the disclosure match, 1 and 2)". This pin only fails if that test is taken away or renamed.
  const routeTest = readFileSync(fileURLToPath(new URL("./chat/clean-route.test.ts", import.meta.url)), "utf8");
  it("(1) the string handed to runSearch equals the reading's topic or the message: pinned in chat/clean-route.test.ts by a recorder of every search", () => {
    expect(routeTest).toContain("(the disclosure match, 1 and 2)");
    expect(routeTest).toContain("what the indexes are asked is the reading's topic or the message");
  });
  it("(2) the words shown in understood.reading and as \"I searched for\" equal the string handed to runSearch: pinned in the same test", () => {
    expect(routeTest).toContain("the words shown on the answer (\"I searched for\") are the words asked");
  });
});
