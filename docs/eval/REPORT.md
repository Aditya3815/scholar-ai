# Eval report (record, 2026-10-18)

| Metric | Result |
| --- | --- |
| mode | record (9499 HTTP calls, 9314 fixtures saved) |
| known-item search recall@10 / @20 / MRR | 99/100 (99%) / 99/100 (99%) / 0.89 |
| topical landmarks in top 10 | 20/20 (100%) |
| retracted papers returned by search (own DOI) / flagged | 20/20 (100%) / 20/20 (100%) (+0 only as another record) |
| retraction detection (Retraction Watch via Crossref) | 20/20 (100%) |
| retraction false positives on ordinary papers | 0 |
| DOIs removed by the pipeline (nonexistent or wrong record) | 12 across 200 searches (DOI-check failures: 0) |
| DOIs RETURNED to the user, independently re-checked | 3759 (unresolvable 0, title mismatch 0, no Crossref record 50, unknown 0) |
| genuine references verified | 100/100 (100%) |
| genuine references by status | {"verified":100} |
| fabricated references VERIFIED (must be 0) | 0/30 (0%) |
| fabricated references in an expected non-verified status | 29/30 (97%) |
| HELD-OUT known-item recall@10 / @20 | 58/60 (97%) / 59/60 (98%)  india 29/30, global 29/30 |
| HELD-OUT genuine references verified | 56/60 (93%)  india 28/30, global 28/30 |
| HELD-OUT genuine references by status | {"verified":56,"not_found":3,"mismatch":1} |
| HELD-OUT fabricated references VERIFIED (must be 0) | 0/40 (0%) |
| provider failures | 5/800 (1%) |

## Held-out fabricated references by kind and resulting status

```json
{
 "chimera_title": {
  "mismatch": 19,
  "not_found": 1
 },
 "altered_year": {
  "mismatch": 18,
  "not_found": 2
 }
}
```

## Fabricated references by kind and resulting status

```json
{
 "invented": {
  "not_found": 10
 },
 "chimera_title": {
  "mismatch": 6,
  "unverifiable": 1,
  "not_found": 1
 },
 "real_author_invented_title": {
  "not_found": 3,
  "mismatch": 1
 },
 "invented_doi": {
  "not_found": 4
 },
 "wrong_doi": {
  "mismatch": 4
 }
}
```

## knownItemMiss (1)

- not in top 20: A Survey on Internet of Things: Architecture, Enabling Technologies, Security and Privacy, and Appli

## heldKnownMiss (2)

- [india] rank 11: Quantum gravitational collapse and Hawking radiation in2+1dimensions
- [global] not in top 20: Sleep disturbances in multiple sclerosis: Clinical and neuroradiologic correlations related to disea

## heldGenuineMiss (4)

- [india not_found] Jain, A., Rao, K. V., Mogera, U., Sagade, A. A., & George, S. J. (2011). Dynamic Self-Assembly of Charge-Transfer Nanofi => No paper matching this title, authors and year was found in Crossref. checks={"title":0.4,"author":true,"year":true}
- [india mismatch] Vaz, C., Gutti, S., Kiefer, C., & Singh, T. P. (2007). Quantum gravitational collapse and Hawking radiation in2+1dimensi => This DOI belongs to a different paper: “Quantum gravitational collapse and Hawking radiation in<mml:math xmlns:mml="http://www.w3.org/1998/M checks={"title":0.1891891891891892,"author":true,"year":true}
- [global not_found] Tang, D., Xiao, W., Yin, H., Tian, L., & Wang, D. (2012). Production of Fine Tungsten Powder by Electrolytic Reduction o => No paper matching this title, authors and year was found in Crossref. checks={"title":0.4,"author":true,"year":true}
- [global not_found] Khan, P., Waheed, A., Azeem, M., Parveen, A., Yameen, M. A., & Iqbal, J. (2023). Essential Oil from Tagetes minuta Has A => No paper matching this title, authors and year was found in Crossref. checks={"title":0.4,"author":true,"year":true}
