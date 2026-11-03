// Scoring of the router's answers to follow-ups against the labelled cases of ../router-followup-cases.mjs (docs/design/chat-actions-context.md, section 9). Pure: it reads a case and the answer
// of the development route (`POST /api/v1/chat/route` with `history`/`earlier`: the route, `followUp` and `usage`) and says what was right. `router-eval.mjs --followup` prints it; the unit test
// of the same name pins it, including that a made-up wrong answer is scored as wrong.
//
// What is measured, on what the SERVER made of the model's reading (restate.ts has already refused a restatement that adds a number, a name or a "not"; the answer is what a person would get):
//   intent            the intent was one of those the case allows. A message that the rules settled, or that stands alone and went the first-turn way (`followUp` null), is "new".
//   falseSamePapers   a message that was NOT about the papers on the screen was taken to be (the costly mistake: the answer would be about the wrong papers); of the cases that do not allow it
//   valid             the standalone question passed the server's checks (it was not thrown away as adding something), of the messages the model was asked about
//   content           what is searched (the question and the search words) has every word the case needs: the earlier topic the message leans on, the new word it adds
//   ask               what the WRITER is asked has every word the case needs (the standalone question, or for a refinement the model left as it was the search words with the message, or the message): `content` joins the
//                     question and the search words, so it could not see a writer asked "and in children?" alone
//   yearWords         of the cases whose year range was applied, the English search words carry no year and no "after", "before", "since" or "until" (the range is in the filter; in the words it dilutes the search)
//   bleed             a topic switch whose search carries a word of the old topic (what a person would get), of the cases that forbid words; `modelBleed` is the model's own, before the server dropped them
//   years             the year range is the one the case wants; `falseYear` a range where the message names none
//   language          the language asked for ("in Hindi") was read
//   translated        for a Hindi or Hinglish message that is searched for (not one that only asks about the papers on the screen), the search words are English (Latin letters), as in the first-turn
//                     eval. `content` cannot see this: the standalone question of a new topic is the message itself, so its raw Devanagari satisfies a case that lists a Devanagari word
//   tokens            what the model calls of a message cost (in plus out), where the route reports it
// Every share is printed with how many messages it is made of and a 95% Wilson interval: 4 cases cannot show a 90% limit, and 12 clean answers cannot show a rate under 5% (the interval then runs to 24%).

const norm = (s) => String(s ?? "").normalize("NFKC").toLowerCase();
const asList = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const has = (text, word) => norm(text).includes(norm(word));
const hasAny = (text, alternatives) => asList(alternatives).some((w) => has(text, w));
/** The share of the letters of `s` that are Latin (the same measure as `latinShare` in router-eval.mjs); a text with no letters is all Latin. */
const latinShare = (s) => {
  const letters = String(s ?? "").match(/\p{L}/gu) ?? [];
  return letters.length === 0 ? 1 : letters.filter((c) => /[A-Za-z]/.test(c)).length / letters.length;
};
/** The 95% Wilson interval of `k` out of `n` (null for no case), as `{ low, high }` between 0 and 1. */
export function wilson(k, n) {
  if (!(n > 0)) return null;
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

/** What is searched and asked for this message: the standalone question and the search words, or the message itself when the model was not asked. */
export function searchedText(r, message) {
  const parts = [r?.followUp?.question, r?.searchQuery, r?.followUp?.searchQuery].filter((x) => typeof x === "string" && x.length > 0);
  return parts.length > 0 ? parts.join(" ") : message;
}

/** One case and the answer of the route (or `{ error }`) as a row of facts. */
export function scoreCase(c, r) {
  if (!r || r.error) return { id: c.id, cls: c.cls, lang: c.lang, error: String(r?.error ?? "no answer") };
  const f = r.followUp ?? null;
  const intent = f ? f.intent : "new";
  const wantIntents = asList(c.want.intent);
  const searched = searchedText(r, c.message);
  const musts = asList(c.want.mustContain);
  const mustNots = asList(c.want.mustNotContain);
  const yearsWanted = c.want.yearFrom !== undefined || c.want.yearTo !== undefined;
  const yearsRight = yearsWanted
    ? (c.want.yearFrom === undefined ? f?.yearFrom === undefined : asList(c.want.yearFrom).includes(f?.yearFrom)) && (c.want.yearTo === undefined ? f?.yearTo === undefined : asList(c.want.yearTo).includes(f?.yearTo))
    : f?.yearFrom === undefined && f?.yearTo === undefined;
  // what the writer is asked (the server's rule: the standalone question when there is one, else the message; a refinement the model left as it was has `ask`: its search words with the message)
  const writerAsked = f ? (f.ask ?? (f.rewrote ? f.question : c.message)) : c.message;
  const yearsApplied = f?.yearFrom !== undefined || f?.yearTo !== undefined;
  const tokens = r.usage && r.usage.calls > 0 ? (r.usage.tokensIn ?? 0) + (r.usage.tokensOut ?? 0) : null;
  // a Hindi or Hinglish message that is searched for: the words that go to the indexes (the route's, or the follow-up's) have to be English; none at all means the message is searched as written
  const searchWords = r.searchQuery ?? f?.searchQuery ?? "";
  const searches = c.lang !== "en" && !(wantIntents.length === 1 && wantIntents[0] === "same_papers");
  return {
    id: c.id,
    cls: c.cls,
    lang: c.lang,
    intent,
    intentOk: wantIntents.includes(intent),
    allowsSame: wantIntents.includes("same_papers"),
    asked: f !== null,
    valid: f ? !f.fellBack : null,
    content: musts.length > 0 ? musts.every((alts) => hasAny(searched, alts)) : null,
    ask: musts.length > 0 && f !== null ? musts.every((alts) => hasAny(writerAsked, alts)) : null,
    yearWords: yearsWanted && yearsApplied ? !/\b(?:19|20)\d{2}\b|\b(?:after|before|since|until)\b/i.test(searchWords) : null,
    bleed: mustNots.length > 0 ? mustNots.some((w) => has(searched, w)) : null,
    modelBleed: mustNots.length > 0 ? f?.check === "bleed" || mustNots.some((w) => has(searched, w)) : null,
    years: yearsWanted ? yearsRight : null,
    falseYear: yearsWanted ? null : !yearsRight,
    language: c.want.answerLanguage ? f?.answerLanguage === c.want.answerLanguage : null,
    translated: searches ? searchWords.length > 0 && latinShare(searchWords) >= 0.9 : null,
    tokens,
    check: f?.check ?? null,
    how: r.how,
    got: { intent, yearFrom: f?.yearFrom, yearTo: f?.yearTo, answerLanguage: f?.answerLanguage, question: f?.question, searchQuery: r.searchQuery, check: f?.check },
    searched,
  };
}

const share = (xs, pick) => {
  const known = xs.map(pick).filter((v) => v !== null && v !== undefined);
  return known.length === 0 ? null : { value: known.filter(Boolean).length / known.length, n: known.length };
};
const p95 = (xs) => (xs.length === 0 ? null : [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)]);

