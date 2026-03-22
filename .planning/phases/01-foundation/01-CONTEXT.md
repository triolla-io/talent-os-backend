# Phase 1: Foundation - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Database schema created (7 tables via Prisma migration), NestJS API bootstrapped (`rawBody: true`), BullMQ Worker process separated from API, environment variables validated at startup, and Docker Compose runs all 4 services locally. This phase establishes the structural skeleton — no webhook handling, no email processing, no AI calls.

</domain>

<decisions>
## Implementation Decisions

### Dependencies
- **D-01:** Install ALL project dependencies upfront in Phase 1 — do not defer AI/parsing/storage libs to later phases. Packages to install:
  - Production: `@prisma/client`, `prisma`, `@nestjs/config`, `zod`, `bullmq`, `ioredis`, `ai`, `@ai-sdk/anthropic`, `pdf-parse`, `mammoth`, `@aws-sdk/client-s3`
  - Dev: `@types/pdf-parse`
  - This locks `package-lock.json` once and avoids repeated `npm install` runs across phases.

### Scaffold cleanup
- **D-02:** Delete the NestJS scaffold entirely — remove `src/app.controller.ts`, `src/app.service.ts`, and `src/app.controller.spec.ts`. `AppModule` becomes a clean slate that imports only real modules (PrismaModule, ConfigModule, etc.).

### Seed data
- **D-03:** `prisma/seed.ts` pre-populates: 1 tenant (`name: 'Triolla'`, hardcoded `id: '00000000-0000-0000-0000-000000000001'`) and 1 active job (`title: 'Software Engineer'`, `status: 'active'`). Idempotent — uses `upsert` so re-running seed doesn't duplicate.
- **D-04:** `TENANT_ID` in `.env.example` pre-filled with `00000000-0000-0000-0000-000000000001` — same value for every dev environment, no manual coordination needed.

### Docker Compose
- **D-05:** Single `docker-compose.yml` (no dev/prod split) — the spec's layout is used as-is. Both `api` and `worker` use the same `Dockerfile`; worker overrides `command: node dist/worker.js`.
- **D-06:** Add health checks to postgres and redis services so `api` and `worker` won't start until dependencies are ready (`depends_on` with `condition: service_healthy`).

### Claude's Discretion
- Dockerfile design (multi-stage vs single-stage — prefer multi-stage for smaller prod image)
- Exact Zod env schema shape (URL validation for DATABASE_URL/REDIS_URL, non-empty string for API keys)
- AppModule structure (which built-in NestJS modules to import: ConfigModule.forRoot, etc.)

</decisions>

<specifics>
## Specific Ideas

- Use `00000000-0000-0000-0000-000000000001` as the hardcoded dev tenant UUID — easy to recognize in logs and DB queries
- The spec's docker-compose.yml (§10) is the authoritative reference; implement it verbatim, then add health checks on top

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture & Schema
- `spec/backend-architecture-proposal.md` §5 — Project directory structure (exact folder layout for `src/`)
- `spec/backend-architecture-proposal.md` §9 — Full database schema: all 7 tables with column types, constraints, and indexes
- `spec/backend-architecture-proposal.md` §10 — Docker Compose YAML, env vars list, Dockerfile pattern (api vs worker commands)

### Requirements
- `.planning/REQUIREMENTS.md` §Database Schema — DB-01 through DB-09 (table list, text+CHECK constraints, updatedAt, no blobs, unique constraints, indexes)
- `.planning/REQUIREMENTS.md` §Infrastructure — INFR-01 through INFR-05 (rawBody, worker bootstrap, Zod validation, Docker Compose, .env.example)
- `.planning/REQUIREMENTS.md` §Processing Pipeline — PROC-01 (API and Worker as separate Docker containers)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/main.ts` — Exists but needs `rawBody: true` added to `NestFactory.create()`
- `src/app.module.ts` — Exists; `AppController` and `AppService` imports to be removed; real modules added here

### Established Patterns
- NestJS 11 is already installed and working (scaffold verified)
- `tsconfig.json` and `nest-cli.json` are already configured — don't touch

### Integration Points
- `prisma/schema.prisma` → new file; `prisma migrate dev` will create `prisma/migrations/`
- `src/worker.ts` → new file; builds with `nest-cli.json` or direct `tsc` config TBD

</code_context>

<deferred>
## Deferred Ideas

- Docker Compose dev/prod split (docker-compose.override.yml for hot reload) — not needed in Phase 1, add when CI/CD is set up
- Health check HTTP endpoint on the API (`/health`) — Phase 2 or later

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-03-22*
