---
phase: quick-260324-cbs
plan: 01
subsystem: ingestion
tags: [openrouter, zod, extraction, dedup, schema-rename]

# Dependency graph
requires:
  - phase: quick-260324-agv
    provides: OpenRouter SDK integration and real AI extraction
  - phase: quick-260324-c3g
    provides: Clean extraction-agent.service.ts with isolated callAI() method
provides:
  - All unstaged changes from SDK swap, schema rename, and Zod v4 fix committed atomically
  - PROTOCOL.md API contract document
affects: [ingestion, dedup, webhooks, candidates, applications]

# Tech tracking
tech-stack:
  added: ["@openrouter/sdk (replaced @ai-sdk/openai)"]
  patterns: ["CandidateExtract schema uses snake_case field names (full_name, ai_summary)"]

key-files:
  created: [PROTOCOL.md]
  modified:
    - package.json
    - package-lock.json
    - src/ingestion/services/extraction-agent.service.spec.ts
    - src/ingestion/services/extraction-agent.service.test-helpers.ts
    - src/ingestion/ingestion.processor.ts
    - src/ingestion/ingestion.processor.spec.ts
    - src/dedup/dedup.service.ts
    - src/dedup/dedup.service.spec.ts
    - src/webhooks/dto/postmark-payload.dto.ts
    - .planning/config.json
    - .planning/quick/260324-agv-replace-mock-ai-extraction-with-openrout/260324-agv-SUMMARY.md

key-decisions:
  - "CandidateExtract schema uses snake_case (full_name, ai_summary) to match Prisma column conventions"
  - "currentRole, yearsExperience, source removed from extraction schema — deferred to Phase 7"
  - "z.email() used instead of z.string().email() for Zod v4 compatibility"

patterns-established:
  - "Schema field names in snake_case for extracted AI data matching DB columns"
  - "OpenRouter mock pattern: mockCallModel + mockGetText jest.fn() hoisted above jest.mock()"

requirements-completed: []

# Metrics
duration: 8min
completed: 2026-03-24
---

# Quick Task 260324-cbs: Commit Unstaged Changes Summary

**4 atomic commits landing the @openrouter/sdk swap, CandidateExtract snake_case field rename, Zod v4 email fix, and PROTOCOL.md API contract document**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-24T06:52:00Z
- **Completed:** 2026-03-24T07:00:00Z
- **Tasks:** 4
- **Files modified:** 12 (including 1 new untracked file)

## Accomplishments

- Committed package.json + package-lock.json replacing `@ai-sdk/openai` with `@openrouter/sdk`
- Updated extraction-agent spec and test-helpers to use new snake_case field names (full_name, ai_summary) and new OpenRouter mock shape
- Updated all call sites in IngestionProcessor and DedupService to use renamed schema fields; currentRole/yearsExperience set to null explicitly
- Fixed Zod v4 compatibility: PostmarkPayloadSchema now uses `z.email()` instead of deprecated `z.string().email()`
- Committed PROTOCOL.md (new file) with MVP REST API contract for client, and planning config updates

## Task Commits

1. **Task 1: SDK swap and schema rename** - `de568c1` (refactor)
2. **Task 2: Dedup and processor call site updates** - `9931a0e` (fix)
3. **Task 3: Zod v4 email validator fix** - `a5760a0` (fix)
4. **Task 4: Planning/config and docs** - `a5c32c7` (docs)

## Files Created/Modified

- `package.json` - Replaced @ai-sdk/openai with @openrouter/sdk
- `package-lock.json` - Lock file updated for SDK swap
- `src/ingestion/services/extraction-agent.service.spec.ts` - New mock shape for @openrouter/sdk; field names updated to full_name/ai_summary
- `src/ingestion/services/extraction-agent.service.test-helpers.ts` - mockCandidateExtract updated to snake_case fields
- `src/ingestion/ingestion.processor.ts` - Uses full_name/ai_summary; currentRole/yearsExperience set to null
- `src/ingestion/ingestion.processor.spec.ts` - Mocks use new field names; jest.mock('@openrouter/sdk') added
- `src/dedup/dedup.service.ts` - candidate.full_name used instead of candidate.fullName
- `src/dedup/dedup.service.spec.ts` - Mock data uses full_name
- `src/webhooks/dto/postmark-payload.dto.ts` - z.email() replaces z.string().email()
- `.planning/config.json` - Research flags enabled; ui_phase gate disabled
- `.planning/quick/260324-agv-.../260324-agv-SUMMARY.md` - Cosmetic quote/table cleanup
- `PROTOCOL.md` - New: MVP REST API contract document for client

## Decisions Made

- `extraction-agent.service.ts` was already committed in quick task 260324-c3g; only the spec and test-helpers files were staged in Task 1 (correct behavior — those were the actual unstaged files).
- `fullName` references remaining in `candidates.service.ts` and `applications.service.ts` are Prisma DB column names (not extraction schema fields) — these are correct and were not changed.

## Deviations from Plan

The plan listed `extraction-agent.service.ts` as part of Task 1's file set, but that file had already been committed in quick task 260324-c3g (`4977b32`). Only the 4 remaining files from that group were staged: package.json, package-lock.json, extraction-agent.service.spec.ts, extraction-agent.service.test-helpers.ts. The commit message was adjusted to reflect the actual files committed. The logical unit is identical — the commit is accurate.

**Total deviations:** 1 minor (file already committed from prior task — staged 4 of 5 planned files)
**Impact on plan:** None — all changes landed correctly. Working tree is clean.

## Issues Encountered

None — all 4 commits succeeded cleanly. 114 tests pass across 16 suites post-commit.

## Known Stubs

- `extractDeterministically()` private method in `extraction-agent.service.ts` is dead code (unreachable). Nothing calls it. It was noted in the plan as intentional — left for reference. Not a data-flow stub.

## Next Phase Readiness

- Working tree is clean, 114 tests passing
- Extraction pipeline uses real OpenRouter with graceful fallback
- PROTOCOL.md documents the REST API contract for Phase 9 client-facing endpoints

---
*Phase: quick-260324-cbs*
*Completed: 2026-03-24*

## Self-Check: PASSED

- PROTOCOL.md: FOUND
- de568c1 commit: FOUND
- 9931a0e commit: FOUND
- a5760a0 commit: FOUND
- a5c32c7 commit: FOUND
- Working tree: Clean (only untracked quick task directory)
- Tests: 114 passed, 0 failed
