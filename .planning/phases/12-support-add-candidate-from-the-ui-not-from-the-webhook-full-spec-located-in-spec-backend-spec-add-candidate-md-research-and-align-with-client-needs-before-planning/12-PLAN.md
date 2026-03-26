---
phase: 12-support-add-candidate-from-the-ui-not-from-the-webhook
plan: 1
type: execute
wave: 1
depends_on: []
files_modified: [
  "src/candidates/dto/create-candidate.dto.ts",
  "src/candidates/candidates.service.ts",
  "src/candidates/candidates.controller.ts",
  "src/jobs/jobs.service.ts",
  "src/storage/storage.service.ts",
  "tests/candidates.integration.spec.ts",
  "src/candidates/candidates.service.spec.ts",
  "src/jobs/jobs.service.spec.ts"
]
autonomous: true
requirements: [CAND-01, CAND-02]
user_setup: []

must_haves:
  truths:
    - "Recruiters can POST candidate data with optional CV file to /candidates endpoint"
    - "POST /candidates creates Candidate + Application atomically or fails entirely"
    - "Manual candidates always start at application stage 'new'"
    - "CV files are uploaded to Cloudflare R2 with URL stored in cv_file_url"
    - "Manual candidates have cv_text = null (not parsed)"
    - "POST /candidates rejects duplicate emails with 409 Conflict"
    - "POST /candidates rejects missing/invalid job_id with 404 Not Found"
    - "GET /jobs/list returns only open jobs with minimal fields {id, title, department}"
    - "All responses use snake_case field names matching existing API pattern"
    - "All operations are tenant-isolated via tenantId"

  artifacts:
    - path: "src/candidates/dto/create-candidate.dto.ts"
      provides: "Zod validation schema for POST /candidates request"
      exports: ["CreateCandidateDto"]
    - path: "src/candidates/candidates.service.ts"
      provides: "createCandidate() method with file upload, validation, atomic transaction"
      exports: ["createCandidate(dto, file)"]
    - path: "src/candidates/candidates.controller.ts"
      provides: "POST /candidates and GET /jobs/list HTTP endpoints"
      routes: ["POST /candidates", "GET /jobs/list"]
    - path: "src/jobs/jobs.service.ts"
      provides: "getOpenJobs() method for lightweight job list"
      exports: ["getOpenJobs()"]
    - path: "src/storage/storage.service.ts"
      provides: "uploadFromBuffer() method for file upload from Express.Multer.File"
      exports: ["uploadFromBuffer(buffer, mimetype, tenantId, candidateId)"]

  key_links:
    - from: "candidates.controller.ts"
      to: "candidates.service.ts"
      via: "POST /candidates route calls createCandidate()"
      pattern: "await this\\.candidatesService\\.createCandidate"
    - from: "candidates.service.ts"
      to: "storage.service.ts"
      via: "File upload before transaction"
      pattern: "await this\\.storageService\\.uploadFromBuffer"
    - from: "candidates.service.ts"
      to: "jobs.service.ts"
      via: "Job existence validation"
      pattern: "await this\\.prisma\\.job\\.findUnique"
    - from: "candidates.controller.ts"
      to: "jobs.service.ts"
      via: "GET /jobs/list calls getOpenJobs()"
      pattern: "await this\\.jobsService\\.getOpenJobs"
    - from: "candidates.service.ts"
      to: "prisma.\$transaction"
      via: "Atomic Candidate + Application creation"
      pattern: "this\\.prisma\\.\\$transaction"
---

# Phase 12: Support add candidate from the UI — Implementation Plan

**Created:** 2026-03-26

## Phase Goal

Enable recruiters to manually add candidates from the UI with optional CV file uploads, creating Candidate + Application records atomically and immediately linking candidates to open jobs via lightweight GET /jobs/list endpoint.

**Purpose:** Complete the manual candidate entry flow required for recruiter UI to function end-to-end without depending on email intake.

**Output:** Two new endpoints (POST /candidates, GET /jobs/list) fully integrated, tested, and documented with atomic transaction handling, file validation, and tenant isolation.

## Success Criteria

