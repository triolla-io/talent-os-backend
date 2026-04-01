---
phase: 17-production-deployment-readiness-fix-tests-add-sanity-checks-and-prepare-ci-cd-for-hetzner-jenkins
plan: '05'
subsystem: infra
tags: [makefile, jenkins, ci-cd, docker, deploy, nginx, ssl, ngrok, readme]

requires:
  - phase: 17-03
    provides: security hardening, CORS, helmet, rate limiting
  - phase: 17-04
    provides: docker-compose.yml with nginx, SSL setup scripts, resource limits

provides:
  - Makefile with 11 dev workflow targets (up, down, reset, seed, logs, test, backup, restore, ngrok, migrate-prod, ssl-setup)
  - Jenkinsfile with parameterized CI pipeline (BRANCH_NAME param, 5 stages, no auto-deploy)
  - scripts/deploy.sh — SSH-based manual production deployment script
  - scripts/ngrok-webhook.sh — usage comments added
  - README.md — complete developer onboarding document (prerequisites, quick start, env vars, Makefile reference, deployment, troubleshooting)
  - backups/ directory gitignored

affects: [deployment, onboarding, ci-cd, hetzner-vps, jenkins-setup]

tech-stack:
  added: []
  patterns:
    - "Makefile wraps docker compose commands with named targets for discoverability"
    - "Jenkins parameterized build with BRANCH_NAME — single Jenkinsfile serves main, feature, and staging branches"
    - "Deploy is always a manual human action — CI gates only, no auto-deploy"
    - "make up auto-migrates (prisma migrate deploy) but make seed is opt-in"
    - "backups/ is gitignored — local dumps only, never committed"

key-files:
  created:
    - Makefile
    - Jenkinsfile
    - scripts/deploy.sh
  modified:
    - .gitignore
    - README.md
    - scripts/ngrok-webhook.sh

key-decisions:
  - "make up auto-migrates on every start — safe because prisma migrate deploy is idempotent"
  - "make test runs jest inside Docker (not local npm) so test environment matches Jenkins exactly"
  - "Jenkinsfile has BRANCH_NAME param defaulting to main — staging branches work without a second Jenkinsfile"
  - "deploy.sh requires PROD_HOST env var set by caller — not hardcoded, safe to commit"
  - "Migrations are never automatic on prod container start — always via explicit make migrate-prod (D-07)"

patterns-established:
  - "Makefile as the single entry point for all local dev operations"
  - "CI pipeline: Build + Test only. Deploy = manual SSH action."

requirements-completed:
  - D-01
  - D-02
  - D-03
  - D-04
  - D-05
  - D-06
  - D-07
  - D-08
  - D-09
  - D-25
  - D-26
  - D-29
  - D-30
  - D-31
  - D-32
  - D-38

duration: 3min
completed: 2026-04-01
---

# Phase 17 Plan 05: CI/CD Artifacts and Developer Onboarding Summary

**Makefile with 11 dev targets, parameterized Jenkinsfile (BRANCH_NAME), SSH deploy script, and complete README — full developer onboarding and CI/CD groundwork for Hetzner/Jenkins deployment**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-01T04:51:47Z
- **Completed:** 2026-04-01T04:54:50Z
- **Tasks:** 3
- **Files modified:** 5 (Makefile created, Jenkinsfile created, scripts/deploy.sh created, .gitignore modified, README.md rewritten, scripts/ngrok-webhook.sh modified = 6)

## Accomplishments

- Makefile created with 11 make targets — `make up` auto-migrates, `make test` runs jest inside Docker, `make backup` pg_dumps to ./backups/
- Jenkinsfile with `BRANCH_NAME` parameter enables CI on any branch without a second Jenkinsfile; 5 stages (Checkout, Install, Build, Test, Docker Build), no auto-deploy
- `scripts/deploy.sh` is an executable SSH-based deploy script accepting branch argument, using `set -euo pipefail`
- README.md rewritten as comprehensive onboarding doc: prerequisites, quick start, full env vars table (all 10 vars from .env.example), Makefile reference, local dev guide, deployment procedure, troubleshooting table

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Makefile with all 11 targets** - `bfcb1c3` (chore)
2. **Task 2: Create Jenkinsfile + deploy.sh + clean up ngrok script** - `570512c` (chore)
3. **Task 3: Rewrite README.md as complete developer onboarding document** - `a710aca` (docs)

## Files Created/Modified

- `Makefile` — 11 make targets wrapping docker compose and prisma commands for all local dev operations
- `Jenkinsfile` — Parameterized CI pipeline with BRANCH_NAME param, 5 stages, post actions
- `scripts/deploy.sh` — Manual SSH-based production deployment script, executable, set -euo pipefail
- `scripts/ngrok-webhook.sh` — Added usage comment block (prerequisites, what it does, ngrok URL caveat)
- `.gitignore` — Added `backups/` entry
- `README.md` — Complete rewrite: prerequisites, quick start (6 steps), env vars table, Makefile reference, local dev, architecture diagram, deployment procedure, CI/CD Jenkins section, troubleshooting table

## Decisions Made

- `make up` auto-migrates via `prisma migrate deploy` (idempotent, safe to run on every stack start)
- `make test` runs jest inside Docker to ensure test environment matches Jenkins exactly (not `npm run test` locally)
- Jenkinsfile `BRANCH_NAME` defaults to `main` but accepts any branch — enables staging builds without a second Jenkinsfile
- `deploy.sh` reads `PROD_HOST` from environment (not hardcoded) — safe to commit to git
- Migrations on prod are always an explicit `make migrate-prod` human action — never automatic on container start

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required. Server operator setup is documented in the README deployment section.

## Next Phase Readiness

Phase 17 is complete. All CI/CD artifacts are ready for when the Hetzner VPS and Jenkins server are provisioned:

- Clone repo to VPS, copy `.env.example`, fill secrets
- Run `make ssl-setup` for TLS cert provisioning
- Configure Jenkins with `BRANCH_NAME` parameterized build pointing to the Jenkinsfile
- Deploy with `PROD_HOST=ubuntu@server ./scripts/deploy.sh main`

---
*Phase: 17-production-deployment-readiness-fix-tests-add-sanity-checks-and-prepare-ci-cd-for-hetzner-jenkins*
*Completed: 2026-04-01*
