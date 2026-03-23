---
phase: quick
plan: 260323-jll
type: execute
wave: 1
depends_on: []
files_modified:
  - docker-compose.dev.yml
  - package.json
  - src/main.ts
  - scripts/ngrok-webhook.sh
  - README.md
autonomous: true
requirements: []

must_haves:
  truths:
    - "A new developer can run one command to start all services with readable, timestamped logs"
    - "NestJS log timestamps reflect Asia/Jerusalem time, not UTC"
    - "One command bootstraps the DB (migrations + seed) from a clean clone"
    - "ngrok helper script starts a tunnel and prints the exact Postmark webhook URL"
    - "README walks a new developer from clone to first successful test run"
  artifacts:
    - path: "docker-compose.dev.yml"
      provides: "Dev-mode compose with source mounts, NODE_ENV=development, no build step for infra services"
    - path: "scripts/ngrok-webhook.sh"
      provides: "ngrok tunnel starter that prints the Postmark-ready webhook URL"
    - path: "README.md"
      provides: "Getting Started guide replacing the NestJS boilerplate"
  key_links:
    - from: "package.json scripts"
      to: "docker-compose.dev.yml"
      via: "docker compose -f docker-compose.dev.yml"
      pattern: "docker:dev"
    - from: "package.json scripts"
      to: "prisma migrate deploy + prisma db seed"
      via: "npm run db:setup"
      pattern: "db:setup"
---

<objective>
Improve local developer experience so anyone who clones this repo can test the full email intake pipeline within ~15 minutes.

Purpose: There is currently no dev-mode compose setup, no one-command DB bootstrap, no timezone-correct logs, no ngrok helper, and the README is the default NestJS boilerplate.
Output: docker-compose.dev.yml, db:setup and docker:dev npm scripts, Asia/Jerusalem timestamps in NestJS, ngrok helper script, and a complete Getting Started README.
</objective>

<execution_context>
@/Users/danielshalem/triolla/telent-os-backend/.claude/get-shit-done/workflows/execute-plan.md
@/Users/danielshalem/triolla/telent-os-backend/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/Users/danielshalem/triolla/telent-os-backend/.planning/STATE.md
@/Users/danielshalem/triolla/telent-os-backend/docker-compose.yml
@/Users/danielshalem/triolla/telent-os-backend/package.json
@/Users/danielshalem/triolla/telent-os-backend/src/main.ts
@/Users/danielshalem/triolla/telent-os-backend/.env.example
@/Users/danielshalem/triolla/telent-os-backend/local-test/run.js
</context>

<tasks>

