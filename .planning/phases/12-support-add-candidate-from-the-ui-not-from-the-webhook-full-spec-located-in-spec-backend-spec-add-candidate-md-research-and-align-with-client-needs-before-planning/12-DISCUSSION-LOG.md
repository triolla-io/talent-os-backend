# Phase 12: Support add candidate from the UI - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the discussion.

**Date:** 2026-03-26
**Phase:** 12-support-add-candidate-from-the-ui-not-from-the-webhook-full-spec-located-in-spec-backend-spec-add-candidate-md-research-and-align-with-client-needs-before-planning
**Mode:** discuss (interactive question-based discussion)
**Areas analyzed:** Duplicate detection, CV file processing, Response format, Application stage assignment

---

## Duplicate Detection for Manual Candidates

| Option | Description | Selected |
|--------|-------------|----------|
| Skip dedup | Trust recruiters; no duplicate detection for manual adds | ✓ |
| Email check only | Reject if email exists; no fuzzy matching | |
| Full pg_trgm like webhook | Identical dedup as email intake; flag fuzzy matches | |

**User's choice:** Skip dedup — recruiters know what they're adding (Recommended)
**Notes:** Manual adds are deliberate, recruiters have agency. DB unique email constraint still enforces 409 on exact email duplicates.

---

## CV File Processing & Parsing

| Option | Description | Selected |
|--------|-------------|----------|
| Store file URL only, cv_text=null | Simple; distinguishes manual from webhook candidates | ✓ |
| Parse file to cv_text sync | Consistent with email intake; all candidates have text | |
| Parse file async in background | Fast response, text available later | |

**User's choice:** Store file URL, leave cv_text null (Recommended)
**Notes:** Recruiters know their candidates when manually adding; parsing overhead unnecessary. cv_text null field provides clear distinction in database between manual and email-intake candidates.

---

## Response Format Consistency

| Option | Description | Selected |
|--------|-------------|----------|
| camelCase (match existing APIs) | Consistent with GET /jobs, POST /jobs responses | |
| snake_case (per spec) | Strictly match spec document | ✓ |
| Check with frontend, standardize later | Use spec now, unify in Phase 2 | |

**User's choice:** snake_case (per spec)
**Notes:** User verified existing API (GET /jobs, GET /candidates) returns snake_case. Spec is correct. POST /candidates should match existing pattern.

---

## Application Stage Assignment

| Option | Description | Selected |
|--------|-------------|----------|
| Always stage="new" | Simple, consistent with email intake | ✓ |
| First enabled stage in hiring_flow | Job-specific, flexible | |
| Recruiter chooses stage | Maximum flexibility, optional request field | |

**User's choice:** Always stage="new" (Recommended)
**Notes:** Simple rule, predictable, matches email-intake behavior. Recruiter can move candidate to other stages after creation if needed (separate endpoint).

---

## Claude's Discretion

- Exact Cloudflare R2 key generation and path structure
- File type validation strategy (MIME type vs extension check)
- Error message text and format details
- Email validation approach (simple string check sufficient per user)

---

## Deferred Ideas

- Email uniqueness scope (tenant-wide vs job-specific)
- Async CV file parsing for future phase
- File content inspection (magic bytes) beyond MIME type
- GET /jobs/list pagination and advanced filtering
- Bulk CSV import
- Duplicate detection toggle/opt-in

---

*Log recorded: 2026-03-26*
