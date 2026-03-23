---
quick_task: 260323-d4s
date: 2026-03-23
status: complete
commits:
  - dcd4b2d
  - 6a9d372
files_modified:
  - src/dedup/dedup.service.ts
  - src/dedup/dedup.service.spec.ts
  - src/ingestion/ingestion.processor.ts
  - src/ingestion/ingestion.processor.spec.ts
tests: 86 passing (was 83 — 3 new tests added)
---

# 260323-d4s: Investigate and Fix 4 Reported Phase 6 Issues

**One-liner:** Fixed pg_trgm % operator (wrong threshold), inverted-name miss, and non-atomic DB writes; dismissed auto-merge and raw email false positives.

## Investigation Summary

Four issues were reported after Phase 6. Investigation was completed before this plan was written. Results:

### Issue 1 — Auto-merge on confidence 1.0 (DISMISSED)

Confidence 1.0 is only assigned on exact email match (`DedupService.check`, Step 1). Without a matching email, the pg_trgm fuzzy query returns `name_sim` from `similarity()` which is always `< 1.0`. Two candidates with the same name but no email can never produce `confidence === 1.0`. The UPSERT branch is only reachable when two submissions share an identical email — the correct "returning candidate" case. No code change needed.

### Issue 4 — Raw sourceEmail from Postmark (DISMISSED)

Postmark's `From` field in inbound webhook payloads is a bare email address (e.g. `sender@example.com`), not `"Name <email>"` display format. The Zod schema uses `z.string().email()` which correctly passes bare emails and would reject display format. `payload.From` passed to `insertCandidate` is always a clean email. No code change needed.

---

## Fixes Applied

### Issue 3a — pg_trgm default threshold (FIXED — commit dcd4b2d)

**Bug:** `DedupService.check()` used the `%` operator: `full_name % ${candidate.fullName}`. The `%` operator evaluates true when `similarity()` exceeds `pg_trgm.similarity_threshold`, which defaults to `0.3` in PostgreSQL. This caused PostgreSQL to return rows with `name_sim` 0.3–0.7 that were then discarded by the application-layer guard `fuzzy[0].name_sim > 0.7`. With `LIMIT 1` in place, a 0.4-sim row could be returned before a 0.8-sim row — silently wrong results.

**Fix:** Replaced `full_name % ${fullName}` with `similarity(full_name, ${fullName}) > 0.7` in the SQL WHERE clause. The threshold is now enforced entirely in SQL, not in application code. Removed the application-layer guard.

### Issue 3b — Inverted names (FIXED — commit dcd4b2d)

**Bug:** `pg_trgm similarity('John Smith', 'Smith John')` returns ~0.4 (word order matters for trigrams). A re-submission with "Smith, John" or "Smith John" instead of "John Smith" bypassed dedup entirely.

**Fix:** Computed `reversedName` server-side (`candidate.fullName.trim().split(/\s+/).reverse().join(' ')`) before the query. Updated the SQL to use `GREATEST(similarity(full_name, name), similarity(full_name, reversedName))` as the score, and OR'd the WHERE clause so either forward or reversed name exceeding 0.7 triggers a match.

**Files:** `src/dedup/dedup.service.ts`

**Tests added:**
- `DEDUP-06`: inverted name tokens (Smith John vs John Smith) still returns a match above 0.7
- `DEDUP-07`: SQL-filtered empty result returns null (threshold enforced in SQL, not app layer)

### Issue 2 — Non-atomic DB flow (FIXED — commit 6a9d372)

**Bug:** `IngestionProcessor.process()` performed `insertCandidate`, `createFlag`, and `emailIntakeLog.update` as three separate DB round-trips with no transaction. If the worker crashed between steps 1 and 3, the candidate row would exist but `emailIntakeLog.candidateId` would never be set — orphaned record with no linkage to the intake log.

**Fix:**
- Added optional `tx?: Prisma.TransactionClient` parameter to `insertCandidate`, `upsertCandidate`, and `createFlag` in `DedupService`. When `tx` is provided, operations use the transaction client; otherwise fall back to `this.prisma` (existing call sites unchanged).
- Wrapped the entire Phase 6 block in `prisma.$transaction()` in `IngestionProcessor.process()`. `dedupService.check()` was intentionally left outside the transaction (read-only, no lock benefit).
- Moved `emailIntakeLog.update(candidateId)` inside the transaction so it is atomic with the INSERT/UPSERT.

**Files:** `src/dedup/dedup.service.ts`, `src/ingestion/ingestion.processor.ts`

**Tests added:**
- Atomicity test: if `emailIntakeLog.update` throws inside the transaction, `insertCandidate` is rolled back (orphaned record prevented)
- Updated existing Phase 6 tests (6-02-02, 6-02-03) to pass `tx` as third/fifth argument to dedup service methods
- Added `$transaction` mock to Phase 5 and root `IngestionProcessor` describe blocks

---

## Test Results

| Suite | Before | After |
|---|---|---|
| dedup.service.spec.ts | 5 tests | 7 tests (DEDUP-06, DEDUP-07 added) |
| ingestion.processor.spec.ts | 18 tests | 22 tests (atomicity + 3 updated) |
| Full suite | 83 tests passing | 86 tests passing |

---

## Self-Check: PASSED

- `src/dedup/dedup.service.ts` — FOUND (% operator removed, GREATEST() present, similarity() > 0.7 in WHERE)
- `src/dedup/dedup.service.spec.ts` — FOUND (7 tests passing)
- `src/ingestion/ingestion.processor.ts` — FOUND (Phase 6 block wrapped in prisma.$transaction)
- `src/ingestion/ingestion.processor.spec.ts` — FOUND (22 tests passing)
- Commit dcd4b2d — FOUND
- Commit 6a9d372 — FOUND
- Full suite: 86 tests, 0 failures
