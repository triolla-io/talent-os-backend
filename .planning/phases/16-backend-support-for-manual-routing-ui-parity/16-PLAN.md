---
phase: 16-backend-support-for-manual-routing-ui-parity
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/candidates/dto/candidate-response.dto.ts
  - src/jobs/jobs.service.ts
autonomous: true
requirements: [D-14]
user_setup: []

must_haves:
  truths:
    - "Job responses expose shortId field in GET /jobs and GET /jobs/:id"
    - "Candidate responses expose sourceAgency field in GET /candidates and GET /candidates/:id"
    - "CandidateResponse DTO remains flattened—NO nested applications array"
    - "ai_score calculated via Math.max of candidate_job_scores for current job"
  artifacts:
    - path: "src/jobs/jobs.service.ts"
      provides: "Job response formatting with shortId"
      min_lines: 5
    - path: "src/candidates/dto/candidate-response.dto.ts"
      provides: "CandidateResponse interface with sourceAgency, flattened format"
      min_lines: 5
  key_links:
    - from: "JobsService._formatJobResponse()"
      to: "shortId field"
      via: "add shortId to response object"
      pattern: "short_id|shortId"
    - from: "CandidateResponse interface"
      to: "sourceAgency field"
      via: "interface definition"
      pattern: "source_agency|sourceAgency"
---

<objective>
Extend response DTOs to expose shortId in Job responses and sourceAgency in Candidate responses. Verify response format remains flattened (no nested applications array) and ai_score is calculated correctly.

Purpose: Enable UI to display job identifiers and source channel information; confirm response contracts match Phase 16 requirements.
Output: Updated DTOs with shortId and sourceAgency fields; verified response format compliance.
</objective>

<execution_context>
@/Users/danielshalem/triolla/telent-os-backend/.claude/get-shit-done/workflows/execute-plan.md
@/Users/danielshalem/triolla/telent-os-backend/.planning/phases/16-backend-support-for-manual-routing-ui-parity/16-CONTEXT.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/15-migrate-email-ingestion-to-deterministic-job-id-routing-and-remove-semantic-matching/15-SUMMARY.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add shortId to JobResponse in JobsService._formatJobResponse()</name>
  <files>src/jobs/jobs.service.ts</files>
  <action>
  Edit JobsService._formatJobResponse() method (currently ~35 lines) to include shortId field in returned response object.

  Current response object has: id, title, department, location, job_type, status, hiring_manager, candidate_count, created_at, updated_at, description, responsibilities, what_we_offer, salary_range, must_have_skills, nice_to_have_skills, min_experience, max_experience, selected_org_types, screening_questions, hiring_flow.

  Add: short_id: job.shortId (snake_case) as a new field in the response mapping. This exposes the shortId that Phase 15 populates at job creation time.

  Per D-14: "Jobs endpoints expose shortId field in responses (used by Phase 15 email subject parsing; recruiters see this identifier)."
  </action>
  <verify>
  Run: npm test -- jobs.service.spec.ts --testNamePattern="formatJobResponse|shortId" (or manual grep: grep -n "short_id" src/jobs/jobs.service.ts should show the new field)
  Verify GET /jobs and GET /jobs/:id responses include short_id field in JSON payload.
  </verify>
  <done>shortId field added to JobsService._formatJobResponse() response object; exposed in all job response DTOs</done>
</task>

<task type="auto">
  <name>Task 2: Verify CandidateResponse DTO includes sourceAgency and confirm flattened format</name>
  <files>src/candidates/dto/candidate-response.dto.ts</files>
  <action>
  Read src/candidates/dto/candidate-response.dto.ts. Verify:

  1. sourceAgency is already present in CandidateResponse interface (check line 14: source_agency field)
  2. Response format is FLATTENED—NO nested applications array exists in the DTO
  3. ai_score is a direct field (number | null), not a computed property from nested data

  If sourceAgency is missing (unlikely given Phase 15 context), add it:
  source_agency: string | null;

  Current format shows: id, full_name, email, phone, current_role, location, cv_file_url, source, source_agency, created_at, ai_score, ai_summary, is_duplicate, skills, status, is_rejected, job_id, hiring_stage_id, hiring_stage_name, job_title, stage_summaries, years_experience.

  Confirm NO "applications" or "applicationHistory" fields exist. This is the flattened format per D-12.
  </action>
  <verify>
  grep -n "source_agency\|sourceAgency" src/candidates/dto/candidate-response.dto.ts (should find the field)
  grep -n "applications" src/candidates/dto/candidate-response.dto.ts (should return 0 results or only comments)
  npm test -- candidates.service.spec.ts (verify existing tests still pass, no breaking DTO changes)
  </verify>
  <done>CandidateResponse DTO confirmed: sourceAgency field present, format is flattened (no nested applications array)</done>
</task>

</tasks>

