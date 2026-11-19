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
