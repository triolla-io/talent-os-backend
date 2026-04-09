---
phase: 18-database-schema-jwt-infrastructure
plan: 01
subsystem: auth
tags: [jwt, jose, prisma, postgresql, schema, migration, organization, user, invitation]

# Dependency graph
requires:
  - phase: 17-production-deployment-readiness
    provides: "NestJS app with ConfigModule, PrismaModule, existing tenants table with v1.0 data"
provides:
  - "Organization model (renamed from Tenant, @@map('tenants'), DB table unchanged)"
  - "User and Invitation models with CHECK constraints and indexes"
  - "JwtService (jose, async sign/verify, HS256, sub/org payload)"
  - "AuthModule exporting JwtService"
  - "generateOrgShortId() utility"
  - "JWT_SECRET env validation (Zod .min(32)) in envSchema"
  - "Two applied migrations: rename_tenant_organization_fields + add_user_invitation_tables"
affects: [19-signup-endpoint, 20-admin-endpoints, 21-auth-middleware]

# Tech tracking
tech-stack:
  added: [jose@6.2.2]
  patterns:
    - "JWT payload uses sub/org/role (not userId/organizationId) — D-17 convention"
    - "ConfigService.getOrThrow() for fail-fast env validation at service construction"
    - "@@map preserves DB table name on Prisma model rename — zero-downtime schema evolution"
    - "Two-stage schema update: Organization fields first (Migration 1), then User/Invitation (Migration 2)"
    - "Manual CHECK constraints appended to migration SQL (Prisma does not support CHECK natively)"

key-files:
  created:
    - prisma/migrations/20260409070941_rename_tenant_organization_fields/migration.sql
    - prisma/migrations/20260409071112_add_user_invitation_tables/migration.sql
    - src/auth/jwt.service.ts
    - src/auth/jwt.service.spec.ts
    - src/auth/auth.module.ts
    - src/auth/utils/generate-short-id.ts
  modified:
    - prisma/schema.prisma
    - prisma/seed.ts
    - src/app.module.ts
    - src/config/env.ts
    - src/config/env.spec.ts
    - .env.example
    - docker-compose.dev.yml
    - package.json
    - package-lock.json

key-decisions:
  - "@@map('tenants') preserved on Organization model — DB table stays 'tenants', all v1.0 data intact"
  - "shortId is String? (nullable) on Organization — prevents NOT NULL violation on existing tenant rows"
  - "Two-stage migration: additive Organization fields first (D-29 DEFAULT NOW() on updated_at), then new tables"
  - "prisma migrate deploy (not migrate dev) used for non-interactive execution in worktree environment"
  - "createdByUserId marked @unique on Organization for one-to-one OrgCreator relation (Prisma requirement)"
  - "jose '-1s' used instead of '1ms' for expired token test — jose does not accept millisecond format"

patterns-established:
  - "AUTH-01: JwtService with async jose API — all future auth code uses this service"
  - "D-31: relation field name stays 'tenant' on all v1.0 models, only type changes to Organization"

requirements-completed: [UM-01, UM-02, UM-03, UM-04, AUTH-01]

# Metrics
duration: 35min
completed: 2026-04-09
---

# Phase 18 Plan 01: Database Schema + JWT Infrastructure Summary

**Prisma schema rename Tenant→Organization (DB unchanged), users/invitations tables with CHECK constraints, and async JwtService using jose with sub/org payload — 287 tests passing**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-04-09T07:09:00Z
- **Completed:** 2026-04-09T07:45:00Z
- **Tasks:** 8 (including Task 0 from base commit)
- **Files modified:** 14

## Accomplishments

- Renamed `model Tenant` to `model Organization` with `@@map("tenants")` preserved — DB table and all v1.0 data intact; all 9 downstream model relation types updated (D-31 comment on each)
- Two additive migrations applied: Migration 1 adds Organization fields (short_id, logo_url, is_active, created_by_user_id, updated_at with DEFAULT NOW()); Migration 2 creates users and invitations tables with 4 manual CHECK constraints
- JwtService implemented with jose@6.2.2 (async sign/verify, HS256, sub/org/role payload per D-17); AuthModule created; JWT_SECRET validated with Zod .min(32) in envSchema; 287 tests passing (6 new JWT + 281 pre-existing)

## Task Commits

1. **Task 0: Jest + Test Stub Setup** - `8476583` (feat — from base commit)
2. **Task 1: Rename Tenant→Organization + seed.ts** - `b6c01af` (feat)
3. **Task 2: Migration 1 — Organization fields** - `ff4a556` (feat)
4. **Task 3: D-30 Global find-replace** - no commit (zero occurrences)
5. **Task 4: User + Invitation models** - `f4ee47c` (feat)
6. **Task 5: Migration 2 — users + invitations tables** - `e4716b9` (feat)
7. **Task 6: JwtService + generateOrgShortId** - `f402643` (feat)
8. **Task 7: AuthModule + env + docker-compose** - `1a2a2c6` (feat)
9. **Task 8: Full test suite + env.spec fix** - `77ecdfd` (fix)

## Files Created/Modified

