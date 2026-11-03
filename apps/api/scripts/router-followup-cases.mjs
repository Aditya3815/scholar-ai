// The labelled follow-ups the router is measured on when a message comes with the turns before it (docs/design/chat-actions-context.md, sections 5 and 9): what a person types after an answer,
// in English, Hindi (Devanagari) and Hinglish (Hindi in Roman letters), and what it means. `node scripts/router-eval.mjs --followup` runs them with the REAL model through the development route.
//
// Each case: { id, lang, cls, history, earlier, message, want }.
//   cls: refine        the same subject, something changed or added ("and in children?")
//        same_papers   about the papers or the answer on the screen ("tell me more about paper 2")
//        restyle       the same answer in another form or language ("explain that simpler", "in Hindi")
//        year_filter   a range of years ("only after 2020"; also "recent ones", which names no year: no filter is right)
//        new_search    a new question that happens to follow an answer: it must be searched with its own words
//        topic_switch  the NEGATIVE: a different topic; the old topic's words must not come along (mustNotContain)
//        earlier_chat  the first message of a new chat that was started from an earlier chat (`earlier`, no `history`)
//   want.intent       "new" | "refine" | "same_papers", or a list of the ones that are all right
//   want.yearFrom / yearTo   a number, or a list of the numbers that are all right ("after 2020" is 2020 or 2021); absent means NO year range is right
//   want.answerLanguage      "en" | "hi" | "hinglish" when the person asks for a language; absent means none asked
//   want.mustContain         words (a word, or a list of alternatives) that the standalone question or the search words must have: the earlier topic that the message leans on, the new word it adds
//   want.mustNotContain      words that must NOT be in what is searched (topic_switch: the old topic)
// The answer of the router is scored on what the server makes of it (restate.ts has already refused a restatement that adds a number, a name or a "not"), so a case measures what a person would get.
//
// TUNED is the list the router's follow-up prompt and the rules' cue lists are tuned on (its first run will find mistakes, and each is fixed). HOLDOUT was written on 3 November 2026, BEFORE the router
// had ever been run on a follow-up and before any tuning, on other subjects and in other words, so that its number is the honest one: nothing may be changed because of it the first time it is run.
// New wrong answers found in real use go into TUNED (and are fixed); write fresh ones in HOLDOUT. `--set=holdout` runs it.
// 3 Nov 2026: the first real run read the hold-out in full, and the rule that decides whether a message is read with the turns (`needsContext`) was then changed on four of its cases; those four were moved
// into TUNED (their ids there end in -6, -5, -5 and -4), and HOLDOUT2 (five cases, `--set=holdout2`) was written before the change and not looked at while it was made. The first hold-out is therefore
// an honest number for nothing that was changed after that run (the prompt's restyle, same-papers and year wording was), and HOLDOUT2 is the only list nothing was tuned on.

const U = (text) => ({ role: "user", text });
const A = (o = {}) => ({ role: "assistant", ...o });

/* ------------------------------------------------------------ conversations: the turns before the message, and the words of the topic that a new topic must not take along */

