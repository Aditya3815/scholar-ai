# LLM providers: what we have access to (2026-10-17)

**Privacy rule (non-negotiable):** the Google AI Studio key is on the *unpaid* tier. Google's terms say unpaid-tier prompts and responses may be used to improve its products and read by human reviewers. So `sensitivity: "public"` requests only (search queries, public abstracts). Never a user's manuscript. Private requests go to Workers AI or a paid API with a no-training agreement. This is enforced in the LLM Gateway (Phase 0, Week 2) with a test.

## Gemini models visible to the key (`GET /v1beta/models`, 63 models)
Text/reasoning: `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-3.1-pro-preview`, `gemini-2.5-pro/flash/flash-lite`, plus `-latest` aliases. 1M-token context, 64K output, context caching and batch supported.
Open weights: `gemma-4-31b-it`, `gemma-4-26b-a4b-it`.
Embeddings: `gemini-embedding-2`, `gemini-embedding-001` (compare with Workers AI `bge-m3` for Hindi/Odia retrieval).
Other: `deep-research-*`, image (`gemini-3.x-flash-image`), TTS, transcribe; not needed for the product now.
Smoke test: `gemini-3.5-flash-lite` answered in about 2.1 s, `gemini-3.8-flash` in about 2.9 s.

Whether a given model is actually on the free quota (and its per-minute/day limits) is only visible in AI Studio; Google no longer publishes them in the docs. Pro models were reported removed from the free tier in 2026. Check before relying on one.

## Intended routing (to be validated in spike R2)
| Task | Sensitivity | First choice | Fallback |
| --- | --- | --- | --- |
| Query expansion, intent classification | public | `gemini-3.5-flash-lite` | Groq gpt-oss-20b |
| Search-result summaries (abstracts only) | public | `gemini-3.8-flash` | OpenRouter `:free` |
| Paper Q&A, review, similarity explanation | **private** | Workers AI open model | paid API (Claude) |
| Embeddings | private | Workers AI `bge-m3` | Gemini embedding (public text only) |

Keys live in `apps/api/.dev.vars` (gitignored) and Worker secrets; never in the repo or chat.
