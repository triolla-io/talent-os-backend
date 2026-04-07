# Audit Verification Fixes — Design Document

**Date:** 2026-04-07  
**Scope:** 6 critical, high, and medium issues from AUDIT-VERIFICATION.md  
**Approach:** Sequential independent fixes, task-by-task stabilization  
**Success Criteria:** All 6 issues resolved, 249 tests passing, no regressions

---

## Fix Order & Dependencies

Issues fixed in dependency order to prevent cascading failures:

1. **#4** → (context limits prevent LLM errors)
2. **#6** → (validation coercion handles LLM outputs)
3. **#2** → (unique constraint + race handling)
4. **#1** → (idempotency guard prevents retry loops)
5. **#7** → (data quality improvement, independent)
6. **#3** → (performance optimization, independent)

---

## Fix #1: Issue #4 — Unbounded Context Window

**Problem:** `cvText` + `job.description` passed to LLM without length limits → 400/413 errors on oversized inputs.

**Solution:** Add character limits + error handling.

**Changes:**

**File: `src/modules/scoring/scoring.service.ts`**
- Lines 76, 82: Truncate `cvText` to 15K chars, `job.description` to 15K chars
- Lines 95–108: Wrap LLM call in try-catch for HTTP 400/413, log error, mark intake as failed

**File: `src/modules/extraction/extraction-agent.service.ts`**
- Line 70: Truncate `emailBody` to 20K chars before processing
- Lines 95–108: Wrap LLM call in try-catch, graceful failure on oversized input

**Test:**
- New test: Oversized CV (simulate 100K char extraction) → verify truncation
- New test: LLM returns 400 → verify intake marked failed, error logged

**Isolation:** Scoring + extraction services only. No DB changes. Independent from all other fixes.

---

## Fix #2: Issue #6 — Overly Strict Zod Validation

**Problem:** `.int()` validation rejects LLM float outputs (e.g., `score: 85.5`) → validation failures → job retry loop.

**Solution:** Coerce floats to integers via `Math.round` transform, drop `.int()` check.

**Changes:**

**File: `src/modules/extraction/extraction-agent.service.ts`**
- Line 11: `years_experience: z.number().transform(Math.round).min(0).max(50).nullable(),`

**File: `src/modules/scoring/scoring.service.ts`**
- Line 7: `score: z.number().transform(Math.round).min(0).max(100),`

**Test:**
- New test: LLM returns `score: 85.5` → coerces to `85` ✓
- New test: LLM returns `years_experience: 6.7` → coerces to `7` ✓
- New test: LLM returns `score: 150` → validation fails (out of range) ✓

**Isolation:** Schema definitions only. No logic changes. Depends on #4 (so oversized inputs don't trigger LLM errors first).

---

## Fix #3: Issue #2 — TOCTOU Race Condition

**Problem:** `dedupService.check()` outside transaction. Two workers both see `null` → both insert duplicates. No unique constraint on `(tenant_id, phone)`.

**Solution:** Add DB unique constraint + catch `P2002` error, fetch existing candidate gracefully.

**Changes:**

**File: `prisma/schema.prisma`**
- Add unique index: `@@unique([tenantId, phone], name: "idx_candidate_tenant_phone")`

**Migration:**
- Create migration: `npx prisma migrate dev --name add_unique_candidate_phone`

**File: `src/modules/ingestion/ingestion.processor.ts`**
- Lines 232–279: Wrap transaction in try-catch
- Catch `P2002` error: log race detected, fetch existing candidate by phone, continue to Phase 7

```typescript
try {
  // ... existing transaction
} catch (error) {
  if (error.code === 'P2002' && error.meta?.target?.includes('phone')) {
    // Race detected: another worker inserted this phone first
    const existing = await this.prisma.candidate.findUnique({
      where: { idx_candidate_tenant_phone: { tenantId, phone } },
    });
    context.candidateId = existing.id;
    // Continue to Phase 7
  } else {
    throw error;
  }
}
```

**Test:**
- Mock second INSERT hitting same phone → `P2002` raised → verify existing candidate fetched, processing continues ✓

**Isolation:** DB schema + transaction error handling. No changes to dedup/scoring logic. Depends on #4/#6 (so LLM errors don't mask race condition).

---

## Fix #4: Issue #1 — Broken Idempotency on BullMQ Retries

**Problem:** Job fails at Phase 7 → retry re-enters Phase 6 with no guard → dedup runs again → creates self-duplicate. No check for existing `candidateId` on intake record.

**Solution:** At job start, check if intake already has `candidateId`. If yes, skip Phase 6, resume Phase 7.

**Changes:**

**File: `src/modules/ingestion/ingestion.processor.ts`**
- Lines 94–100: Before `dedupService.check()`, query for existing intake

