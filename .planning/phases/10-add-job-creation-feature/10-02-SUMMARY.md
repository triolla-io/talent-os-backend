---
phase: 10-add-job-creation-feature
plan: "02"
subsystem: jobs
tags: [zod, dto, service, tdd, prisma, nested-create, default-seeding]
dependency_graph:
  requires: ["10-01"]
  provides: ["src/jobs/dto/create-job.dto.ts", "JobsService.createJob()"]
  affects: ["src/jobs/jobs.service.ts", "src/jobs/jobs.service.spec.ts"]
tech_stack:
  added: []
  patterns: ["Zod schema composition", "Prisma nested create", "Application-level default seeding"]
key_files:
  created:
    - src/jobs/dto/create-job.dto.ts
    - src/jobs/dto/create-job.dto.spec.ts
  modified:
    - src/jobs/jobs.service.ts
    - src/jobs/jobs.service.spec.ts
decisions:
  - "Zod DTO with three exported schemas: HiringStageCreateSchema, ScreeningQuestionCreateSchema, CreateJobSchema — pure Zod, no class-transformer"
  - "Empty hiringStages [] treated as omitted — falls through to default seeding (D-07 loophole fix from quick task 260324-dvq)"
  - "responsibleUserId is z.string().nullable().optional() — no UUID validation per D-09 (no User model exists)"
metrics:
  duration: "~3 minutes"
  completed: "2026-03-24"
  tasks_completed: 2
  files_created: 2
  files_modified: 2
---

# Phase 10 Plan 02: Create Zod DTO and JobsService.createJob() Summary

**One-liner:** Zod DTO + `createJob()` with Prisma nested creates and application-level default stage seeding (4 default stages auto-seeded when caller omits hiringStages).

## What Was Built

### Task 1: `src/jobs/dto/create-job.dto.ts`

Zod schema file exporting:
- `HiringStageCreateSchema` — name, order, responsibleUserId (free text, not UUID), isCustom (defaults false)
- `ScreeningQuestionCreateSchema` — text, answerType enum (`yes_no|text|multiple_choice|file_upload`), required, knockout, order
- `CreateJobSchema` — title required (only required field), all others optional; hiringStages and screeningQuestions are optional arrays; requirements/mustHaveSkills/niceToHaveSkills/preferredOrgTypes default to `[]`
- Three inferred TypeScript types: `HiringStageCreateInput`, `ScreeningQuestionCreateInput`, `CreateJobDto`

13 tests created in `create-job.dto.spec.ts`.

### Task 2: `JobsService.createJob()` + 7 unit tests

`createJob(dto: CreateJobDto)` in `src/jobs/jobs.service.ts`:
- Gets tenantId from ConfigService
- If `dto.hiringStages` is present and non-empty: uses provided stages (each gets `tenantId` injected)
- If `dto.hiringStages` is omitted or empty `[]`: auto-seeds 4 defaults (Application Review, Screening, Interview, Offer — all with `isCustom: false`)
- Maps screeningQuestions with tenantId, defaults required/knockout to false, auto-assigns order by index+1 if not provided
- Calls `prisma.job.create` with full data and `include: { hiringStages: { orderBy: { order: 'asc' } }, screeningQuestions: { orderBy: { order: 'asc' } } }`

All 7 `it.todo` stubs in `jobs.service.spec.ts` replaced with passing tests.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Zod v4 error message for missing field differs from min() message**
- **Found during:** Task 1 GREEN phase
- **Issue:** Test expected `CreateJobSchema.parse({})` to throw `'Job title required'` but Zod v4 produces `'Invalid input: expected string, received undefined'` for missing required fields (the `min(1, ...)` message only fires when the string is present but too short)
- **Fix:** Updated test to check that `parse({})` throws (any error), and added a separate test that `parse({ title: '' })` throws `'Job title required'`
- **Files modified:** `src/jobs/dto/create-job.dto.spec.ts`
- **Commit:** 00755b0

## Test Results

| Suite | Tests | Todos | Status |
|-------|-------|-------|--------|
| create-job.dto.spec.ts | 13 | 0 | PASS |
| jobs.service.spec.ts | 13 | 0 | PASS |
| Full suite | 134 | 11 (pre-existing) | PASS |

## Commits

- `00755b0`: feat(10-02): create Zod DTO schema for POST /jobs
- `4571e93`: feat(10-02): add createJob() to JobsService with default stage seeding

## Known Stubs

None — `createJob()` is fully wired to Prisma. No placeholder data.

## Self-Check: PASSED
