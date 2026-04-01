---
task: 260401-c3k
type: quick
status: complete
completed_date: "2026-04-01"
duration_minutes: 5
tasks_completed: 2
tasks_total: 2
files_created:
  - .github/workflows/ci.yml
files_modified:
  - docker-compose.yml
files_deleted:
  - Jenkinsfile
commits:
  - hash: 0a92b74
    message: "chore(260401-c3k): remove Jenkinsfile and add GitHub Actions CI workflow"
  - hash: 212186d
    message: "chore(260401-c3k): strip nginx and certbot from docker-compose.yml"
---

# Quick Task 260401-c3k Summary

**One-liner:** Replaced Jenkins with GitHub Actions CI (build + test gate on push/PR to main) and stripped nginx/certbot from docker-compose.yml — Coolify now owns TLS, reverse proxy, and deployment.

## What Was Done

### Task 1: Delete Jenkins, create GitHub Actions CI workflow (commit: 0a92b74)

- Deleted `Jenkinsfile` — Jenkins is replaced by Coolify as the self-hosted PaaS on Hetzner
- Created `.github/workflows/ci.yml` with:
  - Triggers: push and pull_request targeting main
  - Single `ci` job on ubuntu-latest
  - Steps: checkout, setup-node@v4 (Node 20, npm cache), npm ci, npm run build, npm test (NODE_ENV=test)
  - No deploy step — Coolify handles deployment

### Task 2: Remove nginx and certbot from docker-compose.yml (commit: 212186d)

- Removed `nginx` service (image: nginx:alpine, ports 80/443, nginx.conf and letsencrypt volume mounts)
- Removed `certbot` service (certbot/certbot, renewal loop entrypoint)
- Removed `letsencrypt_data` and `certbot_webroot` volumes
- Restored `ports: - '3000:3000'` on the `api` service so Coolify's reverse proxy can reach it directly
- Final services: api, worker, postgres, redis
- Final volumes: postgres_data, redis_data
- `docker compose config` validates cleanly (exit 0)

## Verification

- Jenkinsfile: does not exist in repo root
- .github/workflows/ci.yml: exists, contains npm run build and npm test steps, no deploy step
- docker-compose.yml: services are api, worker, postgres, redis — nothing else
- docker compose config: runs without errors

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- .github/workflows/ci.yml: FOUND
- docker-compose.yml: FOUND (nginx/certbot removed, 0 matches confirmed)
- Commit 0a92b74: FOUND
- Commit 212186d: FOUND
