---
phase: "04"
plan: "02"
subsystem: ingestion
tags: [ai-extraction, bullmq, nestjs, integration-tests]
dependency_graph:
  requires: ["04-01"]
  provides: ["ExtractionAgentService wired into IngestionProcessor", "fullName failure handling", "4 passing integration tests"]
  affects: ["src/ingestion/ingestion.processor.ts", "src/ingestion/ingestion.module.ts", "src/ingestion/ingestion.processor.spec.ts"]
tech_stack:
  added: []
  patterns: ["NestJS constructor injection", "BullMQ processor extension", "TDD integration test extension"]
key_files:
  modified:
    - src/ingestion/ingestion.processor.ts
    - src/ingestion/ingestion.module.ts
    - src/ingestion/ingestion.processor.spec.ts
decisions:
  - "Empty fullName treated as extraction failure (D-04, D-05): same failed status path as thrown error"
  - "ProcessingContext _context renamed to context now that Phase 4 consumes it inline"
metrics:
  duration: "162s"
  completed_date: "2026-03-22"
  tasks_completed: 2
  files_modified: 3
---

# Phase 04 Plan 02: Wire ExtractionAgentService into IngestionProcessor Summary

**One-liner:** ExtractionAgentService injected into IngestionProcessor via NestJS DI; both failure paths (throw + empty fullName) set processingStatus to 'failed'; 4 integration tests pass end-to-end.

## What Was Built

Wired the AI extraction layer into the ingestion pipeline. `IngestionProcessor.process()` now calls `extractionAgent.extract(fullText, suspicious)` after assembling `fullText` from email body and attachment text. Two failure paths guard downstream processing: if `extract()` throws or returns a result with empty `fullName`, the processor updates `email_intake_log.processingStatus` to `'failed'` and returns. On success, the extracted name is logged and the Phase 5 stub is in place.

`IngestionModule` now registers `ExtractionAgentService` in its providers array, satisfying NestJS DI for the worker process.

Two new integration tests cover:
- **4-02-01**: extraction throws → `processingStatus` set to `'failed'` (2 update calls total)
- **4-02-02**: extraction succeeds with `fullName: 'Jane Doe'` → only 1 update call (`'processing'`), no `'failed'` call

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | 5fa66dc | feat(04-02): wire ExtractionAgentService into IngestionProcessor and IngestionModule |
| Task 2 | a17ee63 | test(04-02): extend ingestion.processor.spec.ts with 2 extraction tests |

## Verification Results

- `npx tsc --noEmit` exits 0 (tsc clean)
- `npx jest --testPathPatterns="ingestion"` exits 0: **34 tests pass** (4 suites)
- `grep "extractionAgent.extract" src/ingestion/ingestion.processor.ts` returns 1 match (line 82)
- `grep "ExtractionAgentService" src/ingestion/ingestion.module.ts` returns 2 matches (import + providers)
- `grep -c "processingStatus.*failed" src/ingestion/ingestion.processor.ts` returns 2 (throw path + empty fullName path)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

- `ExtractionAgentService.extract()` is a deterministic mock (D-06) returning `'Jane Doe'` hardcoded. Real Anthropic Haiku call is commented out, to be activated in a follow-up task (Phase 4 plan 03 or later). This is intentional and documented in the service file.

## Self-Check: PASSED