- `prisma/schema.prisma` - Organization (renamed Tenant), User, Invitation models
- `prisma/seed.ts` - prisma.organization.upsert() with shortId 'triol-01'
- `prisma/migrations/20260409070941_rename_tenant_organization_fields/migration.sql` - ADD COLUMN for Organization fields
- `prisma/migrations/20260409071112_add_user_invitation_tables/migration.sql` - CREATE TABLE users and invitations + 4 CHECK constraints
- `src/auth/jwt.service.ts` - JwtService with jose async sign/verify
- `src/auth/jwt.service.spec.ts` - 6 JWT unit tests (modified: '-1s' expiry fix)
- `src/auth/auth.module.ts` - AuthModule exporting JwtService
- `src/auth/utils/generate-short-id.ts` - generateOrgShortId() utility
- `src/app.module.ts` - Added AuthModule import
- `src/config/env.ts` - Added JWT_SECRET .min(32) to envSchema
- `src/config/env.spec.ts` - Added JWT_SECRET to validEnv fixture
- `.env.example` - Added JWT_SECRET section with generation hint
- `docker-compose.dev.yml` - JWT_SECRET in api and worker env blocks
- `package.json` / `package-lock.json` - jose@6.2.2 added

## Decisions Made

- **@@map("tenants") preserved**: Renaming the Prisma model to Organization while keeping the DB table as "tenants" is zero-risk — no data migration, no FK changes.
- **shortId nullable**: Must be `String?` not `String` to avoid NOT NULL constraint violation on the existing tenant row during Migration 1.
- **Two-stage migration**: Organization fields first, then User/Invitation — prevents Prisma validation errors from forward-references.
- **prisma migrate deploy**: Used instead of `prisma migrate dev` (requires interactive TTY) since worktree has no own node_modules; deploy mode applies pending migrations non-interactively.
- **createdByUserId @unique**: Prisma requires @unique on the FK field for one-to-one relations ("OrgCreator") — added during schema validation fix.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed '1ms' invalid jose expiry format in jwt.service.spec.ts**
- **Found during:** Task 6 (JwtService implementation)
- **Issue:** jose does not accept millisecond format `'1ms'`; throws "Invalid time period format"
- **Fix:** Changed test to use `'-1s'` (already-expired token) which is a valid jose format
- **Files modified:** `src/auth/jwt.service.spec.ts`
- **Verification:** All 6 JWT tests pass after change
- **Committed in:** `f402643` (Task 6 commit)

**2. [Rule 1 - Bug] Fixed TypeScript cast in jwt.service.ts sign() method**
- **Found during:** Task 7 (TypeScript build verification)
- **Issue:** `payload as Record<string, unknown>` fails TS2352; JwtPayload and Record<string, unknown> don't overlap
- **Fix:** Changed to `payload as unknown as Record<string, unknown>` (double assertion pattern)
- **Files modified:** `src/auth/jwt.service.ts`
- **Verification:** `nest build` exits 0
- **Committed in:** `1a2a2c6` (Task 7 commit)

**3. [Rule 1 - Bug] Fixed env.spec.ts validEnv missing JWT_SECRET fixture**
- **Found during:** Task 8 (full test suite run)
- **Issue:** envSchema now requires JWT_SECRET; existing validEnv fixture doesn't include it → 2 test failures
- **Fix:** Added `JWT_SECRET: 'test-jwt-secret-for-unit-tests-minimum-32chars'` to validEnv
- **Files modified:** `src/config/env.spec.ts`
- **Verification:** All 287 tests pass
- **Committed in:** `77ecdfd` (Task 8 commit)

**4. [Rule 1 - Bug] Added @unique to createdByUserId on Organization model**
- **Found during:** Task 4 (schema validation)
- **Issue:** Prisma P1012 — one-to-one relation requires @unique on FK field
- **Fix:** Added `@unique` to `createdByUserId` field on Organization model
- **Files modified:** `prisma/schema.prisma`
- **Verification:** `npx prisma validate` exits cleanly
- **Committed in:** `f4ee47c` (Task 4 commit)

---

**Total deviations:** 4 auto-fixed (4 × Rule 1 - Bug)
**Impact on plan:** All fixes were straightforward correctness issues. No scope creep. Zero new features added beyond plan specification.

## Issues Encountered

- `prisma migrate dev --create-only` requires interactive TTY — not available in worktree/CI environments. Resolved by writing migration SQL manually (matching exactly what Prisma would generate) and applying with `prisma migrate deploy`.
- Docker containers started but API/worker containers stopped (no `.env` with JWT_SECRET). Postgres container remained healthy, sufficient for migration operations.

## Known Stubs

None — all models, migrations, and services are fully wired. No placeholder data or TODO comments in production code.

## Threat Surface Scan

No new network endpoints introduced. All changes are:
- Prisma schema + DB migrations (new tables — no API surface)
- JwtService (internal service, not exposed via HTTP in this plan)
- Env validation extension

All threat model mitigations from the plan's STRIDE register are implemented:
- T-18-01: JWT_SECRET .min(32) validated at startup via Zod ✓
- T-18-02: users.role CHECK constraint applied ✓
- T-18-03: invitations.token UNIQUE constraint applied ✓
- T-18-04: users.auth_provider CHECK constraint applied ✓
- T-18-05: invitations.role CHECK (excludes 'owner') applied ✓

## Next Phase Readiness

- Phase 19 (signup endpoint): Organization, User models available; JwtService injectable via AuthModule; generateOrgShortId() ready for org creation
- Phase 20 (admin endpoints): Invitation model with idx_invitations_org_email_status index ready
- Phase 21 (auth middleware): JwtService.verify() available; JwtPayload interface with sub/org/role defined

---
*Phase: 18-database-schema-jwt-infrastructure*
*Completed: 2026-04-09*
