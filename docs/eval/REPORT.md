# Eval report (record, 2026-10-18)

| Metric | Result |
| --- | --- |
| mode | record (9562 HTTP calls, 9378 fixtures saved) |
| known-item search recall@10 / @20 / MRR | 99/100 (99%) / 99/100 (99%) / 0.89 |
| topical landmarks in top 10 | 20/20 (100%) |
| retracted papers returned by search (own DOI) / flagged | 20/20 (100%) / 20/20 (100%) (+0 only as another record) |
| retraction detection (Retraction Watch via Crossref) | 20/20 (100%) |
| retraction false positives on ordinary papers | 0 |
| DOIs removed by the pipeline (nonexistent or wrong record) | 12 across 200 searches (DOI-check failures: 0) |
| DOIs RETURNED to the user, independently re-checked | 3757 (unresolvable 0, title mismatch 1, no Crossref record 50, unknown 0) |
| genuine references verified | 98/100 (98%) |
| genuine references by status | {"verified":98,"not_found":1,"mismatch":1} |
| fabricated references VERIFIED (must be 0) | 0/30 (0%) |
| fabricated references in an expected non-verified status | 29/30 (97%) |
| HELD-OUT known-item recall@10 / @20 | 58/60 (97%) / 59/60 (98%)  india 29/30, global 29/30 |
| HELD-OUT genuine references verified | 60/60 (100%)  india 30/30, global 30/30 |
| HELD-OUT genuine references by status | {"verified":60} |
| HELD-OUT fabricated references VERIFIED (must be 0) | 0/40 (0%) |
| provider failures | 4/800 (1%) |

## Held-out fabricated references by kind and resulting status

```json
{
 "chimera_title": {
  "mismatch": 20
 },
 "altered_year": {
  "mismatch": 20
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
  "mismatch": 7,
  "unverifiable": 1
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

## titleMismatch (1)

- 10.1080/14786419.2015.1004673 [crossref] ours: "<i>In vitro</i>antibiofilm activity of<i>Murraya koenigii</i>essential" | crossref: "In vitroantibiofilm activity ofMurraya koenigiiessential oil extracted"

## genuineMiss (2)

- [not_found] McMurray, J. J. V., Solomon, S. D., Inzucchi, S. E., Køber, L., Kosiborod, M. N., & Martinez, F. A. (2019). Dapagliflozi => No paper matching this title, authors and year was found in Crossref or OpenAlex. checks={"title":1,"author":null,"year":false}
- [mismatch] Murray, C. J. L., Ikuta, K. S., Sharara, F., Swetschinski, L., Robles Aguilar, G., & Gray, A. (2022). Global burden of b => A real paper with a very similar title exists: “Antimicrobial Resistance Collaborators (2022). Global burden of bacterial antimicrobial resistance in  checks={"title":0.9285714285714286,"author":false,"year":true}

## knownItemMiss (1)

- not in top 20: A Survey on Internet of Things: Architecture, Enabling Technologies, Security and Privacy, and Appli

## heldKnownMiss (2)

- [india] rank 11: Quantum gravitational collapse and Hawking radiation in2+1dimensions
- [global] not in top 20: Sleep disturbances in multiple sclerosis: Clinical and neuroradiologic correlations related to disea
