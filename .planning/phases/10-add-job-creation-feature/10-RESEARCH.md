# Phase 10: Add job creation feature - Research

**Researched:** 2026-03-24
**Domain:** Prisma nested creates, NestJS DTO validation with Zod, additive schema migrations
**Confidence:** HIGH

## Summary

Phase 10 adds a `POST /jobs` endpoint that atomically creates a Job with nested JobStage and ScreeningQuestion records. The schema migration is purely additive (no field removals or migrations of existing data this phase). Prisma 7 supports nested creates natively via the `create` option on relations, allowing Job + JobStages + ScreeningQuestions to be created in a single atomic operation. The project uses Zod exclusively for validation (no class-validator), enabling type-safe DTO composition for nested arrays. Default hiring stages (Application Review, Screening, Interview, Offer) are auto-seeded on every job creation via application logic, not database triggers.

**Primary recommendation:** Use Prisma nested creates (`prisma.job.create({ data: { ..., hiringStages: { create: [...] } } })`) with `prisma.$transaction()` for atomicity across Job + JobStages + ScreeningQuestions. Define Zod DTO schemas mirroring the Prisma structure and compose them to validate nested payloads.

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Keep `description`, `requirements[]` on `Job` — additive only, no removals this phase
- **D-02:** Keep `Application.stage` (String) alongside new `jobStageId` (nullable FK). Coexistence, no data migration
- **D-03:** `ScoringAgentService` NOT touched this phase
- **D-04:** Auto-seed exactly 4 default stages per job: Application Review (1), Screening (2), Interview (3), Offer (4)
- **D-05:** Default stages have `isCustom = false`; recruiter-added stages use `isCustom = true`
- **D-06:** `POST /jobs` accepts nested `hiringStages[]` + `screeningQuestions[]` — service decomposes internally
- **D-07:** If `hiringStages` omitted, auto-seed defaults (D-04); if provided, use provided stages instead
- **D-08:** Validation via Zod. All new fields optional except `title` and `tenantId` (from config)
- **D-09:** `responsibleUserId` on `JobStage` is `String? @db.Text` (free text), NOT @db.Uuid
- **D-10:** `JobStage` and `ScreeningQuestion` must include `tenant Tenant @relation(...)` declarations AND `Tenant` model must add back-relations

### Claude's Discretion

- DTO structure details (nested Zod schemas)
- Response shape for `POST /jobs` (full job + stages + questions, or just job ID)
- Whether to add `GET /jobs/:id`, `PUT /jobs/:id` in this phase
- Error handling for duplicate job titles within a tenant

### Deferred Ideas (OUT OF SCOPE)

- Update `ScoringAgentService` to use new Job fields (separate phase)
- Drop `description`, `requirements[]` from Job (depends on scoring update)
- Replace `Application.stage` with `jobStageId` as primary (separate migration phase)
- Auth on write endpoints (Phase 2)
- User model / FK for `responsibleUserId` (Phase 2+)

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Prisma | 7.5.0 | ORM + migrations | Locked in CLAUDE.md; supports nested creates natively; PostgreSQL native |
| NestJS | 11.0.1 | HTTP framework + DI | Locked; provides controller/service injection pattern |
| Zod | 4.3.6 | Validation | Already established in project (used for Postmark payloads, extraction schema, env vars); pure TS, no decorators |
| PostgreSQL | 16 | Database | Locked; native UUID, JSONB, text arrays, transactions |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| PrismaService | injected | Database access | All database queries in services |
| ConfigService | @nestjs/config | Environment + tenantId retrieval | Always: `configService.get<string>('TENANT_ID')` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Prisma nested creates | Multiple separate inserts | Loose atomicity; 3+ DB round-trips; harder to validate relationships |
| Zod DTO validation | class-validator decorators | Requires NestJS ValidationPipe + transformer; already not in project; more ceremony |
| Manual default stage seeding | Database-level default triggers | Triggers harder to test; Prisma seeds don't run on DB startup; application logic clearer |

**Installation:** All dependencies already present in project; no new packages required.

**Version verification:** Prisma 7.5.0 (latest in v7 series as of March 2026), Zod 4.3.6 (latest v4), NestJS 11.0.1.

## Architecture Patterns

### Recommended Project Structure

