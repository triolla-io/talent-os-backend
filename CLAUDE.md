<!-- GSD:project-start source:PROJECT.md -->

## Project

**Triolla Talent OS — Backend**

An automated email intake pipeline for Triolla's recruiting platform. It receives CVs by email via Postmark webhooks, extracts candidate data using AI, detects duplicates, scores candidates against open positions, and stores everything in PostgreSQL — ready for the recruiter UI to consume in Phase 2. Phase 1 is purely reactive: no human-initiated writes, no auth, no UI.

**Core Value:** Inbound CVs are automatically processed, de-duplicated, and scored against open jobs without any manual recruiter effort — the pipeline runs end-to-end from email receipt to scored candidate record.

### Constraints

- **Tech Stack:** TypeScript only, NestJS 11, BullMQ + Redis, Prisma 7, PostgreSQL 16 — locked, not negotiable
- **AI Provider:** OpenRouter via `@openrouter/sdk` — currently `openai/gpt-4o-mini` for both extraction and scoring
- **Storage:** Cloudflare R2 for original CV files (S3-compatible, 10GB free tier)
- **Email:** Postmark Inbound webhooks — no Gmail API polling in Phase 1
- **Dedup:** pg_trgm in PostgreSQL only — no in-memory fuzzy matching, no vector DB
- **DB conventions:** `text` + CHECK constraints over PostgreSQL ENUMs (ENUMs require migration to add values); no binary blobs in DB; `updated_at` via Prisma `@updatedAt`
- **Multi-tenancy:** `tenant_id` on every table from day 1 — prevents schema rewrite later
<!-- GSD:project-end -->

<!-- GSD:stack-start source:STACK.md -->

## Technology Stack

- **Runtime:** Node.js 22, TypeScript 5
- **Framework:** NestJS 11 (two entry points: `src/main.ts` = API, `src/worker.ts` = BullMQ worker)
- **Queue:** BullMQ + Redis 7
- **ORM:** Prisma 7 with `@prisma/adapter-pg` (direct pg driver)
- **DB:** PostgreSQL 16
- **AI:** `@openrouter/sdk` — model: `openai/gpt-4o-mini`
- **Storage:** Cloudflare R2 via `@aws-sdk/client-s3`
- **Email:** Postmark inbound webhook → `/webhooks/postmark`
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Two Docker containers share the same codebase:

- **api** (`src/main.ts`): HTTP server — webhooks, jobs CRUD, candidates, health
- **worker** (`src/worker.ts`): BullMQ consumer — ingestion pipeline (extract → dedup → score → store)

Modules: `webhooks`, `ingestion`, `candidates`, `jobs`, `applications`, `scoring`, `dedup`, `storage`, `health`, `config`

<!-- GSD:architecture-end -->

## Commands

```bash
npm run docker:up          # Start all services (API + worker + Postgres + Redis)
npm run docker:up:build    # Rebuild before starting
npm run docker:logs        # Tail all logs
npm run docker:logs:api    # API logs only
npm run docker:logs:worker # Worker logs only
npm run db:migrate         # Run Prisma migrations inside container
npm run db:studio          # Open Prisma Studio locally
npm test                   # Unit tests
npm run ngrok              # Expose webhook endpoint via ngrok
```

## Required Environment Variables

```
DATABASE_URL           # postgresql://...
REDIS_URL              # redis://...
OPENROUTER_API_KEY     # OpenRouter API key
POSTMARK_WEBHOOK_TOKEN # Webhook auth token
TENANT_ID              # UUID of the default tenant
R2_ACCOUNT_ID          # Cloudflare R2
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
```

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.

<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.

<!-- GSD:profile-end -->
