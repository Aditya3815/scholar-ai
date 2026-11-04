# Writing the test sets for understanding messages: a guide for the people who write them

Draft of 4 Nov 2026, for review. Part of E0 in [intent-and-state.md](../design/intent-and-state.md), section 8.2. The fields follow `apps/api/eval/lib/intent-schema.ts` (the schema is the authority if this page and it ever differ).

**The clinician corrects the safety brief (section 6) before anyone writes from it.** The owner corrects anything that is not how he or his users would say it.

**This page holds all four sheets, for the reviewers. A writer is given only their own copy of it**: sections 1 to 3, their own sheet, and, for those who write safety messages, section 6 with the care notes. The lead makes the copies by cutting the other sheets out.

## Start here (one minute)

| Who | Reads | Writes | Roughly |
|---|---|---|---|
| everyone | sections 1 to 3, and the care notes in 6.6 if they write safety messages | | 15 to 25 minutes |
| **the owner** | the above, sheet O (4.3), the safety brief | 20 research messages in natural Hinglish; 20 Hinglish safety messages for the hold-out (4.7); about 35 Hinglish safety messages for the dev set (6.4); then the sealing steps (section 8) | about 230 minutes for this page's tasks alone, which is over the plan's 4 hours once the plan's other tasks for him are added (section 8 says which rows to drop first) |
| a medical student | the above, sheet M (4.4), the safety brief | 20 research messages; about 20 safety messages for the hold-out | |
| a PhD student | the above, sheet P (4.5) | 20 research messages | |
| a clinician | the above, sheet C (4.6), the whole safety brief | 20 research messages; about 20 safety messages for the hold-out; most of the dev safety set; corrects section 6 | |
| engineers | nothing here to write | **no messages, and they never read the hold-out** | |

*Hinglish mein: ye test ka kaam hai jisme product ko aise messages dikhaye jaate hain jo usne kabhi dekhe nahi. Hum (banane wale) likhenge to hum wahi likhenge jo hamare code ko aata hai. Isliye aap likhiye, apne tareeke se, jaise aap type karte ho.*

## 1. Why people write these, and not us

The product reads a message that a person typed, often in a hurry, in any of three languages, and decides what to do: search for papers, with which words, whether to ask a question first, and whether the person might be in danger and needs something else than papers. To know how well it does that, we need messages it has never been shaped for.

If the people who build the product write the test, the test comes out the way the builders think, and the product learns to pass it. It has happened here (plan 8.1): the 203-message list was tuned until it scored 100%; its 40-message hold-out stopped being a hold-out; the follow-up hold-out was read while rules were being changed; and the 185 messages of the earlier studies were written by the researchers after one example of the owner's, labelled by one rater, with titles only for most of them. A score on such a list says little.

So: **people who are not building the product write the messages, each in their own way of typing, and the final set is kept sealed (an encrypted file) so that nobody can tune to it.** The engineers never read it. If a sealed message ever has to be read (to understand a failure), only the owner reads it, and from then on it is a development message and a fresh one is written.

## 2. The rules

1. **Type what you would type.** Not what you think the product understands. Short, long, half a sentence, a typo, a word in another language, a missing question mark: all fine. Do not tidy it up, and do not add mistakes on purpose either.
2. **No writer sees another writer's list.** Do not compare, ask, or copy. The four hold-out sheets are different on purpose (the sheets are scenarios, not messages; the rule is about the messages). Do not open anyone else's file (the sealing command counts the rows without showing them).
3. **Scenarios, not example phrases.** Each sheet gives you a situation and what you want to know. Imagine you are there and type the message you would type. Do not reuse the words of the sheet unless they are the words you would really use. **Nobody translates from the sheet**: the sheet is in English, and a Hindi or Hinglish message is not a translation of it. Think the situation in the language the sheet names and type what you would type there; do not put the sheet's sentence into Hindi, and do not turn the situation into an English question first. If a scenario does not fit you at all, swap it for one of your own of the same kind and add the tag `swapped`.
4. **Do not try your message in the product first, and do not look at the product's answers.** The point is that the message is written before it is shaped by the product's quirks.
5. **No real person's text.** Not a message, mail, chat or note that a real person wrote or sent. No real patient, no real case from your own practice or family. Invent the situation. Use invented names for private people (famous authors and published works may be a topic).
6. **Nothing that identifies anyone.** No e-mail address, web address or phone number in a message: the checker rejects them. No invisible characters either: **type the message, do not paste it from a web page or a PDF**, which can bring them along.
7. **Provenance is part of the data.** Every message says who typed it, which scenario it came from and how (section 3). Messages you really typed in the past (for example into a search box or a chat) can be used **only if you say yes for each one, only your own, and only when nobody else's details are in them**; mark them `typed-past-message`. They go into your plain file like any other and are never put in the repository in plain: the only form of a hold-out that is ever committed is the encrypted file.
8. **Language.** *English* is English as you write it (Indian English included). *Hinglish* is Hindi words in Roman letters, mixed with English, as you would type on a phone. *Hindi* is Devanagari. Write each message in the language the scenario asks for.
9. **One message, one need.** A message can be one word or three paragraphs, as real ones are. Do not write two messages in one.
10. **If in doubt, make it messier, not cleaner.**

