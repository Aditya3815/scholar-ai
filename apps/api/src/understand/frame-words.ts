/**
 * The words of the request-frame cleaner (R8, docs/design/intent-and-state.md, 4.8), as closed lists. DATA ONLY: no function, nothing is read from a message here; frame.ts builds its patterns from
 * these lists and nothing else, and the lists are on the server only (they are in no file of the web build: a test and the build report prove that).
 *
 * Every list is written from the plan's own lists (4.8: "Edges only, closed lists") and from the plan's sentences about what a note says; none was made by reading the messages of the eval (E0).
 * A phrase is lower case and its words are separated by one space; frame.ts matches any white space between them, ignores case, and never matches a word that is written in capitals ("ALL papers"),
 * that has a hyphen or a digit in it ("new-onset", "5G"), or that is inside quotes. A word added here is a word the product stops searching for: add one only with a test that says why, and measure it
 * on the controls that must not change (eval/frame.eval.ts).
 */

/** A greeting at the start. (Hindi greetings are for Hindi messages, which the cleaner never touches; "namaste" is typed in English sentences too.) */
export const GREETINGS: readonly string[] = ["hi", "hello", "hey", "hiya", "namaste", "good morning", "good afternoon", "good evening"];

/** Politeness at the start: the words alone, and the modal that begins a polite request ("can you", "could you"). */
export const POLITE_LEAD: readonly string[] = ["please", "pls", "plz", "kindly"];
export const REQUEST_MODALS: readonly string[] = ["can", "could", "would", "will"];
export const YOU_WORDS: readonly string[] = ["you", "u"];

/** Politeness at the end. */
export const POLITE_TRAIL: readonly string[] = ["please", "pls", "plz", "thanks", "thank you", "thx", "thanks a lot", "thanks in advance", "thank you so much"];

/**
 * The verbs of a request, at the start. `needsObject`: the verb is a frame only when what follows asks for papers (me, a determiner, a number, a kind word): "list price of insulin" and "show trials" are
 * topics. `against`: words that make the verb part of a topic ("list experiment", "show trial").
 */
export const REQUEST_VERBS: readonly { verb: string; needsObject?: boolean; needsKind?: boolean; against?: readonly string[] }[] = [
  { verb: "search for" },
  { verb: "search about" },
  { verb: "search on" },
  { verb: "find me" },
  { verb: "find" },
  { verb: "show me" },
  { verb: "show", against: ["trial", "trials", "business", "jumping", "cause"] },
  { verb: "give me" },
  { verb: "tell me about" },
  { verb: "tell me" },
  { verb: "list me" },
  { verb: "list", needsObject: true, against: ["price", "prices", "experiment", "experiments"] },
  { verb: "look up" },
  { verb: "i want to know about" },
  { verb: "i am looking for" },
  { verb: "i'm looking for" },
  // a request only before a kind of paper ("give all articles on", "i want the studies on", "get papers on"); anywhere else these are ordinary words
  { verb: "get", needsKind: true },
  { verb: "give", needsKind: true },
  { verb: "i want", needsKind: true },
  { verb: "i need", needsKind: true },
  { verb: "i would like", needsKind: true },
  { verb: "i'd like", needsKind: true },
];
/** "search" alone is a frame only before one of these ("search engine optimisation" is a topic). */
export const SEARCH_BEFORE: readonly string[] = ["the papers", "the articles", "the studies", "the research", "the literature", "the publications", "papers", "articles", "studies", "research", "literature", "publications"];

/** The determiners that go with a kind word, and the generic kind words themselves (followed by one of the prepositions: a kind word with no preposition is a topic: "research methods", "Papers with Code"). */
export const DETERMINERS: readonly string[] = ["some", "any", "all", "the", "a few", "all the", "a", "an", "every"];
/** The determiners that say "all of them": the note that the box shows 20, not every paper. */
export const ALL_DETERMINERS: readonly string[] = ["all", "all the", "any", "every"];
export const KIND_WORDS: readonly string[] = ["papers", "paper", "articles", "article", "studies", "study", "research", "literature", "publications", "publication"];
/** A word before a kind word that is part of the frame ("research papers on", "journal articles about"): never a type word (review, survey, trial, meta-analysis, systematic stay in the topic). */
export const KIND_MODIFIERS: readonly string[] = ["research", "scientific", "academic", "journal", "published"];
export const KIND_PREPOSITIONS: readonly string[] = ["on", "about", "regarding", "related to", "for", "in", "of", "concerning"];
/** "a list of", "the list of": the box lists papers anyway. */
export const LIST_OF: readonly string[] = ["a list of", "the list of", "a short list of", "a long list of"];

