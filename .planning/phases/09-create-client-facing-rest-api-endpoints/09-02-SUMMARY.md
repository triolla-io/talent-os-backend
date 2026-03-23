---
phase: 09-create-client-facing-rest-api-endpoints
plan: "02"
subsystem: api
tags: [nestjs, prisma, jobs, applications, rest-api, typescript, tdd]

requires:
  - phase: 01-foundation
    provides: NestJS app structure, PrismaModule (global), ConfigModule (global)
  - phase: 09-01
    provides: CandidatesModule pattern (module, controller, service with snake_case mapping)

provides:
  - JobsService with findAll() returning { jobs[], total } with candidate_count per job
  - JobsController exposing GET /jobs
  - JobsModule importable into AppModule
  - ApplicationsService with findAll() returning { applications[] } with nested candidate + ai_score
  - ApplicationsController exposing GET /applications
  - ApplicationsModule importable into AppModule

affects:
  - 09-03 (AppModule wiring — imports JobsModule and ApplicationsModule)

tech-stack:
  added: []
  patterns:
    - Prisma relation count aggregation (_count.applications) for candidate_count field
    - Post-query MAX derivation for ai_score (Math.max(...scores)) with null guard on empty array
    - Nested Prisma include with select for candidate fields (candidate + scores relations)
    - Snake_case response mapping: Prisma camelCase fields mapped in service layer, not controller

key-files:
  created:
    - src/jobs/jobs.service.ts
    - src/jobs/jobs.service.spec.ts
    - src/jobs/jobs.controller.ts
    - src/jobs/jobs.module.ts
    - src/applications/applications.service.ts
    - src/applications/applications.service.spec.ts
    - src/applications/applications.controller.ts
    - src/applications/applications.module.ts
  modified: []

key-decisions:
  - "Prisma _count.applications for candidate_count — relation count aggregation avoids N+1 and is computed in DB"
  - "ai_score = Math.max(...scores) computed in JS after findMany — avoids raw SQL subquery; null when scores empty"
  - "No status filter on GET /jobs — returns all jobs (active/draft/paused/closed) per PROTOCOL.md"
  - "No stage filter on GET /applications — returns all applications regardless of stage per PROTOCOL.md"
  - "PrismaModule imported explicitly in each module even though @Global() — keeps modules self-contained"

patterns-established:
  - "Relation count: use _count.select in Prisma include, map to snake_case field in service layer"
  - "Nested include with select: include relation then select only needed fields to minimize payload"
  - "Derived score: compute MAX in JS post-query with null guard for empty arrays"

requirements-completed:
  - RAPI-01

duration: 5min
completed: 2026-03-23
---

# Phase 09 Plan 02: Jobs and Applications REST Endpoints Summary

**JobsModule (GET /jobs with candidate_count via Prisma _count) and ApplicationsModule (GET /applications with nested candidate object and ai_score=MAX(scores)) — both scoped to TENANT_ID**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-23T17:04:06Z
- **Completed:** 2026-03-23T17:09:00Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 8

## Accomplishments

- JobsService.findAll() returns { jobs[], total } with snake_case fields and candidate_count from Prisma relation count aggregation
- ApplicationsService.findAll() returns { applications[] } with nested candidate object including ai_score = MAX(scores)
- 12 unit tests total across both suites (6 per service, TDD: RED then GREEN)
- TypeScript compiles clean (0 errors) for all 8 new files

## Task Commits

Each task was committed atomically:

1. **Task 1: Create JobsService, JobsController, JobsModule** - `dfe2fe2` (feat)
2. **Task 2: Create ApplicationsService, ApplicationsController, ApplicationsModule** - `833aac5` (feat)

_Note: Both tasks used TDD — test files written and confirmed RED before implementation._

## Files Created/Modified

- `src/jobs/jobs.service.ts` - findAll() with Prisma _count.applications mapped to candidate_count
- `src/jobs/jobs.service.spec.ts` - 6 unit tests: snake_case fields, candidate_count, total, no status filter, tenantId WHERE
- `src/jobs/jobs.controller.ts` - GET /jobs controller delegating to JobsService
- `src/jobs/jobs.module.ts` - NestJS module importing PrismaModule
- `src/applications/applications.service.ts` - findAll() with nested candidate include + ai_score=MAX(scores)
- `src/applications/applications.service.spec.ts` - 6 unit tests: shape, snake_case, nested candidate, ai_score MAX, null score, tenantId WHERE
- `src/applications/applications.controller.ts` - GET /applications controller delegating to ApplicationsService
- `src/applications/applications.module.ts` - NestJS module importing PrismaModule

## Decisions Made

- **Prisma _count for candidate_count:** Relation count aggregation computed in DB via `_count: { select: { applications: true } }` — avoids N+1 query and is the recommended Prisma pattern.
- **ai_score in JS post-query:** `Math.max(...allScores)` with null guard for empty arrays. Pushing this into a Prisma aggregate subquery would require raw SQL; at 500 CVs/month this is simpler and correct.
- **No filters:** Both endpoints return all records regardless of status/stage per PROTOCOL.md spec — filtering is the client's responsibility.
- **PrismaModule explicit import:** Even though PrismaModule is `@Global()`, importing it explicitly in each module keeps modules self-contained.

## Deviations from Plan

None — plan executed exactly as written. Test assertions expanded slightly (6 tests per service vs 4-6 planned) to cover more field-level assertions in a single test case.

## Issues Encountered

None.

## Known Stubs

None — all data flows from real Prisma queries. `candidate_count` uses DB relation count, `ai_score` computed from actual `scores` relation.

## Next Phase Readiness

- JobsModule and ApplicationsModule ready to import into AppModule (09-03 plan)
- GET /api/jobs and GET /api/applications will be functional once 09-03 wires all three modules into AppModule
- Same NestJS module pattern consistent across CandidatesModule (09-01), JobsModule, and ApplicationsModule

---
*Phase: 09-create-client-facing-rest-api-endpoints*
*Completed: 2026-03-23*
