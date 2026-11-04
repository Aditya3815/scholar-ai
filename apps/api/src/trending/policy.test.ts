import { describe, expect, it } from "vitest";
import { QUERYABLE_SUBFIELDS, SUBFIELDS, parseSubfieldId, policyOf, subfieldInfo, type SubfieldPolicy } from "@scholar/shared/src/subfield-policy";

/**
 * The reviewed table behind the Trending feed (docs/design/chatview-and-trending.md, T6): for each of OpenAlex's 252 subfields, may a phrase found there be shown (allow), only be
 * generated and logged (hold), or not be looked at at all (never). Health Sciences and the clinical subfields are held. A subfield the table does not know is held, never allowed.
 * The table is made by apps/api/scripts/trending-subfields.mjs from the live list (https://api.openalex.org/subfields); `--check` compares it with the live list.
 */

const POLICIES: SubfieldPolicy[] = ["allow", "hold", "never"];
const byName = (name: string) => SUBFIELDS.filter((s) => s.name === name);

describe("the table covers OpenAlex's taxonomy", () => {
  it("has 252 subfields with unique whole-number ids", () => {
    expect(SUBFIELDS).toHaveLength(252);
    expect(new Set(SUBFIELDS.map((s) => s.id)).size).toBe(252);
    for (const s of SUBFIELDS) expect(Number.isInteger(s.id) && s.id > 0).toBe(true);
  });

  it("has 26 fields in 4 domains, each field in one domain, each id with one name", () => {
    const fields = new Map<number, string>();
    const fieldDomain = new Map<number, number>();
    const domains = new Map<number, string>();
    for (const s of SUBFIELDS) {
      expect(fields.get(s.fieldId) ?? s.field).toBe(s.field);
      fields.set(s.fieldId, s.field);
      expect(fieldDomain.get(s.fieldId) ?? s.domainId).toBe(s.domainId);
      fieldDomain.set(s.fieldId, s.domainId);
      expect(domains.get(s.domainId) ?? s.domain).toBe(s.domain);
      domains.set(s.domainId, s.domain);
    }
    expect(fields.size).toBe(26);
    expect([...domains.values()].sort()).toEqual(["Health Sciences", "Life Sciences", "Physical Sciences", "Social Sciences"]);
  });

  it("gives every subfield a name, and one of the three policies", () => {
    for (const s of SUBFIELDS) {
      expect(s.name.trim().length).toBeGreaterThan(0);
      expect(POLICIES).toContain(s.policy);
    }
  });

  it("says why for every subfield that is not allowed", () => {
    for (const s of SUBFIELDS) if (s.policy !== "allow") expect(s.why.length).toBeGreaterThan(2);
  });
});

describe("health is out at launch", () => {
  it("holds the whole Health Sciences domain: all 63 subfields, none allowed, none skipped", () => {
    const health = SUBFIELDS.filter((s) => s.domain === "Health Sciences");
    expect(health).toHaveLength(63);
    for (const s of health) expect(s.policy, `${s.id} ${s.name}`).toBe("hold");
  });

  it("holds the clinical subfields that OpenAlex files under other domains", () => {
    for (const name of ["Cancer Research", "Neurology", "Endocrinology", "Clinical Biochemistry", "Molecular Medicine", "Biological Psychiatry", "Immunology", "Virology", "Parasitology", "Microbiology", "Pharmacology", "Toxicology", "Pharmaceutical Science", "Drug Discovery", "Clinical Psychology", "Health", "Health, Toxicology and Mutagenesis", "Biomedical Engineering"]) {
      const rows = byName(name).filter((s) => s.domain !== "Health Sciences");
      expect(rows.length, name).toBeGreaterThan(0);
      for (const s of rows) expect(s.policy, `${s.id} ${s.name}`).toBe("hold");
    }
  });

  it("holds subfields that are about elections, religion and other contested ground", () => {
    for (const name of ["Political Science and International Relations", "Sociology and Political Science", "Religious studies", "Gender Studies"]) for (const s of byName(name)) expect(s.policy, name).toBe("hold");
  });

  it("does not skip any health subfield: a held phrase is still generated and logged for the owner to read", () => {
    expect(SUBFIELDS.filter((s) => s.domain === "Health Sciences" && s.policy === "never")).toEqual([]);
  });
});