<verification>
**Wave 1 Verification:**
1. Job responses include short_id field: curl GET /jobs | jq '.jobs[0].short_id' (should return non-null string)
2. Candidate responses include source_agency field: curl GET /candidates | jq '.candidates[0].source_agency' (may be null, but field exists)
3. Candidate responses are flattened: curl GET /candidates/:id | jq 'has("applications")' (should return false)
4. ai_score is a direct field: curl GET /candidates/:id | jq '.ai_score' (should return number | null, not nested)
5. Test suite passes: npm test passes for both JobsService and CandidatesService
</verification>

<success_criteria>
- shortId/short_id field added to JobsService response formatter and exposed in GET /jobs and GET /jobs/:id
- sourceAgency/source_agency field confirmed present in CandidateResponse DTO
- CandidateResponse format confirmed flattened (no applications array)
- ai_score remains direct field (not nested under applications)
- No TypeScript errors; all tests pass
</success_criteria>

<output>
After completion, create `.planning/phases/16-backend-support-for-manual-routing-ui-parity/16-01-SUMMARY.md`

Summary should document:
- shortId exposed in job responses (per D-14)
- sourceAgency exposed in candidate responses (per D-14)
- Response format compliance (flattened, no nested applications)
</output>

---

---
phase: 16-backend-support-for-manual-routing-ui-parity
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - src/candidates/candidates.service.ts
  - src/candidates/candidates.controller.ts
autonomous: true
requirements: [D-01, D-03, D-04, D-05, D-06, D-07, D-08, D-13, D-15, D-16, D-17, D-18, D-19, D-20, D-21]
user_setup: []

must_haves:
  truths:
    - "Candidate can be reassigned from jobId=null to any job (initial assignment)"
    - "Candidate can be reassigned from jobId=X to jobId=Y (existing job reassignment)"
    - "Old Application and scores preserved when reassigning (audit trail)"
    - "New Application created on reassignment with stage = first enabled stage"
    - "Fresh scoring triggered for new job via ScoringAgentService"
    - "hiringStageId reset to first enabled stage of new job"
    - "Job with no enabled stages rejected with 400 NO_STAGES error"
    - "Profile fields (full_name, email, etc.) and job reassignment update atomically in single transaction"
    - "GET /candidates?unassigned=true returns candidates with jobId=null"
    - "ALREADY_ASSIGNED error removed—reassignment now allowed"
  artifacts:
    - path: "src/candidates/candidates.service.ts"
      provides: "updateCandidate() with reassignment logic; findAll() with unassigned filter"
      min_lines: 50
    - path: "src/candidates/candidates.controller.ts"
      provides: "Query param parsing for unassigned filter"
      min_lines: 5
  key_links:
    - from: "updateCandidate()"
      to: "Prisma.$transaction"
      via: "atomic Application creation + Candidate update"
      pattern: "prisma.\\$transaction|Application.create|Candidate.update"
    - from: "updateCandidate()"
      to: "ScoringAgentService.score()"
      via: "fresh scoring on reassignment"
      pattern: "scoringAgent.score|ScoringAgentService"
    - from: "findAll()"
      to: "unassigned filter"
      via: "jobId: null where condition"
      pattern: "unassigned|jobId.*null"
---

<objective>
Implement manual job reassignment in PATCH /candidates/:id endpoint. Remove ALREADY_ASSIGNED error. Support job reassignment (jobId=null→X or X→Y) while preserving old Application records, creating new Applications, triggering fresh scoring, and resetting hiring stage. Add unassigned filter to GET /candidates.

Purpose: Enable recruiters to manually assign unmatched candidates and reassign existing candidates between jobs without losing historical audit trail.
Output: updateCandidate() method supporting reassignment; findAll() supporting unassigned filter; both atomic and fully tested.
</objective>

<execution_context>
@/Users/danielshalem/triolla/telent-os-backend/.claude/get-shit-done/workflows/execute-plan.md
@/Users/danielshalem/triolla/telent-os-backend/.planning/phases/16-backend-support-for-manual-routing-ui-parity/16-CONTEXT.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md

