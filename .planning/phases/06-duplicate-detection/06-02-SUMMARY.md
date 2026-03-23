---
phase: 06-duplicate-detection
plan: "02"
subsystem: dedup
tags: [nestjs, bullmq, prisma, postgresql, pg_trgm, dedup, integration-tests]

# Dependency graph
requires:
  - phase: 06-01
    provides: DedupService fully implemented with check(), insertCandidate(), upsertCandidate(), createFlag()
  - phase: 06-00
    provides: DedupModule skeleton, 3 it.todo stubs in ingestion.processor.spec.ts

provides:
  - IngestionProcessor with DedupService injected and Phase 6 stub replaced with full dedup logic
  - IngestionModule importing DedupModule
  - ProcessingContext.candidateId: string field for Phase 7 consumption
  - 3 passing integration tests covering all 3 dedup outcomes (no match, exact match, fuzzy match)
  - email_intake_log.candidate_id set immediately after INSERT/UPSERT (D-10: no orphaned logs)

affects:
  - 07-scoring

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Phase 6 dedup logic: check() → branch on confidence (1.0=exact/upsert, <1.0=fuzzy/insert+flag, null=insert)"
    - "D-10 pattern: emailIntakeLog.candidate_id set before Phase 7 work — prevents orphaned logs on enrichment failure"
    - "D-16 pattern: context.candidateId set after log update — passes forward to Phase 7 via ProcessingContext"
    - "Integration test pattern: DedupService mock provided to all describe blocks that use IngestionProcessor"

key-files:
  created: []
  modified:
    - src/ingestion/ingestion.processor.ts
    - src/ingestion/ingestion.module.ts
    - src/ingestion/ingestion.processor.spec.ts

key-decisions:
  - "DedupService added as last constructor param — NestJS DI resolves it from DedupModule import in IngestionModule"
  - "ProcessingContext.candidateId initialized to empty string '' — matches TypeScript strict type; set to real ID by Phase 6 logic before use"
  - "Existing test assertion updated: 4-02-02 now expects 2 update calls (processing + candidateId) not 1"

patterns-established:
  - "Phase N dedup: replace stub comment with real logic block after all service methods are implemented"
  - "All describe blocks in ingestion.processor.spec.ts need DedupService mock after Phase 6 constructor injection"

requirements-completed: [DEDUP-01, DEDUP-02, DEDUP-03, DEDUP-04, DEDUP-05, DEDUP-06]

# Metrics
duration: 12min
completed: 2026-03-23
---

# Phase 06 Plan 02: Wire DedupService into IngestionProcessor — Summary

**Full end-to-end duplicate detection pipeline: DedupService injected into IngestionProcessor, Phase 6 stub replaced with exact/fuzzy/no-match branching logic, candidateId linked to email_intake_log immediately, 3 passing integration tests for all dedup outcomes**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-03-23T09:10:00Z
- **Completed:** 2026-03-23
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Extended ProcessingContext interface with `candidateId: string` for Phase 7 consumption
- Injected DedupService into IngestionProcessor and wired DedupModule into IngestionModule
- Replaced Phase 6 stub comment with full dedup branching logic (exact match → upsert, fuzzy → insert+flag, no match → insert)
- Set `email_intake_log.candidate_id` immediately after INSERT/UPSERT (D-10) — enrichment failures cannot orphan log rows
- Replaced all 3 `it.todo` stubs with passing integration tests; 83 total tests passing (80 prior + 3 new)

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend ProcessingContext, inject DedupService, replace Phase 6 stub** - `f05775f` (feat)
2. **Task 2: Wire DedupModule into IngestionModule** - `678b7d5` (feat)
3. **Task 3: Replace 3 CAND-03 it.todo stubs with passing integration tests** - `a879f08` (test)

**Plan metadata:** (docs commit — recorded at state update)

## Files Created/Modified

- `src/ingestion/ingestion.processor.ts` — ProcessingContext.candidateId added; DedupService injected; Phase 6 stub replaced with check/insert/upsert/createFlag branching; emailIntakeLog.update with candidateId; context.candidateId set
- `src/ingestion/ingestion.module.ts` — DedupModule added to imports array
- `src/ingestion/ingestion.processor.spec.ts` — DedupService mock added to all describe blocks; 3 new Phase 6 integration tests replacing it.todo stubs; 4-02-02 assertion updated for 2 update calls

## Decisions Made

- DedupService added as last constructor parameter — follows Phase 5 pattern where StorageService was appended last
- ProcessingContext.candidateId initialized to `''` at context object literal — required because TypeScript needs all interface fields at object creation; real ID set by Phase 6 logic before any use
- 4-02-02 test assertion updated from 1→2 expected update calls: Phase 6 adds a second `emailIntakeLog.update` call (setting candidateId) after extraction succeeds — this is correct behavior

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] DedupService mock missing from existing test describe blocks**
- **Found during:** Task 3 (integration tests)
- **Issue:** Plan specified adding DedupService mock only to the new Phase 6 describe block. But the two existing describe blocks ('IngestionProcessor' and 'Phase 5 StorageService') also use `Test.createTestingModule` which now needs DedupService as a provider — NestJS DI would throw "Nest can't resolve dependencies of IngestionProcessor" at test runtime.
- **Fix:** Added `{ provide: DedupService, useValue: dedupService }` to both existing describe blocks' `beforeEach` setups
- **Files modified:** src/ingestion/ingestion.processor.spec.ts
- **Verification:** All 83 tests pass
- **Committed in:** a879f08 (Task 3 commit)

**2. [Rule 1 - Bug] Test 4-02-02 assertion incorrect after Phase 6 adds second update call**
- **Found during:** Task 3 (running full test suite)
- **Issue:** Test `'successful extraction does not update failed status'` asserted `toHaveBeenCalledTimes(1)`. Phase 6 adds a second `emailIntakeLog.update` call (setting candidateId) on the success path — the test would have failed with "expected 1 call but received 2".
- **Fix:** Updated assertion to `toHaveBeenCalledTimes(2)` with comment explaining the two calls (processing + candidateId). The core intent of the test (no 'failed' status) is preserved.
- **Files modified:** src/ingestion/ingestion.processor.spec.ts
- **Verification:** All 83 tests pass
- **Committed in:** a879f08 (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes necessary — one for DI compilation, one for correct assertion count. No scope creep.

## Issues Encountered

None beyond the two auto-fixed issues above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 6 complete: duplicate detection pipeline end-to-end operational
- DEDUP-01 through DEDUP-06 all satisfied
- ProcessingContext.candidateId ready for Phase 7 (scoring/enrichment) to consume
- 83 tests passing across 12 suites, 0 failures

---
*Phase: 06-duplicate-detection*
*Completed: 2026-03-23*

## Self-Check: PASSED

All modified files verified present:
- FOUND: src/ingestion/ingestion.processor.ts
- FOUND: src/ingestion/ingestion.module.ts
- FOUND: src/ingestion/ingestion.processor.spec.ts
- FOUND: .planning/phases/06-duplicate-detection/06-02-SUMMARY.md

All commits verified in git history:
- FOUND: f05775f (feat: wire DedupService into IngestionProcessor)
- FOUND: 678b7d5 (feat: add DedupModule to IngestionModule)
- FOUND: a879f08 (test: replace 3 CAND-03 it.todo stubs)
