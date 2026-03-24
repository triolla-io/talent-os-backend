---
phase: 10
slug: add-job-creation-feature
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-24
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 29.x |
| **Config file** | jest.config.js |
| **Quick run command** | `npm test -- --testPathPattern=jobs` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern=jobs`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-W0-01 | stub | 0 | D-04,D-06 | unit stub | `npm test -- --testPathPattern=jobs.service` | ❌ W0 | ⬜ pending |
| 10-W0-02 | stub | 0 | D-06,D-07 | unit stub | `npm test -- --testPathPattern=jobs.controller` | ❌ W0 | ⬜ pending |
| 10-W0-03 | stub | 0 | D-06 | integration stub | `npm test -- --testPathPattern=jobs.integration` | ❌ W0 | ⬜ pending |
| 10-schema | schema | 1 | D-09,D-10 | migration | `npx prisma migrate dev --dry-run` | N/A | ⬜ pending |
| 10-create-job | create | 1 | D-04,D-06,D-07 | unit | `npm test -- --testPathPattern=jobs.service` | ❌ W0 | ⬜ pending |
| 10-api | api | 2 | D-06,D-08 | integration | `npm test -- --testPathPattern=jobs.integration` | ❌ W0 | ⬜ pending |
| 10-coexist | compat | 2 | D-01,D-02 | regression | `npm test` | ✅ existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/jobs/jobs.service.spec.ts` — stubs for D-04 (auto-seed stages), D-06 (nested create), D-07 (default stages when hiringStages omitted)
- [ ] `src/jobs/jobs.controller.spec.ts` — stubs for D-06 (POST /jobs), D-08 (validation)
- [ ] `src/jobs/jobs.integration.spec.ts` — stubs for end-to-end job creation with nested stages and questions

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Prisma migration applies cleanly | D-09, D-10 | Requires live DB | Run `npx prisma migrate dev` against dev DB; verify new tables exist in psql |
| Application.stage still returned | D-02 | Regression | Call GET /api/applications after migration; verify `stage` field present in response |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
