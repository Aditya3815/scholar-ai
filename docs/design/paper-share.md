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
