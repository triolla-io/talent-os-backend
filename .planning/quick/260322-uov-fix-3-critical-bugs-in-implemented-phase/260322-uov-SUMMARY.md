---
phase: quick-260322-uov
plan: 01
subsystem: ingestion, webhooks
tags: [bugfix, data-loss, retry, race-condition, bullmq, prisma]
dependency_graph:
  requires: []
  provides: [BUG-CV-LOSS-fixed, BUG-RETRY-fixed, BUG-RACE-fixed]
  affects: [ingestion-processor, webhooks-service]
tech_stack:
  added: []
  patterns:
    - "BullMQ jobId deduplication for idempotent job enqueue"
    - "Prisma P2002 catch pattern for concurrent unique constraint races"
    - "Upload-before-extract ordering for data durability"
key_files:
  created: []
  modified:
    - src/ingestion/ingestion.processor.ts
    - src/ingestion/ingestion.processor.spec.ts
    - src/webhooks/webhooks.service.ts
    - src/webhooks/webhooks.service.spec.ts
decisions:
  - "Re-throw on transient extraction failure (not permanent empty-fullName failure) to enable BullMQ retry"
  - "Check raw .code === 'P2002' without importing Prisma ClientKnownRequestError to avoid extra dependency"
  - "Upload before extract so R2 file is persisted regardless of AI failure"
metrics:
  duration: "2 minutes"
  completed: "2026-03-22"
  tasks_completed: 3
  files_modified: 4
  tests_added: 5
  tests_total: 75
---

# Quick Task 260322-uov: Fix 3 Critical Bugs in Implemented Phase

**One-liner:** Fixed CV data loss (upload-before-extract reorder), broken BullMQ retry (re-throw instead of return), and duplicate candidate race condition (jobId deduplication + P2002 catch).

## Objective

Three correctness bugs in the ingestion pipeline were causing data loss and duplicate records. All three were fixed with targeted, surgical changes and confirmed with new tests.

## Tasks Completed

| # | Task | Commit | Files Modified |
|---|------|--------|----------------|
| 1 | Fix processor pipeline order and retry behavior | 31ba810 | ingestion.processor.ts, ingestion.processor.spec.ts |
| 2 | Fix race condition deduplication in WebhooksService | 9ee0841 | webhooks.service.ts, webhooks.service.spec.ts |
| 3 | Full test suite green check | (no commit — observation only) | — |

## Bugs Fixed

### BUG-CV-LOSS: CV file lost on AI extraction failure

**Root cause:** `storageService.upload()` was called AFTER `extractionAgent.extract()`. If the AI call threw, the catch block returned early and the upload never happened — the CV file was permanently lost.

**Fix:** Moved `storageService.upload()` to BEFORE `extractionAgent.extract()`. The file is now persisted in R2 regardless of AI outcome.

**Files:** `src/ingestion/ingestion.processor.ts`

---

### BUG-RETRY: Transient AI failures not retried by BullMQ

**Root cause:** The catch block for `extractionAgent.extract()` updated status to `failed` then called `return`. BullMQ only retries a job if the worker throws — returning normally signals success to the queue.

**Fix:** Changed the final `return` to `throw err` in the extraction catch block. The empty-fullName block still uses `return` (permanent failure — no retry).

**Files:** `src/ingestion/ingestion.processor.ts`

---

### BUG-RACE: Simultaneous webhooks for same MessageID create duplicate candidates

**Two-part fix:**

**Part A — BullMQ jobId deduplication:** Added `jobId: messageId` to both `queue.add()` calls (re-enqueue path + fresh enqueue path). BullMQ silently ignores an `add()` call if a job with that ID already exists — the second concurrent request is a no-op at the queue level.

**Part B — Prisma P2002 catch:** Wrapped `prisma.emailIntakeLog.create()` in a try/catch. If two concurrent requests both pass the `findUnique` check before either inserts, the second one hits a unique constraint (P2002). On P2002, log and return `{ status: 'queued' }` gracefully. Non-P2002 errors still propagate.

**Files:** `src/webhooks/webhooks.service.ts`

## Tests Added

| Test | File | Type |
|------|------|------|
| `upload is called before extraction even when extraction fails` | ingestion.processor.spec.ts | New |
| `4-02-01` updated: `rejects.toThrow('LLM timeout')` instead of `resolves` | ingestion.processor.spec.ts | Updated |
| `uses messageId as jobId on fresh enqueue` | webhooks.service.spec.ts | New |
| `uses messageId as jobId on re-enqueue (pending status)` | webhooks.service.spec.ts | New |
| `handles concurrent P2002 unique constraint gracefully` | webhooks.service.spec.ts | New |
| `rethrows non-P2002 db errors` | webhooks.service.spec.ts | New |
| Existing retry config test updated to also assert `jobId` | webhooks.service.spec.ts | Updated |

## Test Results

- **Before:** 70 tests / 11 suites
- **After:** 75 tests / 11 suites
- **New tests:** 5 added, 2 assertions updated
- **Failures:** 0

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all changes wire real behavior. No placeholder data flows to any consumer.

## Self-Check: PASSED

- [x] `src/ingestion/ingestion.processor.ts` exists and contains `storageService.upload` before `extractionAgent.extract`
- [x] `src/webhooks/webhooks.service.ts` exists and contains `jobId: messageId` in both `queue.add` calls and P2002 catch
- [x] Commit `31ba810` exists
- [x] Commit `9ee0841` exists
- [x] Full test suite: 75 tests, 0 failures
