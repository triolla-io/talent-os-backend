---
phase: 05-file-storage
plan: "02"
subsystem: storage
tags: [nestjs, bullmq, cloudflare-r2, s3, storage, ingestion]

# Dependency graph
requires:
  - phase: 05-01
    provides: StorageService.upload() with S3Client, CV selection logic, R2 key generation
  - phase: 04-02
    provides: IngestionProcessor with ExtractionAgentService wired and ProcessingContext interface
provides:
  - StorageService injected into IngestionProcessor via constructor
  - ProcessingContext extended with fileKey and cvText fields
  - R2 upload called after AI extraction, errors propagate to BullMQ (no inline catch)
  - IngestionModule imports StorageModule
  - 3 Phase 5 integration tests passing (5-02-01, 5-02-02, 5-02-03)
affects: [06-dedup, 07-scoring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Error propagation over catch: R2 upload errors not caught in IngestionProcessor — propagate to BullMQ for automatic retry"
    - "Context extension: ProcessingContext carries fileKey and cvText for downstream phases to read without re-querying"
    - "Module-level DI: StorageService provided via StorageModule import (not direct provider list) in IngestionModule"

key-files:
  created: []
  modified:
    - src/ingestion/ingestion.processor.ts
    - src/ingestion/ingestion.module.ts
    - src/ingestion/ingestion.processor.spec.ts

key-decisions:
  - "No try-catch around storageService.upload() in IngestionProcessor — D-07: R2 transient errors must propagate to BullMQ for automatic retry, not silently logged"
  - "ProcessingContext extended in-place (fileKey initialized to null, cvText to fullText) then mutated after upload — avoids creating a second context object"
  - "StorageService provided via StorageModule export (not added to providers[]) — keeps IngestionModule clean and respects module encapsulation"

patterns-established:
  - "Phase N stub comment replaced atomically: read stub line number, replace with implementation, no orphaned comments"
  - "Existing test describe blocks require StorageService mock after IngestionProcessor constructor change — add minimal mock to keep pre-existing tests green"

requirements-completed: [STOR-01, STOR-02, STOR-03]

# Metrics
duration: 2min
completed: 2026-03-22
---

# Phase 5 Plan 02: Wire StorageService into IngestionProcessor Summary

**StorageService injected into IngestionProcessor with upload call after AI extraction, ProcessingContext carries fileKey and cvText through pipeline, all 3 Phase 5 integration tests passing (70 total, 0 failures)**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-22T18:07:47Z
- **Completed:** 2026-03-22T18:09:56Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- StorageService constructor-injected into IngestionProcessor; upload() called after AI extraction with (attachments, tenantId, messageId)
- ProcessingContext interface extended with fileKey: string | null and cvText: string — both available to Phase 6 (dedup) and Phase 7 (candidates write)
- IngestionModule updated to import StorageModule — StorageService available via module export without direct provider listing
- Phase 5 stub replaced: no try-catch around upload, errors propagate to BullMQ per D-07
- All 3 Phase 5 integration tests (5-02-01, 5-02-02, 5-02-03) pass; 70 total tests green across 11 suites

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire StorageService into IngestionProcessor and extend ProcessingContext** - `6c2ddb5` (feat)
2. **Task 2: Update IngestionModule and integration tests** - `5f6eaf2` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/ingestion/ingestion.processor.ts` - Added StorageService import + constructor param, extended ProcessingContext with fileKey/cvText, replaced Phase 5 stub with upload call (no try-catch)
- `src/ingestion/ingestion.module.ts` - Added StorageModule to imports array
- `src/ingestion/ingestion.processor.spec.ts` - Added StorageService mock to existing describe block; replaced 3 stub tests with real assertions

## Decisions Made
- No try-catch around upload call — D-07 requires errors to bubble to BullMQ for retry. Unlike extraction failures, R2 transient errors are retryable and the job should replay from scratch.
- Pre-existing describe block needed a StorageService mock added since IngestionProcessor now requires it in constructor. Used a minimal `{ upload: jest.fn().mockResolvedValue(...) }` mock that doesn't interfere with test assertions.
- context.fileKey initialized to null at Phase 3 context construction, then set after upload — avoids TypeScript type widening issues and is semantically accurate (null before upload).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added StorageService mock to original IngestionProcessor describe block**
- **Found during:** Task 2 (spec file update)
- **Issue:** The pre-existing describe('IngestionProcessor') block constructed TestingModule without StorageService provider. After adding storageService to IngestionProcessor constructor, NestJS DI would fail to compile the module in tests.
- **Fix:** Added `{ provide: StorageService, useValue: { upload: jest.fn().mockResolvedValue('...') } }` to the pre-existing describe block's TestingModule providers.
- **Files modified:** src/ingestion/ingestion.processor.spec.ts
- **Verification:** All 4 original tests still pass (hard reject, pass filter, extraction failure, successful extraction)
- **Committed in:** 5f6eaf2 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 2 - missing critical mock for new constructor dependency)
**Impact on plan:** Necessary fix — without it the 4 pre-existing tests would break. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviation above.

## Known Stubs
- `context.cvText = fullText` is set redundantly (already set at context construction and again after upload). This is intentional — the post-upload assignment documents the intent clearly and matches the pattern described in the plan. No functional impact.

## Next Phase Readiness
- Phase 5 (file storage) is complete. ProcessingContext carries fileKey and cvText.
- Phase 6 (duplicate detection) can read context.fileKey and context.cvText from the ProcessingContext.
- Phase 7 (candidate write) can use context.cvText for candidates.cv_text column.
- No blockers.

---
*Phase: 05-file-storage*
*Completed: 2026-03-22*

## Self-Check: PASSED

- src/ingestion/ingestion.processor.ts: FOUND
- src/ingestion/ingestion.module.ts: FOUND
- src/ingestion/ingestion.processor.spec.ts: FOUND
- .planning/phases/05-file-storage/05-02-SUMMARY.md: FOUND
- Commit 6c2ddb5 (Task 1): FOUND
- Commit 5f6eaf2 (Task 2): FOUND
