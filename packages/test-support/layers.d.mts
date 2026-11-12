// Types of layers.mjs for the layer-rule tests that import it.
export type Edge = { from: string; to: string; spec: string; line: number; typeOnly: boolean; kind: "import" | "export" | "dynamic" | "import-type" | "mock" | "reads" };
export const REPO: string;
export function sourceFiles(dir: string): string[];
export function resolveSpec(from: string, spec: string): string | null;
export function edgesOf(file: string): Edge[];
export function packageOf(path: string): "api" | "web" | "shared" | "test-support" | "other";
export function short(path: string): string;
export function violations(dir: string, rule: (edge: Edge & { test: boolean }) => string | null): { files: number; edges: number; lines: string[]; reasons: Map<string, string> };
