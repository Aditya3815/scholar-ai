# Sodhsetu: every feature and how it behaves (branch `understand-mcp`, 7 Nov 2026: what is live on main `dbae530`, plus M1 to M8 of the plan "Sodhsetu understanding, follow-ups and MCP", which are NOT live yet)

How the system is built: [ARCHITECTURE.md](ARCHITECTURE.md). Each section below says what a person does, what they see, and the
rules the feature keeps. "Signed in" means signed in with Google or ORCID; a visitor can use most features without the AI parts.

**The rules every feature keeps**

- Every paper shown is a real record from a public index; its DOI is checked at doi.org and its retraction status at Crossref.
- A written answer is tied to sentences of papers' abstracts (or of the person's own paper), and each claim is judged against
  the sentence it cites. A model never writes a citation, title or DOI that is shown as fact. Background from general knowledge
  is labelled as such and never cites a paper.
- A person's text goes only to a private AI model on Cloudflare (never trained on, never kept); only search words go to the
  public indexes. The privacy page says exactly what goes where, and tests hold it to the code.
- A retracted paper is marked and never used as evidence.

---

## 1. Home: the prompt box

One box on Home, with a mode menu: **Auto** (default), **Search papers**, **Check references**, **Idea Check**, **Ask a paper**.

**Auto.** Reads the message and says what it understood: "I understood this as Search papers · Change".
- A plain one-line English question is decided by rules (no AI). A pasted reference list goes to Check references, a bare DOI or
  arXiv number is searched as written. Anything else, for a signed-in person, is read by the private model router; a visitor
  gets the rules only.
- Check references, Idea Check and Ask a paper are **offered** with a card ("This looks like a list of references to check"),
  never started by themselves. A tool chosen by hand is never overridden.