# Service patterns
@src/candidates/candidates.service.ts (existing updateCandidate pattern)
@src/jobs/jobs.service.ts (first enabled stage lookup pattern)
@src/scoring/scoring.service.ts (ScoringAgentService invocation pattern)
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement updateCandidate() with job reassignment logic (remove ALREADY_ASSIGNED error)</name>
  <files>src/candidates/candidates.service.ts</files>
  <behavior>
    - Test 1: Candidate with jobId=null + PATCH job_id=X → creates new Application, resets hiringStageId to first enabled stage, updates jobId atomically
    - Test 2: Candidate with jobId=X + PATCH job_id=Y → creates new Application for Y, preserves old Application for X, resets hiringStageId, triggers fresh scoring, updates jobId atomically
    - Test 3: PATCH job_id with target job having no enabled stages → 400 NO_STAGES error
    - Test 4: PATCH job_id=null (no change) + other profile fields → updates profile only, no job logic triggered
    - Test 5: PATCH job_id=X when already jobId=X (no-op) + other fields → other fields still update, job_id field ignored
    - Test 6: PATCH with profile fields + job_id in same call → both update atomically (per D-18)
    - Test 7: PATCH job_id fails validation (e.g., NO_STAGES) → entire request fails, profile fields NOT updated (per D-19)
    - Test 8: Scoring failure on reassignment → logs warning, continues, candidate assigned but score insertion failed gracefully (per D-21)
  </behavior>
  <action>
  Modify src/candidates/candidates.service.ts:updateCandidate() method:

  1. **Remove ALREADY_ASSIGNED error** (lines 280-283 currently throw if candidate.jobId exists and differs from dto.job_id):
     Replace the ALREADY_ASSIGNED block with:
     ```
     } else if (candidate.jobId && candidate.jobId !== dto.job_id) {
       // Reassignment path: old jobId exists, new jobId differs
       // Fall through to reassignment logic below
     } else if (candidate.jobId) {
       // Same-job no-op
       if (Object.keys(updateData).length === 0) return this.findOne(candidateId);
     } else {
       // Initial assignment (jobId=null → jobId=X)
       // Existing logic continues
     }
     ```

  2. **Implement reassignment branch** (triggered when candidate.jobId && candidate.jobId !== dto.job_id):
     - Validate new job exists (404 if not)
     - Validate new job has at least one enabled stage via JobStage findFirst ordering by order asc (400 NO_STAGES if none)
     - Look up first enabled stage of new job
     - Wrap in prisma.$transaction():
       a. Create new Application(tenantId, candidateId, jobId: dto.job_id, stage: 'new', jobStageId: firstStage.id)
       b. Update Candidate(jobId: dto.job_id, hiringStageId: firstStage.id) + any profile fields in updateData
       c. Call ScoringAgentService.score({ candidateFields: {...}, cvText, job: {...} }) (wrapped in try/catch per D-21)
       d. If score succeeds, insert CandidateJobScore (append-only to application.scores)
       e. If score fails, log warning, continue (do not block reassignment per D-21)

  3. **Keep initial assignment logic unchanged** (jobId=null → jobId=X path already works per Phase 7 pattern)

  4. **Atomicity per D-08 & D-18**: Entire flow (profile updates + job reassignment + scoring) in single Prisma.$transaction

  5. **Error handling**:
     - NotFoundException if candidate not found
     - NotFoundException if new job not found
     - BadRequestException(NO_STAGES) if new job has no enabled stages
     - Scoring failure logs but does not throw (per D-21)

  Detailed action pseudo-code:
  ```typescript
  async updateCandidate(candidateId: string, dto: UpdateCandidateDto): Promise<CandidateResponse> {
    const tenantId = this.configService.get<string>('TENANT_ID')!;
    const candidate = await this.prisma.candidate.findFirst({
      where: { id: candidateId, tenantId },
    });
    if (!candidate) throw NotFoundException;

    const updateData: Prisma.CandidateUncheckedUpdateInput = {};
    if (dto.full_name !== undefined) updateData.fullName = dto.full_name;
    if (dto.email !== undefined) updateData.email = dto.email;
    if (dto.phone !== undefined) updateData.phone = dto.phone;
    if (dto.current_role !== undefined) updateData.currentRole = dto.current_role;
    if (dto.location !== undefined) updateData.location = dto.location;
    if (dto.years_experience !== undefined) updateData.yearsExperience = dto.years_experience;

    if (dto.job_id) {
      if (candidate.jobId === dto.job_id) {
        // Same-job no-op
        if (Object.keys(updateData).length === 0) return this.findOne(candidateId);
      } else if (candidate.jobId) {
        // REASSIGNMENT: jobId=X → jobId=Y
        const firstStage = await this.prisma.jobStage.findFirst({
          where: { jobId: dto.job_id, tenantId, isEnabled: true },
          orderBy: { order: 'asc' },
          select: { id: true },
        });
        if (!firstStage) throw BadRequestException('NO_STAGES');

        const job = await this.prisma.job.findFirst({
          where: { id: dto.job_id, tenantId },
          select: { id: true, title: true, description: true, mustHaveSkills: true },
        });
        if (!job) throw NotFoundException;

        await this.prisma.$transaction(async (tx) => {
          // 1. Create new Application
          await tx.application.create({
            data: {
              tenantId,
              candidateId,
              jobId: dto.job_id!,
              stage: 'new',
              jobStageId: firstStage.id,
            },
          });

          // 2. Update Candidate
          await tx.candidate.update({
            where: { id: candidateId },
            data: {
              ...updateData,
              jobId: dto.job_id,
              hiringStageId: firstStage.id,
            },
          });

          // 3. Score (non-blocking per D-21)
          try {
            const scoreResult = await this.scoringAgent.score({
              cvText: candidate.cvText || '',
              candidateFields: {
                currentRole: updateData.currentRole || candidate.currentRole,
                yearsExperience: updateData.yearsExperience || candidate.yearsExperience,
                skills: candidate.skills,
              },
              job: {
                title: job.title,
                description: job.description || '',
                requirements: job.mustHaveSkills || [],
              },
            });

            // Get the application we just created to attach scores
            const newApp = await tx.application.findFirst({
              where: { candidateId, jobId: dto.job_id, tenantId },
            });

            if (newApp) {
              await tx.candidateJobScore.create({
                data: {
                  tenantId,
                  applicationId: newApp.id,
                  score: scoreResult.score,
                  reasoning: scoreResult.reasoning,
                  strengths: scoreResult.strengths,
                  gaps: scoreResult.gaps,
                  modelUsed: scoreResult.modelUsed,
                },
              });
            }
          } catch (err) {
            this.logger.warn(`Scoring failed during reassignment: ${err.message}`);
            // Continue — do not block reassignment
          }
        });

        return this.findOne(candidateId);
      } else {
        // INITIAL ASSIGNMENT: jobId=null → jobId=X (existing logic, no change)
        // ... existing code ...
      }
    }

    // Profile-only update (no job change)
    if (Object.keys(updateData).length > 0) {
      await this.prisma.candidate.update({
        where: { id: candidateId },
        data: updateData,
      });
    }

    return this.findOne(candidateId);
  }
  ```

  **Key implementation notes:**
  - Per D-03 & D-04: Old Application kept intact, new Application created (not replaced)
  - Per D-05: Fresh ScoringAgentService.score() call on reassignment
  - Per D-06: Always reset hiringStageId to first enabled stage (no stage preservation logic)
  - Per D-07: Validate job has enabled stages; 400 if not
  - Per D-08: Entire transaction atomic
  - Per D-21: Scoring failure logs warning but does not block reassignment
  </action>
  <verify>
    <automated>
    npm test -- candidates.service.spec.ts --testNamePattern="updateCandidate.*reassign|ALREADY_ASSIGNED" (or create new tests for reassignment scenarios)
    Verify Tests 1-8 from behavior section all pass.
    Also: npm test candidates.service.spec.ts (full service test suite should pass)
    </automated>
  </verify>
  <done>updateCandidate() supports reassignment (jobId=X→Y); ALREADY_ASSIGNED error removed; old Application preserved; new Application created; fresh scoring triggered; hiringStageId reset to first enabled stage; atomic transaction enforced; scoring failure non-blocking</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add unassigned filter to findAll() and expose in controller</name>
  <files>src/candidates/candidates.service.ts, src/candidates/candidates.controller.ts</files>
  <behavior>
    - Test 1: GET /candidates?unassigned=true returns only candidates with jobId=null
    - Test 2: GET /candidates without unassigned param returns all candidates (existing behavior)
    - Test 3: GET /candidates?unassigned=false (explicit false) same as without param (returns all)
    - Test 4: unassigned=true + q search param → both filters applied (jobId=null AND name matches)
    - Test 5: unassigned=true + filter=duplicates → jobId=null AND has unreviewed duplicate_flag
  </behavior>
  <action>
  1. **Modify CandidatesController.findAll()** to accept unassigned query param:
     ```typescript
     @Get()
     async findAll(
       @Query('q') q?: string,
       @Query('filter') filter?: CandidateFilter,
       @Query('job_id') jobId?: string,
       @Query('unassigned') unassigned?: string,  // NEW PARAM
     ): Promise<{ candidates: CandidateResponse[]; total: number }> {
       const unassignedBool = unassigned === 'true';  // parse as boolean
       return this.candidatesService.findAll(q, filter, jobId, unassignedBool);
     }
     ```

  2. **Modify CandidatesService.findAll()** to accept unassigned boolean param:
     ```typescript
     async findAll(
       q?: string,
       filter?: CandidateFilter,
       jobId?: string,
       unassigned?: boolean,  // NEW PARAM
     ): Promise<{ candidates: CandidateResponse[]; total: number }> {
       const tenantId = this.configService.get<string>('TENANT_ID')!;
       const where: Prisma.CandidateWhereInput = { tenantId };

       // Add unassigned filter (per D-13)
       if (unassigned) {
         where.jobId = null;
       } else if (jobId) {
         where.jobId = jobId;
       }

       // ... rest of existing logic unchanged ...
     }
     ```

     Integration: unassigned=true takes precedence over jobId param (jobId ignored if unassigned=true).

  3. **Error handling**: No new errors; unassigned is optional string query param, silently ignores if invalid value.

  Per D-13: "GET /candidates endpoint supports native `unassigned` filter mapping to `{ jobId: null }`."
  </action>
  <verify>
    <automated>
    npm test -- candidates.service.spec.ts --testNamePattern="findAll.*unassigned" (or create new tests)
    Verify Tests 1-5 from behavior section all pass.
    Also: npm test candidates.controller.spec.ts (controller query param parsing)
    Manual: curl GET "http://localhost:3000/api/candidates?unassigned=true" | jq '.candidates[0].job_id' (should all be null)
    </automated>
  </verify>
  <done>findAll() supports unassigned query filter; controller parses and passes unassigned param; unassigned=true returns candidates with jobId=null; existing behavior preserved when unassigned omitted</done>