New files to add:

```
src/jobs/
├── dto/
│   ├── create-job.dto.ts         # Zod schema + type for POST /jobs request
│   └── hiring-stage.dto.ts       # Zod schema for nested stages
├── jobs.controller.ts             # Add @Post() handler
├── jobs.service.ts                # Add createJob() method with nested creates
└── jobs.module.ts                 # No changes needed (already imports PrismaModule)

prisma/
├── schema.prisma                  # Add JobStage, ScreeningQuestion models; extend Job, Application
└── migrations/
    └── [timestamp]_add_job_creation_models/
        └── migration.sql           # Generated by `prisma migrate dev`
```

### Pattern 1: Prisma Nested Creates with Atomicity

**What:** Single Prisma operation to create Job + related JobStages + ScreeningQuestions in one atomic transaction.

**When to use:** Whenever parent-child relationships must be created together with all-or-nothing semantics (job creation here, not updates to existing jobs).

**Example:**

```typescript
// Source: Prisma docs + codebase pattern (ingestion.processor.ts uses $transaction)
const job = await this.prisma.job.create({
  data: {
    tenantId: this.configService.get<string>('TENANT_ID')!,
    title: createJobDto.title,
    description: createJobDto.description ?? null,
    requirements: createJobDto.requirements ?? [],
    // ... other optional fields
    hiringStages: {
      create: [
        { tenantId, name: 'Application Review', order: 1, isCustom: false },
        { tenantId, name: 'Screening', order: 2, isCustom: false },
        { tenantId, name: 'Interview', order: 3, isCustom: false },
        { tenantId, name: 'Offer', order: 4, isCustom: false },
      ],
    },
    screeningQuestions: {
      create: createJobDto.screeningQuestions?.map((q, i) => ({
        tenantId,
        text: q.text,
        answerType: q.answerType,
        required: q.required ?? false,
        knockout: q.knockout ?? false,
        order: i + 1,
      })) ?? [],
    },
  },
  include: {
    hiringStages: true,
    screeningQuestions: true,
  },
});
```

**Why atomic:** Prisma wraps nested creates in an implicit transaction — if any relation fails to create, the entire operation rolls back. No partial jobs left in DB.

### Pattern 2: Zod DTO Composition for Nested Payloads

**What:** Zod schemas can be nested and composed to mirror Prisma relation structure. Enables type-safe validation of `POST /jobs` request bodies with optional nested arrays.

**When to use:** Any NestJS endpoint accepting optional nested arrays (stages, questions, tags, etc.).

**Example:**

```typescript
// Source: Postmark DTO pattern already in codebase (webhooks/dto/postmark-payload.dto.ts)
// Extending pattern for nested objects

// schemas/hiring-stage.schema.ts
export const HiringStageCreateSchema = z.object({
  name: z.string().min(1).max(255),
  order: z.number().int().min(1).max(100),
  responsibleUserId: z.string().nullable().optional(),
  isCustom: z.boolean().default(false),
});

export const ScreeningQuestionCreateSchema = z.object({
  text: z.string().min(1),
  answerType: z.enum(['yes_no', 'text', 'multiple_choice', 'file_upload']),
  required: z.boolean().default(false),
  knockout: z.boolean().default(false),
  order: z.number().int().min(1),
});

// dto/create-job.dto.ts
export const CreateJobSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  requirements: z.array(z.string()).default([]),
  department: z.string().optional(),
  location: z.string().optional(),
  jobType: z.string().default('full_time'),
  status: z.string().default('draft'),
  hiringStages: z.array(HiringStageCreateSchema).optional(), // omit to auto-seed
  screeningQuestions: z.array(ScreeningQuestionCreateSchema).optional(),
  // new fields from Phase 10
  roleSummary: z.string().optional(),
  responsibilities: z.string().optional(),
  whatWeOffer: z.string().optional(),
  mustHaveSkills: z.array(z.string()).default([]),
  niceToHaveSkills: z.array(z.string()).default([]),
  expYearsMin: z.number().int().optional(),
  expYearsMax: z.number().int().optional(),
  preferredOrgTypes: z.array(z.string()).default([]),
});

export type CreateJobDto = z.infer<typeof CreateJobSchema>;
```

**In NestJS controller:**

