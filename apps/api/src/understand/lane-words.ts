/**
 * The closed phrase sets of the safety lane (R4, docs/design/intent-and-state.md, 4.5): English, Hinglish (Hindi in Roman letters) and Devanagari Hindi, as DATA. `lane.ts` builds the sets, folds them the
 * way it folds a message, adds the other-gender form of every verb with a gender, and scans a message against them once. Nothing here is a pattern: a phrase is a run of words, written as people write.
 * Apostrophes do not matter (`cant` and `can't` are the same), nor capitals, nor a letter stretched out (`pleaseee`): the message and these lists are folded the same way before they are compared.
 *
 * The lists were written AFTER the engineer's own scenarios (apps/api/eval/data/lane-scenarios.json), family by family, from the plan's tier table and the E0 messages; the plan wants them signed off by a
 * clinician and read by a native speaker of Hinglish and Hindi (4.5, O-3), which has not happened: nothing here has been read by either. A phrase is `core` when it is one of the unmistakable ones: only
 * those act while CHAT_SAFETY is `core`; the rest are counted (`would_*`) and act only at `on`.
 *
 * A phrase holds the person it is about where the plan asks for it ("I want to die", "I am suicidal", "my suicidal thoughts"): the bare word "suicide" or "suicidal" is in no phrase, and a research frame
 * ("I am doing research on suicide") contains none. Where a verb has a gendered form only ONE of the two is written below (the masculine, or the one that reads best): `lane.ts` adds the other.
 */

/** A set of phrases: the unmistakable ones (they act at `core`) and the rest (counted at `core`, acting at `on`). */
export type Words = { core: string[]; broad: string[] };

/** The pairs of words that differ only in the gender of the speaker (a masculine and a feminine form of a verb or of what agrees with it). Hinglish, then Devanagari. */
export const GENDER_PAIR_WORDS: readonly (readonly [string, string])[] = [
  ["chahta", "chahti"],
  ["karta", "karti"],
  ["raha", "rahi"],
  ["gaya", "gayi"],
  ["thaka", "thaki"],
  ["sakta", "sakti"],
  ["jata", "jati"],
  ["leta", "leti"],
  ["akela", "akeli"],
  ["अकेला", "अकेली"],
  ["चाहता", "चाहती"],
  ["करता", "करती"],
  ["रहा", "रही"],
  ["गया", "गई"],
  ["थका", "थकी"],
  ["सकता", "सकती"],
  ["जाता", "जाती"],
  ["लेता", "लेती"],
];

/**
 * The spellings that are one word, in the form a word has AFTER it was folded (a letter stretched out is already one: "hoon" is "hon"): Devanagari written with or without the chandrabindu, the vowel sign
 * of gayi and so on, and the usual ways of spelling a Hindi word in Roman letters. Folded to one before anything is compared; the phrases below go through the same fold.
 */
export const SPELLINGS: Readonly<Record<string, string>> = {
  // Devanagari
  "हूं": "हूँ",
  "दूं": "दूँ",
  "करूं": "करूँ",
  "लूं": "लूँ",
  "सकूं": "सकूँ",
  "जाऊं": "जाऊँ",
  "जाऊंगा": "जाऊँगा",
  "जाऊंगी": "जाऊँगी",
  "रहीं": "रही",
  "नही": "नहीं",
  "मै": "मैं",
  "गयी": "गई",
  "सांस": "साँस",
  "माँ": "मां",
  "रहे": "रहा",
  // Roman
  nahin: "nahi",
  nhi: "nahi",
  hu: "hon",
  hun: "hon",
  gaye: "gayi",
  mujko: "mujhe",
  mujhko: "mujhe",
  mjhe: "mujhe",
  mai: "main",
  jina: "jena",
  ichcha: "ichha",
};

/* ---------------------------------------------------------------- CRISIS: self-harm intent or state, the first person inside the phrase */