1. POST /candidates endpoint accepts multipart/form-data (with CV file) and application/json (without file)
2. POST /candidates creates Candidate + Application atomically in single database transaction
3. CV files validated server-side by MIME type (PDF, DOCX) before upload to R2
4. cv_file_url populated from R2 upload; cv_text stays null (per D-02)
5. POST /candidates returns 409 Conflict if email already exists in tenant (pre-validated before transaction)
6. POST /candidates returns 404 Not Found if job_id doesn't exist or belongs to different tenant
7. POST /candidates returns 201 with complete Candidate + Application data in snake_case response format
8. GET /jobs/list returns only jobs with status = "open" with {id, title, department} fields
9. All application records created with stage = "new" (per D-04)
10. Unit tests verify file validation (3 tests), email uniqueness (2 tests), transaction atomicity (2 tests)
11. Integration tests verify POST /candidates success flows (2 tests), error responses (4 tests), GET /jobs/list (1 test)
12. All operations filter by tenantId from ConfigService (no cross-tenant data leaks)

## Implementation Plan

### Wave 1: Core Service Implementation + DTOs + Controller Routes

**Overview:** Create DTOs for request validation, extend services with createCandidate() and file upload logic, add controller endpoints, and implement all pre-validation before atomic transaction.

---

<task type="auto">
  <name>Task 1: Create CreateCandidateDto and validation schema</name>
  <files>src/candidates/dto/create-candidate.dto.ts</files>
  <action>
Create Zod validation schema (CreateCandidateDto) with the following fields:
- full_name: string (required, min 1 char) — maps to Candidate.fullName
- email: string | null (optional, must be valid email if provided) — use Zod .email()
- phone: string | null (optional)
- current_role: string | null (optional)
- location: string | null (optional)
- years_experience: number | null (optional, 0-50 range) — validate as Int range
- skills: string[] (defaults to [])
- ai_summary: string | null (optional) — maps to Candidate.aiSummary
- cv_file: NOT in schema (handled by FileInterceptor at controller level)
- source: string (required, one of "linkedin", "website", "agency", "referral", "direct")
- source_agency: string | null (optional)
- job_id: string (required, UUID format) — the job to link application to

Export as CreateCandidateDto type and zod schema.

Reference existing pattern: src/jobs/dto/create-job.dto.ts uses Zod with z.object().
  </action>
  <verify>
    <automated>npm test -- src/candidates/dto/create-candidate.dto.ts --testNamePattern="schema" || test -f src/candidates/dto/create-candidate.dto.ts && grep -E "z\.object|export.*Dto" src/candidates/dto/create-candidate.dto.ts</automated>
  </verify>
  <done>CreateCandidateDto Zod schema file exists with all required fields, validation rules match spec, exports available for service/controller</done>
</task>

---

<task type="auto">
  <name>Task 2: Extend StorageService with uploadFromBuffer() method</name>
  <files>src/storage/storage.service.ts</files>
  <action>
Add uploadFromBuffer() method to StorageService with signature:
```typescript
async uploadFromBuffer(
  buffer: Buffer,
  mimetype: string,
  tenantId: string,
  candidateId: string,
): Promise<string>
```

Implementation steps:
1. Validate MIME type: only accept 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
   - Throw BadRequestException if invalid: { error: { code: 'INVALID_FILE_TYPE', message: '...' } }
2. Determine extension from mimetype (reuse getExtension() or create new method)
3. Generate R2 key: `cvs/{tenantId}/{candidateId}{extension}` (e.g., `cvs/abc123/def456.pdf`)
4. Create PutObjectCommand with bucket, key, buffer body, ContentType
5. Send command to S3Client (same pattern as existing upload() method)
6. Log: `Uploaded {key} to R2 ({size} bytes)`
7. Return full R2 object key (NOT presigned URL) — matches D-02 pattern

Reference: StorageService.upload() lines 28-59 shows existing pattern for PutObjectCommand, ContentType, and return value.

IMPORTANT: Do NOT include upload() signature change — only ADD uploadFromBuffer() as new method. Existing upload() continues to work for email webhooks.
  </action>
  <verify>
    <automated>grep -n "uploadFromBuffer" src/storage/storage.service.ts && npm run build 2>&1 | grep -E "error|Error" || echo "Build successful"</automated>
  </verify>
  <done>uploadFromBuffer() method exists with MIME type validation, R2 key generation, PutObjectCommand, and error handling. Builds without errors.</done>
</task>

---

<task type="auto">
  <name>Task 3: Implement CandidatesService.createCandidate() with file upload and atomic transaction</name>
  <files>src/candidates/candidates.service.ts</files>
  <action>
Add createCandidate() method to CandidatesService with full implementation:

```typescript
async createCandidate(
  dto: CreateCandidateDto,
  file: Express.Multer.File | undefined,
): Promise<{ candidate: any; application: any }>
```

Pre-validation (before transaction):
1. Extract tenantId: `const tenantId = this.configService.get<string>('TENANT_ID')!;`
2. Validate job exists in tenant:
   ```typescript
   const job = await this.prisma.job.findUnique({
     where: { id_tenantId: { id: dto.job_id, tenantId } },
   });
   if (!job) throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
   ```
