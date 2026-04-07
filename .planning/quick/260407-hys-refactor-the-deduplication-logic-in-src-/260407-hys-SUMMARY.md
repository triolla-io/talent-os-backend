---
quick_id: 260407-hys
goal: Refactor DedupService.check() to detect duplicates exclusively by phone number
status: complete
commit: 5b80a6c
---

# Quick Task Summary: Phone-Only Deduplication Refactor

## What Was Done

Replaced the two-step email + fuzzy-name deduplication logic with a single phone-exact-match approach. The old `DedupService.check()` used `candidate.findFirst` for email lookup and a `$queryRaw` pg_trgm similarity query for name fuzzy-matching. Both were removed.

## Changes Made

### `src/dedup/dedup.service.ts`

- Removed `FuzzyMatch` interface (no longer needed)
- Updated `DedupResult.match` type: `{ id: string } | null` (null for phone_missing sentinel)
- `check()` rewritten to three-step phone-only logic:
  1. Phone null/empty string → return `{ match: null, confidence: 0, fields: ['phone_missing'] }` sentinel
  2. Exact phone match via `$queryRaw` with `regexp_replace(phone, '[^0-9]', '', 'g')` normalization → `{ match: { id }, confidence: 1.0, fields: ['phone'] }`
  3. No match → `null`
- `createFlag()` signature updated: `matchedCandidateId: string | null`, added `fields: string[]` parameter (replaces hardcoded `['name']`)
- `createFlag()` self-references `candidateId` when `matchedCandidateId` is null (satisfies FK constraint)

### `src/ingestion/ingestion.processor.ts`

- Phase 6 transaction block rewritten with three branches:
  - `dedupResult === null` → insert new candidate (no flag)
  - `dedupResult.fields.includes('phone_missing')` → insert new candidate + `createFlag(..., null, 0, ..., ['phone_missing'], tx)`
  - `dedupResult.confidence === 1.0` → upsert existing candidate (phone match)
- Removed the `dedupResult.confidence < 1.0` fuzzy-match branch entirely
- Updated comment on `DedupResult | null` type at Phase 6 dedup call site

### `src/dedup/dedup.service.spec.ts`

Fully rewritten. Removed 7 old tests (DEDUP-01 through DEDUP-07). Replaced with 5 new tests:

| Test | Scenario | Result |
|------|----------|--------|
| DEDUP-01 | phone is null | `{ match: null, confidence: 0, fields: ['phone_missing'] }` |
| DEDUP-02 | exact phone match found | `{ match: { id }, confidence: 1.0, fields: ['phone'] }` |
| DEDUP-03 | phone provided, no DB match | `null` |
| DEDUP-04 | createFlag with phone_missing | self-references candidateId in upsert |
| DEDUP-05 | createFlag with phone match | passes `matchFields: ['phone']` through |

Removed `prisma.candidate.findFirst` mock (no longer used by service).

### `src/ingestion/ingestion.processor.spec.ts`

Updated test `6-02-03`: replaced fuzzy-match scenario (confidence 0.85, fields: ['name']) with phone_missing scenario. Verifies `insertCandidate` called once and `createFlag` called with `null` matchedCandidateId, confidence 0, and `['phone_missing']` fields.

## Test Results

```
dedup suite:               5 passed, 5 total
ingestion.processor suite: 29 passed, 29 total
full suite:                248 passed, 248 total (20 suites)
tsc --noEmit:              clean (no errors)
```

## Deviations

None — plan executed exactly as written.

## Commit

`5b80a6c` — refactor(dedup): replace email/fuzzy-name dedup with phone-exact match
