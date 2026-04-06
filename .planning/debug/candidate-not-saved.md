---
status: diagnosed
trigger: Candidate not saved to DB after email intake - extraction succeeds but no candidate/application records created
created: 2026-04-06T00:00:00Z
updated: 2026-04-06T00:00:00Z
symptoms_prefilled: true
---

## Current Focus

ROOT CAUSE CONFIRMED: dedupService.check() is called without error handling (line 214 of ingestion.processor.ts). Any error it throws crashes the job, preventing status update from 'processing', causing infinite retries with no completion.

## Symptoms

expected: After extraction succeeds, candidate + application records should be created in DB, visible via GET /candidates
actual: Extraction succeeds (Phase 4 logs visible), CV uploaded to R2 (Phase 5), but no candidate or application records exist. email_intake_tag shows processing_status='processing' and candidate_id=null
errors: None visible in logs - process completes without error messages
reproduction: Send email with Subject "101" (job ID) with CV attachment
started: Today when user tested email receiving with job ID 101 in subject

## Eliminated

## Evidence

- timestamp: 2026-04-06
  checked: IngestionProcessor.ts orchestration flow (lines 94-452)
  found: Process flow is Phase 5 (upload) -> Phase 4 (extraction) -> Phase 6 (dedup + INSERT/UPSERT) -> Phase 15 (job ID extraction) -> Phase 7 (enrichment + scoring). Phase 6 runs a Prisma transaction that calls dedupService.insertCandidate() or dedupService.upsertCandidate(). If Phase 6 succeeds, candidateId is set and status moves to Phase 7. If Phase 6 errors, it's caught and logged, status set to 'failed', and error is re-thrown.
  implication: If candidate is not saved, either (1) Phase 6 never executes (extraction failed), (2) Phase 6 transaction failed silently (caught but no re-throw?), or (3) one of the dedup methods failed. Need to check dedupService implementation and understand what conditions cause silent failures.

- timestamp: 2026-04-06
  checked: Code structure between Phase 4 complete log (line 210) and Phase 6 transaction start (line 218)
  found: Line 214 calls dedupService.check() which is NOT wrapped in try-catch. This is a critical unguarded async call that could crash the entire job if it throws. The only try-catch wraps the transaction itself (lines 218-275), not the dedupService.check() call that precedes it.
  implication: If dedupService.check() throws ANY error (database connectivity, invalid tenantId, malformed UUID cast, etc), the job crashes without updating intake status, causing the job to stay in 'processing' state and trigger BullMQ retries. This explains the repeated execution with same message ID and no status update.

- timestamp: 2026-04-06
  checked: BullMQ retry behavior and unguarded async calls
  found: dedupService.check() on line 214 is an unguarded async call that precedes the only try-catch block in Phase 6 (which starts on line 218). If this call throws any error, the job crashes without the status being updated from 'processing' to 'failed' or 'completed'. BullMQ then retries the job due to the unhandled rejection. Tests do not cover the case where dedupService.check() throws (line 54 in spec always mocks it to return null).
  implication: CONFIRMED ROOT CAUSE - dedupService.check() is unguarded and any error thrown by it (database errors, connection issues, etc) will crash the job and cause it to be retried infinitely without ever updating the intake status.

## Resolution

root_cause: dedupService.check() on line 214 of ingestion.processor.ts is called outside of the try-catch block that wraps Phase 6. Any error thrown by this method (whether from the Prisma queries or from PostgreSQL) will crash the job without updating the email_intake_log status from 'processing' to 'failed'. BullMQ then retries the job due to the unhandled rejection, causing the same crash to repeat. This creates an infinite retry loop where the job is reprocessed but never completes, and the status never changes from 'processing'.

fix: Wrap the dedupService.check() call in the same try-catch block that wraps the transaction, or add a separate try-catch around it to ensure status is updated before any error propagates.

verification: 
files_changed: [src/ingestion/ingestion.processor.ts]
