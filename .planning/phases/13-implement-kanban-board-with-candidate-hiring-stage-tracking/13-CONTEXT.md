# Phase 13 Context: Implement Kanban board with candidate hiring stage tracking

**Created:** 2026-03-26
**Status:** Planning
**Depends on:** Phase 11 (Job management API MVP)

## Product Requirements

The Kanban board MVP requires candidates to be visually organized by their current hiring stage within a job. Currently, candidates are linked to jobs but the system doesn't track which hiring stage each candidate is in, making board visualization impossible.

### Requirement 1: Architecture Simplification
**For this MVP, bypass the complex `Application` entity.**

- Track the candidate's current hiring stage directly on the Candidate entity itself
- Add `hiring_stage_id` foreign key to Candidate model pointing to JobStage
- This simplification allows rapid MVP iteration without the overhead of Application entity state machine

### Requirement 2: Default Placement (Creation Flow)
**Whenever a new candidate is added to a job, auto-assign them to the first hiring stage.**

- When creating a candidate with a `job_id`, automatically query for the first JobStage (by `position` order) for that job
- Assign that stage as the candidate's initial `hiring_stage_id`
- This ensures candidates never exist in a "stageless" limbo state
- First stage by position order = stage with lowest `position` value

### Requirement 3: UI Integration (Fetch Flow)
**Ensure API payload includes stage identifiers for Kanban board rendering.**

- GET /api/candidates response must include:
  - `job_id` (which job the candidate belongs to)
  - `hiring_stage_id` (which column they belong in on the Kanban board)
  - `hiring_stage_name` or similar (optional: for display)
- Kanban board uses these identifiers to render candidates in correct columns without additional API calls
- Payload structure must allow efficient rendering: `[candidate with job_id + hiring_stage_id]`

## Current State

**Completed in Phase 11:**
- Job model with `jobStages` relation (many-to-many via JobStage model)
- JobStage model with `position` field (1-based ordering for stage sequence)
- GET /api/jobs returns complete job data with nested hiring_flow (stages)
- GET /api/candidates endpoint exists (returns candidate list)

**Application entity:**
- Exists in schema but NOT used in Phase 12 MVP (add candidate from UI)
- Will NOT be used in Phase 13 MVP (Kanban board) — bypassed per architecture decision
- Future phases may revisit Application entity for advanced workflows

## Database Schema Changes Required

### Candidate model changes:
1. Add `hiring_stage_id` field (FK to JobStage, nullable initially for migrations)
2. Add constraint: if `job_id` is set, `hiring_stage_id` must also be set (after data migration)
3. Ensure index on `(job_id, hiring_stage_id)` for efficient Kanban board queries

### Candidate table constraints:
- `job_id` already exists (from Phase 12)
- `hiring_stage_id` references JobStage.id
- Both must be non-null after migration (except during initial phase-in)

## Service Logic Changes Required

### CandidatesService:
- Modify `create()` or relevant creation method to accept `job_id`
- When `job_id` is provided, query JobStage for that job with lowest `position`
- Assign that stage as `hiring_stage_id` automatically
- Update `createCandidate()` in DTO/service to handle this assignment

### JobsService (if needed):
- Ensure JobStage records always have `position` field set
- Validate that at least one stage exists per job (should be validated in Phase 11 already)

## API Contract Changes Required

### GET /api/candidates response structure:
```typescript
{
  id: string
  full_name: string
  email: string
  phone?: string
  job_id: string         // NEW: which job they're attached to
  hiring_stage_id: string // NEW: which stage they're in (for Kanban column)
  hiring_stage_name?: string // OPTIONAL: for UI convenience
  // ... existing fields
}
```

### POST /api/candidates (if applicable):
- Accept `job_id` in request body
- Automatically assign `hiring_stage_id` based on first stage
- Return assigned `hiring_stage_id` in response

## Edge Cases to Handle

1. **Candidate without stage:** Should not exist after migration — data integrity constraint
2. **Stage deletion:** If a JobStage is deleted, candidates in that stage become orphaned
   - Mitigation: Soft-delete stages? Or migrate candidates to next stage? (Decision needed)
3. **Reordering stages:** If stage positions change, candidates stay in their stage (no auto-reassignment)
4. **Moving candidates between stages:** Kanban board UI will support drag-to-move (Phase 13+)

## Migration Strategy

### Additive only (Phase 11 constraint):
1. Create migration to add `hiring_stage_id` column to candidates table (nullable)
2. Populate existing candidates with first stage of their job (if job_id exists)
3. Add NOT NULL constraint and FK
4. Create index on (job_id, hiring_stage_id)

### Data migration step:
```sql
-- Pseudo-code for data backfill
UPDATE candidates c
SET hiring_stage_id = (
  SELECT id FROM job_stages js
  WHERE js.job_id = c.job_id
  ORDER BY js.position ASC
  LIMIT 1
)
WHERE c.job_id IS NOT NULL;
```

## Success Criteria (Phase 13)

1. ✓ Prisma schema updated: Candidate model has `hiring_stage_id` FK field
2. ✓ Migration created: adds column, backfills data, adds constraints
3. ✓ CandidatesService.create() assigns first stage automatically
4. ✓ GET /api/candidates includes `job_id` and `hiring_stage_id` in response
5. ✓ API response format tested: Kanban board can build column structure from response
6. ✓ Edge cases documented and handled
7. ✓ Zero impact on Phase 12 (add candidate from UI) or Phase 11 (job API)
8. ✓ All existing tests still pass; no breaking changes to API contract

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Stage deletion orphans candidates | Data integrity | Soft-delete stages or migrate candidates to next stage |
| Migration fails on null job_ids | Data loss | Backfill only WHERE job_id IS NOT NULL; handle nulls separately |
| API response size bloat | Performance | Test with 1000+ candidates; profile query performance |
| Kanban board assumes first stage exists | UX broken | Validate during job creation that at least one stage exists |

## Next Steps

1. Research technical approach (schema, migration, service logic)
2. Create detailed PLAN.md with task breakdown
3. Execute plan with atomic commits
4. Verify Kanban board can render candidates in correct columns

---

*Context gathered from product requirements provided 2026-03-26*
