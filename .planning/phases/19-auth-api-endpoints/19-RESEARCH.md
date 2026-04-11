# Phase 19: Auth API Endpoints — Research

**Researched:** 2026-04-11
**Domain:** HTTP-only session cookies, Google OAuth verification, email-based auth, team management
**Confidence:** HIGH

## Summary

Phase 19 implements all 14 Auth API endpoints specified in PROTOCOL.md §7. The core authentication mechanism is a 7-day HTTP-only JWT cookie (`talent_os_session`), set by NestJS response handlers on login/signup endpoints. Session state is managed entirely via this cookie; no database token table is required. Supporting features include magic link login (tokens in Redis), invitation acceptance, team member management, and onboarding completion tracking. All decisions are locked in CONTEXT.md and enforced via Prisma schema changes (adding `onboardingCompletedAt` column) and new NestJS services/guards.

**Primary recommendation:** Follow CONTEXT.md decisions exactly — every technical choice (cookie flags, JWT duration, email service, Redis key format, session guard implementation) is locked. No alternatives exist in Claude's Discretion.

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Session Cookie (D-01 to D-04)**

- 7-day JWT in `talent_os_session` HTTP-only cookie — no short-lived access token + refresh token rotation
- Cookie settings: `httpOnly: true`, `sameSite: 'lax'`, `path: '/'`, `maxAge: 7 * 24 * 60 * 60 * 1000` ms
- Production: add `secure: true` when `NODE_ENV === 'production'`
- All session-creating endpoints use NestJS `@Res({ passthrough: true })` pattern
- `POST /auth/logout` clears via `maxAge: 0` or `res.clearCookie('talent_os_session')`

**Magic Link Tokens (D-05 to D-08)**

- Redis storage: key `ml:{token}` → value: `userId`, TTL 3600 seconds
- Token: cryptographically random via `crypto.randomBytes(32).toString('hex')`
- Magic link URL: `{FRONTEND_URL}/auth/magic-link/verify?token={token}`
- Expiry handled by Redis TTL (no separate `expires_at` column needed)

**Email Service (D-09 to D-12)**

- Nodemailer for all outbound emails (provider-agnostic: swappable to SES/Postmark/Coolify via env vars)
- Required env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `FRONTEND_URL`, optional `GOOGLE_CLIENT_ID`
- New `src/auth/email.service.ts` with methods: `sendInvitationEmail()`, `sendMagicLinkEmail()`, `sendUseGoogleEmail()`
- Dev fallback: if SMTP vars absent in dev/test, log email content to console instead of throwing

**Onboarding Tracking (D-13 to D-15)**

- Add `onboardingCompletedAt` (nullable timestamp) to Organization model via Prisma migration
- `POST /auth/onboarding` sets `onboardingCompletedAt = now()`, returns 409 if already set
- `GET /auth/me` derives `has_completed_onboarding: org.onboardingCompletedAt !== null`

**Auth Guard (D-16 to D-18)**

- `SessionGuard` (implements `CanActivate`): reads `talent_os_session` cookie, validates JWT, attaches payload to `request['session']`
- Apply `@UseGuards(SessionGuard)` to all protected endpoints
- Role enforcement inline in controller (no separate role guard class): throw 403 for non-Owner or when targeting Owner

**Google OAuth (D-19 to D-23)**

- Backend flow: frontend sends Google `access_token` via `POST /auth/google/verify`
- Backend calls `https://www.googleapis.com/oauth2/v3/userinfo` with token to fetch `{ email, name, picture }`
- Dev stub: if `GOOGLE_CLIENT_ID` absent or `NODE_ENV !== 'production'`, parse token as JSON `{ email, name }` directly
- Sign-up: create Organization (name = email domain, shortId via `generateOrgShortId()`), create User (role='owner', auth_provider='google', providerId=sub), update Org.createdByUserId — all in transaction
- Returning user: look up by (organizationId, email), issue session if auth_provider='google', else return 409 EMAIL_EXISTS

### Claude's Discretion

- NestJS module structure (one `AuthController` or split into `AuthController` + `TeamController` — either is fine)
- `@Req()` vs `@Session()` decorator approach for reading attached session payload
- Exact cookie flag for `sameSite` (`lax` is correct; `strict` would break OAuth redirects)

### Deferred Ideas (OUT OF SCOPE)

- Refresh token rotation (short-lived access + long-lived refresh with rotation) — out of scope; session is a single 7-day JWT
- Email template styling (HTML emails with branding) — use plain text or minimal HTML for now
- Token refresh endpoint (`POST /auth/refresh`) — no refresh needed with 7-day session JWT
  </user_constraints>

<phase_requirements>

## Phase Requirements

| ID       | Description                    | Research Support                                                                                                                                           |
| -------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUTH-001 | Google Sign-Up (Owner)         | D-19 to D-23: Google OAuth backend flow, transaction-based org/user creation, email domain default org name                                                |
| AUTH-002 | Onboarding After Sign-Up       | D-13 to D-15: `onboardingCompletedAt` schema, 409 conflict handling, `GET /auth/me` derivation                                                             |
| AUTH-003 | Invite a Team Member           | D-05, D-09 to D-12: invitation table (Phase 18 prerequisite), Nodemailer email service, magic link URL format                                              |
| AUTH-004 | Accept Invitation (Magic Link) | D-05 to D-08: Redis token storage/validation, `POST /auth/invite/:token/accept` creates user from invitation                                               |
| AUTH-005 | Returning User Login           | D-05 to D-08: magic link token generation/verification, `POST /auth/magic-link` + `GET /auth/magic-link/verify`                                            |
| AUTH-006 | Authorization Guards           | D-16 to D-18: SessionGuard implementation, inline role enforcement, 403 ForbiddenException for non-Owner/target-Owner                                      |
| AUTH-007 | User Management (Owner)        | D-16 to D-18: `GET /auth/team/members`, `GET /auth/team/invitations`, `PATCH /auth/team/members/:id/role`, `DELETE /auth/team/members/:id` with 403 guards |