```typescript
@Post()
async create(@Body(new ZodValidationPipe()) createJobDto: CreateJobDto) {
  return this.jobsService.createJob(createJobDto);
}
```

**Why composition matters:** Zod schemas can be reused (`HiringStageCreateSchema`) and extended (`z.extend({ ... })`), making DTOs maintainable and DRY.

### Pattern 3: Application Logic for Default Seeding (not DB-level)

**What:** If `hiringStages` is omitted from the request, the service creates the 4 default stages before calling Prisma.

**When to use:** When defaults should be visible to the application (for testing, composability) rather than hidden in DB-level defaults.

**Example:**

```typescript
async createJob(dto: CreateJobDto): Promise<Job> {
  const tenantId = this.configService.get<string>('TENANT_ID')!;

  const hiringStages = dto.hiringStages || [
    { tenantId, name: 'Application Review', order: 1, isCustom: false },
    { tenantId, name: 'Screening', order: 2, isCustom: false },
    { tenantId, name: 'Interview', order: 3, isCustom: false },
    { tenantId, name: 'Offer', order: 4, isCustom: false },
  ];

  return this.prisma.job.create({
    data: {
      tenantId,
      title: dto.title,
      hiringStages: { create: hiringStages },
      // ...
    },
  });
}
```

### Anti-Patterns to Avoid

- **Creating nested records in a loop:** ❌ `for (const stage of stages) { await prisma.jobStage.create(...) }` — loses atomicity. ✓ Use `hiringStages: { create: [...] }` instead.
- **Omitting `tenantId` on child models:** ❌ Violates tenant isolation (DB-02). ✓ Always include `tenantId` on every nested create.
- **Mixing class-validator and Zod:** ❌ Project uses Zod only. ✓ Define all DTOs with Zod schemas.
- **Manual Default Stages in Database:** ❌ DB triggers make tests harder, Prisma seeds don't auto-run. ✓ Seed defaults in service logic (D-04).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Validating nested request payloads | Custom validation loops, middleware | Zod composition + ZodValidationPipe | Type-safe, composable, less error-prone; catches errors at request boundary |
| Ensuring Job + Stages created atomically | Separate inserts with error handling | Prisma nested creates | Single round-trip, automatic rollback on failure, no orphaned records |
| Seeding default hiring stages | Database seed file per tenant | Application logic (service method) | Faster to test, visible to code, works on fresh jobs only (not affecting existing) |
| Generating migration SQL | Manual CREATE TABLE statements | `prisma migrate dev --name add_job_creation` | Avoids syntax errors, auto-generates indexes, handles all data types correctly |

**Key insight:** Prisma's nested create is the default here, not an advanced feature. Custom loops lose atomicity and complicate error handling.

## Common Pitfalls

### Pitfall 1: Forgetting `tenantId` on Nested Creates

**What goes wrong:** Job is created with tenantId, but JobStages are missing tenantId in the nested create data. Tenant filtering on Job > JobStage queries fails silently, or cascading deletes affect wrong tenant.

**Why it happens:** Nested creates require explicit `tenantId` in each object — it doesn't auto-inherit from parent in Prisma. Easy to overlook.

**How to avoid:** Make `tenantId` a required field in Zod schema for nested objects. Add it explicitly in the service before calling Prisma:

```typescript
const hiringStages = dto.hiringStages.map(s => ({
  ...s,
  tenantId, // explicit assignment
}));
```

**Warning signs:** Querying `jobStages` returns stages from other tenants; deleting a job deletes stages unexpectedly.

### Pitfall 2: Assuming Nested `create` Validates Relations

**What goes wrong:** Passing invalid `jobId` in a nested screening question assumes Prisma validates the FK. If jobId is wrong or missing, the query fails at database layer, not in service code.

**Why it happens:** Nested creates look like they validate all relations, but Prisma is just passing data through — DB constraint failures come late.

**How to avoid:** Validate all relation keys before Prisma call. If `jobId` comes from user input, fetch the job first and verify `tenantId` matches:

```typescript
const job = await this.prisma.job.findUnique({ where: { id: jobId, tenantId } });
if (!job) throw new BadRequestException('Job not found');
```

**Warning signs:** Database errors appear in logs rather than NestJS validation pipes.

### Pitfall 3: Partial Job Creation When Client Disconnects

