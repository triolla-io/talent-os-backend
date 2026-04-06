# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## job-edit-constraint — PostgreSQL constraint definition mismatch with API specification
- **Date:** 2026-03-25
- **Error patterns:** constraint violation, jobs_status_check, check constraint violated, status field
- **Root cause:** PostgreSQL constraint was defined with 4 values ['active', 'draft', 'closed', 'paused'] but API_PROTOCOL_MVP.md specifies only 3 values ['draft', 'open', 'closed']. Application code correctly implements the API spec. When UI sends status='open', Prisma validation passes but database rejects with constraint violation.
- **Fix:** Migration 20260325090000_fix_job_status_constraint converts 'active' rows to 'open' and corrects the constraint to match API spec.
- **Files changed:** prisma/migrations/20260325090000_fix_job_status_constraint/migration.sql
---

## candidate-persistence-silent-failure — Phase 6 transaction errors swallowed by catch block preventing BullMQ retries
- **Date:** 2026-03-29
- **Error patterns:** extracted candidate data, no persistence, job reprocessed 3x, silent failure, no error logged, phase 6 transaction, catch block
- **Root cause:** Phase 6 transaction catch block at ingestion.processor.ts line 198-209 was catching database errors (constraint violations, connection losses, etc.) but returning early without re-throwing. This prevented BullMQ from detecting the failure and retrying. The job appeared successful to BullMQ even though candidate INSERT failed, so no automatic retry occurred through normal error propagation (though stalled job logic might have caused retries).
- **Fix:** Changed line 208 from `return;` to `throw err;` to re-throw transaction errors. Updated comment to clarify that transaction errors may be transient and BullMQ should retry.
- **Files changed:** src/ingestion/ingestion.processor.ts (line 208, re-throw transaction error; comment update)
---

## candidate-not-saved — PostgreSQL pg_trgm extension missing, blocking fuzzy duplicate detection
- **Date:** 2026-04-06
- **Error patterns:** extraction succeeds, no candidate saved, dedup check fails, similarity function, error 42883, function similarity does not exist
- **Root cause:** PostgreSQL extension pg_trgm was not installed in the database. The dedupService.check() method uses the similarity() function from pg_trgm (in dedup.service.ts lines 44-51) for fuzzy name matching in duplicate detection. Without the extension, the raw SQL query fails with PostgreSQL error 42883 "function similarity(text, unknown) does not exist". Although dedupService.check() is wrapped in try-catch (lines 215-227 in ingestion.processor.ts), the underlying database error prevented the candidate from being saved. The Prisma migrations never included CREATE EXTENSION pg_trgm or the required gin indexes on candidates(full_name, phone).
- **Fix:** Created Prisma migration 20260406153729_add_pg_trgm_extension with CREATE EXTENSION IF NOT EXISTS pg_trgm and GIN indexes on candidates(full_name) and candidates(phone) for fuzzy match performance. Migration is idempotent and safe to apply multiple times.
- **Files changed:** prisma/migrations/20260406153729_add_pg_trgm_extension/migration.sql
---

