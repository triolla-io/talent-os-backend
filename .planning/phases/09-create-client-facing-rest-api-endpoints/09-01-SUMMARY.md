---
phase: 09-create-client-facing-rest-api-endpoints
plan: "01"
subsystem: api
tags: [nestjs, prisma, candidates, rest-api, typescript]

requires:
  - phase: 01-foundation
    provides: NestJS app structure, PrismaModule (global), ConfigModule (global)
  - phase: 02-webhook-intake
    provides: WebhooksModule pattern for NestJS module structure

provides:
  - CandidatesService with findAll(q?, filter?) returning snake_case CandidateResponse[]
  - CandidatesController exposing GET /candidates with q and filter query params
  - CandidatesModule importable into AppModule
  - ai_score computed as MAX(candidate_job_scores) across all applications
  - is_duplicate derived from unreviewed duplicate_flags rows

affects:
  - 09-02 (jobs endpoint — same module pattern)
  - 09-03 (applications endpoint — same module pattern)
  - AppModule (needs CandidatesModule import)

tech-stack:
  added: []
  patterns:
    - NestJS module pattern with PrismaModule import, controller, and service
    - Snake_case response mapping from Prisma camelCase fields in service layer
    - Post-query computed field derivation (ai_score, is_duplicate) after Prisma findMany
    - import type for type-only symbols in decorated controller signatures (isolatedModules compat)

key-files:
  created:
    - src/candidates/candidates.service.ts
    - src/candidates/candidates.service.spec.ts
    - src/candidates/candidates.controller.ts
    - src/candidates/candidates.module.ts
  modified: []

key-decisions:
  - "Post-query filter for high-score: ai_score computed in JS after DB fetch since it derives from nested scores"
  - "import type CandidateFilter in controller to satisfy isolatedModules+emitDecoratorMetadata constraint"
  - "PrismaModule imported explicitly in CandidatesModule even though it is @Global — keeps module self-contained"

patterns-established:
  - "Snake_case output mapping: Prisma camelCase fields mapped to snake_case in service layer, not controller"
  - "Derived fields computed in service after findMany (ai_score=MAX scores, is_duplicate=unreviewed flags count)"

requirements-completed:
  - RAPI-01

duration: 2min
completed: 2026-03-23
---

# Phase 09 Plan 01: Candidates REST Endpoint Summary

**CandidatesModule with GET /candidates supporting search (q), five filters (all/high-score/available/referred/duplicates), and computed ai_score + is_duplicate fields from nested Prisma relations**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-23T16:45:00Z
- **Completed:** 2026-03-23T16:46:55Z
- **Tasks:** 2 (Task 1 TDD + Task 2 module wiring)
- **Files modified:** 4

## Accomplishments

- CandidatesService.findAll() with full q search (ILIKE on fullName/email/currentRole) and 5 filter modes
- GET /candidates controller endpoint with q and filter query params
- CandidatesModule wired with PrismaModule, controller, and service
- 8 unit tests passing (TDD: RED then GREEN) covering all filter modes, ai_score derivation, and is_duplicate

## Task Commits

Each task was committed atomically:

1. **Task 1: CandidatesService with findAll(q, filter)** - `6356e53` (feat)
2. **Task 2: CandidatesController and CandidatesModule** - `f0acd74` (feat)

_Note: Task 1 used TDD — test file written before implementation._

## Files Created/Modified

- `src/candidates/candidates.service.ts` - findAll(q?, filter?) with WHERE building, Prisma select, and field mapping
- `src/candidates/candidates.service.spec.ts` - 8 unit tests covering all behaviors (TDD)
- `src/candidates/candidates.controller.ts` - GET /candidates with @Query('q') and @Query('filter')
- `src/candidates/candidates.module.ts` - NestJS module importing PrismaModule

## Decisions Made

- Post-query filter for `high-score`: `ai_score` is a derived field computed from nested scores in JS after the DB query. Pushing this filter into Prisma WHERE would require a subquery or raw SQL — post-query filter is simpler and correct at this scale (~500 CVs/month).
- `import type CandidateFilter` in the controller to satisfy TypeScript's `isolatedModules + emitDecoratorMetadata` constraint — type-only imports cannot appear in decorated function signatures as value imports.
- `PrismaModule` imported explicitly in `CandidatesModule` even though it is decorated `@Global()` — keeps the module self-contained and avoids hidden dependency on global registration order.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed import type for CandidateFilter in controller**
- **Found during:** Task 2 (CandidatesController creation)
- **Issue:** `CandidateFilter` imported as a value in a decorated function signature caused TS1272 error with `isolatedModules: true` and `emitDecoratorMetadata: true`
- **Fix:** Changed to `import type { CandidateFilter }` in `candidates.controller.ts`
- **Files modified:** `src/candidates/candidates.controller.ts`
- **Verification:** `npx tsc --noEmit` returned 0 errors
- **Committed in:** `f0acd74` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - TypeScript compilation bug)
**Impact on plan:** Necessary to compile cleanly. No behavior change — type-only import.

## Issues Encountered

None beyond the auto-fixed TypeScript import issue.

## Known Stubs

None — all data flows from real Prisma queries. `ai_score` and `is_duplicate` are computed from actual DB relations.

## Next Phase Readiness

- CandidatesModule ready to import into AppModule (09-03 plan handles AppModule wiring)
- Same NestJS module pattern established for 09-02 (jobs) and 09-03 (applications)
- GET /candidates functional once CandidatesModule is added to AppModule imports

---
*Phase: 09-create-client-facing-rest-api-endpoints*
*Completed: 2026-03-23*