</task>

</tasks>

<verification>
**Wave 1 Verification (Plan 02):**
1. PATCH /candidates/:id with new job_id creates new Application: check database for 2 Application rows (old + new) with same candidateId
2. Old Application preserved: old job_id Application.stage remains unchanged, scores intact
3. New Application created with stage='new': new job_id Application.stage='new'
4. hiringStageId reset: candidate.hiringStageId points to first enabled stage of new job
5. Fresh scoring triggered: check logs for ScoringAgentService.score() call, check CandidateJobScore for new row with fresh score
6. ALREADY_ASSIGNED error removed: PATCH with job reassignment succeeds (no 400 error)
7. Job without enabled stages rejected: PATCH with target job having isEnabled=false on all stages returns 400 NO_STAGES
8. GET /candidates?unassigned=true returns only candidates with jobId=null
9. Atomic transaction: if scoring fails, reassignment still completes, candidate assigned but score missing (per D-21)
10. All service tests pass: npm test candidates.service.spec.ts
</verification>

<success_criteria>
- updateCandidate() removes ALREADY_ASSIGNED error check
- updateCandidate() supports reassignment (jobId=X→Y)
- Old Application preserved; new Application created on reassignment
- Fresh ScoringAgentService.score() call triggered on reassignment
- hiringStageId reset to first enabled stage of new job
- Job validation: no enabled stages → 400 NO_STAGES error
- Atomic transaction: all updates or none
- Scoring failure non-blocking: candidate assigned even if score insertion fails
- findAll() supports unassigned=true filter mapping to jobId=null
- Controller parses unassigned query param and passes to service
- All service tests pass; no TypeScript errors
</success_criteria>

