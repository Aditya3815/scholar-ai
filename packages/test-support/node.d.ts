// The little of Node that the unit tests of packages/shared and apps/web use (reading a fixture or a doc, an environment variable that turns on an
// optional run). Neither package has Node's types: shared runs in the browser and on Workers, web in the browser, and all of @types/node would bring a
// second, different set of globals into code that never runs on Node. Included by those packages' tsconfig.json for their tests only; apps/api has its
// own (apps/api/src/test-node.d.ts).
declare module "node:fs" {
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string): void;
}
declare module "node:path" {
  export function join(...parts: string[]): string;
}
declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}
declare const process: { env: Record<string, string | undefined> };