const YOGA = {
  history: [U("effect of yoga on blood pressure"), A({ searchQuery: "yoga blood pressure", papers: [{ n: 1, title: "Yoga and hypertension in Kerala: a randomised trial", year: 2021 }, { n: 2, title: "Pranayama and blood pressure in adults", year: 2019 }], text: "Yoga lowered systolic blood pressure in several trials [1]. Breathing exercises alone had a smaller effect [2]." })],
  old: ["yoga", "blood pressure", "hypertension", "pranayama"],
};
const DIABETES = {
  history: [U("diabetes me exercise ka kya asar hota hai"), A({ searchQuery: "effect of exercise on diabetes", language: "hinglish", papers: [{ n: 1, title: "Exercise and glycaemic control in type 2 diabetes", year: 2020 }, { n: 2, title: "Walking programmes for adults with diabetes", year: 2018 }], text: "Exercise se blood sugar ka control behtar hota hai [1]. Roz 30 minute chalna bhi madad karta hai [2]." })],
  old: ["diabetes", "exercise", "glycaemic", "walking"],
};
const TB = {
  history: [U("भारत में तपेदिक दवा प्रतिरोध पर अध्ययन"), A({ searchQuery: "drug resistant tuberculosis India", language: "hi", papers: [{ n: 1, title: "Drug-resistant tuberculosis in India: a national survey", year: 2020 }, { n: 2, title: "Treatment outcomes of multidrug-resistant TB in Delhi", year: 2017 }], text: "भारत में दवा प्रतिरोधी तपेदिक के मामले कई राज्यों में दर्ज हुए हैं [1]। इलाज पूरा करने की दर कम पाई गई [2]।" })],
  old: ["tubercul", "तपेदिक", "drug resistan", "delhi"],
};
// a conversation of two turns, the second a follow-up already (its reply was limited to 2020 and later)
const GLAUCOMA = {
  history: [U("glaucoma screening with smartphone fundus photographs"), A({ searchQuery: "glaucoma screening smartphone fundus photographs", papers: [{ n: 1, title: "Smartphone fundus imaging for glaucoma screening", year: 2022 }, { n: 2, title: "Deep learning for glaucoma detection from retinal photographs", year: 2021 }] }), U("only after 2020"), A({ searchQuery: "glaucoma screening smartphone fundus photographs", yearFrom: 2020, papers: [{ n: 1, title: "Smartphone fundus imaging for glaucoma screening", year: 2022 }], text: "Smartphone fundus photographs found glaucoma with good sensitivity [1]." })],
  old: ["glaucoma", "fundus", "smartphone"],
};
const GUT = {
  history: [U("role of gut microbiome in Parkinson's disease"), A({ searchQuery: "gut microbiome Parkinson's disease", papers: [{ n: 1, title: "Gut microbiota alterations in Parkinson's disease", year: 2019 }, { n: 2, title: "Faecal transplant in Parkinson's disease: a pilot study", year: 2023 }], text: "People with Parkinson's disease have a different gut microbiome from healthy people [1]. A small pilot of faecal transplant reported some benefit [2]." })],
  old: ["microbiome", "microbiota", "parkinson", "gut", "faecal"],
};
const RESNET = {
  history: [U("compare ResNet and ViT on small datasets"), A({ searchQuery: "ResNet vision transformer small datasets comparison", papers: [{ n: 1, title: "Vision transformers on small datasets: a fair comparison with ResNets", year: 2022 }, { n: 2, title: "How well do ResNets train from scratch on limited data", year: 2020 }, { n: 3, title: "Data-efficient image transformers", year: 2021 }], text: "ResNets usually did better than vision transformers when training data was small [1][2]. Distillation narrowed the gap [3]." })],
  old: ["resnet", "vision transformer", "vit", "small datasets"],
};
const MALNUTRITION = {
  history: [U("cash transfer se bachon ki malnutrition kam hoti hai kya"), A({ searchQuery: "cash transfers child malnutrition", language: "hinglish", papers: [{ n: 1, title: "Cash transfers and child nutrition: a systematic review", year: 2021 }, { n: 2, title: "Unconditional cash transfers and stunting in rural households", year: 2018 }], text: "Cash transfer se bachon ka poshan kuch had tak sudharta hai [1]. Stunting par asar chhota tha [2]." })],
  old: ["cash transfer", "malnutrition", "stunting", "poshan"],
};
const GROUNDWATER = {
  history: [U("भूजल स्तर गिरने के कारणों पर शोध पत्र"), A({ searchQuery: "causes of groundwater depletion India", language: "hi", papers: [{ n: 1, title: "Groundwater depletion in northwest India from satellite data", year: 2019 }, { n: 2, title: "Irrigation and falling water tables in Punjab", year: 2016 }], text: "उत्तर भारत में भूजल गिरने का मुख्य कारण सिंचाई के लिए अधिक पंपिंग है [1][2]।" })],
  old: ["groundwater", "भूजल", "water table", "irrigation"],
};