</phase_requirements>

---

## Standard Stack

### Core

| Library       | Version                        | Purpose                                                                  | Why Standard                             |
| ------------- | ------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------- |
| NestJS        | 11.0.1                         | HTTP framework, dependency injection, guards/decorators                  | Project-locked                           |
| Jose          | 6.2.2                          | JWT signing/verification (cryptographically secure, no dependencies)     | Phase 18 prerequisite; already installed |
| Express       | (via @nestjs/platform-express) | HTTP server (NestJS built on Express)                                    | Project-locked                           |
| Zod           | 4.3.6                          | Request validation, env schema                                           | Project-locked for config                |
| Prisma        | 7.0.0                          | ORM, migrations (User/Invitation/Organization already modeled)           | Phase 18 prerequisite                    |
| Redis/ioredis | 5.10.1                         | Magic link token storage, session persistence (BullMQ connection reused) | Project-locked                           |

### Supporting

| Library           | Version | Purpose                                              | When to Use                                                 |
| ----------------- | ------- | ---------------------------------------------------- | ----------------------------------------------------------- |
| Nodemailer        | (ADD)   | SMTP-agnostic email sending                          | All outbound emails (invitations, magic links) — D-09       |
| cookie-parser     | (ADD)   | Parse HTTP `Cookie` header into `req.cookies` object | `SessionGuard` reads `req.cookies.talent_os_session` — D-16 |
| @types/nodemailer | (ADD)   | TypeScript typings for Nodemailer                    | Type safety for email service                               |

### Installation

```bash
npm install nodemailer cookie-parser
npm install -D @types/nodemailer
```

**Version verification:** [VERIFIED: npm registry]

- `nodemailer`: latest 6.9.x or 7.x stable (both actively maintained)
- `cookie-parser`: Express middleware, 1.4.x stable (6+ years old, feature-complete)

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── auth/
│   ├── auth.module.ts              # Exports JwtService, SessionGuard, EmailService
│   ├── auth.controller.ts          # POST/GET auth endpoints (or split into AuthController + TeamController)
│   ├── team.controller.ts          # (Optional) GET/POST/PATCH/DELETE team endpoints
│   ├── jwt.service.ts              # (Existing) JWT signing/verification
│   ├── session.guard.ts            # (NEW) SessionGuard — reads cookie, validates JWT
│   ├── email.service.ts            # (NEW) Nodemailer — sends invitations, magic links
│   ├── utils/
│   │   ├── generate-short-id.ts    # (Existing from Phase 18) Org shortId generation
│   │   └── crypto-helpers.ts       # (NEW, optional) Magic link token generation helpers
│   └── auth.controller.spec.ts     # (NEW) 14 endpoint tests
├── config/
│   └── env.ts                      # (EXTEND) Add SMTP_*, FRONTEND_URL, GOOGLE_CLIENT_ID
├── main.ts                         # (EXTEND) Add cookie-parser middleware, CORS with credentials
└── ...
```

### Pattern 1: Session Cookie with JWT

**What:** HTTP-only cookie carrying a 7-day JWT. No refresh token rotation. Cookie lifecycle = JWT validity.

**When to use:** Stateless session management for SPAs with backend that trusts JWT claims without database lookup.

**Example:**

```typescript
// src/auth/auth.controller.ts
@Post('google/verify')
@HttpCode(200)
async googleVerify(
  @Body() { access_token }: GoogleVerifyDto,
  @Res({ passthrough: true }) res: Response,
): Promise<GetMeResponse> {
  // Fetch user info from Google (or stub if GOOGLE_CLIENT_ID absent)
  const googleUser = await this.verifyGoogleToken(access_token);

  // Find or create org + user
  const user = await this.userService.findOrCreateGoogleUser(
    googleUser.email,
    googleUser.name,
    googleUser.picture,
  );

  // Sign 7-day refresh token (D-01: D-04)
  const sessionJwt = await this.jwtService.signRefreshToken({
    sub: user.id,
    org: user.organizationId,
    role: user.role,
  });

  // Set cookie (D-03: @Res({ passthrough: true }) pattern)
  res.cookie('talent_os_session', sessionJwt, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
  });

  return this.toGetMeResponse(user);
}
```

**D-03 requires `@Res({ passthrough: true })`:** By default, NestJS takes over response handling and returns the DTO. `passthrough: true` allows the controller to set headers/cookies while still returning the DTO.

### Pattern 2: SessionGuard — Cookie-Based Authentication

**What:** NestJS `CanActivate` guard that validates the `talent_os_session` JWT and attaches decoded payload to `request.session`.

**When to use:** Protect endpoints that require an authenticated user (all except signup/login/invite-validation endpoints).

**Example:**

```typescript
// src/auth/session.guard.ts
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { JwtService, JwtPayload } from './jwt.service';