export const CRISIS: Words = {
  core: [
    // English
    "i want to die", "i wanna die", "i want to kill myself", "i wanna kill myself", "kill myself", "i want to end my life", "end my life", "take my own life", "i am suicidal", "im suicidal",
    "i feel suicidal", "im feeling suicidal", "i am feeling suicidal", "i have suicidal thoughts", "i am having suicidal thoughts", "im having suicidal thoughts", "my suicidal thoughts",
    "i want to commit suicide", "i am going to kill myself", "i dont want to live", "i dont want to be alive", "i dont want to live anymore", "i dont want to live any more", "i just want to die", "i just want to kill myself", "just want to die",
    // Hinglish
    "mujhe marna hai", "main marna chahta hoon", "marna chahta hoon", "mar jana chahta hoon", "mar jaana chahta hoon", "mujhe mar jana hai", "mujhe jeena nahi hai", "main jeena nahi chahta", "jeena nahi chahta",
    "khud ko khatam", "apni jaan dena chahta hoon", "mujhe suicidal feel ho raha hai", "main suicidal hoon", "main apni zindagi khatam karna chahta hoon",
    // Devanagari
    "मैं मरना चाहता हूँ", "मरना चाहता हूँ", "मुझे मरना है", "मुझे जीना नहीं है", "मैं जीना नहीं चाहता", "जीना नहीं चाहता", "मैं अपनी जान देना चाहता हूँ", "मैं खुद को खत्म करना चाहता हूँ", "मैं आत्महत्या करना चाहता हूँ",
  ],
  broad: [
    // English: no reason to live, being better off dead, going on, thoughts of suicide, ending it, hurting myself
    "i have no reason to live", "i have nothing to live for", "i see no reason to live", "i see no point in living", "there is no point in living", "i would be better off dead", "i wish i was dead", "i wish i were dead",
    "everyone would be better off without me", "better off without me", "i wish i had never been born", "i wish i was never born", "i want to be dead", "i am tired of living", "im tired of living", "i am sick of living",
    "i am done with life", "im done with life", "i cant go on any more", "i cant go on anymore", "i cant go on like this", "i cant go on living", "i cant go on any longer", "i cant go on .", "i cannot go on .", "i cannot go on any more",
    "i dont think i want to be alive", "i dont think i want to live", "i dont want to be alive any more", "thinking of ending my life", "thinking about ending my life", "thinking of killing myself", "thinking about killing myself", "think about killing myself", "ending my life", "i think about ending my life",
    "i keep thinking about suicide", "i keep thinking about ending it", "i keep thinking about ending it all", "i keep thinking about killing myself", "i keep thinking about ending my life", "i am thinking about suicide", "im thinking about suicide",
    "i am thinking of suicide", "i think about suicide", "i am thinking of ending it", "i am thinking about ending it", "i am thinking of ending my life", "i am thinking about killing myself", "i am thinking of killing myself",
    "i am considering suicide", "i want to end it all", "i am going to end it all", "i dont want to be here any more", "i dont want to be here anymore", "i dont want to wake up",
    "i want to hurt myself", "i want to harm myself", "i am going to hurt myself", "i might hurt myself", "i want to self harm", "i am self harming", "i have been self harming", "i keep hurting myself",
    "i want to commit suicide", "i might commit suicide", "i will commit suicide", "i feel like committing suicide", "my suicidal feelings", "suicidal thoughts again",
    // "suicidal" wording, first person and plain, with the usual misspellings
    "i feel suicidel", "im suicidel", "i am sucidal", "im sucidal", "i have sucidal thoughts",
    // Hinglish
    "main marna chahta hu", "mujhe jeene ka man nahi", "jeene ka man nahi", "jeene ka mann nahi", "jeene ka man nahi karta", "jeene ka mann nahi karta", "jeene ki ichha nahi", "jeene ki ichha nahi hai", "mujhe jeene ki ichha nahi", "zindagi khatam", "zindagi khatam karna", "zindagi khatam kar",
    "apni zindagi khatam", "apni jaan dena", "jaan dena chahta hoon", "main jaan de dunga", "khud ko khatam kar", "khud ko nuksan pahunchana", "khudkushi ka khayal", "khudkushi ke khayal", "khudkushi karna chahta hoon", "khudkushi karne ka",
    "mujhe aatmahatya ke", "mujhe aatmahatya ka khayal", "mere man mein aatmahatya", "mere mann mein aatmahatya", "mere man mein suicide", "mere mann mein suicide", "mujhe suicide ke khayal", "mujhe suicide ke vichar", "mere man mein suicide ke vichar", "mere mann mein suicide ke vichar", "suicide karna chahta hoon", "suicide karne ka man", "suicide karne ka mann",
    "suicide karne ke vichar", "suicidal feel", "main sab ke liye bojh hoon", "ab main nahi jeena chahta", "mar jaun", "mar jana chahta hoon", "mujhe lagta hai main marna chahta hoon", "main apni jaan le lunga",
    // Devanagari
    "अब जीने का मन नहीं करता", "जीने का मन नहीं", "जीने की इच्छा नहीं", "मुझे जीने की इच्छा नहीं है", "मैं अपनी ज़िंदगी खत्म करना चाहता हूँ", "ज़िंदगी खत्म कर देना चाहता हूँ", "अपनी ज़िंदगी खत्म कर", "अपनी जिंदगी खत्म कर",
    "मैं अपनी ज़िन्दगी खत्म", "मुझे आत्महत्या के ख़याल", "मुझे आत्महत्या के ख्याल", "मुझे आत्महत्या के विचार", "मेरे मन में आत्महत्या", "मुझे आत्महत्या का ख़याल", "मुझे आत्महत्या का ख्याल", "आत्महत्या करना चाहता हूँ", "मुझे खुद को नुकसान", "मैं खुद को नुकसान पहुँचाना चाहता हूँ",
    "मैं सबके लिए बोझ हूँ", "मर जाना चाहता हूँ", "मैं मर जाना चाहता हूँ", "मुझे मर जाना है", "मैं अपनी जान ले लूँगा",
    "i keep thinking everyone would be better off if i just wasnt here", "better off if i wasnt here", "better off if i was not here", "better off if i was gone", "better off if i were gone", "better off if i disappeared", "better off if i was dead", "manage better without me", "would be happier without me", "easier if i just ended my life", "easier if i ended my life", "if i just ended my life", "take my life", "i want it all to end", "i want to end everything", "i dont see the point of me living", "dont see the point of me living", "i dont see the point of living", "i dont see a point in living", "i see no reason to go on", "wishing i wouldnt wake up", "wish i wouldnt wake up", "i wish i didnt wake up", "i wish i would not wake up", "hope i dont wake up", "i hope i dont wake up", "i dont want to live like this", "i cant keep living like this", "i cant live like this anymore", "i cant live any more", "i cant live anymore", "i am tired of being alive", "im tired of being alive", "i am sick of being alive", "i dont want to exist", "i want to stop existing", "i dont know if i want to live", "i dont know if i want to be here", "not sure i want to be alive", "i have thought about suicide", "ive thought about suicide", "i have thought about ending my life", "ive thought about killing myself", "thinking about hurting myself", "i keep thinking about hurting myself", "i am planning to kill myself", "im planning to end my life", "i have suicidal thoughts", "i have suicidal ideation", "i have suicidal feelings", "i have suicidal urges", "i have suicidal thoughts again", "i have suicidal ideas", "i have been having suicidal thoughts", "i have been having suicidal ideation", "i have been having suicidal feelings", "i have been having suicidal urges", "i have been having suicidal thoughts again", "i have been having suicidal ideas", "ive been having suicidal thoughts", "ive been having suicidal ideation", "ive been having suicidal feelings", "ive been having suicidal urges", "ive been having suicidal thoughts again", "ive been having suicidal ideas", "i am having suicidal thoughts", "i am having suicidal ideation", "i am having suicidal feelings", "i am having suicidal urges", "i am having suicidal thoughts again", "i am having suicidal ideas", "im having suicidal thoughts", "im having suicidal ideation", "im having suicidal feelings", "im having suicidal urges", "im having suicidal thoughts again", "im having suicidal ideas", "i keep having suicidal thoughts", "i keep having suicidal ideation", "i keep having suicidal feelings", "i keep having suicidal urges", "i keep having suicidal thoughts again", "i keep having suicidal ideas", "i get suicidal thoughts", "i get suicidal ideation", "i get suicidal feelings", "i get suicidal urges", "i get suicidal thoughts again", "i get suicidal ideas", "i am getting suicidal thoughts", "i am getting suicidal ideation", "i am getting suicidal feelings", "i am getting suicidal urges", "i am getting suicidal thoughts again", "i am getting suicidal ideas", "im getting suicidal thoughts", "im getting suicidal ideation", "im getting suicidal feelings", "im getting suicidal urges", "im getting suicidal thoughts again", "im getting suicidal ideas", "i still have suicidal thoughts", "i still have suicidal ideation", "i still have suicidal feelings", "i still have suicidal urges", "i still have suicidal thoughts again", "i still have suicidal ideas", "i have had suicidal thoughts", "i have had suicidal ideation", "i have had suicidal feelings", "i have had suicidal urges", "i have had suicidal thoughts again", "i have had suicidal ideas", "ive had suicidal thoughts", "ive had suicidal ideation", "ive had suicidal feelings", "ive had suicidal urges", "ive had suicidal thoughts again", "ive had suicidal ideas", "my suicidal thoughts", "my suicidal ideation", "my suicidal feelings", "my suicidal urges", "my suicidal thoughts again", "my suicidal ideas", "i have been suicidal", "ive been suicidal", "i was suicidal", "i feel suicidal again", "i am suicidal again", "i have thoughts of suicide", "i have thoughts of killing myself", "i have thoughts of ending my life", "ive been thinking about suicide", "mere bina sab theek", "mere jaane se kisi ko fark nahi", "main na rahoon", "aur jee nahi sakta", "jee nahi sakta", "jee nahi paunga", "ab jeena nahi chahta", "jeena hi nahi chahta", "ab jeena nahi", "khatam ho jaun", "mai khatam ho jaun", "khatam ho jana chahta hoon", "mar jaun", "mar jaaun", "apni jaan lene", "apni jaan lena", "marne ka man", "marne ka mann", "marne ka khayal", "marne ke khayal", "mar jane ka khayal", "mujhe suicidal thoughts", "mujhe suicide ke thoughts", "mujhe suicide ke thought", "mujhe aatmahatya ke khayal", "mujhe aatmahatya ke vichar", "mujhe khudkushi ke khayal", "mujhe khudkushi ke vichar", "mujhe suicidal vichar", "mere mann mein khudkushi", "mere man mein khudkushi", "mujhe lagta hai mere bina sab", "jeene ka koi matlab nahi", "jeene ka koi reason nahi", "jeene ki wajah nahi", "ख़त्म हो जाना चाहता हूँ", "खत्म हो जाना चाहता हूँ", "ज़िंदगी यहीं खत्म कर दूँ", "जिंदगी यहीं खत्म कर दूँ", "ज़िंदगी खत्म कर दूँ", "जिंदगी खत्म कर दूँ", "काश आँख ही न खुले", "काश कभी आँख न खुले", "आँख ही न खुले", "मर जाऊँ", "मरने का मन", "अपनी जान लेने", "जान लेने के बारे में सोच", "अपनी जान दे दूँ", "मेरे जाने से किसी को फ़र्क नहीं", "मेरे जाने से किसी को फर्क नहीं", "मेरे बिना सब ठीक", "जीना ही नहीं चाहता", "ज़िंदा रहने का कोई कारण", "जिंदा रहने का कोई कारण", "जीने का कोई कारण", "जीने का कोई मतलब नहीं", "मेरे मन में खुदकुशी", "मुझे खुदकुशी",
    "i ended my life", "the one who doesnt want to be here anymore", "im the one who doesnt want to be here anymore", "mere na hone se sabko sukoon", "mere jaane se kisi ko", "सुसाइड के ख़याल आ रहे", "सुसाइड के ख़याल आते", "सुसाइड के ख्याल आ रहे", "सुसाइड के ख्याल आते", "सुसाइड के विचार आ रहे", "सुसाइड के विचार आते", "खुदकुशी के ख़याल आ", "खुदकुशी के ख्याल आ", "मुझे सुसाइड के", "मुझे आत्महत्या के", "मरने के ख़याल आ", "मरने के ख्याल आ", "मेरे न होने से सबको",
  ],
};

