---
phase: 14
slug: wire-openrouter-extraction-pipeline-email-llm-dedup-scoring-ui
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-29
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for continuous feedback during execution. Phase 14 fixes error handling, extends LLM extraction schema, wires real OpenRouter scoring, and implements deterministic fallback.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.x (NestJS integrated) |
| **Config file** | `jest.config.js` (existing) |
| **Quick run command** | `npm test -- src/ingestion src/scoring src/dedup --testPathPattern='(extraction-agent|scoring|dedup)' --maxWorkers=4` |
| **Full suite command** | `npm test -- src/` |
| **Estimated runtime** | Quick: ~12s; Full: ~45s |

---

## Sampling Rate

- **After every task commit:** Run quick test suite (`npm test -- src/ingestion src/scoring src/dedup --maxWorkers=4`)
- **After every plan wave:** Run full suite (`npm test -- src/`)
- **Before `/gsd:verify-work`:** Full suite must pass (0 test failures, 0 console.error logs from extraction/scoring)
- **Max feedback latency:** 15 seconds per task commit

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Status | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 14-01-01 | 14-01 | 1 | Schema: 9 fields, Zod validation | unit | `npm test -- extraction-agent.service.spec.ts --testNamePattern="CandidateExtractSchema"` | ✅ exists | ⬜ pending |
| 14-01-02 | 14-01 | 1 | Error propagation: extract() throws on callAI() error | unit | `npm test -- extraction-agent.service.spec.ts --testNamePattern="should throw.*error"` | ✅ exists | ⬜ pending |
| 14-01-03 | 14-01 | 1 | Metadata included in callAI() message | unit | `npm test -- extraction-agent.service.spec.ts --testNamePattern="metadata"` | ✅ exists | ⬜ pending |
| 14-02-01 | 14-02 | 1 | Real OpenRouter call (not hardcoded 72) | unit | `npm test -- scoring.service.spec.ts --testNamePattern="should call.*OpenRouter"` | ✅ exists | ⬜ pending |
| 14-02-02 | 14-02 | 1 | ConfigService injected via ScoringModule | unit | `npm test -- scoring.module.spec.ts --testNamePattern="ConfigModule"` | ✅ exists (if exists) | ⬜ pending |
| 14-03-01 | 14-03 | 2 | Processor passes metadata to extract() | integration | `npm test -- ingestion.processor.spec.ts --testNamePattern="metadata.*extract"` | ✅ exists | ⬜ pending |
| 14-03-02 | 14-03 | 2 | Phase 7: extracted fields used (not hardcoded null) | integration | `npm test -- ingestion.processor.spec.ts --testNamePattern="enrichment.*extracted"` | ✅ exists | ⬜ pending |
| 14-03-03 | 14-03 | 2 | DedupService.insertCandidate() uses source_hint | unit | `npm test -- dedup.service.spec.ts --testNamePattern="source.*param"` | ✅ exists | ⬜ pending |
| 14-03-04 | 14-03 | 2 | Deterministic fallback called on attempt 3 | integration | `npm test -- ingestion.processor.spec.ts --testNamePattern="fallback.*final.*attempt"` | ✅ exists | ⬜ pending |
| 14-03-05 | 14-03 | 2 | E2E: Full pipeline with real extraction + scoring | integration | `npm test -- ingestion.processor.spec.ts --testNamePattern="e2e.*full.*pipeline"` | ✅ exists | ⬜ pending |
| 14-03-06 | 14-03 | 2 | E2E: Retry logic (fail 2x, succeed 3x) | integration | `npm test -- ingestion.processor.spec.ts --testNamePattern="retry.*transient"` | ✅ exists | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · ⏭️ skipped*

---

## Wave 0 Requirements

- [ ] `src/ingestion/services/extraction-agent.service.spec.ts` — 4 tests: schema validation, error propagation, metadata inclusion, deterministic returns all fields
- [ ] `src/scoring/scoring.service.spec.ts` — 3 tests: real OpenRouter call (mock SDK), safeParse error handling, score range validation
- [ ] `src/dedup/dedup.service.spec.ts` — 1 test: source parameter used when provided
- [ ] `src/ingestion/ingestion.processor.spec.ts` — 5 integration tests: metadata pass, enrichment fields, fallback invoked, full E2E, retry logic
- [ ] `src/scoring/scoring.module.spec.ts` — 1 test: ConfigModule imported, ConfigService available (if module.spec doesn't exist, skip)
- [ ] Jest configuration already includes TypeScript support; no additional Wave 0 setup needed

*Wave 0 total: 14 new test specs across 4 files*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Hebrew CV extraction accuracy | PRD §5 mentions "test with real Hebrew CVs" | Gemini language support varies; need visual inspection of extracted fields | Post-execution: Send test Hebrew CV to Postmark webhook, verify extracted fields (currentRole, location, skills) in database. Compare against manual parsing of CV content. Document results in PR comment. |
| Rate limiting on free tier | PRD mentions ~15 RPM limit on `google/gemini-2.0-flash:free` | Limits are dynamic per OpenRouter; automated test can't predict rate-limit behavior | During manual testing: Send 20 rapid requests via queue. If rate-limited (429), verify BullMQ retry + exponential backoff kicks in. Check OpenRouter dashboard for quota usage. Document in PR if free tier degraded. |
| Deterministic fallback data quality | PRD §3 GAP-6 notes "Keep as fallback on final attempt" | Deterministic (keyword matching) may return sparse fields; visual inspection needed to confirm acceptable | Mock OpenRouter to fail 3x, let fallback run. Verify: (1) candidate created with non-empty full_name, (2) fields like currentRole/years_experience may be null, (3) job marked as retried (not failed immediately). Acceptable if at least basic info saved. |

---

## Validation Sign-Off

- [ ] All 11 core tasks have automated test coverage (unit or integration)
- [ ] Sampling continuity: 14-01 → (quick test), Wave 1 complete → (full test), 14-02 → (quick test), Wave 2 complete → (full test), 14-03 → (full test before verify-work)
- [ ] Wave 0 creates 14 new test specs covering all modified files + error cases
- [ ] No `--watch` or polling flags in test commands (all one-shot)
- [ ] Feedback latency: Quick suite ~12s, full suite ~45s, both < 60s limit ✅
- [ ] All 3 manual verifications (Hebrew, rate limit, fallback quality) documented in PR template
- [ ] `nyquist_compliant: true` will be set after Wave 0 tests pass

**Approval:** pending (will be set to approved YYYY-MM-DD after Wave 0 execution)

---

## Notes

- **Error cases:** Tests mock OpenRouter failures, verify error propagates and BullMQ retries
- **Schema safety:** Zod safeParse errors are caught and logged; processor continues with fallback
- **Cost tracking:** No cost assertions in tests (free tier is primary); monitoring via OpenRouter dashboard is manual
- **Retry exhaustion:** When all 3 BullMQ attempts fail, deterministic fallback is last resort; if that fails too, job is marked `failed` permanently (test verifies this path)