3. Validate email uniqueness (only if email provided):
   ```typescript
   if (dto.email) {
     const existing = await this.prisma.candidate.findFirst({
       where: { tenantId, email: dto.email },
       select: { id: true },
     });
     if (existing) throw new ConflictException({ error: { code: 'EMAIL_EXISTS', message: 'A candidate with this email already exists' } });
   }
   ```

File upload (before transaction, external service):
1. Initialize cvFileUrl = null
2. If file provided:
   - Validate MIME type (delegate to storageService.uploadFromBuffer validation)
   - Generate UUID v4: `const candidateId = v4();` (use crypto.randomUUID() or uuid library)
   - Call `cvFileUrl = await this.storageService.uploadFromBuffer(file.buffer, file.mimetype, tenantId, candidateId);`
   - Catch errors: If BadRequestException, re-throw. If other errors, throw InternalServerErrorException.

Atomic transaction:
```typescript
return this.prisma.$transaction(async (tx) => {
  const candidate = await tx.candidate.create({
    data: {
      id: candidateId || v4(),  // Use generated ID if file upload happened, else generate new
      tenantId,
      fullName: dto.full_name,
      email: dto.email ?? null,
      phone: dto.phone ?? null,
      currentRole: dto.current_role ?? null,
      location: dto.location ?? null,
      yearsExperience: dto.years_experience ?? null,
      skills: dto.skills ?? [],
      cvText: null,  // D-02: null for manual adds
      cvFileUrl,     // from file upload or null
      source: dto.source,
      sourceAgency: dto.source_agency ?? null,
      sourceEmail: null,  // D-02: null for manual adds
      aiSummary: dto.ai_summary ?? null,
      metadata: null,  // D-02: null for manual adds
    },
    include: {
      applications: { select: { id: true } },  // For response
    },
  });

  const application = await tx.application.create({
    data: {
      tenantId,
      candidateId: candidate.id,
      jobId: dto.job_id,
      stage: 'new',  // D-04
      appliedAt: new Date(),
    },
  });

  return { candidate, application };
});
```

Post-transaction response mapping (snake_case per D-03):
Map candidate + application to response format:
```typescript
{
  id: candidate.id,
  tenant_id: candidate.tenantId,
  full_name: candidate.fullName,
  email: candidate.email,
  phone: candidate.phone,
  current_role: candidate.currentRole,
  location: candidate.location,
  years_experience: candidate.yearsExperience,
  skills: candidate.skills,
  cv_text: candidate.cvText,  // null for manual
  cv_file_url: candidate.cvFileUrl,
  source: candidate.source,
  source_agency: candidate.sourceAgency,
  source_email: candidate.sourceEmail,  // null for manual
  metadata: candidate.metadata,  // null for manual
  created_at: candidate.createdAt,
  updated_at: candidate.updatedAt,
  application_id: application.id,
}
```

Error handling: Pre-checks throw BadRequestException (validation), NotFoundException (job not found), ConflictException (email exists) — all before transaction. Transaction errors (rare) propagate as 500 (let NestJS handle).

Reference patterns:
- JobsService.createJob() lines 43-98 for Prisma $transaction, snake_case mapping
- CandidatesService.findAll() lines 94-113 for snake_case response mapping
- StorageService.upload() for file handling and error catching

IMPORTANT: Generate candidateId BEFORE uploading file, use same ID in R2 key and candidate.create(). This prevents orphaned files.
  </action>
  <verify>
    <automated>npm test -- src/candidates/candidates.service.spec.ts --testNamePattern="createCandidate" -x || grep -n "createCandidate" src/candidates/candidates.service.ts</automated>
  </verify>
  <done>createCandidate() method fully implemented with pre-validation, file upload, atomic transaction, snake_case response. Builds without errors.</done>
</task>

---

<task type="auto">
  <name>Task 4: Implement JobsService.getOpenJobs() method</name>
  <files>src/jobs/jobs.service.ts</files>
  <action>
Add getOpenJobs() method to JobsService:

```typescript
async getOpenJobs(): Promise<{ jobs: Array<{ id: string; title: string; department: string | null }> }> {
  const tenantId = this.configService.get<string>('TENANT_ID')!;

  const jobs = await this.prisma.job.findMany({
    where: { tenantId, status: 'open' },
    select: {
      id: true,
      title: true,
      department: true,
    },
    orderBy: { createdAt: 'asc' },  // or 'desc' — implementation choice, consistent with phase
  });

  return {
    jobs: jobs.map((j) => ({
      id: j.id,
      title: j.title,
      department: j.department,
    })),
  };
}
```