- When unsure, it searches and says "I was not sure what you wanted, so I searched for papers", with Change at hand.
- Hindi (Devanagari) and Hinglish questions are put into English search words for a signed-in person ("I searched for: ... · Use
  my exact words"); the answer comes in the language of the question.
- Greetings and thanks ("Hey", "how are you") are answered by the page itself, sent nowhere, with "Not small talk? Search for
  these words anyway".

**A search in the conversation.**
- Steps are shown while it works (Understanding, Searching, Reading, Writing, Checking). Papers appear as each source answers.
- Up to 20 cards (40 with a year filter): title, year, venue, authors, sources, citations, abstract, retraction mark, and
  buttons Preview, Ask this paper, Save, Cite (APA 7, IEEE, BibTeX, RIS), DOI.
- **Signed in:** a short answer above the papers with numbered marks; "The sentences behind it" shows the exact abstract sentence
  for each claim; a green line says each claim was read against the sentence it cites. **Check strictly** runs a slower,
  stronger second reading (about 5,000 tokens of the daily allowance) that can leave out or shorten claims. If the papers do
  not answer the question, no answer is written and a labelled general background may be shown. A visitor sees the papers and a
  line to sign in for the answer.
- Notices say when a source did not answer (with Search again), when a paper is retracted, when no paper was found, and when
  a year filter left few papers.
- Actions under a reply: **Copy the answer** (or the papers), **Search again**. Under a question: **Copy**, **Edit and resend**
  (up to five versions of a message, with a pager to switch between them).

**Follow-ups (signed in, Auto).** A message that cannot stand alone ("only after 2020", "and in children?", "explain that
simpler", "in Hindi") is read with the last three finished searches of the chat: the router restates it, picks a year range or
"the same papers", and the reply says "Using your earlier question: ... · Use these exact words". A year range is a chip with a
remove button. Nothing about the conversation is stored on the server.

**New topic (new, 5 Nov).** After a finished search, a **New topic** button beside the box (in the "Chat options" menu on a
phone) makes the next message start fresh: a chip in the box says "New topic: earlier messages will not be used" (with an X to
undo), a thin "New topic" line appears in the conversation, and the next message is sent with no earlier turn. The reply after
a stopped or failed one says "Your last message did not finish, so this follows the one before it."

**Only this chat (M1, on this branch).** "Use my earlier chats" and "Continue from an earlier chat" are removed: nothing of one
chat is ever sent with a message in another. An old open tab that still sends earlier chats is answered as if it had not, and the
page removes what the old feature left in the browser when it loads. **The turn ledger (M2):** each chat keeps a short record of its
turns (your words, the first 300 characters of each reply, the first ten papers numbered as the cards) with the chat in your browser;
New topic cuts it, an edit drops the turns after the edited message, a private chat keeps it only in memory. It is sent only while
the Understand step reads it (below).

**Chats.** Kept only in your browser (the thirty latest), tied to your account; listed in the left rail; deleted with the chat,
"Delete all", sign-out or a different person signing in; held out of sight if your session only expires. **Private chat**
(box menu): not kept, gone when you leave it.

**The page.** The composer sticks to the bottom; a round **Scroll to latest message** arrow appears when the end of the
conversation is out of view; message boxes grow with the text and show no scrollbar; **Home** (rail link or logo) starts a new
chat, or focuses the box if you are already on an empty one (a private chat or an unsent edit asks first). The empty Home shows
a greeting, the box, the four tool pills and **Try** examples (8 chips, English, Hinglish and India topics). Long chats stay
fast (far-off replies are not drawn until needed).

**Indian sources** (switch under the box, remembered on the device): the search looks only at DOAJ journals published in India,
Shodhganga theses (as OpenAlex lists them) and papers with an author at an Indian institution. A thesis card links to its
Shodhganga page.

## 2. Search papers

Five sources at once: **OpenAlex, Semantic Scholar, Crossref, PubMed, DOAJ**; results merged and ranked, duplicates joined,
every DOI checked, retractions marked. A search chosen by hand is sent **exactly as written**. A paper's **Preview** shows its
abstract and details in a side sheet (arrow keys step between papers). **Save** adds it to the Library.

## 3. Check references (`/verify`)

Paste a reference list (up to 60 references) or upload a paper and use its reference list. Each reference is looked up at
Crossref and OpenAlex and gets a verdict: **verified** (a real record matches), **mismatch** (a record exists but details
differ: shown side by side), **not found**, or not checkable (a source was down). Retracted papers are flagged. A report can be
downloaded. Results are shown as they arrive; a verdict (not your text) is kept up to a day so a repeat is fast. Fabricated
references are never marked verified (the eval holds this at 0 of 70).

## 4. Idea Check (`/idea`, also from the prompt box)

Bring an idea as text or a file (PDF, Word, LaTeX, Markdown). Signed in.
1. **Plan:** the private model proposes a title, summary, four facets, a meaning-search paragraph and 3 to 6 keyword searches,
   with identifying details, e-mails and links left out. You edit and approve it; only the approved plan is searched.
2. **Search:** OpenAlex (by meaning and by keywords) and Semantic Scholar, plus PubMed, arXiv and CORE; the 30 closest papers
   kept, every DOI and retraction checked.
3. **Compare and insights:** how close each paper is to each part of the idea, with checked quotes; what is already done, the
   gaps, what was tried; an answer to your question; a downloadable report.
The page lists every search that ran and says that not finding a paper is not proof it does not exist. **Nothing is stored.**

## 5. My Workspace (`/papers`) and the reader

- **Upload** PDFs (up to 30 papers of 25 MB each). The browser reads the text; title, DOI and reference list are found.
  Cards with cover, status (to read, reading, done), tags, progress; search across your papers.
- **Scanned PDFs** are read by two AI vision models that check each other (60 pages a day); pages they disagree on are marked
  and left out of answers.
- **The reader:** full screen or with a side panel; zoom; Find in the paper; reading position remembered; a round back button.
- **Ask the paper:** answers with the page and the exact quote, each quote checked against the paper's text; "Ask your
  highlights" asks about what you marked.
- **Highlights and notes** by colour; notes can be exported (Markdown).
- **Drawing:** pen, highlighter, eraser, line, arrow, box, circle, text, sticky note, lasso select; four sizes, colours; undo
  and redo (buttons, Ctrl+Z, Ctrl+Shift+Z); saved to your account. An **annotated PDF** with your marks can be downloaded.
- **Offline reading** (Settings): the ten latest papers, your notes and drawings kept on the device; drawings made offline are
  sent when back online.

## 6. Ask this paper (open access)

On any search result with a DOI or arXiv number. The first time a paper is asked it is read for everyone (up to a minute, the
page can be closed): from Europe PMC XML, arXiv, or the free PDF OpenAlex lists. Answers quote the paper with the **section** or
**page**, each quote checked. A paper that cannot be read (not open access, blocked, a scan, over 120 pages) is answered from its
**abstract**, and the sheet says so. Signed in; 20 new papers a day per person.

## 7. Literature scan (`/literature-scan`)

Signed in, four a day. Write a topic (English, Hindi or Hinglish) and choose the answer language. The private model proposes 3
to 6 sub-questions, each with the English search words that will be sent; you edit and approve. The scan runs on the server
(you can close the page) with a board of progress. The result is a **literature review**: findings by theme, an **evidence
table** with study designs, gaps, and APA references; each answer checked against abstracts like the prompt box. Download as
Word, Markdown or CSV; share by a link (read-only, no name shown) until you stop sharing. Optional Indian sources. **Kept 24
hours**, then removed.

## 8. Library (`/library`)

Saved papers (in the browser for a visitor; in your account when signed in, and moved there when you sign in). Import is
supported, and your whole account (library included) can be exported from Settings. **Retraction alerts:** once a week each saved DOI is checked again at Crossref; if one is retracted, a notice appears on
the Library ("A paper you saved has been retracted") with Remove or Got it.

## 9. Trending (built, switched off)

A row on Home of research phrases growing faster than a year ago, with a "Why these?" panel; a chip fills the box and adds a
"Papers from 2025 or later" filter. Made from OpenAlex keywords, confirmed on arXiv for computing, maths and physics, each phrase
verified with the product's own search. **Off in production** (`TRENDING=off`): no list has been made from real data yet; it is
switched on only after the owner reads a first real list.

## 10. Account, sign-in, settings, help

- **Sign in** with Google or ORCID (no password stored). The first upload, Idea Check or literature scan asks you to read the
  privacy note.
- **Settings:** Account (sign out), Home screen, Chats (delete all chats), Your data (export everything as
  a file, delete account), theme (Light, Dark, Read), text size, offline reading, and **Connected apps** (the AI apps you allowed
  to use Sodhsetu, each with Disconnect; shown only while the MCP server lets your account in).
- **Report a problem** on any answer (30 a day), with exactly what the page says it sends.
- **Command palette** (Ctrl+K) and a list of keyboard shortcuts (?).
- **Pages:** How we verify, Privacy, Terms.
- **First visit:** a short intro film that plays at every window size.

## 10a. Sodhsetu inside AI apps (MCP server, built, switched off)

A researcher writing with Claude, ChatGPT, Cursor or VS Code adds `https://sodhsetu.in/mcp` as a connector. The app sends them to
Sodhsetu, they sign in with Google or ORCID as on the website, and a consent page names the app and what it may do (Allow or
Deny). After that the app can ask Sodhsetu, by itself, to:

- **search_papers:** find 1 to 20 real papers (query up to 300 characters, years, Indian sources), each with its DOI checked,
  retractions marked and a link to the paper on Sodhsetu;
- **verify_references:** check up to 60 references: verified, mismatch (with the fields that differ), not found or not
  checkable, with the note that "not found" is not proof the work does not exist;
- **check_retractions:** say which DOIs are retracted, with the notice;
- **ask_paper:** ask one paper (by DOI or arXiv id) a question: an answer with a checked quote and its section or page; from the
  abstract when the paper is not open access, and it says so;
- **get_library / save_paper:** read your saved papers, and save one only after you said yes (only for an app that asked for
  library access, and the consent page says so);
- **check_claim** (behind its own switch): say whether up to five papers' abstracts support a claim: supported, partly, not
  supported or cannot check, with the sentence that shows it.

The tools never write paragraphs or run Idea Check or a literature scan, and nothing works without sign-in. Limits: 300 tool calls
a day per account plus the website's per-minute limits; ask_paper and check_claim use the daily AI allowance and ask_paper the 20
new papers a day. Only counts are kept (which tool, which app, how long, whether it worked), never what the app sent. Disconnect an
app any time in Settings, Connected apps. **Off in production** (`MCP` unset): it needs the `OAUTH_KV` namespace, its privacy
sentence read, and then `MCP=beta` for a list of accounts.

## 11. Admin (`/admin`, admins only)

Usage and cost (tokens per call, the daily allowance), how answers ended, cache hits, scheduled jobs and their heartbeats,
integrity checks, feedback, erase an account, re-apply deletions after a restore, send a test error to monitoring, the Understand step's counts (calls, intents, fallbacks, latency, shadow agreement) and the
AI apps (MCP server) panel (tool calls by tool and app, outcomes, time). Numbers only: no text of anyone's questions.

## 12. Limits at a glance

| Limit | Value |
|---|---|
| A search message | 300 characters (a pasted list up to 20,000 in Auto) |
| AI allowance | 60,000 tokens a day per person |
| References per check | 60 |
| Uploaded papers | 30 per person, 25 MB each |
| Scanned pages | 60 a day |
| New open-access papers read | 20 a day per person, 300 for everyone |
| Literature scans | 4 a day, kept 24 hours |
| Reports | 30 a day |
| Rate limits per address | search 60/min, reference checks 120/min, asks 20/min, other API 240/min |
| AI apps (MCP), when on | 300 tool calls a day per account; up to 20 papers per search, 60 references per check, 5 DOIs per claim |
| The Understand step for a visitor, when on | 40 a day per address |

## 13. Built but switched off (waiting for a decision or a privacy sentence)

| What | Why it is off |
|---|---|
| Counting message shapes (R3) | its privacy sentence is written and waits for the owner's read |
| Safety lane for emergencies and self-harm (R4) | recall on unseen messages is below the gate; needs a clinician's messages, checked helpline numbers, a native reader |
| Request cleaner: "Can you search about ... all papers" becomes the topic, with "Left out" (R8) | needs its privacy sentence and the owner's go |
| Relevance tiers, no answer over a list with no strong paper, "No paper matches ... closely" (R9) | to be switched on in steps after the counts |
| A follow-up whose model call failed gets no written answer (R5) | waits with the counters |
| Trending row | no real list read yet |
| The Thinking block (M2, `CHAT_THINK`): lines from the real counts of each stage ("Searched for ...", "5 sources answered with 47 records ...", "Reading 3 abstracts", "1 claim read ...: 1 kept"), open while working, folded into "Thought for 14 s · 1 search · 5 papers" | goes on only a day after the build is live (old tabs) |
| The Understand step (M4/M5, `CHAT_UNDERSTAND` shadow then on): one private model call decides what a message is: conversation (a short reply, no search, no citation), a new search, a change to the last search ("sirf 2020 ke baad", a year chip), a question about the papers above ("dusre paper ka dataset kya hai?", answered from those papers' abstracts, looked up again by DOI, no new search), another tool (a card, the literature scan included), or one question back with choices and "Search anyway". Greetings, DOIs and reference lists are settled without a model; when the model cannot be used the rules decide and the reply says so | needs its privacy sentence (the ledger is sent from shadow on), then 1-2 weeks of shadow counts |
| The Understand step for visitors (`CHAT_UNDERSTAND_VISITORS`): 40 readings a day per address, then the rules and "Sign in for more" | needs its own privacy sentence |
| The MCP server for AI apps (section 10a; `MCP` off/beta/on, `MCP_BETA_USERS`) | needs the `OAUTH_KV` namespace, its privacy sentence read, then a beta for listed accounts |
| The `check_claim` tool (`MCP_CHECK_CLAIM`) | its eval passes (no unsupported claim called supported), but 12 of 210 live calls failed to cannot_check; the owner decides |

Being built (not on `main`): a "Did you mean: ..." spelling chip (R12) and leaving e-mail addresses, links and phone numbers out
of what is searched (R11).