/**
 * What after a crisis phrase makes it a figure of speech, not a person: "I want to die of laughter", "I want to die of embarrassment". The words that come right after the phrase; when one of these
 * does, the phrase is not read. (A joke that uses "kill myself" is read: the lane errs towards the person.)
 */
export const CRISIS_NOT_IF_FOLLOWED_BY: string[] = [
  "of laughter", "of laughing", "of embarrassment", "of shame", "of boredom", "of cringe", "of happiness", "of joy", "from laughing", "from laughter", "from embarrassment", "laughing", "laughter",
  "ke hasi se", "hasi se", "sharm se", "शर्म से", "हँसी से", "हंसी से",
  "story", "stories", "insurance", "savings",
];

/* ---------------------------------------------------------------- HELP: a plain call for help, with no topic */

export const HELP: Words = {
  core: [
    "help me", "please help me", "someone help me", "somebody help me", "please help", "i need help", "i need some help", "i cant do this anymore", "i cant do this any more", "i cannot do this anymore",
    "madad karo", "meri madad karo", "meri madad kijiye", "madad kijiye", "mujhe madad chahiye", "mujhe bachao", "bachao",
    "मदद करो", "मेरी मदद करो", "मेरी मदद कीजिए", "मुझे मदद चाहिए", "कोई मेरी मदद करो", "मुझे बचाओ", "बचाओ",
    "mujhe help chahiye", "help chahiye", "help me plz", "can someone help me", "can anyone help me", "मेरी सहायता कीजिए", "सहायता कीजिए", "मदद कर दीजिए", "मुझे मदद कर दीजिए",
  ],
  broad: [
    "i cant cope", "i cannot cope", "im not okay", "i am not okay", "im not ok", "i am not ok", "im scared", "i am scared", "im so scared", "i am so scared", "im really scared", "i am really scared", "im very scared",
    "i am very scared", "im terrified", "i am terrified", "i dont know what to do", "im struggling", "i am struggling", "i feel lost", "i am lost", "i feel hopeless", "i feel empty", "i feel so alone", "i feel alone", "i am so alone",
    "i cant take it anymore", "i cant take this anymore", "i cant handle this", "i need to talk to someone", "i need someone to talk to", "i dont know who to talk to",
    "mujhe darr lag raha hai", "main theek nahi hoon", "mujhe kuch samajh nahi aa raha", "main akela hoon", "mujhse nahi ho raha", "mujhse ab nahi hoga", "ab aur nahi hota", "mujhe bahut darr lag raha hai", "main bahut akela hoon",
    "मुझे डर लग रहा है", "मैं ठीक नहीं हूँ", "मुझसे अब नहीं होता", "मुझे कुछ समझ नहीं आ रहा", "मैं अकेला हूँ", "मुझे बहुत डर लग रहा है",
    "is anyone there", "is anybody there", "anyone there", "i really need someone", "i need someone", "something is wrong with me", "i dont feel right", "mujhse ab nahi hota", "mujhse nahi hota", "meri tabiyat theek nahi hai", "meri haalat theek nahi", "meri halat theek nahi", "koi hai", "mujhe kuch ho raha hai", "mujhe kisi ki zaroorat hai", "mujhe kisi ki jarurat hai", "kya koi hai", "मेरी हालत ठीक नहीं है", "प्लीज़ मदद", "क्या कोई है", "कोई है", "मुझे किसी की ज़रूरत है", "मुझे किसी की जरूरत है", "अब और नहीं सहा जाता", "सहा नहीं जाता", "i cant do this much longer", "i cant do this any more", "i cant take much more",
  ],
};

