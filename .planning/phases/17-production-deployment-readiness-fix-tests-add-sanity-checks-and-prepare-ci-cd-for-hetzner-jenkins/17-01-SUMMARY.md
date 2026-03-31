---
phase: 17-production-deployment-readiness-fix-tests-add-sanity-checks-and-prepare-ci-cd-for-hetzner-jenkins
plan: '01'
subsystem: testing
tags: [jest, nestjs, prisma, mocks, unit-tests]

# Dependency graph
requires:
  - phase: 16-backend-support-for-manual-routing-ui-parity
    provides: jobs.service.ts updateJob() with tx.candidate.updateMany + tx.application.updateMany; candidates.service.ts jobStage lookup
provides:
  - All 253 unit tests green with 0 failures across 21 test suites
  - Fixed mockTx in jobs.integration.spec.ts to include candidate and application objects
  - Fixed _count.candidates key in makeMockJob mock (was applications, service reads candidates)
  - Fixed candidates.integration.spec.ts with jobStage mock and cv_text in service response
affects:
  - CI/CD pipeline (Jenkins gate requires 0 failing tests)
  - Phase 17 plans 02-05 (all depend on clean test suite as prerequisite)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Test mock completeness: mockTx must expose all Prisma model objects called inside the transaction"
    - "Response mapper completeness: all candidate fields must be included in createCandidate response"

key-files:
  created: []
  modified:
    - src/jobs/jobs.integration.spec.ts
    - src/candidates/candidates.integration.spec.ts
    - src/candidates/candidates.service.ts

key-decisions:
  - "Updated _count.candidates key in mock (was _count.applications — service uses candidates relation, not applications)"
  - "Added cv_text to createCandidate response mapper — field exists in DB model but was missing from response"

patterns-established:
  - "Mock Prisma transactions must include all model objects the service calls inside tx (candidate, application, jobStage, etc.)"

requirements-completed:
  - D-10
  - D-12
  - D-13

# Metrics
duration: 10min
completed: 2026-03-31
---

# Phase 17 Plan 01: Fix Failing Unit Tests Summary

**Fixed 6+ failing tests from Phase 16 changes: PUT /jobs mockTx missing candidate/application, candidate_count mock key mismatch, and candidates spec missing jobStage + cv_text**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-31T16:35:00Z
- **Completed:** 2026-03-31T16:42:27Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Fixed `jobs.integration.spec.ts` makePutPrisma() mockTx to include `candidate.updateMany` and `application.updateMany` — Phase 16 added these calls to `updateJob()` but tests weren't updated
- Fixed `_count.candidates` vs `_count.applications` mismatch in `makeMockJob()` default and the `candidate_count reflects applications count` test override
- Fixed `candidates.integration.spec.ts`: added `jobStage.findFirst` mock (Phase 16 added jobStage lookup in `createCandidate`) and added `cv_text` to service response mapper
- Full test suite: 253 tests passing across 21 suites, 0 failures

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix PUT /jobs mockTx and candidate_count mock** - `f3cf39e` (fix)
2. **Task 2+3: Fix candidates spec + full suite green** - `7826a4f` (fix)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `src/jobs/jobs.integration.spec.ts` — Fixed mockTx in makePutPrisma() to include candidate/application; fixed _count key to candidates
- `src/candidates/candidates.integration.spec.ts` — Added jobStage.findFirst mock to makeBasePrisma()
- `src/candidates/candidates.service.ts` — Added cv_text field to createCandidate response mapper

## Decisions Made

- Updated `_count.candidates` (not `_count.applications`) in mock to match the `formatJobResponse()` mapper which reads `job._count?.candidates ?? 0`
- Added `cv_text` to `createCandidate` response — test expected it, field exists on model, was simply missing from mapper

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed candidates.integration.spec.ts — missing jobStage mock**
- **Found during:** Task 3 (full suite verification)
- **Issue:** Phase 16 added `this.prisma.jobStage.findFirst()` call in `CandidatesService.createCandidate()` but `makeBasePrisma()` mock didn't expose `jobStage` object — TypeError: Cannot read properties of undefined
- **Fix:** Added `jobStage: { findFirst: jest.fn().mockResolvedValue({ id: 'stage-uuid' }) }` to `makeBasePrisma()`
- **Files modified:** src/candidates/candidates.integration.spec.ts
- **Verification:** 9/9 candidates tests pass
- **Committed in:** 7826a4f

**2. [Rule 1 - Bug] Fixed candidates.service.ts missing cv_text in response**
- **Found during:** Task 3 (full suite verification)
- **Issue:** Test expected `cv_text: null` in `createCandidate` response but service response mapper omitted the `cvText` field
- **Fix:** Added `cv_text: candidate.cvText` to response object in `createCandidate()`
- **Files modified:** src/candidates/candidates.service.ts
- **Verification:** Test passes, field correctly returned as null for manual adds
- **Committed in:** 7826a4f

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bugs from Phase 16 incomplete updates)
**Impact on plan:** Both auto-fixes necessary for correctness. No scope creep. The plan mentioned 6 known failures; we found and fixed 2 additional failures in candidates tests.

## Issues Encountered

- ingestion.processor.spec.ts `status: 'active'` → `'open'` changes were already applied in this worktree (from Phase 16 commits) — Task 2 was already satisfied at execution start

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Full test suite is green: 253 tests, 21 suites, 0 failures
- Ready for Plan 17-02: health check / sanity check endpoints
- CI gate prerequisite satisfied

---
*Phase: 17-production-deployment-readiness-fix-tests-add-sanity-checks-and-prepare-ci-cd-for-hetzner-jenkins*
*Completed: 2026-03-31*
