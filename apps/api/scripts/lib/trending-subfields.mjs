// The pure half of scripts/trending-subfields.mjs: turn OpenAlex's list of subfields into the rows of packages/shared/src/subfield-policy.ts, keeping the owner's decisions.
// Nothing here reads the network or a file.

export const HEALTH_DOMAIN = "Health Sciences";
export const BEGIN = "// BEGIN ROWS";
export const END = "// END ROWS";

/**
 * The first reading of the 252 subfields (docs/design/chatview-and-trending.md, T6): the owner reads the table once and changes what they disagree with, and from then on the file is
 * the record: `mergeRows` keeps what is in the file and holds what is new. The name is checked against the live list, so a decision never moves to another subfield when OpenAlex
 * renumbers; a subfield whose name changed is held again with a note.
 *
 *   hold: every subfield of the Health Sciences domain (rule, not a list), these clinical or health-claim subfields that OpenAlex files under other domains, and elections, religion
 *   and other contested ground.
 *   never: the catch-all "General ..." subfields outside health: they hold what the labeller could not place, so "would a researcher in this subfield call this current?" has no answer.
 *   allow: everything else.
 */
export const HOLD = [
  [1306, "Cancer Research", "clinical"],
  [1310, "Endocrinology", "clinical"],
  [1313, "Molecular Medicine", "clinical"],
  [1308, "Clinical Biochemistry", "clinical"],
  [1302, "Aging", "health claims"],
  [2808, "Neurology", "clinical"],
  [2803, "Biological Psychiatry", "clinical"],
  [2807, "Endocrine and Autonomic Systems", "clinical"],
  [2403, "Immunology", "clinical"],
  [2405, "Parasitology", "infectious disease"],
  [2406, "Virology", "infectious disease"],
  [2404, "Microbiology", "infectious disease"],
  [3004, "Pharmacology", "drugs"],
  [3005, "Toxicology", "drugs"],
  [3003, "Pharmaceutical Science", "drugs"],
  [3002, "Drug Discovery", "drugs"],
  [3306, "Health", "health"],
  [3203, "Clinical Psychology", "clinical"],
  [3206, "Neuropsychology and Physiological Psychology", "clinical"],
  [2307, "Health, Toxicology and Mutagenesis", "health"],
  [2204, "Biomedical Engineering", "clinical"],
  [1504, "Chemical Health and Safety", "health"],
  [3320, "Political Science and International Relations", "elections and politics"],
  [3312, "Sociology and Political Science", "elections and politics"],
  [1212, "Religious studies", "contested ground"],
  [3318, "Gender Studies", "contested ground"],
  [1202, "History", "named people and events"],
];
export const NEVER = [
  [2200, "General Engineering", "catch-all"],
  [2500, "General Materials Science", "catch-all"],
  [2100, "General Energy", "catch-all"],
  [1100, "General Agricultural and Biological Sciences", "catch-all"],
  [2000, "General Economics, Econometrics and Finance", "catch-all"],
  [3200, "General Psychology", "catch-all"],
  [1800, "General Decision Sciences", "catch-all"],
  [3300, "General Social Sciences", "catch-all"],
  [1200, "General Arts and Humanities", "catch-all"],
];
const HOLD_BY_ID = new Map(HOLD.map(([id, name, why]) => [id, { name, why }]));
const NEVER_BY_ID = new Map(NEVER.map(([id, name, why]) => [id, { name, why }]));

/** The first reading of one live subfield: [policy, why]. A new subfield that no rule knows is held. */
export function classify(sub) {
  if (sub.domain === HEALTH_DOMAIN) return ["hold", "health domain"];
  for (const [table, policy] of [[HOLD_BY_ID, "hold"], [NEVER_BY_ID, "never"]]) {
    const known = table.get(sub.id);
    if (known) return known.name === sub.name ? [policy, known.why] : ["hold", `review: was ${known.name}`];
  }
  return ["allow", ""];
}

const lastNumber = (url) => Number(String(url).split("/").pop());

