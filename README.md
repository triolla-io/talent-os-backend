# TalentoOS — Backend

Automated email intake pipeline: receives CVs via Postmark webhooks, extracts candidate data with AI, deduplicates by phone, scores against matched jobs, stores in PostgreSQL.

## Prerequisites

- **Docker** 24+ and **Docker Compose** v2+
- **ngrok** (optional, for local Postmark webhook testing — `brew install ngrok`)

> A `Makefile` is included as a convenience wrapper for common Docker workflows (`make up`, `make reset`, `make backup`). It requires `make` (pre-installed on macOS/Linux). All essential commands are also available as `npm run` scripts.

## Quick Start

1. Clone the repository
2. `cp .env.example .env` and fill in secrets (see [Environment Variables](#environment-variables))
3. `npm run docker:up:build` — builds images, starts all services
4. `npm run db:migrate` — run database migrations
5. `npm run db:seed` — seed test jobs and a sample candidate
6. API available at `http://localhost:3000/api`

## Environment Variables

| Variable                 | Required | Description                                                                 |
| ------------------------ | -------- | --------------------------------------------------------------------------- |
| `DATABASE_URL`           | Yes      | PostgreSQL connection string. Format: `postgresql://user:pass@host:5432/db` |
| `REDIS_URL`              | Yes      | Redis connection string. Format: `redis://host:6379`                        |
| `OPENROUTER_API_KEY`     | Yes      | OpenRouter API key for `openai/gpt-4o-mini` (extraction and scoring)        |
| `POSTMARK_WEBHOOK_TOKEN` | Yes      | Token from Postmark Inbound webhook settings (used for HTTP Basic Auth)     |
| `TENANT_ID`              | Yes      | UUID of the tenant record in the `tenants` table. Run seed to create.       |
| `R2_ACCOUNT_ID`          | Yes      | Cloudflare R2 account ID (Cloudflare dashboard → R2 → Manage API Tokens)    |
| `R2_ACCESS_KEY_ID`       | Yes      | Cloudflare R2 access key ID                                                 |
| `R2_SECRET_ACCESS_KEY`   | Yes      | Cloudflare R2 secret access key                                             |
| `R2_BUCKET_NAME`         | Yes      | Cloudflare R2 bucket name for CV file storage (e.g. `triolla-cvs`)          |
| `POSTGRES_PASSWORD`      | Yes      | PostgreSQL superuser password (used by docker-compose postgres service)     |
| `NODE_ENV`               | No       | `development` (default) or `production`                                     |

> All required variables are in `.env.example`. Do not commit `.env` to git.

## Development Commands

```bash
# Start / stop
npm run docker:up            # Start all services (API + worker + Postgres + Redis)
npm run docker:up:build      # Rebuild images before starting
npm run docker:down          # Stop all services

# Database
npm run db:migrate           # Run Prisma migrations (inside container)
npm run db:seed              # Seed test data (jobs + sample candidate)
npm run db:studio            # Open Prisma Studio locally

# Logs
npm run docker:logs          # Tail all container logs
npm run docker:logs:api      # API logs only
npm run docker:logs:worker   # Worker logs only

# Tests
npm test                     # Unit tests (local, requires Node installed)
npm run test:e2e             # E2E smoke tests (boots full NestJS app)

# Webhook testing
npm run ngrok                # Expose localhost:3000 via ngrok for Postmark testing
```

## How the Pipeline Works

When a recruiter sends or forwards a CV to your Postmark inbound address, this is what happens:

```
Recruiter sends email with CV attachment
   │
   ▼
POST /api/webhooks/email  (HTTP Basic Auth)
   │
   ├─ Already seen this email? → return 200, do nothing
   │
   ▼
Queued in Redis (BullMQ) — caller gets 200 immediately, processing happens async
   │
   ▼
Is it spam or missing a CV attachment?
   ├─ Yes → discard
   │
   ▼
Extract text from CV (PDF or DOCX → plain text)
   │
   ▼
Save original CV file to Cloudflare R2 (file stored before any AI runs)
   │
   ▼
AI reads the CV text (gpt-4o-mini via OpenRouter)
   └─ Pulls out: name, phone, email, role, years of experience, skills, location, summary
   │
   ├─ No name found? → mark as failed, stop
   │
   ▼
Duplicate check — exact phone number match
   ├─ Phone missing → insert candidate + flag for HR review
   ├─ Phone already exists → insert new candidate row + link to existing (both visible in UI)
   └─ New phone → insert as new candidate
   │
   ▼
Job matching — looks for job reference numbers in the email subject/body
   ├─ No job number found? → save candidate, skip scoring, done
   │
   ▼
AI scores the candidate against each matched job (gpt-4o-mini via OpenRouter)
   └─ Produces: score, reasoning, strengths, gaps
   │
   ▼
Saved to PostgreSQL
   └─ candidates table + candidate_job_scores tables
```

**Retry behaviour:** If any step fails, BullMQ retries up to 3 times with exponential backoff (5s, 10s, 20s). If AI extraction fails on the final attempt, a deterministic fallback runs before giving up.

## API Reference

Full contract: `PROTOCOL.md`

Key endpoints:

| Method   | Path                  | Description                                                           |
| -------- | --------------------- | --------------------------------------------------------------------- |
| `GET`    | `/api/health`         | Liveness probe — 200 healthy, 503 degraded (includes DB/Redis status) |
| `GET`    | `/api/jobs`           | List all jobs                                                         |
| `POST`   | `/api/jobs`           | Create a job                                                          |
| `PUT`    | `/api/jobs/:id`       | Update a job                                                          |
| `DELETE` | `/api/jobs/:id`       | Soft-delete a job                                                     |
| `GET`    | `/api/candidates`     | List candidates (supports `?q=`, `?filter=`, `?job_id=`)              |
| `GET`    | `/api/candidates/:id` | Single candidate with scores                                          |
| `POST`   | `/api/webhooks/email` | Postmark inbound webhook (HTTP Basic Auth required)                   |

## Architecture

Two Docker containers share the same codebase:

- **api** (`src/main.ts`): HTTP server — handles webhooks, jobs CRUD, candidates, health checks
- **worker** (`src/worker.ts`): BullMQ consumer — runs the ingestion pipeline end-to-end

Infrastructure:

| Service           | Role                                                          |
| ----------------- | ------------------------------------------------------------- |
| **PostgreSQL 16** | All persistent data                                           |
| **Redis 7**       | BullMQ job queue between API and Worker                       |
| **Cloudflare R2** | Original CV file storage (S3-compatible, 10 GB free tier)     |
| **OpenRouter**    | AI provider — `openai/gpt-4o-mini` for extraction and scoring |
| **Postmark**      | Inbound email → webhook delivery                              |

## Testing Webhooks Locally

```bash
npm run ngrok
# Prints an HTTPS public URL, e.g. https://abc123.ngrok.io
# Configure Postmark:
#   Dashboard → Inbound → Webhook URL:
#   https://postmark:<POSTMARK_WEBHOOK_TOKEN>@abc123.ngrok.io/api/webhooks/email
```

The ngrok URL changes on every restart — update Postmark each session.

## Troubleshooting

| Problem                                     | Solution                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Services won't start                        | Check `.env` has `POSTGRES_PASSWORD` set. Run `npm run docker:logs` to see postgres startup errors. |
| Migrations fail: "Database does not exist"  | Run `npm run docker:down` then `npm run docker:up:build` to reset containers.                       |
| `TENANT_ID not found` at startup            | Run `npm run db:seed` to create the default tenant. Copy the UUID printed to `.env`.                |
| Postmark webhook returns 401                | `POSTMARK_WEBHOOK_TOKEN` in `.env` must match the token in Postmark Dashboard → Inbound → Settings. |
| CV processing fails silently                | Check worker logs: `npm run docker:logs:worker`. Look for `Job failed` lines.                       |
| Port 3000 already in use                    | Set `PORT=3001` in `.env` or stop the conflicting process: `lsof -i :3000`.                         |
| Docker build fails: `prisma generate` error | Stale node_modules volume — run `npm run docker:down` then `npm run docker:up:build`.               |
