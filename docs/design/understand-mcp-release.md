# Going live: understanding, follow-ups and MCP (owner checklist, 7 Nov 2026)

Branch `understand-mcp` holds M1 to M8 of the design "Sodhsetu understanding, follow-ups and MCP". Every new switch is unset (off)
in `apps/api/wrangler.jsonc`, so merging it changes only two things a person sees:
- **M1:** "Continue from an earlier chat" and "Use my earlier chats" are gone, with the privacy text below.
- **The message bubble:** a conversation reply shows a speech mark instead of the search magnifier.

Everything else waits for a switch. Each step below says what to read, what to set, how to undo it, and what to watch.

## Step 0. Read before merging: privacy draft-15 (M1)

The branch already sets `PRIVACY_VERSION` to `2026-11-draft-15`, so these changes go live with the merge.

**Removed from the retention table, row "The conversations of the prompt box on Home":**

> A few words taken from your questions and from the English words they were searched with, and a note of which account the chat belongs to, kept with each chat so that your device can find earlier chats. A reply that used questions from an earlier chat keeps those questions (up to three), with the English words they were searched with, so that it can show what it used, until its own chat is deleted, even if the earlier chat is deleted first.

In its place:

> A note of which account the chat belongs to, kept with each chat.

The purpose cell "So you can come back to them, go back to a version you edited, and continue from an earlier chat" loses ", and continue from an earlier chat".

**Removed from the cookies paragraph:**

> and your choice about using earlier chats (kept with your account number, so that another person who signs in on this browser starts with it off)

**Removed entirely: the bullet "Earlier chats."**

> Only if you choose to continue from an earlier chat, or turn on Use my earlier chats in Settings (it is off unless you turn it on), up to three of your earlier questions, each with the English words it was searched with, go with a new question in Auto when you are signed in. If you continue from a chat, its last three questions go to our server with every message of the new chat. With the switch, they are chosen on your device from your six latest chats (not one you left out, not a private chat, and not one kept before this feature that you have not opened since), and only for a message that cannot stand alone; no chat is sent to us to be searched. The AI service reads them only to work out what the new message refers to, and only when the message cannot stand alone: never an earlier answer, an Idea Check or a pasted list. When they were read for a search, they are shown on the answer, and you can remove them and ask again without them; when the message turned out to be for another tool they were read in the same way and nothing is shown. The question as rewritten to stand on its own can carry words from them, as with earlier messages in the same conversation. A private chat is not kept, does not use other chats and is not used by them. With the switch off, and no chat chosen to continue from, nothing from another chat is sent.

**Added at the end of the bullet "Earlier messages in the same conversation":**

> Nothing from another chat is ever sent with a message: each chat leans only on its own earlier messages.

**"Latest change" line, new text:**

> Latest change (6 November 2026): the prompt box on Home no longer uses your earlier chats. “Continue from an earlier chat” and the setting “Use my earlier chats” are gone, a message carries only earlier messages of its own conversation, and the few words that were kept with each chat so that your device could find it are removed from your browser. See “Your papers and ideas”.

**Settings, Chats, new text:**

> Nothing of one chat is sent with a message in another.

## Step 1. Merge with every switch off

Merge `understand-mcp` to `main`. CI then applies the D1 migrations itself, in order:
- `0026_mcp.sql`: the `mcp_calls` and `mcp_daily` tables;
- `0027_understand_visitors.sql`: the visitors' daily cap.

Both migrations only add tables. With the switches off nothing writes to them.

After the deploy, check four things:
- `/api/v1/health` answers;
- `/mcp` answers 404;
- `/api/v1/chat/config` answers `{"ledger":false}`;
- a search on Home looks as before.

Rollback: `git revert` the merge and push. The two migrations can stay.

## Step 2. A day later: the Thinking block (`CHAT_THINK=on`)

Wait one day. An old tab opened before this build would treat the new `think` event badly; the new reducer ignores events it does not know.

1. Set `"CHAT_THINK": "on"` in `vars` and push. No privacy sentence is needed: the lines show the person their own search, with numbers that are already on the page.
2. **Watch:** Sentry for page errors, and the browser suites `think` and `chat` in the weekly run.
3. **Off at once:** `npx wrangler kv key put --binding=CACHE flag:CHAT_THINK off --remote`. This takes effect within a minute; a KV value can only lower a switch.

## Step 3. Read the held sentences, then put them on the page with draft-16

These three sentences are in `FLAG_SENTENCES` in `apps/api/src/legal-match.test.ts`. None is on `/privacy` yet. The test fails if a switch is set while its sentence is missing.

Put each sentence you approve on the privacy page under "What we send where", and move `PRIVACY_VERSION` to the next draft in the same commit as the switch.

**CHAT_UNDERSTAND** (needed from `shadow` on, because the ledger is sent from shadow on):

> When you write in Auto, your browser also sends a short record of the earlier turns of the same chat (your earlier messages, the first 300 characters of each reply and the titles of the papers it listed), so that a message like “the second paper” or “only after 2020” can be understood. It goes only to the AI model run by Cloudflare (Workers AI), it is not kept, nothing from another chat is ever in it, and of how a message was understood we keep only counts, never your words.

**CHAT_UNDERSTAND_VISITORS** (needed at `on`):

