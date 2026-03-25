# Phase 11: Review and Validate API Protocol MVP Spec and Implementation Guide - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement the API protocol MVP specification: complete job management endpoints (GET /config, GET /jobs, POST /jobs, PUT /jobs/:id, DELETE /jobs/:id) with updated Prisma schema for JobStage and ScreeningQuestion models to match the protocol contract. Frontend receives all required fields for complete job UI without additional API calls.

**Scope:** Jobs domain only. GET /candidates is out of scope (leave as-is).

</domain>

<decisions>
## Implementation Decisions

### Database Schema Changes

#### JobStage
- **D-01:** Rename `responsible_user_id` → `interviewer` (TEXT, nullable) — no user table in Phase 1, keep as free-text name only
- **D-02:** Add `is_enabled` (BOOLEAN, default: true) to control stage visibility in hiring flow
- **D-03:** Color field is client-computed only, NOT stored in database — computed in API response based on stage order/position

#### ScreeningQuestion
- **D-04:** Add `expected_answer` (VARCHAR, nullable) — stores expected answer for yes_no questions ("yes" or "no") or null for text questions
- **D-05:** Remove `required` and `knockout` columns in migration — cleaner schema, unused in MVP, supports future enhancement without schema rework
- **D-06:** API response field renamed `type` (not `answerType`) — database column stays `answer_type` to maintain consistency with Prisma conventions

### Endpoint Implementation

#### GET /config
- **D-07:** Hardcoded response (no database queries): departments, hiring_managers, job_types, organization_types, screening_question_types, hiring_stages_template
- **D-08:** Hiring stages template includes: Application Review, Screening, Interview, Offer with default colors (bg-zinc-400, bg-blue-500, bg-indigo-400, bg-emerald-500)

#### GET /jobs
- **D-09:** Return all job fields: id, title, department, location, job_type, status, hiring_manager, description, responsibilities, what_we_offer, salary_range, must_have_skills, nice_to_have_skills, min_experience, max_experience, selected_org_types, created_at, updated_at
- **D-10:** Include nested `hiring_flow` array (JobStages) with fields: id, name, is_enabled, interviewer, color, is_custom, order — ordered by order ASC
- **D-11:** Include nested `screening_questions` array with fields: id, text, type, expected_answer — ordered by order ASC
- **D-12:** `candidate_count` computed from applications count (read-only, matches existing Phase 9 behavior)
- **D-13:** Return `{ jobs: [...], total: N }` structure

#### POST /jobs
- **D-14:** Update existing implementation to handle new schema (is_enabled, expected_answer, color field in request ignored)
- **D-15:** Validation: title required, job_type required (full_time|part_time|contract), status required (draft|open|closed), hiring_flow required with at least 1 element, at least one stage must have is_enabled=true
- **D-16:** Default 4 hiring stages seeded if none provided: Application Review, Screening, Interview, Offer (existing Phase 10 behavior maintained)

#### PUT /jobs/:id
- **D-17:** Full update endpoint — all fields optional, can be updated independently
- **D-18:** Special behavior: omitting hiring_flow element removes it, omitting screening_question removes it, reorder by updating order field
- **D-19:** Same validation as POST: at least one stage must be enabled
- **D-20:** Atomic operation — use Prisma transaction for nested updates (create/delete/update stages and questions in single transaction)

#### DELETE /jobs/:id
- **D-21:** Soft delete via status: set job.status = "closed" (do NOT hard delete rows, do NOT add deleted_at column)
- **D-22:** Return 204 No Content on success

### Validation & Error Handling

- **D-23:** Error response format: `{ error: { code, message, details: { field: [error strings] } } }`
- **D-24:** Validation codes: VALIDATION_ERROR (400), NOT_FOUND (404), CONFLICT (409), UNAUTHORIZED (401), INTERNAL_ERROR (500)
- **D-25:** Tenant isolation: all endpoints validate x-tenant-id header, filter queries by tenant_id

### Testing Strategy