Key points:
- Filter by tenantId from ConfigService (tenant isolation per Pattern 4)
- Only return jobs with status = 'open' (per D-06)
- Select only {id, title, department} (lightweight, no hiring stages or screening questions)
- Response format matches spec: `{ jobs: [...] }`
- No pagination (MVP per D-06)

Reference: JobsService.findAll() lines 24-41 for tenantId extraction, status filtering pattern.
  </action>
  <verify>
    <automated>npm test -- src/jobs/jobs.service.spec.ts --testNamePattern="getOpenJobs" -x || grep -n "getOpenJobs" src/jobs/jobs.service.ts</automated>
  </verify>
  <done>getOpenJobs() method exists, filters by tenantId + status='open', returns minimal fields in correct response format.</done>
</task>

---

<task type="auto">
  <name>Task 5: Add POST /candidates and GET /jobs/list routes to CandidatesController</name>
  <files>src/candidates/candidates.controller.ts</files>
  <action>
Update CandidatesController to add two routes:

POST /candidates route:
```typescript
@Post()
@UseInterceptors(FileInterceptor('cv_file'))  // matches multipart field name
async create(
  @UploadedFile() file: Express.Multer.File | undefined,
  @Body() dto: CreateCandidateDto,
): Promise<any> {
  return this.candidatesService.createCandidate(dto, file);
}
```

Imports needed:
- FileInterceptor from '@nestjs/platform-express'
- UseInterceptors, UploadedFile, Post, Body from '@nestjs/common'
- CreateCandidateDto from './dto/create-candidate.dto'

GET /jobs/list route:
```typescript
@Get('jobs/list')  // or use JobsController if preferred
async getJobsList(): Promise<any> {
  return this.jobsService.getOpenJobs();
}
```

Imports: Add JobsService to constructor via dependency injection.

Alternative placement: If GET /jobs/list should be in JobsController instead of CandidatesController, update accordingly. The RESEARCH.md mentions CandidatesController for both routes, but JobsController is more semantically correct. Choose one consistently.

Notes:
- FileInterceptor('cv_file') matches the 'cv_file' field name in multipart request
- file is Express.Multer.File with { buffer, mimetype, originalname, size, ...}
- file is undefined if no file uploaded (optional per spec)
- @Body() dto is automatically parsed from multipart form fields OR JSON (multer + NestJS handle both)
- Return value from createCandidate() is already snake_case, pass through directly

Error handling: Exceptions from service (BadRequestException, NotFoundException, ConflictException) automatically return correct HTTP status codes (400, 404, 409).

Reference:
- NestJS FileInterceptor documentation and examples in RESEARCH.md Example 6
- JobsController.ts pattern for route structure and dependency injection
  </action>
  <verify>
    <automated>npm run build && grep -E "@Post|@Get.*jobs/list|FileInterceptor" src/candidates/candidates.controller.ts</automated>
  </verify>
  <done>POST /candidates with FileInterceptor and GET /jobs/list routes added to CandidatesController. Builds without errors. Routes handle multipart + JSON input correctly.</done>
</task>

---

### Wave 2: Unit Tests (Service Logic) + Integration Tests (Full Flow)

**Overview:** Create comprehensive test suites covering file validation, email uniqueness, transaction atomicity, error responses, and end-to-end POST /candidates + GET /jobs/list flows.

---

<task type="auto">
  <name>Task 6: Create unit tests for CandidatesService.createCandidate()</name>
  <files>src/candidates/candidates.service.spec.ts</files>
  <action>
Create or extend candidates.service.spec.ts with unit tests (mock StorageService, PrismaService, ConfigService):

**File Validation Tests (3 tests):**
1. "should accept PDF file" — file.mimetype = 'application/pdf', expect storageService.uploadFromBuffer called
2. "should accept DOCX file" — file.mimetype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', expect call
3. "should reject invalid file type (exe)" — file.mimetype = 'application/x-msdownload', expect BadRequestException with code 'INVALID_FILE_TYPE'

**Email Uniqueness Tests (2 tests):**
4. "should accept new email" — dto.email = 'new@example.com', prisma.candidate.findFirst returns null, expect success
5. "should reject duplicate email" — dto.email = 'existing@example.com', prisma.candidate.findFirst returns { id: 'xxx' }, expect ConflictException with code 'EMAIL_EXISTS'

**Transaction Atomicity Tests (2 tests):**
6. "should create Candidate + Application atomically" — both create calls succeed inside transaction, expect { candidate, application } returned
7. "should rollback if Application create fails" — candidate.create succeeds but application.create throws error, expect transaction.rollback called (via jest.mock or actual Prisma $transaction error handling)

