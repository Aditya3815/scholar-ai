import type { Lang, SafetyNoticeKind } from "@scholar/shared";

/**
 * The fixed sentences of the safety lane (docs/design/intent-and-state.md, 5.1) and the one constant that guards the numbers in them. No model writes any of them: the page speaks these, and code fills only
 * the {braces}. The language is the language of the message as the rules find it (`detectLanguage`); the page around them stays English. Every one of the Hinglish and Hindi sentences is the plan's text and has
 * NOT been read by a native speaker (O-3); a sentence the plan marks "to be written" falls back to the Hinglish one, never to the English one. The Hinglish has neutral verbs (no raha, rahi, rahe): the page
 * speaks about this box.
 *
 * THE NUMBERS ARE A PRECONDITION, NOT A TODO (4.5). 112 (the national emergency number) and Tele-MANAS 14416 are from memory and have not been read off an official page; a wrong number in a safety sentence is
 * itself a harm. `HELPLINE_CHECKED` is null until a person has read both on the official pages and written down the date and the page for each. While it is null: no sentence below holds a digit (every one has a
 * variant without a number, and that variant is what is given), a test fails if one does, and a second test fails if CHAT_SAFETY stands above `shadow` in the committed wrangler.jsonc. The variant with the
 * numbers is the plan's own text, pinned to the plan by a test, and is given only when this constant is set.
 */
export type LaneLang = "en" | "hinglish" | "hi";

/** Null: nothing has been checked. When set: the date, and the official page each number was read from. */
export const HELPLINE_CHECKED = null as null | { date: string; emergency: string; teleManas: string };
/** The two numbers, in one place. Given out only when HELPLINE_CHECKED is set. */
export const HELPLINES = { emergency: "112", teleManas: "14416" } as const;

/** The fragments that hold a number: [with the numbers, without them]. */
const FILL: Record<LaneLang, Record<string, readonly [string, string]>> = {
  en: {
    EMG: ["112 (India) or your local emergency number", "your local emergency number"],
    TM_ON: [" on 14416", ""],
    TM_IN: ["14416 in India", "in India"],
    EMG_SHORT: ["call 112.", "call your local emergency number."],
  },
  hinglish: {
    EMG: ["112 (India mein) ya apne local emergency number", "apne local emergency number"],
    TM_P: [" (14416)", ""],
    TM_IN: [" 14416)", ")"],
    EMG_SHORT: ["abhi 112 par call kijiye.", "abhi apne local emergency number par call kijiye."],
  },
  hi: {
    EMG: ["112 (भारत में) या अपने स्थानीय आपातकालीन नंबर", "अपने स्थानीय आपातकालीन नंबर"],
    TM_P: [" (14416)", ""],
  },
};

type Sentence = Partial<Record<LaneLang, string>>;
const TEXT = {
  acute: {
    en: "If you or someone with you is in danger now, call {EMG}, or go to the nearest hospital. This box finds research papers and cannot help in a medical emergency.",
    hinglish: "Agar aap ya aapke saath koi abhi khatre mein hai, turant {EMG} par call kijiye, ya sabse paas ke hospital jaiye. Ye box research papers dhundta hai aur medical emergency mein madad nahi kar sakta.",
    hi: "अगर आप या आपके साथ कोई अभी ख़तरे में है, तो तुरंत {EMG} पर कॉल कीजिए, या नज़दीकी अस्पताल जाइए। यह बॉक्स शोध पत्र खोजता है और मेडिकल इमरजेंसी में मदद नहीं कर सकता।",
  },
  crisis: {
    en: "If you might hurt yourself, or you are in danger now, please call {EMG}. In India you can also call Tele-MANAS{TM_ON}, free and open at all hours, to talk with a trained counsellor. You do not have to face this alone. This box cannot give you the support a person can.\n\nTo look up research on this topic, choose Search papers and write the topic.",
    hinglish: "Agar aapko khud ko nuksan pahunchane ka khayal aata hai ya aap abhi khatre mein hain, to {EMG} par call kijiye. India mein Tele-MANAS{TM_P} par bhi call kar sakte hain: ye muft hai, har waqt khula hai, aur wahan trained counsellor se baat ho sakti hai. Aap akele nahi hain. Ye box kisi insaan jaisa saath nahi de sakta.\n\nIs topic par research dekhni ho to Search papers chuniye aur topic likhiye.",
    hi: "अगर आपको खुद को नुकसान पहुँचाने का ख़याल आता है या आप अभी ख़तरे में हैं, तो {EMG} पर कॉल कीजिए। भारत में आप टेली-मानस{TM_P} पर भी कॉल कर सकते हैं: यह मुफ़्त है, हर समय खुला है, और वहाँ प्रशिक्षित काउंसलर से बात हो सकती है। आप अकेले नहीं हैं। यह बॉक्स किसी इंसान की तरह साथ नहीं दे सकता।\n\nइस विषय पर शोध देखना हो तो Search papers चुनिए और विषय लिखिए।",
  },
  help: {
    en: "If you or someone with you is in danger now, call {EMG}, or go to the nearest hospital. If you are struggling, Tele-MANAS ({TM_IN}) is free, open at all hours, and a trained counsellor answers. This box finds research papers and cannot give you the support a person can.\n\nTo look something up, write the topic.",
    hinglish: "Agar aap ya aapke saath koi abhi khatre mein hai, to {EMG} par call kijiye, ya sabse paas ke hospital jaiye. Agar aap mushkil mein hain, to Tele-MANAS (India mein{TM_IN} muft hai, har waqt khula hai, aur wahan trained counsellor baat karte hain. Ye box research papers dhundta hai aur kisi insaan jaisa saath nahi de sakta.\n\nKuch dhundhna ho to topic likhiye.",
  },
  decision: {
    en: "I cannot say what is right for you to take. A doctor or pharmacist can. These papers are about the topic, not about your case, and no answer was written.",
    hinglish: "Ye box nahi bata sakta ki aapke liye kya lena sahi hai. Doctor ya pharmacist bata sakte hain. Ye papers is vishay par hain, aapke case par nahi, aur koi jawab nahi likha gaya.",
  },
  care: {
    en: "This list is research, mostly on groups of people or in the lab. It cannot tell what is right for you or your family. For your own health, ask your doctor or pharmacist.",
    hinglish: "Ye list research ki hai, zyadatar logon ke samoohon par ya lab mein hui. Isse ye nahi pata chal sakta ki aapke ya aapke parivaar ke liye kya sahi hai. Apni sehat ke liye apne doctor ya pharmacist se poochiye.",
  },
  distress: {
    en: "If you have been feeling low for a long time, it can help to talk to someone. Tele-MANAS ({TM_IN}) is free and open at all hours. If you are in danger now, {EMG_SHORT} This box lists research and cannot advise you.",
    hinglish: "Agar aap bahut din se udaas hain, to kisi se baat karna madad kar sakta hai. Tele-MANAS (India mein{TM_IN} muft hai aur har waqt khula hai. Khatre mein hon to {EMG_SHORT} Ye box research dikhata hai aur aapko salah nahi de sakta.",
  },
  urgentNote: {
    en: "If someone is in pain or in danger right now, call {EMG}, or go to the nearest hospital. These papers are research, not medical advice.",
    hinglish: "Agar abhi kisi ko dard ya khatra hai, {EMG} par call kijiye, ya sabse paas ke hospital jaiye. Ye papers research hain, medical salah nahi.",
  },
  crisisNote: {
    en: "If you might hurt yourself, please call {EMG} now. In India you can also call Tele-MANAS{TM_ON}, free and open at all hours. These papers are research and cannot give you support.",
    hinglish: "Agar aapko khud ko nuksan pahunchane ka khayal aata hai, abhi {EMG} par call kijiye. India mein Tele-MANAS{TM_P} par bhi call kar sakte hain: muft aur har waqt khula. Ye papers research hain aur saath nahi de sakte.",
  },
} satisfies Record<string, Sentence>;
type TextName = keyof typeof TEXT;

