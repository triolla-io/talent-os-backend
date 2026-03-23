---
phase: quick
plan: 260323-jll
subsystem: developer-experience
tags: [docker, onboarding, dev-tooling, ngrok, readme]
dependency_graph:
  requires: []
  provides: [docker-compose.dev.yml, scripts/ngrok-webhook.sh, README.md]
  affects: [package.json, src/main.ts]
tech_stack:
  added: []
  patterns: [source-mount dev compose, TZ env var for log timezone, ngrok local API polling]
key_files:
  created:
    - docker-compose.dev.yml
    - scripts/ngrok-webhook.sh
  modified:
    - package.json
    - src/main.ts
    - README.md
decisions:
  - Use node:22-alpine image with source mount for api/worker dev services (no build step, instant code reload via start:dev)
  - Poll ngrok local API (localhost:4040) to extract public URL rather than parsing stdout
  - Set TZ via process.env.TZ fallback in main.ts for local npm run start:dev; rely on docker-compose TZ env var for container runs
metrics:
  duration_seconds: 107
  tasks_completed: 3
  files_created: 2
  files_modified: 3
  completed_date: "2026-03-23"
---

# Quick Task 260323-jll: Developer Onboarding — Docker Watch Script Summary

**One-liner:** Dev-mode docker compose with source mounts, Israel-timezone NestJS logs, one-command DB bootstrap, ngrok webhook helper, and a complete Getting Started README replacing the NestJS boilerplate.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Dev compose + npm scripts + Israel timezone logging | `c363e3f` | docker-compose.dev.yml, package.json, src/main.ts |
| 2 | ngrok webhook helper script | `db900ed` | scripts/ngrok-webhook.sh |
| 3 | Replace README with Getting Started guide | `15af143` | README.md |

## What Was Built

**docker-compose.dev.yml** — 4-service dev compose file. `api` and `worker` use `node:22-alpine` with the repo mounted as a volume so `npm run start:dev` hot-reloads on file changes. `postgres` and `redis` are identical to `docker-compose.yml`. `TZ: Asia/Jerusalem` is set on both `api` and `worker` so NestJS log timestamps reflect Israel time. No build step required for infrastructure services.

**package.json scripts added:**
- `docker:dev` — starts all 4 services with streaming logs
- `docker:dev:build`, `docker:down`, `docker:logs`, `docker:logs:api`, `docker:logs:worker`
- `db:setup` — runs `prisma migrate deploy` then `prisma db seed` inside the running api container
- `db:studio` — opens Prisma Studio locally
- `ngrok` — invokes the helper script

**src/main.ts** — Added `process.env.TZ = process.env.TZ ?? 'Asia/Jerusalem'` at the top of `bootstrap()`. This is a no-op in Docker (where TZ is already set) and applies Israel time when running locally without Docker.

**scripts/ngrok-webhook.sh** — Starts ngrok in background, polls `http://localhost:4040/api/tunnels` every second (up to 15 attempts) to extract the HTTPS public URL, then prints the full Postmark-ready URL (`{tunnel}/webhooks/email`). Prints clear install/auth error instructions on failure.

**README.md** — Complete rewrite. Sections: Prerequisites, Environment Setup (every .env.example variable explained), First Run (4 steps: install, docker:dev, db:setup, health check), Testing the Full Flow (6 steps with ngrok, Postmark config, local-test/run.js, Prisma Studio), Useful Commands table, Architecture overview.

## Deviations from Plan

None — plan executed exactly as written. Worker command `npx ts-node src/worker.ts` was confirmed correct (no `start:worker` script existed in package.json).

## Known Stubs

None — all functionality is fully implemented. ngrok script requires ngrok to be installed and authenticated as documented.

## Self-Check: PASSED

All created/modified files confirmed present on disk. All 3 task commits verified in git history.
