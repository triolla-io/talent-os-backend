---
quick_task: 260329-kxa
date_completed: 2026-03-29
duration_minutes: 15
status: completed
type: optimize
effort: small

commits:
  - hash: e001d89
    message: "refactor(260329-kxa): remove Phase 7 job loop — score only matched job"
    files_modified: 2

metrics:
  tests_passing: 25
  build_status: passing
  file_changes: 75 insertions, 79 deletions
---

# Refactor AI Scoring to Only Execute on Matched Job — Summary

**Task:** Remove unnecessary LLM API calls by scoring candidates against only the matched job from Phase 6.5, not all active jobs.

**Objective:** Reduce Phase 7 cost from N API calls (one per candidate-job pair) to 1 API call (one per matched candidate).

## What Was Changed

### File: `src/ingestion/ingestion.processor.ts` (Lines 299-367)

**Before:**
- Fetch ALL active jobs (line 300-303)
- Loop over jobs and score candidate against each (line 306-364)
- Continue on scoring error without failing the pipeline (line 344)

**After:**
- Removed `activeJobs` fetch entirely
- Removed `for (const activeJob of activeJobs)` loop
- Use `matchedJob` directly from Phase 6.5 (already guaranteed to exist at this point)
- Single scoring call per matched candidate
- Throw on scoring error (fail-fast) instead of continue (will be retried by BullMQ)

**Key change:** Line 302 now reads `const activeJob = matchedJob;` instead of fetching and looping over all jobs.

### File: `src/ingestion/ingestion.processor.spec.ts`

Updated 2 tests to reflect new behavior:

1. **Test 7-02-02 (SCOR-01):** Changed expectation from `toHaveBeenCalledTimes(2)` to `toHaveBeenCalledTimes(1)`
   - Phase 6.5 still calls `findMany` for job matching
   - Phase 7 no longer calls `findMany` (uses matched job directly)
   - Comment updated to reflect this

2. **Test 7-02-06:** Rewritten to test new error behavior
   - Old: tested "error isolation" (continue on job scoring failure)
   - New: tests that scoring error on matched job throws and marks intake as failed
   - Reason: New behavior fails fast on matched job scoring rather than continuing

## Verification

**Build:** `npm run build` — passing, no TypeScript errors
**Tests:** `npm test -- ingestion.processor.spec.ts` — 25 passing, 0 failures
**Code review:** All changes align with plan specification

## Impact

- **Cost:** Reduced LLM scoring calls from N per candidate to 1 per matched candidate
- **Performance:** Single scoring call instead of loop
- **Semantics:** If matched job scoring fails, the job is retried by BullMQ (fail-fast instead of skip)
- **Behavior for unmatched candidates:** Unchanged — still skip scoring if no job matches threshold

## No Deviations

Plan executed exactly as written. All changes committed atomically in single commit.
