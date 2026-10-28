# LLM providers: what we have access to (2026-10-17)

**Privacy rule (non-negotiable):** the Google AI Studio key is on the *unpaid* tier. Google's terms say unpaid-tier prompts and responses may be used to improve its products and read by human reviewers. So `sensitivity: "public"` requests only (search queries, public abstracts). Never a user's manuscript. Private requests go to Workers AI or a paid API with a no-training agreement. This is enforced in the LLM Gateway (Phase 0, Week 2) with a test.

## Gemini models visible to the key (`GET /v1beta/models`, 63 models)
Text/reasoning: `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-3.1-pro-preview`, `gemini-2.5-pro/flash/flash-lite`, plus `-latest` aliases. 1M-token context, 64K output, context caching and batch supported.
Open weights: `gemma-4-31b-it`, `gemma-4-26b-a4b-it`.
Embeddings: `gemini-embedding-2`, `gemini-embedding-001` (compare with Workers AI `bge-m3` for Hindi/Odia retrieval).
Other: `deep-research-*`, image (`gemini-3.x-flash-image`), TTS, transcribe; not needed for the product now.
Smoke test: `gemini-3.5-flash-lite` answered in about 2.1 s, `gemini-3.8-flash` in about 2.9 s.

Whether a given model is actually on the free quota (and its per-minute/day limits) is only visible in AI Studio; Google no longer publishes them in the docs. Pro models were reported removed from the free tier in 2026. Check before relying on one.

## Status (2026-10-17)
The LLM Gateway is implemented in `apps/api/src/llm/` (policy, fallback chain, quota ledger, public-only cache) with 13 tests, including: private requests never reach a non-`privateOk` provider, and a private route containing only Gemini fails with `NoRouteError` instead of downgrading. Spike R2 results and the cost estimate are in `docs/spikes/R2-llm.md`. Workers AI is `privateOk` because Cloudflare states it does not train on Customer Content or retain standard-inference inputs/outputs (checked 2026-10-17); do not route it through AI Gateway to other vendors.

## Intended routing (as shipped in `src/llm/config.ts`; models changed only after re-running the R2 harness)
| Task | Sensitivity | First choice | Fallback |
| --- | --- | --- | --- |
| Query expansion, intent classification | public | `gemini-3.5-flash-lite` | Workers AI `gpt-oss-120b` |
| Search-result summaries (abstracts only) | public | `gemini-3.5-flash-lite` | Workers AI `gpt-oss-120b` |
| Paper Q&A, review, similarity explanation | **private** | Workers AI `gpt-oss-120b` (schema-enforced) | none yet (benchmark a second model first) |
| Claim-support judge (reads an answer's claims next to the abstracts they cite) | **private** | Workers AI `llama-3.3-70b-instruct-fp8-fast` | Workers AI `mistral-small-3.1-24b-instruct` (both measured on 238 hand-labelled claims: [claim-support.md](design/claim-support.md); not gpt-oss-120b, which is too slow for this) |
| Embeddings | private | Workers AI `bge-m3` | Gemini embedding (public text only) |

Keys live in `apps/api/.dev.vars` (gitignored) and Worker secrets; never in the repo or chat.
