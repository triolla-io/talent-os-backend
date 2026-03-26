# Phase 13: Implement Kanban Board with Candidate Hiring Stage Tracking - Research

**Researched:** 2026-03-26
**Domain:** Database schema evolution, service layer logic, API contract extension
**Confidence:** HIGH

## Summary

Phase 13 requires adding direct hiring stage tracking to the Candidate model to enable Kanban board visualization. The design is straightforward: add a `hiring_stage_id` foreign key to Candidate pointing to JobStage, auto-assign the first stage (by `order` field) when a candidate is created with a `job_id`, and include both `job_id` and `hiring_stage_id` in GET /api/candidates responses.

Analysis of the existing codebase reveals:
- Current Candidate model is nullable on `job_id` (supporting email intake flow where job is assigned later)
- JobStage model exists with `order` field for sequencing (1-based, as seen in seed defaults)
- CandidatesService.createCandidate() already handles candidate creation with `job_id`
- GET /api/candidates currently does NOT include `job_id` or hiring stage information
- Test infrastructure is well-established (Jest with Prisma mocks)

The migration strategy follows existing patterns: add nullable column, backfill existing data, add constraint. No breaking changes to existing APIs if handled correctly.

**Primary recommendation:** Implement in four atomic pieces: (1) Add `hiring_stage_id` column nullable, (2) Backfill existing candidates with first stage of their job, (3) Make `hiring_stage_id` NOT NULL after data migration, (4) Update CandidatesService.createCandidate() and GET /api/candidates response to handle auto-assignment and inclusion.

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Track hiring stage directly on Candidate entity via `hiring_stage_id` FK (bypass Application entity complexity for MVP)
- Auto-assign first stage (by position order) when candidate is created with `job_id`
- GET /api/candidates must include `job_id` and `hiring_stage_id` for Kanban board rendering
- First stage is identified by lowest `position` value in JobStage table

### Claude's Discretion
- Optional inclusion of `hiring_stage_name` in GET /api/candidates response (UI convenience)
- Handling of edge cases (stage deletion, null job_id candidates, etc.) — design patterns needed

### Deferred Ideas (OUT OF SCOPE)
- Application entity and advanced workflows (future phases)
- Stage reordering logic and candidate auto-migration
- Drag-to-move implementation in Kanban UI

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-13-01 | Add `hiring_stage_id` FK to Candidate model | Schema analysis identifies JobStage.id as target, migration pattern established |
| REQ-13-02 | Auto-assign first hiring stage on candidate creation | JobStage has `order` field; CandidatesService already knows `job_id`; query pattern documented |
| REQ-13-03 | Include stage identifiers in GET /api/candidates | Current response structure identified; JSON response example provided |
| REQ-13-04 | Prevent stageless candidates after migration | Migration strategy includes backfill and NOT NULL constraint |
| REQ-13-05 | Maintain backward compatibility with existing clients | API response expansion identified; no breaking changes if job_id/hiring_stage_id are additions |

## Current Schema State

### Candidate Model (lines 66-100 of schema.prisma)

**Current fields:**
```
id: String @id (UUID)
tenantId: String @map("tenant_id") (FK to Tenant)
jobId: String? @map("job_id") (FK to Job, nullable, onDelete: SetNull)
email: String? (nullable)
fullName: String (required)
phone: String? (nullable)
currentRole, location, yearsExperience, skills, cvText, cvFileUrl, source, sourceAgency, sourceEmail, aiSummary, metadata
createdAt, updatedAt
```

**Current relations:**
- tenant: Tenant (required, via tenantId FK)
- job: Job? (optional, via jobId FK with SetNull on delete)
- applications: Application[] (inverse)
- duplicateFlags, matchedIn, emailIntakeLogs (various inverse relations)

**Current indexes:**
- `idx_candidates_tenant_job` on (tenantId, jobId)

**Key observation:** jobId is nullable, supporting the email intake flow where candidates are created without a job assignment initially. This is important for backward compatibility.

### JobStage Model (lines 195-216 of schema.prisma)

**Current fields:**
```
id: String @id (UUID)
tenantId: String @map("tenant_id") (FK to Tenant)
jobId: String @map("job_id") (FK to Job, onDelete: Cascade)
name: String (required)
order: Int @db.SmallInt (1-based position, as confirmed by seed data)
interviewer: String? (optional)
isEnabled: Boolean @default(true)
color: String @default("bg-zinc-400")
isCustom: Boolean @default(false)
createdAt, updatedAt
```

**Current relations:**
- tenant: Tenant (required)
- job: Job (required, onDelete: Cascade)
- applications: Application[] (inverse, via jobStageId)

**Current indexes:**
- `idx_job_stages_job_order` on (jobId, order) — **critical for "first stage" queries**

**Key observation:** order field is SmallInt and exists for sorting stages. Seed data confirms 1-based ordering (Application Review=1, Screening=2, etc.). Index on (jobId, order) is perfect for efficient "first stage" lookup.

### Application Model (lines 102-128 of schema.prisma)

**Context:** Application entity exists but is NOT used in Phase 13 MVP. It has jobStageId FK for future use. Phase 13 bypasses this entirely, tracking stage directly on Candidate.

### Relation Map

```
Tenant 1---* Candidate
Tenant 1---* JobStage
Job 1---* Candidate (jobId nullable, onDelete: SetNull)
Job 1---* JobStage (jobId required, onDelete: Cascade)
Candidate 1---* Application (future: will route through Application → JobStage)
JobStage 1---* Application (jobStageId nullable, for future use)
```