describe("what is allowed", () => {
  it("allows the subfields the first test run lives on", () => {
    for (const [id, name] of [[1702, "Artificial Intelligence"], [1707, "Computer Vision and Pattern Recognition"], [1712, "Software"], [3304, "Education"], [1110, "Plant Science"], [2002, "Economics and Econometrics"], [2105, "Renewable Energy, Sustainability and the Environment"], [3104, "Condensed Matter Physics"]] as const) {
      expect(subfieldInfo(id)?.name).toBe(name);
      expect(policyOf(id)).toBe("allow");
    }
  });

  it("has allowed subfields in every domain but Health, so the feed can be filled without it", () => {
    for (const domain of ["Physical Sciences", "Life Sciences", "Social Sciences"]) expect(SUBFIELDS.filter((s) => s.domain === domain && s.policy === "allow").length, domain).toBeGreaterThan(0);
  });

  it("never looks at the catch-all 'General ...' subfields outside health, and holds the health one", () => {
    const general = SUBFIELDS.filter((s) => s.name.startsWith("General "));
    expect(general.length).toBeGreaterThan(0);
    for (const s of general) expect(s.policy, `${s.id} ${s.name}`).toBe(s.domain === "Health Sciences" ? "hold" : "never");
  });
});

describe("QUERYABLE_SUBFIELDS: what the job asks OpenAlex about", () => {
  it("is every subfield that is not 'never': allowed and held ones, in the table's order", () => {
    expect(QUERYABLE_SUBFIELDS).toEqual(SUBFIELDS.filter((s) => s.policy !== "never").map((s) => s.id));
    expect(QUERYABLE_SUBFIELDS).toContain(1702);
    expect(QUERYABLE_SUBFIELDS).toContain(2746); // held: looked at, never shown
    expect(QUERYABLE_SUBFIELDS).not.toContain(2200); // a catch-all: not looked at
    expect(QUERYABLE_SUBFIELDS.length).toBe(SUBFIELDS.length - SUBFIELDS.filter((s) => s.policy === "never").length);
  });
});

describe("a subfield the table does not know is held, never allowed", () => {
  it("answers hold for an unknown id, whatever it looks like", () => {
    for (const unknown of [0, -1, 1, 9999, 1702.5, 2 ** 31, NaN, Infinity, "9999", "abc", "", null, undefined, {}, [], [1702], true, "https://openalex.org/subfields/9999", "1702; DROP TABLE"]) expect(policyOf(unknown)).toBe("hold");
  });

  it("answers allow only for a known id, as a number, a numeric string or an OpenAlex address", () => {
    expect(policyOf(1702)).toBe("allow");
    expect(policyOf("1702")).toBe("allow");
    expect(policyOf("https://openalex.org/subfields/1702")).toBe("allow");
    expect(policyOf("openalex.org/subfields/1702")).toBe("allow");
    expect(policyOf(2746)).toBe("hold");
  });

  it("has no info for an unknown id", () => {
    expect(subfieldInfo(9999)).toBeUndefined();
    expect(subfieldInfo("nope")).toBeUndefined();
    expect(subfieldInfo(null)).toBeUndefined();
  });
});

describe("parseSubfieldId", () => {
  it("reads a number, a numeric string and an OpenAlex address, and nothing else", () => {
    expect(parseSubfieldId(1702)).toBe(1702);
    expect(parseSubfieldId("1702")).toBe(1702);
    expect(parseSubfieldId(" 1702 ")).toBe(1702);
    expect(parseSubfieldId("https://openalex.org/subfields/1702")).toBe(1702);
    expect(parseSubfieldId("https://openalex.org/subfields/1702/")).toBeNull();
    for (const bad of [0, -5, 1.5, NaN, "0", "-5", "1e3", "17 02", "subfields/abc", {}, null, undefined, 10 ** 12, "https://example.com/1702"]) expect(parseSubfieldId(bad)).toBeNull();
  });
});
