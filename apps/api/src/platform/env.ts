/**
 * The Worker's environment, declared once (docs/design/untangle.md, F5).
 *
 * Two halves:
 *   - What wrangler.jsonc declares (the bindings and the `vars`) is GENERATED: `npm run cf-typegen -w apps/api` writes apps/api/worker-configuration.d.ts (`Cloudflare.Env`), and CI fails
 *     when that file no longer matches wrangler.jsonc. Never edit it by hand. The bindings, for the record:
 *       DB (D1), FILES (R2), CACHE (Workers KV: the public cache, src/cache/kv.ts; only public data), OAUTH_KV (Workers KV of the MCP server's OAuth: clients, grants and tokens, src/mcp/oauth.ts;
 *       a namespace of its own, without it the server is off), AI (Workers AI), S2_THROTTLE (the one-per-second lane of Semantic Scholar), API_GATE (the shared lanes to Crossref and CORE, src/gate:
 *       one limit for every isolate), OA_INGEST (the reading of an open-access paper into the shared index, src/oa/workflow.ts), LITSCAN (a literature scan, one instance per scan,
 *       src/litscan/workflow.ts), JOBS (a queue nothing uses yet), SEARCH_LIMITER, VERIFY_LIMITER, ASK_LIMITER and API_LIMITER (per-address limits, src/ratelimit.ts), CF_VERSION_METADATA.
 *   - What wrangler cannot see is declared HERE: the secrets (`wrangler secret put`), the switches that are Worker variables only while they are set, and the variables of local runs and tests.
 *     A switch that wrangler.jsonc sets today is declared here too, so that taking its line out of `vars` (the usual way back to "unset") changes no type.
 *
 * A module takes the names it reads: `Pick<Env, ...>`, or `EnvPick<...>` when it also runs without one of them (a test, a local run, a binding it can do without). Entry points (the Worker's
 * fetch and scheduled handlers, the Workflows, the MCP server, the Hono routers) take `Env` itself. No module writes a binding's or a variable's type by hand.
 */
export type Env = Cloudflare.Env & SecretsAndVariables;

/** `Pick<Env, Need>`, with the names in `Optional` optional: a module that runs without them (a test, a local run without the binding) says so here. */
export type EnvPick<Need extends keyof Env, Optional extends keyof Env = never> = Pick<Env, Need> & Partial<Pick<Env, Optional>>;

/** What the Hono app and each router it mounts are typed with: a router is handed the Worker's whole environment. */
export type HonoEnv = { Bindings: Env };