**What goes wrong:** Client drops connection mid-request; Prisma transaction succeeds on server, but client never receives response. On retry, duplicate job with same title.

**Why it happens:** Network is unreliable. Prisma atomicity (all-or-nothing) is strong, but idempotency is caller's responsibility.

**How to avoid:** Generate a client-supplied idempotency key (UUID) before POST. Store in `Job.metadata` or a separate `JobCreationEvents` table. Check before creating:

```typescript
const existing = await this.prisma.job.findFirst({
  where: { tenantId, idempotencyKey: dto.idempotencyKey },
});
if (existing) return existing; // idempotent

// create and store idempotencyKey in metadata
```

**Warning signs:** Recruiter accidentally creates two identical jobs; duplicates appear in logs.

### Pitfall 4: Breaking `Application.stage` Queries

**What goes wrong:** Phase 10 adds `jobStageId` but keeps `stage` for coexistence (D-02). Code that reads `application.stage` silently breaks if queries only check `jobStageId`.

**Why it happens:** Dual representation is easy to misuse — old code still runs, new code assumes `jobStageId` exists, inconsistency snowballs.

**How to avoid:** Explicitly test that both fields work during migration:
- Code reading `a.stage` (old) must still work → don't remove `stage` this phase
- Code reading `a.jobStageId` (new) must gracefully handle null → use optional chaining or defaults
- Add unit test: create application without `jobStageId`, verify `stage` is readable

**Warning signs:** `applications.service.ts:58` stops returning `stage`; recruiter UI shows "undefined" for old applications.

## Code Examples

Verified patterns from official sources:

### Job Creation with Nested Stages

```typescript
// Source: Prisma nested creates docs + ingestion.processor.ts transaction pattern
async createJob(dto: CreateJobDto): Promise<Job> {
  const tenantId = this.configService.get<string>('TENANT_ID')!;

  // D-07: use provided stages, or auto-seed defaults
  const hiringStages = dto.hiringStages || [
    { tenantId, name: 'Application Review', order: 1, isCustom: false },
    { tenantId, name: 'Screening', order: 2, isCustom: false },
    { tenantId, name: 'Interview', order: 3, isCustom: false },
    { tenantId, name: 'Offer', order: 4, isCustom: false },
  ];

  const screeningQuestions = (dto.screeningQuestions ?? []).map((q, i) => ({
    tenantId,
    ...q,
    order: i + 1,
  }));

  return this.prisma.job.create({
    data: {
      tenantId,
      title: dto.title,
      description: dto.description ?? null,
      requirements: dto.requirements ?? [],
      department: dto.department ?? null,
      location: dto.location ?? null,
      jobType: dto.jobType ?? 'full_time',
      status: dto.status ?? 'draft',
      salaryRange: dto.salaryRange ?? null,
      hiringManager: dto.hiringManager ?? null,
      // New fields (Phase 10)
      roleSummary: dto.roleSummary ?? null,
      responsibilities: dto.responsibilities ?? null,
      whatWeOffer: dto.whatWeOffer ?? null,
      mustHaveSkills: dto.mustHaveSkills ?? [],
      niceToHaveSkills: dto.niceToHaveSkills ?? [],
      expYearsMin: dto.expYearsMin ?? null,
      expYearsMax: dto.expYearsMax ?? null,
      preferredOrgTypes: dto.preferredOrgTypes ?? [],
      // Nested creates
      hiringStages: { create: hiringStages },
      screeningQuestions: { create: screeningQuestions },
    },
    include: {
      hiringStages: true,
      screeningQuestions: true,
    },
  });
}
```

### Zod DTO with Nested Schemas

