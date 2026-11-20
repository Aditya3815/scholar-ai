# Live presence and live updates in a shared paper

Date: 20 Nov 2026. The owner tested sharing and asked for three things:
- See **who is editing**.
- See **who is viewing, and which page** (of the paper or of the notes).
- See **other people's changes without reloading**.

All of it has to look clean and classic.

Today:
- A notebook page saves with a revision number, and a conflict is merged by block id (paper-reader.md, section 19).
- Another window learns about a change only when it saves, or when it reloads.
- Highlights and comments refresh only on reload.

## 1. What people see

### Presence row
- **Where:** a row of small avatars (initials in our tokens) in the reader's header, beside Share. Up to 4 avatars, then "+N".
- **Tooltip and popover, per person:** their name, then what they are doing:
  - "Editing *Methods*" (a notes page);
  - "Viewing p. 3" (the paper);
  - "In Comments".
- **Status dot:** a green dot means active in the last 30 s. Idle people fade out after 2 min.
- **Your own avatar:** never shown.
- **On a phone:** one stacked avatar with a count, and tapping it opens the list.

### In the notes
- A notes page tab that someone else has open carries their small avatar.
- A block another person is typing in gets a thin coloured left edge with their initial, "Ravi is editing". Each person gets one colour from a fixed palette of 6 token colours that pass contrast, assigned by their order in the share.
- No live character-by-character cursor. Section 4 says why.

### In the paper
- The thumbnail of a page someone is reading gets their avatar dot.
- "Follow" is in the popover: click a person, "Go to where Ravi is". This is an optional jump, never automatic.

### Live updates
- **Changed notes page, unchanged locally:** when someone saves a notes page, every open copy of that page updates within about a second, with no toast.
- **Changed notes page, typed in locally:**
  - A block that only the other person changed comes in.
  - A block both of you changed keeps yours and shows "Updated from another window"-style choices, as today.
- **Highlights, comments, comment resolve and page list:** new highlights, comments and page renames, reorders and deletes appear live.
  - New comments in a thread you have open slide in.
  - The Comments icon's count updates.
- **Disconnects:** a quiet "Reconnecting…" shows only after 5 s without a connection. When the connection comes back, the reader fetches what it missed.

## 2. How it works (Cloudflare, nothing new to sign up for)

**One Durable Object per paper**, `PaperRoom`, using the Hibernatable WebSockets API:
- The DO is not billed for duration while idle.
- The project already runs two SQLite-backed DOs. This adds a class: wrangler migration tag `v3`, `new_sqlite_classes: ["PaperRoom"]`.

**Connecting:**
- The page opens `GET /api/v1/documents/:id/live` and upgrades it to a WebSocket.
- The Worker checks the person's access to the paper with the same `requirePaper` gate (Viewer or above) and the same origin rule.
- The Worker then forwards the request to the room, with the person's id, display name and role in a signed internal header. The client never chooses its own identity.

**Messages:** small JSON, at most 2 KB each, rate-limited per socket to 20 per second.

- **Client to room:**
  - `here {view: "paper"|"notes"|"comments", page?: number, notesPage?: id, editingBlock?: id}`, sent on change and every 20 s as a heartbeat.
- **Room to clients:**
  - `presence [{id, name, initial, colour, role, view, page, notesPage, editingBlock, idle}]`, broadcast on change.
  - `changed {kind: "notebook"|"highlights"|"comments"|"pages", id?, rev?, by}`. This is only a **signal**, never content. The client then fetches the changed thing through the normal REST routes, so every role check stays on those routes.

**Server routes that publish:** when a write succeeds (notebook PUT/PATCH/DELETE, highlight create/update/delete, comment create/edit/delete/resolve), the Worker calls the room with `ctx.waitUntil(room.publish(...))`. A failure there never fails the write.

**Access changes:** removing a person, stopping the share or deleting the paper closes that person's sockets with code 4403. Their page shows the existing "You no longer have access" state.

**Nothing is stored:** presence lives only in the DO's memory and socket attachments, so it is gone when everyone leaves. There is no log of who viewed what.

**Switches:** behind `SHARE` (presence only matters with more than one person). The owner's own second window also gets live updates. A new switch `LIVE` (off|dark|on) lets it roll out separately; it can be on only when `SHARE` is on.

## 3. Privacy

Presence shows the other people on a shared paper what you are looking at right now. That is new, so the privacy page needs words, which the owner reads first. Draft:

> **Seeing each other on a shared paper.** While you have a shared paper open, the people it is shared with can see your name, which page of the paper or of its notes you are on, and which note you are typing in. This is shown only while you are there and is not kept.

## 4. Why not live character-by-character editing (now)

**Our notes are not built for it:**
- A text block is Markdown saved per page with a revision number.
- Live co-typing in one block needs a CRDT (Yjs or Automerge, about 30 KB or more gzip, plus a different storage shape), which is a large change to the notebook.

