# Phase 12: Support add candidate from the UI (not from the webhook) - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Create POST /candidates endpoint to allow recruiters to manually add candidates from the UI with optional CV file upload, immediately linked to an existing job via atomic Candidate + Application creation. Add GET /jobs/list lightweight endpoint for job selector dropdowns. All new candidates are treated as manually-added: no duplicate detection, no cv_text parsing, distinguishable from email-intake candidates.

**Scope:** POST /candidates endpoint (manual entry), GET /jobs/list (UI support). Existing GET /candidates read endpoint and all webhook processing out of scope.

</domain>

<decisions>
## Implementation Decisions

### Duplicate Detection for Manual Candidates

- **D-01:** Manual candidates created via POST /candidates skip pg_trgm duplicate detection entirely
  - Rationale: Recruiters adding candidates manually are deliberate and know who they're adding
  - Decision based on recruiter workflow: if they add a duplicate, it's intentional
  - No duplicate_flags created for manual adds (unlike email-intake candidates)
  - Unique email constraint (DB level) still applies — 409 Conflict if email exists

### CV File Handling

- **D-02:** When recruiter uploads a PDF/DOCX file with POST /candidates:
  - Upload file to Cloudflare R2 at path `cvs/{tenantId}/{candidateId}`
  - Store public R2 URL in `cv_file_url` field
  - **Do NOT parse file to cv_text** — leave `cv_text = null` for manual adds
  - Rationale: Recruiters manually adding candidates already know who they are; cv_text parsing is unnecessary overhead
  - cv_text null field distinguishes manual-adds from email-intake candidates in the database
  - File accepted formats: `.pdf`, `.doc`, `.docx` (validate by MIME type server-side)

### Response Format

- **D-03:** POST /candidates response uses snake_case field names (matches existing API pattern)
  - Fields: `id`, `tenant_id`, `full_name`, `email`, `phone`, `current_role`, `location`, `years_experience`, `skills`, `cv_text` (null for manual adds), `cv_file_url`, `source`, `source_agency`, `source_email` (null for manual adds), `metadata` (null for manual adds), `created_at`, `updated_at`, `application_id`
  - Rationale: All existing endpoints (GET /jobs, POST /jobs, GET /candidates) return snake_case; maintain consistency

### Application Stage Assignment

- **D-04:** Manual candidates always start at application `stage = "new"` (consistent with email-intake behavior)
  - Rationale: Simple rule, predictable, matches existing system behavior
  - "new" stage is always present in job's hiring_flow (Phase 11)
  - Recruiter can move candidate to other stages after creation via PUT /applications/:id (separate endpoint, separate phase)

### Atomic Transaction

- **D-05:** POST /candidates must atomically create:
  1. Candidate record (with tenantId, all provided fields, cv_file_url from upload)
  2. Application record (candidateId → new candidate, jobId → from request, tenantId, stage="new")
  - If job_id doesn't exist or belongs to different tenant → 404 before transaction starts
  - If email already exists → 409 Conflict before transaction starts
  - If file upload fails → 400 Bad Request before transaction starts
  - Transaction fails entirely if either Candidate or Application create fails

### GET /jobs/list Endpoint

- **D-06:** New lightweight endpoint for job selector in add-candidate UI form
  - Path: `GET /jobs/list`
  - Response: `{ jobs: [{ id, title, department }] }`
  - Filter: Only jobs with `status = "open"` (closed/draft jobs not selectable when adding candidates)
  - Rationale: Lightweight endpoint, no pagination needed for MVP, only essential fields for dropdown

### Claude's Discretion

- Exact Cloudflare R2 key generation strategy (path structure)
- File type validation strictness (MIME type vs extension check)
- Response field ordering in POST /candidates response
- Exact error messages and error response format (follow existing NestJS pattern)
- Email validation regex or library choice

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Primary Specification
- `spec/backend-spec-add-candidate.md` — Complete endpoint contract, field definitions, request/response format, error cases (SOURCE OF TRUTH for Phase 12)

