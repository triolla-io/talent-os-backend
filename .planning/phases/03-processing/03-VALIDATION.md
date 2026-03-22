---
phase: 3
slug: processing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-22
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 30.0.0 (existing) |
| **Config file** | `jest.config.json` (root) |
| **Quick run command** | `npm test -- --testPathPattern="ingestion" --passWithNoTests` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5s quick / ~30s full |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern="ingestion" --passWithNoTests`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds (quick), 30 seconds (full)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 3-W0-01 | W0 | 0 | PROC-02 | unit | `npm test -- src/ingestion/services/spam-filter.service.spec.ts` | ❌ W0 | ⬜ pending |
| 3-W0-02 | W0 | 0 | PROC-03 | unit | `npm test -- src/ingestion/services/spam-filter.service.spec.ts` | ❌ W0 | ⬜ pending |
| 3-W0-03 | W0 | 0 | PROC-04/05 | unit | `npm test -- src/ingestion/services/attachment-extractor.service.spec.ts` | ❌ W0 | ⬜ pending |
| 3-W0-04 | W0 | 0 | PROC-06 | integration | `npm test -- src/ingestion/ingestion.processor.spec.ts` | ❌ W0 | ⬜ pending |
| 3-01-01 | 01 | 1 | PROC-02 | unit | `npm test -- src/ingestion/services/spam-filter.service.spec.ts -t "no attachment and short body"` | ❌ W0 | ⬜ pending |
| 3-01-02 | 01 | 1 | PROC-02 | unit | `npm test -- src/ingestion/services/spam-filter.service.spec.ts -t "attachment present"` | ❌ W0 | ⬜ pending |
| 3-01-03 | 01 | 1 | PROC-03 | unit | `npm test -- src/ingestion/services/spam-filter.service.spec.ts -t "keyword subject no attachment"` | ❌ W0 | ⬜ pending |
| 3-01-04 | 01 | 1 | PROC-03 | unit | `npm test -- src/ingestion/services/spam-filter.service.spec.ts -t "keyword body with attachment"` | ❌ W0 | ⬜ pending |
| 3-01-05 | 01 | 1 | PROC-03 | unit | `npm test -- src/ingestion/services/spam-filter.service.spec.ts -t "keyword variations"` | ❌ W0 | ⬜ pending |
| 3-02-01 | 02 | 1 | PROC-04 | unit | `npm test -- src/ingestion/services/attachment-extractor.service.spec.ts -t "PDF extraction"` | ❌ W0 | ⬜ pending |
| 3-02-02 | 02 | 1 | PROC-05 | unit | `npm test -- src/ingestion/services/attachment-extractor.service.spec.ts -t "DOCX extraction"` | ❌ W0 | ⬜ pending |
| 3-02-03 | 02 | 1 | PROC-04/05 | unit | `npm test -- src/ingestion/services/attachment-extractor.service.spec.ts -t "unsupported type"` | ❌ W0 | ⬜ pending |
| 3-02-04 | 02 | 1 | PROC-04/05 | unit | `npm test -- src/ingestion/services/attachment-extractor.service.spec.ts -t "corrupted PDF"` | ❌ W0 | ⬜ pending |
| 3-02-05 | 02 | 1 | PROC-04/05 | unit | `npm test -- src/ingestion/services/attachment-extractor.service.spec.ts -t "multiple attachments"` | ❌ W0 | ⬜ pending |
| 3-03-01 | 03 | 2 | PROC-06 | integration | `npm test -- src/ingestion/ingestion.processor.spec.ts -t "hard reject updates status"` | ❌ W0 | ⬜ pending |
| 3-03-02 | 03 | 2 | PROC-06 | integration | `npm test -- src/ingestion/ingestion.processor.spec.ts -t "pass filter updates status"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/ingestion/services/spam-filter.service.spec.ts` — stubs for PROC-02, PROC-03 (5 test cases: no attachment, attachment present, keyword in subject, keyword in body+attachment, case-insensitive keywords)
- [ ] `src/ingestion/services/attachment-extractor.service.spec.ts` — stubs for PROC-04, PROC-05 (5 test cases: PDF, DOCX, unsupported type, corrupted PDF, multiple attachments)
- [ ] `src/ingestion/ingestion.processor.spec.ts` — stubs for PROC-06 (2 test cases: spam path status transition, pass path status transition)
- [ ] Test utilities in spec files: `mockPostmarkPayload()`, `mockBase64Pdf()`, `mockBase64Docx()` helper functions

*Wave 0 must create all spec files before implementation plans run.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real PDF CV parsed correctly | PROC-04 | Requires a real CV PDF fixture | Send a real PDF CV to the Postmark inbound address and inspect processor logs for extracted text |
| Real DOCX CV parsed correctly | PROC-05 | Requires a real CV DOCX fixture | Send a real DOCX CV to the Postmark inbound address and inspect processor logs |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