<output>
After completion, create `.planning/phases/16-backend-support-for-manual-routing-ui-parity/16-02-SUMMARY.md`

Summary should document:
- ALREADY_ASSIGNED error removed (per D-01)
- Reassignment logic with old/new Application handling (per D-03 to D-05)
- hiringStageId reset policy (per D-06)
- Job stage validation (per D-07)
- Atomic transaction scope (per D-08)
- unassigned filter added to GET /candidates (per D-13)
- Scoring failure handling (per D-21)
</output>

---

---
phase: 16-backend-support-for-manual-routing-ui-parity
plan: 03
type: execute
wave: 2
depends_on: ["16-01", "16-02"]
files_modified:
  - src/candidates/candidates.service.spec.ts
  - src/candidates/candidates.controller.spec.ts
autonomous: false
requirements: [D-02, D-09, D-10, D-11, D-12]
user_setup: []

must_haves:
  truths:
    - "Full reassignment workflow tested end-to-end (initial + mid-pipeline reassignment)"
    - "Response format compliance verified: flattened, no nested applications, ai_score calculated"
    - "Job and candidate responses include required fields (shortId, sourceAgency)"
    - "All atomic transaction scenarios pass (success and failure cases)"
    - "Scoring error handling verified (non-blocking, warning logged)"
    - "API integration tests cover unassigned filter, reassignment, profile updates"
  artifacts:
    - path: "src/candidates/candidates.service.spec.ts"
      provides: "Comprehensive reassignment + unassigned filter tests"
      min_lines: 50
    - path: "src/candidates/candidates.controller.spec.ts"
      provides: "Controller integration tests for PATCH /candidates/:id and GET /candidates?unassigned=true"
      min_lines: 30
  key_links:
    - from: "PATCH /candidates/:id reassignment"
      to: "Application creation + Candidate.jobId update"
      via: "atomic transaction verified in integration test"
      pattern: "should.*reassign|should.*update.*job"
    - from: "GET /candidates?unassigned=true"
      to: "jobId=null filter"
      via: "controller query param → service WHERE clause"
      pattern: "unassigned=true|jobId.*null"
---

<objective>
Write comprehensive integration and unit tests for reassignment workflow, unassigned filter, and response format compliance. Verify atomic transactions, scoring error handling, and full end-to-end scenarios. Include manual smoke test checkpoint to confirm reassignment workflow via API.

Purpose: Validate Phase 16 implementation completeness; confirm reassignment logic, error handling, and response contracts meet requirements.
Output: Passing test suite (50+ new tests); human verification checkpoint for manual reassignment workflow.
</objective>

<execution_context>
@/Users/danielshalem/triolla/telent-os-backend/.claude/get-shit-done/workflows/execute-plan.md
@/Users/danielshalem/triolla/telent-os-backend/.planning/phases/16-backend-support-for-manual-routing-ui-parity/16-CONTEXT.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md

