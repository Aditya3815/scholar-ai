# Invitation texts

Written for the scholars and professors you invite, not for you. Replace `[YOUR NAME]`, `[SURVEY LINK]` and, if you want, the greeting. The reply address
is the contact address already in the app (`atiadi@nativeorange.ai`). Nothing here promises more than the app does; if you change a sentence, keep it that way.

## Email (for people you write to)

**Subject:** Would you try a research tool I am building? (20 minutes, honest feedback wanted)

Dear [Name],

I am building **Scholar AI**, a research assistant for Indian PhD and MTech scholars and their supervisors, and I would value your honest view of it. It is a pilot with about ten people.

What it does, in plain terms:

- **Find papers** across OpenAlex, Semantic Scholar, Crossref and PubMed, with every DOI checked and retracted papers flagged.
- **Verify references.** Paste a reference list and it tells you which ones exist and which could not be found. It never invents a citation: if it cannot find something it says so.
- **Ask your own paper a question.** Upload a PDF and ask; every answer shows the passage it came from, and an answer that its source does not support is not shown as an answer. You can highlight and add notes in the reader.
- **Idea Check.** Describe your research idea; it plans a literature search (you approve what is searched), then shows the closest papers and how each part of your idea compares with them, with the exact sentence for every match. It does not tell you whether an idea is new; it shows what already exists so you can judge.

What I would like from you: use it on **your own real work** for a week, even for 20 minutes, and tell me where it is wrong or useless. If you try only three things:

1. Paste ten references from a paper you are writing into **Verify references**.
2. Upload one of your own papers (a text PDF) in **My papers** and ask it something you know the answer to.
3. Describe a research idea in **Idea Check** and see whether the closest papers include what you expected.

If something is wrong, press **Report a problem** on that answer or reference. It sends only what you choose to send, and I read every report.

Your side of the bargain, kept simple:

- Your papers and questions are private to your account. A private AI service (Cloudflare Workers AI) reads them to answer; they are **never used to train AI and never sent to any other AI service**. You can delete a paper, or your whole account, at any time in Settings.
- Your idea text in Idea Check is **not stored**.
- You sign in with Google or ORCID. I see how many people use it, not what they upload.

Honest limits for now: scanned PDFs (page images) are not supported yet, tables are read as plain text, and search covers what OpenAlex, Semantic Scholar, Crossref and PubMed index (Idea Check also looks in arXiv), which means not every regional journal and not theses. It is a pilot: some things will be rough, and the privacy and terms pages are drafts.

Link: **https://scholar.shodhsetu.workers.dev**

After a week, a **three-minute survey** (five questions): [SURVEY LINK]. You can also just reply to this email. I will answer within a day.

Thank you,
[YOUR NAME]
atiadi@nativeorange.ai

## Short message (WhatsApp or chat)

Hi [Name], I am building a research tool for scholars (find papers with checked DOIs, verify a reference list, ask questions of your own PDF with the source sentence shown, and check your idea against existing literature). Would you try it on your own work for a week and tell me honestly what is wrong or useless? Takes 20 minutes to start: https://scholar.shodhsetu.workers.dev (sign in with Google). Your papers stay private and you can delete everything any time. After a week, a 3-minute survey: [SURVEY LINK]. Questions: reply here. Thanks!

## Hinglish version of the short message

Hi [Name], main scholars ke liye ek research tool bana raha hoon: papers dhundhna (DOI checked), reference list verify karna, apni PDF se sawaal puchna (jawab ke saath uska source sentence dikhta hai), aur apne idea ko existing literature se compare karna. Kya aap ise apne kaam par ek hafte try karke bata sakte hain ki kya galat ya bekaar laga? Shuru karne me 20 minute lagte hain: https://scholar.shodhsetu.workers.dev (Google se sign in). Aapke papers private rehte hain aur aap kabhi bhi sab delete kar sakte hain. Hafte ke baad 3 minute ka survey: [SURVEY LINK]. Koi sawaal ho to yahin reply karein. Shukriya!

## Nudge on day 3 (if they have not tried it)

Hi [Name], a gentle reminder about Scholar AI. If you only have five minutes: paste a few references from a paper into **Verify references** and tell me whether the result matched what you know. If something blocked you (sign-in, a confusing page), tell me that too; that is exactly what I need to hear.

## Thank-you and survey on day 7

Hi [Name], thank you for trying Scholar AI this week. Here is the short survey (five questions, three minutes): [SURVEY LINK]. If you found something that was wrong, I would much rather hear it twice than not at all.

## Questions people will ask

**Who can see my papers?** Only you. The text read from your PDF and your questions are private to your account. Nobody else can see them, and I see counts, not content.

**Is my paper used to train AI?** No. A private AI service reads the relevant passages to answer your question and does not use them for training; they are not sent to any other AI service.

**Is the idea I type into Idea Check stored?** No. It is read once to plan a search and is not kept. Before anything is searched you see exactly what will be sent to OpenAlex and Semantic Scholar; your idea and file are not part of it.

**How do I delete my data?** Settings and data: delete one paper from its card, or your whole account. Copies in the hosting service's database backups can last up to 30 days, then expire. You can also export everything first.

**Can it tell me whether my idea is novel?** No, and it will not claim to. It shows the closest existing papers and how each part of your idea compares, with the sentence it relies on, so that you can judge.

**It says a reference was "not found". Is it fake?** Not necessarily. Books, theses, reports, web pages and many regional journals are not in Crossref or OpenAlex. The page says when something looks like one of those. Treat "not found" as "check this by hand", not as an accusation.

**Why can I only ask so many questions a day?** Each person has a daily allowance of AI use (roughly fifteen questions, or five Idea Checks, shared). It is small on purpose during the pilot.

**Something is wrong.** Press **Report a problem** on the answer, reference or idea search, or write to atiadi@nativeorange.ai.