const ASTHMA = {
  history: [U("air pollution and asthma in children in Delhi"), A({ searchQuery: "air pollution childhood asthma Delhi", papers: [{ n: 1, title: "Fine particulate matter and paediatric asthma admissions in Delhi", year: 2020 }, { n: 2, title: "Indoor cooking smoke and wheeze in schoolchildren", year: 2017 }], text: "Days with more fine particles were followed by more asthma admissions in children [1]. Smoke from indoor cooking also raised wheeze [2]." })],
  old: ["pollution", "asthma", "delhi", "particulate", "wheeze"],
};
const CROP_INSURANCE = {
  history: [U("fasal bima yojana ka kisano par kya asar hua"), A({ searchQuery: "crop insurance scheme impact on farmers India", language: "hinglish", papers: [{ n: 1, title: "Crop insurance and farm income in India: evidence from a national scheme", year: 2019 }, { n: 2, title: "Why farmers do not claim crop insurance", year: 2016 }], text: "Fasal bima se kisano ki aay mein thoda sudhaar dikha [1]. Bahut se kisano ne claim hi nahi kiya [2]." })],
  old: ["insurance", "bima", "kisan", "farmer", "claim"],
};
const STROKE = {
  history: [U("स्ट्रोक के बाद पुनर्वास के तरीकों पर शोध"), A({ searchQuery: "stroke rehabilitation methods", language: "hi", papers: [{ n: 1, title: "Early rehabilitation after stroke: a randomised trial", year: 2021 }, { n: 2, title: "Home-based exercise programmes for stroke survivors", year: 2018 }], text: "स्ट्रोक के बाद जल्दी पुनर्वास शुरू करने से रिकवरी बेहतर रही [1]। घर पर कसरत के कार्यक्रम भी मददगार रहे [2]।" })],
  old: ["stroke", "स्ट्रोक", "rehabilitation", "पुनर्वास"],
};

const c = (id, lang, cls, conv, message, want, earlier = []) => ({ id, lang, cls, history: conv.history, earlier, message, want: { ...(cls === "topic_switch" ? { mustNotContain: conv.old } : {}), ...(cls === "new_search" && conv.old ? { mustNotContain: conv.old } : {}), ...want } });
/** a first message of a chat that was started from an earlier chat: no turns, only that chat's questions */
const e = (id, lang, message, earlierQuestions, want) => ({ id, lang, cls: "earlier_chat", history: [], earlier: earlierQuestions, message, want });

const R = "refine";
const S = "same_papers";
const N = "new";

/* ------------------------------------------------------------ the list the prompt is tuned on */