<task type="auto">
  <name>Task 1: Dev compose + npm scripts + Israel timezone logging</name>
  <files>docker-compose.dev.yml, package.json, src/main.ts</files>
  <action>
    **1. Create docker-compose.dev.yml**

    New file at repo root. Services:

    - `postgres` and `redis`: identical to docker-compose.yml (just pull postgres:16-alpine and redis:7-alpine, same healthchecks, same volume mounts, same ports). These never need rebuilding.
    - `api`: do NOT build from Dockerfile. Instead:
      ```yaml
      api:
        image: node:22-alpine
        working_dir: /app
        volumes:
          - .:/app
          - /app/node_modules
        command: sh -c "npm run start:dev"
        ports:
          - '3000:3000'
        env_file: .env
        environment:
          DATABASE_URL: postgresql://triolla:password@postgres:5432/triolla
          REDIS_URL: redis://redis:6379
          NODE_ENV: development
          TZ: Asia/Jerusalem
        depends_on:
          postgres:
            condition: service_healthy
          redis:
            condition: service_healthy
      ```
    - `worker`: same pattern as `api` but `command: sh -c "npx ts-node src/worker.ts"` (or `npm run start:worker` if that script exists — check; otherwise use `npx ts-node src/worker.ts`). Same env, same TZ, same depends_on.

    Set `TZ: Asia/Jerusalem` on both `api` and `worker` services. This makes Node.js `new Date().toLocaleString()` and system timestamps use Israel time. NestJS built-in logger uses `new Date()` internally — the OS TZ env var is sufficient; no code change needed for that.

    Define volumes block at the bottom matching docker-compose.yml (postgres_data, redis_data).

    **2. Add npm scripts to package.json**

    Add these scripts to the `"scripts"` block:

    ```json
    "docker:dev": "docker compose -f docker-compose.dev.yml up",
    "docker:dev:build": "docker compose -f docker-compose.dev.yml up --build",
    "docker:down": "docker compose -f docker-compose.dev.yml down",
    "docker:logs": "docker compose -f docker-compose.dev.yml logs -f --tail=100",
    "docker:logs:api": "docker compose -f docker-compose.dev.yml logs -f api",
    "docker:logs:worker": "docker compose -f docker-compose.dev.yml logs -f worker",
    "db:setup": "docker compose -f docker-compose.dev.yml exec api npx prisma migrate deploy && docker compose -f docker-compose.dev.yml exec api npx prisma db seed",
    "db:studio": "npx prisma studio"
    ```

    `docker:dev` starts all 4 services and streams logs (docker compose up already streams by default without -d). `db:setup` runs migrations then seed inside the running api container — single command for first-run DB bootstrap.

    **3. Fix NestJS timestamp timezone in src/main.ts**

    NestJS ConsoleLogger formats timestamps with `new Date().toLocaleTimeString()`. Setting TZ in docker-compose.dev.yml handles Docker environments. For local `npm run start:dev` (no Docker), set the env var programmatically at the top of main.ts before the bootstrap call:

    Add this line at the top of the bootstrap function body (before NestFactory.create):
    ```typescript
    process.env.TZ = process.env.TZ ?? 'Asia/Jerusalem';
    ```

    This is a no-op if TZ is already set (e.g., from Docker env), and sets Israel time when running locally without Docker. Keep existing rawBody and bodyParser config untouched.
  </action>
  <verify>
    1. `docker compose -f docker-compose.dev.yml config` — validates YAML syntax, exits 0
    2. `node -e "require('./package.json').scripts['docker:dev']"` — prints the script without error
    3. `node -e "const m = require('fs').readFileSync('src/main.ts','utf8'); if (!m.includes('Asia/Jerusalem')) throw new Error('TZ not set')"`
  </verify>
  <done>
    docker-compose.dev.yml is valid YAML with 4 services (api, worker, postgres, redis), TZ: Asia/Jerusalem on api and worker. package.json has docker:dev, db:setup, and related scripts. src/main.ts sets TZ fallback.
  </done>
</task>