## Proposed Schema Changes

### 1. Add `hiring_stage_id` to Candidate Model

**Field definition (Prisma syntax):**
```prisma
model Candidate {
  // ... existing fields ...

  // NEW: Hiring stage tracking for Kanban board
  hiringStageId  String?  @map("hiring_stage_id") @db.Uuid

  // NEW: Relation to JobStage
  hiringStage    JobStage?  @relation(fields: [hiringStageId], references: [id], onDelete: SetNull)

  // ... existing indexes ...
  // NEW INDEX: for Kanban board queries (job + stage filtering)
  @@index([tenantId, jobId, hiringStageId], name: "idx_candidates_tenant_job_stage")
}
```

**Relation addition to JobStage model:**
```prisma
model JobStage {
  // ... existing fields ...
  candidates     Candidate[]  // inverse relation for Kanban board queries
}
```

**Rationale:**
- `hiring_stage_id` is **nullable initially** to support data migration without blocking deployment
- `onDelete: SetNull` because if a stage is deleted, we preserve candidate history (don't cascade delete)
- Index on (tenantId, jobId, hiringStageId) enables efficient Kanban board queries: "show all candidates for job X in stage Y"
- Field name `hiringStageId` follows camelCase convention in Prisma model

### 2. Migration Sequence (PostgreSQL)

**Migration 1: Add column + foreign key (blocking)**
```sql
-- Add hiring_stage_id column to candidates table (nullable for data migration)
ALTER TABLE "candidates" ADD COLUMN "hiring_stage_id" UUID;

-- Add FK constraint to job_stages table
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_hiring_stage_id_fkey"
  FOREIGN KEY ("hiring_stage_id") REFERENCES "job_stages"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Create index for Kanban board queries
CREATE INDEX "idx_candidates_tenant_job_stage"
  ON "candidates"("tenant_id", "job_id", "hiring_stage_id");
```

**Migration 2: Backfill existing data (non-blocking)**
```sql
-- Assign first stage (lowest order) to all candidates with a job_id
UPDATE "candidates" c
SET "hiring_stage_id" = (
  SELECT id FROM "job_stages" js
  WHERE js."job_id" = c."job_id"
  ORDER BY js."order" ASC
  LIMIT 1
)
WHERE c."job_id" IS NOT NULL
  AND c."hiring_stage_id" IS NULL;

-- Report on data migration success
SELECT COUNT(*) AS candidates_assigned
FROM "candidates"
WHERE "job_id" IS NOT NULL AND "hiring_stage_id" IS NOT NULL;
```

**Migration 3: Add NOT NULL constraint (blocking)**
```sql
-- After backfill is verified, enforce that hiring_stage_id is NOT NULL
-- when job_id is NOT NULL (checked constraint)
ALTER TABLE "candidates"
ADD CONSTRAINT "check_hiring_stage_when_job_assigned"
CHECK (("job_id" IS NULL) OR ("hiring_stage_id" IS NOT NULL));

-- If you want to go stricter: make hiring_stage_id NOT NULL outright
-- ALTER TABLE "candidates" ALTER COLUMN "hiring_stage_id" SET NOT NULL;
-- But this requires all candidates to have a stage, even those without jobs
```

**Why three migrations:**
1. **Migration 1** is safe to deploy immediately (nullable column + FK)
2. **Migration 2** runs asynchronously (data backfill, can be retried)
3. **Migration 3** enforces the constraint after verification (safety gate)

**Alternative: Single transaction approach** (if you prefer atomicity):
```sql
-- All-in-one: add column, backfill, make NOT NULL
ALTER TABLE "candidates" ADD COLUMN "hiring_stage_id" UUID NOT NULL DEFAULT (
  SELECT id FROM "job_stages" js
  WHERE js."job_id" = candidates."job_id"
  ORDER BY js."order" ASC
  LIMIT 1
);
-- Then remove DEFAULT and add FK
ALTER TABLE "candidates" ALTER COLUMN "hiring_stage_id" DROP DEFAULT;
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_hiring_stage_id_fkey"
  FOREIGN KEY ("hiring_stage_id") REFERENCES "job_stages"("id") ON DELETE SET NULL;
```

**Recommendation:** Use three-step approach for safety: allows rollback at each stage if data migration shows issues.

### 3. Migration Risks & Data Integrity

**Risk 1: Candidates without job_id**
- Current schema allows Candidate.jobId = NULL (email intake flow creates candidates before job assignment)
- Migration 2 backfill only touches WHERE jobId IS NOT NULL
- After migration, these candidates will have hiring_stage_id = NULL (which is valid)

**Risk 2: Candidates with job_id but no matching first stage**
- Scenario: Job exists but has no JobStage records (schema violation — should not happen per Phase 11)
- Backfill would leave hiring_stage_id = NULL for these candidates
- **Mitigation:** Phase 11 must validate that every Job has at least one JobStage. Seed confirms this pattern.

**Risk 3: Stage reordering**
- If stage `order` values change after backfill, candidates stay in their stage (no auto-migration)
- This is correct behavior per CONTEXT.md: "Stage reordering: candidates stay in their stage"

**Risk 4: Large candidate datasets**
- Migration 2 backfill is O(n) where n = candidate count with job_id
- On current seed data (~2 candidates): negligible
- On production with 100K candidates: should complete in < 1s (index on (jobId, order) helps subquery)

## Service Logic Changes Required

### CandidatesService.createCandidate() (lines 131-240)

**Current behavior:**
```typescript
// Line 138: Pre-validate job exists
const job = await this.prisma.job.findFirst({});
// ^^^ BUG: should filter by tenantId and id

// Lines 181-215: Create candidate + application in transaction
const { candidate, application } = await this.prisma.$transaction(async (tx) => {
  const candidate = await tx.candidate.create({
    data: {
      id: candidateId,
      tenantId,
      jobId: dto.job_id,  // ← job_id from request
      // ... other fields ...
    },
  });

  const application = await tx.application.create({
    data: {
      tenantId,
      candidateId: candidate.id,
      jobId: dto.job_id,
      stage: 'new',  // D-04: hardcoded default stage
      // jobStageId intentionally NOT set (Application entity not used in Phase 12)
    },
  });

  return { candidate, application };
});
```

**Changes needed:**

1. **Query for first JobStage** (inside transaction):
```typescript
// After candidate is created, find first JobStage for this job
const firstStage = await tx.jobStage.findFirst({
  where: {
    jobId: dto.job_id,
    tenantId,  // tenant isolation
  },
  orderBy: { order: 'asc' },
  select: { id: true },
});
```

2. **Assign hiring_stage_id**:
```typescript
// Update candidate with hiring_stage_id (or include in create)
const candidateWithStage = await tx.candidate.update({
  where: { id: candidate.id },
  data: { hiringStageId: firstStage?.id ?? null },  // null if no stage exists
});

// OR: include hiringStageId in the initial create() call
const candidate = await tx.candidate.create({
  data: {
    // ... existing fields ...
    hiringStageId: firstStage?.id ?? null,
  },
});
```

3. **Error handling:**
```typescript
// If job_id is provided but no first stage exists, should we:
// A) Allow it (hiringStageId = null, candidate created)
// B) Reject with error (require at least one stage per job)
// → Recommendation: Option A (defensive), with warning in logs
// → Phase 11 guarantees all jobs have stages, but don't assume it

if (!firstStage && dto.job_id) {
  this.logger.warn(
    `Candidate created with job_id ${dto.job_id} but no hiring stages found. ` +
    `Candidate will have hiringStageId=null.`
  );
}
```

**Updated flow (pseudocode):**
```typescript
async createCandidate(dto: CreateCandidateDto, file?: Express.Multer.File) {
  // ... existing validation (job exists, email unique) ...

  const { candidate, application } = await this.prisma.$transaction(async (tx) => {
    // 1. Create candidate
    const candidate = await tx.candidate.create({
      data: {
        // ... existing fields ...
        jobId: dto.job_id,
        // hiringStageId will be null for now, assigned below
      },
    });

    // 2. If job_id is set, find first stage and assign
    let hiringStageId: string | null = null;
    if (dto.job_id) {
      const firstStage = await tx.jobStage.findFirst({
        where: { jobId: dto.job_id, tenantId },
        orderBy: { order: 'asc' },
        select: { id: true },
      });
      hiringStageId = firstStage?.id ?? null;

      // Update candidate with stage
      if (hiringStageId) {
        await tx.candidate.update({
          where: { id: candidate.id },
          data: { hiringStageId },
        });
      }
    }

    // 3. Create application (existing behavior)
    const application = await tx.application.create({
      data: {
        tenantId,
        candidateId: candidate.id,
        jobId: dto.job_id,
        stage: 'new',
      },
    });

    return { candidate, application };
  });

  // 4. Return response with hiring_stage_id included
  return {
    // ... existing response fields ...
    hiring_stage_id: /* fetch from updated candidate or remember from above */,
  };
}
```

**Alternative approach (cleaner):**
- Pre-fetch firstStage BEFORE transaction starts (read-only query)
- Pass it into the transaction
- Include hiringStageId in initial candidate.create() call
- No need for update() inside transaction

```typescript
// Before transaction
const firstStage = dto.job_id
  ? await this.prisma.jobStage.findFirst({
      where: { jobId: dto.job_id, tenantId },
      orderBy: { order: 'asc' },
      select: { id: true },
    })
  : null;

// Inside transaction
const candidate = await tx.candidate.create({
  data: {
    // ... fields ...
    hiringStageId: firstStage?.id ?? null,
  },
});
```

**Recommendation:** Use the alternative approach (pre-fetch) for cleaner code and fewer DB roundtrips.

### CandidatesService.findAll() — GET /api/candidates (lines 40-129)

**Current behavior:**
- Selects: id, fullName, email, phone, currentRole, location, cvFileUrl, source, createdAt, skills, applications (nested scores), duplicateFlags
- Returns snake_case response with computed ai_score and is_duplicate
- **Does NOT include:** job_id, hiring_stage_id, hiring_stage_name

**Changes needed:**

1. **Add to SELECT:**
```typescript
select: {
  id: true,
  fullName: true,
  email: true,
  // ... existing fields ...
  jobId: true,  // NEW
  hiringStageId: true,  // NEW
  hiringStage: {  // NEW (optional, for hiring_stage_name)
    select: { name: true },
  },
  // ... rest of existing selects ...
},
```

2. **Add to response mapping:**
```typescript
const result: CandidateResponse[] = candidates.map((c) => {
  // ... existing mappings ...
  return {
    id: c.id,
    full_name: c.fullName,
    // ... existing fields ...
    job_id: c.jobId,  // NEW (can be null)
    hiring_stage_id: c.hiringStageId,  // NEW (can be null after migration)
    hiring_stage_name: c.hiringStage?.name ?? null,  // NEW (optional convenience)
    // ... rest of existing fields ...
  };
});
```

3. **Update CandidateResponse interface:**
```typescript
export interface CandidateResponse {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  current_role: string | null;
  location: string | null;
  cv_file_url: string | null;
  source: string;
  created_at: Date;
  ai_score: number | null;
  is_duplicate: boolean;
  skills: string[];

  // NEW FIELDS FOR KANBAN BOARD
  job_id: string | null;
  hiring_stage_id: string | null;
  hiring_stage_name: string | null;
}
```

**Kanban board response example:**
```json
{
  "candidates": [
    {
      "id": "cand-uuid-1",
      "full_name": "Yael Cohen",
      "email": "yael.cohen@example.com",
      "job_id": "job-uuid-1",
      "hiring_stage_id": "stage-uuid-1",
      "hiring_stage_name": "Application Review",
      "ai_score": 85,
      "is_duplicate": false,
      "skills": ["TypeScript", "React"],
      "created_at": "2026-03-26T10:00:00Z"
    },
    {
      "id": "cand-uuid-2",
      "full_name": "Noam Levy",
      "email": "noam.levy@example.com",
      "job_id": "job-uuid-2",
      "hiring_stage_id": "stage-uuid-2",
      "hiring_stage_name": "Screening",
      "ai_score": 72,
      "is_duplicate": false,
      "skills": ["Product Strategy"],
      "created_at": "2026-03-26T10:05:00Z"
    },
    {
      "id": "cand-uuid-3",
      "full_name": "Email-intake candidate",
      "email": "unknown@example.com",
      "job_id": null,
      "hiring_stage_id": null,
      "hiring_stage_name": null,
      "ai_score": null,
      "is_duplicate": false,
      "skills": [],
      "created_at": "2026-03-26T10:10:00Z"
    }
  ],
  "total": 3
}
```

**Performance notes:**
- Including hiringStage relation adds 1 JOIN per candidate
- Current query already does 2 nested relations (applications + scores)
- Impact: minimal (1 additional LEFT JOIN on job_stages)
- Index on (jobId, order) ensures efficient stage lookup

### Other Services (Scan for candidate creation)

**GrepSearch for candidate creation patterns:**

Need to check if other services create candidates:
- IngestionProcessor (Phase 1 email pipeline) — creates candidates from CV extraction
- Any other background workers?

**Expected changes:**
- If IngestionProcessor.createCandidate() exists, it should also query for first stage
- OR: Extract common logic into a helper method `getFirstStageForJob(jobId, tenantId): Promise<string | null>`

## API Contract Changes

### GET /api/candidates (Extended Response)

**Current URL:** `GET /api/candidates?q=<search>&filter=<filter>`

**Current response:**
```typescript
{
  candidates: [
    {
      id: string,
      full_name: string,
      email: string | null,
      phone: string | null,
      current_role: string | null,
      location: string | null,
      cv_file_url: string | null,
      source: string,
      created_at: Date,
      ai_score: number | null,
      is_duplicate: boolean,
      skills: string[]
    }
  ],
  total: number
}
```

**New response (additive):**
```typescript
{
  candidates: [
    {
      id: string,
      full_name: string,
      email: string | null,
      phone: string | null,
      current_role: string | null,
      location: string | null,
      cv_file_url: string | null,
      source: string,
      created_at: Date,
      ai_score: number | null,
      is_duplicate: boolean,
      skills: string[],

      // NEW FIELDS
      job_id: string | null,
      hiring_stage_id: string | null,
      hiring_stage_name: string | null
    }
  ],
  total: number
}
```

**Breaking changes:** NONE (additive fields only)

**Backward compatibility:** Existing API consumers will receive additional fields but their code won't break (assuming they ignore unknown fields, which is standard)

**New filtering capability (future):** Could add `?stage_id=<stage_uuid>` query param to filter by stage, but that's out of scope for Phase 13

### POST /api/candidates (Existing, No Changes Needed)

**Current request:**
```typescript
{
  full_name: string,
  email: string | null,
  phone: string | null,
  current_role: string | null,
  location: string | null,
  years_experience: number | null,
  skills: string[],
  job_id: string (UUID),
  source: enum,
  ai_summary: string | null,
  source_agency: string | null
}
```

**Changes needed:** NONE

**Note:** `job_id` is already required in CreateCandidateSchema (line 10 of create-candidate.dto.ts). The service will auto-assign hiring_stage_id during creation, but the API contract doesn't need to change.

**Response behavior:**
- If hiring_stage_id is successfully assigned, it will appear in response (line 239)
- If no stage exists for the job, hiring_stage_id will be null in response
- Response should include hiring_stage_id for transparency

```typescript
// POST /api/candidates response (updated)
{
  id: string,
  tenant_id: string,
  job_id: string,
  full_name: string,
  // ... existing fields ...
  hiring_stage_id: string | null,  // NEW
  created_at: Date,
  updated_at: Date,
  application_id: string
}
```

## Edge Cases & Data Integrity Strategy

### Edge Case 1: Candidate without job_id (email intake flow)

**Scenario:**
- Candidate created via email intake pipeline without job assignment (jobId = NULL)
- Later, recruiter assigns candidate to a job via UI
- What happens to hiring_stage_id?

**Current behavior:**
- hiringStageId stays NULL until explicitly updated

**Mitigation strategies:**

**Option A: Auto-assign on job update (add logic to update endpoint)**
```typescript
// In candidates-controller or jobs-controller
async assignCandidateToJob(candidateId: string, jobId: string) {
  const firstStage = await this.prisma.jobStage.findFirst({
    where: { jobId, tenantId },
    orderBy: { order: 'asc' },
  });

  await this.prisma.candidate.update({
    where: { id: candidateId },
    data: {
      jobId,
      hiringStageId: firstStage?.id ?? null,
    },
  });
}
```

**Option B: App logic handles it (UI calls two endpoints)**
- UI updates jobId
- UI fetches first stage and updates hiringStageId separately

**Recommendation:** Option A (auto-assign on job update). Out of scope for Phase 13, but should be noted as a future task.

### Edge Case 2: Stage deletion (JobStage soft-delete vs. hard-delete)

**Scenario:**
- Job has 3 stages: [Review, Screening, Interview]
- 10 candidates are in the "Screening" stage
- Recruiter deletes "Screening" stage

**Current behavior with `onDelete: SetNull`:**
- All 10 candidates get hiringStageId = NULL
- Kanban board will show them in an "Unassigned" column or hide them

**Alternative: Cascade deletion (not recommended)**
- `onDelete: Cascade` would delete the candidates entirely
- This loses data and is unacceptable

**Alternative: Prevent deletion if candidates exist**
- Application-level constraint in service
- Reject stage deletion if candidates.where({ hiringStageId }) exists

**Best approach (future):**
1. Soft-delete stages (add `isDeleted` flag to JobStage)
2. When stage is soft-deleted, migrate candidates to next enabled stage
3. Hard delete only when no candidates refer to the stage

**For Phase 13:** Accept the SetNull behavior. Document that stage deletion orphans candidates (they show in "Unassigned" column). Add warning in JobsService.deleteJob() or a future deleteJobStage() endpoint.

### Edge Case 3: Candidates with job_id but orphaned stage reference

**Scenario:**
- Data corruption or migration error leaves candidate with jobId=X but hiringStageId pointing to a stage in jobId=Y

**Prevention:**
- Add CHECK constraint to enforce consistency:
```sql
ALTER TABLE "candidates" ADD CONSTRAINT "hiring_stage_belongs_to_job_check"
CHECK (
  "job_id" IS NULL
  OR "hiring_stage_id" IS NULL
  OR EXISTS (
    SELECT 1 FROM "job_stages" js
    WHERE js.id = "hiring_stage_id" AND js.job_id = "job_id"
  )
);
```

**For Phase 13:** This is a nice-to-have. Prioritize getting the basic migration working first. Add this constraint in a follow-up migration if validation audit shows a need.

### Edge Case 4: Race condition during candidate creation

**Scenario:**
- Request 1 starts creating candidate with jobId=X (no stages exist yet)
- Request 2 simultaneously adds first stage to jobId=X
- Both requests complete — does candidate get a stage?

**Current implementation (transaction):**
- Both requests transaction-isolated
- Request 1 creates candidate before stage exists → hiringStageId=NULL
- Request 2's stage query runs in isolation

**Mitigation:**
- Rely on Postgres SERIALIZABLE isolation level (database handles it)
- OR: Pre-check that job has at least one stage before allowing candidate creation
- Phase 11 should guarantee all jobs have stages, so this shouldn't occur

**For Phase 13:** Not a concern if Phase 11 is solid. Document assumption: "Every Job with candidates has at least one JobStage."

## Migration Risk Assessment

### Data Backfill Analysis

**Candidates to backfill:** All existing candidates with jobId IS NOT NULL

**Current seed data:**
- Candidate 1: jobId = job1 (job1 has 8 stages) → will be assigned first stage (Application Review, order=1)
- Candidate 2: jobId = job2 (job2 has 8 stages) → will be assigned first stage (Application Review, order=1)

**Backfill SQL query execution plan:**
```sql
EXPLAIN ANALYZE
UPDATE "candidates" c
SET "hiring_stage_id" = (
  SELECT id FROM "job_stages" js
  WHERE js."job_id" = c."job_id"
  ORDER BY js."order" ASC
  LIMIT 1
)
WHERE c."job_id" IS NOT NULL
  AND c."hiring_stage_id" IS NULL;
```

**Expected plan:**
- Seq scan on candidates (filter by jobId IS NOT NULL)
- For each candidate: Index lookup on (job_id, order) in job_stages
- UPDATE with new hiringStageId

**Performance:** O(n) where n = candidates with jobId, estimated < 1s on seed data, < 10s on 100K candidates with proper index

### Deployment Safety Checklist

- [ ] Migration 1 deployed (add nullable column + FK)
- [ ] Verify candidates table schema includes hiring_stage_id
- [ ] Run Migration 2 backfill in a maintenance window (or as async job post-deploy)
- [ ] Verify backfill SQL returns expected row count
- [ ] Sample 10 candidates with jobId and verify they have hiringStageId assigned
- [ ] Migration 3 deployed (add CHECK constraint)
- [ ] CandidatesService.createCandidate() deployed (includes stage auto-assignment logic)
- [ ] GET /api/candidates deployed (includes hiring_stage_id in response)
- [ ] Run existing tests (ensure no regressions)
- [ ] Test Kanban board endpoint against updated API response
- [ ] Monitor logs for warnings about candidates with null hiring_stage_id

### Rollback Plan

**If Migration 1 causes issues:**
```sql
-- Rollback: drop new column
ALTER TABLE "candidates" DROP COLUMN "hiring_stage_id" CASCADE;
```

**If Migration 2 backfill shows issues (e.g., rows not updated as expected):**
```sql
-- Retry backfill with logging
UPDATE "candidates" c
SET "hiring_stage_id" = (
  SELECT id FROM "job_stages" js
  WHERE js."job_id" = c."job_id"
  ORDER BY js."order" ASC
  LIMIT 1
)
WHERE c."job_id" IS NOT NULL
  AND c."hiring_stage_id" IS NULL
RETURNING id, job_id, hiring_stage_id;  -- see what was updated
```

**If Migration 3 constraint is too strict:**
```sql
-- Drop constraint
ALTER TABLE "candidates" DROP CONSTRAINT "check_hiring_stage_when_job_assigned";
-- Re-examine data and try again
```

## Implementation Sequence

### Wave 1: Schema Additive (Non-Blocking)
1. Generate migration: add `hiring_stage_id` nullable column
2. Add FK constraint to job_stages
3. Create compound index on (tenantId, jobId, hiringStageId)
4. Update Prisma schema.prisma (add field + relation)
5. Run `npx prisma migrate dev` locally to validate

### Wave 2: Data Backfill (Non-Blocking, Can Run Async)
1. Create separate migration file for backfill SQL
2. Execute backfill with verification query
3. Log row count updated for audit trail
4. Option: Run as a BullMQ job or scheduled task post-deploy

### Wave 3: Service Logic (Blocking on Wave 2)
1. Update CandidatesService.createCandidate():
   - Pre-fetch first JobStage for the job
   - Include hiringStageId in candidate.create()
   - Add error handling for missing stages
2. Add unit tests for stage assignment logic
3. Update CandidatesService.findAll():
   - Add jobId, hiringStageId, hiringStage to SELECT
   - Update CandidateResponse interface
   - Map response fields to snake_case

### Wave 4: API Response (Blocking on Wave 3)
1. Test GET /api/candidates with sample data
2. Verify Kanban board can parse job_id and hiring_stage_id
3. Verify POST /api/candidates returns hiring_stage_id in response
4. Update integration tests to verify stage assignment

### Wave 5: Constraint Enforcement (Blocking on Waves 3-4)
1. Create migration: add CHECK constraint for data integrity
2. Option: Make hiring_stage_id NOT NULL (if acceptable to downtime)
3. Or: Keep nullable with constraint to allow null job_id cases

### Wave 6: Validation & Testing (Blocking on Wave 5)
1. Run full test suite
2. Manual smoke test with Kanban board UI
3. Verify backward compatibility (existing clients unaffected)
4. Monitor for warnings about null hiring_stage_id

## Common Pitfalls

### Pitfall 1: Forgetting Tenant Isolation in Stage Lookup

**What goes wrong:** Query for first stage doesn't include tenantId filter
```typescript
// WRONG
const firstStage = await tx.jobStage.findFirst({
  where: { jobId: dto.job_id },  // missing tenantId!
  orderBy: { order: 'asc' },
});
```

**Why it happens:** Easy to forget multi-tenancy context when working with FK lookups

**How to avoid:** Always include tenantId in WHERE clauses, even when jobId is present (job might exist in multiple tenants)

**Verification step:** Grep for `jobStage.findFirst` and verify all include `tenantId` filter

### Pitfall 2: Backfill SQL Assigns Wrong Stage (Due to Missing ORDER BY)

**What goes wrong:** Backfill assigns random stage instead of first stage
```sql
-- WRONG: no ORDER BY, subquery returns any stage
UPDATE "candidates" c SET "hiring_stage_id" = (
  SELECT id FROM "job_stages" js WHERE js.job_id = c.job_id LIMIT 1
);
```

**Why it happens:** Copy-paste error or SQL typo

**How to avoid:** Always include `ORDER BY order ASC` in first-stage queries

**Verification step:** Run backfill query on dev database, spot-check 5 random candidates and verify they have stage with order=1

### Pitfall 3: Missing Index Causes N+1 Query Problem

**What goes wrong:** GET /api/candidates becomes slow as candidate count grows
- Outer loop: fetch all candidates
- Inner loop: for each candidate, fetch hiring stage (N separate queries)

**Why it happens:** If hiringStage relation is eagerly loaded but index is missing

**How to avoid:** Verify `@@index([jobId, order])` exists on JobStage before Phase 13

**Verification step:** EXPLAIN ANALYZE on stage lookup query with order=1 index, confirm index scan not seq scan

### Pitfall 4: Stage Assignment Fails Silently (firstStage?.id ?? null)

**What goes wrong:** Candidate created with hiringStageId=null even though stages exist
- Kanban board can't render candidate
- Difficult to debug in production

**Why it happens:** Logger not warning about missing stages

**How to avoid:** Add explicit logging when firstStage is null
```typescript
if (!firstStage && dto.job_id) {
  this.logger.warn(`[Phase13] Candidate ${candidateId} assigned to job ${dto.job_id} but no stages found`);
}
```

**Verification step:** Unit test with mock job that has no stages, verify logger.warn called

### Pitfall 5: Updating GET /api/candidates Forgets to Map hiring_stage_id

**What goes wrong:** Response includes jobId but not hiringStageId (incomplete Kanban data)

**Why it happens:** Copy-paste from jobId mapping, forgot to also add hiringStageId

**How to avoid:** Add both fields in same code block, comment "Kanban board fields"

**Verification step:** Integration test for GET /api/candidates, assert response includes hiring_stage_id field

### Pitfall 6: Constraint Check is Too Strict (False Constraint)

**What goes wrong:** CHECK constraint `hiring_stage belongs to job` prevents valid edge cases
- Candidate with jobId=X but hiringStageId=null (valid during creation)
- Candidate with jobId=null but hiringStageId=Y (orphaned, but shouldn't occur)

**Why it happens:** Writing constraint without considering nullable cases

**How to avoid:** Test constraint with sample data before deploying
```sql
-- Test: Candidate with jobId=null, hiringStageId=null (should pass)
INSERT INTO candidates (...) VALUES (..., NULL, NULL);

-- Test: Candidate with jobId=X, hiringStageId in jobId=X (should pass)
INSERT INTO candidates (...) VALUES (..., job-uuid-1, stage-uuid-1-for-job-1);

-- Test: Candidate with jobId=X, hiringStageId in jobId=Y (should fail)
INSERT INTO candidates (...) VALUES (..., job-uuid-1, stage-uuid-for-job-2); -- ERROR
```

**Verification step:** Manual SQL insert tests before deployment

## Code Examples

### Example 1: Querying Candidates by Kanban Column (Composite Key)

**Use case:** Frontend requests "Show all candidates for job X in stage Y"

**Efficient query:**
```typescript
// From CandidatesService or new KanbanService
async getCandidatesForStage(jobId: string, stageId: string): Promise<CandidateResponse[]> {
  const tenantId = this.configService.get<string>('TENANT_ID')!;

  const candidates = await this.prisma.candidate.findMany({
    where: {
      tenantId,
      jobId,
      hiringStageId: stageId,
    },
    select: {
      // ... existing fields ...
      jobId: true,
      hiringStageId: true,
      hiringStage: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return candidates.map(c => ({
    // ... mapping ...
  }));
}
```

**Index used:** `idx_candidates_tenant_job_stage` on (tenantId, jobId, hiringStageId)

### Example 2: Auto-Assigning First Stage on Candidate Creation

**Pattern:** Helper function to get first stage, call during candidate creation

```typescript
// Helper: Extract to service method for reuse
private async getFirstStageForJob(jobId: string): Promise<{ id: string } | null> {
  const tenantId = this.configService.get<string>('TENANT_ID')!;

  return this.prisma.jobStage.findFirst({
    where: {
      tenantId,
      jobId,
      isEnabled: true,  // Optional: only enabled stages
    },
    orderBy: { order: 'asc' },
    select: { id: true },
  });
}

// Inside createCandidate (after file upload, before transaction)
const hiringStageForJob = dto.job_id ? await this.getFirstStageForJob(dto.job_id) : null;

// Inside transaction
const candidate = await tx.candidate.create({
  data: {
    // ... existing fields ...
    hiringStageId: hiringStageForJob?.id ?? null,
  },
});
```

### Example 3: Backfill SQL with Verification

```sql
-- Phase 13 Migration: Backfill hiring_stage_id for existing candidates

BEGIN;

-- Count before
SELECT COUNT(*) as before_count
FROM candidates
WHERE job_id IS NOT NULL AND hiring_stage_id IS NULL;

-- Backfill
UPDATE candidates c
SET hiring_stage_id = (
  SELECT id FROM job_stages js
  WHERE js.job_id = c.job_id
  AND js.tenant_id = c.tenant_id
  ORDER BY js."order" ASC
  LIMIT 1
)
WHERE c.job_id IS NOT NULL
  AND c.hiring_stage_id IS NULL;

-- Verify: show sample of updated candidates
SELECT c.id, c.full_name, c.job_id, c.hiring_stage_id, js.name, js."order"
FROM candidates c
LEFT JOIN job_stages js ON js.id = c.hiring_stage_id
WHERE c.job_id IS NOT NULL
LIMIT 10;

-- Count after
SELECT COUNT(*) as after_count
FROM candidates
WHERE job_id IS NOT NULL AND hiring_stage_id IS NOT NULL;

COMMIT;
```

### Example 4: GET /api/candidates Response with Kanban Fields

```typescript
// CandidatesService.findAll() response mapping
const result: CandidateResponse[] = candidates.map((c) => {
  const allScores = c.applications.flatMap((a) => a.scores.map((s) => s.score));
  const aiScore = allScores.length > 0 ? Math.max(...allScores) : null;

  return {
    id: c.id,
    full_name: c.fullName,
    email: c.email,
    phone: c.phone,
    current_role: c.currentRole,
    location: c.location,
    cv_file_url: c.cvFileUrl,
    source: c.source,
    created_at: c.createdAt,
    ai_score: aiScore,
    is_duplicate: c.duplicateFlags.length > 0,
    skills: c.skills,

    // NEW: Kanban board fields
    job_id: c.jobId,
    hiring_stage_id: c.hiringStageId,
    hiring_stage_name: c.hiringStage?.name ?? null,
  };
});
```

## State of the Art / Known Patterns

| Pattern | Current Approach | Kanban-Related Change |
|---------|------------------|----------------------|
| Tenant isolation | tenantId on every query | ✓ Required in stage lookup |
| Multi-step data migration | Nullable column → backfill → constraint | ✓ Following same pattern |
| Eager relation loading | Select nested (e.g., applications) | ✓ Add hiringStage to select |
| Index strategy | Composite indexes on FK + filter | ✓ Add (tenantId, jobId, hiringStageId) |
| Error handling | Service throws specific exceptions | ✓ Handle missing stages gracefully |

## Open Questions

1. **Should we prevent candidate creation if job has no stages?**
   - Currently: Allow (hiringStageId = null)
   - Alternative: Reject with error
   - Decision needed: Defensive vs. strict

2. **What happens to candidates when a JobStage is deleted?**
   - Currently: hiringStageId = NULL (onDelete: SetNull)
   - Alternative: Migrate to next stage, or prevent deletion
   - Future phase: Implement soft-delete for stages

3. **Should we auto-assign stage when candidate jobId is updated (post-creation)?**
   - Currently: Out of scope for Phase 13
   - Future: Add endpoint to assign candidate to job + auto-stage
   - Note: Email intake candidates (jobId=null) will need this

4. **Performance tuning for large candidate datasets:**
   - Estimate: 100K candidates, 5K candidates per job
   - Index strategy: (tenantId, jobId, hiringStageId) covers Kanban queries
   - Consider: Pagination for GET /api/candidates if not already implemented

5. **Should hiring_stage_name be required in response, or optional for API contracts?**
   - Currently: Optional (can be null)
   - Kanban board: Needs name for display
   - Decision: Frontend can either use name from response OR fetch job stages separately

## Environment Availability

**No external dependencies identified** (schema changes only, no new external services or runtimes required)

**Verification:** All changes are SQL + TypeScript within existing stack (PostgreSQL, Prisma, NestJS).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest (with node-ts-jest) |
| Config file | jest.config.json |
| Quick run command | `npm test -- src/candidates/candidates.service.spec.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-13-01 | Candidate model includes hiring_stage_id field | Schema validation | `npx prisma migrate diff --from-empty --to-schema-file ./prisma/schema.prisma` | ✅ (schema.prisma) |
| REQ-13-02 | Auto-assign first stage on candidate creation | Unit | `npm test -- src/candidates/candidates.service.spec.ts -t "assigns.*first.*stage"` | ❌ Wave 0 |
| REQ-13-03 | GET /api/candidates includes job_id, hiring_stage_id | Integration | `npm test -- src/candidates/candidates.integration.spec.ts -t "includes.*stage.*fields"` | ❌ Wave 0 |
| REQ-13-04 | Prevent null hiring_stage_id when job_id is set | Schema constraint | Manual SQL: `INSERT INTO candidates (..., job_id, hiring_stage_id) VALUES (..., uuid, null)` should fail | ❌ Wave 0 |
| REQ-13-05 | Backward compatibility: existing API consumers unaffected | Regression | `npm test -- src/candidates/candidates.integration.spec.ts` (all existing tests pass) | ✅ (candidates.integration.spec.ts) |

### Sampling Rate
- **Per task commit:** `npm test -- src/candidates/candidates.service.spec.ts` (unit tests for stage assignment)
- **Per wave merge:** `npm test` (full test suite)
- **Phase gate:** Full suite green + manual Kanban board test before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/candidates/candidates.service.spec.ts` — add test for `createCandidate()` with auto-stage assignment (REQ-13-02)
- [ ] `src/candidates/candidates.integration.spec.ts` — add test for GET /api/candidates response includes hiring_stage_id (REQ-13-03)
- [ ] Data integrity test: Verify CHECK constraint prevents orphaned stage references
- [ ] Migration test: Seed data, run backfill, verify all candidates with jobId have hiringStageId assigned

## Sources

### Primary (HIGH confidence)
- **schema.prisma** — Current Candidate and JobStage model definitions, relation structures, existing indexes
- **candidates.service.ts** — Current implementation of CandidatesService.createCandidate() and findAll()
- **candidates.service.spec.ts** — Existing test patterns and test structure
- **jobs.service.ts** — JobStage creation patterns and default stage definitions
- **prisma/seed.ts** — Data patterns and default stage ordering (order: 1-based)
- **Latest migration (20260326100000_add_job_id_to_candidate)** — Migration pattern for additive schema changes
- **CONTEXT.md** — Product requirements and locked decisions for Phase 13

### Secondary (MEDIUM confidence)
- **create-candidate.dto.ts** — Current DTO schema and validation patterns

## Metadata

**Confidence breakdown:**
- **Standard stack:** HIGH — Tech stack locked in CLAUDE.md, Prisma patterns established in Phase 11-12
- **Schema changes:** HIGH — Current schema analyzed, migration pattern verified from recent migrations
- **Service logic:** HIGH — CandidatesService implementation examined, clear pattern for changes
- **API contract:** HIGH — Current response structure analyzed, breaking changes avoided
- **Migration strategy:** MEDIUM — Based on existing migration patterns, but backfill complexity depends on production data volume

**Research date:** 2026-03-26
**Valid until:** 2026-04-02 (7 days, fast-moving API layer — test carefully before implementation)

**Key assumptions:**
1. Every Job with candidates has at least one JobStage (Phase 11 guarantee)
2. jobId FK on Candidate remains nullable (supports email intake flow)
3. GET /api/candidates response additions won't break existing clients (additive fields)
4. Postgres CHECK constraints are preferred for multi-tenant data consistency
