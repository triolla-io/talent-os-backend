# Phase 11: Review and Validate API Protocol MVP Spec and Implementation Guide - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the analysis and user corrections.

**Date:** 2026-03-25
**Phase:** 11-review-and-validate-api-protocol-mvp-spec-and-implementation-guide
**Mode:** Assumption review + user clarification
**Gray areas discussed:** 5

---

## Initial Assumptions Presented

### 1. JobStage Schema
**Initial assumption:** Add `color` column to database for styling.
**User correction:** Color is client-only, computed in responses. Do NOT store in database.
**Decision:** Remove color from schema changes. D-03 states color is computed in API response.

### 2. responsible_user_id → interviewer Migration
**Initial assumption:** Change to UUID reference (create user table).
**User correction:** No user table in Phase 1. Keep as TEXT free-form name field. Could support multiple interviewers in future, but MVP is single string.
**Decision:** Rename to `interviewer` TEXT, nullable. D-01 captures this. Safe migration via create-copy-drop pattern (D-31).

### 3. ScreeningQuestion Schema Cleanup
**Initial assumption:** Keep `required` and `knockout` columns (backward compat).
**User correction:** Prefer cleaner schema. Remove them in migration.
**Decision:** Hard remove `required` and `knockout` columns. D-05 captures this. No backward compat needed for MVP.

### 4. DELETE /jobs Behavior
**Initial assumption:** Hard delete (remove rows via CASCADE).
**User correction:** Soft delete — just set status to "closed". Don't add deleted_at column.
**Decision:** Use existing Job.status enum. D-21 captures this approach.

### 5. Phase 11 Scope
**Initial assumption:** Include GET /candidates endpoint updates.
**User correction:** Out of scope. Phase 11 is jobs only.
**Decision:** GET /candidates left as-is. Noted in deferred ideas.

---

## Key Decisions Locked (from CONTEXT.md)

| ID | Decision | Rationale |
|---|----------|-----------|
| D-01 | `responsible_user_id` → `interviewer` (TEXT) | No user table, free-form name |
| D-02 | Add `is_enabled` to JobStage | MVP requires toggle for stage visibility |
| D-03 | Color is client-computed, not in DB | Reduce schema complexity, computed per stage |
| D-04 | Add `expected_answer` to ScreeningQuestion | Capture expected answer for validation |
| D-05 | Remove `required`, `knockout` columns | Cleaner schema, unused in MVP |
| D-06 | Response field: `type` (not `answerType`) | Matches protocol spec |
| D-07–D-08 | GET /config hardcoded response | No DB queries, fast bootstrap |
| D-09–D-13 | GET /jobs full schema + nested arrays | Complete job data in single call |
| D-14–D-16 | POST /jobs updated with new schema | Validation: at least 1 stage enabled |
| D-17–D-20 | PUT /jobs/:id atomic nested update | Prisma transaction for consistency |
| D-21–D-22 | DELETE /jobs soft delete via status=closed | No deleted_at column |
| D-26–D-29 | Integration tests + tenant isolation | MVP best practice testing |
| D-31 | Safe migration for responsible_user_id | Create new column, copy, drop old |

---

## Assumptions Auto-Confirmed (No Correction Needed)

- Migration approach: Prisma (not raw SQL) ✓
- Error response format: `{ error: { code, message, details } }` ✓
- Tenant isolation enforced on all endpoints ✓
- Response ordering by `order` field (ASC) ✓
- Default 4 stages seeded if none provided ✓

---

## Deferred Ideas Captured

1. GET /candidates endpoint — separate phase
2. Pagination for GET /jobs — Phase 2+
3. Advanced filtering — Phase 2+
4. Dynamic config from database — future
5. Multiple interviewers per stage — future (currently single TEXT field)

---

*Discussion completed: 2026-03-25*
