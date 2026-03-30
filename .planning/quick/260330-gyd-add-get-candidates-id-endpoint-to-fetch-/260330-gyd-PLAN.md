---
phase: quick-260330-gyd
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/candidates/candidates.service.ts
  - src/candidates/candidates.controller.ts
  - PROTOCOL.md
autonomous: true
requirements: []

must_haves:
  truths:
    - "GET /candidates/:id returns a single CandidateResponse when the candidate exists"
    - "GET /candidates/:id returns 404 with standard error format when candidate not found"
    - "Response shape matches the existing CandidateResponse interface (snake_case fields)"
  artifacts:
    - path: "src/candidates/candidates.service.ts"
      provides: "findOne(id) method"
      exports: ["findOne"]
    - path: "src/candidates/candidates.controller.ts"
      provides: "GET :id route"
      contains: "@Get(':id')"
  key_links:
    - from: "src/candidates/candidates.controller.ts"
      to: "src/candidates/candidates.service.ts"
      via: "findOne(id) call"
      pattern: "candidatesService\\.findOne"
---

<objective>
Add GET /candidates/:id endpoint that returns a single candidate by ID.

Purpose: Allows the frontend to fetch a single candidate record for detail views (profile page, edit form, etc.) without loading the full list.
Output: New `findOne` service method + controller route, PROTOCOL.md updated.
</objective>

<execution_context>
@/Users/danielshalem/triolla/telent-os-backend/.claude/get-shit-done/workflows/execute-plan.md
@/Users/danielshalem/triolla/telent-os-backend/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

<interfaces>
<!-- Existing patterns to follow exactly -->

From src/candidates/dto/candidate-response.dto.ts:
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
  source_agency: string | null;
  created_at: Date;
  ai_score: number | null;
  is_duplicate: boolean;
  skills: string[];
  job_id: string | null;
  hiring_stage_id: string | null;
  hiring_stage_name: string | null;
  job_title: string | null;
}
```

Standard NotFoundException pattern (copy from existing service methods):
```typescript
throw new NotFoundException({
  error: { code: 'NOT_FOUND', message: 'Candidate not found' },
});
```

The findAll() select block already has all fields needed — reuse the same select shape in findOne().
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add findOne() to CandidatesService and GET :id route to controller</name>
  <files>src/candidates/candidates.service.ts, src/candidates/candidates.controller.ts</files>
  <action>
Add `findOne(candidateId: string): Promise<CandidateResponse>` to CandidatesService.

Implementation in candidates.service.ts:
- Get tenantId from configService (same pattern as all other methods)
- Use `prisma.candidate.findFirst({ where: { id: candidateId, tenantId }, select: { ... } })` — use the SAME select block as findAll() (id, fullName, email, phone, currentRole, location, cvFileUrl, source, sourceAgency, createdAt, skills, jobId, hiringStageId, hiringStage.name, job.title, applications.scores.score, duplicateFlags where reviewed=false)
- If not found, throw NotFoundException with `{ error: { code: 'NOT_FOUND', message: 'Candidate not found' } }`
- Map to CandidateResponse (same mapping logic as findAll): compute ai_score as MAX of all scores (null if no scores), is_duplicate from duplicateFlags.length > 0, all snake_case fields

Add `@Get(':id')` route to CandidatesController BEFORE the existing `@Get(':id/cv-url')` route (NestJS matches routes in declaration order — `:id/cv-url` is more specific but must still come after to avoid any ambiguity; actually place `@Get(':id')` BEFORE `@Get(':id/cv-url')` in the file):
```typescript
@Get(':id')
async findOne(@Param('id') id: string): Promise<CandidateResponse> {
  return this.candidatesService.findOne(id);
}
```

Place `@Get(':id')` before `@Get(':id/cv-url')` in the controller to maintain explicit ordering.
  </action>
  <verify>
    <automated>cd /Users/danielshalem/triolla/telent-os-backend && npx tsc --noEmit 2>&1 | head -20</automated>
  </verify>
  <done>TypeScript compiles with no errors. findOne method exists in service. @Get(':id') route exists in controller returning CandidateResponse.</done>
</task>

<task type="auto">
  <name>Task 2: Document GET /candidates/:id in PROTOCOL.md</name>
  <files>PROTOCOL.md</files>
  <action>
Insert a new section in PROTOCOL.md between the existing `GET /candidates` section and `POST /candidates`. Add:

```markdown
### `GET /candidates/:id`

Fetch a single candidate by ID.

**Path Parameters:**

- `id`: Candidate UUID

**Response:** `200 OK`

```json
{
  "id": "uuid",
  "full_name": "John Doe",
  "email": "john@example.com",
  "phone": "+1 555-0100",
  "current_role": "Software Engineer",
  "location": "Tel Aviv",
  "cv_file_url": "https://...",
  "source": "linkedin",
  "source_agency": null,
  "created_at": "ISO8601",
  "ai_score": 85,
  "is_duplicate": false,
  "skills": ["React", "TypeScript"],
  "job_id": "uuid",
  "hiring_stage_id": "uuid",
  "hiring_stage_name": "Screening",
  "job_title": "Senior Frontend Developer"
}
```

**Errors:**

- `404 Not Found` — candidate not found or does not belong to tenant
```

Insert this block after the closing ``` of the GET /candidates response example and before the `### POST /candidates` heading.
  </action>
  <verify>grep -n "GET /candidates/:id" /Users/danielshalem/triolla/telent-os-backend/PROTOCOL.md</verify>
  <done>PROTOCOL.md contains a `GET /candidates/:id` section with 404 error documented.</done>
</task>

</tasks>

<verification>
Run TypeScript compilation and a smoke test against the running server (if available):

```bash
# TypeScript check
cd /Users/danielshalem/triolla/telent-os-backend && npx tsc --noEmit

# Manual smoke test (if server is running)
curl -s -H "x-tenant-id: phase1-default-tenant" http://localhost:3000/api/candidates | jq '.[0].id // .candidates[0].id' | xargs -I{} curl -s -H "x-tenant-id: phase1-default-tenant" http://localhost:3000/api/candidates/{}
```
</verification>

<success_criteria>
- `GET /candidates/:id` returns 200 with a single CandidateResponse object (not wrapped in array)
- `GET /candidates/nonexistent-id` returns 404 with `{ error: { code: 'NOT_FOUND', message: 'Candidate not found' } }`
- TypeScript compiles with no errors
- PROTOCOL.md documents the new endpoint
</success_criteria>

<output>
After completion, create `.planning/quick/260330-gyd-add-get-candidates-id-endpoint-to-fetch-/260330-gyd-SUMMARY.md` and update `.planning/STATE.md` quick tasks table.
</output>
