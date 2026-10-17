# Spike R2: grounded Q&A quality harness

Reproduce `docs/spikes/R2-llm.md`.

1. Download the 5 arXiv PDFs listed in `questions.json` (`papers.*.arxiv`) into a scratch folder and turn each into `<name>.txt`
   (`attention.txt`, `milk.txt`, `cholera.txt`, `physed.txt`, `pilot.txt`):
   ```bash
   python -m venv venv && venv/bin/pip install pypdf fonttools      # Windows: venv\Scripts\...
   venv/bin/python -I -X utf8 pdf2txt.py attention.pdf attention.txt
   ```
   Paper text is not committed (arXiv licences vary).
2. Retrieval only (BM25 vs bge-m3 vs hybrid recall@6):
   `node scripts/r2/run.mjs --papers <dir> --retrieval-only`
3. Models: `node scripts/r2/run.mjs --papers <dir> --models "gemini:gemini-3.8-flash,wai:@cf/openai/gpt-oss-120b#schema"`
   - `wai:` = Cloudflare Workers AI REST (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` with Workers AI access); `#schema` enforces JSON via `response_format`.
   - `gemini:` = AI Studio (`GEMINI_API_KEY`). The unpaid tier trains on prompts: only ever use it with public papers.
   - Calls are cached in `.cache/` (keyed by model + question id), so reruns cost nothing. Change a question's `id` when you change its text.

Scoring is deterministic (no LLM judge): `must` regexes for correctness, every quote must appear (fragment-wise, ignoring
spacing/hyphens/punctuation) in the cited passage, `answerable:false` must be returned for questions the paper cannot answer.
Free Workers AI is 10,000 neurons/day for the whole account: a full 35-question run of gpt-oss-120b costs roughly a third of it.
