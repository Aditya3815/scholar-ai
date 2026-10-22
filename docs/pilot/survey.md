# Pilot survey

Five questions, three minutes, to be sent after a week of use. Build it as a Google Form (free, results go to a Google Sheet you own). Written for you to copy into the form; the
wording of each question is the text the scholar sees.

## Make the form (10 minutes)

1. forms.google.com → **Blank form**. Title: "Scholar AI pilot: five questions". Description: "Thank you for trying it. Five short questions; you can leave any blank. Your answers are read by one person and are quoted anonymously, if at all."
2. Settings: turn **off** "Collect email addresses" and **off** "Limit to 1 response" (that setting forces a Google sign-in). You do not need to know who answered which; the optional last question asks for contact only if they choose.
3. Add the questions below, in this order, with these types. Mark only question 1 as required.
4. **Responses** tab → link to a Google Sheet. Send yourself one test answer and open the sheet to check it arrives.
5. **Send** → copy the link (the short one) into `[SURVEY LINK]` in [invite.md](invite.md).

## The questions

**1. Which parts did you use? (required)** Checkboxes: Search for papers · Verify references · My papers (upload and ask) · Notes and highlights · Idea Check · None, I could not get started

> Why: tells you what was reached at all. Anyone who ticks "could not get started" is a priority reply.

**2. Did it save you time, or show you something you would have missed?** Multiple choice: Yes, clearly · A little · No difference · It cost me time. Then a short-answer box: **"What was the example?"** (optional)

> Why: the single best measure of value. The example is what you quote back to the next ten people.

**3. Did you see anything wrong or misleading?** Multiple choice: Yes · Not that I noticed. Then a paragraph box: **"What was it, and where? (a reference, an answer, a search result, an Idea Check)"** (optional)

> Why: a wrong "verified" or a wrong answer shown as right matters more than anything else. Anything here that was not also sent with Report a problem, reproduce yourself the same day.

**4. Would you use it next week for your own work?** Multiple choice: Yes · Maybe · No. Then a short-answer box: **"Why?"** (optional)

> Why: intent to return is a better signal than rating. "Maybe" with a reason is the most useful answer you will get.

**5. If we could fix or add only one thing first, what should it be?** Paragraph box (optional)

> Why: gives you the top-five list without guessing. Count the repeats.

**Optional: may I contact you about this? Add an e-mail address or number if you do not mind a 15-minute call.** Short answer (optional).

> Why: the only place a contact is collected, and only if they offer it. Delete it from the sheet after the call.

## How to read the answers

- Count, do not average: how many ticked each part in question 1, how many said "Yes, clearly" or "A little", how many "Yes" to question 4.
- Copy every example from question 2 and every item from question 3 into a list. Group by cause. The groups with two or more people are the backlog.
- Compare question 3 with `/admin` reports: a problem someone wrote here and did not report there means the button is not obvious enough; note it.
- Put counts, not names, in the roadmap log. Keep the sheet private (it is not in this repository), and delete it when the pilot is closed.

## What would count as a good pilot

Not a number, but these three together: most people got started (question 1), at least a third can name something it saved or showed them (question 2), and the list of wrong or misleading things (question 3) has been fixed or explained
before the next group is invited. One serious wrong result found and fixed is a better outcome than a pilot with no complaints.
