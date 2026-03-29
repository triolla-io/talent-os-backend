---
quick_task: 260329-kxa
description: Refactor AI scoring to only execute on successful candidate-job match
created: 2026-03-29
status: planned
type: optimize
effort: small
---

# Refactor AI Scoring to Only Execute on Matched Job

**Objective:** Remove unnecessary LLM API calls by scoring candidates against only the matched job from Phase 6.5, not all active jobs.

**Current Issue:**
- Phase 6.5 (lines 220-272) successfully fuzzy-matches a single job
- Phase 7 (lines 302-367) **ignores** that match and loops over ALL active jobs
- Result: Inflated LLM costs (e.g., 5 API calls per candidate for 5 open jobs)

**After Fix:**
- Phase 7 uses the matched job (if any) from Phase 6.5
- Loop removed entirely
- Cost: 1 API call per matched candidate (not per candidate-job pair)

---

## Tasks

### Task 1: Refactor Phase 7 scoring to use matched job (lines 302-367)

**File:** `src/ingestion/ingestion.processor.ts`

**Action:**
Replace the active jobs fetch loop (lines 302-367) with a single scoring operation against `matchedJob`.

Current flow:
```typescript
// Line 302-306: Fetch ALL active jobs
const activeJobs = await this.prisma.job.findMany({
  where: { tenantId, status: 'open' },
  select: { id: true, title: true, description: true, requirements: true },
});

// Line 309-367: Loop over all jobs, score candidate against each
for (const activeJob of activeJobs) {
  // upsert application
  // call scoring service
  // insert score
}
```

Replace with:
```typescript
// Phase 7: Score candidate against matched job only (SCOR-01, D-11)
// If matchedJob is null (no match), we already returned at line 299
const activeJob = matchedJob; // matchedJob guaranteed to exist here (line 293 guard)

// SCOR-02: upsert application row first — idempotent on retry
const application = await this.prisma.application.upsert({
  where: {
    idx_applications_unique: {
      tenantId,
      candidateId: context.candidateId,
      jobId: activeJob.id,
    },
  },
  create: { tenantId, candidateId: context.candidateId, jobId: activeJob.id, stage: 'new' },
  update: {}, // No-op on retry
  select: { id: true },
});

// SCOR-03: score candidate against matched job (single call, not loop)
let scoreResult;
try {
  scoreResult = await this.scoringService.score({
    cvText: context.cvText,
    candidateFields: {
      currentRole: extraction!.current_role ?? null,
      yearsExperience: extraction!.years_experience ?? null,
      skills: extraction!.skills ?? [],
    },
    job: {
      title: activeJob.title,
      description: activeJob.description ?? null,
      requirements: activeJob.requirements,
    },
  } satisfies ScoringInput);
} catch (err) {
  this.logger.error(
    `Scoring failed for candidateId: ${context.candidateId}, jobId: ${activeJob.id} — ${(err as Error).message}`,
  );
  // Mark intake as failed if even the matched job scoring fails
  await this.prisma.emailIntakeLog.update({
    where: { idx_intake_message_id: { tenantId, messageId: payload.MessageID } },
    data: { processingStatus: 'failed', errorMessage: (err as Error).message },
  });
  throw err;
}

// SCOR-04, SCOR-05: append-only INSERT
await this.prisma.candidateJobScore.create({
  data: {
    tenantId,
    applicationId: application.id,
    score: scoreResult.score,
    reasoning: scoreResult.reasoning,
    strengths: scoreResult.strengths,
    gaps: scoreResult.gaps,
    modelUsed: scoreResult.modelUsed,
  },
});

this.logger.log(
  `Phase 7 scored candidateId: ${context.candidateId} against jobId: ${activeJob.id} — score: ${scoreResult.score}`,
);
```

**Key changes:**
- Delete the `activeJobs` fetch (lines 302-306)
- Delete the `for (const activeJob of activeJobs)` loop wrapper (line 309)
- Remove the `continue` error handler (line 347) — throw instead (fail the job to BullMQ for retry on scoring failure)
- Unindent the application upsert and scoring block (reduce one level of nesting)

**Why this works:**
1. Line 293-300 already guards: if `!matchedJob`, we return early and skip Phase 7 entirely
2. At line 302, `matchedJob` is guaranteed to be non-null (otherwise we've already returned)
3. Single scoring call = single LLM invocation per matched candidate
4. All retry semantics preserved: if scoring fails, BullMQ retries the job

**Verify:**
- File compiles with `npm run build`
- No TypeScript errors or ESLint violations
- Existing test suite passes: `npm test -- ingestion.processor.spec.ts`
- No `activeJobs` variable remains (grep confirms removal)

**Done:**
- Lines 302-367 refactored to single scoring operation
- Loop removed
- Behavior unchanged for unmatched candidates (still skip scoring)
- Behavior changed for matched candidates: now 1 API call instead of N

