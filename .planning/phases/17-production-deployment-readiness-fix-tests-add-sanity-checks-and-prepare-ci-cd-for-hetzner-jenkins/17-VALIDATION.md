---
phase: 17
slug: production-deployment-readiness-fix-tests-add-sanity-checks-and-prepare-ci-cd-for-hetzner-jenkins
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-31
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 30.0.0 + ts-jest 29.2.5 |
| **Config file** | `jest.config.js` / `package.json` (already configured) |
| **E2E Config** | `test/jest-e2e.json` (existing) |
| **Quick run command** | `npm run test` |
| **Full suite command** | `npm run test && npm run test:e2e` |
| **Estimated runtime** | ~2s unit, ~5s E2E |

---

## Sampling Rate

- **After every task commit:** Run `npm run test`
- **After every plan wave:** Run `npm run test && npm run test:e2e`
- **Before `/gsd:verify-work`:** Full suite must be green + `make test` in Docker passes
- **Max feedback latency:** ~7 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 17-fix-tests | 01 | 1 | D-10 | unit | `npm run test -- src/jobs/jobs.integration.spec.ts src/ingestion/ingestion.processor.spec.ts` | ✅ (failing) | ⬜ pending |
| 17-health-endpoint | 01 | 1 | D-21 | e2e | `npm run test:e2e -- test/app.e2e-spec.ts` | ❌ W0 | ⬜ pending |
| 17-e2e-smoke | 01 | 1 | D-11 | e2e | `npm run test:e2e` | ❌ W0 | ⬜ pending |
| 17-helmet | 02 | 2 | D-14 | unit | `npm run test` | ❌ W0 | ⬜ pending |
| 17-throttler | 02 | 2 | D-15 | unit | `npm run test` | ❌ W0 | ⬜ pending |
| 17-makefile | 03 | 2 | D-12 | shell | `make test` | ❌ W0 | ⬜ pending |
| 17-nginx-ssl | 04 | 3 | D-33/D-34/D-35 | manual | docker compose config validate | ❌ W0 | ⬜ pending |
| 17-jenkins | 05 | 3 | D-04/D-05 | manual | lint Jenkinsfile | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/app.e2e-spec.ts` — add health endpoint smoke test (GET /health returns 200)
- [ ] `src/health/health.controller.ts` — implement GET /health endpoint
- [ ] `src/health/health.service.ts` — implement DB + Redis probes
- [ ] `src/health/health.module.ts` — new HealthModule
- [ ] Fix 6 failing unit tests in `src/jobs/jobs.integration.spec.ts` and `src/ingestion/ingestion.processor.spec.ts`
- [ ] `Makefile` — create with targets: up, down, reset, seed, test, logs, backup, restore, ngrok, migrate-prod, ssl-setup
- [ ] `docker-compose.yml` — add nginx + certbot services, resource limits, api healthcheck
- [ ] `nginx/nginx.conf` — HTTP→HTTPS redirect + TLS termination + proxy to api:3000
- [ ] `scripts/deploy.sh` — SSH + docker compose pull + up
- [ ] `scripts/setup-ssl.sh` — certbot webroot challenge provisioning

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SSL cert provisioning | D-35/D-36 | Requires live domain + DNS | Run `make ssl-setup DOMAIN=x EMAIL=y`, verify cert files created |
| Nginx HTTPS redirect | D-34 | Requires live HTTPS connection | `curl -I http://domain` → expect 301 to https |
| Jenkins pipeline run | D-04/D-05 | Requires Jenkins server | Trigger parameterized build, verify Build→Test passes |
| Container resource limits active | D-27 | Requires `docker stats` on running containers | Verify memory limits enforced in `docker stats` |
| CORS deny-all | D-16 | Browser-level behavior | Send cross-origin request, verify CORS headers absent |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 7s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
