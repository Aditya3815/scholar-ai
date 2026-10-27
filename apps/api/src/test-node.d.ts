// Just the parts of Node that the unit tests' database stand-in (test-d1.ts) uses. The Worker's type set (@cloudflare/workers-types) has no Node types, and adding all of @types/node would
// bring a second, different set of global types into code that runs on Workers. Tests only.
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): { all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown; run(...args: unknown[]): { changes: number | bigint } };
  }
}
declare module "node:fs" {
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: "utf8"): string;
}
declare module "node:path" {
  export function join(...parts: string[]): string;
}
declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}
interface ImportMeta {
  url: string;
}
