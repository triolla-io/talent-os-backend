# Protocol Changes: Full → MVP

**What was removed/simplified for MVP focus.**

---

## Removed Endpoints

- ❌ GET /applications (Pipeline — defer to Phase 2)
- ❌ All application endpoints
- ❌ POST /candidates (create via email only for MVP)

**Why:** Focus on reading data. POST /candidates is handled via email intake, not API.

## Phase 1 Included

- ✅ GET /candidates (Talent Pool — **schema unstable, will change soon**)
- ✅ GET /jobs & mutations (Jobs)
- ✅ GET /config (Configuration)

---

## Simplified GET /config

**Removed:**
- Dynamic hiring_managers query → now hardcoded list
- Pipeline stages enum list → not needed in MVP (only used in applications)

**Kept:**
- `departments` (hardcoded)
- `hiring_managers` (hardcoded)
- `job_types` (hardcoded)
- `organization_types` (hardcoded)
- `screening_question_types` (hardcoded)
- `hiring_stages_template` (default stages for new jobs)

**Why:** All static for MVP. No database lookup needed. Caching is trivial.

---

## GET /jobs Response

**No pagination:** Returns all jobs (fine for MVP).

**No new query params:** Filtering removed (can add in Phase 2).

**All job fields now included:**
- Full job details (description, responsibilities, salary_range, skills, experience, org_types)
- Nested hiring_flow with all fields (color, is_enabled, interviewer, is_custom)
- Nested screening_questions with all fields

**Why:** Avoid multiple API calls. Return complete job data for immediate edit.

---

## Screening Questions

**Removed fields:**
- ❌ `required` — All questions are optional in MVP
- ❌ `knockout` — No logic to filter candidates in MVP
- ❌ `multiple_choice`, `file_upload` answer types — Only `yes_no` and `text`

**Kept:**
- `type` (renamed from `answerType`)
- `text`
- `expected_answer` (added, was missing)

**Why:** Simpler validation, matches frontend UI. Advanced screening is Phase 2.

---

## Hiring Stages

**Added fields:**
- ✅ `color` — UI needs this for Kanban board
- ✅ `is_enabled` — UI needs to toggle stages
- ✅ `interviewer` — Changed from `responsibleUserId` (was UUID, now free text name/email)

**Removed:**
- ❌ `responsible_user_id` as UUID — Changed to `interviewer` as string

**Why:** Simpler for MVP (no user lookup). Interviewer is just a name or email.

---

## Error Handling

**Kept:** Standard error format with code, message, details.

**Removed:** Specific conflict scenarios (e.g., "close job with pending applications").

**Why:** MVP is simpler — most conflict scenarios don't apply yet.

---

## Implementation Checklist Changes

**Removed:**
- Pagination logic
- N+1 query optimization notes (use simple JOINs for MVP)
- Backward compatibility discussion
- Advanced validation (state transitions, etc.)

**Kept:**
- Schema updates
- Endpoint implementation
- Basic testing
- Tenant isolation

**Why:** Focus on ship, not premature optimization.

---

## Summary of Benefits

| Aspect | Before | After |
|--------|--------|-------|
| **Endpoints** | 8 | 5 (GET /config, GET /jobs, POST /jobs, PUT /jobs, DELETE /jobs, GET /candidates) |
| **Screening fields** | 5 | 4 |
| **Hiring stage fields** | 4 | 7 (added color, is_enabled, fixed interviewer) |
| **API Response size** | Large (missing nested data) | Compact, complete |
| **Client API calls** | Multiple (N+1) | Single call per page |
| **Config dynamic** | Needs DB | Hardcoded (fast) |
| **Backend complexity** | High (filtering, pagination) | Low (CRUD only) |

---

## What This Enables

✅ Frontend can build complete Jobs page without placeholder data
✅ Backend has clear, simple spec (no ambiguity)
✅ Both teams aligned on exact field names & types
✅ Easy to extend in Phase 2 (add candidates → applications → pipeline)
✅ Single source of truth: `API_PROTOCOL_MVP.md`

