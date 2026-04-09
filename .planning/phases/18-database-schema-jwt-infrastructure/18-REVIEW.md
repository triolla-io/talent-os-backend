---
phase: 18-database-schema-jwt-infrastructure
reviewed: 2026-04-09T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - prisma/migrations/20260409070941_rename_tenant_organization_fields/migration.sql
  - prisma/migrations/20260409071112_add_user_invitation_tables/migration.sql
  - src/auth/jwt.service.ts
  - src/auth/jwt.service.spec.ts
  - src/auth/auth.module.ts
  - src/auth/utils/generate-short-id.ts
  - prisma/schema.prisma
  - prisma/seed.ts
  - src/app.module.ts
  - src/config/env.ts
  - src/config/env.spec.ts
findings:
  critical: 1
  warning: 3
  info: 4
  total: 8
status: issues_found
---

# Phase 18: Code Review Report

**Reviewed:** 2026-04-09T00:00:00Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

This phase introduces three areas of change: (1) additive migrations that add columns to the `tenants` table and create `users`/`invitations` tables, (2) a `JwtService` built on `jose` with access/refresh token signing and verification, and (3) schema, seed, module, and env config updates to wire everything together.

The migrations are well-structured and correctly add CHECK constraints manually per project convention. The JWT service is correctly implemented using `jose` with `HS256` and properly encodes the secret as `Uint8Array`. The env validation is tight and correct.

The main concerns are: a circular foreign-key dependency in migration 2 that will fail on some PostgreSQL configurations; a semantic gap in `verify()` where the returned payload is not validated for required fields; a missing index on `invitations.token` for the verification lookup path; and a short-id generation function with a silent collision hazard at n=10.

---

## Critical Issues

### CR-01: Circular FK dependency in migration 2 will deadlock on strict constraint checking

**File:** `prisma/migrations/20260409071112_add_user_invitation_tables/migration.sql:46-55`

**Issue:** Migration 2 creates two FK constraints that form a circular dependency: `users.organization_id → tenants.id` (line 46) and `tenants.created_by_user_id → users.id` (line 55). The `users` table is inserted first, but the `tenants` row that owns the user must already exist before a user can be inserted (due to the NOT NULL + FK on `users.organization_id`). This means you cannot create the first user in an organization without deferrable constraints or a specific insert order, and the seed currently inserts the Organization first with no `created_by_user_id`, which avoids the cycle for seeding. However, in production code, any attempt to create a new organization alongside its first user atomically will fail unless both FKs are deferred.

Neither the migration nor the schema marks these constraints as `DEFERRABLE INITIALLY DEFERRED`. On PostgreSQL 16 with default constraint checking this will produce FK violation errors for the common "create org + first user in one transaction" flow required by the auth sign-up path.

**Fix:**
```sql
-- In migration 2, replace the two AddForeignKey statements with deferrable versions:
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "tenants" ADD CONSTRAINT "tenants_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;
```
Or restructure the sign-up flow to always insert tenant first (with `created_by_user_id = NULL`), then insert user, then backfill `created_by_user_id`. Document the constraint in the auth service.

---

## Warnings

### WR-01: `verify()` does not validate required payload fields — any JWT passes as JwtPayload

**File:** `src/auth/jwt.service.ts:30-37`

**Issue:** `jwtVerify` only checks signature and expiry. The cast `payload as unknown as JwtPayload` means a token missing `sub`, `org`, or `role` (e.g., a token issued by a different service with the same secret) will be accepted and returned as a valid `JwtPayload`. Downstream consumers that destructure `payload.sub` or `payload.role` without null-checking will silently receive `undefined`.

**Fix:**
```typescript
async verify(token: string): Promise<JwtPayload> {
  try {
    const { payload } = await jwtVerify(token, this.secret);
    const sub = payload['sub'];
    const org = payload['org'];
    const role = payload['role'];
    if (typeof sub !== 'string' || typeof org !== 'string' || typeof role !== 'string') {
      throw new Error('Missing required JWT claims');
    }
    return { sub, org, role: role as JwtPayload['role'] };
  } catch {
    throw new UnauthorizedException('Invalid or expired token');
  }
}
```

### WR-02: `generateOrgShortId` silently throws after 10 collisions — no caller-visible error handling guidance

**File:** `src/auth/utils/generate-short-id.ts:16-25`

**Issue:** The loop tries at most 10 sequential candidates (`prefix-01` through `prefix-10`) and then throws a plain `Error`. For common short organization names that map to the same 5-char prefix (e.g., "Triolla", "Trial", "Trio" all map to `triol` or `trial`), this limit will be reached in production at around 10 orgs with similar names. The error message mentions the org name, which could leak internal information if propagated to an API response unchecked. There is also no defense against timing attacks from sequential DB reads in a hot path.

More critically, since this is an `async` utility with no defined exception type, callers in Phase 19+ must remember to catch this error specifically and convert it to an appropriate HTTP response (409 Conflict, not 500). That contract is undocumented on the function.

