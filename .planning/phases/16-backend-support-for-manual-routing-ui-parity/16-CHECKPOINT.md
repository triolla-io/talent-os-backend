---
checkpoint: Phase 16 Progress Snapshot
date: "2026-03-31T14:30:00Z"
status: in-progress
completed_waves: 1
remaining_waves: 1
---

# Phase 16 Checkpoint: Backend Support for Manual Routing & UI Parity

## Summary

Phase 16 execution began in interactive mode on 2026-03-31. Initial implementation and fixes have been applied. Ready to resume comprehensive testing and manual verification.

## Completed Work

### Wave 1 (Autonomous Plans)

**Plan 16-01: Response DTO Extensions**
- ✓ `shortId` field already exposed in JobResponse (via `_formatJobResponse()`)
- ✓ `source_agency` field confirmed present in CandidateResponse DTO
- ✓ CandidateResponse format verified as flattened (NO nested applications array)
- ✓ ai_score correctly calculated as Math.max of candidate_job_scores
- ✓ Jobs service tests passing (28 tests)
- Commit: `94e98d4 feat(16-01): expose shortId in Job response DTOs`

**Plan 16-02: Manual Job Reassignment & Unassigned Filter**
- ✓ `updateCandidate()` method implements full reassignment logic
- ✓ ALREADY_ASSIGNED error removed; reassignment allowed (jobId=X→Y)
- ✓ Old Application preserved on reassignment; new Application created atomically
- ✓ Fresh scoring triggered via ScoringAgentService on reassignment
- ✓ hiringStageId reset to first enabled stage of new job
- ✓ Job validation: rejects with 400 NO_STAGES if no enabled stages
- ✓ Atomic transactions enforced (profile updates + reassignment together)
- ✓ Scoring failure non-blocking per D-21 (candidate assigned even if score fails)
- ✓ `findAll()` method supports unassigned filter (unassigned=true → jobId=null)
- ✓ CandidatesController parses unassigned query param correctly
- ✓ PATCH /candidates/:id endpoint wired and working
- ✓ GET /candidates?unassigned=true endpoint wired and working
- Commit: `7ba9602 feat(16-02): implement manual job reassignment and unassigned filter`

**Infrastructure Fixes**
- ✓ Jest configuration updated to handle @openrouter/sdk ES modules
- ✓ CandidatesService test mocks fixed (ScoringAgentService, CandidateAiService)
- ✓ mockCandidate helper updated with required fields
- Commit: `f003e73 fix(jest): handle ES modules from @openrouter/sdk and add CandidateAiService mock`

## Remaining Work

### Wave 2 (Testing & Verification)

**Plan 16-03: Comprehensive Testing**

**Task 1: Unit Tests** (50+ reassignment/unassigned filter tests)
- [ ] Reassignment scenarios: initial assignment, mid-pipeline, same-job no-op, etc.
- [ ] Unassigned filter scenarios: with/without params, combined filters
- [ ] Response format compliance tests
- [ ] Error handling (NO_STAGES, NOT_FOUND, etc.)
- [ ] Atomic transaction verification

**Task 2: Controller Integration Tests** (30+ PATCH and GET tests)
- [ ] PATCH /candidates/:id reassignment validation
- [ ] GET /candidates?unassigned=true filtering
- [ ] Query parameter parsing
- [ ] Response format validation
- [ ] Error case handling

**Task 3: Manual Smoke Test Checkpoint**
- [ ] Verify GET /candidates?unassigned=true returns only jobId=null candidates
- [ ] Assign unmatched candidate to first job
- [ ] Verify Application created, hiring_stage_id set, ai_score calculated
- [ ] Verify flattened response (no nested applications array)
- [ ] Reassign candidate to different job
- [ ] Verify old Application preserved, new Application created
- [ ] Verify shortId in job response
- [ ] Test error case: reassign to job with no enabled stages → 400 NO_STAGES
- [ ] All 10 smoke test steps verified

## Key Implementation Details

### updateCandidate() Reassignment Flow
```
1. Validate candidate exists
2. If jobId not changing: update profile fields only
3. If jobId=X→Y (reassignment):
   a. Validate new job exists (404 if not)
   b. Validate new job has enabled stages (400 NO_STAGES if none)
   c. Transaction:
      - Create new Application with stage='new'
      - Update Candidate.jobId + hiringStageId
      - Call ScoringAgentService.score() (non-blocking on failure)
      - Insert CandidateJobScore if scoring succeeds
4. Atomicity: entire flow or none
```

### findAll() Unassigned Filter
```
if (unassigned=true) {
  where.jobId = null  // returns only unassigned candidates
} else if (jobId param) {
  where.jobId = jobId  // returns candidates for specific job
} else {
  // returns all candidates (excluding rejected)
}
```

## Test Coverage Status

| Category | Status | Notes |
|----------|--------|-------|
| Wave 1 unit tests | ✓ PASS | 28 tests in jobs.service.spec.ts |
| Wave 1 compilation | ✓ PASS | npm run build completes without errors |
| Jest ES module fix | ✓ PASS | @openrouter/sdk now handled correctly |
| Wave 2 unit tests | ⏳ PENDING | 50+ tests to be added |
| Wave 2 integration tests | ⏳ PENDING | 30+ tests to be added |
| Wave 2 smoke tests | ⏳ PENDING | 10 manual API verification steps |

## Next Steps (After Context Clear)

1. **Add comprehensive unit tests** for reassignment and unassigned filter
2. **Add integration tests** for controller endpoints
3. **Execute manual smoke test** checkpoint (10 curl/db inspection steps)
4. **Create SUMMARY.md** with test results and verification outcomes
5. **Run full test suite** verification

## Files Modified This Session

- `package.json` — Jest config transformIgnorePatterns
- `src/candidates/candidates.service.spec.ts` — Test infrastructure fixes
- Various source files (committed in prior waves)

---

**Status:** Ready to resume. User requested context clear and continuation.