```typescript
// Source: Postmark DTO pattern (webhooks/dto/postmark-payload.dto.ts)
import { z } from 'zod';

export const HiringStageCreateSchema = z.object({
  name: z.string().min(1, 'Stage name required').max(255),
  order: z.number().int().min(1).max(100),
  responsibleUserId: z.string().nullable().optional(), // D-09: free text
  isCustom: z.boolean().default(false),
});

export const ScreeningQuestionCreateSchema = z.object({
  text: z.string().min(1, 'Question text required'),
  answerType: z.enum(['yes_no', 'text', 'multiple_choice', 'file_upload']),
  required: z.boolean().default(false),
  knockout: z.boolean().default(false),
  order: z.number().int().min(1).optional(), // optional; service assigns if omitted
});

export const CreateJobSchema = z.object({
  title: z.string().min(1, 'Job title required').max(255),
  description: z.string().optional(),
  requirements: z.array(z.string()).default([]),
  department: z.string().optional(),
  location: z.string().optional(),
  jobType: z.string().default('full_time'),
  status: z.string().default('draft'),
  salaryRange: z.string().optional(),
  hiringManager: z.string().optional(),
  // Phase 10 new fields
  roleSummary: z.string().optional(),
  responsibilities: z.string().optional(),
  whatWeOffer: z.string().optional(),
  mustHaveSkills: z.array(z.string()).default([]),
  niceToHaveSkills: z.array(z.string()).default([]),
  expYearsMin: z.number().int().optional(),
  expYearsMax: z.number().int().optional(),
  preferredOrgTypes: z.array(z.string()).default([]),
  // Nested arrays (optional per D-07)
  hiringStages: z.array(HiringStageCreateSchema).optional(),
  screeningQuestions: z.array(ScreeningQuestionCreateSchema).optional(),
});

export type CreateJobDto = z.infer<typeof CreateJobSchema>;
```

### NestJS Controller with Zod Validation

