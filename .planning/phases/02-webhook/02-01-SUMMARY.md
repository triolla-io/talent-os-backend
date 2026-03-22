---
phase: 02-webhook
plan: "01"
subsystem: webhooks
tags: [zod, dto, tdd, bullmq, ingestion, testing]
dependency_graph:
  requires: []
  provides:
    - PostmarkPayloadSchema (Zod DTO for Postmark inbound payload)
    - PostmarkAttachmentSchema (Attachment type with optional Content)
    - IngestionProcessor stub (@Processor ingest-email queue)
    - IngestionModule (BullMQ queue registration)
    - Failing spec files for guard, service, controller (RED phase for 02-02)
  affects:
    - src/webhooks/dto/postmark-payload.dto.ts
    - src/webhooks/guards/postmark-auth.guard.spec.ts
    - src/webhooks/webhooks.service.spec.ts
    - src/webhooks/webhooks.controller.spec.ts
    - src/ingestion/ingestion.processor.ts
    - src/ingestion/ingestion.module.ts
tech_stack:
  added:
    - "@nestjs/bullmq ^11.0.4 — NestJS integration wrapper for BullMQ"
  patterns:
    - "TDD: RED (spec) then GREEN (impl) for DTO"
    - "Zod schema inference for TypeScript types"
    - "WorkerHost extension pattern for BullMQ processor"
key_files:
  created:
    - src/webhooks/dto/postmark-payload.dto.ts
    - src/webhooks/dto/postmark-payload.dto.spec.ts
    - src/webhooks/guards/postmark-auth.guard.spec.ts
    - src/webhooks/webhooks.service.spec.ts
    - src/webhooks/webhooks.controller.spec.ts
    - src/ingestion/ingestion.processor.ts
    - src/ingestion/ingestion.module.ts
  modified:
    - package.json (added @nestjs/bullmq)
    - package-lock.json
decisions:
  - "Used @nestjs/bullmq for IngestionModule to follow NestJS patterns (not raw bullmq Queue injection)"
  - "Spec files test against unimplemented modules (expected RED) — implementations added in 02-02"
  - "Content field is optional on PostmarkAttachmentDto for blob-stripping friendliness"
metrics:
  duration: "3 minutes"
  completed: "2026-03-22"
  tasks_completed: 3
  files_created: 7
  files_modified: 2
---

# Phase 02 Plan 01: Webhook Type Contracts and Spec Scaffolds Summary

Zod DTO for Postmark inbound payload with full attachment metadata typing, 3 failing spec files defining guard/service/controller behavior (RED phase), and IngestionProcessor stub registered on ingest-email queue.

## Tasks Completed

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 | Create PostmarkPayloadDto with Zod schema (TDD) | 3b67170 | Complete (GREEN) |
| 2 | Create failing test specs for guard, service, and controller | ea6cd22 | Complete (RED by design) |
| 3 | Create IngestionModule + IngestionProcessor stub | 340b4f7 | Complete |

## What Was Built

### Task 1: PostmarkPayloadDto (TDD - GREEN)

`src/webhooks/dto/postmark-payload.dto.ts` exports:
- `PostmarkAttachmentSchema` — attachment with optional `Content` field
- `PostmarkPayloadSchema` — full Postmark inbound payload with `Attachments` defaulting to `[]`
- `PostmarkPayloadDto` and `PostmarkAttachmentDto` TypeScript types inferred from schemas

8 tests pass covering: MessageID rejection, non-email From rejection, missing Attachments default, optional Content, full valid payloads.

### Task 2: Failing Spec Files (RED Phase)

Three spec files written with expected behavior for Plan 02-02 implementations:

- `postmark-auth.guard.spec.ts` — 3 tests for HTTP Basic Auth guard (missing header, wrong password, correct credentials)
- `webhooks.service.spec.ts` — 6 tests for idempotency logic, retry config, attachment blob stripping, D-01 failure behavior
- `webhooks.controller.spec.ts` — 2 tests for POST /webhooks/email and GET /health endpoints

All 3 files fail with "Cannot find module" — implementations added in 02-02.

### Task 3: IngestionProcessor + IngestionModule

- `IngestionProcessor` — `@Processor('ingest-email')` extends `WorkerHost`; logs MessageID; real logic Phase 3
- `IngestionModule` — registers `BullModule.registerQueue({ name: 'ingest-email' })` for use in `WorkerModule`
- Installed `@nestjs/bullmq ^11.0.4` as new dependency

## Verification Results

- `npx jest src/webhooks/dto/postmark-payload.dto.spec.ts --no-coverage` → 8 tests PASS
- `npx jest src/webhooks/guards/postmark-auth.guard.spec.ts` → FAIL (Cannot find module './postmark-auth.guard') — expected
- `npx jest src/webhooks/webhooks.service.spec.ts` → FAIL (Cannot find module './webhooks.service') — expected
- `npx tsc --noEmit` → No errors in ingestion/ directory

## Deviations from Plan

None — plan executed exactly as written.

The only addition: installed `@nestjs/bullmq` which the plan task explicitly said to do if not present.

## Known Stubs

`src/ingestion/ingestion.processor.ts` — `process()` method is a stub that only logs. This is intentional: real email parsing logic is out of scope for this plan and will be implemented in Phase 3.

## Self-Check

- [x] `src/webhooks/dto/postmark-payload.dto.ts` — exists, contains `PostmarkPayloadSchema`, `PostmarkAttachmentSchema`, `PostmarkPayloadDto`
- [x] `src/webhooks/dto/postmark-payload.dto.spec.ts` — exists, 8 tests pass
- [x] `src/webhooks/guards/postmark-auth.guard.spec.ts` — exists, fails as expected
- [x] `src/webhooks/webhooks.service.spec.ts` — exists, fails as expected
- [x] `src/webhooks/webhooks.controller.spec.ts` — exists, fails as expected
- [x] `src/ingestion/ingestion.processor.ts` — exists, contains `@Processor('ingest-email')`
- [x] `src/ingestion/ingestion.module.ts` — exists, contains `BullModule.registerQueue`
- [x] Commits: 3b67170, ea6cd22, 340b4f7 — all present