# Test patterns from prior phases
@src/candidates/candidates.service.spec.ts (existing unit test patterns)
@src/candidates/candidates.controller.spec.ts (existing controller test patterns)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write comprehensive reassignment + unassigned filter tests in candidates.service.spec.ts</name>
  <files>src/candidates/candidates.service.spec.ts</files>
  <action>
  Add/enhance unit tests for updateCandidate() and findAll() with the following scenarios:

  **updateCandidate() Reassignment Tests:**

  1. **Initial Assignment** (jobId=null → jobId=X):
     - Verify Application created with stage='new'
     - Verify Candidate.jobId updated
     - Verify hiringStageId set to first enabled stage
     - Verify ScoringAgentService.score() called

  2. **Mid-Pipeline Reassignment** (jobId=X → jobId=Y):
     - Create candidate with jobId=X + existing Application for X
     - PATCH with new jobId=Y
     - Verify old Application for X still exists (untouched)
     - Verify new Application for Y created with stage='new'
     - Verify Candidate.jobId updated to Y
     - Verify hiringStageId reset to first stage of Y
     - Verify ScoringAgentService.score() called for Y

  3. **Same-Job No-Op** (jobId=X → jobId=X):
     - PATCH with jobId=X when already assigned to X
     - Verify no new Application created
     - Verify jobId unchanged
     - Verify profile fields still update if provided

  4. **Profile + Reassignment Atomic** (per D-18):
     - PATCH with jobId=Y + full_name="New Name"
     - Verify transaction: both fields updated or both rolled back (test with transaction failure scenario if possible)

  5. **Job Without Enabled Stages** (per D-07):
     - Create job with no enabled stages
     - PATCH candidate with jobId = that job
     - Verify 400 BadRequestException with code='NO_STAGES'

  6. **Job Not Found** (per D-15):
     - PATCH with invalid jobId UUID
     - Verify 404 NotFoundException

  7. **Candidate Not Found**:
     - PATCH with invalid candidateId
     - Verify 404 NotFoundException

  8. **Scoring Failure Non-Blocking** (per D-21):
     - Mock ScoringAgentService.score() to throw error
     - PATCH with reassignment
     - Verify reassignment succeeds (Application created, jobId updated)
     - Verify error logged as warning
     - Verify CandidateJobScore NOT created

  **findAll() Unassigned Filter Tests:**

  1. **unassigned=true returns jobId=null**:
     - Seed 3 candidates: one with jobId=null, two with jobId set
     - findAll(undefined, undefined, undefined, true)
     - Verify only 1 candidate returned (jobId=null)

  2. **unassigned=false or omitted returns all**:
     - Same seed as above
     - findAll(undefined, undefined, undefined, false)
     - Verify all 3 candidates returned

  3. **unassigned=true + q search**:
     - Seed candidates with various names/emails, some unassigned
     - findAll('john', undefined, undefined, true)
     - Verify only unassigned candidates matching 'john' returned

  4. **unassigned=true + filter=duplicates**:
     - Seed unassigned candidate with unreviewed duplicate_flag
     - findAll(undefined, 'duplicates', undefined, true)
     - Verify candidate returned (both filters match)

  5. **unassigned=true + jobId param (unassigned takes precedence)**:
     - findAll(undefined, undefined, 'some-job-id', true)
     - Verify unassigned filter applied (jobId param ignored)

  **Response Format Tests:**

  1. **CandidateResponse flattened, no applications array**:
     - Call findOne() on candidate
     - Verify response has NO "applications" or "applicationHistory" key
     - Verify response has "ai_score" as direct field

  2. **ai_score = Math.max of scores**:
     - Create candidate with 2 applications (scores 50, 80)
     - Call findOne()
     - Verify ai_score = 80 (max)

  3. **sourceAgency present in response**:
     - Create candidate with sourceAgency="LinkedIn"
     - Call findOne()
     - Verify response.source_agency = "LinkedIn"

  4. **JobResponse includes shortId**:
     - Create job with shortId="ENG-ABC1"
     - Query job via findOne()
     - Verify job.short_id = "ENG-ABC1" (in JobsService response)

  Test implementation should use:
  - Mock PrismaService for database interactions
  - Mock ScoringAgentService for score() calls (with scenario for success and failure)
  - Mock ConfigService for TENANT_ID
  - Seed helpers for quick candidate/job/application creation in tests

  All tests should use describe/it pattern and follow existing test style in codebase.
  </action>
  <verify>
    <automated>npm test -- candidates.service.spec.ts (all tests pass)</automated>
  </verify>
  <done>50+ reassignment, unassigned filter, and response format tests added and passing in candidates.service.spec.ts</done>
</task>

