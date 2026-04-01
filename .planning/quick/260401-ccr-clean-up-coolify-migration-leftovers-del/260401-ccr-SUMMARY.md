---
phase: quick
plan: 260401-ccr
subsystem: devops
tags: [cleanup, makefile, ci, nginx, coolify]
dependency_graph:
  requires: []
  provides: []
  affects: [Makefile, .github/workflows/ci.yml]
tech_stack:
  added: []
  patterns: []
key_files:
  created: []
  modified:
    - Makefile
    - .github/workflows/ci.yml
  deleted:
    - nginx/nginx.conf
    - scripts/deploy.sh
    - scripts/setup-ssl.sh
decisions:
  - "Deleted nginx.conf, deploy.sh, setup-ssl.sh — obsoleted by Coolify handling nginx proxy and SSL termination"
  - "CI node-version aligned to '22' to match Dockerfile"
metrics:
  duration: "~1 minute"
  completed: "2026-04-01"
  tasks_completed: 2
  files_changed: 5
---

# Quick Task 260401-ccr: Clean Up Coolify Migration Leftovers

**One-liner:** Removed three orphaned nginx/deploy/SSL files from the Coolify migration and corrected CI node-version from 20 to 22 to match the Dockerfile.

## What Was Done

Following the 260401-c3k quick task that migrated to Coolify and GitHub Actions CI, three files were left in the repo that are no longer used:

- `nginx/nginx.conf` — nginx was removed from docker-compose; Coolify handles the reverse proxy
- `scripts/deploy.sh` — Coolify handles deployment; manual SSH deploy script is obsolete
- `scripts/setup-ssl.sh` — Coolify handles SSL termination; certbot script is obsolete

The `Makefile` still referenced both deleted scripts via two targets (`migrate-prod` and `ssl-setup`). Additionally, `.github/workflows/ci.yml` specified Node 20 while the Dockerfile uses Node 22.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Delete orphaned Coolify/nginx/SSL files | a5a5a61 | nginx/nginx.conf, scripts/deploy.sh, scripts/setup-ssl.sh (deleted) |
| 2 | Clean Makefile and fix CI node-version | 5dd6ee9 | Makefile, .github/workflows/ci.yml |

## Verification

- `nginx/nginx.conf`, `scripts/deploy.sh`, `scripts/setup-ssl.sh` — all deleted (git rm)
- `Makefile` — no references to `migrate-prod` or `ssl-setup` anywhere (`.PHONY`, help block, target blocks all cleaned)
- `.github/workflows/ci.yml` — `node-version: '22'` confirmed
- `grep -r "migrate-prod|ssl-setup|nginx.conf|deploy.sh|setup-ssl" Makefile .github/workflows/ci.yml` — returns no matches

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- Task 1 commit a5a5a61 exists: confirmed
- Task 2 commit 5dd6ee9 exists: confirmed
- nginx/nginx.conf: deleted, no such file
- scripts/deploy.sh: deleted, no such file
- scripts/setup-ssl.sh: deleted, no such file
- Makefile: zero references to migrate-prod or ssl-setup
- ci.yml: node-version is '22'
