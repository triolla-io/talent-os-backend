---
phase: 19-auth-api-endpoints
fixed_at: 2026-04-11T00:00:00Z
review_path: .planning/phases/19-auth-api-endpoints/19-REVIEW.md
iteration: 1
fix_scope: critical_warning
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 19: Code Review Fix Report

**Fixed at:** 2026-04-11T00:00:00Z
**Source review:** .planning/phases/19-auth-api-endpoints/19-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 8 (3 Critical + 5 Warning)
- Fixed: 8
- Skipped: 0

---

## Fixed Issues

### CR-01: Dev stub active in production when `GOOGLE_CLIENT_ID` is blank

**Files modified:** `src/auth/auth.service.ts`
**Commit:** f61bb5a
**Applied fix:** Changed the condition from `if (!clientId || !isProd)` to `if (isProd && !clientId) throw` followed by `if (!isProd)` for the stub block. In production with no `GOOGLE_CLIENT_ID`, the endpoint now immediately throws `UnauthorizedException('Google Sign-In is not configured')` instead of executing the unauthenticated stub. The dev stub is now only reachable when `NODE_ENV !== 'production'`. Note: `GOOGLE_CLIENT_ID` remains `z.string().optional()` in `env.ts` because the zod schema validates at startup before `NODE_ENV` is known; the runtime guard in `fetchGoogleUserInfo` is the enforcing layer.

---

### CR-02: Magic-link one-time-use has a TOCTOU race condition

**Files modified:** `src/auth/invitation.service.ts`
**Commit:** 9f592a4
**Applied fix:** Replaced the two-step `redis.get()` + `redis.del()` sequence with a single atomic `redis.getdel()` call (available in Redis 6.2+, which this stack's Redis 7 provides). This eliminates the window between GET and DEL where a concurrent request could read the same token.

---

### CR-03: No role value validation when creating invitations or changing roles

**Files modified:** `src/auth/team.service.ts`
**Commit:** 34dadb6
**Applied fix:** Added `BadRequestException` import and a role allowlist guard (`['admin', 'member', 'viewer']`) at the top of both `createInvitation` and `changeRole`. The `'owner'` role is explicitly excluded from both allowlists — invitations cannot grant owner status, and `changeRole` cannot assign owner either. Callers receive `{ code: 'INVALID_ROLE', message: 'Role must be one of: admin, member, viewer' }` on invalid input.

---

### WR-01: Logo upload has no MIME type or file-size guard

**Files modified:** `src/auth/auth.controller.ts`
**Commit:** d11dbf5
**Applied fix:** Added inline validation in `completeOnboarding` before calling `authService.completeOnboarding`. Allowed MIME types: `image/png`, `image/jpeg`, `image/webp`, `image/svg+xml`. Maximum size: 2 MB (2 * 1024 * 1024 bytes). Invalid type returns `{ code: 'INVALID_FILE_TYPE' }`; oversized file returns `{ code: 'FILE_TOO_LARGE' }`. Validation runs only when a logo file is present.

---

### WR-02: `generateOrgShortId` uses a non-transactional prisma instance inside a transaction

**Files modified:** `src/auth/auth.service.ts`
**Commit:** f61bb5a (same commit as CR-01 — both changes were in the same file)
**Applied fix:** Changed `generateOrgShortId(orgName, this.prisma)` to `generateOrgShortId(orgName, tx as unknown as PrismaService)` so the uniqueness check runs inside the transaction client. The `as unknown as PrismaService` cast is needed because `generateOrgShortId` currently accepts `PrismaService` typed strictly; the transaction client is structurally compatible for the `organization.findUnique` call used internally.

---

### WR-03: `acceptInvite` does not handle a user already existing for the invited email

**Files modified:** `src/auth/invitation.service.ts`
**Commit:** 9f592a4 (same commit as CR-02 — both changes were in the same file)
**Applied fix:** Added a `tx.user.findFirst` check at the top of the `$transaction` block in `acceptInvite`. If an existing user is found and `isActive === true`, throws `ConflictException({ code: 'ALREADY_MEMBER' })`. If found and `isActive === false` (soft-deleted), reactivates the user with `tx.user.update({ data: { isActive: true, role: invitation.role } })` and marks the invitation accepted — avoiding the raw Prisma P2002 unique-constraint error.

---

### WR-04: `verifyMagicLink` endpoint does not distinguish expired vs. never-existed

**Files modified:** `src/auth/invitation.service.ts`, `src/auth/auth.controller.ts`
**Commit:** 838edeb
**Applied fix:** Changed the return type of `verifyMagicLink` from `Promise<{ userId: string } | null>` to `Promise<{ userId: string } | 'not_found'>`. The service now returns the string literal `'not_found'` instead of `null`. The controller checks `result === 'not_found'` (strict equality on the discriminated union). A comment documents the known limitation: Redis gives no distinction between TTL-expired and never-existed keys; both map to `'not_found'`. The discriminated type creates the structural hook for a future shadow-key approach if the product needs different UI messages per case.

---

### WR-05: Email transport is created on every send — no connection reuse

**Files modified:** `src/auth/email.service.ts`
**Commit:** 0514145
**Applied fix:** Moved `nodemailer.createTransport(...)` from the per-call `createTransport()` method into the constructor. The transport is now stored as `private readonly transport: nodemailer.Transporter | null`. `SMTP_FROM` is also cached as `private readonly smtpFrom` to avoid repeated `configService.get` calls. `sendOrLog` now references `this.transport` and `this.smtpFrom` directly. When `SMTP_HOST` is absent, `this.transport` is `null` and the dev-log path is taken as before.

---

_Fixed: 2026-04-11T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
