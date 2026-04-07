---
quick_task_id: 260407-iff
title: Ensure phone number normalization by treating international prefixes and leading zeros as identical matches; record duplicates in flags table
status: ready
date_created: "2026-04-07"
priority: high
---

# Quick Task 260407-iff: Phone Normalization & Duplicate Flag Recording

## Goal

Ensure that phone numbers are normalized correctly during deduplication (treating international prefixes like +972 and local leading zeros as equivalent), and when a duplicate is detected via exact phone match, the candidate is correctly recorded in the `duplicate_flags` table so that `getCounts()` can accurately reflect duplicates in the UI counters.

## Current State

**What works:**
- Phone normalization via `regexp_replace(phone, '[^0-9]', '', 'g')` correctly strips all non-digits
- Exact phone matching detects duplicates correctly (confidence === 1.0)
- `getCounts()` queries `duplicateFlags` table with `reviewed: false` to count unreviewed duplicates

**What's broken:**
- When an exact phone match is detected (line 259-264 in ingestion.processor.ts), the processor calls `upsertCandidate()` but **does NOT call `createFlag()`**
- This leaves no record in `duplicate_flags` table that a duplicate was detected
- Result: `getCounts()` returns 0 duplicates even when duplicates exist
- UI counters show incorrect data, and there's no way for HR to review flagged duplicates

## Must-Haves

1. **Artifact:** `src/ingestion/ingestion.processor.ts` — line 259-264 modified to call `createFlag()` when exact phone match detected
2. **Artifact:** `src/ingestion/ingestion.processor.spec.ts` — test verifies `createFlag()` is called with correct parameters on exact phone match
3. **Truth:** When a duplicate is detected via exact phone match, a `DuplicateFlag` record exists in the database with:
   - `candidateId` = the new candidate (upseerted)
   - `matchedCandidateId` = the matched candidate (existing)
   - `matchFields` = `['phone']`
   - `confidence` = 1.0
   - `reviewed` = false
4. **Truth:** `getCounts().duplicates` returns the correct count after duplicate detection
5. **Truth:** Phone numbers with international prefixes (+972) and local leading zeros (0) are treated as equivalent matches

## Tasks

### Task 1: Record Duplicate Flag on Exact Phone Match

**Files Modified:**
- `src/ingestion/ingestion.processor.ts`

**Action:**

In the ingestion processor, at line 259-264 where exact phone match is detected, add a call to `createFlag()` inside the transaction to record the duplicate relationship. The processor currently does this correctly for `phone_missing` case (lines 242-258) but skips it for exact matches.

Modify the else-if block starting at line 259:

```typescript
} else if (dedupResult.confidence === 1.0) {
  // Exact phone match (DEDUP-02): UPSERT existing candidate
  await this.dedupService.upsertCandidate(dedupResult.match!.id, extraction!, tx);
  candidateId = dedupResult.match!.id;
  
  // NEW: Record duplicate flag for HR review (per 260407-iff)
  await this.dedupService.createFlag(
    dedupResult.match!.id,  // matched candidate = candidateId for the flag
    null,                    // self-reference: matched_candidate_id = candidate_id (no new candidate created)
    dedupResult.confidence,  // 1.0 for exact match
    tenantId,
    dedupResult.fields,      // ['phone']
    tx,
  );
}
```

**Why:** The logic should be: when we UPSERT an existing candidate (exact phone match), we don't create a NEW candidate — we update the existing one. The flag records that we found a duplicate and merged it. The `candidateId` used for the flag should be the matched/existing candidate since no new candidate row was created.

**Verify:**
- Code compiles without TypeScript errors: `npm run build`
- File has been modified as specified
- The transaction includes both `upsertCandidate()` and `createFlag()` calls

**Done:**
- Exact phone match case now calls `createFlag()` with correct parameters
- No new candidates created, existing candidate UPSERTED
- Flag records the match for HR review

### Task 2: Add Test Case for Exact Phone Match Duplicate Flag Creation

**Files Modified:**
- `src/ingestion/ingestion.processor.spec.ts`

**Action:**

Locate the test case that verifies exact phone match behavior (search for confidence === 1.0 test). Add assertion that `createFlag()` was called with the correct parameters.