<task type="auto">
  <name>Task 2: Write controller integration tests for PATCH /candidates/:id reassignment and GET /candidates?unassigned=true</name>
  <files>src/candidates/candidates.controller.spec.ts</files>
  <action>
  Add/enhance controller integration tests covering:

  **PATCH /candidates/:id Tests:**

  1. **Successful reassignment**:
     - POST a test candidate with jobId=null
     - PATCH /candidates/:id with jobId=newJobId
     - Verify 200 response
     - Verify response body includes job_id=newJobId, hiring_stage_id set, ai_score calculated

  2. **Request validation**:
     - PATCH with invalid job_id (not UUID format)
     - Verify 400 BadRequestException with code='VALIDATION_ERROR'

  3. **No ALREADY_ASSIGNED error**:
     - Create candidate with existing jobId=A
     - PATCH with jobId=B
     - Verify 200 (not 400 ALREADY_ASSIGNED)

  4. **Job with no enabled stages**:
     - Create job with all stages disabled
     - PATCH candidate with that job
     - Verify 400 with code='NO_STAGES'

  5. **Profile + job update**:
     - PATCH with full_name="New Name" + job_id=newJobId
     - Verify 200, response includes both fields updated

  **GET /candidates?unassigned=true Tests:**

  1. **Query param parsing**:
     - GET /candidates?unassigned=true
     - Verify HTTP 200
     - Verify response.candidates contains only candidates with job_id=null

  2. **Combined query params**:
     - GET /candidates?unassigned=true&q=john
     - Verify filtering works (unassigned + search)

  3. **unassigned=false (should return all)**:
     - GET /candidates?unassigned=false
     - Verify response includes both assigned and unassigned candidates

  4. **Missing unassigned param (default behavior)**:
     - GET /candidates
     - Verify response includes all candidates (no unassigned filter)

  **Response Format Compliance:**

  1. **PATCH response includes all required fields**:
     - Verify response has: id, full_name, email, job_id, hiring_stage_id, hiring_stage_name, ai_score, source_agency, is_duplicate, status, etc.
     - Verify NO "applications" array in response

  2. **GET /candidates response format**:
     - Verify each candidate in list has all required fields
     - Verify NO nested applications array

  3. **Job response includes shortId**:
     - Get candidate via findOne()
     - If candidate has job assigned, verify job section includes short_id field
     - Alternatively, test via JobsService.findAll() or JobsController if applicable

  Test implementation:
  - Use supertest(app) for HTTP integration tests
  - Create test fixtures (job with stages, candidate) for consistent seeding
  - Mock ScoringAgentService if needed
  - Verify response status codes and body structure

  Style: Follow existing controller.spec.ts patterns in codebase (describe/it, expect).
  </action>
  <verify>
    <automated>npm test -- candidates.controller.spec.ts (all tests pass)</automated>
  </verify>
  <done>30+ controller integration tests added and passing in candidates.controller.spec.ts covering reassignment, unassigned filter, response format</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
  Complete Phase 16 implementation:
  1. Job responses now expose shortId field (per D-14)
  2. Candidate responses expose sourceAgency field (per D-14)
  3. CandidateResponse remains flattened (no nested applications array per D-12)
  4. PATCH /candidates/:id endpoint supports manual reassignment (per D-01)
  5. ALREADY_ASSIGNED error removed; candidates can be reassigned (jobId=X→Y)
  6. Old Application preserved on reassignment; new Application created with fresh scoring (per D-03 to D-05)
  7. hiringStageId reset to first enabled stage of new job (per D-06)
  8. Job validation: rejects if no enabled stages with 400 NO_STAGES (per D-07)
  9. Atomic transactions for profile updates + reassignment (per D-08, D-18)
  10. GET /candidates?unassigned=true filter returns candidates with jobId=null (per D-13)
  11. 80+ tests passing (service + controller)
  12. No TypeScript errors; npm test fully green
  </what-built>
  <how-to-verify>
  **Manual Reassignment Workflow Test** (Smoke Test):

  Prerequisites: Docker running locally with seeded database (3 jobs with enabled stages, 1 unassigned candidate)

  1. **List unassigned candidates**:
     ```bash
     curl -s http://localhost:3000/api/candidates?unassigned=true | jq '.candidates[] | {id, full_name, job_id}'
     ```
     Expected: See candidate(s) with job_id=null

  2. **Assign unmatched candidate to first job**:
     ```bash
     CAND_ID="<id from step 1>"
     JOB_ID="<first job UUID from seed>"

     curl -s -X PATCH http://localhost:3000/api/candidates/$CAND_ID \
       -H "Content-Type: application/json" \
       -d "{\"job_id\": \"$JOB_ID\"}" | jq '{job_id, hiring_stage_id, hiring_stage_name, ai_score}'
     ```
     Expected: job_id updated, hiring_stage_id set to first stage, ai_score calculated

  3. **Verify Application created and old unassigned state preserved**:
     ```bash
     curl -s http://localhost:3000/api/candidates/$CAND_ID | jq '{job_id, hiring_stage_id, hiring_stage_name}'
     ```
     Expected: job_id matches assigned job, hiring_stage_id set correctly

  4. **Reassign candidate to different job**:
     ```bash
     JOB_ID_2="<second job UUID from seed>"

     curl -s -X PATCH http://localhost:3000/api/candidates/$CAND_ID \
       -H "Content-Type: application/json" \
       -d "{\"job_id\": \"$JOB_ID_2\"}" | jq '{job_id, hiring_stage_id, hiring_stage_name, ai_score}'
     ```
     Expected: job_id updated to new job, hiring_stage_id reset to first stage of new job, ai_score recalculated

  5. **Verify no ALREADY_ASSIGNED error**:
     Expected: Request succeeds (200), not 400 ALREADY_ASSIGNED

  6. **Verify old Application preserved** (via database inspection):
     ```bash
     psql $DATABASE_URL -c "SELECT id, job_id, stage FROM applications WHERE candidate_id='$CAND_ID' ORDER BY applied_at;"
     ```
     Expected: 2 rows (one for each job), both with stage='new' or similar

  7. **Verify response format is flattened**:
     ```bash
     curl -s http://localhost:3000/api/candidates/$CAND_ID | jq 'keys'
     ```
     Expected: Response includes id, full_name, job_id, hiring_stage_id, ai_score, source_agency, etc. — NO "applications" key

  8. **Verify shortId in job response** (if applicable):
     ```bash
     curl -s http://localhost:3000/api/jobs | jq '.jobs[0] | {id, title, short_id}'
     ```
     Expected: short_id field present with value like "ENG-ABC1"

  9. **Test unassigned filter after reassignment**:
     ```bash
     curl -s http://localhost:3000/api/candidates?unassigned=true | jq '.candidates | length'
     ```
     Expected: Count should be less than step 1 (candidate now assigned)

  10. **Test error case: reassign to job with no enabled stages**:
      ```bash
      # Assuming you have a test job with no enabled stages or can temporarily disable them
      DISABLED_JOB_ID="<job with isEnabled=false on all stages>"

      curl -s -X PATCH http://localhost:3000/api/candidates/$CAND_ID \
        -H "Content-Type: application/json" \
        -d "{\"job_id\": \"$DISABLED_JOB_ID\"}" | jq '.error.code'
      ```
      Expected: error.code='NO_STAGES', HTTP 400

  All 10 steps should complete without errors. Confirm results match expected outputs.
  </how-to-verify>
  <resume-signal>
  Type "approved" if all 10 manual test steps pass and expectations are met.
  Or describe any issues encountered (e.g., "Step 4 reassignment returns 400", "ai_score not calculated", etc.).
  </resume-signal>