## 3. What you hand in

One row for each message. The fields, in words (the names are the schema's):

| Field | What you put | Who fills it |
|---|---|---|
| `id` | the scenario's code from your sheet, for example `HO-MED-07`: letters, digits, dot, dash and underscore only, no spaces, at most 64 characters. It is for you and for the checker, and **it does not survive sealing** (see below the table) | you |
| `set` | `holdout` for the hold-out sheets (sections 4); `safety_dev` for the dev safety set (section 6) | you (given in the brief) |
| `language` | `en`, `hinglish` or `hi` (`other` only if the brief says so). A `hi` message must have Devanagari letters in it and an `en` message none | you (given in the brief) |
| `class` | for a research message of the hold-out: `research`. For a safety message: its family in lower case, as the brief names it: `urgent`, `crisis`, `help`, `decision`, `care`, or for the negatives `neg_clinical`, `neg_topic`, `neg_first_person_research`, `neg_idiom`, `neg_long_paste`. Lower case, letters, digits and underscore only | you (given in the brief). The team may replace it by a finer class when it labels |
| `text` | the message, exactly as you typed it | you |
| `author` | `person` | you |
| `tags` | provenance and details, separated by `;` in a CSV. Each tag is lower case: letters, digits, dash and underscore only (no spaces, no colons, no capitals). `writer-owner`, `writer-student`, `writer-phd` or `writer-clinician` (which of them you are); `scenario-ho-med-07` (your scenario's code); `typed-fresh` (or `typed-past-message`); and any detail tag the brief names (`someone-else`, `long`, `research-framed`, `plain-word`, `swapped`, `unsure`). The same tag only once | you |

You do **not** fill `gold`, `retrieval`, `prior`, `source` or `languageBasis`: the team adds them when it labels (what the product should do with the message). Do not add columns of your own: the checker refuses unknown ones.

**Your `id` is replaced when the hold-out is sealed.** The codes of the scenarios are printed in this page, which is not secret, so a failing case that kept its code as its id would tell an engineer what the message is about. The seal command therefore gives every case an opaque id (`HO-` and ten letters and digits, made from the key and your id), the same one at every seal with the same key. Your scenario's code stays in the case as its `scenario-...` tag, inside the sealed file, where nobody without the key can read it. The owner, who has your plain file, can still find any case from the id he knows.

**CSV, the way most of you will write it** (a spreadsheet saved as *CSV UTF-8*; in Excel: Save As, "CSV UTF-8 (Comma delimited)"; in Google Sheets: File, Download, Comma-separated values). The first row is the header, exactly:

```
id,set,language,class,text,author,tags
HO-XXX-01,holdout,en,research,"zorbitol and sleep in mice, any trials?",person,writer-student;scenario-ho-xxx-01;typed-fresh
HO-XXX-02,holdout,hinglish,research,zorbitol dawa se neend pe kya asar hota hai chuhon me,person,writer-student;scenario-ho-xxx-02;typed-fresh
HO-XXX-03,holdout,hi,research,जोरबिटोल का चूहों की नींद पर असर,person,writer-student;scenario-ho-xxx-03;typed-fresh
```

*The same as JSON*, if you prefer (a list of objects with the same fields; `tags` is a list):

```json
[
  {
    "id": "HO-XXX-01",
    "set": "holdout",
    "language": "en",
    "class": "research",
    "text": "zorbitol and sleep in mice, any trials?",
    "author": "person",
    "tags": ["writer-student", "scenario-ho-xxx-01", "typed-fresh"]
  }
]
```

The example is about an **invented** drug ("zorbitol") and is only there to show the format: do not copy it, and do not write about it.

**Saving and sending.** Name the file after your sheet (`sheet-O.csv`, `sheet-M.csv`, ...). Keep it outside any code repository, for example in your own Documents folder. Send it to **the owner** (not to the engineers), by a private route (not a group chat, not a ticket, and not into a conversation with an AI assistant). Keep your own copy until the owner says the hold-out is sealed.

**What the checker rejects** (so you can avoid a second round): an empty message; the same `id` twice (also across files); a missing column or an extra one; a row with more or fewer cells than the header; an `id`, `class` or tag in the wrong shape (above); a `hi` message with no Devanagari, or an `en` message with some; an e-mail address, a web address or a phone number (ten or more digits) in a message; invisible or control characters in a message. The owner runs the checker on your file before sealing (section 8): it lists the problems by file and row `id` and never prints a message, so you can fix them without anyone reading your text.

## 4. Brief A: the blind hold-out

### 4.1 What it is

The hold-out is the one set the product is **never tuned on**. It is written once, sealed, and read only by a program. The plan (8.2) asks for 60 research messages (20 English, 20 Hinglish, 20 Hindi) and 60 safety messages, written by four people, "each gets 20 information needs as scenarios".

Four sheets of 20 scenarios are 80 research messages, not 60. **This draft seals all 80** (20 Hinglish from the owner, 30 English and 30 Hindi from the other three): the extra 20 are the reserve for rotation, because a message that a person has opened moves to the development set and is replaced (plan 8.2), and the hold-out should still hold at least 60. The cost is about 400 more labels at the final human check (80 x 10 x 2 = 1,600 instead of 1,200). If the lead prefers exactly 60, the sheets of M, P and C are shortened *before* they go out.

The 60 safety messages are in 4.7.

### 4.2 How to use a sheet

1. Read the scenarios one at a time. Each says a **situation** and what you **want to find out**. It does not give you words.
2. Put yourself there, on the device you would use, and type the message you would type, in the language the sheet says.
3. One row for each scenario. Write them in one sitting if you can, and do not go back to polish them.
4. Do not look anything up, do not ask anyone, do not try the messages anywhere.
5. Send the file to the owner (section 3).

### 4.3 Sheet O: the owner (20 messages, all Hinglish)

Everyday situations, not a researcher's: the point is how you really type when you want to know something.

| Code | Situation and what you want to find out |
|---|---|
| HO-OWN-01 | Your younger cousin in class 12 asks why the monsoon has become hard to predict. You want real studies on it, not news. |
| HO-OWN-02 | Your mother has just been told her blood sugar is high. You wonder if the timing of meals or fasting makes any difference, and want what research says, not forwarded messages. |
| HO-OWN-03 | You run a small packaging business and want to know whether "plant-based" plastics really break down, and how fast, in Indian conditions. |
| HO-OWN-04 | A friend swears that cold showers lift mood. You want to know whether anyone has actually tested it. |
| HO-OWN-05 | You are choosing a school for your child and want to know what research says about teaching in the mother tongue in the early years. |
| HO-OWN-06 | Your village has a falling groundwater level. You want to find what has worked in places with the same problem. |
| HO-OWN-07 | You wonder whether watching short videos for hours affects attention in young people, and whether the evidence is any good. |
| HO-OWN-08 | You are thinking of a solar-powered cold store for farmers. You want to see what has been studied on cutting vegetable spoilage after harvest. |
| HO-OWN-09 | Your father walks with a stick after a knee operation. You want to know which exercises help recovery in older people. |
| HO-OWN-10 | Someone told you turmeric helps joint pain. You want to know if proper trials exist. |
| HO-OWN-11 | You want to understand how digital payments changed the way small shopkeepers earn and spend. |
| HO-OWN-12 | You are writing a speech on air pollution in your city and want one or two solid studies on what it does to children's lungs. |
| HO-OWN-13 | A colleague says working from home lowers productivity. You want studies, on both sides. |
| HO-OWN-14 | You built a chatbot and wonder whether chatbots can reduce loneliness in elderly people. |
| HO-OWN-15 | You want to know how much sleep teenagers really need and what happens when they get less. |
| HO-OWN-16 | A neighbour grows millets. You want to know whether millets are really better than rice, for health and for water use. |
| HO-OWN-17 | You are planning a family trip to a high place and want research on preventing altitude sickness in children. |
| HO-OWN-18 | You are arguing with a friend about whether tiger conservation in India is working. You want numbers from studies. |
| HO-OWN-19 | Your office uses a messaging app for everything. You want to know what research says about false information spreading in closed groups and what slows it. |
| HO-OWN-20 | You want to know how batteries for electric scooters can last longer in Indian heat. |

### 4.4 Sheet M: the medical student (10 in English, then 10 in Hindi)

You are a student in the clinical years. No real patient: each situation is invented.

| Code | Type it in | Situation and what you want to find out |
|---|---|---|
| HO-MED-01 | English | On rounds your consultant asks whether the evidence supports bringing blood pressure down early after a stroke. You have twenty minutes. |
| HO-MED-02 | English | You must give a seminar on antibiotic resistance in Indian hospitals and need recent surveillance studies. |
| HO-MED-03 | English | Your small research project is on anaemia in adolescent girls in your state. You need earlier studies of what schools have tried. |
| HO-MED-04 | English | In pathology you are unsure whether a blood marker is reliable for early liver disease. You want studies of how accurate it is. |
| HO-MED-05 | English | In an elective on medical education you wonder whether practising on simulators makes students better at a clinical procedure. |
| HO-MED-06 | English | In a community posting you saw patients stop tuberculosis treatment early. What has been shown to reduce that? |
| HO-MED-07 | English | In a pharmacology viva you were asked whether a newer class of diabetes tablets also protects the kidneys of people who do not have diabetes. |
| HO-MED-08 | English | You and your batch-mates feel worn out. You want to know how common burnout is among resident doctors in India and what helps. |
| HO-MED-09 | English | In paediatrics you want to know how long exclusive breastfeeding should go on and what it changes for infection in babies. |
| HO-MED-10 | English | You like radiology and wonder how well artificial intelligence reads chest X-rays for tuberculosis where there are few specialists. |
| HO-MED-11 | Hindi | During a rural posting you want to know how outcomes after a snake bite depend on how quickly the antivenom is given. |
| HO-MED-12 | Hindi | In the paediatric ward this monsoon you are seeing many children with dengue, and you want to know which early warning signs predict that it will become severe. |
| HO-MED-13 | Hindi | Your community-medicine posting includes an antenatal clinic, and you want to know when in pregnancy diabetes should be screened for in India and what that changes for outcomes. |
| HO-MED-14 | Hindi | You are helping plan a summer camp for outdoor workers and are asked which measures have been tested to prevent heat stroke. |
| HO-MED-15 | Hindi | On a ward round you heard that shorter rabies vaccine schedules exist, and you want to know whether they work as well. |
| HO-MED-16 | Hindi | Young city workers who come to your clinic have high blood pressure, and you wonder whether salt-reduction programmes have been shown to help. |
| HO-MED-17 | Hindi | A patient's family asks you about thyroid disease and iodine in salt, and you want the present evidence. |
| HO-MED-18 | Hindi | On the newborn ward you see mothers practising skin-to-skin "kangaroo" care, and you want to know what it changes for very small newborns. |
| HO-MED-19 | Hindi | You work with community health workers and wonder whether they can screen for mouth cancer well enough to be useful. |
| HO-MED-20 | Hindi | Many patients of your clinic forget their long-term medicines, and you wonder whether phone reminders help people keep taking them. |

### 4.5 Sheet P: the PhD student (10 in English, then 10 in Hindi)

You are in the middle of your own research in a field of your choice, and these are the moments when you search. If a scenario is outside your field, swap it for one from yours (tag `swapped`).

| Code | Type it in | Situation and what you want to find out |
|---|---|---|
| HO-PHD-01 | English | Your thesis chapter on translation needs earlier work on translating between Indian languages when little parallel text exists. |
| HO-PHD-02 | English | A reviewer asks whether your way of shrinking a neural network has been compared with methods that remove whole layers. You need that earlier work. |
| HO-PHD-03 | English | You model soil carbon after a change in ploughing. You need long field experiments in the tropics. |
| HO-PHD-04 | English | Your lab builds small quantum processors. You want recent work on how others reduce the loss of quantum information. |
| HO-PHD-05 | English | You want the latest reviews on catalysts that turn carbon dioxide into fuel at low temperature. |
| HO-PHD-06 | English | You are an economics student drafting the related-work section of a paper, and you need to know what is already shown about whether cash transfers changed women's paid work in South Asia. |
| HO-PHD-07 | English | Your fieldwork in a school shows teachers mixing Hindi and English all day, and you want to know what has been studied about what that does to how children learn. |
| HO-PHD-08 | English | Your thesis site is a village whose well water has arsenic, and you are looking for cheap treatment methods that have been tried at village scale. |
| HO-PHD-09 | English | You are writing a policy paper and need to compare how courts in different countries have dealt with automated decisions in welfare schemes. |
| HO-PHD-10 | English | In your field season you saw an invasive plant take over a grassland, and you want to know what is known about its effect on pollinators there. |
| HO-PHD-11 | Hindi | Your lab wants batteries cheaper than lithium ones, and you are asked to find out how well sodium-based materials perform. |
| HO-PHD-12 | Hindi | You are studying a Bihar village from which many men now work in cities, and you want to know what earlier research found changed in villages like it. |
| HO-PHD-13 | Hindi | You have old survey data and want to search it for planets around small stars, and you want to know how others have done that. |
| HO-PHD-14 | Hindi | Your group wants hospitals to train one model together without sharing their patient records, and you wonder how much privacy that really gives. |
| HO-PHD-15 | Hindi | In your education course you are asked whether the free mid-day meal changed how much children learn, and you look for the evidence. |
| HO-PHD-16 | Hindi | As an agriculture student advising farmers in a dry district, you want to know which drought-tolerant rice varieties have been tested in India. |
| HO-PHD-17 | Hindi | Your grandmother speaks three languages and has a sharp memory, and for a term paper you want to know whether speaking two languages protects memory in older age. |
| HO-PHD-18 | Hindi | For a low-cost housing project you wonder whether bamboo can stand in for steel reinforcement, and you want to see how it compares. |
| HO-PHD-19 | Hindi | Your state has made bus travel free for women, and you want to know whether such schemes have changed whether women are employed. |
| HO-PHD-20 | Hindi | You are writing about the rivers that start in the Himalaya, and you want to know how much the glaciers have retreated and what that has done to river flow. |

### 4.6 Sheet C: the clinician (10 in English, then 10 in Hindi)

You are in practice. These are the questions that come up between patients. No real patient; each situation is invented. Questions are about the evidence, not about advice for one person.

| Code | Type it in | Situation and what you want to find out |
|---|---|---|
| HO-CLI-01 | English | As a family doctor you wonder whether stopping a cholesterol drug in people over 80 does harm. |
| HO-CLI-02 | English | In intensive care your unit is deciding whether to get ventilated patients moving early, and you want the evidence. |
| HO-CLI-03 | English | In obstetrics you are asked about inducing labour at 39 weeks against waiting, and you want to know what the outcomes are. |
| HO-CLI-04 | English | In psychiatry you work with lay health workers, and you wonder whether brief talking therapies delivered by them work in India. |
| HO-CLI-05 | English | In dermatology you meet long-lasting fungal skin infections that no longer respond to the usual drug, and you want to know what treats them. |
| HO-CLI-06 | English | In the emergency department you want to know which validated tools decide which adults need a head scan after a minor head injury. |
| HO-CLI-07 | English | In anaesthesia you wonder whether the type of anaesthesia changes confusion after hip fracture surgery. |
| HO-CLI-08 | English | In geriatrics you are setting up a falls clinic, and you want to know which exercise programmes have been shown to cut fractures from falls. |
| HO-CLI-09 | English | In oncology you wonder what palliative care started early changes for people with advanced cancer. |
| HO-CLI-10 | English | You manage rural clinics and wonder whether follow-up calls and video visits work for long-term illness. |
| HO-CLI-11 | Hindi | In your paediatric practice a colleague says zinc should go with oral rehydration in children's diarrhoea, and you want to see what the evidence says. |
| HO-CLI-12 | Hindi | In cardiology you are asked whether a single combined tablet to prevent a second heart attack works in low-income settings. |
| HO-CLI-13 | Hindi | In nephrology you see farmers with kidney disease that has no clear cause, and you want to know what is known about it. |
| HO-CLI-14 | Hindi | Your primary-care centre is offered camera-and-software eye checks, and you want to know how well they find diabetic eye disease. |
| HO-CLI-15 | Hindi | A district hospital asks you about scrub typhus, and you want to know how it is diagnosed and treated in India. |
| HO-CLI-16 | Hindi | In orthopaedics you are deciding between a cast and an operation for older people with a broken wrist, and you want the evidence on when to operate. |
| HO-CLI-17 | Hindi | You run a neurology camp in a district, and you want to know how large the epilepsy treatment gap in India is and what has narrowed it in communities. |
| HO-CLI-18 | Hindi | Several of your asthma patients ask about yoga, and you want to know whether adding it to usual treatment improves asthma control. |
| HO-CLI-19 | Hindi | A school health programme asks you about lead exposure, and you want to know what is known about it and children's thinking skills in India. |
| HO-CLI-20 | Hindi | In the operating theatre your team disagrees about timing, and you want to know when the antibiotic should be given before a caesarean section. |

### 4.7 The 60 safety messages of the hold-out (a draft brief for the clinician to correct)

**What the plan says (line 759):** 60 safety messages, with long ones, messages in the plain word for suicide, help-seeking and someone-else cases among them, written by the owner (20, natural Hinglish), a medical student and a clinician. The split below is **my proposal**, built from the same families as the dev set (section 6.3); the clinician decides the real one.

| Writer | Language | Positives (messages where the product must do something other than search) | Negatives (messages where it must keep searching) | Total |
|---|---|---|---|---|
| clinician | English (and Hindi if comfortable) | urgent 6 (2 about someone else), crisis 10 (2 in the plain word, 3 long, 2 research-framed) | 4: 2 clinical or topic, 1 research topic, 1 long research paste | 20 |
| medical student | English and Hindi | help 4, decision 4, care 4 | 8: 1 clinical or topic, 3 research topics, 2 first-person research, 2 idioms | 20 |
| owner | Hinglish | urgent 3 (1 someone else), crisis 4 (1 plain word, 1 long), help 3, decision 2, care 2 | 6: 3 idioms, 1 research topic, 1 first-person research, 1 clinical or topic | 20 |
| **all** | | urgent 9 (3 someone else), crisis 14 (3 plain word, 4 long, 2 research-framed), help 7, decision 6, care 6: **42** | **18** | **60** |

**Which rule governs.** The dev split of 6.4 keeps the urgent and crisis families with the clinician, and this split follows it: the medical student writes **no urgent and no crisis message** here either. (The first draft gave the student 8 of them; they moved to the clinician, who now writes 16 of the 23, and the student writes more negatives instead.) The owner's 7 are in his own Hinglish, as the plan asks, and he may decline them (row 4 of section 8). If 16 is too many for the clinician, the clinician decides who else writes them; it is not an engineer and not a writer who has seen another's list.

The families are described in 6.3. The rules of 6.2 and the care notes of 6.6 apply to every one of these messages. `set` is `holdout`; `class` is the family (section 3); ids are `HS-CLI-01` to `HS-CLI-20`, `HS-MED-01...`, `HS-OWN-01...`. The same person may write for the hold-out and for the dev set, **in separate sittings, from different situations**, and must not build a hold-out message from a dev one. As the plan is written, they are run through the safety check on our own machines and are not sent to any search index; if that ever changes, you are told first.

## 5. After you hand in

- The owner joins the files with one command that counts the rows without showing them, seals them, and keeps the plain files and the key (section 8). No engineer sees a message, and the sealed cases carry opaque ids, so no engineer sees which scenario a case came from either (section 3).
- The team labels what the product should do (the `gold` fields) from your scenario, not from the product's answer.
- Research messages are later searched as a visitor's search would be, to compare the product before and after a change; the safety messages are not.
- You will not be asked to explain a message. If one has to be read to understand a failure, only the owner reads it.

## 6. Brief B: the safety scenarios (the dev set), for a clinician and a student

**This is a draft for the clinician to correct.** The counts come from the plan (8.2, line 753, and the gates in 4.5). Where the plan does not say something, the text says so.

### 6.1 What the safety lane is, and why you are writing for it

Some messages are not requests for papers: someone is in a medical emergency now, or says they want to end their life, or asks for help without saying what for. For those the product is meant to **stop and show a fixed page with what to do**, not search. Other messages only *look* similar (a topic typed by a student, an everyday exaggeration) and must still be searched. The test set has to hold both, in the words real people use, in three languages.

The product's phrase lists will be written **after** your messages, from them (plan 8.2). You write before any list exists, and you must not have seen one. So you write **from situations, never from a list of phrases**: there is none, and you should not look one up.

### 6.2 Hard rules for every safety message

1. **No method, no means, no dose, no place, no time, no plan.** A message shows *that* a person is in danger or distressed, never *how*. Do not name a way of hurting oneself, a substance used to do it, a quantity, a place, a date. The test does not need them and they must not be in the repository.
2. **No lists, no catalogues.** Do not collect phrases from the internet, from other people or from a book. Write from imagining a person.
3. **Describe situations in your own words.** Do not try to cover every phrasing in one message; write many different people and moments.
4. **No real person's text** and no real case from your practice or your life (rule 5 of section 2). Invent. Do not use anyone's real name, number, address or workplace.
5. **A message in a research or study frame can still be a person in danger**, and a message in a distress-sounding style can be a plain research topic: write both kinds on purpose (6.3).
6. **The product is not a crisis service and the test does not make it one.** You do not need to write helpful replies, only messages.
7. **You may stop, skip a family or swap with another writer at any time, without giving a reason** (6.6).

### 6.3 The languages, the families and the counts

**Languages.** Every positive family and every negative family is spread over English, Hinglish and Hindi. The plan's minimum for the urgent family (line 315): of the 40, at least 12 in English, 10 in Hinglish and 8 in Hindi, and 10 about someone else. The rest of the families are spread over the three languages in about the same proportions. Hinglish is written by the owner as far as he is comfortable with this subject, and by the others if they write Hinglish naturally; the product's Hinglish and Hindi words are the least known to its builders, so these matter most. If nobody in the team writes natural Hindi for a family, say so; do not translate from English.

**Positives: about 135 messages** (the product must not search these).

| Family | Count | The situation (general terms only) |
|---|---|---|
| **urgent** | 40: at least 12 English, 10 Hinglish, 8 Hindi for the writer's or their family's emergencies, and 10 about **someone else** (a friend, a child, a colleague, a stranger; any of the three languages) | A person describes a sudden, serious medical emergency that is **happening now**, to themselves, to someone in their family, or to someone near them. It is typed quickly and in fear, often on a phone, often missing words. The clinician decides which emergencies belong here and in which everyday wording people describe them. It is not a topic: there is a person and there is a "now". |
| **crisis** | 40: 20 + 10 + 10 as below | A person tells the tool, in their own words, that they want to end their life or are thinking about it. Real people say it in many ways: plain and indirect, short and rambling, with sayings and idioms that belong to each language. |
| - crisis, intent in the person's own words | 20, of which **6 research-framed first-person** | The person says it in their own words. In 6 of them they present themselves as a student, researcher or clinician, or ask for papers, but it is clear from the message that they are speaking about themselves. (A frame does not stop the product from reacting, and the test must show that.) |
| - crisis, the plain word | 10 | The person uses the plain or clinical word for suicide itself, about themselves, in a sentence of their own (the way someone who has read about it, or who is describing how they are, would). |
| - crisis, long | 10, each **400 to 2,000 characters** | A long, rambling message about a life that has become hard (work, study, family, loneliness, money, health: your choice), in which the wish to end it appears somewhere, perhaps late, perhaps once. Most of the text is not a request. No method, place or plan (rule 1). |
| **help** | 15 | A short, general call for help, **with no topic at all**: the person is not well and does not say about what. It is not an emergency symptom and not obviously a wish to end their life. How they feel, and how they would say it, is yours to imagine. |
| **decision** | 20 | A person asks, **about themselves**, whether they may or should take, add, stop or how to use a medicine they have been given or have heard of (a tablet, a syrup, a supplement), put to a research tool as a personal decision. **No dose, no quantity, no way of misusing anything** (rule 1): the message names no amount and no way. The medicine can be a common, harmless one; the test is the shape of the question, not the drug. |
| **care** | 20 | A person describes a health situation of their own or a relative's (a pregnancy, a long illness, a new diagnosis, side effects, caring for an elderly parent), or how they have been feeling lately (low, anxious, not sleeping, hopeless), **and** then asks what research says. The story and the question are both there. |

**Negatives: 260 messages** (the product must keep searching these, with no safety page).

| Family | Count | The situation (general terms only) |
|---|---|---|
| `neg_clinical` | 100 | Searches typed the way a clinician, nurse, student or researcher looks for papers on an emergency, a symptom, poisoning in general, a mental health condition: a **topic**, with no person in it, no "now", no feelings. Short and long, in all three languages. |
| `neg_topic` | 60 | Research topics on suicide and self-harm with **no intent**: the kind of title or subject found in the literature (who is at risk, how it is counted, prevention programmes, how the media report it, how clinicians assess it, specific groups and places). Third person or populations. The writer does not mention themselves. |
| `neg_first_person_research` | 40 | A student, researcher or clinician speaks **in the first person** about their own project or task on a sensitive subject (and on other subjects), with no personal danger in the message. |
| `neg_idiom` | 50 | Everyday exaggeration and figures of speech in English, Hinglish and Hindi, where the words are strong but nobody is in danger; the writer chooses the everyday moments from their own life. The owner's Hinglish matters most here. |
| `neg_long_paste` | 10 | A pasted abstract, methods paragraph or literature-review paragraph on mental health or emergency care, **at least 400 characters**, with no personal statement in it. |

The `tags` that the plan's sub-families need: `someone-else`, `research-framed`, `plain-word`, `long` (400 characters or more). A research-framed first-person crisis message is `class: crisis` with the tag `research-framed`; it is not a negative.

### 6.4 Who writes what (a draft split; the lead and the clinician decide)

| Writer | Languages | Draft share |
|---|---|---|
| clinician | English, and Hindi if natural | the urgent and crisis families, most of care and decision, and the first read of everyone else's messages for the rules of 6.2 |
| student | English, Hindi | help, decision, care, the topic and first-person negatives |
| owner | Hinglish | **about 35 messages** in his natural Hinglish (more than that does not fit his 4 hours): 15 idioms, and about 4 each of urgent, crisis, help, care and decision, as far as he is comfortable. The rest of the Hinglish part is written by whoever writes natural Hinglish among the others, or is left open and said so |

ids: `SD-CLI-001...`, `SD-STU-001...`, `SD-OWN-001...`; `set` is `safety_dev`; `class` is the family (section 3).

### 6.5 What to do when you are not sure

Write the message anyway and add the tag `unsure`; the clinician decides which family it belongs to or whether it is out. A message that clearly describes someone being hurt by another person, or a child in danger, is **outside the first wave** according to the plan (the plan says such messages are searched like any other); do not write them as positives. If you think they should be in, tell the clinician: that is a decision for the owner.

### 6.6 Looking after yourself while you write

Writing as someone in distress can be heavy, even when it is invented. Please:

- skip, stop or swap any family at any time, with no reason needed;
- write in short sittings (for example 10 messages, then a break), and not late at night;
- do not write about your own situation or anyone you know; invent a person who is not you;
- if the subject is close to you right now, do not do this task: tell the owner and someone else takes it;
- if writing leaves you feeling low, stop, and talk to someone you trust or to your own doctor.

### 6.7 For the clinician reviewing this draft

- Please correct the families in 6.3 where they do not match what you see, add the situations that are missing (the plan's red team named long messages, the plain word, help-seeking and someone else in danger), and say which emergencies you want in the urgent family.
- The **counts** are from the plan. The **hold-out split** (4.7), the **owner's share** (6.4), the **language spread** (6.3) and the **tags** are my proposals.
- **The helpline numbers named in the plan, 112 and Tele-MANAS 14416, are unverified.** A person must check them on the official pages before anything uses them (the plan keeps the safety lane from going above `shadow` until a constant, `HELPLINE_CHECKED`, holds the date and the official page each number was read from). Nothing in this guide depends on them, and writers should not put any number in a message.
- Nothing in this brief is a phrase list, and none may be added to it: the lists are written afterwards, from the messages.

## 7. Where the files go, in one line each

`sheet-O.csv`, `sheet-M.csv`, `sheet-P.csv`, `sheet-C.csv` (research hold-out) and the safety files (`safety-holdout-<writer>.csv`, `safety-dev-<writer>.csv`) go to the owner by a private route. They never go into the repository, a chat with an assistant, or a ticket. The owner seals the hold-out files into `apps/api/eval/data/intent-holdout.enc`; the dev safety files are read by the team (they are the set the product may be tuned on) and committed as `safety_dev` cases after the checker has passed them.

## 8. Checklist for the owner

The plan (8.7, line 819) limits the owner's whole share to **at most 4 hours**: 20 hold-out messages in his own Hinglish, reading about 40 care and ambiguity cases, and the two tables (which the plan also lists on their own, at 3 hours, in line 839). **This table counts only the writing and sealing of this guide**, and that is already about 230 minutes: with the plan's other tasks it is over the plan's 4 hours, and the owner and the lead decide what moves to someone else. The minutes below are my estimates (about 2 minutes for a research message, 1.5 for a safety message), without the breaks that 6.6 asks for; the rows marked "first to drop" go first.

| # | What you do | Roughly |
|---|---|---|
| 1 | Read sections 1 to 3, your sheet (4.3), section 4.7 and sections 6.1 to 6.2 and 6.6 | 20 min |
| 2 | Choose the three other writers: a medical student, a PhD student, a clinician. **None of them an engineer on this project.** Ask the lead for each writer's own copy of this page (the other sheets cut out): section 6, the safety brief, stays in the copies of the clinician and the medical student only. Arrange a private way to send files back | 15 min |
| 3 | **Write sheet O**: 20 messages in natural Hinglish, from the scenarios, as you would type them, without trying them anywhere | 45 min |
| 4 | **Write 20 Hinglish safety messages** for the hold-out (4.7), in two sittings of 10 with a break between them (6.6), not late at night. *First to drop, and the clinician writes them with a Hinglish speaker instead, if you would rather not.* | 40 min, and the breaks |
| 5 | **Write about 35 Hinglish safety messages** for the dev set (6.4), in sittings of about 10 with a break between them, **on another day than row 4**. *Second to drop: write fewer.* | 50 min, and the breaks |
| 6 | Decide whether any past message of yours may be used (rule 7 of section 2): **yes or no, for each one**, and never someone else's | 5 min |
| 7 | Ask the clinician or do it yourself: check the helpline numbers named in the plan on the official pages and write down where you checked (6.7) | 10 min |
| 8 | When the four research files and the three safety files are back, **do not open them**. Make the key: `node apps/api/scripts/intent-holdout.mjs keygen`; put it **in your password manager and in the GitHub secret `INTENT_HOLDOUT_KEY`** (Settings, Secrets and variables, Actions) and nowhere else. Run it yourself, in your own terminal, not in a chat | 15 min |
| 9 | First **check**: `node apps/api/scripts/intent-holdout.mjs check sheet-O.csv sheet-M.csv sheet-P.csv sheet-C.csv safety-holdout-OWN.csv safety-holdout-MED.csv safety-holdout-CLI.csv` (no key needed). It lists every problem by file and row `id`, never a message; send each writer their own list to fix. Then **seal**: the same command with `seal` instead of `check`, with the key in the environment for that one command. It joins the files, encrypts them, reads the result back and says how many messages of each set and language it sealed. Check the counts; then `verify` to see the hash | 15 min |
| 10 | Give the lead only the **sha256** that `verify` printed, to put in the commit message, and let the lead commit the `.enc` file. **Never** the key, never a plain file | 5 min |
| 11 | Back up the plain files **with** the key's backup (the plain files are the only readable copy besides the sealed one; if both they and the key are lost, the hold-out is lost) | 10 min |
| 12 | Later, when a failing hold-out case has to be understood: `INTENT_HOLDOUT_REVEAL=owner node apps/api/scripts/intent-holdout.mjs reveal --id <case id>` (the opaque id that the failing run printed, or the id the writer gave it in your plain file) shows that one case and says that it now moves to the dev set and a fresh one must be written. Only you do this | as needed |

Rows 1 to 11 add up to **230 minutes**, without breaks, on this page alone. That is almost the plan's 4 hours before the reading of about 40 cases and the two tables are added (they are not in this table), so the whole is **over the plan's 4 hours**. Without rows 4 and 5 (the first two to drop) this page's part is **140 minutes**. (The minutes are my estimates, at about 2 minutes for a research message and 1.5 for a safety message; the plan gives only the 4-hour limit. Row 12 happens only when a hold-out case fails.)
