---
phase: quick
plan: 260322-kkx
subsystem: database
tags: [prisma, prisma7, postgresql, pg, adapter-pg]

# Dependency graph
requires: []
provides:
  - Prisma 7.5.0 installed with @prisma/adapter-pg for PostgreSQL
  - prisma.config.ts providing DATABASE_URL for Prisma CLI commands
  - PrismaService using adapter-based construction (Prisma 7 client engine)
  - schema.prisma datasource block without url field
affects: [all phases that use PrismaService, database migrations, prisma generate]

# Tech tracking
tech-stack:
  added:
    - prisma@7.5.0 (upgraded from 6.19.2)
    - "@prisma/client@7.5.0 (upgraded from 6.19.2)"
    - "@prisma/adapter-pg@7.5.0 (new - required by Prisma 7 client engine)"
    - pg@8.20.0 (new - PostgreSQL driver for adapter)
    - "@types/pg@8.20.0 (new - TypeScript types for pg)"
  patterns:
    - "Prisma 7 requires PrismaService to pass adapter in super() constructor - no more zero-arg PrismaClient"
    - "datasource URL lives in prisma/prisma.config.ts (defineConfig) for Prisma CLI, and in PrismaPg adapter for runtime"
    - "prisma generate must be run after any schema change to regenerate the client"

key-files:
  created:
    - prisma/prisma.config.ts
  modified:
    - prisma/schema.prisma
    - src/prisma/prisma.service.ts
    - package.json
    - CLAUDE.md
    - .planning/STATE.md

key-decisions:
  - "Prisma 7 dropped the native binary/library engine - only client (wasm) engine remains, requiring a driver adapter"
  - "Use @prisma/adapter-pg (official pg adapter) to connect PrismaClient to PostgreSQL in Prisma 7"
  - "prisma.config.ts uses singular 'datasource' property (not 'datasources') per @prisma/config type definition"

patterns-established:
  - "PrismaService constructor pattern: new PrismaPg({ connectionString: process.env.DATABASE_URL }) passed as adapter"

requirements-completed: []

# Metrics
duration: 18min
completed: 2026-03-22
---

# Quick Task 260322-kkx: Prisma 6 to 7 Upgrade Summary

**Prisma upgraded to 7.5.0 with @prisma/adapter-pg wiring, prisma.config.ts created for CLI config, and tsc clean with all unit tests passing**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-03-22T14:10:00Z
- **Completed:** 2026-03-22T14:28:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Upgraded prisma and @prisma/client from 6.19.2 to 7.5.0
- Created `prisma/prisma.config.ts` with `defineConfig` and DATABASE_URL for Prisma CLI operations
- Removed `url = env("DATABASE_URL")` from datasource block in schema.prisma
- Updated `PrismaService` to pass `@prisma/adapter-pg` adapter to `PrismaClient` constructor (required by Prisma 7)
- TypeScript compiles clean (tsc --noEmit exits 0)
- All 3 PrismaService unit tests pass

## Task Commits

1. **Task 1: Upgrade packages and create prisma.config.ts** - `f6d661a` (chore)
2. **Task 2: Fix PrismaService for Prisma 7 client engine** - `045d9a7` (fix)

**Plan metadata:** (included in task 2 commit)

## Files Created/Modified
- `prisma/prisma.config.ts` - New file: Prisma 7 defineConfig with DATABASE_URL for CLI
- `prisma/schema.prisma` - Removed `url = env("DATABASE_URL")` from datasource db block
- `src/prisma/prisma.service.ts` - Added constructor passing PrismaPg adapter to super()
- `package.json` - Bumped prisma/client to ^7.0.0, added @prisma/adapter-pg, pg, @types/pg
- `CLAUDE.md` - Updated constraint from Prisma 6 to Prisma 7
- `.planning/STATE.md` - Updated Tech Stack from Prisma 6 to Prisma 7

## Decisions Made
- **@prisma/adapter-pg chosen**: Prisma 7 removed the native binary (library) engine entirely. The only available engine is the wasm-based "client" engine, which mandates a driver adapter. `@prisma/adapter-pg` is the official PostgreSQL adapter.
- **datasource singular vs plural**: The `defineConfig` API uses `datasource` (singular), not `datasources`. TypeScript type check caught this.
- **PrismaPg constructor arg**: Uses `{ connectionString: ... }` not `{ url: ... }`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Prisma 7 client engine requires adapter — PrismaService constructor throws without it**
- **Found during:** Task 2 (Verify tsc and unit tests)
- **Issue:** Prisma 7 silently dropped the native binary/library engine. The new default "client" engine (wasm-based) throws `PrismaClientInitializationError` at construction unless an `adapter` or `accelerateUrl` is provided. `new PrismaService()` (and `new PrismaClient({})`) both fail.
- **Fix:** Installed `@prisma/adapter-pg`, `pg`, and `@types/pg`. Updated `PrismaService` to create a `PrismaPg` adapter in its constructor and pass it via `super({ adapter })`.
- **Files modified:** `src/prisma/prisma.service.ts`, `package.json`, `package-lock.json`
- **Verification:** All 3 unit tests pass; `tsc --noEmit` exits 0.
- **Committed in:** `045d9a7` (Task 2 commit)

**2. [Rule 1 - Bug] prisma.config.ts used wrong property name 'datasources' (plural)**
- **Found during:** Task 2 (tsc --noEmit)
- **Issue:** The plan specified `datasources: { db: { url: ... } }` but the `PrismaConfig` type uses `datasource` (singular) and takes a flat `{ url?, shadowDatabaseUrl? }` object — no named db key.
- **Fix:** Changed to `datasource: { url: process.env.DATABASE_URL! }`.
- **Files modified:** `prisma/prisma.config.ts`
- **Verification:** `tsc --noEmit` exits 0.
- **Committed in:** `045d9a7` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes were necessary to make Prisma 7 work correctly. The adapter requirement is a major Prisma 7 breaking change not reflected in the plan. No scope creep.

## Issues Encountered
- Prisma 7 made the wasm-based "client" engine the default (and only option) for `prisma-client-js`, requiring a driver adapter for all environments including tests. The `engineType = "library"` generator option no longer switches to the native binary engine — it was tried but had no effect at runtime.

## Next Phase Readiness
- Prisma 7 is fully operational: generate works, service compiles, tests pass
- Production DB connections require `DATABASE_URL` in environment (unchanged requirement)
- `prisma db migrate` and `prisma studio` use `prisma.config.ts` for the connection URL

---
*Phase: quick*
*Completed: 2026-03-22*