export const TUNED = [
  /* English */
  c("en-refine-1", "en", "refine", YOGA, "and in children?", { intent: R, mustContain: [["children", "child", "pediatric", "paediatric"], ["yoga"]] }),
  c("en-refine-2", "en", "refine", YOGA, "what about older adults", { intent: R, mustContain: [["older", "elderly", "aged"], ["yoga"]] }),
  c("en-refine-3", "en", "refine", YOGA, "only randomised trials", { intent: R, mustContain: [["random", "rct"], ["yoga"]] }),
  c("en-refine-4", "en", "refine", YOGA, "how about in India specifically", { intent: R, mustContain: [["india"], ["yoga"]] }),
  c("en-refine-5", "en", "refine", YOGA, "does it work for women too", { intent: R, mustContain: [["women", "female"], ["yoga"]] }),
  c("en-refine-6", "en", "refine", GLAUCOMA, "and what about cost?", { intent: R, mustContain: [["cost"], ["glaucoma"]] }),
  c("en-same-1", "en", "same_papers", YOGA, "tell me more about paper 2", { intent: S }),
  c("en-same-2", "en", "same_papers", YOGA, "what does the first paper say about sample size", { intent: S }),
  c("en-same-3", "en", "same_papers", YOGA, "which of these is the most recent", { intent: S }),
  c("en-restyle-1", "en", "restyle", YOGA, "explain that simpler", { intent: S }),
  c("en-restyle-2", "en", "restyle", YOGA, "summarise that in two lines", { intent: S }),
  c("en-restyle-3", "en", "restyle", YOGA, "can you say that in Hindi", { intent: S, answerLanguage: "hi" }),
  c("en-restyle-4", "en", "restyle", YOGA, "give that as bullet points", { intent: S }),
  c("en-restyle-5", "en", "restyle", YOGA, "shorter please", { intent: S }),
  c("en-year-1", "en", "year_filter", YOGA, "only after 2020", { intent: R, yearFrom: [2020, 2021], mustContain: [["yoga"]] }),
  c("en-year-2", "en", "year_filter", YOGA, "papers from 2018 or earlier", { intent: R, yearTo: [2018], mustContain: [["yoga"]] }),
  c("en-year-3", "en", "year_filter", YOGA, "between 2015 and 2019", { intent: R, yearFrom: [2015], yearTo: [2019], mustContain: [["yoga"]] }),
  c("en-year-4", "en", "year_filter", YOGA, "only 2022", { intent: R, yearFrom: [2022], yearTo: [2022], mustContain: [["yoga"]] }),
  c("en-year-5", "en", "year_filter", YOGA, "recent ones only", { intent: R, mustContain: [["yoga"]] }), // names no year: a filter would be a guess
  // Added on 3 Nov 2026 with the change of the rule that settles a message of five words or more with no cue as a plain search (route.ts, `needsContext`). Each of these is a natural follow-up that has no
  // cue and five words or more, so the old rule searched it as written without a model reading it. Four of them are MOVED here from the hold-out (their ids there were en-h-restyle-3, hg-h-refine-2,
  // hg-h-year-1, hi-h-refine-2: the rule was tuned on them, so they are no longer an honest test); the rest are the probes the reviewers wrote and the real failure of a real run ("papers from 2018 to 2021").
  c("en-restyle-6", "en", "restyle", YOGA, "give me the short version", { intent: S }), // moved from the hold-out
  c("en-refine-7", "en", "refine", YOGA, "what were the side effects in children", { intent: R, mustContain: [["side effect", "adverse"], ["children", "child"], ["yoga"]] }),
  c("en-refine-8", "en", "refine", YOGA, "are there any trials from India", { intent: R, mustContain: [["india"], ["yoga"]] }),
  c("en-same-4", "en", "same_papers", YOGA, "how large were the sample sizes", { intent: S }),
  c("en-same-5", "en", "same_papers", YOGA, "which studies used a control group", { intent: S }),
  c("en-year-6", "en", "year_filter", YOGA, "papers from 2018 to 2021", { intent: R, yearFrom: [2018], yearTo: [2021], mustContain: [["yoga"]] }),
  c("en-year-7", "en", "year_filter", GLAUCOMA, "limit to studies after 2018", { intent: R, yearFrom: [2018, 2019], mustContain: [["glaucoma"]] }),
  c("en-topic-1", "en", "topic_switch", YOGA, "now tell me about CRISPR off-target effects", { intent: N, mustContain: [["crispr"]] }),
  c("en-topic-2", "en", "topic_switch", YOGA, "different topic: microplastics in drinking water", { intent: N, mustContain: [["microplastic"]] }),
  c("en-topic-3", "en", "topic_switch", GLAUCOMA, "next, dengue vaccine trials", { intent: N, mustContain: [["dengue"]] }),
  c("en-new-1", "en", "new_search", YOGA, "glaucoma screening", { intent: N, mustContain: [["glaucoma"]] }),
  c("en-new-2", "en", "new_search", YOGA, "effect of intermittent fasting on insulin sensitivity", { intent: N, mustContain: [["fasting"]] }),
  // The first draft of the second hold-out (five cases, written before the rule was changed) was read by its author while the rule's word lists were made: four of its messages were put into the rule's
  // own test by mistake. It is therefore a tuned list like the others, and these are its cases, with their ids changed; the second hold-out was written again (HOLDOUT2, below).
  c("en-year-8", "en", "year_filter", ASTHMA, "papers published between 2012 and 2016", { intent: R, yearFrom: [2012], yearTo: [2016], mustContain: [["asthma"]] }),
  c("en-restyle-7", "en", "restyle", ASTHMA, "put the answer into three bullet points", { intent: S }),
  c("hg-year-6", "hinglish", "year_filter", CROP_INSURANCE, "2015 ke baad chhape hue papers dikhao", { intent: R, yearFrom: [2015, 2016], mustContain: [["bima", "insurance"]] }),
  c("hi-refine-5", "hi", "refine", STROKE, "ग्रामीण इलाकों में नतीजे कैसे रहे", { intent: R, mustContain: [["rural", "ग्रामीण"], ["stroke", "स्ट्रोक", "rehab", "पुनर्वास"]] }),
  c("en-new-3", "en", "new_search", ASTHMA, "role of the microbiome in treating childhood obesity", { intent: N, mustContain: [["microbiome"], ["obesity"]] }),
  e("en-earlier-1", "en", "and in children?", [{ question: "effect of yoga on blood pressure", searchQuery: "yoga blood pressure" }], { intent: R, mustContain: [["yoga"], ["children", "child", "pediatric", "paediatric"]] }),
  e("en-earlier-2", "en", "what about its side effects", [{ question: "does tulsi improve immunity", searchQuery: "tulsi immunity" }, { question: "sleep and memory in teenagers" }], { intent: R, mustContain: [["tulsi"], ["side effect", "adverse"]] }),

  /* Hinglish */
  c("hg-refine-1", "hinglish", "refine", DIABETES, "aur bachon me?", { intent: R, mustContain: [["bachon", "bachche", "children", "child"], ["diabet"]] }),
  c("hg-refine-2", "hinglish", "refine", DIABETES, "aur buzurgon me?", { intent: R, mustContain: [["buzurg", "older", "elderly"], ["diabet"]] }),
  c("hg-refine-3", "hinglish", "refine", DIABETES, "kya ye India me bhi kaam karta hai", { intent: R, mustContain: [["india"], ["diabet", "exercise"]] }),
  c("hg-refine-4", "hinglish", "refine", DIABETES, "aur mahilaon me kya asar hai", { intent: R, mustContain: [["mahila", "women", "female"], ["diabet", "exercise"]] }),
  c("hg-same-1", "hinglish", "same_papers", DIABETES, "dusre paper ke baare me aur batao", { intent: S }),
  c("hg-same-2", "hinglish", "same_papers", DIABETES, "pehle paper me sample size kitna tha", { intent: S }),
  c("hg-restyle-1", "hinglish", "restyle", DIABETES, "isko simple words me samjhao", { intent: S }),
  c("hg-restyle-2", "hinglish", "restyle", DIABETES, "Hindi me batao", { intent: S, answerLanguage: "hi" }),
  c("hg-restyle-3", "hinglish", "restyle", DIABETES, "ye English me batao", { intent: S, answerLanguage: "en" }),
  c("hg-restyle-4", "hinglish", "restyle", DIABETES, "chhota karke batao", { intent: S }),
  c("hg-year-1", "hinglish", "year_filter", DIABETES, "sirf 2020 ke baad ke papers", { intent: R, yearFrom: [2020, 2021], mustContain: [["diabet", "exercise"]] }),
  c("hg-year-2", "hinglish", "year_filter", DIABETES, "2015 se pehle ke papers", { intent: R, yearTo: [2014, 2015], mustContain: [["diabet", "exercise"]] }),
  c("hg-year-3", "hinglish", "year_filter", DIABETES, "sirf 2018 aur 2022 ke beech ke", { intent: R, yearFrom: [2018], yearTo: [2022], mustContain: [["diabet", "exercise"]] }),
  c("hg-year-4", "hinglish", "year_filter", DIABETES, "latest wale hi dikhao", { intent: R, mustContain: [["diabet", "exercise"]] }),
  c("hg-refine-5", "hinglish", "refine", DIABETES, "gaon me kya hota hai", { intent: R, mustContain: [["gaon", "rural", "village"], ["diabet", "exercise"]] }), // moved from the hold-out (hg-h-refine-2)
  c("hg-year-5", "hinglish", "year_filter", DIABETES, "2019 ke baad ke hi", { intent: R, yearFrom: [2019, 2020], mustContain: [["diabet", "exercise"]] }), // moved from the hold-out (hg-h-year-1)
  c("hg-topic-1", "hinglish", "topic_switch", DIABETES, "ab malaria vaccine ke baare me batao", { intent: N, mustContain: [["malaria"]] }),
  c("hg-topic-2", "hinglish", "topic_switch", DIABETES, "chodo, CRISPR ke off-target effects par papers do", { intent: N, mustContain: [["crispr"]] }),
  c("hg-new-1", "hinglish", "new_search", DIABETES, "dengue vaccine", { intent: N, mustContain: [["dengue"]] }),
  c("hg-new-2", "hinglish", "new_search", DIABETES, "India me TB ki drug resistance par latest studies", { intent: N, mustContain: [["tb", "tubercul"]] }),
  e("hg-earlier-1", "hinglish", "uske side effects kya hain", [{ question: "yoga ka blood pressure par asar", searchQuery: "effect of yoga on blood pressure" }], { intent: R, mustContain: [["yoga"], ["side effect", "adverse"]] }),

  /* Hindi, Devanagari */
  c("hi-refine-1", "hi", "refine", TB, "और बच्चों में?", { intent: R, mustContain: [["बच्चों", "बच्चे", "children", "child"], ["tubercul", "तपेदिक", "tb"]] }),
  c("hi-refine-2", "hi", "refine", TB, "सिर्फ़ ग्रामीण इलाकों में", { intent: R, mustContain: [["ग्रामीण", "rural"], ["tubercul", "तपेदिक", "tb"]] }),
  c("hi-refine-3", "hi", "refine", TB, "महिलाओं में कैसा रहा", { intent: R, mustContain: [["महिला", "women", "female"], ["tubercul", "तपेदिक", "tb"]] }),
  c("hi-refine-4", "hi", "refine", TB, "शहरों में क्या हाल है", { intent: R, mustContain: [["urban", "city", "cities", "शहर"], ["tubercul", "तपेदिक", "tb"]] }), // moved from the hold-out (hi-h-refine-2)
  c("hi-same-1", "hi", "same_papers", TB, "दूसरे पेपर के बारे में और बताओ", { intent: S }),
  c("hi-restyle-1", "hi", "restyle", TB, "इसे सरल भाषा में समझाओ", { intent: S }),
  c("hi-restyle-2", "hi", "restyle", TB, "अंग्रेज़ी में बताओ", { intent: S, answerLanguage: "en" }),
  c("hi-restyle-3", "hi", "restyle", TB, "संक्षेप में बताओ", { intent: S }),
  c("hi-year-1", "hi", "year_filter", TB, "सिर्फ 2020 के बाद", { intent: R, yearFrom: [2020, 2021], mustContain: [["tubercul", "तपेदिक", "tb"]] }),
  c("hi-year-2", "hi", "year_filter", TB, "२०१८ से पहले के", { intent: R, yearTo: [2017, 2018], mustContain: [["tubercul", "तपेदिक", "tb"]] }),
  c("hi-year-3", "hi", "year_filter", TB, "नवीनतम पेपर ही दिखाओ", { intent: R, mustContain: [["tubercul", "तपेदिक", "tb"]] }),
  c("hi-topic-1", "hi", "topic_switch", TB, "अब मलेरिया के टीके के बारे में बताओ", { intent: N, mustContain: [["malaria", "मलेरिया"]] }),
  c("hi-topic-2", "hi", "topic_switch", TB, "छोड़ो, कृत्रिम बुद्धिमत्ता से भाषा अनुवाद पर शोध दिखाओ", { intent: N, mustContain: [["translation", "अनुवाद", "language"]] }),
  c("hi-new-1", "hi", "new_search", TB, "मधुमेह में व्यायाम का प्रभाव", { intent: N, mustContain: [["diabet", "मधुमेह"]] }),
  e("hi-earlier-1", "hi", "और बच्चों में?", [{ question: "मधुमेह में व्यायाम का प्रभाव", searchQuery: "exercise diabetes" }], { intent: R, mustContain: [["exercise", "diabet", "मधुमेह", "व्यायाम"], ["बच्चों", "बच्चे", "children", "child"]] }),
];

