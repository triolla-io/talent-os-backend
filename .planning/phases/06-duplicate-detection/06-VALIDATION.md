---
phase: 6
slug: duplicate-detection
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-22
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 30.0.0 with ts-jest |
| **Config file** | `package.json` (jest config inline) |
| **Quick run command** | `npm test -- dedup.service.spec.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- dedup.service.spec.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green + `npm run lint`
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-00-01 | 00 | 0 | DEDUP-01–05 | unit stub | `npm test -- dedup.service.spec.ts` | ❌ W0 | ⬜ pending |
| 06-00-02 | 00 | 0 | CAND-03 | integration stub | `npm test -- ingestion.processor.spec.ts` | ❌ W0 | ⬜ pending |
| 06-00-03 | 00 | 0 | schema | migration | `grep -r "ai_summary" prisma/migrations/` | ❌ W0 | ⬜ pending |
| 06-01-01 | 01 | 1 | DEDUP-01 | unit | `npm test -- dedup.service.spec.ts --testNamePattern="executes in PostgreSQL"` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 1 | DEDUP-02 | unit | `npm test -- dedup.service.spec.ts --testNamePattern="exact email match"` | ❌ W0 | ⬜ pending |
| 06-01-03 | 01 | 1 | DEDUP-03 | unit | `npm test -- dedup.service.spec.ts --testNamePattern="fuzzy match"` | ❌ W0 | ⬜ pending |
| 06-01-04 | 01 | 1 | DEDUP-04 | unit | `npm test -- dedup.service.spec.ts --testNamePattern="no match"` | ❌ W0 | ⬜ pending |
| 06-01-05 | 01 | 1 | DEDUP-05 | unit | `npm test -- dedup.service.spec.ts --testNamePattern="reviewed false"` | ❌ W0 | ⬜ pending |
| 06-01-06 | 01 | 1 | DEDUP-06 | schema | `grep -r "idx_candidates_name_trgm\|idx_candidates_phone_trgm" prisma/migrations/` | ✅ Phase 1 | ⬜ pending |
| 06-02-01 | 02 | 2 | CAND-03 | integration | `npm test -- ingestion.processor.spec.ts --testNamePattern="candidate_id set"` | ❌ W0 | ⬜ pending |
| 06-02-02 | 02 | 2 | DEDUP-01–05 | integration | `npm test -- ingestion.processor.spec.ts --testNamePattern="dedup"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/dedup/dedup.service.spec.ts` — stub test file covering DEDUP-01, DEDUP-02, DEDUP-03, DEDUP-04, DEDUP-05 (5 describe blocks, `it.todo` stubs)
- [ ] `src/dedup/dedup.module.ts` — module definition (needed before service spec can import)
- [ ] `src/dedup/dedup.service.ts` — minimal stub (class + constructor) so spec file compiles
- [ ] `prisma/migrations/{timestamp}_add_ai_summary/migration.sql` — adds `ai_summary TEXT` nullable column to candidates

*Extended `ingestion.processor.spec.ts` already exists (70 tests passing) — Phase 6 adds `it.todo` stubs for CAND-03 integration tests.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| pg_trgm similarity() runs in PostgreSQL (not app memory) | DEDUP-01 | Cannot verify SQL execution location in unit tests | Check query logs or explain plan: `EXPLAIN SELECT similarity(full_name, 'test') FROM candidates` |
| GIN indexes created and used for fuzzy query | DEDUP-06 | Requires live DB with pg_trgm extension | `EXPLAIN ANALYZE SELECT ... FROM candidates WHERE full_name % 'test'` — confirm "Bitmap Index Scan on idx_candidates_name_trgm" |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