Find the test that mocks `dedupService.check()` returning `{ match: { id: 'existing-cand-id' }, confidence: 1.0, fields: ['phone'] }` and add:

```typescript
expect(dedupService.createFlag).toHaveBeenCalledWith(
  'existing-cand-id',      // matched candidate (upseerted)
  null,                     // self-reference
  1.0,                      // confidence
  tenantId,
  ['phone'],               // matchFields
  expect.any(Object),      // tx (transaction client)
);
```

If no such test exists, create one:
- Mock `dedupService.check()` to return exact phone match result
- Process the job
- Verify `createFlag()` was called
- Verify `upsertCandidate()` was called
- Verify no new candidate was created (candidateId should be the matched one)

**Verify:**
- Test file compiles: `npm run build`
- Test runs without error: `npm test -- src/ingestion/ingestion.processor.spec.ts`
- Test assertions pass

**Done:**
- Test case exists verifying `createFlag()` is called on exact phone match
- Test validates all parameters are correct

### Task 3: Integration Test — Verify getCounts() Returns Correct Duplicates Count

**Files Modified:**
- `src/ingestion/ingestion.processor.spec.ts` (or new integration test file)

**Action:**

Create an end-to-end test scenario that:
1. Creates a candidate in the database with phone = "+972 50 123 4567"
2. Simulates a Postmark webhook with a new candidate having phone = "050 123 4567" (same number, different format)
3. Runs the ingestion processor
4. Calls `CandidatesService.getCounts()`
5. Asserts that `getCounts().duplicates === 1`

This validates the complete flow: phone normalization → duplicate detection → flag creation → counting.

**Test Pseudocode:**

```typescript
it('should record duplicate flag and getCounts should reflect it', async () => {
  // 1. Seed a candidate with international format
  const existingCandidate = await prisma.candidate.create({
    data: {
      tenantId,
      fullName: 'John Doe',
      phone: '+972 50 123 4567',
      email: 'john@example.com',
      source: 'direct',
      sourceEmail: 'hr@company.com',
    },
  });

  // 2. Create webhook payload with same phone, different format
  const payload = {
    MessageID: crypto.randomUUID(),
    From: 'candidate@example.com',
    Subject: 'CV Submission',
    TextBody: '...',
    Attachments: [/* mock PDF */],
  };

  // 3. Process the job
  const job = { data: payload };
  await processor.process(job);

  // 4. Verify duplicate flag was created
  const flags = await prisma.duplicateFlag.findMany({
    where: { tenantId },
  });
  expect(flags.length).toBe(1);
  expect(flags[0].matchFields).toContain('phone');

  // 5. Call getCounts() and verify duplicates count
  const counts = await candidatesService.getCounts();
  expect(counts.duplicates).toBe(1);
});
```

**Verify:**
- Test runs: `npm test -- --grep "duplicate.*count"`
- Test passes
- Assertions validate phone normalization, flag creation, and counting

**Done:**
- Integration test validates the complete flow
- Phone normalization, deduplication, flag recording, and counting all work end-to-end

## Validation Criteria

After completing all tasks:

1. **Code Review:**
   - Ingestion processor calls `createFlag()` on exact phone match ✓
   - Test case verifies `createFlag()` is called ✓
   - No TypeScript errors ✓

2. **Test Results:**
   - All 3 test cases pass ✓
   - `npm run build` succeeds ✓
   - `npm test` shows no new failures ✓

3. **Functional:**
   - Candidates with phone "+972 50 1234567" and "050 1234567" are correctly treated as duplicates ✓
   - `DuplicateFlag` record exists after detection ✓
   - `getCounts().duplicates` returns correct count ✓
   - `is_duplicate` field in `/api/candidates` response reflects actual duplicates ✓

## Dependencies

- Must follow existing patterns in `DedupService.createFlag()` (already tested in Phase 6)
- Ingestion processor transaction scope already includes `tx` parameter passing (used for `phone_missing` case)
- `CandidatesService.getCounts()` already queries `duplicateFlags` correctly

## Notes

- Phone normalization is already correct via `regexp_replace()` — no changes needed there
- The fix is purely about recording the flag when an exact match is detected
- Pattern follows existing `phone_missing` case (lines 242-258) which correctly calls `createFlag()`
- No database schema changes required — `DuplicateFlag` model already exists and is correct