const laneOf = (language: Lang | LaneLang): LaneLang => (language === "hinglish" || language === "hi" ? language : "en");

/** Whether the numbers may be given: a person has checked them. */
export const helplinesChecked = (): boolean => HELPLINE_CHECKED !== null;

/** A sentence in a language (Hindi falls back to Hinglish where none was written, never to English), with its numbers or without them. */
function say(name: TextName, language: Lang | LaneLang, checked: boolean): string {
  const lang = laneOf(language);
  const sentence: Sentence = TEXT[name];
  const template = sentence[lang] ?? (lang === "hi" ? sentence.hinglish : undefined) ?? sentence.en!;
  const from = sentence[lang] !== undefined ? lang : lang === "hi" && sentence.hinglish !== undefined ? "hinglish" : "en";
  return template.replace(/\{([A-Z_]+)\}/g, (whole, key: string) => FILL[from][key]?.[checked ? 0 : 1] ?? whole);
}

/** The reply that takes the place of the papers: an emergency (a button comes with it), self-harm, or a plain call for help. */
export function replyText(reply: "crisis" | "urgent" | "help", language: Lang | LaneLang, checked: boolean = helplinesChecked()): string {
  return say(reply === "urgent" ? "acute" : reply, language, checked);
}

/**
 * The line above the papers. `auto`: the message came through Auto, so a decision withheld its written answer; for a search chosen by hand the answer is written and the line does not say it was not (the one
 * change to the plan's sentence: "and no answer was written" is left off). `careKind`: which of the two sentences of the care line.
 */
export function noticeText(kind: SafetyNoticeKind, language: Lang | LaneLang, o: { auto: boolean; careKind: "health" | "distress" | null; checked?: boolean }): string {
  const checked = o.checked ?? helplinesChecked();
  switch (kind) {
    case "safety_crisis":
      return say("crisisNote", language, checked);
    case "safety_urgent":
      return say("urgentNote", language, checked);
    case "safety_care":
      return say(o.careKind === "distress" ? "distress" : "care", language, checked);
    case "safety_decision": {
      const full = say("decision", language, checked);
      return o.auto ? full : full.replace(/, and no answer was written\.$/, ".").replace(/, aur koi jawab nahi likha gaya\.$/, ".");
    }
  }
}

/** Every sentence there is, in every language, with its numbers or without them: what the tests read. */
export function allLaneSentences(checked: boolean): string[] {
  const out: string[] = [];
  for (const name of Object.keys(TEXT) as TextName[]) for (const lang of ["en", "hinglish", "hi"] as const) out.push(say(name, lang, checked));
  for (const lang of ["en", "hinglish", "hi"] as const) out.push(noticeText("safety_decision", lang, { auto: false, careKind: null, checked }));
  return [...new Set(out)];
}

/** The sentences (of those given) that hold a digit, a "112" or a "14416" while nothing has been checked: empty when all is well. */
export function helplineProblems(sentences: readonly string[], checked: unknown): string[] {
  if (checked !== null) return [];
  return sentences.filter((s) => /\p{N}/u.test(s) || s.includes(HELPLINES.emergency) || s.includes(HELPLINES.teleManas));
}
