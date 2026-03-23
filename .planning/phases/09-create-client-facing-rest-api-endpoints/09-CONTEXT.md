# Phase 9: Create client-facing REST API endpoints - Context

**Gathered:** 2026-03-23 (discuss mode)
**Status:** Ready for planning

<domain>
## Phase Boundary

Expose three read-only REST API endpoints for the recruiter client UI to consume: `GET /api/candidates`, `GET /api/jobs`, and `GET /api/applications`. No writes, no auth, no stage transitions — pure data reads off the existing pipeline output. Includes CORS setup for local dev and global `/api` prefix.

</domain>

<decisions>
## Implementation Decisions

### CORS & Global Prefix
- **D-01:** Enable CORS in `main.ts` with `app.enableCors({ origin: 'http://localhost:5173' })` — hardcoded for local MVP, no env var needed
- **D-02:** Add global `/api` prefix in `main.ts` to match PROTOCOL.md base URL (`app.setGlobalPrefix('api')`)

### Tenant Resolution
- **D-03:** Ignore the `x-tenant-id` header entirely — always use `TENANT_ID` env var UUID for all queries. Single-tenant MVP; header exists for future multi-tenancy but is not enforced.

### Module Structure
- **D-04:** Create separate NestJS modules per resource: `CandidatesModule`, `JobsModule`, `ApplicationsModule` — each with its own controller and service, following the existing `WebhooksModule` pattern. All imported into `AppModule`.

### Endpoints (per PROTOCOL.md)
- **D-05:** `GET /api/candidates` — supports `q` (search by name/email/role via `ILIKE`) and `filter` enum (`all` | `high-score` | `available` | `referred` | `duplicates`). Returns `{ candidates[], total }`.
- **D-06:** `GET /api/jobs` — returns `{ jobs[], total }`. `candidate_count` field = count of applications for that job (all stages).
- **D-07:** `GET /api/applications` — returns `{ applications[] }` with nested `candidate` object (id, full_name, email, cv_file_url, ai_score).

### ai_score Computation
- **D-08:** `ai_score` = MAX score from `candidate_job_scores` across all jobs for that candidate (LEFT JOIN via `applications → candidate_job_scores`). Returns `null` if no scores exist yet.

### is_duplicate Field
- **D-09:** `is_duplicate` = `true` if any unreviewed `duplicate_flags` row exists for that candidate (`reviewed = false`). Computed via LEFT JOIN or subquery — no column on `candidates` table.

### Response Shape Alignment
- **D-10:** Response field names use `snake_case` to match PROTOCOL.md exactly — Prisma camelCase mapped at the service layer before returning.

### Claude's Discretion
- Error handling for missing/invalid query params (return 400 vs ignore)
- Whether to use Prisma `findMany` with `select` or raw SQL for the joined queries
- Exact Prisma query structure for ai_score JOIN

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### API Contract
- `PROTOCOL.md` — Exact endpoint definitions, request/response shapes, enums, and header requirements (the source of truth for this phase)

### Existing Infrastructure
- `src/main.ts` — Bootstrap file where CORS and global prefix must be added
- `src/app.module.ts` — Root module where new feature modules must be imported
- `src/prisma/prisma.module.ts` — PrismaModule to import in new feature modules
- `prisma/schema.prisma` — Full DB schema: `candidates`, `jobs`, `applications`, `candidate_job_scores`, `duplicate_flags` tables and their relations

### Patterns to Follow
- `src/webhooks/webhooks.controller.ts` — Controller pattern (decorator usage, service injection)
- `src/webhooks/webhooks.module.ts` — Module pattern to follow
- `src/config/env.ts` — `TENANT_ID` env var (UUID) — used for all queries

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `PrismaService` (`src/prisma/prisma.service.ts`) — injected into all service layers; import `PrismaModule` to use
- `ConfigService` from `@nestjs/config` — use to read `TENANT_ID` env var (already validated as UUID on startup)
- `envSchema` in `src/config/env.ts` — `TENANT_ID` is validated as UUID regex at startup, safe to use directly

### Established Patterns
- Controllers use `@Controller('resource')` + injected service — no inline logic
- Guards applied via `@UseGuards(...)` at controller or route level (not needed here — no auth in Phase 9)
- NestJS app uses Express platform (`NestExpressApplication`) — `app.enableCors()` is the correct API
- No global prefix currently set — `app.setGlobalPrefix('api')` must be added BEFORE `app.listen()`

### Integration Points
- All three endpoints query tables populated by the existing ingestion pipeline (Phases 1–8)
- `candidate_job_scores` linked to candidates via: `candidates → applications → candidate_job_scores`
- `duplicate_flags.reviewed = false` identifies unreviewed duplicates for `is_duplicate` field
- `jobs.status = 'active'` is the relevant filter for job listings (protocol returns all jobs but `active` is the primary status)

</code_context>

<specifics>
## Specific Ideas

- PROTOCOL.md filter `high-score` → candidates with `ai_score >= 70` (reasonable threshold — Claude's discretion on exact value)
- PROTOCOL.md filter `available` → no direct DB field; could map to candidates with no active application in `hired` or `rejected` stage
- PROTOCOL.md filter `referred` → `candidates.source = 'referral'`
- PROTOCOL.md filter `duplicates` → candidates where `is_duplicate = true` (unreviewed flags)
- `GET /applications` fetches ALL active applications (not paginated for MVP)

</specifics>

<deferred>
## Deferred Ideas

- Pagination (`page`, `limit` params) — PROTOCOL.md returns `total` but no pagination; add when UI needs it
- Write endpoints (stage transitions, duplicate resolution) — v2 requirements (RAPI-03, RAPI-04)
- Authentication (JWT/Clerk) — Phase 2+
- Swagger/OpenAPI docs generation — useful but not blocking

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 09-create-client-facing-rest-api-endpoints*
*Context gathered: 2026-03-23*