**Fix:**
```typescript
/**
 * ...
 * @throws {Error} if no unique shortId could be generated within MAX_ATTEMPTS.
 *   Callers should catch and return HTTP 409 Conflict.
 */
export async function generateOrgShortId(name: string, prisma: PrismaService): Promise<string> {
  const MAX_ATTEMPTS = 99; // increase from 10; format supports up to 99
  const prefix = name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 5)
    .padEnd(5, 'x');

  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const shortId = `${prefix}-${String(i).padStart(2, '0')}`;
    const existing = await prisma.organization.findUnique({
      where: { shortId },
      select: { id: true },
    });
    if (!existing) return shortId;
  }

  throw new Error(`shortId namespace exhausted for prefix "${prefix}"`);
}
```
Note: the `VarChar(20)` column can hold `xxxxx-99` (8 chars), so 99 attempts fit. Also consider a random suffix approach to avoid sequential scanning.

### WR-03: `app.module.ts` connects to Redis without a fallback or error guard — silent failure if REDIS_URL is undefined at BullMQ init

**File:** `src/app.module.ts:40-44`

**Issue:** `configService.get<string>('REDIS_URL')` (not `getOrThrow`) is used inside `BullModule.forRootAsync`. If `REDIS_URL` is somehow missing at this point (despite env validation), the value passed to `connection.url` will be `undefined`, which BullMQ will silently accept and then fail at runtime when the first job is enqueued — far from the startup path. This is inconsistent with the pattern used in `JwtService` where `getOrThrow` is explicitly chosen (D-19).

**Fix:**
```typescript
useFactory: (configService: ConfigService) => ({
  connection: {
    url: configService.getOrThrow<string>('REDIS_URL'),
  },
}),
```

---

## Info

### IN-01: `short_id` column in migration 1 is nullable (`VARCHAR(20)`) but the seed hardcodes `shortId: 'triol-01'`

**File:** `prisma/migrations/20260409070941_rename_tenant_organization_fields/migration.sql:5`

**Issue:** `short_id` is added as nullable (`VARCHAR(20)` without `NOT NULL`), which is correct for the additive migration — existing rows get NULL. The Prisma schema reflects `shortId String? @unique`. However, Phase 19 org-creation logic will need to enforce non-null shortId at the application layer since the DB allows NULL. This is not a bug now, but it is a latent issue if a new org is created without going through `generateOrgShortId`. There is no DB-level default or trigger to prevent a NULL short_id on newly created orgs if the service code path is bypassed.

**Fix:** Document in the Phase 19 org-creation service that `shortId` must always be populated via `generateOrgShortId` before the Prisma `create` call. Consider adding a `NOT NULL` constraint in a future migration once all existing rows have been backfilled.

### IN-02: `env.spec.ts` does not test the new `JWT_SECRET` minimum-length validation

**File:** `src/config/env.spec.ts`

**Issue:** The `JWT_SECRET` field was added to `env.ts` with a `min(32)` constraint, but no test asserts that a short secret (e.g., fewer than 32 characters) is rejected by `envSchema.parse`. The existing test file exercises `DATABASE_URL`, `TENANT_ID`, and `NODE_ENV` but not the new field.

**Fix:**
```typescript
it('throws when JWT_SECRET is shorter than 32 characters', () => {
  expect(() => envSchema.parse({ ...validEnv, JWT_SECRET: 'tooshort' })).toThrow();
});

it('throws when JWT_SECRET is missing', () => {
  const { JWT_SECRET, ...rest } = validEnv;
  expect(() => envSchema.parse(rest)).toThrow();
});
```

### IN-03: `seed.ts` uses `process.env.DATABASE_URL!` non-null assertion without a guard

**File:** `prisma/seed.ts:4`

**Issue:** `new PrismaPg({ connectionString: process.env.DATABASE_URL! })` uses the non-null assertion operator. If the seed is run without `DATABASE_URL` set (e.g., outside the Docker environment), the error from the pg driver will be an obscure connection error rather than a clear "DATABASE_URL is not set" message. This is a developer experience issue, not a production bug, since the seed is not part of the application runtime.

**Fix:**
```typescript
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error('DATABASE_URL environment variable is required to run seed');
const adapter = new PrismaPg({ connectionString: dbUrl });
```

### IN-04: `jwt.service.spec.ts` uses `as any` to access `exp` claim on verified payload

**File:** `src/auth/jwt.service.spec.ts:68,80`

**Issue:** `(decoded as any).exp` works but bypasses type checking. The `exp` claim is a standard JWT registered claim that `jose` includes in the decoded payload but is absent from the `JwtPayload` interface. This is a test-only type cast, but it signals that `JwtPayload` is incomplete for callers that need to inspect standard claims like `exp`, `iat`.

**Fix:** Extend the `JwtPayload` interface with optional standard claims for completeness:
```typescript
export interface JwtPayload {
  sub: string;
  org: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  // Standard JWT claims (populated by jose on verify)
  exp?: number;
  iat?: number;
}
```
Then in the test: `const exp = decoded.exp as number;`

---

_Reviewed: 2026-04-09T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