### Related Phase Context (Understand Existing Patterns)
- `.planning/phases/05-file-storage/05-CONTEXT.md` — Cloudflare R2 file upload pattern, StorageService design
- `.planning/phases/06-duplicate-detection/06-CONTEXT.md` — pg_trgm dedup behavior, duplicate_flags creation logic
- `.planning/phases/09-create-client-facing-rest-api-endpoints/09-CONTEXT.md` — GET /candidates endpoint design, response format pattern (snake_case)
- `.planning/phases/11-review-and-validate-api-protocol-mvp-spec-and-implementation-guide/11-CONTEXT.md` — Job endpoints, hiring_flow structure, Application model, atomic transactions with Prisma

### Key Architecture Decisions
- `spec/backend-architecture-proposal.md` — Overall system architecture, multi-tenant isolation pattern (tenant_id everywhere)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **StorageService** (`src/storage/storage.service.ts`) — Cloudflare R2 upload logic, S3Client setup, already handles PDF/DOCX file uploads
- **CandidatesService** (`src/candidates/candidates.service.ts`) — GET /candidates query logic, CandidateResponse format (snake_case), filtering patterns
- **CandidatesController** (`src/candidates/candidates.controller.ts`) — GET /candidates route, can add POST route here
- **JobsService** (`src/jobs/jobs.service.ts`) — Job lookup, findAll() with filtering, tenant isolation pattern
- **PrismaService** — `prisma.$transaction()` for atomic operations (established in Phase 11)

### Established Patterns
- **Tenant isolation:** All queries filter by tenantId from ConfigService (established Phase 1-11)
- **snake_case API responses:** All endpoints return snake_case fields (Phase 9+ pattern)
- **File upload:** StorageService.upload() handles R2 integration, returns URL
- **Atomic transactions:** Prisma $transaction() for multi-step operations (Phase 11 POST /jobs pattern)
- **Error handling:** BadRequestException (validation), NotFoundException (404), ConflictException (409) — NestJS standard

### Integration Points
- **Prisma models:** Candidate, Application, Job (already exist, no schema changes needed for Phase 12)
- **CandidatesModule:** Already exists, can add POST /candidates route
- **StorageModule:** Already exists, inject into CandidatesService for file upload
- **Database constraints:** UNIQUE (tenant_id, email) on Candidate table — enforces 409 on duplicate email

</code_context>

<specifics>
## Specific Ideas

- When displaying GET /jobs/list in UI, sort by job creation date (newest first) or by status priority? (Recommend newest first for consistency with existing list)
- CV file upload timeout — recruiter might upload large file — should response include upload progress? (Recommend synchronous for MVP, keep simple)
- When email already exists, should 409 response include which job/candidate already has that email? (Nice to have, out of MVP scope — just fail with message)

</specifics>

<deferred>
## Deferred Ideas

- Email uniqueness enforcement strategy — should we allow same email across different jobs, or enforce tenant-wide uniqueness? (Currently deferred; spec says 409 if email exists, no job-level scope mentioned)
- Async CV file parsing — currently cv_text stays null; future phase could parse files asynchronously and backfill cv_text
- Advanced file validation (magic bytes / file content inspection) — currently MIME type + extension validation only
- GET /jobs/list pagination or filtering options (search by title, filter by department) — MVP returns all open jobs, pagination deferred to Phase 2+
- Bulk candidate import (CSV upload) — out of scope, separate phase
- Duplicate detection toggle — allow recruiter to opt-in to dedup for specific adds? (Out of scope, separate phase if needed)

### Reviewed but Deferred (Not Folded into Phase 12)
- Verified with recruiter: email validation can be simple string check (no complex regex), server-side MIME type check sufficient
- Confirmed: no client-side CV file parsing, all parsing deferred
- Confirmed: no bulk import, single candidate add only for Phase 12

</deferred>

---

*Phase: 12-support-add-candidate-from-the-ui-not-from-the-webhook-full-spec-located-in-spec-backend-spec-add-candidate-md-research-and-align-with-client-needs-before-planning*
*Context gathered: 2026-03-26 (discussion mode)*
