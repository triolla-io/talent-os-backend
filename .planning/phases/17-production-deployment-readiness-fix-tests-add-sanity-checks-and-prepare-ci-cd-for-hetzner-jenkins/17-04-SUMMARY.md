---
phase: 17-production-deployment-readiness-fix-tests-add-sanity-checks-and-prepare-ci-cd-for-hetzner-jenkins
plan: '04'
subsystem: infrastructure
tags: [nginx, tls, letsencrypt, certbot, docker-compose, resource-limits, healthcheck]
dependency_graph:
  requires: [17-01, 17-02]
  provides: [nginx-reverse-proxy, tls-termination, resource-limits, ssl-provisioning]
  affects: [docker-compose.yml, nginx/nginx.conf, scripts/setup-ssl.sh]
tech_stack:
  added: [nginx:alpine, certbot/certbot]
  patterns:
    [nginx-reverse-proxy, letsencrypt-webroot-challenge, certbot-renewal-loop, docker-healthcheck, resource-limits]
key_files:
  created:
    - nginx/nginx.conf
    - scripts/setup-ssl.sh
  modified:
    - docker-compose.yml
decisions:
  - 'Remove port 3000:3000 from api service — nginx is the only internet-facing entry point (D-33)'
  - 'Use certbot webroot mode (not standalone) so nginx handles port 80 serving while certbot writes challenge files'
  - 'Certbot renewal loop in compose service (12h sleep cycle) with trap exit TERM for graceful shutdown'
  - 'Resource limits sized for Hetzner CX21: api 512M, worker 768M, postgres 1024M, redis 128M (D-27)'
  - 'API healthcheck uses wget /api/health — wget is available in Alpine-based images without curl'
metrics:
  duration: 8 minutes
  completed_date: '2026-03-31'
  tasks_completed: 3
  tasks_total: 3
  files_created: 2
  files_modified: 1
---

# Phase 17 Plan 04: Nginx Reverse Proxy + TLS + Resource Limits Summary

**One-liner:** Nginx TLS reverse proxy with Let's Encrypt certbot auto-renewal, container resource limits for Hetzner CX21, and one-time SSL provisioning script.

## What Was Built

Added production-grade HTTPS infrastructure required for Postmark webhook delivery. Without HTTPS, the pipeline cannot receive emails in production.

**nginx/nginx.conf** — Nginx configuration with:

- HTTP server on port 80: returns 301 redirect to HTTPS, serves `.well-known/acme-challenge/` webroot for certbot
- HTTPS server on port 443: TLS termination + `proxy_pass http://api:3000`
- Modern TLS (TLSv1.2/1.3), `client_max_body_size 10m` for CV PDF payloads
- Correct proxy headers: X-Real-IP, X-Forwarded-For, X-Forwarded-Proto, Upgrade

**docker-compose.yml** changes:

- Removed `ports: - '3000:3000'` from api (api is no longer internet-facing)
- Added api healthcheck: `wget -qO- http://localhost:3000/api/health || exit 1`
- Added `deploy.resources.limits` to all 4 app services (api, worker, postgres, redis)
- Added `restart: unless-stopped` to postgres and redis (api and worker already had it)
- Added nginx service: ports 80/443, mounts nginx.conf + letsencrypt/certbot volumes
- Added certbot service: renewal loop `certbot renew` every 12 hours with graceful trap
- Added volumes: `letsencrypt_data`, `certbot_webroot`

**scripts/setup-ssl.sh** — One-time cert provisioning:

- Takes domain and email as positional args
- Runs `certbot certonly --webroot` via `docker compose run`
- Includes prerequisites, step-by-step instructions, and post-cert Next Steps
- `set -euo pipefail` strict mode; executable (`-x`)

## Commits

| Task   | Commit  | Description                                                                             |
| ------ | ------- | --------------------------------------------------------------------------------------- |
| Task 1 | 03f764e | create nginx/nginx.conf with HTTP redirect + TLS proxy                                  |
| Task 2 | a0c2309 | add nginx/certbot, resource limits, healthcheck, restart policies to docker-compose.yml |
| Task 3 | 8f7cc6c | create scripts/setup-ssl.sh — one-time Let's Encrypt cert provisioning                  |

## Verification Results

All 3 checks passed:

- `docker compose config` exits 0 (valid YAML)
- `nginx/nginx.conf` exists
- `scripts/setup-ssl.sh` is executable

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all infrastructure is complete and functional. The `$DOMAIN` placeholder in `nginx/nginx.conf` is intentional — operators replace it with their actual domain during server setup (documented in setup-ssl.sh Next Steps).

## Self-Check: PASSED

- nginx/nginx.conf: FOUND
- scripts/setup-ssl.sh: FOUND
- docker-compose.yml updated: FOUND
- Commits 03f764e, a0c2309, 8f7cc6c: present in git log