```typescript
async process(job: Job) {
  const payload = job.data as ProcessEmailPayload;
  const { tenantId, messageId } = payload;
  
  // Check if this intake was already processed
  const existingIntake = await this.prisma.emailIntakeLog.findUnique({
    where: { idx_intake_message_id: { tenantId, messageId } },
    select: { candidateId: true },
  });
  
  if (existingIntake?.candidateId) {
    // Resume from Phase 7: fetch candidate and score
    context.candidateId = existingIntake.candidateId;
    const candidate = await this.prisma.candidate.findUnique({
      where: { id: context.candidateId },
    });
    // Skip Phase 6, proceed to Phase 7 (scoring)
    return this.scoreCandidate(candidate, ...);
  }
  
  // Normal flow: Phase 4-7
  return this.normalProcessFlow(job);
}
```

**Test:**
- Simulate job failure at Phase 7 → BullMQ retry → verify Phase 6 skipped, existing candidate fetched, Phase 7 resumes ✓
- Verify no self-duplicate created ✓

**Isolation:** Ingestion processor entry point only. No changes to dedup/scoring. Depends on #3 (unique constraint ensures consistent data).

---

## Fix #5: Issue #7 — Fragile Deterministic Fallback Logic

**Problem:** `extractDeterministically()` assumes first line is name. CVs starting with "Curriculum Vitae", "CONFIDENTIAL", dates, etc. produce garbage data.

**Solution:** Expand header filter, add name pattern detection, fallback to "Unknown Candidate".

**Changes:**

**File: `src/modules/extraction/extraction-agent.service.ts`**
- Lines 129–160: Expand header filter list

```typescript
const realLines = lines.filter(
  (line) =>
    !line.startsWith('--- Email Body ---') &&
    !line.startsWith('--- Attachment') &&
    !line.startsWith('--- Email Metadata ---') &&
    !line.startsWith('Subject:') &&
    !line.startsWith('From:') &&
    !line.match(/^(Curriculum Vitae|Professional Summary|CONFIDENTIAL|Private & Confidential)/i),
);
```

- Add name pattern detection:

```typescript
const namePattern = /^([A-Z][a-z]+\s+[A-Z][a-z]+|[A-Z][a-z]+\s+[A-Z]\.?\s+[A-Z][a-z]+)/;
const fullName = realLines.find(line => namePattern.test(line)) || 'Unknown Candidate';
```

**Test:**
- CV starting with "CONFIDENTIAL" → skip header, find real name or "Unknown Candidate" ✓
- CV starting with date → skip, find name ✓
- CV with malformed first line → fallback to "Unknown Candidate" ✓

**Isolation:** Deterministic extraction logic only. No DB/queue changes. Independent of all other fixes.

---

## Fix #6: Issue #3 — O(N) Memory & Performance Bottleneck in Job Matching

**Problem:** `extractAllJobIdsFromEmailText()` fetches ALL active jobs, loops all, regex-tests each. O(N) for 5000+ jobs. No short_id extraction from email.

**Solution:** Extract job short_id patterns from email first, query only those jobs. If no patterns found, return empty array.

**Changes:**

**File: `src/modules/ingestion/ingestion.processor.ts`**
- Lines 51–92: Replace full fetch + loop with pattern-based extraction

```typescript
async extractAllJobIdsFromEmailText(emailText: string): Promise<string[]> {
  // Extract short_id patterns from email (e.g., "JOB-123", "position:456")
  const shortIdPattern = /(?:job|position|pos|role|jid|position_id)[-:]?\s*(\w+)/gi;
  const matches = [...emailText.matchAll(shortIdPattern)];
  
  if (matches.length === 0) {
    return []; // No job patterns found, return empty
  }
  
  const shortIds = matches.map(m => m[1]).filter(Boolean);
  
  // Query only the extracted job IDs by shortId
  const matchedJobs = await this.prisma.job.findMany({
    where: {
      shortId: { in: shortIds },
      tenantId: this.tenantId,
      status: 'open',
    },
    select: { id: true },
  });
  
  return matchedJobs.map(j => j.id);
}
```

**Test:**
- Email with 3 job mentions → verify exactly 3 queries (not 5000) ✓
- Email with no job patterns → return empty array ✓
- Email with invalid job IDs → skip gracefully ✓

**Isolation:** Job matching logic only, Phase 15. No interaction with other phases. Can be done last.

---

## Testing & Validation

**All existing tests must pass:** 249 tests ✓  
**New test cases per fix:** ~2–3 per issue ✓  
**Regression check:** Run full suite after each fix ✓

---

## Commits

Each fix is one atomic commit with this message format:

```
fix(audit): Issue #N — [brief description]

Details of what was fixed and why.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
```

---

**Ready to proceed with implementation?**
