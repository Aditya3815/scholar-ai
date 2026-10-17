# Eval report (record, 2026-10-17)

| Metric | Result |
| --- | --- |
| mode | record (6557 HTTP calls, 6456 fixtures saved) |
| known-item search recall@10 / @20 / MRR | 99/100 (99%) / 99/100 (99%) / 0.89 |
| topical landmarks in top 10 | 20/20 (100%) |
| retracted papers returned by search (own DOI) / flagged | 20/20 (100%) / 20/20 (100%) (+0 only as another record) |
| retraction detection (Retraction Watch via Crossref) | 20/20 (100%) |
| retraction false positives on ordinary papers | 0 |
| DOIs removed by the pipeline (nonexistent or wrong record) | 11 across 140 searches (DOI-check failures: 0) |
| DOIs RETURNED to the user, independently re-checked | 2606 (unresolvable 0, title mismatch 0, no Crossref record 43, unknown 0) |
| genuine references verified | 100/100 (100%) |
| genuine references by status | {"verified":100} |
| fabricated references VERIFIED (must be 0) | 0/30 (0%) |
| fabricated references in an expected non-verified status | 29/30 (97%) |
| provider failures | 4/560 (1%) |

## Fabricated references by kind and resulting status

```json
{
 "invented": {
  "mismatch": 9,
  "not_found": 1
 },
 "chimera_title": {
  "mismatch": 7,
  "unverifiable": 1
 },
 "real_author_invented_title": {
  "mismatch": 4
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