/** Words that are only the colour of a call for help and are no topic (they are not counted as a subject): "please", "now", "scared", "alone". */
export const HELP_FILLER: string[] = [
  "please", "pls", "plz", "now", "anyone", "anybody", "someone", "somebody", "everyone", "asap", "urgently", "urgent", "really", "very", "so", "much", "too", "just", "anymore", "again", "alone", "scared", "afraid", "lost", "stuck",
  "struggling", "okay", "ok", "fine", "bad", "terrible", "awful", "hopeless", "empty", "desperate", "worried", "terrified", "cope", "coping", "talk", "feel", "feeling", "felt", "know", "what", "do", "this", "that", "it", "can", "cant",
  "cannot", "dont", "not", "need", "help", "hello", "hi", "hey", "thanks", "thank", "you", "kya", "karun", "karu", "karen", "kare", "abhi", "bahut", "bas", "yaar", "bhai", "ji", "plz", "kripya", "krupya", "कृपया", "अभी", "बहुत", "प्लीज़", "प्लीज",
  "samajh", "aata", "aati", "tabiyat", "theek", "thik", "hoon", "ho", "haalat", "halat", "sahayata", "zaroorat", "jarurat", "chahiye", "kisi", "koi", "hai", "hain", "aa", "wrong", "something", "right", "plz", "समझ", "आ", "रहा", "रही", "हालत", "ठीक", "करूं", "करूँ", "क्या", "सहायता", "ज़रूरत", "जरूरत", "किसी", "कृपया", "प्लीज़",
];

/* ---------------------------------------------------------------- URGENT: an emergency of a person, now */

/** A person the message is about: the writer (I, my), someone near them (a named relative, a friend, a child, someone, he, she). Single words. */
export const PERSON_OWN: string[] = [
  "i", "im", "ive", "me", "my", "mine", "myself", "we", "our", "ours", "someone", "somebody",
  "main", "mujhe", "mera", "meri", "mere", "hum", "humare", "hamare", "hamari", "koi",
  "मैं", "मुझे", "मेरा", "मेरी", "मेरे", "हम", "हमारा", "हमारे", "हमारी", "कोई",
];
/** Another person, by the word for them: a relative, a friend, a child, a stranger, "he", "she". With my, our, his or her in front or not. */
export const PERSON_BODY: string[] = [
  "he", "she", "hes", "shes", "they", "dad", "daddy", "papa", "mom", "mum", "mummy", "mother", "father", "wife", "husband", "son", "daughter", "baby", "child", "toddler", "infant", "kid", "friend", "colleague",
  "coworker", "neighbour", "neighbor", "brother", "sister", "grandmother", "grandfather", "grandma", "grandpa", "uncle", "aunt", "partner", "boyfriend", "girlfriend", "stranger", "man", "woman", "boy", "girl",
  "pitaji", "maa", "bhai", "bhaiya", "behen", "didi", "dost", "beta", "beti", "baccha", "bachcha", "bachche", "bete", "biwi", "patni", "pati", "dada", "dadi", "nana", "nani", "chacha", "mama", "padosi", "aadmi", "aurat", "ladka",
  "ladki", "woh", "wo", "vo", "unhe", "unko", "usko", "mareez", "bacha",
  "पापा", "पिताजी", "मम्मी", "मां", "माता", "भाई", "बहन", "दीदी", "दोस्त", "बेटा", "बेटी", "बच्चा", "बच्चे", "बच्ची", "पत्नी", "बीवी", "पति", "दादी", "दादा", "नानी", "नाना", "चाचा", "मामा", "पड़ोसी", "आदमी", "औरत", "लड़का", "लड़की",
  "वो", "वह", "उन्हें", "उसे", "उनको", "उसको", "मरीज", "भैया",
  "bhabhi", "saas", "sasur", "nanad", "devar", "jeth", "chachi", "mausi", "bua", "padosan", "classmate", "roommate", "flatmate", "भाभी", "सास", "ससुर", "ननद", "देवर", "जेठ", "चाची", "मौसी", "बुआ", "पड़ोसन",
];

/** A sign that it is happening now, or began a little while ago and goes on. */
export const NOW: string[] = [
  "now", "right now", "rn", "just now", "since morning", "since this morning", "since last night", "since yesterday", "a few minutes ago", "minutes ago", "an hour ago", "a while ago", "suddenly", "all of a sudden", "at the moment", "tonight",
  "abhi", "abhi abhi", "subah se", "raat se", "achanak", "ek dum", "ab", "kal raat se",
  "अभी", "अचानक", "सुबह से", "रात से", "अब", "कल रात से",
];
/** Words of studying: a "now" next to one of them ("I am studying chest pain right now") is not an emergency. */
export const STUDY_WORDS: string[] = [
  "studying", "study", "researching", "research", "writing", "learning", "working", "reading", "revising", "preparing", "analysing", "analyzing", "reviewing", "investigating", "exploring", "thesis", "project", "paper", "papers",
  "dissertation", "seminar", "lecture", "assignment", "team", "lab", "course", "pad", "padh", "padhai", "shodh", "अध्ययन", "शोध", "पढ़", "पढ़ाई",
];

/** The words of a pasted abstract or a case report: two different ones in a message and it is a text about patients, not a person in an emergency. */
export const ABSTRACT_WORDS: string[] = [
  "patients", "cohort", "retrospective", "prospective", "randomised", "randomized", "trial", "participants", "respondents", "conclusion", "conclusions", "methods", "results", "background", "objective", "objectives", "presented", "admitted",
  "underwent", "inclusion", "criteria", "mortality", "incidence", "prevalence", "systematic", "meta", "review", "ci",
];

