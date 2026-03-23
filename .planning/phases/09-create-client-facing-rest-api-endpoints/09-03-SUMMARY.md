---
phase: 09-create-client-facing-rest-api-endpoints
plan: "03"
subsystem: api
tags: [nestjs, cors, rest-api, app-module, main-ts, typescript]

requires:
  - phase: 09-01
    provides: CandidatesModule (GET /candidates, service, controller, module)
  - phase: 09-02
    provides: JobsModule (GET /jobs) and ApplicationsModule (GET /applications)
  - phase: 01-foundation
    provides: NestJS app structure, PrismaModule (global), ConfigModule (global)

provides:
  - CORS enabled for http://localhost:5173 in main.ts via app.enableCors
  - Global /api prefix applied via app.setGlobalPrefix('api')
  - CandidatesModule, JobsModule, ApplicationsModule wired into AppModule
  - Three live endpoints at /api/candidates, /api/jobs, /api/applications

affects:
  - Any future phase adding new NestJS modules (must import into AppModule)
  - Recruiter UI (can now call /api/* endpoints with CORS from localhost:5173)

tech-stack:
  added: []
  patterns:
    - app.enableCors before app.listen — CORS must be set before listening
    - app.setGlobalPrefix('api') before app.listen — prefix must be set before listening
    - Three-module import pattern in AppModule for REST endpoint modules

key-files:
  created: []
  modified:
    - src/main.ts
    - src/app.module.ts

key-decisions:
  - "D-01: app.enableCors({ origin: 'http://localhost:5173' }) — hardcoded MVP, no env var"
  - "D-02: app.setGlobalPrefix('api') — called before app.listen per NestJS docs"
  - "D-03: Restored src/candidates/ files lost from HEAD tree — they were committed in f0acd74 but dropped from 01ca242 docs commit tree"

patterns-established:
  - "Global prefix + CORS pattern: set both in main.ts between useBodyParser and app.listen"
  - "Module wiring: new REST modules added to AppModule imports array at end of list"

requirements-completed:
  - RAPI-01

duration: 5min
completed: 2026-03-23
---

# Phase 09 Plan 03: Wire App — CORS, Global Prefix, and Module Imports Summary

**CORS (localhost:5173) + /api global prefix activated in main.ts; CandidatesModule, JobsModule, and ApplicationsModule wired into AppModule — all three REST endpoints now live**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-23T17:10:00Z
- **Completed:** 2026-03-23T17:15:00Z
- **Tasks:** 1 automated + 1 human-verify checkpoint (pending)
- **Files modified:** 6 (2 modified + 4 restored)

## Accomplishments

- Added `app.enableCors({ origin: 'http://localhost:5173' })` and `app.setGlobalPrefix('api')` to main.ts
- Imported CandidatesModule, JobsModule, ApplicationsModule into AppModule
- Restored src/candidates/ files (4 files) that were inadvertently dropped from HEAD tree in docs commit 01ca242
- 115 tests passing across 16 suites, 0 TypeScript errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Add CORS + global prefix to main.ts; import new modules into AppModule** - `68f760a` (feat)

_Note: Checkpoint task (human-verify) pending — server startup and endpoint verification by user._

## Files Created/Modified

- `src/main.ts` - Added app.enableCors and app.setGlobalPrefix between useBodyParser and app.listen
- `src/app.module.ts` - Added imports for CandidatesModule, JobsModule, ApplicationsModule
- `src/candidates/candidates.service.ts` - Restored from git history (lost from HEAD tree)
- `src/candidates/candidates.controller.ts` - Restored from git history (lost from HEAD tree)
- `src/candidates/candidates.module.ts` - Restored from git history (lost from HEAD tree)
- `src/candidates/candidates.service.spec.ts` - Restored from git history (lost from HEAD tree)

## Decisions Made

- CORS origin hardcoded to `http://localhost:5173` (D-01 from CONTEXT.md — no env var needed for MVP)
- Global prefix set to `api` before `app.listen()` (D-02 — NestJS requires this ordering)
- Candidates files restored from commit `f0acd74` via `git checkout f0acd74 -- src/candidates/` — the 09-01 docs commit (`01ca242`) staged only planning files and its tree excluded the candidates source files

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restored src/candidates/ files missing from HEAD tree**
- **Found during:** Task 1 (verifying module export names before editing AppModule)
- **Issue:** `src/candidates/` directory did not exist on disk. Files were committed in `f0acd74` (feat: CandidatesController and CandidatesModule) but dropped from the tree in `01ca242` (docs: complete CandidatesModule plan). The docs commit staged only planning files; the candidates source files were absent from its tree, effectively deleting them from HEAD without an explicit delete commit.
- **Fix:** `git checkout f0acd74 -- src/candidates/` to restore all 4 files. Then staged them as part of the Task 1 commit.
- **Files modified:** src/candidates/candidates.service.ts, src/candidates/candidates.controller.ts, src/candidates/candidates.module.ts, src/candidates/candidates.service.spec.ts
- **Verification:** `npx tsc --noEmit` 0 errors; `npx jest` 115 tests passing
- **Committed in:** `68f760a` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking issue)
**Impact on plan:** Necessary to proceed — AppModule cannot import CandidatesModule if its files don't exist. No behavior change to the candidates implementation itself.

## Issues Encountered

The git tree anomaly: 09-01 plan committed candidates files in two commits (`6356e53` for service, `f0acd74` for controller/module). The subsequent `docs(09-01)` commit (`01ca242`) only staged planning files using selective `git add`, which resulted in its tree missing the candidates source files. This effectively deleted them from HEAD without any delete commit appearing in `git log --diff-filter=D`. Restored via `git checkout f0acd74 -- src/candidates/`.

## Known Stubs

None — all endpoints route to real Prisma queries. No hardcoded data or placeholders.

## Next Phase Readiness

- All three REST endpoints are wired and ready for human verification
- GET /api/candidates, GET /api/jobs, GET /api/applications accessible once server starts
- CORS header allows requests from http://localhost:5173
- Existing webhook endpoint now accessible at /api/webhooks/health (global prefix applied)

---
*Phase: 09-create-client-facing-rest-api-endpoints*
*Completed: 2026-03-23*
