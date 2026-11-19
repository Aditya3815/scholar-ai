# Sharing a paper's workspace: invite people, or share a link

Date: 18 Nov 2026. On 18 Nov the owner asked for a Share option in the Paper Reader that works like Google Drive:
- invite people by e-mail as **Can view**, **Can comment** or **Can edit**;
- a shareable link;
- built with best practices.

This plan follows Drive's model and the usual security practice for share links. Sources:
- [Google Drive: share files](https://support.google.com/drive/answer/2494822)
- [U-M: best practices for sharing in Google Drive](https://documentation.its.umich.edu/node/1951)
- [Files.com: share link security](https://www.files.com/docs/sharing-and-collaboration/share-links/share-link-security)
- [Why hiding IDs wasn't enough for secure share links](https://dev.to/siddhesh_shirdhankar/why-hiding-ids-wasnt-enough-for-secure-share-links-5egj)
- [Cloudflare Email Service, Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/index.md)

On 24 Oct (my-workspace.md, section 4) we decided not to share a marked-up paper by link until there was "an explicit, revocable, read-only design". This document is that design, and it adds named people and roles.

## 1. What is shared

One **paper's workspace**:
- the PDF;
- its highlights, with their notes;
- its notebook pages (text, quotes, captures, sketches, pictures);
- its comments.

The owner's other papers, library, chats and account are never part of a share.

The things a share never gives:
- **Not shared:** the owner's Ask history and drawing on the paper (ink). These stay the owner's own. Ink can be added later as an option.
- **Not allowed:** deleting the paper, renaming it, changing its sharing, or downloading the owner's data export. These stay with the owner.

## 2. Who can open it

### 2.1 People (named access)

The owner types an e-mail address and picks a role:

| Role | Can |
|---|---|
| **Viewer** | read the paper, highlights and notebook; download the PDF (the owner can switch this off: "Viewers can download") |
| **Commenter** | everything a Viewer can, and add comments on a notebook block or a highlight, and reply to comments |
| **Editor** | everything a Commenter can, and add or change highlights and notebook pages (the merge by block id already handles two people at once), and resolve comments |

**Who counts as invited:**
- A person is the invited person when they **sign in with an account whose verified e-mail is the invited address** (Google gives a verified e-mail).
- An ORCID-only account has no e-mail, so it cannot match. The page says so: "Ask them to sign in with Google using this address."
- An address that has no account yet is kept as a pending invite. It matches the first time someone signs in with it.

### 2.2 General access (the link)

Like Drive, there are two positions:
- **Restricted (the default):** only the people above. The link works only for them, after sign-in.
- **Anyone with the link:** anyone who has the link can open it, signed in or not, as **Viewer** or **Commenter**. Commenting needs sign-in so that a comment has a name.

**Editor by link is not offered.** Edit access needs a named person. This is a deliberate step down from Drive, because a leaked link must never be able to change someone's notes.

### 2.3 The link itself

- The address is `/s/<token>`, where the token is 32 random bytes in base64url (43 characters).
- **Only its SHA-256 is stored**, so a copy of the database does not hold working links.
- The owner can **Reset the link**, which makes a new token; the old link stops at once.
- The owner can give it an expiry of 7 days, 30 days or never. The default is 30 days.
- The owner can **Stop sharing** at any time.
- Every request checks the share in the database, so a revoked link or a removed person loses access on their next request, including tabs that are already open.
- The shared page:
  - sends `Referrer-Policy: no-referrer`, so the token does not leak to other sites;
  - is `noindex`;
  - is never cached;
  - is never logged with its token (the access log keeps only the share id).

## 3. What the owner sees

The **Share** button is in the reader's header. It opens a dialog, built the same way as the Export and Agents dialogs and in our tokens:

```
Share "Glaucoma screening"
[ Add people by e-mail ………………………… ] [Can comment ▾] [Invite]
People with access
  (A) You (owner)
  (R) ravi@uni.edu        Can edit ▾   · opened 2 h ago   [Remove]
  (S) sara@lab.org        Can view ▾   · invited, not opened yet
General access
  [🔒 Restricted ▾]  Only people with access can open with the link
  …or  [🌐 Anyone with the link ▾] [Viewer ▾]  expires in 30 days ▾  [Reset link]
[ Copy link ]                                               [Done]
```

- **Inviting:** Invite adds the person and, in phase S1, copies a ready message with the link ("Copy invite"). In phase S4 it also e-mails them.
- **Feedback:** each change shows a toast, and Remove has Undo.
- **Who has opened it:** the dialog lists who opened it and when. It shows only names the owner gave access to, and never the visitors of a public link.
- **On a phone:** the dialog is a bottom sheet.
- **Accessibility:** the dialog is labelled, the role pickers are menus, and focus moves correctly.

## 4. What an invited person sees

- **Shared with me** is a new section in My Workspace, with the owner's name, the paper's title and their role.
- **Opening a shared paper** uses the same reader, marked with a banner: "Shared by Aditya · You can comment".
- **Controls by role:** only the controls the role allows are shown. A Viewer gets no tool segment, no Add to notes and no editing; their Agents button is hidden, because Ask runs on the owner's index and quota.
- **Leaving:** "Leave" removes the share from their list.

## 5. Comments (Commenter and Editor)

- A comment thread hangs on a notebook block, or on a highlight.
- A comment is plain text of at most 2,000 characters, with replies.
- The author can edit or delete their own comment. The owner and Editors can resolve a thread.
- A dot on the block shows open threads, and a **Comments** filter in the Notes tab lists them.
- The thread is stored with the paper and deleted with it.

## 6. Data

```sql
CREATE TABLE doc_shares (
  doc_id TEXT PRIMARY KEY REFERENCES documents (id) ON DELETE CASCADE,
  link_mode TEXT NOT NULL DEFAULT 'restricted',   -- restricted | anyone
  link_role TEXT NOT NULL DEFAULT 'viewer',       -- viewer | commenter
  token_hash TEXT UNIQUE,                         -- sha-256 of the link token; NULL = no link made yet
  expires_at TEXT,
  viewers_download INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE doc_members (
  doc_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  email TEXT NOT NULL,                            -- lower-cased, as typed by the owner
  user_id TEXT REFERENCES users (id) ON DELETE CASCADE,  -- set when that person signs in
  role TEXT NOT NULL,                             -- viewer | commenter | editor
  invited_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_opened_at TEXT,
  PRIMARY KEY (doc_id, email)
);
CREATE TABLE doc_comments (
  id TEXT PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  anchor TEXT NOT NULL,                           -- block:<pageId>:<blockId> | note:<highlightId>
  parent_id TEXT, user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  body TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Limits:**
- 50 people per paper.
- 200 invites a day per owner.
- 500 comments per paper.

**One gate:** every paper route asks a single `accessTo(c, docId)` function. It answers `{ role: "owner" | "editor" | "commenter" | "viewer" } | null`, and each route states the role it needs. This builds on F10's `requireUser` door, which gains an `access` field. The route-guard table gets the shared cells.

**Deleting:**
- Deleting the paper removes every share, member and comment.
- Deleting the invited person's account removes their membership. Their comments stay, with the author shown as "a former member".
- Deleting the owner's account removes everything.

**Export:**
- The owner's export lists the people they shared with and the comments on their papers.
- A member's export lists their own comments.

## 7. Privacy (the owner reads this first)

This is new data and a new flow, so the privacy page needs new words. Draft:

> **Sharing a paper.** You can share one of your papers, with its highlights and notes, with people you name by e-mail, or with anyone who has its link. We keep the e-mail addresses you add, so that the right person can open it, until you remove them or stop sharing. People you share with see the paper and its notes, not your other papers or your questions to the AI. Comments are kept with the paper and deleted with it. A link can be reset or switched off at any time, and stops working at once.

The e-mail addresses of other people are personal data about someone who has not agreed to anything. So:
- they are kept only while the share exists;
- they are never used for anything but matching that person;
- they are deleted with the share.

If e-mail sending is added (S4), the words also name the e-mail service.

## 8. Phases (behind a switch `SHARE`, off | dark | on, like READER)

| Phase | What | Needs |
|---|---|---|
| **S1** | Share dialog; named people (viewer, commenter, editor) matched at sign-in; "Shared with me"; link (restricted or anyone; viewer or commenter; expiry; reset; stop); the read-only shared reader; `accessTo` on every paper route; editors edit notes and highlights | the privacy words (section 7) |
| **S2** | Comments and replies; resolve; the Comments filter | in the S1 words |
| **S3** | "Opened" times, Leave, "Viewers can download" | in the S1 words |
| **S4** | Invitation **e-mails** through Cloudflare Email Service (`send_email` binding, the sender domain sodhsetu.in onboarded) | **the owner's OK to create the Email Service resource** and the DNS records it asks for; a privacy line naming the service |

Until S4, Invite copies a ready message ("I've shared 'Glaucoma screening' with you on Sodhsetu: <link>. Sign in with Google using this address."), which the owner sends by their own mail.

## 9. Tests

- **Unit:**
  - `accessTo` for every role, an expired link, a reset token, a removed member;
  - the token: hashed storage, constant-time compare, 43 characters;
  - the limits.
- **API (`scripts/share-e2e.mjs`):**
  - invite, then sign in as the invited e-mail;
  - each role against each route (a role table like F10's);
  - stop sharing ends an open session;
  - a link with "anyone", signed out;
  - expiry;
  - delete the paper or the account;
  - the export.
- **Browser (`e2e/share.mjs`):**
  - the dialog, on desktop and phone;
  - the shared reader per role;
  - comments;
  - axe in the three themes.
- **Pictures for the owner before any push.**

## 10. As built (18 Nov 2026)

Built on the branch `reader-share` (on main 8468de9, after phase 2.5; the migration is `0030_doc_share.sql`), behind `SHARE`, which is not set in `wrangler.jsonc`: production has none of it. Where the build differs from the sections above, this is what was done and why.

**The switch.** `SHARE` is a gate with `off`, `dark` and `on` (its row in `platform/switches.ts`; the switch table gained its rows and no other row changed). `dark` reads `SHARE_BETA_USERS` (a secret, like `READER_BETA_USERS`) and is about the **owner**: a listed owner may share, and the people they name need not be listed. With SHARE off every route of `/api/v1/share` answers 404 before anything else, the paper routes answer exactly as before (the route-guard table's old cells did not change; it gained the 15 new routes, all 404), the export has no new keys, and the page shows no Share button and no "Shared with me".

**The one gate.** `docs/access.ts` (`accessTo`, `resolveAccess`) answers `owner`, `editor`, `commenter`, `viewer` or nothing, and `docs/paper-gate.ts` (`requirePaper`) is the door of every paper route: F10's `requireUser` for the person (its words and order: sign-in, then the privacy note), then the gate with the role the route states. No role: 404 with the route's own words (a paper not shared with someone does not exist for them); a lower role: 403. `requireUser` itself is unchanged (it gained no `access` field): the paper door wraps it, so the other features' doors are untouched. The roles per route are a table test (`docs/share-roles.table.test.ts`: 39 routes times 8 kinds of person, with SHARE and READER on). Reading (the paper, file, cover, highlights, notes, comments) needs Viewer; Ask, Ask about highlights and writing comments need Commenter; highlights and notebook pages need Editor; everything else (rename, delete, cover, info, status and tags, reading place, indexing, scans, drawing, the Share dialog) is the owner's. A shared person's `GET /documents/:id` has no question history, scan allowance, tags, status or reading place, and `GET /ink` answers no strokes (the drawing is not shared).
- **Ask for Commenters and Editors** runs on the asker's own daily allowance (they are signed in) and is not kept in the owner's question history; a Viewer has no Agents. The plan only said a Viewer has none; this is the decision for the others, for the owner to confirm.
- **Matching an invitation**: an account whose verified e-mail is the address (`users.email_verified = 1`) is bound to the invitation the first time it asks for anything (the paper, "Shared with me"), not in the sign-in callback; the binding is kept, so a later change of address does not move it.

**The link.**
- The token is never in an address the Worker sees. `/s/<token>` is a static page (`public/_headers`: noindex, `Referrer-Policy: no-referrer`, `no-store`; `/papers/*` is noindex too); it sends the token once in the body of `POST /api/v1/share/open`, which answers the paper's id and sets an **HttpOnly, SameSite=Strict cookie** `shr_<paper id>` (path `/api/v1`, as long as the link, 30 days at most). The page then goes to `/papers/<id>` (`history.replaceState`), so the token leaves the address bar and the history. Every request reads the share again and compares the SHA-256 in constant time, so Reset, expiry, Restricted and Stop end an open tab on its next request. The access log keeps the path only, which never holds a token or an address.
- **Copy link**: only the hash is kept, so the server cannot say the link again. The owner's browser keeps the token it was shown (`localStorage`, `scholar.share.<paper>`); on another device the dialog says to Reset the link to copy a new one there. With Restricted, Copy link copies `/papers/<id>`, which works for the people named, after sign-in.
- "Viewers can download" hides the Download menu for a Viewer. The PDF must still reach their browser to be shown, so this is a courtesy, not a lock (as in Drive).

**People.** `doc_members` has an `id` of its own (random) besides the plan's key: the routes name a person by it, so an address is never in a path (paths are logged). Leave and Remove take the address away. Undo of Remove puts the person back with `restore: true`: not counted again, not e-mailed again. The 200 invitations a day are counted in `share_daily` (a removal does not give one back), purged after two days.

**E-mail (S4).** The `send_email` binding `EMAIL` in `wrangler.jsonc` (production only; staging has none, and its dialog copies the invitation instead), sent from `Sodhsetu <invites@notify.sodhsetu.in>` through a small port (`docs/invite-mail.ts`): plain text and simple HTML with the paper's title, the inviter's name, the role and the link (`/papers/<id>`), never a note or a comment; a failure is logged by its kind only. A test run (`QA_STUB=1`) uses a stand-in. One e-mail per invitation, Resend at most once an hour (claimed in one statement, so two clicks send one).

**Comments (S2).** One level of replies (a reply to a reply joins the same thread); a reply opens a resolved thread again; deleting a thread's first comment deletes its replies. The author edits and deletes their own; the owner may delete any; the owner and Editors resolve. A comment must hang on a highlight or a block that exists. In the reader the comments live in the Notes tab: a **Comments** button over the notes (with the number of open threads) lists every thread (Open, Resolved, All); a highlight's card has Comment (or its number), a highlight's pop-up has Comment, and a block shows a dot with its open threads and has Comment in its menu (Editors and the owner) or a comment button (Viewers and Commenters, whose Notes tab is a read-only view of the pages).

**Roles in the reader.** Viewer and Commenter: no tool segment, a pop-up with Copy (and Explain and Comment for a Commenter), read-only highlight cards and notes, no renaming, no status or tags; the Viewer has no Agents. Editor: Select and Highlight (no Draw), the full Notebook. The banner says "Shared by <owner> · You can view / comment / edit", with Leave for a named person.

**Deleting and the export** are as section 6. Deleting a member's account also removes an invitation still waiting for its verified address. The export's two new keys (`sharedPapers`, `myCommentsOnSharedPapers`) are present only when there is something in them.

**Weight.** The Share dialog (5.4 KB), the comments and read-only notes (4.6 KB, with the stylesheet `share.css` shared with the dialog) and the two small pieces ("Shared with me" and the link opener, 1.2 KB together) are chunks of their own with budget lines and are on the HEAVY list. The first load grew by 0.33 KB of script and 0.06 KB of style. Two things got it there: the share client does not import `docs-api` (it cut that module out of the first load into a chunk of its own), and the lazy pieces use no icon the first load also uses (each such icon became a chunk of its own). No new dependency; the layer allowlists did not grow.

**Privacy.** The words of section 7 and the line about the e-mail service are on the page (`PRIVACY_VERSION` 2026-11-draft-20, "Latest change (19 November 2026)"; phase 2.5's pictures, draft-19, are the change before it), with a row in "What we keep" and Cloudflare's line under the service providers. As READER's, the SHARE row of `FLAG_SENTENCES` is pinned at `off`, `dark` and `on`; drop `off` once SHARE is on in production.

**Tests.** Unit: the gate for every role, a pending and an unverified address, an ORCID account, a removed person, Stop, the switch's positions, a restricted, expired, reset and wrong link (`docs/access.test.ts`); the limits, Resend, comments, deleting and the export (`docs/share-store.test.ts`); the e-mail (`docs/invite-mail.test.ts`); the role table above. API: `api/scripts/share-e2e.mjs`; browser: `web/e2e/share.mjs` (it also takes the pictures with `SHARE_SHOTS=<folder>`), both in the named run `share-on` (SHARE and READER on), which `ci.yml` and `browser-e2e.yml` now run.

**After the review of the pictures (19 Nov).**
- The dialog's head and footer always show and its body scrolls between them (`max-height: min(90dvh, 720px)`, on a wide screen and as the phone's sheet); checked at 1280 by 720 and 390 by 700. Its menus are placed in the window under (or over) their button and follow it when the body scrolls, so the body never cuts one off.
- One structure: Add people, People with access, General access (with "Viewers can download"), then the footer. What a change did is one quiet line in the footer (with Undo after Remove), no longer a bar at the top; changes the menus already show (general access, the link's role, its expiry) are not said again.
- "Loading the notes…" in the Commenter's picture was the picture being taken while the notes were read again (the read-only notes were drawn afresh on coming back from the comments). The pages read are now kept for the visit and drawn at once; the browser suite checks that a Viewer's and a Commenter's Notes tab show the owner's page, and that an Editor's is the notebook. The read-only notes no longer stretch to the panel's height.