/**
 * A state the person is in now (present tense, so it carries its own "now"): "my friend is having a seizure", "she wont wake up". Needs a person in the message, any person, and no "now" word.
 * `body`: needs another person (a word of PERSON_BODY: "is not moving" is also what a mouse does).
 */
export const SYMPTOM_NOW: Words = {
  core: [
    "is not breathing", "isnt breathing", "not breathing", "stopped breathing", "has stopped breathing", "is unconscious", "is unresponsive", "wont wake up", "will not wake up", "wont respond", "will not respond", "is not responding",
    "isnt responding", "not responding", "is having a seizure", "is having a fit", "is having a stroke", "is having a heart attack", "having a heart attack", "having a stroke", "having a seizure", "has collapsed", "just collapsed",
    "just fainted", "just passed out", "is having an asthma attack", "is choking", "is turning blue", "has turned blue",
    "behosh ho gaya", "behosh ho raha", "hosh mein nahi", "hosh nahi", "saans nahi aa rahi", "saans nahi aa raha", "saans nahi le", "saans nahi le pa raha", "dora pad raha", "daura pad raha", "dora pad gaya", "khoon ki ulti ho raha",
    "बेहोश हो गया", "बेहोश हो रहा", "होश नहीं है", "साँस नहीं आ रही", "साँस नहीं ले रहा", "साँस नहीं ले पा रहा", "दौरा पड़ रहा", "दौरा पड़ा",
    "is choking", "choking", "hil nahi raha", "hil nahi rahi", "हिल नहीं रहा", "हिल नहीं रही", "बोल नहीं रही", "बोल नहीं रहा", "नीला पड़ रहा", "chehra neela pad raha", "neela pad raha", "नीली पड़ रही",
  ],
  broad: [
    "throat is swelling", "throat is closing", "is bleeding heavily", "is bleeding badly", "is very drowsy", "is drowsy and confused", "is vomiting blood", "is coughing blood", "wont stop bleeding", "cant stop bleeding", "is in a lot of pain",
    "behosh hai", "bol nahi pa raha", "bol nahi pa rahi", "bol nahi rahi", "bol nahi raha", "gale mein sujan", "khoon beh raha", "khoon ki ulti ho rahi", "khoon nahi ruk raha", "chehra tedha ho gaya",
    "बोल नहीं पा रहे", "बोल नहीं पा रहा", "चेहरा टेढ़ा हो गया", "खून बह रहा", "खून की उल्टी हो रही", "गले में सूजन", "नीला पड़ गया",
  ],
};
/** Hinglish and Hindi say who it is by the verb and leave the person out: "saans lene mein dikkat ho rahi hai" (it is happening). The progressive form is its own "now" and its own person. */
export const SYMPTOM_ALONE: string[] = [
  "saans lene mein dikkat ho rahi hai", "saans lene mein takleef ho rahi hai", "saans nahi aa rahi", "saans nahi aa raha", "behosh ho raha hai", "behosh ho rahi hai",
  "साँस लेने में दिक्कत हो रही है", "साँस लेने में तकलीफ हो रही है", "साँस नहीं आ रही", "बेहोश हो रहा है", "बेहोश हो रही है",
  "saans lene me dikkat ho rahi hai", "saans lene me takleef ho rahi hai", "saans atak rahi hai", "saans atak raha hai", "gala sooj raha hai", "gale mein sujan aa gayi hai", "chehre pe sujan aa gayi hai", "andhera aa raha hai", "aankhon ke aage andhera", "aankhon ke samne andhera", "chakkar aa raha hai", "chakkar aa rahe hain", "gir jaungi", "gir jaunga", "आँखों के आगे अंधेरा", "अंधेरा छा रहा है", "गिर जाऊँगा", "गिर जाऊँगी", "साँस लेने में परेशानी हो रही है", "गला सूज रहा है", "साँस अटक रही है",
];
/** As `SYMPTOM_NOW`, and the person has to be another person: "not moving" says nothing of a laptop only if a child is the one that is not. */
export const SYMPTOM_NOW_BODY: string[] = ["is not moving", "isnt moving", "not moving", "not waking up", "is not waking up", "uth nahi rahi", "uth nahi raha", "उठ नहीं रहा", "उठ नहीं रही"];

