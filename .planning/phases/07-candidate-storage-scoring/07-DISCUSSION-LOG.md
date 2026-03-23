# Phase 7: Candidate Storage & Scoring - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the discussion.

**Date:** 2026-03-23
**Phase:** 07-candidate-storage-scoring
**Mode:** discuss
**Areas discussed:** Scoring input, Scoring failure handling, Final pipeline status, Haiku activation

## Areas Discussed

### Scoring input
**Question:** What does Claude Sonnet receive per scoring call?
**Options presented:** (1) cvText + all structured fields + job description + requirements (2) aiSummary + structured fields only (3) Structured fields only
**User choice:** Option 1 — full cvText + all structured fields + job description/requirements
**Notes:** User wants option 1 but acknowledged LLM provider not yet integrated. Design for full-signal input, scaffold as mock — easy activation when ready.

### Haiku activation
**Question:** Activate real Haiku extraction in Phase 7 or keep mock?
**Options presented:** (1) Keep mock, scaffold real call (2) Activate real Haiku now
**User choice:** Keep mock, scaffold real call
**Reason:** Same LLM credentials constraint as scoring — defer real call activation.

### Scoring failure handling
**Question:** If Sonnet scoring fails, what happens?
**Options presented:** (1) Fail entire BullMQ job (2) Log error, continue remaining jobs (3) Skip scoring entirely
**User choice:** Fail entire BullMQ job — throw, let BullMQ retry
**Reason:** Consistent with Phase 4 extraction failure pattern. Safe due to idempotent writes.

### Final pipeline status
**Question:** processingStatus after Phase 7 success?
**Options presented:** (1) 'completed' (2) 'scored' / 'stored' distinction
**User choice:** 'completed' — single terminal status for all success cases
**Reason:** Phase 1 simplicity; recruiter UI doesn't read this field yet.

## Corrections Made

No corrections — all defaults accepted or single clear choice.
