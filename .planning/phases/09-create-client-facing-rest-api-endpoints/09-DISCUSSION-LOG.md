# Phase 9: Create client-facing REST API endpoints - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the discussion.

**Date:** 2026-03-23
**Phase:** 09-create-client-facing-rest-api-endpoints
**Mode:** discuss
**Areas discussed:** CORS/global prefix, tenant resolution, module structure, ai_score computation, is_duplicate

## Gray Areas Identified

| Area | Decision | Source |
|------|----------|--------|
| CORS | `enableCors({ origin: 'http://localhost:5173' })` | Confident (codebase) |
| Global `/api` prefix | Add `setGlobalPrefix('api')` to `main.ts` | Confident (protocol mismatch) |
| Module structure | Separate module per resource (Candidates/Jobs/Applications) | Confident (follows WebhooksModule pattern) |
| `ai_score` | MAX score from `candidate_job_scores` via applications JOIN | **User confirmed** |
| `x-tenant-id` header | Ignore header — always use TENANT_ID env UUID | **User confirmed** |
| `is_duplicate` | Check unreviewed `duplicate_flags` rows | Confident (codebase) |

## User Confirmations

### ai_score computation
- **Options presented:** Max across all jobs / Latest score / null (no join)
- **User chose:** Max score across all jobs

### x-tenant-id header strategy
- **Options presented:** Ignore header (use TENANT_ID env) / Validate header equals UUID / Map string → DB lookup
- **User chose:** Ignore header, always use TENANT_ID env var

## No Corrections Required

All confident assumptions were accepted. Two user inputs collected on the genuinely ambiguous decisions.