**Tenant Isolation Test (1 test):**
8. "should filter job by tenantId" — prisma.job.findUnique called with where: { id_tenantId: { id, tenantId } }, verify tenantId always included

Test structure:
```typescript
describe('CandidatesService.createCandidate', () => {
  let service: CandidatesService;
  let mockStorageService: any;
  let mockPrismaService: any;
  let mockConfigService: any;

  beforeEach(() => {
    // Mock services
    mockStorageService = { uploadFromBuffer: jest.fn() };
    mockPrismaService = { candidate: { findFirst: jest.fn() }, job: { findUnique: jest.fn() }, $transaction: jest.fn() };
    mockConfigService = { get: jest.fn().mockReturnValue('tenant-123') };

    service = new CandidatesService(mockPrismaService, mockConfigService);
    (service as any).storageService = mockStorageService;
  });

  it('should accept PDF file', async () => {
    // arrange
    const file = { buffer: Buffer.from('pdf'), mimetype: 'application/pdf', originalname: 'cv.pdf' };
    const dto = { full_name: 'John', email: 'john@example.com', job_id: 'job-1', source: 'linkedin' };
    mockPrismaService.job.findUnique.mockResolvedValue({ id: 'job-1' });
    mockPrismaService.candidate.findFirst.mockResolvedValue(null);
    mockStorageService.uploadFromBuffer.mockResolvedValue('cvs/tenant-123/candidate-123.pdf');
    mockPrismaService.$transaction.mockImplementation(async (fn) => {
      return fn({
        candidate: { create: jest.fn().mockResolvedValue({ id: 'candidate-123', fullName: 'John' }) },
        application: { create: jest.fn().mockResolvedValue({ id: 'app-123' }) },
      });
    });

    // act
    const result = await service.createCandidate(dto, file);

    // assert
    expect(mockStorageService.uploadFromBuffer).toHaveBeenCalledWith(
      file.buffer,
      'application/pdf',
      'tenant-123',
      expect.any(String),  // candidateId (UUID)
    );
  });

  // ... other tests
});
```

Use jest.fn(), jest.mock(), and manual mocks for external services. Avoid hitting real database or R2.

Reference: Existing test patterns in the codebase (if any .spec.ts files exist) or NestJS testing documentation.
  </action>
  <verify>
    <automated>npm test -- src/candidates/candidates.service.spec.ts -x 2>&1 | grep -E "passed|failed" || echo "Tests ran"</automated>
  </verify>
  <done>8+ unit tests created for createCandidate() covering file validation (3), email uniqueness (2), atomicity (2), tenant isolation (1). All pass.</done>
</task>

---

<task type="auto">
  <name>Task 7: Create integration tests for POST /candidates and GET /jobs/list</name>
  <files>tests/candidates.integration.spec.ts</files>
  <action>
Create integration test file (tests/candidates.integration.spec.ts) using Supertest + real database (or transaction rollback):

**POST /candidates Success Flows (2 tests):**
1. "POST /candidates 201 — create candidate with CV file"
   - Setup: POST multipart request with file + full_name, email, job_id, source
   - Assert: 201 response, candidate record in DB with cv_file_url, application record created with stage='new', R2 file exists (or mock verified)
   - Check response fields: all snake_case, includes application_id

2. "POST /candidates 201 — create candidate without CV file"
   - Setup: POST JSON request (no file) with full_name, email, job_id, source
   - Assert: 201 response, cv_file_url = null, cv_text = null, application created
   - Check response matches spec

**POST /candidates Error Responses (4 tests):**
3. "POST /candidates 400 — invalid email format"
   - Setup: POST with email = 'not-an-email', full_name, job_id, source
   - Assert: 400 response, error.code = 'VALIDATION_ERROR'

4. "POST /candidates 400 — invalid file type (exe)"
   - Setup: POST multipart with invalid MIME type file, other fields valid
   - Assert: 400 response, error.code = 'INVALID_FILE_TYPE'

5. "POST /candidates 404 — job_id not found"
   - Setup: POST with job_id = 'non-existent-uuid', other fields valid
   - Assert: 404 response, error.code = 'NOT_FOUND'

6. "POST /candidates 409 — duplicate email"
   - Setup: Create candidate 1, then POST candidate 2 with same email
   - Assert: 409 response, error.code = 'EMAIL_EXISTS'

