---
phase: 5
slug: file-storage
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-22
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest v30.0.0 + @nestjs/testing |
| **Config file** | Configured in package.json (no separate jest.config.ts) |
| **Quick run command** | `npm test -- storage.service.spec.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5s (quick) / ~30s (full) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- storage.service.spec.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~5 seconds (quick) / ~30 seconds (full)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 5-00-01 | 00 | 0 | STOR-01 | unit stub | `npm test -- storage.service.spec.ts` | ❌ W0 creates | ⬜ pending |
| 5-00-02 | 00 | 0 | STOR-03 | integration stub | `npm test -- ingestion.processor.spec.ts` | ✅ exists | ⬜ pending |
| 5-01-01 | 01 | 1 | STOR-01 | unit | `npm test -- storage.service.spec.ts --testNamePattern="uploads largest"` | ✅ W0 | ⬜ pending |
| 5-01-02 | 01 | 1 | STOR-02 | unit | `npm test -- storage.service.spec.ts --testNamePattern="does NOT return presigned"` | ✅ W0 | ⬜ pending |
| 5-01-03 | 01 | 1 | D-01 | unit | `npm test -- storage.service.spec.ts --testNamePattern="returns null if no PDF"` | ✅ W0 | ⬜ pending |
| 5-01-04 | 01 | 1 | D-07 | unit | `npm test -- storage.service.spec.ts --testNamePattern="propagates R2 errors"` | ✅ W0 | ⬜ pending |
| 5-01-05 | 01 | 1 | D-11 | unit | `npm test -- storage.service.spec.ts --testNamePattern="sets explicit ContentType"` | ✅ W0 | ⬜ pending |
| 5-02-01 | 02 | 2 | STOR-01 | integration | `npm test -- ingestion.processor.spec.ts --testNamePattern="calls storageService.upload"` | ✅ W0 | ⬜ pending |
| 5-02-02 | 02 | 2 | D-07 | integration | `npm test -- ingestion.processor.spec.ts --testNamePattern="propagates upload error"` | ✅ W0 | ⬜ pending |
| 5-02-03 | 02 | 2 | D-02 | integration | `npm test -- ingestion.processor.spec.ts --testNamePattern="passes null fileKey"` | ✅ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/storage/storage.service.spec.ts` — 5+ unit test stubs (STOR-01, STOR-02, D-01, D-07, D-11)
- [ ] `src/storage/storage.service.ts` — minimal stub (class + upload method signature)
- [ ] `src/storage/storage.module.ts` — NestJS module stub
- [ ] `src/ingestion/ingestion.processor.spec.ts` — Add 3 integration test stubs for Phase 5 (StorageService wiring)

*Existing infrastructure (Jest, @nestjs/testing) covers all phase requirements — no framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| R2 bucket is private (no public access) | STOR-02 / D-03 | Requires live R2 credentials + bucket policy inspection | In R2 dashboard: verify bucket has no Public Access policy; attempt to GET a key via public URL and confirm 403 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