/* ------------------------------------------------------------ the honest list: other subjects, other words, written before any tuning */

export const HOLDOUT = [
  /* English */
  c("en-h-refine-1", "en", "refine", GUT, "what about in mice?", { intent: R, mustContain: [["mice", "mouse", "murine"], ["microbio", "microbiota", "gut"]] }),
  c("en-h-refine-2", "en", "refine", GUT, "and for people over 70", { intent: R, mustContain: [["70", "older", "elderly"], ["parkinson"]] }),
  c("en-h-refine-3", "en", "refine", RESNET, "same but for medical images", { intent: R, mustContain: [["medical"], ["resnet", "vit", "transformer"]] }),
  c("en-h-refine-4", "en", "refine", RESNET, "only the ones that use pretraining", { intent: R, mustContain: [["pretrain", "pre-train"], ["resnet", "vit", "transformer"]] }),
  c("en-h-same-1", "en", "same_papers", GUT, "what did the second paper conclude", { intent: S }),
  c("en-h-same-2", "en", "same_papers", RESNET, "tell me more about the third one", { intent: S }),
  c("en-h-restyle-1", "en", "restyle", GUT, "can you put that more simply", { intent: S }),
  c("en-h-restyle-2", "en", "restyle", RESNET, "answer in Hinglish please", { intent: S, answerLanguage: "hinglish" }),
  c("en-h-year-1", "en", "year_filter", GUT, "nothing older than 2021", { intent: R, yearFrom: [2021], mustContain: [["microbio", "microbiota", "gut", "parkinson"]] }),
  c("en-h-year-2", "en", "year_filter", RESNET, "from 2019 to 2021", { intent: R, yearFrom: [2019], yearTo: [2021], mustContain: [["resnet", "vit", "transformer"]] }),
  c("en-h-year-3", "en", "year_filter", GUT, "the newest studies", { intent: R, mustContain: [["microbio", "microbiota", "gut", "parkinson"]] }),
  c("en-h-topic-1", "en", "topic_switch", GUT, "completely different: how do vaccines train the immune system", { intent: N, mustContain: [["vaccine"]] }),
  c("en-h-topic-2", "en", "topic_switch", RESNET, "forget that, what is known about air pollution and asthma in Delhi", { intent: N, mustContain: [["asthma"]] }),
  c("en-h-new-1", "en", "new_search", RESNET, "blockchain for land records", { intent: N, mustContain: [["blockchain"]] }),
  e("en-h-earlier-1", "en", "any trials in India?", [{ question: "gut bacteria and depression", searchQuery: "gut microbiome depression" }], { intent: R, mustContain: [["india"], ["gut", "microbio", "depression"]] }),

  /* Hinglish */
  c("hg-h-refine-1", "hinglish", "refine", MALNUTRITION, "aur ladkiyon me?", { intent: R, mustContain: [["ladkiyon", "girls", "girl", "female"], ["cash transfer", "malnutrition", "nutrition"]] }),
  c("hg-h-refine-3", "hinglish", "refine", MALNUTRITION, "kya iska India me koi study hai", { intent: R, mustContain: [["india"], ["cash transfer", "malnutrition", "nutrition"]] }),
  c("hg-h-same-1", "hinglish", "same_papers", MALNUTRITION, "pehle wale paper ka result batao", { intent: S }),
  c("hg-h-restyle-1", "hinglish", "restyle", MALNUTRITION, "aur aasan bhasha me batao", { intent: S }),
  c("hg-h-restyle-2", "hinglish", "restyle", MALNUTRITION, "Hindi me likho", { intent: S, answerLanguage: "hi" }),
  c("hg-h-year-2", "hinglish", "year_filter", MALNUTRITION, "sabse naye papers", { intent: R, mustContain: [["cash transfer", "malnutrition", "nutrition"]] }),
  c("hg-h-topic-1", "hinglish", "topic_switch", MALNUTRITION, "ab quantum computing ke baare me batao", { intent: N, mustContain: [["quantum"]] }),
  c("hg-h-topic-2", "hinglish", "topic_switch", MALNUTRITION, "achha, ab tulsi ka immunity par asar", { intent: N, mustContain: [["tulsi"], ["immun"]] }),
  c("hg-h-new-1", "hinglish", "new_search", MALNUTRITION, "land records ke liye blockchain", { intent: N, mustContain: [["blockchain"]] }),
  e("hg-h-earlier-1", "hinglish", "uske baare me aur papers do", [{ question: "gut bacteria ka mental health se kya connection hai", searchQuery: "gut microbiome mental health" }], { intent: R, mustContain: [["gut", "microbio"]] }),

  /* Hindi, Devanagari */
  c("hi-h-refine-1", "hi", "refine", GROUNDWATER, "और पंजाब में?", { intent: R, mustContain: [["punjab", "पंजाब"], ["groundwater", "भूजल", "water"]] }),
  c("hi-h-same-1", "hi", "same_papers", GROUNDWATER, "पहले पेपर के नतीजे बताओ", { intent: S }),
  c("hi-h-restyle-1", "hi", "restyle", GROUNDWATER, "इसे और छोटा करके बताओ", { intent: S }),
  c("hi-h-restyle-2", "hi", "restyle", GROUNDWATER, "हिंग्लिश में समझाओ", { intent: S, answerLanguage: "hinglish" }),
  c("hi-h-year-1", "hi", "year_filter", GROUNDWATER, "२०१५ के बाद के", { intent: R, yearFrom: [2015, 2016], mustContain: [["groundwater", "भूजल", "water"]] }),
  c("hi-h-year-2", "hi", "year_filter", GROUNDWATER, "सबसे नए अध्ययन", { intent: R, mustContain: [["groundwater", "भूजल", "water"]] }),
  c("hi-h-topic-1", "hi", "topic_switch", GROUNDWATER, "अब कैंसर की जांच के बारे में बताओ", { intent: N, mustContain: [["cancer", "कैंसर"]] }),
  c("hi-h-new-1", "hi", "new_search", GROUNDWATER, "बच्चों में कुपोषण कम करने के उपाय", { intent: N, mustContain: [["malnutrition", "कुपोषण", "nutrition"]] }),
  e("hi-h-earlier-1", "hi", "इसके दुष्प्रभाव क्या हैं", [{ question: "तुलसी का रोग प्रतिरोधक क्षमता पर असर", searchQuery: "tulsi immunity" }], { intent: R, mustContain: [["tulsi", "तुलसी"], ["side effect", "adverse", "दुष्प्रभाव"]] }),
];