/** The numbers of a set of rows: each a `{ value, n }` (or null when no case is about it). */
export function summarize(rows) {
  const ok = rows.filter((r) => !r.error);
  const tokens = ok.map((r) => r.tokens).filter((t) => typeof t === "number");
  return {
    n: rows.length,
    errors: rows.length - ok.length,
    intent: share(ok, (r) => r.intentOk),
    falseSamePapers: share(ok.filter((r) => !r.allowsSame), (r) => r.intent === "same_papers"),
    valid: share(ok, (r) => r.valid),
    content: share(ok, (r) => r.content),
    ask: share(ok, (r) => r.ask),
    yearWords: share(ok, (r) => r.yearWords),
    bleed: share(ok, (r) => r.bleed),
    modelBleed: share(ok, (r) => r.modelBleed),
    years: share(ok, (r) => r.years),
    falseYear: share(ok, (r) => r.falseYear),
    language: share(ok, (r) => r.language),
    translated: share(ok, (r) => r.translated),
    asked: share(ok, (r) => r.asked),
    tokensMean: tokens.length === 0 ? null : { value: tokens.reduce((a, b) => a + b, 0) / tokens.length, n: tokens.length },
    tokensP95: tokens.length === 0 ? null : { value: p95(tokens), n: tokens.length },
  };
}

/**
 * The gates: each a limit on a number of `summarize` (a share to reach, or a rate that must stay under, or tokens that must stay under). `limits` has: intent, intentHinglish, intentHindi (shares to
 * reach), falseSamePapers, bleed, falseYear (rates to stay at or under), valid, content, ask, yearWords, years, language, translated (shares to reach) and tokens (a mean to stay at or under). A number that no case
 * is about is not a line.
 */
export function evaluate(rows, limits) {
  const all = summarize(rows);
  const byLang = (l) => summarize(rows.filter((r) => r.lang === l));
  const lines = [];
  const reach = (name, v, limit) => v && limit !== undefined && lines.push({ name, value: v.value, limit, n: v.n, pass: v.value >= limit, kind: "reach" });
  const under = (name, v, limit) => v && limit !== undefined && lines.push({ name, value: v.value, limit, n: v.n, pass: v.value <= limit, kind: "under" });
  reach("intent", all.intent, limits.intent);
  reach("intent (Hinglish)", byLang("hinglish").intent, limits.intentHinglish);
  reach("intent (Hindi)", byLang("hi").intent, limits.intentHindi);
  under("false same papers", all.falseSamePapers, limits.falseSamePapers);
  reach("standalone question valid", all.valid, limits.valid);
  reach("what is searched has the words", all.content, limits.content);
  reach("what the writer is asked has the words", all.ask, limits.ask);
  reach("year words kept out of the search words", all.yearWords, limits.yearWords);
  under("topic bleed", all.bleed, limits.bleed);
  reach("year range right", all.years, limits.years);
  under("year range made up", all.falseYear, limits.falseYear);
  reach("language asked for read", all.language, limits.language);
  reach("searched in English (Hindi, Hinglish)", all.translated, limits.translated);
  if (all.tokensMean && limits.tokens !== undefined) lines.push({ name: "tokens per asked message", value: all.tokensMean.value, limit: limits.tokens, n: all.tokensMean.n, pass: all.tokensMean.value <= limits.tokens, kind: "tokens" });
  return { lines, summary: all };
}