**What we do instead:**
- Block-level live updates plus the "editing" marker cover the real use: supervisor and student, or two co-authors, working on different blocks.
- The marker stops people stepping on each other.
- If the owner later wants Google-Docs-style co-typing, it is a separate phase: Yjs in the DO, per block.

## 5. UI quality bar

- **Visual style:**
  - Our tokens only; Light, Dark and Read.
  - The avatars are 24 px with a 2 px ring in `--surface` so they stack cleanly.
  - Motion is a 150 ms fade, and there is none with reduced motion.
- **Accessibility:**
  - The presence row is a button, labelled "3 people here".
  - The popover is a list.
  - Live updates are not announced, except a polite "Ravi added a comment" when the comments panel is open.
- **No layout shift:** the row reserves its width.

## 6. Tests

- **Unit:**
  - message validation;
  - the presence reducer (join, leave, idle, page change);
  - the colour assignment;
  - the rate limit.
- **API** (`scripts/live-e2e.mjs` in the run `share-on`):
  - two sockets, owner and commenter, with presence both ways;
  - a viewer cannot publish `editingBlock`;
  - a write publishes `changed`;
  - removing a member closes their socket with 4403;
  - stopping the share;
  - no connection without access (401 or 404 before the upgrade).
- **Browser** (`e2e/live.mjs`):
  - two browser contexts, owner and editor, on one paper;
  - the avatar appears;
  - the "Viewing p. 3" text;
  - editing a block shows the marker on the other side;
  - a saved block appears without a reload;
  - a comment appears without a reload;
  - axe in three themes;
  - phone.
- **Load:** 20 sockets on one room stay under the DO's limits (about 32,768 connections; we cap a room at 50).

## 7. Phase

One PR behind `LIVE`, owner-only (dark) first, like the reader. The size is M.

## 8. Live as built (20 Nov 2026)

Built on the branch `reader-live` (from main bdc81d3 and this plan), behind `LIVE`, which is not set in `wrangler.jsonc`: production connects nothing. Where the build differs from the sections above, or adds to them:

**The switch.** `LIVE` is a gate with `off`, `dark` and `on` (its row in `platform/switches.ts`; the switch table gained LIVE's rows, no other row changed). It needs SHARE: with SHARE off it is off. `dark` reads `SHARE_BETA_USERS` (the owners who may share at SHARE dark) rather than a list of its own: one secret fewer to keep, and the papers that can be shared are the ones that can be live. With LIVE off, `GET /api/v1/documents/:id/live` answers 404 to everyone, no write calls a room, and `GET /documents/:id` has no `features.live` (the route-guard table gained the route's row, all 404).