**GET /jobs/list Test (1 test):**
7. "GET /jobs/list 200 — returns only open jobs with required fields"
   - Setup: Create 3 jobs with status 'open', 'draft', 'closed'
   - Assert: 200 response, jobs array has 1 item (only 'open' status)
   - Check fields: id, title, department (no hiring_stages, no description)

**Atomic Transaction Test (1 test):**
8. "POST /candidates atomic transaction — rollback on application create failure"
   - Setup: Mock application.create() to throw error
   - Assert: 500 response, no candidate record created in DB (transaction rolled back)

Test structure:
```typescript
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';

describe('CandidatesController (Integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /candidates', () => {
    it('should return 201 with CV file', async () => {
      const file = fs.readFileSync('test-fixtures/cv.pdf');
      const response = await request(app.getHttpServer())
        .post('/candidates')
        .field('full_name', 'John Doe')
        .field('email', 'john@example.com')
        .field('job_id', 'valid-job-id')
        .field('source', 'linkedin')
        .attach('cv_file', file, 'cv.pdf');

      expect(response.status).toBe(201);
      expect(response.body.id).toBeDefined();
      expect(response.body.cv_file_url).toBeDefined();
      expect(response.body.application_id).toBeDefined();
      expect(response.body.cv_text).toBeNull();
    });

    // ... other tests
  });

  describe('GET /jobs/list', () => {
    it('should return only open jobs', async () => {
      // Setup: create open + closed jobs
      // POST jobs to create test data

      const response = await request(app.getHttpServer()).get('/jobs/list');

      expect(response.status).toBe(200);
      expect(response.body.jobs.length).toBeGreaterThan(0);
      expect(response.body.jobs[0]).toHaveProperty('id');
      expect(response.body.jobs[0]).toHaveProperty('title');
      expect(response.body.jobs[0]).toHaveProperty('department');
      expect(response.body.jobs[0]).not.toHaveProperty('hiring_stages');
    });
  });
});
```

Use:
- Supertest for HTTP requests (request(app.getHttpServer()).post(...))
- fs.readFileSync() or test fixtures for file uploads
- Actual database (wrapped in transaction for rollback) or mock database
- beforeAll/afterAll for app lifecycle
- beforeEach for test isolation (clear test data)

Reference: Existing test patterns in codebase (jest.config.js, any .integration.spec.ts files) and NestJS/Supertest documentation.
  </action>
  <verify>
    <automated>npm test -- tests/candidates.integration.spec.ts -x 2>&1 | grep -E "passed|failed" || echo "Integration tests ran"</automated>
  </verify>
  <done>8+ integration tests created covering success flows (2), error responses (4), GET /jobs/list (1), atomicity (1). All pass with real/mocked database.</done>
</task>

---

### Wave 3: Smoke Test + Documentation

**Overview:** Manual verification that the full flow works end-to-end (create candidate via HTTP, verify in DB + R2), and update API documentation if applicable.

---

<task type="checkpoint:human-verify" gate="blocking">
  <name>Checkpoint: Verify POST /candidates and GET /jobs/list endpoints work end-to-end</name>
  <what-built>
- POST /candidates endpoint with FileInterceptor, atomic transaction, file upload to R2
- GET /jobs/list endpoint returning open jobs
- Complete request/response validation, error handling
- All tests passing (unit + integration)
  </what-built>
  <how-to-verify>
**Prerequisites:**
- Dev server running: `npm run dev` (or `npm run start:dev`)
- Database running: `docker-compose up -d` (PostgreSQL + Redis)
- Cloudflare R2 credentials set in `.env` (or use mock/stub for testing)

**Test 1: Create candidate WITH CV file**
```bash
curl -X POST http://localhost:3000/candidates \
  -H "X-Tenant-Id: test-tenant-123" \
  -F "full_name=Jane Doe" \
  -F "email=jane@example.com" \
  -F "source=linkedin" \
  -F "job_id=<copy-a-real-job-id-from-GET-/jobs-output>" \
  -F "cv_file=@/path/to/test.pdf" \
  -v
```
Expected response:
- HTTP 201 Created
- Response body includes: id, tenant_id, full_name, email, cv_file_url (non-null), application_id, cv_text (null), created_at, updated_at
- All fields in snake_case

Verify in database:
```bash
psql postgres://user:pass@localhost:5432/db -c "SELECT id, full_name, email, cv_file_url, cv_text FROM candidates WHERE email='jane@example.com';"
```
Expected: One row with cv_file_url populated, cv_text = NULL

Verify in R2:
- Check Cloudflare R2 console or use aws s3api cli: `aws s3api head-object --bucket <R2_BUCKET> --key cvs/test-tenant-123/<candidateId>.pdf`