> Even when you are not signed in, a message you write in Auto is sent to the AI model run by Cloudflare (Workers AI) so that it can be understood; it is not kept and not used for training. To limit how often this happens, we count these messages for the day under a one-way code made from your internet address and the date, which is deleted after two days.

**MCP** (needed at `beta` and `on`):

> If you connect an AI app (such as Claude or ChatGPT) to your Sodhsetu account, what it sends to Sodhsetu's tools (a search, a list of references, DOIs, a question about a paper, a claim to check) is handled exactly as on this website: a search goes to the public indexes named above, references are checked at Crossref and OpenAlex and DOIs at Crossref, a question about a paper or a claim to check is sent with the paper's text to the AI model run by Cloudflare (Workers AI) and counts against your daily AI allowance, a verdict (never your text) is kept for up to a day, and we keep only counts: which tool was used, by which app, how long it took and whether it worked. An app you allow to use your library can see the papers you saved and save a paper you agreed to save. What the app does with the answers is up to that app and its own privacy terms. You can disconnect an app at any time in Settings, under Connected apps.

## Step 4. The Understand step: shadow for 1 to 2 weeks, then on

1. **Shadow.** With the CHAT_UNDERSTAND sentence on the page, set `"CHAT_UNDERSTAND": "shadow"`.
   - The step runs beside the old rules, after they have decided (on `waitUntil`), so the reply is not slower.
   - Only counts are kept.
   - Watch `/admin`, "The Understand step", for 1 to 2 weeks.

   **Gates to see in shadow:**

   | Count | Target |
   |---|---|
   | Fallback rate | under 2% |
   | Clarify rate | under 5% |
   | p95 latency (in-Worker) | under 2.5 s; p50 under 1.2 s. The recording through a local proxy gave p50 3.6 s, so this is the number to look at first. If it is over budget, the prompt is made shorter, then the model is changed. |
   | Agreement with the old rules | read the disagreements by kind; no greeting is ever searched |

   The design's "Change pressed within the turn" rate is **not counted yet**: the counter name exists, but nothing writes it.

2. **Before on.** A second person (a Hindi or Hinglish reader) labels `docs/eval/understand/*.json`; `GUIDE.md` explains how. The eval gates must still pass on the two-person labels:

   | Set | Gate |
   |---|---|
   | Single messages | intent accuracy above 95%; a pure greeting never searched |
   | Multi-turn | 90% of turns right; no leak after New topic |
   | Chat replies | 0 citation leaks |

3. **On (signed in).** Set `"CHAT_UNDERSTAND": "on"`. Keep the shadow gates for a week of live counts; then the old greedy rule can be deleted (the guards stay).

4. **Visitors.** Only after the visitors' sentence is on the page, set `"CHAT_UNDERSTAND_VISITORS": "on"` (40 calls a day per address).

5. **Off at once:**
   - `npx wrangler kv key put --binding=CACHE flag:CHAT_UNDERSTAND off --remote`
   - the same with `flag:CHAT_UNDERSTAND_VISITORS`

   Either can also be lowered to `shadow` the same way.

## Step 5. MCP beta

1. Create the OAuth namespace:
   - `npx wrangler kv namespace create OAUTH_KV`
   - for staging, the same with `--env staging`

   Add `{ "binding": "OAUTH_KV", "id": "<id>" }` to `kv_namespaces` in `apps/api/wrangler.jsonc`; the comment there marks the place. Without this binding MCP stays off whatever the switch says.
2. Put the MCP sentence on the page with the next `PRIVACY_VERSION`.
3. Find your account id at `/api/v1/auth/me` (`user.id`) while signed in. Set `"MCP": "beta"` and `"MCP_BETA_USERS": "<your id>"`, and push.
4. Try it:
   - Claude Desktop or claude.ai: Settings, Connectors, add `https://sodhsetu.in/mcp`, then Allow.
   - ChatGPT (developer mode).
   - Cursor (`mcp.json`: `{ "url": "https://sodhsetu.in/mcp" }`).
   - Check a reference list; search; ask a paper; save one with your yes.
5. `check_claim` stays hidden until you set `"MCP_CHECK_CLAIM": "beta"` or `"on"`. Its eval passes: of 37 claims labelled not supported, none was called supported. But 12 of 210 live calls ended as `cannot_check`.
6. **Watch:**
   - `/admin`, "AI apps (MCP server)": calls by tool and app, outcomes, time;
   - Sentry;
   - the 300-a-day quota.
7. **Off at once:**
   - `npx wrangler kv key put --binding=CACHE flag:MCP off --remote`
   - the same for `flag:MCP_CHECK_CLAIM`

   A person can also disconnect an app in Settings, Connected apps.
8. `"MCP": "on"` when the beta has run clean. The same sentence covers it.

## Open items (not blocking the merge)

- Only the first of the Understand step's 1 to 3 search queries is searched.
- `ask_results` answers from abstracts, not full text.
- `ask_paper` (the person's own uploaded paper) is offered as the "Ask a paper" card rather than answered in the chat.
- The literature-scan card opens the page empty: the topic is not handed over yet.
- No real app has tried MCP's own "Save this paper?" question (elicitation); `confirm: true` is the path apps use today.
- `docs/FEATURES.md` and `docs/ARCHITECTURE.md` on this branch describe M1 to M8. Update them again after each switch goes on.
