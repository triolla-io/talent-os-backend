---
phase: 06-duplicate-detection
plan: "01"
subsystem: dedup
tags: [nestjs, prisma, postgresql, pg_trgm, dedup, tdd, unit-tests]

# Dependency graph
requires:
  - phase: 06-00
    provides: DedupModule skeleton, DedupService stub, 5 it.todo stubs

provides:
  - DedupService: full implementation with check(), insertCandidate(), upsertCandidate(), createFlag()
  - dedup.service.spec.ts: 5 passing unit tests for DEDUP-01 through DEDUP-05
  - mockCandidateDedupExtract: exported factory for Plan 02 processor integration tests

affects:
  - 06-02-processor-integration
  - 07-scoring

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Prisma.Decimal import from @prisma/client (not @prisma/client/runtime/library — that was Prisma 6)"
    - "pg_trgm fuzzy match via $queryRaw template literal with % operator and ORDER BY name_sim DESC LIMIT 1"
    - "Two-step dedup: exact email first (skip if null), then fuzzy name — stop at first match"
    - "createFlag upsert with no-op update: {}, idempotent on BullMQ retry"

key-files:
  created: []
  modified:
    - src/dedup/dedup.service.ts
    - src/dedup/dedup.service.spec.ts

key-decisions:
  - "Decimal import fixed from @prisma/client/runtime/library (Prisma 6) to Prisma.Decimal from @prisma/client (Prisma 7)"
  - "NULL email guard: candidate.email falsy check skips findFirst entirely — SQL NULL=NULL is always false"
  - "upsertCandidate updates only fullName + phone — source and sourceEmail never updated (first-submission wins)"
  - "createFlag uses upsert on idx_duplicates_pair with empty update {} — idempotent on worker retry"

# Metrics
duration: 15min
completed: 2026-03-23
---

# Phase 06 Plan 01: Implement DedupService — Summary

**Full DedupService implementation with exact-then-fuzzy two-step dedup via pg_trgm, plus 5 passing unit tests and mockCandidateDedupExtract factory for Plan 02**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-23T07:14:00Z
- **Completed:** 2026-03-23
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Implemented DedupService.check() with exact email match (null guard) → fuzzy name match (pg_trgm $queryRaw) two-step logic
- Implemented DedupService.insertCandidate() writing 6 fields only (tenantId, fullName, email, phone, source, sourceEmail)
- Implemented DedupService.upsertCandidate() updating only fullName + phone (source/sourceEmail never touched — D-07)
- Implemented DedupService.createFlag() using upsert on idx_duplicates_pair with no-op update for idempotency
- Replaced all 5 it.todo stubs with passing unit tests (DEDUP-01 through DEDUP-05)
- Exported mockCandidateDedupExtract factory for Plan 02 processor integration tests
- 80 total tests passing (75 existing + 5 new), 0 failures, 12 suites, 3 remaining todos (expected — Plan 02 integration tests)

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement DedupService** - `5e0af0c` (feat)
2. **Task 2: Replace it.todo stubs with 5 passing unit tests** - `d279412` (test)

**Plan metadata:** (docs commit — recorded at state update)

## Files Created/Modified

- `src/dedup/dedup.service.ts` — Full DedupService implementation replacing stub (check, insertCandidate, upsertCandidate, createFlag)
- `src/dedup/dedup.service.spec.ts` — 5 passing unit tests replacing it.todo stubs, exports mockCandidateDedupExtract factory

## Decisions Made

- Decimal import corrected from `@prisma/client/runtime/library` (Prisma 6 path) to `Prisma.Decimal` from `@prisma/client` (Prisma 7 pattern)
- NULL email guard: `if (candidate.email)` falsy check skips findFirst entirely — SQL NULL=NULL always false so no need to query
- source and sourceEmail intentionally omitted from upsertCandidate.data — first-submission wins policy (D-07)
- createFlag.update set to empty `{}` — idempotent on BullMQ retry, no data overwrite (D-13)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Incorrect Decimal import path for Prisma 7**
- **Found during:** Task 1 verification (npx tsc --noEmit)
- **Issue:** Plan specified `import { Decimal } from '@prisma/client/runtime/library'` which was the Prisma 6 path. Prisma 7 does not have a `library` file in its runtime directory — tsc reported TS2307 module not found.
- **Fix:** Changed to `import { Prisma } from '@prisma/client'` and used `new Prisma.Decimal(...)` — confirmed present in `node_modules/.prisma/client/index.d.ts` as `export import Decimal = runtime.Decimal`.
- **Files modified:** src/dedup/dedup.service.ts
- **Commit:** 5e0af0c (included in Task 1 commit)

## Known Stubs

None — all DedupService methods are fully implemented. The 3 remaining `it.todo` entries in `src/ingestion/ingestion.processor.spec.ts` are intentional placeholders for Plan 02 processor integration tests.

---
*Phase: 06-duplicate-detection*
*Completed: 2026-03-23*