/** A trailing frame (4.8): what a person adds after the topic. `all` ones are the note that the box shows 20; the others are named by nothing. */
export const TRAIL_FRAME: readonly string[] = ["for me", "exactly", "really", "in simple terms", "in detail", "if possible", "research papers", "papers please"];
export const TRAIL_ALL: readonly string[] = ["all papers", "all the papers", "all articles", "all the articles", "all studies", "all the studies", "all research", "all the research", "all literature", "all publications", "all of them", "any papers", "every paper", "every article", "every study", "every publication"];

/** The question stems at the start (4.8). Each is a whole phrase; "does X really cause" is handled in frame.ts (the question word and "really" go and "cause" stays). */
export const QUESTION_STEMS: readonly string[] = [
  "what is", "what are", "whats", "what's", "how do you", "how to", "how does", "is it true that", "where does research stand on", "what has been written about",
  "best way to", "most effective way to", "how common is", "what percentage of",
];

/** A recency word at the start (4.8); a note says the box cannot sort by date. */
export const RECENCY: readonly string[] = ["latest", "recent", "newest", "new", "current"];
/** A word that makes "new" a name: "New York", "New Delhi", "New Zealand". (A capital after "New" is enough: this list is for a small letter, "new york".) */
export const NEW_NAMES: readonly string[] = ["york", "delhi", "zealand", "england", "jersey", "mexico", "orleans", "guinea", "south", "hampshire", "haven", "brunswick", "caledonia", "amsterdam", "age", "deal", "testament", "public", "keynesian", "institutionalism"];