/** A symptom of an emergency that needs a "now" and a person in the message: "cant breathe", "fainted", "bleeding heavily". */
export const SYMPTOM: Words = {
  core: [
    "cant breathe", "cannot breathe", "unable to breathe", "cant breath", "difficulty breathing", "trouble breathing", "struggling to breathe", "gasping for air", "hard to breathe", "getting hard to breathe",
    "fainted", "passed out", "collapsed", "blacked out", "feel faint", "feeling faint", "about to faint", "had a seizure", "has a seizure", "got a seizure", "having fits", "face drooping", "face is drooping", "drooping on one side",
    "slurred speech", "slurring", "cant speak properly", "cant speak", "cant move his arm", "cant move her arm", "weakness on one side", "vomiting blood", "coughing blood", "cant stop bleeding", "wont stop bleeding", "bleeding heavily",
    "bleeding badly", "bleeding a lot", "bleeding profusely", "lost a lot of blood",
    "saans nahi aa rahi", "saans nahi aa raha", "saans lene mein dikkat", "behosh", "behosh ho gayi", "hosh mein nahi", "dora pad", "daura pad", "khoon ki ulti", "khoon beh", "bol nahi pa", "gir gaya", "gir gayi", "gir pade",
    "साँस नहीं आ रही", "साँस नहीं ले", "बेहोश", "होश नहीं", "दौरा पड़", "खून की उल्टी", "खून बह", "बोल नहीं पा", "गिर पड़े", "गिर गया", "गिर गई",
    "speech is slurred", "speech slurred", "words are coming out wrong", "wont lift", "cant lift his arm", "cant lift her arm", "cant lift my arm", "blood is pouring", "blood pouring", "pouring blood", "bleeding through", "blood everywhere", "about to pass out", "about to collapse", "going to pass out", "going to faint", "vision going", "vision is going", "everything going black", "everything is going black", "worst headache", "sudden terrible headache", "snake bite", "snake bit", "bitten by a snake", "bitten by snake", "choking on", "something stuck in his throat", "something stuck in her throat", "fit aa gaya", "fit aa raha", "jhaag aa raha", "muh se jhaag", "muh se jhag", "aankhein ulat", "aankhen ulat", "body akad", "akad rahi", "akad raha", "ulti pe ulti", "andhera aa raha", "chakkar aa raha", "chakkar aa rahe", "sunn ho gaya", "sunn ho gayi", "haath sunn", "saanp ne kaat", "sanp ne kat", "साँप ने काट", "सांप ने काट", "जुबान लड़खड़ा", "ज़ुबान लड़खड़ा", "लड़खड़ा रही", "लड़खड़ा रहा", "एक तरफ लुढ़क", "लुढ़क गई", "लुढ़क गया", "बोल नहीं रहीं", "अटक गया", "कुछ अटक", "सुन्न हो गया", "सुन्न हो गई", "खून बहुत बह रहा", "होश में नहीं",
  ],
  broad: [
    "took too many", "taken too many", "overdosed", "took an overdose", "had an overdose", "swallowed something", "ate something poisonous", "poisoned", "poisonous", "swallowed a", "throat swelling", "swollen throat", "swelling in my throat",
    "swelling in his throat", "swelling in her throat", "tongue is swelling", "lips are swelling", "face is swelling", "allergic reaction", "blue lips", "lips look blue", "lips turning blue", "turning blue", "blood coming from", "bleeding from",
    "very drowsy", "drowsy and confused", "confused and drowsy",
    "kuch kha liya", "kuch kha liya hai", "zeher", "zehar", "zeher kha", "gale mein sujan", "ulti ho rahi", "ulti ho raha", "aankhein nahi khol", "tedha ho gaya", "nila pad", "nila ho gaya",
    "ज़हर", "जहर", "ज़हरीला", "जहरीला", "निगल लिया", "कुछ खा लिया", "गले में सूजन", "आँखें नहीं खोल", "चेहरा टेढ़ा", "नीला पड़", "उल्टी हो रही",
    "very sleepy", "getting very sleepy", "getting sleepy", "wont stay awake", "cant stay awake", "hit her head", "hit his head", "hit my head", "doesnt know where she is", "doesnt know where he is", "doesnt know where i am", "dont know where i am", "open bottle", "found him with", "found her with", "drank something", "sunn", "सुन्न", "आँखों के आगे अंधेरा", "हाथ पैर कांप रहे",
  ],
};

/**
 * Chest pain, or tightness: a place and a feeling of it within a few words of each other ("chest pain", "pain in my chest", "chest feels tight", "seene mein bahut tez dard"). An emergency only with a sign
 * that spreads or takes the breath (the plan: arm, jaw or breath), a "now" and a person.
 */
export const CHEST_PLACE: string[] = ["chest", "seene", "seena", "सीने", "सीना"];
export const CHEST_FEEL: string[] = [
  "pain", "hurts", "hurting", "hurt", "ache", "aching", "tight", "tightness", "pressure", "heavy", "heaviness", "crushing", "squeezing", "clutching",
  "dard", "jakdan", "bhaari", "bhari", "dabav", "दर्द", "जकड़न", "भारी", "भारीपन", "दबाव",
  "chhati", "chati", "छाती",
  "jakad", "jakdi", "jakad gayi", "jakad gaya", "sunn", "जकड़", "जकड़ गई", "जकड़ गया",
];
export const SPREAD: string[] = [
  "arm", "arms", "jaw", "neck", "shoulder", "back", "breath", "breathe", "breathing", "sweat", "sweating", "sweaty", "nausea", "nauseous", "dizzy", "dizziness", "faint", "numb", "heart is racing", "heart racing", "racing heart", "left side",
  "haath", "baayen", "baaye", "jabda", "saans", "pasina", "ghabrahat", "chakkar",
  "हाथ", "बायाँ", "बाएँ", "जबड़ा", "साँस", "पसीना", "घबराहट", "चक्कर",
  "lightheaded", "vision", "sunn", "सुन्न", "बाएं", "बायें", "baya", "baye",
];

/* ---------------------------------------------------------------- DECISION: a personal medicine or dose decision */