</task>

</tasks>

<verification>
**Phase 16 Final Verification:**
1. PATCH /candidates/:id with job_id removes ALREADY_ASSIGNED error and allows reassignment ✓
2. Reassignment workflow: old Application preserved, new Application created ✓
3. Fresh scoring triggered on reassignment via ScoringAgentService.score() ✓
4. hiringStageId reset to first enabled stage of new job ✓
5. Job validation: no enabled stages → 400 NO_STAGES ✓
6. Atomic transaction: profile updates + job reassignment ✓
7. Scoring failure non-blocking: candidate assigned even if score fails ✓
8. GET /candidates?unassigned=true returns candidates with jobId=null ✓
9. Job responses expose shortId field (D-14) ✓
10. Candidate responses expose sourceAgency field (D-14) ✓
11. CandidateResponse flattened (no nested applications array, D-12) ✓
12. ai_score calculated via Math.max of candidate_job_scores (D-12) ✓
13. 80+ tests passing (service + controller) ✓
14. Manual smoke test checkpoint approved ✓
15. No TypeScript errors; npm test green ✓
</verification>

<success_criteria>
- PATCH /candidates/:id supports reassignment (jobId=X→Y)
- ALREADY_ASSIGNED error removed from codebase
- Old Application preserved on reassignment; new Application created
- Fresh ScoringAgentService.score() call on reassignment
- hiringStageId reset to first enabled stage of new job
- Job validation: rejects if no enabled stages with 400 NO_STAGES
- Atomic transactions enforced (profile + job reassignment together)
- Scoring failure non-blocking; reassignment completes even if score fails
- GET /candidates?unassigned=true filter working (returns jobId=null candidates)
- Job responses include shortId field (D-14)
- Candidate responses include sourceAgency field (D-14)
- CandidateResponse format flattened (no nested applications array, D-12)
- ai_score calculated correctly (Math.max of scores)
- 80+ tests passing (service + controller suites)
- Manual smoke test checkpoint passed (all 10 steps verified)
- No TypeScript errors; npm test fully green
</success_criteria>

<output>
After completion, create `.planning/phases/16-backend-support-for-manual-routing-ui-parity/16-03-SUMMARY.md`

Summary should document:
- Full test coverage for reassignment workflow (50+ unit + integration tests)
- Response format compliance verified (flattened, sourceAgency, shortId)
- Atomic transaction verification
- Scoring error handling verified
- Manual smoke test checkpoint results
- Total test suite status: all tests passing
</output>