<task type="auto">
  <name>Task 2: ngrok webhook helper script</name>
  <files>scripts/ngrok-webhook.sh</files>
  <action>
    Create directory `scripts/` at repo root. Create `scripts/ngrok-webhook.sh`:

    ```bash
    #!/usr/bin/env bash
    set -euo pipefail

    PORT=${PORT:-3000}
    WEBHOOK_PATH="/webhooks/email"

    echo "Starting ngrok tunnel on port $PORT..."
    echo "Webhook path: $WEBHOOK_PATH"
    echo ""

    # Start ngrok in background
    ngrok http "$PORT" --log=stdout --log-format=json > /tmp/ngrok-telent.log 2>&1 &
    NGROK_PID=$!

    # Wait for tunnel to be established (poll ngrok local API)
    echo "Waiting for tunnel..."
    for i in $(seq 1 15); do
      sleep 1
      TUNNEL_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null \
        | grep -o '"public_url":"https://[^"]*"' \
        | head -1 \
        | sed 's/"public_url":"//' \
        | sed 's/"$//' || true)
      if [ -n "$TUNNEL_URL" ]; then
        break
      fi
    done

    if [ -z "$TUNNEL_URL" ]; then
      echo "ERROR: Could not get tunnel URL after 15 seconds."
      echo "       Is ngrok installed? Run: brew install ngrok"
      echo "       Do you need to authenticate? Run: ngrok authtoken YOUR_TOKEN"
      kill "$NGROK_PID" 2>/dev/null || true
      exit 1
    fi

    WEBHOOK_URL="${TUNNEL_URL}${WEBHOOK_PATH}"

    echo ""
    echo "=========================================="
    echo "  ngrok tunnel active"
    echo "=========================================="
    echo ""
    echo "  Postmark webhook URL:"
    echo "  $WEBHOOK_URL"
    echo ""
    echo "  Configure in Postmark:"
    echo "  Settings -> Inbound -> Webhook URL -> paste the above"
    echo ""
    echo "  Press Ctrl+C to stop the tunnel"
    echo "=========================================="
    echo ""

    # Keep running and show ngrok output
    wait "$NGROK_PID"
    ```

    Make it executable: `chmod +x scripts/ngrok-webhook.sh`

    Add npm script to package.json (add alongside the Task 1 scripts):
    ```json
    "ngrok": "bash scripts/ngrok-webhook.sh"
    ```

    The script polls `http://localhost:4040/api/tunnels` (ngrok's local API) to extract the public URL, then prints the full Postmark webhook URL. It requires ngrok to already be installed and authenticated. On failure it prints install/auth instructions.
  </action>
  <verify>
    1. `test -x scripts/ngrok-webhook.sh` — exits 0 (file exists and is executable)
    2. `bash -n scripts/ngrok-webhook.sh` — syntax check exits 0
    3. `node -e "require('./package.json').scripts['ngrok']"` — prints the script
  </verify>
  <done>
    scripts/ngrok-webhook.sh exists, is executable, passes bash syntax check. npm run ngrok starts the helper. Script prints the full Postmark-ready URL when ngrok tunnel is active.
  </done>
</task>

<task type="auto">
  <name>Task 3: Replace README with Getting Started guide</name>
  <files>README.md</files>
  <action>
    Replace the entire contents of README.md with a project-specific guide. The current file is the default NestJS boilerplate (NestJS logo, generic project setup instructions) — discard it entirely.

    Write the new README with these sections in order:

    ---

    **Header:** "Triolla Talent OS — Backend"
    One-line description: "Automated email intake pipeline: receive CVs by email, extract candidate data with AI, deduplicate, score against open jobs."

    **Prerequisites section:**
    List what must be installed before the developer starts:
    - Docker Desktop (for docker compose)
    - Node.js 22+ and npm (for running scripts and Prisma CLI locally)
    - ngrok (for exposing localhost to Postmark) — include install note: `brew install ngrok` on macOS
    - A Postmark account with an inbound webhook configured (note: free tier works)

    **Environment Setup section:**
    ```bash
    cp .env.example .env
    ```
    Then list every variable from .env.example with a short note on where to get the value:
    - `ANTHROPIC_API_KEY` — Anthropic Console -> API Keys
    - `POSTMARK_WEBHOOK_TOKEN` — choose any secret string, then configure the same value in Postmark -> Settings -> Inbound -> HTTP Basic Auth password
    - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` — Cloudflare R2 dashboard
    - `POSTGRES_PASSWORD` — set to any local password (e.g. `changeme`)
    - `TENANT_ID` — leave as `00000000-0000-0000-0000-000000000001` (hardcoded dev tenant)
    - `DATABASE_URL` and `REDIS_URL` — leave as-is (matches docker-compose.dev.yml)

    **First Run section (numbered steps):**
    1. Start all services: `npm run docker:dev`
       - Wait until you see "NestJS application listening" in the logs
    2. Bootstrap the database (in a new terminal, first run only): `npm run db:setup`
       - Runs migrations + seeds 1 tenant + 1 "Software Engineer" job
    3. Verify the API is healthy: `node local-test/run.js --health`
       - Should print: Health OK

    **Testing the Full Flow section (numbered steps):**
    1. Put at least one CV file (PDF, DOC, or DOCX) in `local-test/files/`
    2. Start an ngrok tunnel so Postmark can reach localhost:
       ```bash
       npm run ngrok
       # Copy the printed URL, e.g.: https://abc123.ngrok-free.app/webhooks/email
       ```
    3. Configure Postmark:
       - Go to Postmark -> Settings -> Inbound
       - Set the webhook URL to the ngrok URL printed above
       - Set HTTP Basic Auth: username = `postmark`, password = value of `POSTMARK_WEBHOOK_TOKEN` from .env
    4. Send a test webhook locally (bypasses Postmark, hits localhost directly):
       ```bash
       node local-test/run.js
       # Or send a specific file:
       node local-test/run.js my-cv.pdf
       ```
    5. Watch the worker process the job:
       ```bash
       npm run docker:logs:worker
       ```
    6. Inspect the results in Prisma Studio:
       ```bash
       npm run db:studio
       # Open http://localhost:5555
       # Check: email_intake_log (status: success), candidates, applications, candidate_job_scores
       ```

    **Useful Commands section (table):**

    | Command | What it does |
    |---|---|
    | `npm run docker:dev` | Start all services, stream logs |
    | `npm run docker:down` | Stop and remove containers |
    | `npm run docker:logs` | Tail all service logs |
    | `npm run docker:logs:api` | Tail API logs only |
    | `npm run docker:logs:worker` | Tail worker logs only |
    | `npm run db:setup` | Run migrations + seed (first run) |
    | `npm run db:studio` | Open Prisma Studio at localhost:5555 |
    | `npm run ngrok` | Start ngrok tunnel, print Postmark URL |
    | `npm test` | Run unit tests |
    | `node local-test/run.js` | Send all CVs in local-test/files/ |
    | `node local-test/run.js --health` | Check API health |

    **Architecture section (brief):**
    - API service (port 3000): receives Postmark inbound webhooks, validates auth, enqueues jobs in BullMQ
    - Worker service: processes jobs — extracts text from CV, runs AI extraction (Claude Haiku), deduplicates via pg_trgm, scores candidates against open jobs (Claude Sonnet), stores results in PostgreSQL
    - PostgreSQL 16: all data, pg_trgm for fuzzy dedup
    - Redis 7: BullMQ job queue
    - Cloudflare R2: stores original CV files

    ---

    Write this content cleanly. No NestJS boilerplate, no NestJS logo, no generic links. Plain markdown.
  </action>
  <verify>
    1. `grep -c "Getting Started\|Prerequisites\|First Run\|docker:dev\|db:setup\|ngrok" README.md` — returns >= 6
    2. `grep "Nest Logo\|nestjs.com/img/logo" README.md` — returns nothing (boilerplate removed)
  </verify>
  <done>
    README.md contains project-specific Getting Started guide. All five sections present: Prerequisites, Environment Setup, First Run, Testing the Full Flow, Useful Commands. NestJS boilerplate completely removed.
  </done>
</task>

</tasks>

<verification>
After all three tasks:

1. `docker compose -f docker-compose.dev.yml config` exits 0 — YAML valid
2. `npm run docker:dev -- --help 2>/dev/null; echo ok` — script resolves
3. `bash -n scripts/ngrok-webhook.sh` exits 0
4. `grep "Asia/Jerusalem" src/main.ts` returns a match
5. `grep "db:setup\|docker:dev\|ngrok" package.json` returns all three scripts
6. `grep "First Run\|Prerequisites" README.md` returns matches
</verification>

<success_criteria>
- New developer can clone, copy .env.example, run `npm run docker:dev`, then `npm run db:setup`, then `node local-test/run.js --health` and get a healthy response — no additional steps
- NestJS logs show Asia/Jerusalem timestamps (not UTC) when running in Docker
- `npm run ngrok` starts a tunnel and prints the complete Postmark webhook URL
- README replaces the NestJS boilerplate with actionable project-specific instructions
</success_criteria>

<output>
After completion, create `.planning/quick/260323-jll-developer-onboarding-docker-watch-script/260323-jll-SUMMARY.md` using the summary template.
</output>