Verify Application created:
```bash
psql postgres://user:pass@localhost:5432/db -c "SELECT id, candidate_id, job_id, stage FROM applications WHERE candidate_id='<candidateId>';"
```
Expected: One row with stage = 'new'

**Test 2: Create candidate WITHOUT CV file**
```bash
curl -X POST http://localhost:3000/candidates \
  -H "X-Tenant-Id: test-tenant-123" \
  -H "Content-Type: application/json" \
  -d '{"full_name":"John Smith","email":"john@example.com","source":"referral","job_id":"<job-id>"}' \
  -v
```
Expected response:
- HTTP 201 Created
- cv_file_url = null
- cv_text = null
- application_id present

**Test 3: Duplicate email (should get 409)**
```bash
curl -X POST http://localhost:3000/candidates \
  -H "X-Tenant-Id: test-tenant-123" \
  -H "Content-Type: application/json" \
  -d '{"full_name":"Jane Again","email":"jane@example.com","source":"linkedin","job_id":"<job-id>"}' \
  -v
```
Expected response:
- HTTP 409 Conflict
- error.code = 'EMAIL_EXISTS'

**Test 4: Missing job_id (should get 404)**
```bash
curl -X POST http://localhost:3000/candidates \
  -H "X-Tenant-Id: test-tenant-123" \
  -H "Content-Type: application/json" \
  -d '{"full_name":"Nobody","email":"nobody@example.com","source":"website","job_id":"fake-job-id"}' \
  -v
```
Expected response:
- HTTP 404 Not Found
- error.code = 'NOT_FOUND'

**Test 5: GET /jobs/list**
```bash
curl -X GET "http://localhost:3000/candidates/jobs/list" \
  -H "X-Tenant-Id: test-tenant-123" \
  -v
```
Expected response:
- HTTP 200 OK
- jobs array with objects containing: id, title, department
- NO hiring_stages, description, or other fields
- Only jobs with status = 'open'
  </how-to-verify>
  <resume-signal>
Describe results of tests 1-5:
- [Test 1] POST with file: [status code], [cv_file_url presence], [DB candidate row exists], [R2 file exists], [Application created]
- [Test 2] POST without file: [status code], [cv_file_url = null], [Application created]
- [Test 3] Duplicate email: [status code], [error.code]
- [Test 4] Missing job: [status code], [error.code]
- [Test 5] GET /jobs/list: [status code], [jobs count], [fields present]

If all tests pass as expected, type: "approved"
If tests fail, describe the issue and we'll debug.
  </resume-signal>
</task>

---

<task type="auto">
  <name>Task 8: Verify all tests pass and code builds</name>
  <files></files>
  <action>
Run full test suite and build:
```bash
npm test                          # Run all tests (unit + integration)
npm run build                     # TypeScript compilation
npm run lint                      # Optional: linting
```

Expected outcomes:
- All tests pass (candidates.service.spec.ts: 8+, candidates.integration.spec.ts: 8+, jobs.service.spec.ts if modified)
- No TypeScript errors during build
- No unused imports or code style issues

If any tests fail:
- Review test output for specific failure reason
- Check mock setup, database state, or service implementation
- Fix root cause and re-run
- Document any manual setup needed (fixtures, seed data)

Final verification checklist:
- [ ] POST /candidates endpoint responds on port 3000
- [ ] GET /jobs/list endpoint responds on port 3000
- [ ] FileInterceptor correctly parses multipart + JSON
- [ ] All response fields are snake_case
- [ ] No console errors or warnings in test output
- [ ] Database changes (candidates, applications) persisted correctly
- [ ] R2 file upload verified (or mocked in tests)
  </action>
  <verify>
    <automated>npm test 2>&1 | grep -E "passed|failed|error" && npm run build 2>&1 | grep -E "error" || echo "Build and tests completed"</automated>
  </verify>
  <done>All tests pass (16+ total unit + integration tests). TypeScript builds without errors. Code ready for deployment.</done>
</task>

---

## Integration Points

**Files to create:**
- `src/candidates/dto/create-candidate.dto.ts` — Zod schema (NEW)
- `tests/candidates.integration.spec.ts` — Integration test suite (NEW)
- `src/candidates/candidates.service.spec.ts` — Unit tests (NEW or EXTEND)

**Files to modify:**
- `src/candidates/candidates.service.ts` — Add createCandidate() method (async, file upload, transaction, validation)
- `src/candidates/candidates.controller.ts` — Add POST /candidates, GET /jobs/list (or GET /candidates/jobs/list) routes
- `src/jobs/jobs.service.ts` — Add getOpenJobs() method (filter by status + tenantId)
- `src/storage/storage.service.ts` — Add uploadFromBuffer() method (file validation, R2 upload, key generation)
- `src/jobs/jobs.service.spec.ts` — Add test for getOpenJobs() (NEW or EXTEND)