/** The numbers of a quantity ("top 5", "first ten"). */
export const QUANTITY_NUMBER_WORDS: readonly string[] = ["two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "fifteen", "twenty", "fifty"];
/** What after "top N" or "first N" makes the number part of the topic ("top 10 percent", "first 100 days"). */
export const NOT_A_QUANTITY_UNITS: readonly string[] = ["percent", "per cent", "percentile", "accuracy", "error", "rate", "day", "days", "week", "weeks", "month", "months", "year", "years", "hour", "hours", "minute", "minutes"];
/** What number-then-kind is a topic when it follows these ("phase 3 studies", "COVID 19 studies"). */
export const NUMBERS_A_TOPIC: readonly string[] = ["phase", "stage", "type", "grade", "class", "group", "level", "factor", "covid", "sars-cov"];

/** The ways of asking for a form, at the end: "in a table", "as bullet points". */
export const FORM_LEAD: readonly string[] = ["in", "as", "into", "using"];
export const FORM_WORDS: readonly string[] = ["table", "tabular form", "table form", "bullets", "bullet points", "bullet list", "bulleted list", "list", "short summary", "brief summary", "summary", "short", "brief", "short table", "point form"];
/** Leading form words: "a table of studies on ...", "bullet points on ...", "keep it short". */
export const FORM_LEADING: readonly string[] = ["a table of", "a bulleted list of", "a bullet list of", "bullet points on", "bullet points about", "bullet points of", "bullet points for", "keep it short", "short answer"];
/** "short" alone at the end, when it follows a comma, "in", or "keep it". */
export const FORM_SHORT: readonly string[] = ["in short", "in brief", "briefly", "keep it short", "short and sweet"];

/** A trailing order to the box: the closed phrases of an attempt to talk to the model and not to search. Each is read only with the words that make it an order. */
export const ORDER_VERBS: readonly string[] = ["ignore", "disregard", "forget"];
export const ORDER_OBJECTS: readonly string[] = ["instructions", "instruction", "prompts", "prompt", "rules", "rule", "guidelines", "guideline", "directions", "direction"];
export const ORDER_PRINT_VERBS: readonly string[] = ["reveal", "print", "show", "repeat", "output", "display"];
export const ORDER_PRINT_OBJECTS: readonly string[] = ["prompt", "instructions", "instruction", "rules", "rule"];

/** Negation: "but not X", "without X", "excluding X". At most this many words may follow, and no sentence end. */
export const NEGATION_WORDS: readonly string[] = ["but not", "but without", "but excluding", "and not", "without", "excluding", "not including", "except for", "except"];
export const NEGATION_MAX_WORDS = 5;

/** A threshold the box cannot apply: a measure, a comparison, a number. */
export const THRESHOLD_MEASURES: readonly string[] = ["sample size", "sample sizes", "participants", "patients", "subjects", "people", "citations", "impact factor", "follow-up", "follow up", "effect size", "p value", "p-value", "n"];
export const THRESHOLD_COMPARATORS: readonly string[] = ["above", "over", "greater than", "more than", "larger than", "bigger than", "at least", "at most", "no fewer than", "no less than", "under", "below", "less than", "fewer than", "smaller than", "minimum of", "maximum of", "minimum", "maximum", "min", "max", "exceeding", ">=", "<=", ">", "<"];
/** What a number counts when it is a threshold on its own ("over 500 patients"), and the times that are one only as a time of follow-up ("at least 5 years of follow-up": "children under 5 years" is a population). */
export const THRESHOLD_COUNT_UNITS: readonly string[] = ["participants", "patients", "subjects", "people", "citations", "cases", "samples"];
export const THRESHOLD_TIME_UNITS: readonly string[] = ["years", "year", "months", "month", "weeks", "week", "days", "day"];

/** "papers that prove": the box lists papers on a topic and does not look for papers that prove one side. */
export const PROVE_VERBS: readonly string[] = ["prove", "proves", "proved", "proving", "disprove", "disproves", "disproved", "disproving"];
export const PROVE_HEADS: readonly string[] = ["papers", "studies", "articles", "research", "evidence", "publications"];

/** The head words that make "by Name" an author: "papers by", "work by", "written by". */
export const AUTHOR_HEADS: readonly string[] = ["papers", "paper", "articles", "article", "studies", "study", "work", "works", "research", "publications", "publication", "books", "book", "written", "authored", "published", "reviews", "review", "writings", "findings", "contributions", "contribution"];
/** The head words of a journal, a proceedings or a body, as the end of a capitalised name. */
export const VENUE_NOUNS: readonly string[] = ["Journal", "Journals", "Review", "Reviews", "Proceedings", "Transactions", "Letters", "Annals", "Archives", "Bulletin", "Lancet", "Gazette", "Weekly", "Quarterly", "Monthly", "Magazine"];
/** Journals known by one name. */
export const VENUE_NAMES: readonly string[] = ["Nature", "Science", "Cell", "BMJ", "JAMA", "NEJM", "PNAS", "PLOS ONE", "The Lancet", "Lancet"];
/** The bodies an institution's name ends in, and the short names of Indian ones. */
export const INSTITUTION_NOUNS: readonly string[] = ["University", "Institute", "Institutes", "College", "Hospital", "Laboratory", "Laboratories", "Centre", "Center", "Academy", "Foundation", "Council", "Society", "Association", "Ministry", "Department", "Commission", "Agency", "Organization", "Organisation"];
export const INSTITUTION_NAMES: readonly string[] = ["AIIMS", "IIT", "IIM", "IISc", "NIMHANS", "PGIMER", "ICMR", "CSIR", "NIT", "IIIT", "BITS", "JNU", "TIFR", "NCBS", "ICAR", "IARI", "ICRISAT", "ISRO", "DRDO", "IISER", "NCERT", "TERI", "JIPMER", "CCMB", "IGIB"];

/** An answer language asked for in words: the verb and the language. "in Hindi" alone is a topic. */
export const ANSWER_VERBS: readonly string[] = ["answer", "reply", "respond", "explain", "summarize", "summarise", "write"];
export const ANSWER_LANGUAGE_NAMES: Readonly<Record<string, "en" | "hi" | "hinglish">> = { hindi: "hi", hinglish: "hinglish", english: "en" };

/** The personal-details strip (only when R4's lane read a DECISION or CARE): first-person words, ages and the relation after "my". */
export const FIRST_PERSON_WORDS: readonly string[] = ["my", "mine", "myself", "me", "we", "our", "ours", "ourselves"];
export const RELATIONS: readonly string[] = [
  "father", "mother", "mom", "mum", "mommy", "dad", "daddy", "wife", "husband", "partner", "son", "daughter", "brother", "sister", "grandmother", "grandfather", "grandma", "grandpa",
  "uncle", "aunt", "friend", "baby", "child", "kid", "boyfriend", "girlfriend", "fiance", "fiancee",
];

/** Words a topic cannot begin with after a leading phrase is taken out, and cannot end with after a trailing one ("list of lists", "plagiarism in research papers"). */
export const NOT_AT_START: readonly string[] = ["of", "in", "on", "for", "with", "and", "or", "to", "by", "about", "at", "from", "as", "than", "but", "so", "if", "vs", "versus", "into", "onto", "via", "per", "nor"];
export const NOT_AT_END: readonly string[] = [...NOT_AT_START, "the", "a", "an", "that", "is", "are", "was", "were", "this", "these", "those"];

/** The small words a Title Case message may write in lower case. */
export const TITLE_SMALL_WORDS: readonly string[] = ["a", "an", "the", "of", "in", "on", "for", "to", "and", "or", "with", "by", "at", "from", "as", "is", "vs", "versus", "de", "la", "le", "von", "van", "into", "via", "per", "nor", "but"];
