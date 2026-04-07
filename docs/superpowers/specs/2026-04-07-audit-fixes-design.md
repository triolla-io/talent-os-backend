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

**Solution:** At job start, check if intake already has `candidateId`. If yes, fetch the candidate AND its extraction data from the DB, reconstruct `ScoringInput`, and resume Phase 7 (scoring).

**Key Insight:** Scoring requires `ScoringInput` (cvText, extraction fields, job details). On retry, this data is not in memory, so we must either:
1. Store raw extraction output (`cvText`, `skills`, `yearsExperience`, `currentRole`) in `email_intake_log` during Phase 4, or
2. Reconstruct it from saved `candidate` fields (skills, yearsExperience, currentRole) + stored `cvText` in email_intake_log

We'll use option 2: Store `cvText` in `email_intake_log` during Phase 4, then on retry fetch candidate + cvText from DB to reconstruct `ScoringInput`.

**Changes:**

**File: `prisma/schema.prisma`**

- Add to `EmailIntakeLog`: `cvText String?` (nullable, stores raw CV text from Phase 4)

**Migration:**
- Create migration: `npx prisma migrate dev --name add_cvtext_to_email_intake_log`

**File: `src/modules/ingestion/ingestion.processor.ts`**

- Phase 4: Store `cvText` in intake log when saving extraction results
  ```typescript
  await this.prisma.emailIntakeLog.update({
    where: { id: intakeId },
    data: { cvText: extraction.cvText }, // Save during Phase 4
  });
  ```

- Lines 94–120: Before `dedupService.check()`, check for retry

```typescript
async process(job: Job) {
  const payload = job.data as ProcessEmailPayload;
  const { tenantId, messageId } = payload;

  // Check if this intake was already processed
  const existingIntake = await this.prisma.emailIntakeLog.findUnique({
    where: { idx_intake_message_id: { tenantId, messageId } },
    select: { candidateId: true, cvText: true },
  });

  if (existingIntake?.candidateId && existingIntake.cvText) {
    // Retry detected: fetch candidate + reconstruct ScoringInput
    const candidate = await this.prisma.candidate.findUnique({
      where: { id: existingIntake.candidateId },
    });

    // Reconstruct ScoringInput from saved data
    const scoringInput: ScoringInput = {
      cvText: existingIntake.cvText,
      candidateFields: {
        currentRole: candidate.currentRole || null,
        yearsExperience: candidate.yearsExperience || null,
        skills: candidate.skills || [],
      },
      job: payload.job, // From job context
    };

    // Resume Phase 7 (scoring), skip Phase 6 entirely
    return this.scoreAndStoreResults(scoringInput, candidate, existingIntake);
  }

  // Normal flow: Phase 4-7
  return this.normalProcessFlow(job);
}
```

**Test:**

- Simulate job failure at Phase 7 → BullMQ retry → verify Phase 6 skipped, candidate + cvText fetched, ScoringInput reconstructed, Phase 7 resumes ✓
- Verify no self-duplicate created ✓
- Verify scoring runs with correct extracted data (not fresh extraction) ✓

**Isolation:** Ingestion processor + schema change. Adds `cvText` column to intake log. Depends on #3 (unique constraint ensures consistent data).

---

## Fix #5: Issue #7 — Fragile Deterministic Fallback Logic

**Problem:** `extractDeterministically()` assumes first line is name. CVs starting with "Curriculum Vitae", "CONFIDENTIAL", dates, etc. produce garbage data. Current regex only handles Latin characters — fails for Hebrew, Arabic, and other Unicode scripts common in production.

**Solution:** Expand header filter, add Unicode-aware name detection that accommodates RTL scripts and different capitalization patterns, fallback to "Unknown Candidate".

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

- Add Unicode-aware name pattern detection (supports Latin, Hebrew, Arabic, and other scripts):