const pct = (v) => (v ? `${(v.value * 100).toFixed(0)}%`.padStart(5) : "    -");

/** The per-class (or per-language) table: how many cases, and each number. */
export function table(rows, groups, key) {
  const head = `${key.padEnd(13)} ${"n".padStart(3)} ${"intent".padStart(6)} ${"words".padStart(5)} ${"years".padStart(5)} ${"lang".padStart(5)} ${"bleed".padStart(5)} ${"valid".padStart(5)} ${"tokens".padStart(6)}`;
  const out = [head];
  for (const g of groups) {
    const s = summarize(rows.filter((r) => r[key === "class" ? "cls" : "lang"] === g));
    if (s.n === 0) continue;
    out.push(`${g.padEnd(13)} ${String(s.n).padStart(3)} ${pct(s.intent).padStart(6)} ${pct(s.content)} ${pct(s.years)} ${pct(s.language)} ${pct(s.bleed)} ${pct(s.valid)} ${(s.tokensMean ? Math.round(s.tokensMean.value).toString() : "-").padStart(6)}`);
  }
  return out;
}

/**
 * The whole printout of a follow-up run: the gates, the model's own bleed and the tokens, the table per class and per language, and with `show` every wrong answer. Returns the text and the
 * names of the gates that are past their limit (so that `--gate` can fail). Pure, so that what a run prints is pinned without a model.
 */
export function formatReport({ rows, cases, limits, classes, langs, set, seconds, show }) {
  const { lines, summary } = evaluate(rows, limits);
  // a share says how many messages it is made of and a 95% interval: with a dozen cases one answer moves it by 8 points, and a pass only shows that the rate is probably not far over the limit
  const fmt = (l) => {
    if (l.kind === "tokens") return `${l.value.toFixed(0)} (limit ${l.limit}), ${l.n} messages`;
    const k = Math.round(l.value * l.n);
    const ci = wilson(k, l.n);
    return `${(l.value * 100).toFixed(1)}%  (limit ${l.kind === "under" ? "at most " : ""}${(l.limit * 100).toFixed(1)}%), ${k} of ${l.n} messages, 95% interval ${Math.round(ci.low * 100)}% to ${Math.round(ci.high * 100)}%`;
  };
  const out = [];
  out.push(`\nrouter follow-up eval (${set}): ${rows.length} messages in ${seconds.toFixed(0)} s (the model read the turns for ${rows.filter((r) => r.asked).length}, the rules or the first-turn router settled ${rows.filter((r) => !r.error && !r.asked).length}, errors ${summary.errors})`);
  for (const l of lines) out.push(`  ${l.pass ? "ok  " : "FAIL"} ${l.name.padEnd(38)} ${fmt(l)}`);
  if (summary.modelBleed) out.push(`  (the model's own topic bleed, before the server dropped the words: ${(summary.modelBleed.value * 100).toFixed(1)}% of ${summary.modelBleed.n})`);
  if (summary.tokensP95) out.push(`  (tokens per asked message: mean ${summary.tokensMean.value.toFixed(0)}, 95th percentile ${summary.tokensP95.value}, ${summary.tokensMean.n} messages that reported them)`);
  out.push(`\n${table(rows, classes, "class").join("\n")}`);
  out.push(`\n${table(rows, langs, "language").join("\n")}`);
  out.push("  (words: what is searched has the words the case needs; bleed is a rate that must stay low; the others are shares)");
  if (show) {
    const wrong = rows.filter((r) => r.error || !r.intentOk || r.content === false || r.bleed || r.years === false || r.falseYear || r.language === false || r.valid === false || r.translated === false);
    if (wrong.length > 0) out.push(`\nwrong (${wrong.length}):`);
    for (const r of wrong) {
      const c = cases.find((x) => x.id === r.id);
      const why = r.error ? `ERROR ${r.error}` : [!r.intentOk && `intent ${r.intent}`, r.content === false && "words missing", r.bleed && "old topic carried", r.years === false && "years wrong", r.falseYear && "years made up", r.language === false && "language not read", r.valid === false && `question thrown away (${r.check})`, r.translated === false && "searched without English words"].filter(Boolean).join(", ");
      out.push(`  [${r.lang}/${r.cls}] ${r.id}: ${why}: "${c.message}"${r.error ? "" : ` -> ${JSON.stringify(r.got)}`}`);
    }
  }
  const failed = lines.filter((l) => !l.pass).map((l) => l.name);
  return { text: out.join("\n"), failed };
}