/* ------------------------------------------------------------ the second hold-out, written again: five cases nobody tuned on */

// Written on 3 Nov 2026 AFTER the rule of `needsContext` and the router's prompt had been changed once, on new subjects and in new words, and never put in a test of the rule or shown to the prompt; its result
// is reported once, and a miss is reported as a miss and not repaired by adding its word to a list. It is written by the author of the change, who knew what the lists hold, so it is not a stranger's test;
// and five cases cannot give a rate. It says whether the change learned only what it was shown. One of them (en-h2-new) stands alone: it must NOT be sent to the model for being short.
const STATINS = {
  history: [U("do statins reduce the risk of stroke in older people"), A({ searchQuery: "statins stroke prevention older adults", papers: [{ n: 1, title: "Statin therapy and incident stroke in adults over 65: a cohort study", year: 2018 }, { n: 2, title: "Primary prevention with statins in the elderly: a meta-analysis", year: 2020 }], text: "Statin users over 65 had fewer strokes than non-users [1]. A pooled analysis found a smaller benefit in the very old [2]." })],
  old: ["statin", "stroke", "cohort", "meta-analysis"],
};
const HEAT = {
  history: [U("garmi se mazdooron ki sehat par kya asar padta hai"), A({ searchQuery: "heat stress and workers health India", language: "hinglish", papers: [{ n: 1, title: "Occupational heat stress and kidney disease in agricultural workers", year: 2019 }, { n: 2, title: "Heat exposure and productivity of construction workers in India", year: 2017 }], text: "Zyada garmi mein kaam karne wale mazdooron mein kidney ki bimari zyada dikhi [1]. Productivity bhi ghati [2]." })],
  old: ["heat", "garmi", "workers", "mazdoor", "kidney"],
};
const DENGUE_HI = {
  history: [U("डेंगू के टीके की प्रभावशीलता"), A({ searchQuery: "dengue vaccine efficacy", language: "hi", papers: [{ n: 1, title: "Efficacy of a tetravalent dengue vaccine in children: a phase 3 trial", year: 2019 }, { n: 2, title: "Dengue vaccine safety in seronegative recipients", year: 2022 }], text: "टीके ने डेंगू के मामलों को कम किया [1]। पहले संक्रमण से बचे लोगों में सुरक्षा पर चिंता जताई गई [2]।" })],
  old: ["dengue", "डेंगू", "vaccine", "टीके"],
};

export const HOLDOUT2 = [
  c("en-h2-refine", "en", "refine", STATINS, "does smoking status change the picture", { intent: R, mustContain: [["smok"], ["statin"]] }),
  c("en-h2-trials", "en", "same_papers", STATINS, "which outcome measures did the trials report", { intent: S }),
  c("hg-h2-same", "hinglish", "same_papers", HEAT, "kitne log shamil the study me", { intent: S }),
  c("hi-h2-same", "hi", "same_papers", DENGUE_HI, "कितने मरीज़ शामिल थे इन अध्ययनों में", { intent: S }),
  c("en-h2-new", "en", "new_search", STATINS, "how do wearable sensors detect atrial fibrillation", { intent: N, mustContain: [["wearable"], ["fibrillation"]] }),
];

export const CLASSES = ["refine", "same_papers", "restyle", "year_filter", "new_search", "topic_switch", "earlier_chat"];
export const LANGS = ["en", "hinglish", "hi"];