```typescript
// Look for a line that looks like a name: 2-3 short words (not a sentence, not a date, not a header)
// Works for "John Doe", "Jean-Pierre Dupont", "David Cohen", "אבי לוי", "محمد علي"
const looksLikeName = (line: string): boolean => {
  const trimmed = line.trim();
  
  // Skip if it's clearly a header, date, or sentence
  if (
    trimmed.length < 3 ||
    trimmed.length > 100 ||
    trimmed.match(/^\d{1,2}[/-]\d{1,2}/) || // dates
    trimmed.match(/\d{4}/) || // likely a year
    trimmed.toLowerCase().match(/^(dear|hello|hi|to|from|subject|re:)/) || // greetings/email headers
    trimmed.split(/\s+/).length > 4 // more than 4 words (likely a sentence)
  ) {
    return false;
  }
  
  // Must contain at least one Unicode letter
  return /\p{L}/u.test(trimmed);
};

const fullName = realLines.find((line) => looksLikeName(line)) || 'Unknown Candidate';
```

**Test:**

- CV starting with "CONFIDENTIAL" → skip header, find real name or "Unknown Candidate" ✓
- CV starting with date → skip, find name ✓
- Hebrew name "אבי לוי" → correctly identified as name ✓
- Arabic name "محمد علي" → correctly identified as name ✓
- CV with malformed first line → fallback to "Unknown Candidate" ✓
- CV with multiple lines before name → find first line that looks like a name ✓

**Isolation:** Deterministic extraction logic only. No DB/queue changes. Independent of all other fixes.

---

## Fix #6: Issue #3 — O(N) Memory & Performance Bottleneck in Job Matching

**Problem:** `extractAllJobIdsFromEmailText()` fetches ALL active jobs, loops all, regex-tests each. O(N) for 5000+ jobs. No short_id extraction from email. System uses plain numeric short_ids (100, 101, 245, 1053+) with no prefix.

**Solution:** Extract numeric tokens (integers ≥ 100) from email, query only those as potential short_ids. Accept some false positives (years, zip codes, etc.) since DB query filters out non-existent shortIds. If no numeric tokens found, return empty array.

**Changes:**

**File: `src/modules/ingestion/ingestion.processor.ts`**

- Lines 51–92: Replace full fetch + loop with numeric extraction

```typescript
async extractAllJobIdsFromEmailText(emailText: string): Promise<string[]> {
  // Extract all numeric tokens >= 100 from email
  // System short_ids are plain numbers: 100, 101, 245, 1053, etc.
  // This catches job mentions like "for position 245" or "apply to job 1053"
  // False positives (years, zip codes) are filtered by DB query
  const numberPattern = /\b(\d{3,})\b/g;
  const matches = [...emailText.matchAll(numberPattern)];

  if (matches.length === 0) {
    return []; // No numeric tokens found, return empty
  }

  // Filter to numbers >= 100, deduplicate
  const candidates = new Set(
    matches
      .map(m => parseInt(m[1], 10))
      .filter(n => n >= 100)
  );

  if (candidates.size === 0) {
    return []; // No valid job number candidates
  }

  // Query only the extracted numbers as short_ids
  // DB will naturally filter out non-existent IDs
  const matchedJobs = await this.prisma.job.findMany({
    where: {
      shortId: { in: Array.from(candidates) },
      tenantId: this.tenantId,
      status: 'open',
    },
    select: { id: true },
  });

  return matchedJobs.map(j => j.id);
}
```

**Test:**

- Email mentioning "job 245" and "position 1053" → extract [245, 1053], query only those ✓
- Email with year "2024" → included in candidates but filtered by DB (no job with shortId 2024) ✓
- Email with no numeric tokens → return empty array ✓
- Email with only 2-digit numbers (99, 50) → filtered by ≥100 check, return empty ✓
- Duplicate numbers in email (both "245" mentioned twice) → deduped via Set ✓

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

## Design Review Complete ✓

All 6 audit issues addressed with:
- **Correct idempotency logic** (stores cvText, reconstructs ScoringInput on retry)
- **Unicode-aware name detection** (supports Hebrew, Arabic, Latin scripts)
- **Accurate job ID extraction** (numeric tokens ≥100, no false prefix patterns)

Ready to proceed with implementation task-by-task.