**The room.** `docs/live-room.ts` (`PaperRoom`, wrangler migration `v3`, `new_sqlite_classes`, in the top level and staging) with hibernatable WebSockets; its pure heart is `docs/live-presence.ts` (the reducer, the colours' order, what an access change closes, the token bucket), tested in node. Nothing is written to storage: who is where lives in each socket's attachment.
- **Joining** (`docs/live.ts`, `joinRoom`): in this order, before the upgrade: LIVE off 404; another origin 403 (a browser always sends Origin with a WebSocket; it is a GET, so the mount's check of writes does not see it); the one gate, Viewer up (401, 404); a visitor by the link who is not signed in 401 ("Sign in to see who is here": the room shows names, and a visitor has none); LIVE off for this owner 404; not an upgrade 400. The share-roles table states the route (Viewer) and this one exception.
- **Identity**: the plan's "signed internal header" is a header the Worker writes on a request it makes itself (`new Request("https://paper-room/connect")`); the page's request never reaches the room, so nothing it sends can name someone else, and no secret is needed. The name is the account's name ("Someone" without one), never the e-mail address.
- **Colours**: the owner 0, the people named 1, 2, … in the order they were invited (a tie by the row's order), a person by the link from their id; six colours a theme in `live.css`, each with its initial at 4.5:1 or more and the colour itself at 3:1 or more on the surfaces (`live-colours.test.ts`).
- **Messages**: `here` (read by `readLiveHere` in shared: unknown fields dropped, a wrong one refuses the message), at most 2 KB (over it the socket closes with 1009), 20 a second per socket (dropped past it; 60 drops in a row close it with 1008). A Viewer's or a Commenter's `editingBlock` is dropped by the room. Presence is one entry a person (their windows folded), sent only when it changed; a socket silent for 65 s counts as idle. The cap is 50 sockets a room (429).
- **Writes that signal** (after the response, `waitUntil`; a room that does not answer is logged and never fails the write): a notebook PUT (`notebook` with the page's id and rev; a new page is `pages`), PATCH and DELETE (`pages`), a highlight's create, change and delete (`highlights`), a comment's create, edit, resolve and delete (`comments`).
- **Access changes**: removing a person and Leave close that person's sockets with 4403; Reset link and Restricted close the link's; a change of the link's role and of a person's role close with **4001** (the page connects again at once, with the new role); Stop sharing closes everyone but the owner; deleting the paper (also as part of deleting the account) closes everyone; deleting a member's account closes their sockets on the papers shared with them. Not done: a session that only runs out, and a switch lowered by KV, leave open sockets until they close (the content routes refuse them at once).

**The page.**
- `lib/live.ts`: the client (a plain object with its socket and clock handed in, tested in node): reconnects after 1, 2, 4, 8, 16 then 30 s (with up to a fifth more at random), "Reconnecting…" only after 5 s without a connection, a heartbeat every 20 s, active (a key, the pointer, a scroll in the last 30 s) and idle (2 minutes, or the tab hidden), and on coming back it fetches what it missed (highlights, comments, the notes). A 4403 stops it and the reader asks for the paper: a 404 shows "You no longer have access to this paper. Ask the person who shared it if you need it again."; a paper that still opens (the person kept the link) connects again.
- The lazy `live` chunk (`desk/live/Live.tsx`, `live.css`): the presence row (avatars 24 px with a 2 px `--surface` ring, up to 4, then 3 and "+N"; a green dot for active, faded when idle; one avatar with a count on a phone), a button "1 person here" opening a list ("Editing Methods", "Viewing p. 3", "In Comments", "Away · …", and "Go to where Ravi is"), the dots on a notes page tab and on a thumbnail (said in the tab's and the thumbnail's labels), and "Ravi is editing" with a 3 px edge on the block. The row's width is kept from the first paint (an empty placeholder of the same width while the chunk arrives), so nothing moves. Motion is a 150 ms fade, none with reduced motion.
- **Live updates**: an Editor's notebook store gained `refresh(hint)` (lib/notebook.ts): a page this window has not changed is replaced, one it has changed is merged by block id (`mergeBlocks`, and the existing "Updated from another window" when both changed a block), new pages come in, a page deleted elsewhere goes unless this window has writing in it, and its own save's signal fetches nothing. A Viewer's or Commenter's read-only notes read the pages again. Highlights (`useNotes().reload`) and comments are read again; with the comments open, "Ravi added a comment" is announced politely.
- The viewer gained one slot (`thumbMark`) and the Notebook one prop (`live`); both are absent while LIVE is off.

**Weight** (on main 4cfe65f, after phase 3). The first load grew by 7 bytes of script (241,486 to 241,493 bytes gzip; style unchanged at 24,241). The `live` chunk is 4.3 KB of its 5 KB budget line (on the HEAVY list); Desk grew 24.6 to 25.8 KB of 28, the Notebook 15.1 to 15.4 KB of 16, DocWorkspace 17.6 to 17.8 KB. No new dependency (the API suite uses undici's WebSocket, already the root's).

**Privacy.** The words of section 3, as the owner approved them on 20 Nov, are a bullet "Seeing each other on a shared paper." under "Sharing a paper", with a "Latest change (20 November 2026)" line; `PRIVACY_VERSION` 2026-11-draft-22, on top of phase 3's draft-21 (now "Change before it (19 November 2026)"), draft-21 retired. The LIVE row of `FLAG_SENTENCES` is pinned at `off`, `dark` and `on`; drop `off` once LIVE is on in production.

**Tests.** Unit: shared `live.test.ts` (message validation, colours, words), API `docs/live-presence.test.ts` (the reducer: join, leave, idle, page change, folding; what each access change closes; the rate limit), the switch table, the route-guard and share-roles tables; web `lib/live.test.ts` (the client: heartbeat, idle, reconnect and its line, 4403 and 4001), the store's refresh (`notebook.test.ts`), the colours. API: `scripts/live-e2e.mjs` in the run `share-on`, which now also sets LIVE on (49 checks: the door before the upgrade, two sockets both ways, a viewer and a commenter cannot type, every write's signal and no content, 2 KB, 20 a second, 20 sockets in one room, 4001 on a role change, 4403 on removal, Stop sharing and the paper's deletion). Browser: `e2e/live.mjs` in the same run, 30 checks (two contexts, owner and editor: the row and its width, 24 px and the ring, "Viewing p. 2/3", the thumbnail and tab dots, "Bela Editor is editing" with its edge, a saved block and a comment without a reload, both typing in one block, "Go to where", axe in Light, Dark, Read and on a phone, the phone sheet, "Reconnecting…" only after 5 s with the socket dropped by Playwright and back; pictures with `LIVE_SHOTS`).

**After the pictures (20 Nov).** The list is placed under its button by script (fixed, kept inside the window; a sheet across the width on a phone): placed by CSS alone, on a phone it covered the header. The block's edge is a straight 3 px bar (an inset shadow on the rounded block drew a bracket). A notes page this window does not know (its notes not loaded) is "Editing the notes", not "Untitled page".