/** What the person asks about taking: the first person is in the phrase, or a first-person word is near it (Hinglish and Hindi put the verb last). */
export const DECISION_FRAME: Words = {
  core: [],
  broad: [
    "can i take", "can i also take", "can i just take", "should i take", "should i also take", "should i stop taking", "can i stop taking", "should i start taking", "can i start taking", "may i take", "am i allowed to take",
    "is it safe for me to take", "is it safe for me to stop", "is it ok for me to take", "is it okay for me to take", "is it ok for me to stop taking", "is it okay for me to stop taking", "is it safe for me", "can i give my", "should i give my",
    "how much should i take", "how many should i take", "what should i take", "which should i take", "what can i take", "can i mix", "can i drink alcohol with", "can i take it with",
    "le sakta hoon", "le sakti hoon", "leni chahiye", "lena chahiye", "kya main le", "kaun si dawai", "kaun si goli", "kaun si dawa", "band kar sakta hoon", "kha sakta hoon", "kha sakti hoon", "lun kya", "lene chahiye",
    "ले सकता हूँ", "ले सकती हूँ", "लेनी चाहिए", "लेना चाहिए", "कौन सी दवा", "कौन सी गोली", "बंद कर सकता हूँ", "बंद कर सकती हूँ", "खा सकता हूँ", "खा सकती हूँ", "क्या मैं ले",
    "should i stop", "can i stop", "should i start", "can i start", "should i finish", "should i skip", "can i skip", "should i continue", "should i quit", "can i quit", "should i really start", "should i take it or not", "is it ok for me to start", "is it safe for me to start", "is it okay for me to stop", "can i drink", "can i eat", "should i mix", "chhod du", "chhod dun", "chhod doon", "chhod sakta hoon", "chhod sakti hoon", "shuru karun", "shuru kar sakta", "shuru kar sakti", "le lu", "le lun", "le loon", "pee sakta hoon", "pi sakta hoon", "pee sakti hoon", "pi sakti hoon", "sakta hoon", "sakti hoon", "kya main le", "kya mai le", "lena theek", "lena thik", "leni theek", "छोड़ दूँ", "छोड़ दूं", "छोड़ सकता हूँ", "छोड़ सकती हूँ", "शुरू करूँ", "लेना ठीक रहेगा", "लेना ठीक है", "ले लूँ", "सकता हूँ", "सकती हूँ", "पी सकता हूँ", "पी सकती हूँ",
  ],
};
/** A medicine, or a kind of one, or a dose: what makes a "can I take" a question about a medicine. */
export const MEDICINE: string[] = [
  "tablet", "tablets", "pill", "pills", "medicine", "medicines", "medication", "medications", "drug", "drugs", "capsule", "capsules", "syrup", "injection", "supplement", "supplements", "antibiotic", "antibiotics", "painkiller", "painkillers",
  "antidepressant", "antidepressants", "antihistamine", "steroid", "steroids", "insulin", "paracetamol", "acetaminophen", "ibuprofen", "aspirin", "metformin", "cetirizine", "amoxicillin", "azithromycin", "omeprazole", "pantoprazole", "vitamin",
  "vitamins", "ashwagandha", "melatonin", "sertraline", "warfarin", "statin", "statins", "contraceptive", "contraceptives", "dose", "dosage", "mg", "amlodipine", "thyroxine", "levothyroxine", "prednisolone", "diclofenac", "crocin", "brufen", "dolo",
  "dawa", "dawai", "dawaai", "goli", "goliyan", "tablets", "calpol",
  "दवा", "दवाई", "गोली", "गोलियाँ", "टैबलेट", "कैप्सूल", "इंजेक्शन", "सिरप", "पैरासिटामोल", "क्रोसिन", "एंटीबायोटिक", "थायरॉइड",
  "powder", "protein", "protein powder", "creatine", "iron", "tonic", "inhaler", "ointment", "cream", "drops", "vaccine", "herbal", "ayurvedic", "homeopathic", "antibiotic", "bp tablet", "sleeping pill", "sleeping pills", "tablet", "आयरन", "सिरप", "नींद की दवा", "घरेलू उपाय", "टॉनिक", "इनहेलर", "प्रोटीन",
];
/** "my" and a word after it that is not a relative: "my patients", "my thesis". A first person that is a professional, not a person with a health story. */
export const NOT_A_RELATION: string[] = [
  "patient", "patients", "student", "students", "participants", "clients", "team", "lab", "thesis", "research", "study", "project", "paper", "papers", "work", "supervisor", "advisor", "professor", "dissertation", "class", "classes", "hospital",
  "clinic", "department", "trial", "review", "literature", "data", "dataset", "model", "code", "program", "survey", "interviews", "participant", "cohort", "sample", "samples", "findings", "results", "colleagues",
];

/* ---------------------------------------------------------------- CARE: a health or distress story with a research question */

/** A health situation: said of the writer or of a relative. Conditions and what is taken count only after a word of CONDITION_LEAD ("I have diabetes", not "papers on diabetes"). */
export const HEALTH: string[] = [
  "pregnant", "pregnancy", "breastfeeding", "diagnosed", "my medication", "my medicines", "my symptoms", "i suffer from", "suffering from", "living with",
  "side effects for me", "my side effects", "my treatment", "my diagnosis", "my test results", "my blood pressure", "my sugar",
  "mujhe diabetes hai", "mujhe bukhar hai", "mere pita ko", "meri maa ko", "mere papa ko", "meri mummy ko", "mujhe thyroid hai", "main dawai le", "main goli le", "mujhe sugar hai",
  "मुझे मधुमेह है", "मुझे बुखार है", "मेरे पिता को", "मेरी माँ को", "मेरी मां को", "मेरे पापा को", "मुझे थायरॉइड है", "मैं दवा ले", "मुझे गठिया है", "मेरे पति को", "मेरी पत्नी को",
  "doctor said", "doctor told", "the doctor said", "prescribed", "my condition", "his condition", "her condition", "had a stroke", "had a heart attack", "had surgery", "after surgery", "had an operation", "recovering from", "started a new tablet", "side effects of my", "mummy ko", "papa ko", "dadi ko", "dada ko", "nani ko", "nana ko", "bhai ko", "behen ko", "beti ko", "beta ko", "पापा को", "मम्मी को", "दादी को", "दादा को", "नानी को", "भाई को", "बहन को", "बेटी को", "बेटे को", "बेटा", "पिताजी को", "पति को", "पत्नी को", "मुझे गर्भवती", "गर्भवती हूँ", "प्रेग्नेंट", "pregnant hoon", "garbhwati",
];
/** A way of saying what is taken, which is a health situation only with a medicine after it ("I take sertraline", "my mother is on warfarin"; not "I take the bus"). */
export const MEDICINE_LEAD: string[] = ["i take", "i am taking", "im taking", "i have been taking", "is taking", "was prescribed", "is on", "am on", "im on", "are on", "has been taking", "main le raha hoon", "main leta hoon", "मैं लेता हूँ"];
export const CONDITION_LEAD: string[] = ["have", "has", "had", "with", "from", "diagnosed with", "suffering from", "living with", "got", "hai", "hain", "ho gaya", "ho gayi", "है", "हैं", "हो गया", "हो गई"];
export const CONDITION: string[] = [
  "diabetes", "diabetic", "hypertension", "blood pressure", "asthma", "arthritis", "cancer", "thyroid", "pcos", "migraine", "epilepsy", "parkinsons", "parkinson", "alzheimers", "dementia", "depression", "anxiety", "panic attacks", "insomnia",
  "eczema", "psoriasis", "kidney disease", "heart disease", "a heart condition", "cholesterol", "obesity", "an infection", "covid", "tb", "tuberculosis", "hiv", "anaemia", "anemia", "fibromyalgia", "ibs", "gerd", "sugar", "bp",
  "diabetes", "madhumeh", "गठिया", "मधुमेह", "थायरॉइड", "कैंसर", "अवसाद", "दमा", "बीपी", "शुगर", "डायबिटीज़", "डायबिटीज",
  "stroke", "adhd", "autism", "speech delay", "not speaking", "arthritis", "ghutne", "अर्थराइटिस", "भूलने की बीमारी", "डिमेंशिया", "एडीएचडी", "आँखों में धुंधलापन", "प्रसव", "diabetes", "डायबिटीज़ है", "अस्थमा",
];
/** How the writer feels: with a first person near it ("I feel very low"). */
export const FEELING: string[] = [
  "feeling very low", "feel very low", "felt very low", "feeling low", "feel low", "felt low", "feeling hopeless", "feel hopeless", "felt hopeless", "hopeless", "feel depressed", "feeling depressed", "i am depressed", "im depressed",
  "feel empty", "feeling empty", "panic attacks", "i have panic attacks", "cant sleep", "cannot sleep", "unable to sleep", "not sleeping", "feel anxious", "feeling anxious", "feeling sad", "feel sad", "feeling down", "feel down", "feeling overwhelmed",
  "feel overwhelmed", "feeling stressed", "so stressed", "feel lonely", "feeling lonely", "feel burnt out", "feeling burnt out", "burned out", "burnt out",
  "udaas", "udaasi", "neend nahi aati", "ghabrahat", "bechain", "tension mein", "mann bhaari", "man bhaari", "निराश", "उदास", "उदासी", "नींद नहीं आती", "घबराहट", "बेचैन", "अवसाद में",
  "feel hopeless", "feeling hopeless", "so stressed", "barely sleeping", "not sleeping well", "cant sleep", "mood low", "low mood", "feeling flat", "feel flat", "feel foggy", "feeling foggy",
];
/** What asks research: a question to the literature, with the first person's question inside it or not. */
export const LOOKUP: string[] = [
  "what does research say", "what does the research say", "what do studies say", "what do the studies say", "what does the evidence say", "what does science say", "what does the literature say", "is there any research", "is there research",
  "are there any studies", "are there studies", "is there any evidence", "is there evidence", "any research", "any studies", "any evidence", "any papers", "research on", "research about", "studies on", "studies about", "papers on", "evidence on",
  "evidence for", "evidence that", "evidence of", "is it safe", "is it harmful", "is it okay", "is it ok", "does it help", "does it work", "does it cause", "can it cause", "what is the evidence", "what does the data say", "find studies", "find papers", "any literature",
  "research kehti", "research kya", "koi research", "koi study", "research hai", "study hai", "kya research", "kya study", "kya safe", "safe hai",
  "शोध", "अध्ययन", "रिसर्च", "कोई शोध", "शोध क्या कहता", "शोध क्या कहती", "कोई अध्ययन", "क्या सुरक्षित",
  "what research says", "what the research says", "what studies say", "what the studies say", "what research shows", "what studies show", "what the studies show", "what the evidence says", "what the evidence shows", "does research say", "do studies show", "does the research say", "what does the evidence show", "is there a study", "is there a research", "any study", "any proof", "is there proof", "does it really help", "research says", "studies show", "koi proof", "proof hai", "koi shodh", "shodh kehta", "research mein", "research me", "study hai kya", "research hai kya", "research kya kehti", "research kehti hai", "क्या शोध", "शोध बताता", "शोध क्या कहता", "रिसर्च है", "कोई रिसर्च", "रिसर्च क्या", "अध्ययन हो", "कोई अध्ययन", "शोध-आधारित", "शोध आधारित", "शोध कहता", "क्या कोई शोध",
];