type SecretsAndVariables = {
  /* ------------------------------------------------------------ secrets (`wrangler secret put NAME`, and `--env staging` for staging; locally in .dev.vars) */

  /** The contact address sent with the requests to Crossref and the other literature services (what their polite pools ask for). */
  CROSSREF_MAILTO: string;
  OPENALEX_API_KEY?: string;
  NCBI_API_KEY?: string;
  S2_API_KEY?: string;
  /** CORE (api.core.ac.uk): used by Idea Check only, and only when a key is set. */
  CORE_API_KEY?: string;
  GEMINI_API_KEY?: string;
  /** Optional: where unexpected errors are reported (Sentry). Nothing is sent when it is not set. */
  SENTRY_DSN?: string;
  /** Sign-in (docs/auth-setup.md): a provider appears only when its pair is set. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  ORCID_CLIENT_ID?: string;
  ORCID_CLIENT_SECRET?: string;
  /** "https://orcid.org" (default) or "https://sandbox.orcid.org" while testing. */
  ORCID_BASE_URL?: string;
  /** The public address of this deployment (production: https://sodhsetu.in); without it, the address a request came to (a local run). */
  PUBLIC_BASE_URL?: string;
  /** The account ids of the MCP beta (src/mcp/flag.ts), separated by commas or spaces: a secret, not a var, so that an account id is not in this public repository. */
  MCP_BETA_USERS?: string;

  /* ------------------------------------------------------------ switches and settings (Worker variables: `vars` in wrangler.jsonc while one is set) */

  /** "1" where the daily clean-up is scheduled (production): /api/v1/health/jobs then reports a job that did not run. Staging has no schedule and sets "0". */
  EXPECT_CRON?: string;
  /** "staging" on staging; unset is "production". Sent with every Sentry event. */
  SENTRY_ENVIRONMENT?: string;
  /**
   * The Home page's Trending list (src/trending/routes.ts, job.ts): "off" hides the list and stops its daily job; "dark" runs the job and hides the list; anything else, or none, leaves it on.
   * The KV key trending:v1:off hides the list too, and leaves the job running.
   */
  TRENDING?: string;
  /** The MCP server (src/mcp/flag.ts): "off" (unset), "beta" (the accounts in MCP_BETA_USERS) or "on". */
  MCP?: string;
  /** The MCP tool check_claim alone (src/mcp/flag.ts): "off" (unset), "beta" (the accounts in MCP_BETA_USERS) or "on". */
  MCP_CHECK_CLAIM?: string;
  /**
   * Tools run in the reply (docs/design/chat-tools.md, the owner's request of 9 Nov 2026): "on" runs Check references on a pasted list, a retraction check on DOIs that ask about one, "Ask this paper" on a
   * question about one paper of the chat, and the person's own paper's ask, in the reply itself (Idea Check and the literature scan stay a card). Unset, "off" and any other value: the card, as before, and the stream
   * is byte for byte what it was. Auto only: a search chosen by hand never runs a tool. A gate flag: unset is off, a KV override can only lower it. Its privacy sentence (legal-match.test.ts) must be on the page first.
   */
  CHAT_TOOLS?: string;
  /** "off" switches the support judge off (answers are then shown as the old check leaves them): a Worker variable, for a day when its model is down or its cost must stop. */
  CHAT_JUDGE?: string;
  /** "off" makes the chat ignore the earlier messages of a conversation altogether (`history` is neither read nor refused), as it was before there were any: a Worker variable, a rollback that needs no new code. */
  CHAT_CONTEXT?: string;
  /**
   * R3 (docs/design/intent-and-state.md, 4.4): "on" counts what a message in the prompt box looked like, by closed names and never any of its text (feature `chat_input`). Unset, "off" and "shadow" count
   * nothing: a counter that counts is its own shadow, and nothing new may be stored before the privacy page says so. A gate flag: unset is off (understand/flags.ts).
   */
  CHAT_COUNTERS?: string;
  /**
   * R5 (4.6): "on" gives a follow-up whose router call FAILED the papers and no written answer, with a plain line; "shadow" only counts `followup_unread_shadow`; unset and "off" change nothing.
   * A gate flag: unset is off.
   */
  CHAT_FAILPOLICY?: string;
  /**
   * R4 (4.5): the safety lane. Four positions. Unset, "off" or a value that is not one of them: nothing is read. "shadow": every Auto message is read and only counted (`would_*`, and only with CHAT_COUNTERS "on"), nothing
   * on the wire changes. "core": the unmistakable phrases of an emergency, self-harm and a plain call for help are answered by the page with a fixed text and no search, no router and no model; a search chosen by hand
   * gets a line. "on": every tier. The numbers in the sentences are checked by a person first (lane-text.ts HELPLINE_CHECKED), and a test fails if the committed wrangler.jsonc sets this above "shadow" until they are.
   */
  CHAT_SAFETY?: string;
  /**
   * R8 (4.8): the request-frame cleaner. "on": an Auto message that is going to be searched is searched without the words that only make a request ("can you search about", "please", "all papers", "what is"),
   * the page says what was left out and what the box could not do with it (`understood.reading`), and a health message that R4's lane reads as a decision or a care story is also searched without the words that say
   * who the person is. "shadow": the same Reading is made and only counted (`would_clean`, and only with CHAT_COUNTERS "on"); nothing on the wire changes. Unset and "off" change nothing. A gate flag: unset is off.
   */
  CHAT_CLEAN?: string;
  /**
   * R9 (4.9): the relevance floor. Four positions. Unset, "off" or a value that is not one of them: nothing is read. "shadow": the list of an Auto message is read against the words that were searched and only counted
   * (`would_tier_none`, `would_tier_few`, and only with CHAT_COUNTERS "on"); nothing on the wire changes. "writer": only the writer's gate acts: it reads the strong papers alone, and with none the writer is not asked
   * (the reply ends not_answered, counted as floor_skipped); no reorder and no line. "on": the papers are listed strong, then medium, then weak (each in its old order), and a line says how few match closely.
   * Only for words the page can judge (1 to 6 content stems) and never for a search chosen by hand. A gate flag: unset is off.
   */
  CHAT_FLOOR?: string;
  /**
   * M2 (design PDF "Sodhsetu understanding, follow-ups and MCP", "Thinking dikhana"): "on" adds `think` events, status lines built from the real counts of each stage (chat/think.ts), which the page shows as the
   * Thinking block. Unset, "off" and any other value send none, and the stream is byte for byte what it was. A gate flag: unset is off, and a KV override can only lower it. Turn it on only after a build that
   * knows the event has been live for a day: an older open tab's reducer had no place for an event it did not know.
   */
  CHAT_THINK?: string;
  /**
   * M4/M5 (design PDF "Sodhsetu understanding, follow-ups and MCP", pages 3 to 9 and 13): the Understand step. Unset, "off" and any other value: it is not called, the ledger a page sends is not read, and the stream
   * is byte for byte what it was. "shadow": it runs beside the rules on the response's waitUntil (the person never waits for it), the rules decide, and only counts are kept (feature `chat_understand`: agreement,
   * latency, fallback; never text). "on": it decides, with the rules as the fallback when the model cannot be used. In both, the page is told to send the turn ledger (GET /chat/config), so the privacy page
   * must say so before either is set (legal-match.test.ts holds it). A gate flag: unset is off, a KV override can only lower it.
   */
  CHAT_UNDERSTAND?: string;
  /** M5: "on" lets the Understand step read a visitor's message too (40 calls a day per address, migration 0027), in whatever position CHAT_UNDERSTAND is; anything else keeps visitors on the rules. A gate flag. */
  CHAT_UNDERSTAND_VISITORS?: string;
  /**
   * "off" gives back the title, venue, authors and abstract of a provider as its adapter returned them: entities, tabs and line breaks left in (see plainText in normalize.ts). It does not reach the adapters' own
   * stripJats: Crossref's abstract and DOAJ's title and abstract are cleaned while the response is read, before the cache, with the switch off too. Anything else, or nothing, is the fix.
   */
  SEARCH_PLAINTEXT?: string;
  /** Pages of a scanned paper one person may have read per day (default OCR_PAGES_PER_DAY of shared). A value that is not a whole number from 1 to 2000 is ignored. */
  OCR_PAGES_PER_DAY?: string;

  /* ------------------------------------------------------------ local runs and tests only (.dev.vars, never a production secret: scripts/push-secrets.mjs refuses the first three) */

  /** "1" only in local .dev.vars; never set as a production secret. Enables /api/v1/dev/* smoke routes. */
  ENABLE_DEV_ROUTES?: string;
  /** "1" (local tests only, together with ENABLE_DEV_ROUTES) swaps the model, the embeddings, the literature services and the OCR reader for deterministic stand-ins. */
  QA_STUB?: string;
  /** Only honoured together with ENABLE_DEV_ROUTES=1: points Google at a local fake identity provider for tests. */
  DEV_IDP_URL?: string;
  /** Development only (with QA_STUB): the stand-in search writes the words of the question into its records, so that a list is about whatever was asked (stub.ts). The integration run sets it with CHAT_FLOOR. Never set in wrangler.jsonc. */
  QA_STUB_TOPIC?: string;
  /** Cost experiments only, with ENABLE_DEV_ROUTES (docs/spikes/R5-cost.md): how many passages are shown to the model for a question about a paper. */
  QA_TOP_K?: string;
  /**
   * Cost and quality experiments only (docs/spikes/R5-cost.md), and only where ENABLE_DEV_ROUTES is "1" (never in production): `LLM_QA_MODEL` sends the private `qa` task to another Workers AI model,
   * `LLM_REASONING` (low, medium, high) sets how long a gpt-oss model thinks. Neither exists in a deployed Worker.
   */
  LLM_QA_MODEL?: string;
  LLM_REASONING?: string;
  /** The same as LLM_QA_MODEL for the private `classify` task (the router of Auto mode: docs/design/p7-latency.md). */
  LLM_CLASSIFY_MODEL?: string;
  /** The same as LLM_QA_MODEL for the private `verify` task (the support judge: docs/design/claim-support.md). */
  LLM_VERIFY_MODEL?: string;
  /** With ENABLE_DEV_ROUTES: the keep-alive interval of a stream in milliseconds (50 or more), so a test need not wait the real one (src/sse.ts). */
  SSE_KEEPALIVE_MS?: string;
};