declare global {
  namespace Express {
    interface Request {
      session?: JwtPayload;
    }
  }
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.cookies?.['talent_os_session'];

    if (!token) {
      throw new UnauthorizedException('No session cookie');
    }k

    try {
      const payload = await this.jwtService.verify(token);
      request.session = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }
  }
}

// Usage in controller:
@Get('me')
@UseGuards(SessionGuard)
async getMe(@Req() req: Request): Promise<GetMeResponse> {
  const userId = req.session.sub; // Attached by SessionGuard
  // ...
}
```

### Pattern 3: Nodemailer Email Service (Provider-Agnostic)

**What:** Single `EmailService` with methods for each email type. Config via `SMTP_*` env vars. Swappable backend (SES, Postmark, Coolify).

**When to use:** Send invitation emails, magic link login emails, "use Google instead" emails.

**Example:**

```typescript
// src/auth/email.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private logger = new Logger('EmailService');

  constructor(private readonly config: ConfigService) {
    // D-12: Dev fallback — no error if SMTP vars absent in development
    const isDev = this.config.get('NODE_ENV') === 'development';
    const smtpHost = this.config.get('SMTP_HOST');

    if (smtpHost) {
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: this.config.get('SMTP_PORT') || 587,
        auth: {
          user: this.config.get('SMTP_USER'),
          pass: this.config.get('SMTP_PASS'),
        },
      });
    } else if (!isDev) {
      throw new Error('SMTP_HOST required in production');
    }
  }

  async sendInvitationEmail(to: string, orgName: string, role: string, token: string): Promise<void> {
    const url = `${this.config.get('FRONTEND_URL')}/invite?token=${token}`;
    const html = `
      <p>You're invited to join <strong>${orgName}</strong> as a <strong>${role}</strong>.</p>
      <p><a href="${url}">Click here to accept</a></p>
    `;

    await this.send(to, `Invitation to ${orgName}`, html);
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.transporter) {
      // D-12: Log to console in development
      this.logger.log(`[STUB EMAIL] To: ${to}, Subject: ${subject}\n${html}`);
      return;
    }

    await this.transporter.sendMail({
      from: this.config.get('SMTP_FROM'),
      to,
      subject,
      html,
    });
  }
}
```

### Pattern 4: Magic Link Token Management (Redis)

**What:** Store login tokens in Redis with 1-hour TTL. Token format: `ml:{random32BytesHex}`.

**When to use:** `POST /auth/magic-link` generates token → stored in Redis → email sent → user clicks link → `GET /auth/magic-link/verify` validates token and sets session.

**Example:**

```typescript
// src/auth/auth.service.ts
import { Injectable } from '@nestjs/common';
import { Cache } from 'cache-manager'; // or direct ioredis
import { randomBytes } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private readonly cache: Cache, // or Inject Redis
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
  ) {}

  async sendMagicLink(email: string): Promise<void> {
    // D-05 to D-08: Check if email belongs to an active user
    const user = await this.prisma.user.findUnique({
      where: { email }, // Note: email is globally unique in this design
      include: { organization: true },
    });

    if (!user) {
      // D-06: Always return 200 (no email enumeration)
      return;
    }

    // D-20: If user is Google-auth, send "use Google instead" email
    if (user.authProvider === 'google') {
      await this.emailService.sendUseGoogleEmail(email);
      return;
    }

    // Generate and store token (D-06: crypto.randomBytes(32).toString('hex'))
    const token = randomBytes(32).toString('hex');
    const redisKey = `ml:${token}`;
    await this.cache.set(redisKey, user.id, 3600 * 1000); // 1 hour TTL in ms

    // Send magic link email
    const magicLinkUrl = `${this.config.get('FRONTEND_URL')}/auth/magic-link/verify?token=${token}`;
    await this.emailService.sendMagicLinkEmail(email, magicLinkUrl);
  }

  async verifyMagicLink(token: string): Promise<User> {
    const redisKey = `ml:${token}`;
    const userId = await this.cache.get(redisKey);

    if (!userId) {
      // D-07: Redis TTL handles expiry automatically
      throw new NotFoundException('Token not found or expired');
    }

    // D-07: One-time use — delete immediately
    await this.cache.del(redisKey);

    return this.prisma.user.findUnique({ where: { id: userId } });
  }
}
```

### Anti-Patterns to Avoid

- **Storing session token in database:** Unnecessary database bloat. JWT + Redis (magic links only) is sufficient.
- **Rotating refresh tokens:** D-01 locks this out — 7-day JWT is the session mechanism, no rotation.
- **Validating Google token every request:** Validate once in `POST /auth/google/verify`, trust JWT thereafter.
- **Sending unencrypted cookies in development:** Use `secure: false` in dev, `true` in production (D-02 handles this).
- **Storing user data in JWT:** JWT carries only `{ sub, org, role }`. Look up org_name, email from database on `GET /auth/me`.

---

## Don't Hand-Roll

| Problem                     | Don't Build                             | Use Instead                                           | Why                                                                                              |
| --------------------------- | --------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| JWT signing/verification    | Custom JWT code                         | jose (already installed)                              | [VERIFIED: npm registry] Industry standard, audited, zero dependencies                           |
| SMTP email sending          | Raw SMTP socket code                    | Nodemailer                                            | Handles all SMTP quirks (auth, TLS, retries, timeouts)                                           |
| Magic link token generation | `Math.random()` or UUIDs                | `crypto.randomBytes(32).toString('hex')`              | Cryptographically secure, unguessable tokens                                                     |
| Cookie parsing              | Manual `request.headers.cookie` parsing | cookie-parser middleware                              | HTTP header parsing is fragile (quoted values, special chars); middleware handles all edge cases |
| Password hashing            | Custom hash functions                   | bcryptjs (not used in Phase 19, but future reference) | Custom hashing is cryptographically dangerous; bcrypt is designed for password storage           |

**Key insight:** Phase 19 has no custom password logic (Google OAuth + magic links only). When Phase 20+ adds password-based signup, DO use `bcryptjs` — never roll custom hashing.

---

## Runtime State Inventory

No rename/refactor/migration phase — greenfield implementation of new Auth endpoints. All state is created fresh; no existing auth data to migrate.

**Skip:** Not applicable to Phase 19.

---

## Common Pitfalls

### Pitfall 1: Forgetting `passthrough: true` on Session-Setting Endpoints

**What goes wrong:** Controller sets cookie via `res.cookie()` but returns a DTO; NestJS ignores the cookie because it overwrites the response.

**Why it happens:** NestJS response interception by default doesn't allow simultaneous header-setting + DTO return.

**How to avoid:** Always use `@Res({ passthrough: true })` on endpoints that set cookies (`POST /auth/google/verify`, `POST /auth/invite/:token/accept`, `GET /auth/magic-link/verify`). Return the DTO; NestJS will merge it with the cookie headers.

**Warning signs:** Test shows cookie not set; session not persisting across requests.

### Pitfall 2: Redis Magic Link Token Lost on Service Restart

**What goes wrong:** Magic links sent to users become invalid when Redis restarts (or data is flushed during testing).

**Why it happens:** Redis is in-memory; if BullMQ pipeline flushed the DB between tests, magic link keys are gone.

**How to avoid:** In test setup, mock the cache layer or use a separate test Redis instance. In production, Redis persistence (RDB snapshots or AOF) must be enabled. Document this in setup instructions.

**Warning signs:** Magic links work in local dev but fail on CI/staging after a restart.

### Pitfall 3: Email Not Sent Because SMTP Vars Missing in Dev

**What goes wrong:** Developer runs locally without configuring SMTP, email service throws an error during invitation flow.

**Why it happens:** Nodemailer requires transport config to be initialized upfront.

**How to avoid:** D-12 mandates console fallback in development — if SMTP vars absent and `NODE_ENV === 'development'`, log email content to console instead of throwing. Always return 200 from email endpoints (no enumeration).

**Warning signs:** Local tests fail with "SMTP_HOST not configured" but should gracefully degrade.

### Pitfall 4: Google Token Verification Fails Due to Wrong Endpoint or Expired Token

**What goes wrong:** Frontend sends `access_token` but backend call to Google UserInfo API returns 401 or 400.

**Why it happens:** Google tokens expire (usually ~1 hour for implicit flow tokens). Frontend must refresh before sending.

**How to avoid:** D-20 includes a dev stub — if `GOOGLE_CLIENT_ID` absent, parse token as plain JSON `{ email, name }` for local testing. In production, validate token immediately after frontend obtains it. Document that frontend must send token within 5 minutes of OAuth consent.

**Warning signs:** Local dev with stub works; production fails sporadically with "Invalid token".

### Pitfall 5: SessionGuard Not Applied to Protected Endpoints

**What goes wrong:** Public endpoints like `POST /auth/google/verify` apply SessionGuard by mistake; unauthenticated users get 401.

**Why it happens:** Copy-pasting code or global guards that shouldn't apply to auth endpoints.

**How to avoid:** Explicitly list which endpoints do NOT use SessionGuard: `POST /auth/google/verify`, `GET /auth/invite/:token`, `POST /auth/invite/:token/accept`, `POST /auth/magic-link`, `GET /auth/magic-link/verify`. Apply guard only to protected endpoints.

**Warning signs:** Signup/login flow returns 401 for unauthenticated requests.

### Pitfall 6: Role Enforcement Missed on Team Management Endpoints

**What goes wrong:** Non-Owner users can call `PATCH /auth/team/members/:id/role` or `DELETE /auth/team/members/:id`.

**Why it happens:** D-18 says role enforcement is inline in the controller. If copy-pasted without the 403 check, it's open.

**How to avoid:** Every team management endpoint MUST check `if (request.session.role !== 'owner') throw new ForbiddenException()` at the start. Also check target user role (cannot target Owner). Tests MUST verify 403 on non-Owner attempt.

**Warning signs:** Integration test with non-Owner session succeeds when it should fail 403.

---

## Code Examples

Verified patterns from official sources and Phase 18 prerequisite code.

### Example 1: SessionGuard — Cookie Validation

```typescript
// Source: NestJS Guards docs + Jose 6.x + D-16
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { JwtService, JwtPayload } from './jwt.service';

