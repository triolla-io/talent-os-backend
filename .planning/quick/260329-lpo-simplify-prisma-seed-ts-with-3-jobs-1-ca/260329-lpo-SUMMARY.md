---
quick_task: 260329-lpo
title: Simplify prisma/seed.ts with 3 jobs, 1 candidate, 1 application
description: Reduce seed data to 4 tables (Tenant, Job, Candidate, Application); remove --tenant-only option
completed_at: "2026-03-29T12:15:00Z"
duration_minutes: 8
commits:
  - hash: 1cdda8e
    message: "chore(db): simplify seed.ts to 4 tables (tenant, 3 jobs, 1 candidate, 1 app)"
  - hash: a16eee9
    message: "chore(db): remove --tenant-only flag from package.json scripts"
---

# Quick Task 260329-lpo: Simplify Seed Data

**One-liner:** Reduced prisma/seed.ts from 700 to 189 lines with 3 fully-populated jobs, 1 candidate, 1 application — removing hiring stages, scores, and --tenant-only flag.

## What Was Done

### Task 1: Rewrite prisma/seed.ts with minimal data
✓ Reduced seed.ts from 700 lines to 189 lines (73% reduction)
✓ Kept Tenant (Triolla) with deterministic ID
✓ Kept 3 jobs with ALL schema fields populated:
  - Senior Software Engineer (SE, open)
  - Product Manager (PM, open)
  - Data Scientist (DS, open)

✓ Each job includes:
  - title, department, location, jobType, status
  - description, requirements, salaryRange, hiringManager
  - roleSummary, responsibilities, whatWeOffer
  - mustHaveSkills, niceToHaveSkills
  - expYearsMin, expYearsMax, preferredOrgTypes

✓ 1 Candidate: Yael Cohen (Senior Software Engineer)
  - fullName, email, phone, currentRole, location
  - yearsExperience (7), skills (TypeScript, Node.js, React, PostgreSQL, Docker)
  - source (direct), aiSummary (realistic profile)

✓ 1 Application: Yael → Senior Software Engineer job
  - Linking candidate to first job with stage='new'

✓ Removed:
  - 11 additional candidates (kept only 1)
  - All 40 hiring stage records
  - All 10 AI scores
  - 1 duplicate flag
  - buildStages() function
  - --tenant-only flag logic
  - Stage ID constants

### Task 2: Remove --tenant-only from package.json scripts
✓ Updated db:setup:local script: removed `--tenant-only` flag
✓ Verified --tenant-only removed from entire codebase
✓ package.json remains valid JSON

## Files Modified

| File | Changes | Lines |
|------|---------|-------|
| prisma/seed.ts | Complete rewrite, simplified schema | 700 → 189 |
| package.json | Removed --tenant-only from db:setup:local | 1 line |

## Verification Checklist

- [x] prisma/seed.ts is valid TypeScript (syntax checked)
- [x] File is 189 lines (vs. 700 baseline) — meets 150-300 target
- [x] Contains all 4 required tables: Tenant, Job (3x), Candidate (1x), Application (1x)
- [x] All 3 jobs have ALL schema fields populated (not just title + description)
- [x] 1 candidate has realistic but minimal data
- [x] 1 application links candidate to first job
- [x] `--tenant-only` removed from package.json scripts
- [x] `--tenant-only` does not appear in seed.ts at all
- [x] `--tenant-only` removed from entire codebase
- [x] Console output updated to reflect new data shape
- [x] package.json is valid JSON

## Success Criteria Met

- [x] seed.ts compiles without errors
- [x] seed.ts reduced from 700 to 189 lines
- [x] Only 4 tables seeded: Tenant, Job (3x), Candidate (1x), Application (1x)
- [x] All 3 jobs have ALL schema fields populated
- [x] 1 candidate has realistic but minimal data
- [x] 1 application links candidate to first job
- [x] `--tenant-only` removed from package.json scripts
- [x] `--tenant-only` does not appear in seed.ts
- [x] Console output reflects new data shape

## Deviations from Plan

None — plan executed exactly as written.

## Impact

**Development workflow improvements:**
- Seed completes faster (fewer DB writes)
- Database is lighter for testing
- Simpler mental model for understanding schema
- Easier to debug seed issues
- Reference data is cleaner for Phase 2 UI design

**Reference data preserved:**
- Realistic job descriptions and requirements
- Candidate profile showcasing good fit
- Foundation for Phase 2 recruiter UI planning

## Commits

| Hash | Message |
|------|---------|
| 1cdda8e | chore(db): simplify seed.ts to 4 tables (tenant, 3 jobs, 1 candidate, 1 app) |
| a16eee9 | chore(db): remove --tenant-only flag from package.json scripts |
