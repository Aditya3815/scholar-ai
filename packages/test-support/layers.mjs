// The import edges of a package's source, for the layer-rule tests (docs/design/untangle.md, 1.5 and F1): apps/api/src/layers.test.ts,
// apps/web/src/layers.test.ts and packages/shared/src/layers.test.ts each say which edges their rule forbids; this file only finds the edges.
//
// Parsed, not grepped (vite's parseAst, the parser vitest already carries; the same one depgraph.mjs uses): a comment or a string that looks like an
// import is not one. An edge is one of:
//   - an `import` or `export ... from` declaration (type-only when the declaration or every one of its names is a type);
//   - a dynamic `import("...")` with a literal path, an `import("...")` type, a `vi.mock("...")` (it names a module the test stands in for);
//   - in a test, a string that is a relative path into another package (`new URL("../../web/src/" + name, import.meta.url)`, a path given to
//     readFileSync or to a helper that reads it): a test that reads the source of another package.
// Only edges to files of this repository are kept (npm packages, `node:` and `cloudflare:` modules are not code of ours).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAst } from "vite";

/** The repository root (this file is packages/test-support/layers.mjs). */
export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const CODE = /\.(ts|tsx|mts|mjs|js)$/;
const rel = (abs) => relative(REPO, abs).split("\\").join("/");

/** Every source file under `dir` (repo-relative), .d.ts files left out. */
export function sourceFiles(dir) {
  const out = [];
  const walk = (abs) => {
    for (const name of readdirSync(abs)) {
      if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
      const p = join(abs, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (CODE.test(name) && !name.endsWith(".d.ts")) out.push(rel(p));
    }
  };
  walk(join(REPO, dir));
  return out.sort();
}

/** The repo-relative file a specifier names, or null when it is not a file of ours. */
export function resolveSpec(from, spec) {
  spec = spec.replace(/\?.*$/, "");
  let base;
  if (spec === "@scholar/shared") return "packages/shared/src/index.ts";
  if (spec.startsWith("@scholar/shared/")) base = "packages/shared/" + spec.slice("@scholar/shared/".length);
  else if (spec.startsWith("@scholar/test-support/")) base = "packages/test-support/" + spec.slice("@scholar/test-support/".length);
  else if (spec.startsWith(".")) base = posix.normalize(posix.join(posix.dirname(from), spec));
  else return null;
  const stem = base.replace(/\.(js|mjs|ts|tsx)$/, "");
  for (const c of [base, stem + ".ts", stem + ".tsx", stem + ".mjs", stem + ".js", base + "/index.ts", base + "/index.tsx"]) {
    const abs = join(REPO, c);
    if (existsSync(abs) && statSync(abs).isFile()) return c;
  }
  // a path that names a folder or a file that is not there (a fixture made at run time): still an edge to that place
  return base;
}

const isTest = (f) => /\.test\.(ts|tsx|mjs)$/.test(f);

function walkAst(node, fn) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) walkAst(n, fn);
    return;
  }
  if (typeof node.type === "string") fn(node);
  for (const k in node) {
    if (k === "start" || k === "end" || k === "type") continue;
    const v = node[k];
    if (v && typeof v === "object") walkAst(v, fn);
  }
}

/** The edges of one file: { from, to, spec, line, typeOnly, kind }. */
export function edgesOf(file) {
  const text = readFileSync(join(REPO, file), "utf8");
  const lang = file.endsWith(".tsx") ? "tsx" : /\.m?ts$/.test(file) ? "ts" : "js";
  const ast = parseAst(text, { lang });
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  const lineOf = (off) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (starts[m] <= off) lo = m;
      else hi = m - 1;
    }
    return lo + 1;
  };
  const out = [];
  const add = (spec, node, typeOnly, kind) => {
    const to = resolveSpec(file, spec);
    if (to) out.push({ from: file, to, spec, line: lineOf(node.start), typeOnly, kind });
  };
  for (const st of ast.body) {
    if (st.type === "ImportDeclaration") {
      const specs = st.specifiers ?? [];
      const typeOnly = st.importKind === "type" || (specs.length > 0 && specs.every((s) => s.type === "ImportSpecifier" && s.importKind === "type"));
      add(st.source.value, st, typeOnly, "import");
    } else if ((st.type === "ExportNamedDeclaration" || st.type === "ExportAllDeclaration") && st.source) {
      const specs = st.specifiers ?? [];
      const typeOnly = st.exportKind === "type" || (specs.length > 0 && specs.every((s) => s.exportKind === "type"));
      add(st.source.value, st, typeOnly, "export");
    }
  }
  const test = isTest(file);
  walkAst(ast, (n) => {
    if (n.type === "ImportExpression") {
      const s = n.source?.type === "Literal" && typeof n.source.value === "string" ? n.source.value : null;
      if (s) add(s, n, false, "dynamic");
    } else if (n.type === "TSImportType") {
      const a = n.argument ?? n.parameter;
      const v = a?.literal?.value ?? a?.value;
      if (typeof v === "string") add(v, n, true, "import-type");
    } else if (n.type === "CallExpression" && n.callee?.type === "MemberExpression" && n.callee.object?.name === "vi" && /^(mock|doMock)$/.test(n.callee.property?.name ?? "")) {
      const s = n.arguments[0]?.type === "Literal" ? n.arguments[0].value : null;
      if (typeof s === "string") add(s, n, false, "mock");
    } else if (test && n.type === "Literal" && typeof n.value === "string" && /^\.\.?\//.test(n.value)) {
      // a path a test reads (readFileSync, new URL(..., import.meta.url), a helper that takes a path): kept when it leaves the package
      const to = resolveSpec(file, n.value);
      if (to && packageOf(to) !== packageOf(file) && !out.some((e) => e.spec === n.value && e.line === lineOf(n.start))) out.push({ from: file, to, spec: n.value, line: lineOf(n.start), typeOnly: false, kind: "reads" });
    }
  });
  return out;
}

/** The package a repo path belongs to: "api", "web", "shared", "test-support", or "other". */
export function packageOf(path) {
  if (path.startsWith("apps/api/")) return "api";
  if (path.startsWith("apps/web/")) return "web";
  if (path.startsWith("packages/shared/")) return "shared";
  if (path.startsWith("packages/test-support/")) return "test-support";
  return "other";
}

/** A repo path in the plan's short form: api/..., web/..., shared/... (src/ left out), test-support/..., or as it is. */
export function short(path) {
  return path
    .replace(/^apps\/api\/src\//, "api/")
    .replace(/^apps\/web\/src\//, "web/")
    .replace(/^packages\/shared\/src\//, "shared/")
    .replace(/^packages\/test-support\//, "test-support/");
}

/**
 * The edges of every file under `dir` that `rule` forbids, as sorted, de-duplicated "from -> to" lines in the short form. `rule(edge)` returns
 * a reason (a short text) for a forbidden edge and null for an allowed one; the reason is not part of the line, so the allowlist does not change
 * when a reason is reworded. `reasons` maps each line to where it is and why, for the failure message.
 */
export function violations(dir, rule) {
  const files = sourceFiles(dir);
  const reasons = new Map();
  let edges = 0;
  for (const f of files) {
    for (const e of edgesOf(f)) {
      edges++;
      const why = rule({ ...e, test: isTest(f) });
      const line = `${short(e.from)} -> ${short(e.to)}`;
      if (why && !reasons.has(line)) reasons.set(line, `${short(e.from)}:${e.line} ${e.spec} (${why})`);
    }
  }
  return { files: files.length, edges, lines: [...reasons.keys()].sort(), reasons };
}