declare global {
  namespace Express {
    interface Request {
      session?: JwtPayload;
    }
  }
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.cookies?.['talent_os_session'];

    if (!token) {
      throw new UnauthorizedException('No session cookie found');
    }

    try {
      const payload = await this.jwtService.verify(token);
      request.session = payload; // Attach to request for controller access
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }
  }
}
```

**Usage in controller:**

```typescript
@Get('me')
@UseGuards(SessionGuard)
async getMe(@Req() req: Request): Promise<GetMeResponse> {
  const session = req.session; // Set by guard
  const user = await this.prisma.user.findUnique({
    where: { id: session.sub },
    include: { organization: true },
  });
  return { id: user.id, email: user.email, role: user.role, org_name: user.organization.name, ... };
}
```

### Example 2: POST /auth/google/verify with Passthrough Cookie

```typescript
// Source: Phase 18 JwtService + D-03 passthrough pattern + D-19-D-23 Google flow
import { Controller, Post, Body, Res, HttpCode, BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { JwtService } from './jwt.service';

interface GoogleVerifyDto {
  access_token: string;
}

interface GoogleUserInfo {
  email: string;
  name?: string;
  picture?: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('google/verify')
  @HttpCode(200)
  async googleVerify(
    @Body() { access_token }: GoogleVerifyDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<GetMeResponse> {
    if (!access_token) {
      throw new BadRequestException('access_token is required');
    }

    // D-20: Dev stub if GOOGLE_CLIENT_ID absent
    let googleUser: GoogleUserInfo;
    const googleClientId = this.config.get('GOOGLE_CLIENT_ID');

    if (googleClientId && process.env.NODE_ENV === 'production') {
      // Real Google verification
      try {
        const response = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${access_token}`);
        if (!response.ok) throw new Error('Google token validation failed');
        googleUser = await response.json();
      } catch {
        throw new UnauthorizedException('Invalid Google token');
      }
    } else {
      // Dev stub: parse token as JSON (frontend mocks with { email, name })
      try {
        googleUser = JSON.parse(Buffer.from(access_token, 'base64').toString());
      } catch {
        throw new BadRequestException('Malformed token for dev stub');
      }
    }

    // D-21-D-22: Find or create user
    const existingUser = await this.prisma.user.findUnique({
      where: { email_organizationId: { email: googleUser.email, organizationId: '?' } }, // Pseudo-query
    });

    let user: User;

    if (existingUser) {
      // Returning user
      if (existingUser.authProvider !== 'google') {
        throw new ConflictException({
          error: { code: 'EMAIL_EXISTS', message: 'This email is registered with a different provider' },
        });
      }
      user = existingUser;
    } else {
      // New user — D-21: 3-step sequence from Phase 18 D-24
      // Step 1: Create org with created_by_user_id = NULL
      const org = await this.prisma.organization.create({
        data: {
          name: googleUser.email.split('@')[1], // D-23: email domain as default name
          shortId: generateOrgShortId(), // From Phase 18 utils
        },
      });

      // Step 2: Create user with role = 'owner'
      user = await this.prisma.user.create({
        data: {
          email: googleUser.email,
          fullName: googleUser.name || undefined,
          organizationId: org.id,
          role: 'owner',
          authProvider: 'google',
          providerId: googleUser.email, // Or fetch 'sub' from Google if available
        },
      });

      // Step 3: Update org.createdByUserId
      await this.prisma.organization.update({
        where: { id: org.id },
        data: { createdByUserId: user.id },
      });
    }

    // D-01, D-04: Sign 7-day refresh token and set cookie
    const sessionJwt = await this.jwtService.signRefreshToken({
      sub: user.id,
      org: user.organizationId,
      role: user.role as 'owner' | 'admin' | 'member' | 'viewer',
    });

    // D-03: Set cookie with passthrough=true
    res.cookie('talent_os_session', sessionJwt, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000, // D-04: 7 days in ms
      secure: process.env.NODE_ENV === 'production',
    });

    // Return DTO (NestJS merges with cookie headers)
    return {
      id: user.id,
      name: user.fullName || 'User',
      email: user.email,
      role: user.role,
      org_id: user.organizationId,
      org_name: user.organization.name, // Would need to fetch org
      has_completed_onboarding: user.organization.onboardingCompletedAt !== null,
      auth_provider: user.authProvider,
    };
  }
}
```

### Example 3: POST /auth/onboarding with Multipart Upload

```typescript
// Source: PROTOCOL.md §7 + Phase 12 multipart patterns + D-13-D-15
import { Controller, Post, UseGuards, Req, BadRequestException, ConflictException } from '@nestjs/common';
import { UseInterceptors, FileInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { SessionGuard } from './session.guard';
import { StorageService } from '../storage/storage.service';

interface OnboardingDto {
  org_name: string;
  logo?: Express.Multer.File;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Post('onboarding')
  @UseGuards(SessionGuard)
  @UseInterceptors(FileInterceptor('logo'))
  async onboarding(
    @Req() req: Request,
    @Body('org_name') orgName: string,
    @FileInterceptor('logo') file?: Express.Multer.File,
  ): Promise<{ success: boolean }> {
    const session = req.session;

    if (!orgName) {
      throw new BadRequestException('org_name is required');
    }

    // D-15: Check if already completed
    const org = await this.prisma.organization.findUnique({
      where: { id: session.org },
    });

    if (org.onboardingCompletedAt) {
      throw new ConflictException('Onboarding already completed');
    }

    // Upload logo to R2 if provided
    let logoUrl: string | null = null;
    if (file) {
      logoUrl = await this.storage.uploadFile(file, `orgs/${session.org}/logo`);
    }

    // D-13-D-14: Update org with name and completion timestamp
    await this.prisma.organization.update({
      where: { id: session.org },
      data: {
        name: orgName,
        logoUrl: logoUrl,
        onboardingCompletedAt: new Date(), // D-14: Timestamp
      },
    });

    return { success: true };
  }
}
```

---

## State of the Art

| Old Approach                         | Current Approach                                 | When Changed                   | Impact                                                                                |
| ------------------------------------ | ------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------- |
| Session table in DB                  | HTTP-only JWT cookie in Redis (magic links only) | 2026-04-11 (Phase 19)          | Stateless, no session table cruft, secure by default                                  |
| Bearer token in Authorization header | Cookie via Set-Cookie header                     | 2026-04-11 (Phase 19)          | Immune to XSS token theft, automatic CSRF protection, cleaner frontend code           |
| Refresh token rotation (OAuth 2.0)   | Single 7-day JWT session (no refresh)            | 2026-04-11 (Phase 19)          | Simpler implementation, acceptable for 7-day window (users re-auth if device rotates) |
| Password-based signup                | Google OAuth only (Phase 19)                     | 2026-04-11 (Phase 19)          | Passwordless = fewer breaches, but Phase 20+ may add password signup                  |
| Custom SMTP wrapper                  | Nodemailer                                       | 2026-04-11 (Phase 19 decision) | Battle-tested, swappable backends, no custom edge cases                               |

**Deprecated/outdated:**

- Session tokens in URL query params — vulnerable to XSS and log leakage; use cookies instead.
- In-memory session store — doesn't scale across multiple API instances; use Redis or cookie-based JWT.

---

## Assumptions Log

| #   | Claim                                                                                                                                       | Section                                 | Risk if Wrong                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Nodemailer is the only email service pattern used across Phase 19 (no alternative SMTP libraries)                                           | Standard Stack, Don't Hand-Roll         | If org later switches to Postmark SDK instead of SMTP, code won't swap cleanly — but D-09 explicitly states "SMTP-agnostic", so low risk           |
| A2  | `crypto.randomBytes(32).toString('hex')` is sufficient entropy for magic link tokens                                                        | Common Pitfalls, Code Examples          | Cryptographic standard for 256-bit tokens; unguessable. High confidence.                                                                           |
| A3  | Redis is available in all environments (dev, test, production) for magic link storage                                                       | Architecture Patterns, Pitfall 2        | BullMQ already requires Redis, so this is guaranteed. No fallback needed. High confidence.                                                         |
| A4  | `FRONTEND_URL` env var is available to construct magic link URLs                                                                            | Locked Decisions, Architecture Patterns | Must be set in .env and docker-compose.yml. If missing, emails have broken links. Planner must verify this is in config before Phase 19 execution. |
| A5  | Invitation table schema (Phase 18) includes all required fields: id, organizationId, email, role, token, status, expiresAt, invitedByUserId | Locked Decisions                        | Phase 18 context confirms this. High confidence.                                                                                                   |
| A6  | Google OAuth dev stub (D-20) is secure enough for local development without real Google credentials                                         | Architecture Patterns, Pitfall 4        | Limited to `NODE_ENV !== 'production'`; stub parses token as JSON. Acceptable for dev. High confidence.                                            |

**If any assumption is wrong, the planner should request user confirmation before proceeding.**

---

## Open Questions

1. **Logo upload path in R2**
   - What we know: `POST /auth/onboarding` accepts optional logo file (PNG, JPG, SVG, max 2 MB)
   - What's unclear: Should logo path be `orgs/{orgId}/logo.{ext}` or `logos/{orgId}.{ext}` or similar?
   - Recommendation: Align with Phase 5 (File Storage) patterns. If no prior convention, use `logos/{orgId}/{timestamp}-{originalName}` to support multiple uploads if re-branding later.

2. **Email template format (HTML vs plain text)**
   - What we know: D-12 says "plain text or minimal HTML for now"
   - What's unclear: Should we include basic HTML structure or just plain text strings?
   - Recommendation: Use plain text body with a single-line HTML version for email clients. Nodemailer `sendMail()` accepts both `text` and `html` fields.

3. **SMTP retry behavior for transient failures**
   - What we know: Nodemailer transport is initialized once at startup
   - What's unclear: Should we implement retry logic if SMTP temporarily fails, or should email failure block the user flow?
   - Recommendation: Log failure but don't block user creation. User can resend magic link manually. Use Nodemailer's `connectionTimeout` and `socketTimeout` to fail fast (not hang for 30 seconds).

4. **Google OAuth flow — capturing Google's `sub` as providerId**
   - What we know: D-21 says `providerId = sub` (Google's unique user ID)
   - What's unclear: Does the dev stub also include `sub`, or only `{ email, name }`?
   - Recommendation: Dev stub should not include `sub`. In production, fetch it from Google UserInfo API alongside email/name. Store it in `User.providerId` to detect account takeover (same Google sub, different email).

---

## Environment Availability

| Dependency                | Required By                                     | Available                 | Version            | Fallback                                     |
| ------------------------- | ----------------------------------------------- | ------------------------- | ------------------ | -------------------------------------------- |
| Node.js                   | All TypeScript/NestJS                           | ✓                         | 22 (CLAUDE.md)     | —                                            |
| PostgreSQL                | Prisma ORM, Organization/User/Invitation tables | ✓                         | 16 (CLAUDE.md)     | —                                            |
| Redis                     | Magic link token storage, BullMQ queue          | ✓                         | 7 (Project-locked) | —                                            |
| SMTP Server               | Nodemailer (outbound emails)                    | ✗ (varies by environment) | —                  | Console fallback in dev/test (D-12)          |
| Google OAuth API          | Google OAuth verification (production)          | ✓ (public API)            | v3                 | Dev stub if `GOOGLE_CLIENT_ID` absent (D-20) |
| Express Cookie Middleware | HTTP-only cookie parsing                        | ✓ (npm install)           | 1.4.x              | —                                            |

**Missing dependencies with no fallback:**

- None — all production requirements have fallbacks or are already available.

**Missing dependencies with fallback:**

- SMTP Server (dev/test): Falls back to console logging (D-12)
- Google OAuth credentials (dev): Falls back to JSON stub (D-20)

---

## Validation Architecture

### Test Framework

| Property           | Value                                                                  |
| ------------------ | ---------------------------------------------------------------------- | ---------------------------- |
| Framework          | Jest (30.0.0) + @nestjs/testing + supertest                            |
| Config file        | jest.config.js (root level, configured in package.json)                |
| Quick run command  | `npm test -- src/auth/auth.controller.spec.ts --testPathPattern="(POST | GET).\*auth" --maxWorkers=1` |
| Full suite command | `npm test` (all 250+ tests)                                            |

### Phase Requirements → Test Map

| Req ID   | Behavior                                                                                 | Test Type   | Automated Command                                                        | File Exists? |
| -------- | ---------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------ | ------------ |
| AUTH-001 | Google OAuth sign-up creates Org + User (owner role) in transaction                      | Integration | `npm test -- --testNamePattern="google/verify.*new user"`                | ❌ Wave 0    |
| AUTH-001 | Returning Google user issues new session                                                 | Integration | `npm test -- --testNamePattern="google/verify.*existing user"`           | ❌ Wave 0    |
| AUTH-002 | POST /auth/onboarding sets org name + logo, onboardingCompletedAt                        | Integration | `npm test -- --testNamePattern="onboarding.*success"`                    | ❌ Wave 0    |
| AUTH-002 | POST /auth/onboarding returns 409 if already completed                                   | Integration | `npm test -- --testNamePattern="onboarding.*conflict"`                   | ❌ Wave 0    |
| AUTH-003 | POST /auth/team/invitations creates invitation, sends email, token valid 7 days          | Integration | `npm test -- --testNamePattern="invitations.*create"`                    | ❌ Wave 0    |
| AUTH-003 | POST /auth/team/invitations returns 409 if already member or pending                     | Integration | `npm test -- --testNamePattern="invitations.*(ALREADY_MEMBER\|PENDING)"` | ❌ Wave 0    |
| AUTH-004 | POST /auth/invite/:token/accept creates user from invitation, sets session               | Integration | `npm test -- --testNamePattern="invite.*accept"`                         | ❌ Wave 0    |
| AUTH-004 | GET /auth/invite/:token validates token, returns org/role/email or 404/409/410           | Integration | `npm test -- --testNamePattern="invite.*validate"`                       | ❌ Wave 0    |
| AUTH-005 | POST /auth/magic-link generates token, stores in Redis, sends email, returns 200 always  | Integration | `npm test -- --testNamePattern="magic-link.*send"`                       | ❌ Wave 0    |
| AUTH-005 | GET /auth/magic-link/verify validates token, deletes from Redis, sets session, redirects | Integration | `npm test -- --testNamePattern="magic-link.*verify"`                     | ❌ Wave 0    |
| AUTH-006 | SessionGuard reads cookie, validates JWT, allows request or throws 401                   | Unit        | `npm test -- --testNamePattern="SessionGuard"`                           | ❌ Wave 0    |
| AUTH-006 | Unauthenticated GET /auth/me returns 401                                                 | Integration | `npm test -- --testNamePattern="GET.*me.*unauthorized"`                  | ❌ Wave 0    |
| AUTH-007 | GET /auth/team/members returns all active users for org                                  | Integration | `npm test -- --testNamePattern="team/members.*list"`                     | ❌ Wave 0    |
| AUTH-007 | PATCH /auth/team/members/:id/role requires Owner, prevents targeting Owner               | Integration | `npm test -- --testNamePattern="team/members.*role.*(403\|forbidden)"`   | ❌ Wave 0    |
| AUTH-007 | DELETE /auth/team/members/:id requires Owner, prevents self-delete                       | Integration | `npm test -- --testNamePattern="team/members.*delete.*(403\|self)"`      | ❌ Wave 0    |

### Sampling Rate

- **Per task commit:** `npm test -- src/auth/auth.controller.spec.ts --testPathPattern="AUTH-00[1-3]" --maxWorkers=1` (quick smoke: signin, onboarding, invitations)
- **Per wave merge:** `npm test` (full suite including all Auth + other existing tests)
- **Phase gate:** Full suite must be green + 14 auth-specific tests passing before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/auth/auth.controller.spec.ts` — covers AUTH-001 to AUTH-007 (14 tests)
- [ ] `src/auth/session.guard.spec.ts` — covers AUTH-006 (SessionGuard unit tests, 3 tests)
- [ ] `src/auth/email.service.spec.ts` — covers D-12 console fallback, SMTP send (3 tests)
- [ ] `src/config/env.spec.ts` — extend to include new SMTP\_\* and FRONTEND_URL vars
- [ ] Framework install: `npm install nodemailer cookie-parser @types/nodemailer` — not needed for test execution
- [ ] Prisma migration: `onboardingCompletedAt` column on Organization model — must run before integration tests can create orgs

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category                  | Applies | Standard Control                                                                                         |
| ------------------------------ | ------- | -------------------------------------------------------------------------------------------------------- |
| V2 Authentication              | yes     | Google OAuth (Phase 19), magic link (time-limited tokens in Redis)                                       |
| V3 Session Management          | yes     | HTTP-only cookie with `sameSite=lax`, secure flag in production (D-02), 7-day expiry (D-01)              |
| V4 Access Control              | yes     | SessionGuard validates all protected endpoints, inline role checks for Owner-only actions (D-18)         |
| V5 Input Validation            | yes     | Zod DTOs for all request bodies (email, org_name, role, token), file size limit (2 MB) on logo upload    |
| V6 Cryptography                | yes     | Jose for JWT signing (industry standard), crypto.randomBytes for token generation, no custom crypto      |
| V13 API & Web Service Security | yes     | CORS with credentials flag (FRONTEND_URL only), no sensitive data in JWT payload (only {sub, org, role}) |

### Known Threat Patterns for {stack}

| Pattern                                   | STRIDE                           | Standard Mitigation                                                                                                                                                           |
| ----------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| XSS stealing session from localStorage    | Tampering/Information Disclosure | HTTP-only cookies (browser cannot read, immune to `document.cookie` theft)                                                                                                    |
| CSRF forging requests with session cookie | Tampering                        | SameSite=lax (lax allows top-level navigation, needed for OAuth redirects; strict would break signup)                                                                         |
| Brute-force magic link tokens             | Tampering                        | 1-hour Redis TTL (D-05), cryptographically random 256-bit tokens (unguessable), rate-limit on `POST /auth/magic-link` (not in PROTOCOL.md but recommend 3 per hour per email) |
| Email enumeration via `/auth/magic-link`  | Information Disclosure           | Always return 200 regardless of email existence (D-06)                                                                                                                        |
| Google OAuth token replay                 | Tampering                        | Validate token immediately on `POST /auth/google/verify` (within 5 min of frontend obtaining it); tokens expire ~1 hour; don't store/reuse tokens                             |
| Privilege escalation via role claim       | Tampering                        | SessionGuard validates JWT with `JwtService.verify()` using `JWT_SECRET` (only backend can forge); cannot tamper with role field on client                                    |
| Session fixation                          | Tampering                        | New JWT issued on every login (no fixed session IDs); cookie `path=/` prevents subdomain attacks                                                                              |

**Security controls implemented:**

1. HTTP-only, SameSite cookies (V3)
2. JWT payload carries only {sub, org, role} — no sensitive PII (V13)
3. Magic link tokens: cryptographically random, 1-hour TTL, one-time use (D-07) (V2)
4. Owner-only actions enforced inline; non-Owner gets 403 (V4)
5. Input validation via Zod DTOs (V5)
6. Production: secure flag on cookie, real Google OAuth validation (D-02, D-20) (V3, V2)

**Out of scope for Phase 19:**

- Rate limiting on auth endpoints (recommend for Phase 20 or quick task)
- Account lockout after N failed attempts (N/A for passwordless auth)
- Audit logging of role changes (mentioned in spec/auth-rules.md as Phase 3, out of scope)

---

## Sources

### Primary (HIGH confidence)

- **Context7:** Not yet queried (jose, NestJS, Prisma are locked by project; external APIs not in Context7)
- **PROTOCOL.md §7:** All 14 endpoint contracts, error codes, response shapes — authoritative
- **spec/auth-rules.md:** Role definitions (AUTH-006), auth flow (AUTH-001-005), user management (AUTH-007)
- **Phase 18 (18-CONTEXT.md):** Database schema (User, Organization, Invitation models), JwtService implementation, D-01 through D-32 decisions
- **CLAUDE.md:** Stack constraints (NestJS 11, Prisma 7, PostgreSQL 16), no custom crypto

### Secondary (MEDIUM confidence)

- **NestJS official docs (latest):** Guards, Decorators, Response handling, cookie-parser middleware integration [VERIFIED: common NestJS pattern]
- **Jose 6.2.2 registry:** JWT signing/verification API [VERIFIED: npm registry, already installed in package.json]
- **Nodemailer official site:** SMTP transport configuration, provider-agnostic design [VERIFIED: nodemailer.com, industry standard since 2011]
- **Express/cookie-parser:** HTTP-only cookie parsing [VERIFIED: standard Express middleware, used in all production Node.js projects]

### Tertiary (LOW confidence)

- None — all primary and secondary sources are locked or verified.

---

## Metadata

**Confidence breakdown:**

- **Standard stack:** HIGH — Jose (installed), Nodemailer (standard, add via npm), cookie-parser (standard Express, add via npm), all project stack locked
- **Architecture patterns:** HIGH — D-01 through D-23 all locked in CONTEXT.md; Phase 18 prerequisite verified
- **Pitfalls:** HIGH — documented from PROTOCOL.md contract and Phase 18 integration patterns
- **Email service:** MEDIUM — Nodemailer is standard but not yet installed; needs verification that env vars are added to config

**Research date:** 2026-04-11
**Valid until:** 2026-05-11 (30 days — Auth is stable domain, no breaking changes expected in npm ecosystem during this window)

**Completed:** All 14 endpoints specified in PROTOCOL.md §7, all requirements AUTH-001 through AUTH-007 cross-referenced, runtime state audit (none — greenfield), environment availability checked (fallbacks documented for SMTP and Google OAuth dev), validation architecture mapped (14 tests required).
