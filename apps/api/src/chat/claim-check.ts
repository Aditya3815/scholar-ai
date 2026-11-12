import type { Paper } from "@scholar/shared";
import type { StreamComplete } from "../docs/qa";
import { QuotaError, gatewayFromEnv, type LlmEnv } from "../llm";
import type { Picked } from "./answer";
import { shownSentence } from "./evidence";
import { STRICT_SCHEMA, STRICT_SYSTEM, buildJudgePrompt, readVerdicts, type Claim } from "./support";
import { stubStrictStream } from "./stub";
import type { Env } from "../platform/env";

/**
 * One claim checked against one to five papers (the MCP tool check_claim; docs "Sodhsetu understanding, follow-ups and MCP (design)", page 10, tool 5). It is the support judge of the prompt
 * box (chat/support.ts) on a claim the person brings instead of one the writer wrote: the claim cites every paper given, each paper is shown as the numbered sentences of its abstract, and
 * the model answers in numbers only (a verdict, and which sentences support it). The server turns those numbers into sentences of the abstracts, so the evidence a person sees is always text
 * of the paper, never words of the model.
 *
 * It uses the reading that "Check strictly" uses (STRICT_SYSTEM with the stronger model, the private `qa` chain): on the 238 hand-labelled claims of scripts/fixtures/support-gold.json it
 * called none of the 41 unsupported claims supported (docs/design/claim-support.md); the quick judge let 5% through. Its shorter rewrite of a partial claim is not used here: the verdict is.
 */

export const CLAIM_VERDICTS = ["supported", "partly", "not_supported", "cannot_check"] as const;
export type ClaimVerdict = (typeof CLAIM_VERDICTS)[number];

/** A paper as the judge reads it: its number in this check, its title and its abstract (third-party text). */
export type ClaimPaper = { n: number; title: string; year: number | null; abstract: string };

export type ClaimJudgement = {
  verdict: ClaimVerdict;
  /** For supported and partly: per paper, the sentences of its abstract that carry the support (at most three, exactly as the abstract has them). */
  evidence: { n: number; sentences: string[] }[];
  /** Why it could not be checked, when it could not. */
  reason: "no_abstract" | "judge_failed" | "judge_unusable" | "quota" | null;
  model: string | null;
};

const asPaper = (p: ClaimPaper): Paper => ({ id: `t:${p.n}`, doi: null, pmid: null, title: p.title, authors: [], year: p.year, venue: null, abstract: p.abstract, citationCount: null, oaUrl: null, retracted: false, retractionSources: [], sources: [], score: 0 });

/** The claim as the judge's one claim: its words, citing every paper. */
function claimOf(text: string, papers: readonly ClaimPaper[]): Claim {
  const plain = text.replace(/\s+/g, " ").trim();
  return { index: 0, text: plain, plain, marks: papers.map((p) => p.n) };
}

/** The verdict for one claim. Never throws: a failed or unusable model call is `cannot_check` with the reason. */
export async function judgeClaim(args: { claim: string; papers: readonly ClaimPaper[]; judge: StreamComplete; label?: string }): Promise<ClaimJudgement> {
  const papers = args.papers.filter((p) => p.abstract.trim().length >= 40);
  if (papers.length === 0) return { verdict: "cannot_check", evidence: [], reason: "no_abstract", model: null };
  const picked: Picked[] = papers.map((p) => ({ n: p.n, paper: asPaper(p) }));
  const claim = claimOf(args.claim, papers);
  let r: { json: unknown; model: string };
  try {
    r = await args.judge({ system: STRICT_SYSTEM, user: buildJudgePrompt([claim], picked), schema: STRICT_SCHEMA as unknown as Record<string, unknown>, maxTokens: 4000, label: args.label ?? "mcp_check_claim" }, {});
  } catch (e) {
    return { verdict: "cannot_check", evidence: [], reason: e instanceof QuotaError || (e instanceof Error && e.name === "QuotaError") ? "quota" : "judge_failed", model: null };
  }
  const v = readVerdicts(r.json, [claim], picked, new Set(picked.map((p) => p.n))).get(0);
  if (!v || v.verdict === "framing") return { verdict: "cannot_check", evidence: [], reason: "judge_unusable", model: r.model };
  if (v.verdict === "no") return { verdict: "not_supported", evidence: [], reason: null, model: r.model };
  const byN = new Map(picked.map((p) => [p.n, p.paper]));
  const evidence = v.refs.map((ref) => ({ n: ref.n, sentences: ref.s.map((s) => shownSentence(byN.get(ref.n)!, s)).filter(Boolean) })).filter((e) => e.sentences.length > 0);
  // a verdict with no sentence left to show is not one we can stand behind
  if (evidence.length === 0) return { verdict: "cannot_check", evidence: [], reason: "judge_unusable", model: r.model };
  return { verdict: v.verdict === "yes" ? "supported" : "partly", evidence, reason: null, model: r.model };
}

type JudgeEnv = LlmEnv & Pick<Env, "QA_STUB">;

/** The strict reading's model for a person (`subject`: the day's allowance is theirs), PRIVATE, as "Check strictly" calls it; the offline stand-in under QA_STUB. */
export function strictJudgeFor(env: JudgeEnv, subject: string, abort: AbortSignal): StreamComplete {
  if (env.ENABLE_DEV_ROUTES === "1" && env.QA_STUB === "1") return stubStrictStream;
  const gateway = gatewayFromEnv(env);
  return async (req, hooks) => {
    const r = await gateway.stream({ task: "qa", sensitivity: "private", subject, system: req.system, user: req.user, schema: req.schema, maxTokens: 4500, timeoutMs: 75_000, label: req.label }, hooks, abort);
    return { json: r.json, model: r.model };
  };
}
