---
phase: 03-processing
plan: "00"
subsystem: testing
tags: [jest, nestjs, bullmq, wave-0, stub-tests, spam-filter, attachment-extractor]

# Dependency graph
requires:
  - phase: 02-webhook-intake
    provides: ingestion.processor.ts stub and PostmarkPayloadDto types
provides:
  - Three Wave 0 spec files with 12 named stub tests (it.todo) and 3 exported mock helpers
  - Minimal Wave 0 service stubs for SpamFilterService and AttachmentExtractorService
affects:
  - 03-01 (spam filter implementation — uses spam-filter.service.spec.ts)
  - 03-02 (attachment extractor implementation — uses attachment-extractor.service.spec.ts)
  - 03-03 (processor integration — uses ingestion.processor.spec.ts)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wave 0 stub pattern: create minimal service stubs + it.todo() spec files before implementation"
    - "Mock helpers exported from spec files for reuse across related specs"

key-files:
  created:
    - src/ingestion/services/spam-filter.service.spec.ts
    - src/ingestion/services/spam-filter.service.ts
    - src/ingestion/services/attachment-extractor.service.spec.ts
    - src/ingestion/services/attachment-extractor.service.ts
    - src/ingestion/ingestion.processor.spec.ts
  modified: []

key-decisions:
  - "Wave 0 stubs require minimal service stub files alongside spec files — jest.mock() factory pattern fails when module doesn't physically exist on disk"
  - "Mock helpers (mockPostmarkPayload, mockBase64Pdf, mockBase64Docx) exported from spam-filter.service.spec.ts and imported by other specs"

patterns-established:
  - "Stub service pattern: create throw-not-implemented class in .service.ts; spec mocks it with jest.fn() via object spread"
  - "Spec helper reuse: export mock factories from primary spec, import in sibling specs"

requirements-completed: [PROC-02, PROC-03, PROC-04, PROC-05, PROC-06]

# Metrics
duration: 3min
completed: 2026-03-22
---

# Phase 3 Plan 00: Wave 0 Test Stubs Summary

**Three Jest spec files with 12 named it.todo() stubs and 3 exported mock helpers, enabling Nyquist compliance before any implementation begins**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-22T15:28:09Z
- **Completed:** 2026-03-22T15:29:47Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Created `spam-filter.service.spec.ts` with 5 stub test cases (PROC-02, PROC-03) and 3 exported mock helpers
- Created `attachment-extractor.service.spec.ts` with 5 stub test cases (PROC-04, PROC-05)
- Created `ingestion.processor.spec.ts` with 2 stub integration test cases (PROC-06)
- All 12 todos discovered by Jest: `npm test -- --testPathPatterns="ingestion" --passWithNoTests` exits 0

## Task Commits

Each task was committed atomically:

1. **Task 1: spam-filter.service.spec.ts** - `7bd5b74` (test)
2. **Task 2: attachment-extractor.service.spec.ts** - `dd45909` (test)
3. **Task 3: ingestion.processor.spec.ts** - `b9ee109` (test)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/ingestion/services/spam-filter.service.spec.ts` - 5 it.todo() stubs for PROC-02/03; exports mockPostmarkPayload, mockBase64Pdf, mockBase64Docx
- `src/ingestion/services/spam-filter.service.ts` - Minimal stub class (throws NotImplemented); enables spec import to compile
- `src/ingestion/services/attachment-extractor.service.spec.ts` - 5 it.todo() stubs for PROC-04/05; imports helpers from spam-filter spec
- `src/ingestion/services/attachment-extractor.service.ts` - Minimal stub class (throws NotImplemented)
- `src/ingestion/ingestion.processor.spec.ts` - 2 it.todo() integration stubs for PROC-06; mocks all dependencies

## Decisions Made

- `jest.mock()` factory pattern fails when the module file doesn't exist on disk — Jest resolves the path even with a factory. Resolution: create minimal stub .service.ts files that throw NotImplemented. These are replaced by real implementation in Plans 03-01 and 03-02.
- Mock helpers exported from `spam-filter.service.spec.ts` (not a shared `test-helpers.ts`) — keeps helpers co-located with their primary test subject.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created minimal stub service files alongside spec files**
- **Found during:** Task 1 (creating spam-filter.service.spec.ts)
- **Issue:** Plan said to use `jest.mock('./spam-filter.service', () => ({ SpamFilterService: jest.fn() }))` but Jest throws "Cannot find module" even with a factory function when the file doesn't physically exist on disk
- **Fix:** Created `spam-filter.service.ts` and `attachment-extractor.service.ts` as minimal stubs with a class that throws NotImplemented. Spec files import the real class type, then create mock instances inline.
- **Files modified:** src/ingestion/services/spam-filter.service.ts, src/ingestion/services/attachment-extractor.service.ts
- **Verification:** All 3 spec files pass with Jest exits 0
- **Committed in:** 7bd5b74, dd45909 (part of task commits)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking)
**Impact on plan:** Essential fix — no behavior change, stubs still fully replaced in Plans 03-01/03-02.

## Issues Encountered

None beyond the jest.mock deviation above.

## Next Phase Readiness

- All Wave 0 spec stubs in place — Wave 1 plans (03-01, 03-02) can proceed
- Each implementation plan fills in the it.todo() bodies to make tests go green
- `npm test -- --testPathPatterns="ingestion" --passWithNoTests` is the quick validation command for all Wave 1/2 tasks

---
*Phase: 03-processing*
*Completed: 2026-03-22*
