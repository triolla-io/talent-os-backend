---
phase: 19-auth-api-endpoints
plan: "03"
subsystem: auth
tags: [invitation-service, magic-link, redis, onboarding, invitation-acceptance, session-cookie]
dependency_graph:
  requires: [19-01-SessionGuard, 19-02-AuthService, 18-JwtService, redis-ioredis, prisma-Invitation-model]
  provides: [InvitationService, POST-auth-onboarding, POST-auth-magic-link, GET-auth-magic-link-verify, GET-auth-invite-token, POST-auth-invite-token-accept, completeOnboarding]
  affects: [auth.controller, auth.service, auth.module, storage.service]
tech_stack:
  added: []
  patterns: [ioredis-magic-link-token, Redis-TTL-one-time-use, prisma-transaction-user-create, NestJS-FileInterceptor, R2-logo-upload]
key_files:
  created:
    - src/auth/invitation.service.ts
    - src/auth/invitation.service.spec.ts
  modified:
    - src/auth/auth.controller.ts
    - src/auth/auth.service.ts
    - src/auth/auth.service.spec.ts
    - src/auth/auth.module.ts
    - src/storage/storage.service.ts
decisions:
  - "Magic link tokens stored in Redis as ml:{token} → userId with TTL 3600s; one-time use via redis.del() on verify (D-06/D-07)"
  - "generateAndStoreMagicLink returns silently when email not found — prevents email enumeration (T-19-11)"
  - "uploadLogoFromBuffer added to StorageService with explicit key parameter to keep auth domain clean"
  - "verifyMagicLink uses @Res() (not passthrough) to allow manual redirect — res.redirect() incompatible with passthrough pattern"
metrics:
  duration_minutes: 8
  completed_date: "2026-04-11"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 5
---

# Phase 19 Plan 03: Onboarding, Magic Link, and Invitation Acceptance Endpoints Summary

InvitationService with Redis magic link storage, 5 new auth endpoints (onboarding completion, magic link request/verify, invitation view/accept), and R2 logo upload wired into AuthModule — complete new-user journey from invitation to authenticated session.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | InvitationService — magic link Redis tokens + invitation validation/acceptance | e2538bd | src/auth/invitation.service.ts, src/auth/invitation.service.spec.ts |
| 2 | AuthController extension — 5 new endpoints + AuthService.completeOnboarding + module wiring | bd1bce8 | src/auth/auth.controller.ts, src/auth/auth.service.ts, src/auth/auth.module.ts, src/storage/storage.service.ts |

## What Was Built

**InvitationService** (`src/auth/invitation.service.ts`):
- `generateAndStoreMagicLink(email)`: Looks up user by email; if not found returns silently (T-19-11: no enumeration). If Google-auth user, sends "use Google" email. Otherwise: generates `crypto.randomBytes(32).toString('hex')` token, stores `ml:{token} → userId` in Redis with `EX 3600`, calls `EmailService.sendMagicLinkEmail`.
- `verifyMagicLink(token)`: Reads `ml:{token}` from Redis. Returns null if not found. On success: `redis.del()` (T-19-12: one-time use), returns `{ userId }`.
- `validateInvite(token)`: Loads Invitation with Organization. Throws NotFoundException / ConflictException(INVITE_USED) / GoneException(INVITE_EXPIRED) for invalid states. Returns `{ org_name, role, email }`.
- `acceptInvite(token)`: Validates invite, runs `prisma.$transaction` to create User + mark invitation accepted. Issues session via `JwtService.signRefreshToken`. Returns `{ meResponse, sessionToken }`.

**AuthService extension** (`src/auth/auth.service.ts`):
- `completeOnboarding(session, orgName, logoFile?)`: Throws `ConflictException({ code: 'ONBOARDING_COMPLETE' })` if `onboardingCompletedAt != null` (T-19-15). Uploads logo to R2 if provided (key: `logos/{orgId}/{timestamp}.{ext}`). Updates org name + `onboardingCompletedAt`. Returns `{ success: true }`.

**StorageService extension** (`src/storage/storage.service.ts`):
- `uploadLogoFromBuffer(buffer, mimetype, key)`: Generic buffer upload to R2 with explicit key — used for org logos.

**AuthController extensions** (`src/auth/auth.controller.ts`):
- `POST /auth/onboarding`: `@UseGuards(SessionGuard)`, `@UseInterceptors(FileInterceptor('logo'))`, delegates to `authService.completeOnboarding`.
- `POST /auth/magic-link`: Public, always returns `{ success: true }` regardless of email existence.
- `GET /auth/magic-link/verify`: Public; validates token, sets session cookie, `res.redirect('/')`.
- `GET /auth/invite/:token`: Public; returns invite details.
- `POST /auth/invite/:token/accept`: Public; creates user, sets session cookie, returns MeResponse shape.

**AuthModule** updated: added `InvitationService` to providers, `StorageModule` to imports.

## Test Results

- 8 new unit tests for InvitationService: all passing
- 302 total tests passing across 26 suites
- 23 todo stubs (Wave 0 from Plan 01): unchanged
- Build: clean, 0 TypeScript errors

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Functionality] Added uploadLogoFromBuffer to StorageService**
- **Found during:** Task 2 — authService.completeOnboarding() needed R2 upload for org logos
- **Issue:** StorageService had no method suitable for uploading a raw buffer with a caller-specified key (existing methods were either for CV attachments or CV files with auto-generated keys)
- **Fix:** Added `uploadLogoFromBuffer(buffer, mimetype, key)` — generic buffer upload with explicit key parameter
- **Files modified:** src/storage/storage.service.ts
- **Commit:** bd1bce8

**2. [Rule 1 - Bug] auth.service.spec.ts constructor arity mismatch**
- **Found during:** Task 2 test run after adding `StorageService` parameter
- **Issue:** `new AuthService(mockPrisma, mockJwtService, mockConfigService)` — missing 4th argument after adding `storageService` dependency
- **Fix:** Added `mockStorageService` fixture and passed it as 4th argument; imported StorageService type
- **Files modified:** src/auth/auth.service.spec.ts
- **Commit:** bd1bce8

## Known Stubs

None — all endpoints are fully implemented. Auth controller spec Wave 0 stubs (14 `it.todo` entries) are intentional placeholders from Plan 01.

## Threat Surface Scan

New network endpoints introduced, all covered by the plan's threat model:
- `POST /auth/magic-link` — T-19-11: email enumeration mitigated (always returns 200)
- `GET /auth/magic-link/verify` — T-19-12: token replay mitigated (redis.del on successful lookup)
- `GET /auth/invite/:token` — T-19-13: 256-bit entropy token; ThrottlerModule rate limiting
- `POST /auth/invite/:token/accept` — T-19-14: role from DB (invitation.role), not from request body
- `POST /auth/onboarding` — T-19-15: double-submit protected via ConflictException

No new threat surface beyond what the plan's threat model covers.

## Self-Check: PASSED

Files created:
- src/auth/invitation.service.ts — FOUND
- src/auth/invitation.service.spec.ts — FOUND

Files modified:
- src/auth/auth.controller.ts — FOUND
- src/auth/auth.service.ts — FOUND
- src/auth/auth.module.ts — FOUND
- src/storage/storage.service.ts — FOUND

Commits:
- e2538bd — FOUND
- bd1bce8 — FOUND