```typescript
// Source: NestJS pattern + Zod integration
import { Controller, Post, Body } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { CreateJobSchema, CreateJobDto } from './dto/create-job.dto';

// Simple inline validation (alternative: create ZodValidationPipe for reuse)
function validateZodDto<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new BadRequestException({
      message: 'Validation failed',
      errors: result.error.errors,
    });
  }
  return result.data;
}

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get()
  async findAll() {
    return this.jobsService.findAll();
  }

  @Post()
  async create(@Body() body: unknown) {
    const dto = validateZodDto(CreateJobSchema, body);
    return this.jobsService.createJob(dto);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual INSERT + separate FK inserts | Prisma nested creates | 2021 (Prisma 2.x) | Single round-trip, atomic by default, easier testing |
| Database seeds via raw SQL | Prisma ORM seeding | 2020 (Prisma 2.x) | Schemaless, composable, testable; still manual but cleaner |
| `application.stage` as primary stage source | Dual `stage` + `jobStageId` (Phase 10) | 2026-03-24 | Transition period; eventually drop `stage`, use FK only (Phase 12+) |
| class-validator + class-transformer | Zod validation | 2024 (Triolla adoption) | Pure TypeScript, no decorators, smaller bundle, faster validation |

**Deprecated/outdated:**
- `class-validator` decorators: Not used in project; Zod is the standard
- Manual migration scripts: Prisma 7 generates migrations from schema changes (`prisma migrate dev`)
- Database-level enum types: Project uses `text + CHECK` constraint (allows adding values without migration)

## Open Questions

1. **Response shape for `POST /jobs`**
   - What we know: Endpoint should return created job + nested stages + questions (decision TBD in Claude's Discretion)
   - What's unclear: Return full graph (`job { hiringStages, screeningQuestions }`) or just `{ jobId, createdAt }`?
   - Recommendation: Return full graph to match GraphQL conventions and aid frontend development

2. **Duplicate job title handling**
   - What we know: No unique constraint on `(tenantId, title)` currently
   - What's unclear: Should duplicate titles be allowed (e.g., multiple "Software Engineer" roles)?
   - Recommendation: Allow duplicates; add unique constraint only if business rule requires it

3. **Why no `jobStageId` FK on `Job` itself?**
   - What we know: JobStage is one-to-many from Job (job has many stages)
   - What's unclear: Should Job track "current default stage" (e.g., the first/review stage)?
   - Recommendation: Don't add; Stage is per-Application, not per-Job. Job has options; Application chooses one.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL 16 | Database for job records | ✓ (docker-compose) | 16-alpine | — |
| Redis | BullMQ (if async job creation needed) | ✓ (docker-compose) | 7-alpine | In-memory queue (not production) |
| Node.js | Runtime | ✓ | v22.10.7 | — |
| npm | Package manager | ✓ | v10.x | — |
| Docker | Container platform (dev) | ✓ | 24.0+ | Manual setup (not recommended) |
| Prisma CLI | Migration generation | ✓ (npm script) | 7.5.0 | — |

**Missing dependencies with no fallback:**
- None — all required tools available in dev environment

**Missing dependencies with fallback:**
- None — no fallbacks needed

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest 30.0.0 + ts-jest 29.2.5 |
| Config file | `package.json` (jest config) + `test/jest-e2e.json` (e2e) |
| Quick run command | `npm test -- src/jobs/jobs.service.spec.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-04, D-05 | Job creation auto-seeds 4 default stages | unit | `npm test -- src/jobs/jobs.service.spec.ts --testNamePattern="default stages"` | ❌ Wave 0 |
| D-06, D-07 | POST /jobs accepts nested stages; omitted stages auto-seeded | unit + integration | `npm test -- src/jobs/jobs.service.spec.ts --testNamePattern="nested"` | ❌ Wave 0 |
| D-08 | Zod validation rejects invalid inputs (missing title, bad answerType) | unit | `npm test -- src/jobs/dto/create-job.dto.spec.ts` | ❌ Wave 0 |
| D-09, D-10 | JobStage has tenantId, responsibleUserId is String (free text), all relations work | unit | `npm test -- src/jobs/jobs.service.spec.ts --testNamePattern="schema"` | ❌ Wave 0 |
| D-01, D-02, D-03 | Job keeps old fields (description, requirements); Application.stage unchanged; ScoringAgentService not touched | integration | `npm test -- src/jobs/jobs.integration.spec.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test -- src/jobs/` (services + controllers + DTOs only)
- **Per wave merge:** `npm test` (full suite including e2e)
- **Phase gate:** Full suite green (`npm test` + `npm test:e2e`) before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/jobs/jobs.service.spec.ts` — covers D-04, D-05, D-06, D-07, D-09, D-10 (default stages, nested creates, tenant isolation)
- [ ] `src/jobs/jobs.controller.spec.ts` — covers POST /jobs route, Zod validation, error handling
- [ ] `src/jobs/dto/create-job.dto.spec.ts` — covers schema validation for all fields (title required, nested arrays optional, enum validation)
- [ ] `src/jobs/jobs.integration.spec.ts` — covers backward compatibility: old Job fields work, Application.stage still readable, no impact on scoring
- [ ] `prisma/migrations/[timestamp]_add_job_creation/migration.sql` — auto-generated by `prisma migrate dev`, must be committed to git

*(All gaps are normal for Wave 0; plans will create these tests and migration)*

## Sources

### Primary (HIGH confidence)

- **Prisma 7.5.0 Docs** - Nested create operations: https://www.prisma.io/docs/orm/reference/prisma-client-reference#create
- **Project codebase** - Ingestion processor uses `prisma.$transaction()` and nested creates pattern (src/ingestion/ingestion.processor.ts, lines 135–149)
- **Project codebase** - Zod DTO pattern established in Postmark webhook validation (src/webhooks/dto/postmark-payload.dto.ts)
- **Prisma 7.5.0 Docs** - CRUD operations including nested writes: https://www.prisma.io/docs/orm/prisma-client/queries/crud
- **Project package.json** - Verified versions: Prisma 7.5.0, Zod 4.3.6, NestJS 11.0.1

### Secondary (MEDIUM confidence)

- Prisma transaction behavior confirmed via codebase examples (not external sources)
- NestJS controller + service patterns confirmed by existing JobsController and JobsService

### Tertiary (LOW confidence)

- None — all recommendations backed by primary sources

## Metadata

**Confidence breakdown:**

- **Standard stack:** HIGH — All dependencies verified in package.json; project established patterns (Zod DTOs, transactions) in use
- **Architecture:** HIGH — Prisma nested creates documented and implemented in existing codebase; Zod composition proven in Postmark DTO
- **Pitfalls:** HIGH — Based on common Prisma gotchas (tenantId isolation, nested atomicity) and codebase patterns (D-02 coexistence risk)
- **Code examples:** HIGH — All examples from official Prisma docs or codebase patterns

**Research date:** 2026-03-24
**Valid until:** 2026-04-07 (14 days — Prisma 7 is stable, patterns established; unlikely major changes)

---

*Phase 10 research complete. Ready for planning phase.*