/** The live answer of /subfields (any number of pages) as rows, sorted by domain, field, id. Throws on anything that is not a subfield. */
export function parseLive(pages) {
  const seen = new Set();
  const rows = [];
  for (const page of pages) {
    for (const r of page.results ?? []) {
      const id = lastNumber(r.id);
      const fieldId = lastNumber(r.field?.id);
      const domainId = lastNumber(r.domain?.id);
      if (!Number.isInteger(id) || !Number.isInteger(fieldId) || !Number.isInteger(domainId) || typeof r.display_name !== "string" || typeof r.field?.display_name !== "string" || typeof r.domain?.display_name !== "string") {
        throw new Error(`not a subfield: ${JSON.stringify(r).slice(0, 200)}`);
      }
      if (seen.has(id)) throw new Error(`subfield ${id} twice`);
      seen.add(id);
      rows.push({ id, name: r.display_name, fieldId, field: r.field.display_name, domainId, domain: r.domain.display_name });
    }
  }
  const cmp = (p, q) => (p < q ? -1 : p > q ? 1 : 0); // not localeCompare: the order must not depend on the machine
  return rows.sort((x, y) => cmp(x.domain, y.domain) || cmp(x.field, y.field) || x.id - y.id);
}

/** The rows in the file between the two marker lines: id -> {name, policy, why}. Lines that are not rows (comments) are skipped. */
export function readRows(text) {
  const from = text.indexOf(BEGIN);
  const to = text.indexOf(END);
  if (from < 0 || to < from) throw new Error(`the markers ${BEGIN} and ${END} are not in the file`);
  const out = new Map();
  for (const line of text.slice(from + BEGIN.length, to).split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("[")) continue;
    const row = JSON.parse(t.replace(/,$/, ""));
    if (!Array.isArray(row) || row.length !== 8) throw new Error(`not a row: ${t}`);
    out.set(row[0], { name: row[1], fieldId: row[2], field: row[3], domainId: row[4], domain: row[5], policy: row[6], why: row[7] });
  }
  return out;
}

/**
 * The live list with a policy for every subfield: what the file already says (when the subfield is still there under the same name), otherwise the first reading, and a subfield that is
 * new to the file is held unless a rule says otherwise. `existing` is null for a first run.
 */
export function mergeRows(live, existing) {
  const added = [];
  const renamed = [];
  const rows = live.map((s) => {
    const old = existing?.get(s.id);
    if (old && old.name === s.name) return { ...s, policy: old.policy, why: old.why };
    if (old) {
      renamed.push(`${s.id}: ${old.name} -> ${s.name}`);
      return { ...s, policy: "hold", why: `review: was ${old.name}` };
    }
    if (existing) added.push(`${s.id} ${s.name}`);
    const [policy, why] = classify(s);
    return { ...s, policy: existing && policy === "allow" ? "hold" : policy, why: existing && policy === "allow" ? "new in OpenAlex: review" : why };
  });
  const liveIds = new Set(live.map((s) => s.id));
  const removed = existing ? [...existing].filter(([id]) => !liveIds.has(id)).map(([id, r]) => `${id} ${r.name}`) : [];
  return { rows, added, removed, renamed };
}

/** The lines between the markers: a comment per field, then one row per line (valid JSON, so `readRows` can read it back). */
export function renderRows(rows) {
  const lines = [];
  let last = "";
  for (const r of rows) {
    const heading = `${r.domain} / ${r.field}`;
    if (heading !== last) lines.push(`  // ${heading}`);
    last = heading;
    lines.push(`  [${[r.id, r.name, r.fieldId, r.field, r.domainId, r.domain, r.policy, r.why].map((v) => JSON.stringify(v)).join(", ")}],`);
  }
  return lines.join("\n");
}

/** The file with its rows replaced. Keeps the file's own line endings. */
export function replaceBlock(text, block) {
  const from = text.indexOf(BEGIN);
  const to = text.indexOf(END);
  if (from < 0 || to < from) throw new Error(`the markers ${BEGIN} and ${END} are not in the file`);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const head = text.slice(0, from + BEGIN.length);
  const tail = text.slice(to);
  return `${head}${eol}const ROWS: readonly Row[] = [${eol}${block.split("\n").join(eol)}${eol}];${eol}${tail}`;
}

export const countBy = (rows, key) => rows.reduce((m, r) => ((m[r[key]] = (m[r[key]] ?? 0) + 1), m), {});