- **D-26:** Integration tests for all 5 endpoints: GET /config, GET /jobs, POST /jobs, PUT /jobs/:id, DELETE /jobs/:id
- **D-27:** Tenant isolation tests: ensure jobs from different tenants don't cross-contaminate
- **D-28:** Validation error scenarios: missing required fields, invalid enum values, all stages disabled
- **D-29:** Happy path: create job with defaults, create job with custom stages/questions, update job (partial), delete job (verify status=closed)

### Migration Approach

- **D-30:** Prisma migration only (no raw SQL) — use `@db.VarChar` for color in responses (if storing anywhere, but not in DB per D-03)
- **D-31:** Safe migration for responsible_user_id → interviewer: create new column, copy data as TEXT, drop old column
- **D-32:** Handle existing jobs: backfill new columns with defaults (is_enabled=true, expected_answer=null, no interviewer copy needed since responsible_user_id was never used)

### Claude's Discretion

- Exact Tailwind color classes returned in GET /config `hiring_stages_template` (must be valid for client CSS-in-JS)
- Response field ordering and structure details (as long as protocol spec is matched)
- Test file organization and grouping strategy

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### API Specification (Source of Truth)
- `spec/API_PROTOCOL_MVP.md` — Complete endpoint contract, field definitions, validation rules, error handling format
- `spec/API_PROTOCOL_MVP_CHANGES.md` — What was removed/simplified from fuller spec (required context for understanding MVP scope)
- `spec/BACKEND_IMPLEMENTATION_QUICK_START.md` — Concrete migration examples and implementation checklist

### Related Phases (Context)
- `.planning/phases/09-create-client-facing-rest-api-endpoints/09-CONTEXT.md` — Original API endpoint decisions (this phase extends those)
- `.planning/phases/10-add-job-creation-feature/10-CONTEXT.md` — POST /jobs implementation (this phase refines schema)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **JobsController** (src/jobs/jobs.controller.ts) — Already has GET and POST routes, add PUT/DELETE
- **JobsService** (src/jobs/jobs.service.ts) — Create job logic exists, add update/delete methods
- **CreateJobDto** (src/jobs/dto/create-job.dto.ts) — Zod schema exists, update to new fields
- **ConfigService** — NestJS ConfigService for TENANT_ID, use pattern for any env-based config
- **PrismaService** — Transaction support via `prisma.$transaction()` for atomic updates

### Established Patterns
- **Tenant isolation:** Tenant ID from ConfigService, filter all queries by tenantId (established in Phase 1-9)
- **Error handling:** BadRequestException for validation, throw for 404 in services (established pattern)
- **DTOs + Zod validation:** All endpoints use Zod for request validation (Phase 10 pattern)
- **Response mapping:** snake_case DB → camelCase/snake_case API (check Phase 9 JobResponse for pattern)

### Integration Points
- **Prisma models:** Job, JobStage, ScreeningQuestion already exist, require schema migration
- **NestJS modules:** JobsModule already wired into AppModule (Phase 10), no wiring needed
- **Existing endpoints:** GET /jobs exists but returns partial schema, refactor to new contract

</code_context>

<specifics>
## Specific Ideas

- Hiring stages template colors should match frontend Tailwind usage (verify with frontend spec if available)
- GET /config response should be cacheable on client (rarely changes) — consider Cache-Control headers
- When seeding default stages in POST /jobs, ensure color field maps correctly to stage name for visual consistency

</specifics>

<deferred>
## Deferred Ideas

- GET /candidates endpoint updates — separate phase, out of scope for Phase 11
- Pagination for GET /jobs — MVP returns all jobs, pagination deferred to Phase 2+
- Advanced filtering on GET /jobs — deferred to Phase 2+
- Dynamic config from database (hiring_managers, departments) — hardcoded for MVP, can be pulled from DB later
- Multiple interviewers per stage (currently single TEXT field) — future enhancement, MVP is single string

</deferred>

---

*Phase: 11-review-and-validate-api-protocol-mvp-spec-and-implementation-guide*
*Context gathered: 2026-03-25 (implementation mode)*
