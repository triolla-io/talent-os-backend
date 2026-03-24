# Phase 10: Add job creation feature - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the analysis.

**Date:** 2026-03-24
**Phase:** 10-add-job-creation-feature
**Mode:** discuss
**Areas discussed:** Migration strategy, Default hiring stages, API surface, Scoring pipeline scope

## Gray Areas Presented

| Area | Options considered |
|------|--------------------|
| Migration strategy for old Job fields | Coexistence (additive only) vs. drop immediately |
| Default hiring stages on job creation | Auto-seed defaults vs. start empty |
| API surface — depth of job creation | Flat POST vs. nested atomic request |
| Scoring pipeline update scope | Update this phase vs. defer |

## Decisions Made

### Migration Strategy
- **Decision:** Keep `description`, `requirements[]`, and `Application.stage` alive — additive only, no removals this phase
- **Rationale (user):** Don't break the scoring pipeline; scoring update is a separate phase after old fields are removed

### Default Hiring Stages
- **Decision:** Auto-seed Application Review → Screening → Interview → Offer on every job creation
- **Rationale (user):** Explicit instruction, exactly these 4 in order

### API Surface
- **Decision:** `POST /jobs` accepts nested stages + questions in one atomic request; service decomposes internally
- **Rationale (user):** Frontend needs to create a job in one shot

### Scoring Pipeline
- **Decision:** Do NOT touch ScoringAgentService this phase
- **Rationale (user):** Separate phase after old fields are confirmed safe to remove

## Corrections Applied

### Schema corrections (from spec review in prior session)
- `responsibleUserId` on `JobStage`: changed from `@db.Uuid` to `@db.Text` (no User model to FK)
- `Tenant` back-relations: must add `jobStages JobStage[]` and `screeningQuestions ScreeningQuestion[]`

## No Corrections by User

All decisions were provided by the user in a single response — no back-and-forth corrections needed.
