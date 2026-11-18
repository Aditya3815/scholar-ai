/**
 * The gateway lives in platform/llm (docs/design/untangle.md, F8). Nothing of the Worker imports this file: it is kept only because legal-match.test.ts (rule 3) proves its import rule on a
 * fixture that names "../llm" from understand/ and must find the AI binding behind it; the tests pass (section 4.2) points that fixture at platform/llm and deletes this file.
 */
export * from "../platform/llm";