/* ---------------------------------------------------------------- the same sets under one name, for the tests and for lane.ts */

export const SELF_ONLY: string[] = ["i", "im", "ive", "me", "my", "mine", "myself", "main", "mujhe", "mera", "meri", "mere", "मैं", "मुझे", "मेरा", "मेरी", "मेरे"];

/** Words that only say how much: dropped from a message and from every phrase alike, so that "I really want to die" and "I am so scared" are "I want to die" and "I am scared". */
export const INTENSIFIERS: string[] = ["really", "honestly", "actually", "truly", "literally", "genuinely", "seriously", "simply", "so", "very", "totally", "completely", "bahut", "bohot", "kaafi", "बहुत"];

/**
 * What a person says in the moment when something is happening: "what do I do", "kya karu", "jaldi batao", "please help". It holds a first person (or the verb of one) and it is a request for what to do NOW, so it
 * stands for both the person and the "now" of an emergency ("my baby is bleeding heavily, what do we do"). It does not make an emergency by itself: a symptom has to be there.
 */
export const APPEAL: string[] = [
  "what do i do", "what should i do", "what can i do", "what do we do", "what should we do", "what can we do", "please help", "pls help", "plz help", "help me", "is this a stroke", "is this a heart attack", "is this an emergency", "should i call an ambulance",
  "calling the ambulance", "call an ambulance", "which hospital", "i am so scared", "im so scared", "cpr",
  "kya karu", "kya karun", "kya karoon", "kya kare", "kya karein", "kya karen", "kya karna chahiye", "kya karna hai", "jaldi batao", "jaldi bolo", "jaldi batayiye", "jaldi bataiye", "jaldi", "turant batao", "pehle kya karna chahiye", "ambulance", "cpr kar sakta hoon",
  "क्या करूँ", "क्या करें", "क्या करना है", "क्या करना चाहिए", "अब क्या करें", "जल्दी बताइए", "जल्दी बताइये", "जल्दी बताओ", "जल्दी", "कृपया जल्दी", "पहले क्या करना चाहिए", "एम्बुलेंस", "एंबुलेंस",
];
/** Words that make what follows a case that is not happening: "what should I do WHEN a patient is not breathing". The symptom just after one of them is not read as an emergency. */
export const CONDITIONAL_WORDS: string[] = ["if", "when", "whenever", "while", "suppose", "incase", "whether", "agar", "jab", "अगर", "जब"];

/** How the writer feels, said without a pronoun, as Hinglish and Hindi say it ("neend nahi aati"): the first person is in the verb. */
export const FEELING_SELF: string[] = [
  "neend nahi aati", "neend bhi nahi aati", "man udaas", "mann udaas", "udaas rehta", "udaas rehti", "anxiety rehti hai", "low rehta hai", "mood low", "kuch accha nahi lagta", "dil nahi lagta", "mann nahi lagta", "man nahi lagta", "ghabrahat rehti",
  "मन उदास", "मन बहुत उदास", "नींद नहीं आती", "नींद भी नहीं आती", "उदास रहता", "उदास रहती", "मन नहीं लगता", "दिल नहीं लगता", "घबराहट रहती", "किसी चीज़ में दिल नहीं लगता",
];

/** What after a way of asking "should I take" makes it no question about a medicine: "should I take notes", "can I take a break". The words that come right after the phrase. */
export const DECISION_NOT_IF_FOLLOWED_BY: string[] = [
  "notes", "a break", "a look", "a course", "a class", "an exam", "the exam", "a test", "the test", "a nap", "a walk", "a seat", "the bus", "the train", "a day off", "a holiday", "a vacation", "part in", "time off", "leave", "a picture", "a photo", "a risk",
];
