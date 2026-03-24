# Phase 10: Add job creation feature - Context

**Gathered:** 2026-03-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Add the ability to create jobs via a REST API. Delivers:
- Schema migration: new `JobStage` and `ScreeningQuestion` models; new optional fields on `Job`; nullable `jobStageId` FK on `Application`
- `POST /jobs` endpoint accepting nested stages + screening questions in one atomic request
- Auto-seeded default hiring stages on every created job

Scope excludes: updating the scoring pipeline, removing old fields, auth, UI.

</domain>

<decisions>
## Implementation Decisions

### Migration Strategy (Old Fields)

- **D-01:** Keep `description`, `requirements[]` on `Job` — do NOT drop this phase. New fields (`roleSummary`, `responsibilities`, `mustHaveSkills`, etc.) are additive only.
- **D-02:** Keep `Application.stage` (String, "new") alongside new `jobStageId` (nullable FK). Coexistence period — no data migration, no field removal this phase.
- **D-03:** `ScoringAgentService` is NOT touched this phase. Scoring update (using new Job fields) is a separate phase after old fields are confirmed safe to remove.

### Default Hiring Stages on Job Creation

- **D-04:** Auto-seed exactly 4 default stages per job on creation, in this order:
  1. Application Review (order: 1)
  2. Screening (order: 2)
  3. Interview (order: 3)
  4. Offer (order: 4)
- **D-05:** `isCustom = false` for all auto-seeded stages. Recruiter-added stages use `isCustom = true`.

### API Surface

- **D-06:** `POST /jobs` accepts a single atomic payload with nested `hiringStages[]` and `screeningQuestions[]`. Service decomposes into separate Prisma writes internally (not exposed to caller).
- **D-07:** If `hiringStages` is omitted from the request, default stages are auto-seeded (D-04). If explicitly provided, use the provided stages instead.
- **D-08:** Validation via Zod/class-validator. All new fields are optional in the request — only `title` and `tenantId` (from config) are required.

### Schema Corrections (from spec review)

- **D-09:** `responsibleUserId` on `JobStage` must be `String? @db.Text` (free text), NOT `@db.Uuid`. No User model exists — cannot FK to a non-existent table.
- **D-10:** `JobStage` and `ScreeningQuestion` must include `tenant Tenant @relation(...)` declarations, AND `Tenant` model must add `jobStages JobStage[]` and `screeningQuestions ScreeningQuestion[]` back-relations. Required for Prisma to compile.

### Claude's Discretion

- DTO structure (class-validator vs pure Zod)
- Response shape for `POST /jobs` (return created job with stages and questions, or just job ID)
- Whether to add `GET /jobs/:id`, `PUT /jobs/:id` in this phase or keep read-only as GET /jobs
- Error handling for duplicate job titles within a tenant

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Schema spec
- `spec/migration-job-creation-feature.md` — Initial migration plan; use D-09 and D-10 corrections above, which supersede the spec on `responsibleUserId` type and Tenant back-relations

### Existing patterns to follow
- `prisma/schema.prisma` — Current schema; all new models must match existing conventions (gen_random_uuid, @db.Uuid, tenant_id on every table, @updatedAt, @@map snake_case)
- `src/jobs/jobs.service.ts` — Existing JobsService pattern (constructor injection, PrismaService, ConfigService for tenantId)
- `src/jobs/jobs.controller.ts` — Existing controller pattern (NestJS decorators)
- `src/applications/applications.service.ts` — Contains `stage: a.stage` at line 58 — must not break

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `PrismaService` (src/prisma/) — injected via constructor, used for all DB access
- `ConfigService` — used to resolve `TENANT_ID` from env (pattern established in JobsService)
- `JobsModule` / `JobsController` / `JobsService` — already wired; extend, don't create from scratch

### Established Patterns
- tenantId always comes from `configService.get<string>('TENANT_ID')` — NOT from request headers/params
- Prisma relations use camelCase in TypeScript, snake_case via `@map` in DB
- No ENUMs — use `String @db.Text` with application-level validation
- All IDs are UUIDs via `gen_random_uuid()`
- Controllers are thin — all logic in services

### Integration Points
- `src/jobs/jobs.module.ts` — imports JobsService, JobsController; add new create endpoint here
- `prisma/schema.prisma` — add JobStage, ScreeningQuestion models and Job/Application field changes
- `src/applications/applications.service.ts:58` — returns `stage: a.stage`; adding `jobStageId` as nullable won't break this

</code_context>

<specifics>
## Specific Ideas

- "POST /jobs should accept nested stages + questions in one atomic request. Service handles decomposition internally." — single-request job creation flow for the frontend
- Auto-seed default stages: Application Review → Screening → Interview → Offer (exactly these 4, in this order)
- Old fields stay: `description`, `requirements[]`, `Application.stage` — no removals this phase

</specifics>

<deferred>
## Deferred Ideas

- Update `ScoringAgentService` to use `roleSummary`, `mustHaveSkills`, etc. — separate phase after old fields are confirmed removable
- Dropping `description`, `requirements[]` from `Job` — depends on scoring pipeline update being done first
- Replacing `Application.stage` with `jobStageId` as primary — separate migration phase
- Auth on write endpoints — Phase 2
- User model / FK for `responsibleUserId` — Phase 2+

None — discussion stayed within phase scope

</deferred>

---

*Phase: 10-add-job-creation-feature*
*Context gathered: 2026-03-24*