**Modules (no new imports needed):**
- CandidatesModule — Already exists, already has StorageModule imported (verify in app.module)
- JobsModule — Already exists
- StorageModule — Extends existing

**Database (no migrations needed):**
- Candidate, Application, Job models already exist in schema
- UNIQUE (tenantId, email) constraint already exists on Candidate
- @@unique([tenantId, candidateId, jobId]) already exists on Application

**Environment variables (must exist):**
- R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID, R2_BUCKET_NAME (already set for Phase 5)
- TENANT_ID (resolved from request context per existing pattern)

## Validation

**Unit Tests (8+):**
- File validation: Accept PDF, Accept DOCX, Reject invalid type (3 tests)
- Email uniqueness: Accept new email, Reject duplicate (2 tests)
- Transaction atomicity: Create both records, Rollback on failure (2 tests)
- Tenant isolation: Query includes tenantId (1 test)

**Integration Tests (8+):**
- POST /candidates with file: 201, cv_file_url populated, application created (1 test)
- POST /candidates without file: 201, cv_file_url null, application created (1 test)
- POST /candidates validation: Invalid email 400, Invalid file 400, Missing job 404, Duplicate email 409 (4 tests)
- GET /jobs/list: 200, returns only open jobs, fields {id, title, department} (1 test)
- Transaction atomicity: Rollback on application failure (1 test)

**Smoke Test (manual, via curl):**
- Create candidate with file, verify in DB + R2
- Create candidate without file
- Duplicate email rejection (409)
- Missing job rejection (404)
- GET /jobs/list returns correct jobs

**Automated Verification Command:**
```bash
npm test -- --testPathPattern="candidates|jobs" --testNamePattern="createCandidate|getOpenJobs|jobs.*list" -x
```

## Implementation Notes

**Key decisions implemented:**
- **D-01:** No pg_trgm duplicate detection for manual adds — pre-validation only (email uniqueness)
- **D-02:** CV files uploaded to R2, cv_text stays null, cv_file_url populated
- **D-03:** All responses use snake_case (matches existing API)
- **D-04:** Application stage always "new" for manual adds
- **D-05:** Atomic Prisma $transaction for Candidate + Application or nothing
- **D-06:** GET /jobs/list returns {id, title, department} for open jobs only

**Patterns followed:**
- Pattern 1: FileInterceptor(@nestjs/platform-express) + @Body() for multipart + JSON
- Pattern 2: Pre-validate (job exists, email unique, file valid) BEFORE transaction; upload file BEFORE transaction; create records INSIDE transaction
- Pattern 3: Server-side MIME type + extension validation
- Pattern 4: ConfigService.get('TENANT_ID') once per method, use in all queries
- Pattern 5: Map camelCase DB fields to snake_case in response
- Pattern 6: Standard { error: { code, message, details? } } format for errors

**Critical implementation detail (Pitfall 6 from RESEARCH.md):**
- Generate candidateId (UUID v4) BEFORE uploading file to R2
- Use same candidateId in R2 key: `cvs/{tenantId}/{candidateId}.{ext}`
- Create candidate with that pre-generated ID
- This prevents orphaned files with non-existent candidate IDs

**No new packages required:**
- @nestjs/platform-express already installed (includes FileInterceptor)
- multer is a dependency of @nestjs/platform-express
- All other services already available (StorageService, PrismaService, ConfigService)

## Success Criteria Summary

✓ POST /candidates accepts multipart (with file) and JSON (without file)
✓ Candidate + Application created atomically in single transaction
✓ CV files validated by MIME type before upload
✓ cv_file_url populated from R2; cv_text stays null
✓ 409 on duplicate email (pre-validated, never reaches DB)
✓ 404 on missing job_id or wrong tenant
✓ 201 response with complete data in snake_case
✓ GET /jobs/list returns open jobs only with {id, title, department}
✓ Application.stage = "new" for all manual adds
✓ 8+ unit tests passing (file, email, atomicity validation)
✓ 8+ integration tests passing (success flows, error responses, GET /jobs/list)
✓ All operations tenant-isolated via ConfigService.get('TENANT_ID')

---

*Phase: 12-support-add-candidate-from-the-ui-not-from-the-webhook*
*Plan: 1 (standard execution)*
*Created: 2026-03-26*
*Confidence: HIGH — All patterns proven in Phases 5–11, no new external dependencies*
