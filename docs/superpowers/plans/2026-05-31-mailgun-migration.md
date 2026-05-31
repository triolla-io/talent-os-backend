# Mailgun Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Postmark inbound webhook (JSON + Basic Auth) and Resend SMTP with Mailgun for both CV intake and outbound auth emails.

**Architecture:** Multer middleware parses the `multipart/form-data` Mailgun webhook before guards run. A new `MailgunAuthGuard` verifies the HMAC-SHA256 signature embedded in the form fields. The controller maps the raw Mailgun multipart body to the existing `EmailPayloadDto` internal format (same PascalCase field names as `PostmarkPayloadDto`) so the storage service, ingestion pipeline, and worker require only an import-path update — zero logic changes.

**Tech Stack:** NestJS 11, `multer` (bundled with `@nestjs/platform-express`), Node.js `crypto`, Zod 3, TypeScript 5.

---

## File Map

**New files**

- `src/webhooks/dto/mailgun-payload.dto.ts` — Zod schema for raw Mailgun multipart body; `EmailAttachmentDto` / `EmailPayloadDto` internal types; `parseMailgunPayload()` mapping function
- `src/webhooks/dto/mailgun-payload.dto.spec.ts` — unit tests for schema + mapping
- `src/webhooks/guards/mailgun-auth.guard.ts` — HMAC-SHA256 signature + replay-protection guard
- `src/webhooks/guards/mailgun-auth.guard.spec.ts` — unit tests for guard

**Modified — logic changes**

- `src/webhooks/webhooks.module.ts` — implement `NestModule`, register multer middleware, swap guard
- `src/webhooks/webhooks.controller.ts` — read multipart via `@Req()`, validate with `MailgunRawBodySchema`, map to `EmailPayloadDto`
- `src/webhooks/webhooks.controller.spec.ts` — rewrite for new multipart method signature
- `src/webhooks/webhooks.service.ts` — use `EmailPayloadDto`, remove Postmark ping check
- `src/webhooks/webhooks.service.spec.ts` — use `EmailPayloadDto`, delete Postmark ping test
- `src/main.ts` — remove 10 MB JSON body limit
- `.env.example` — swap `POSTMARK_WEBHOOK_TOKEN` → `MAILGUN_WEBHOOK_SIGNING_KEY`, update SMTP vars
- `local-test/run.js` — send `multipart/form-data` with HMAC signature

**Modified — import path only (no logic changes)**

- `src/storage/storage.service.ts`
- `src/ingestion/services/attachment-extractor.service.ts`
- `src/ingestion/services/spam-filter.service.ts`

**Deleted**

- `src/webhooks/dto/postmark-payload.dto.ts`
- `src/webhooks/dto/postmark-payload.dto.spec.ts`
- `src/webhooks/guards/postmark-auth.guard.ts`
- `src/webhooks/guards/postmark-auth.guard.spec.ts`

---

## Task 1: MailgunAuthGuard — TDD

**Files:**

- Create: `src/webhooks/guards/mailgun-auth.guard.spec.ts`
- Create: `src/webhooks/guards/mailgun-auth.guard.ts`

- [ ] **Step 1: Write the failing test**

Create `src/webhooks/guards/mailgun-auth.guard.spec.ts`:

```typescript
import * as crypto from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailgunAuthGuard } from './mailgun-auth.guard';

const SIGNING_KEY = 'test-signing-key';

function buildContext(body: Record<string, string> = {}) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ body }),
    }),
  } as any;
}

function makeSignature(key: string, timestamp: string, token: string): string {
  return crypto
    .createHmac('sha256', key)
    .update(timestamp + token)
    .digest('hex');
}

function freshTimestamp(): string {
  return String(Math.floor(Date.now() / 1000));
}

describe('MailgunAuthGuard', () => {
  let guard: MailgunAuthGuard;

  beforeEach(() => {
    const mockConfig = { get: jest.fn().mockReturnValue(SIGNING_KEY) } as unknown as ConfigService;
    guard = new MailgunAuthGuard(mockConfig);
  });

  it('throws UnauthorizedException when timestamp is missing', () => {
    const token = 'a'.repeat(50);
    const ctx = buildContext({ token, signature: makeSignature(SIGNING_KEY, '', token) });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when token is missing', () => {
    const ts = freshTimestamp();
    const ctx = buildContext({ timestamp: ts, signature: makeSignature(SIGNING_KEY, ts, '') });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when signature is missing', () => {
    const ts = freshTimestamp();
    const ctx = buildContext({ timestamp: ts, token: 'a'.repeat(50) });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when timestamp is older than 300 seconds', () => {
    const staleTs = String(Math.floor(Date.now() / 1000) - 301);
    const token = 'b'.repeat(50);
    const ctx = buildContext({
      timestamp: staleTs,
      token,
      signature: makeSignature(SIGNING_KEY, staleTs, token),
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when signature is wrong', () => {
    const ts = freshTimestamp();
    const token = 'c'.repeat(50);
    const ctx = buildContext({ timestamp: ts, token, signature: 'deadbeef'.repeat(8) });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('returns true for a valid signature with a fresh timestamp', () => {
    const ts = freshTimestamp();
    const token = 'd'.repeat(50);
    const sig = makeSignature(SIGNING_KEY, ts, token);
    const ctx = buildContext({ timestamp: ts, token, signature: sig });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to see it fail**

```bash
npx jest src/webhooks/guards/mailgun-auth.guard.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: `Cannot find module './mailgun-auth.guard'`

- [ ] **Step 3: Implement the guard**

Create `src/webhooks/guards/mailgun-auth.guard.ts`:

```typescript
import { CanActivate, ExecutionContext, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class MailgunAuthGuard implements CanActivate {
  constructor(@Optional() private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      body: { timestamp?: string; token?: string; signature?: string };
    }>();
    const { timestamp, token, signature } = request.body ?? {};

    if (!timestamp || !token || !signature) {
      throw new UnauthorizedException('Missing Mailgun auth fields');
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
      throw new UnauthorizedException('Webhook timestamp expired');
    }

    const signingKey = this.configService.get<string>('MAILGUN_WEBHOOK_SIGNING_KEY') ?? '';
    const expected = crypto
      .createHmac('sha256', signingKey)
      .update(timestamp + token)
      .digest('hex');

    const sigBuf = Buffer.from(signature, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');

    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      throw new UnauthorizedException('Invalid Mailgun webhook signature');
    }

    return true;
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest src/webhooks/guards/mailgun-auth.guard.spec.ts --no-coverage 2>&1 | tail -5
```

Expected: `Tests: 6 passed, 6 total`

- [ ] **Step 5: Commit**

```bash
git add src/webhooks/guards/mailgun-auth.guard.ts src/webhooks/guards/mailgun-auth.guard.spec.ts
git commit -m "feat(webhooks): add MailgunAuthGuard with HMAC-SHA256 + replay protection"
```

---

## Task 2: MailgunPayloadDto — TDD

**Files:**

- Create: `src/webhooks/dto/mailgun-payload.dto.spec.ts`
- Create: `src/webhooks/dto/mailgun-payload.dto.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/webhooks/dto/mailgun-payload.dto.spec.ts`:

```typescript
import { MailgunRawBodySchema, parseMailgunPayload } from './mailgun-payload.dto';

const VALID_HEADERS = JSON.stringify([
  ['Message-Id', '<abc-123@mail.example.com>'],
  ['From', 'Sender <sender@example.com>'],
]);

const validBody = {
  timestamp: '1748000000',
  token: 'a'.repeat(50),
  signature: 'b'.repeat(64),
  from: 'sender@example.com',
  subject: 'CV Application',
  'body-plain': 'Plain text body',
  'stripped-text': 'Stripped text body',
  'message-headers': VALID_HEADERS,
};

describe('MailgunRawBodySchema', () => {
  it('accepts a fully valid body', () => {
    const result = MailgunRawBodySchema.safeParse(validBody);
    expect(result.success).toBe(true);
  });

  it('rejects missing timestamp', () => {
    const { timestamp: _, ...rest } = validBody;
    expect(MailgunRawBodySchema.safeParse(rest).success).toBe(false);
  });

  it('rejects non-numeric timestamp', () => {
    expect(MailgunRawBodySchema.safeParse({ ...validBody, timestamp: 'not-a-number' }).success).toBe(false);
  });

  it('rejects missing token', () => {
    const { token: _, ...rest } = validBody;
    expect(MailgunRawBodySchema.safeParse(rest).success).toBe(false);
  });

  it('rejects missing signature', () => {
    const { signature: _, ...rest } = validBody;
    expect(MailgunRawBodySchema.safeParse(rest).success).toBe(false);
  });

  it('rejects missing from', () => {
    const { from: _, ...rest } = validBody;
    expect(MailgunRawBodySchema.safeParse(rest).success).toBe(false);
  });

  it('rejects invalid JSON in message-headers', () => {
    expect(MailgunRawBodySchema.safeParse({ ...validBody, 'message-headers': 'not-json' }).success).toBe(false);
  });

  it('defaults subject to empty string when absent', () => {
    const { subject: _, ...rest } = validBody;
    const result = MailgunRawBodySchema.safeParse(rest);
    expect(result.success).toBe(true);
    expect((result as any).data.subject).toBe('');
  });

  it('allows optional body-plain and body-html', () => {
    const { 'body-plain': _p, ...rest } = validBody;
    expect(MailgunRawBodySchema.safeParse(rest).success).toBe(true);
  });

  it('allows optional stripped-text', () => {
    const { 'stripped-text': _s, ...rest } = validBody;
    expect(MailgunRawBodySchema.safeParse(rest).success).toBe(true);
  });
});

describe('parseMailgunPayload', () => {
  it('extracts MessageID from Message-Id header with angle brackets stripped', () => {
    const result = parseMailgunPayload(validBody as any, []);
    // Raw header value is '<abc-123@...>' — angle brackets must be stripped.
    // R2 keys and DB messageId column cannot safely contain '<' or '>'.
    expect(result.MessageID).toBe('abc-123@mail.example.com');
  });

  it('falls back to token as MessageID when Message-Id header is absent', () => {
    const headersWithoutMsgId = JSON.stringify([['X-Custom', 'value']]);
    const body = { ...validBody, 'message-headers': headersWithoutMsgId };
    const result = parseMailgunPayload(body as any, []);
    expect(result.MessageID).toBe(validBody.token);
  });

  it('uses from field as From', () => {
    const result = parseMailgunPayload(validBody as any, []);
    expect(result.From).toBe('sender@example.com');
  });

  it('strips display name from from field when present', () => {
    const body = { ...validBody, from: 'John Doe <john@example.com>' };
    const result = parseMailgunPayload(body as any, []);
    expect(result.From).toBe('john@example.com');
  });

  it('converts Unix timestamp to ISO date string', () => {
    const result = parseMailgunPayload(validBody as any, []);
    expect(result.Date).toBe(new Date(1748000000 * 1000).toISOString());
  });

  it('prefers stripped-text over body-plain for TextBody', () => {
    // stripped-text removes signatures/reply-chains — better signal for AI extraction
    const body = { ...validBody, 'stripped-text': 'Just the cover note', 'body-plain': 'Cover note + signature' };
    const result = parseMailgunPayload(body as any, []);
    expect(result.TextBody).toBe('Just the cover note');
  });

  it('falls back to body-plain for TextBody when stripped-text is absent', () => {
    const { 'stripped-text': _s, ...body } = validBody;
    const result = parseMailgunPayload(body as any, []);
    expect(result.TextBody).toBe('Plain text body');
  });

  it('maps subject and body-html', () => {
    const body = { ...validBody, 'body-html': '<p>Hello</p>' };
    const result = parseMailgunPayload(body as any, []);
    expect(result.Subject).toBe('CV Application');
    expect(result.HtmlBody).toBe('<p>Hello</p>');
  });

  it('maps uploaded files to base64 attachments', () => {
    const fakeFile = {
      originalname: 'resume.pdf',
      mimetype: 'application/pdf',
      size: 1024,
      buffer: Buffer.from('fake-pdf-bytes'),
    } as Express.Multer.File;

    const result = parseMailgunPayload(validBody as any, [fakeFile]);

    expect(result.Attachments).toHaveLength(1);
    expect(result.Attachments[0].Name).toBe('resume.pdf');
    expect(result.Attachments[0].ContentType).toBe('application/pdf');
    expect(result.Attachments[0].ContentLength).toBe(1024);
    expect(result.Attachments[0].Content).toBe(Buffer.from('fake-pdf-bytes').toString('base64'));
  });

  it('produces empty Attachments array when no files are uploaded', () => {
    const result = parseMailgunPayload(validBody as any, []);
    expect(result.Attachments).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to see them fail**

```bash
npx jest src/webhooks/dto/mailgun-payload.dto.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: `Cannot find module './mailgun-payload.dto'`

- [ ] **Step 3: Implement the DTO**

Create `src/webhooks/dto/mailgun-payload.dto.ts`:

```typescript
import { z } from 'zod';

// ─── Raw Mailgun multipart body (fields only — files are on req.files) ────────

export const MailgunRawBodySchema = z.object({
  timestamp: z.string().regex(/^\d+$/, 'timestamp must be a Unix epoch number'),
  token: z.string().min(1),
  signature: z.string().min(1),
  from: z.string().min(1),
  subject: z.string().default(''),
  'body-plain': z.string().optional(),
  'body-html': z.string().optional(),
  // stripped-text: Mailgun removes reply chains and signatures automatically.
  // Preferred over body-plain for AI extraction — less noise, fewer tokens.
  'stripped-text': z.string().optional(),
  'message-headers': z.string().refine(
    (val) => {
      try {
        JSON.parse(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'message-headers must be valid JSON' },
  ),
  recipient: z.string().optional(),
});

export type MailgunRawBodyDto = z.infer<typeof MailgunRawBodySchema>;

// ─── Internal normalized email payload (same shape as old PostmarkPayloadDto) ─
// PascalCase field names kept intentionally so storage service, ingestion
// pipeline, and worker require only an import-path update — no logic changes.

export const EmailAttachmentSchema = z.object({
  Name: z.string(),
  Content: z.string().optional(),
  ContentType: z.string(),
  ContentLength: z.number(),
  ContentID: z.string().optional(),
});

export const EmailPayloadSchema = z.object({
  MessageID: z.string().min(1),
  From: z.string().email(),
  Subject: z.string().default(''),
  TextBody: z.string().optional(),
  HtmlBody: z.string().optional(),
  Date: z.string(),
  Attachments: z.array(EmailAttachmentSchema).default([]),
});

export type EmailAttachmentDto = z.infer<typeof EmailAttachmentSchema>;
export type EmailPayloadDto = z.infer<typeof EmailPayloadSchema>;

// Backward-compat aliases — lets storage/ingestion imports update path only
export type PostmarkAttachmentDto = EmailAttachmentDto;
export type PostmarkPayloadDto = EmailPayloadDto;
export const PostmarkAttachmentSchema = EmailAttachmentSchema;
export const PostmarkPayloadSchema = EmailPayloadSchema;

// ─── Mapping: Mailgun multipart → internal EmailPayloadDto ───────────────────

function extractEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

export function parseMailgunPayload(body: MailgunRawBodyDto, files: Express.Multer.File[]): EmailPayloadDto {
  const headers = JSON.parse(body['message-headers']) as [string, string][];
  const msgIdEntry = headers.find(([name]) => name.toLowerCase() === 'message-id');
  // Strip RFC-2822 angle brackets so the value is safe as an R2 key path segment
  // and consistent with IDs stored by other providers (e.g. Postmark's bare UUIDs).
  const rawMessageId = msgIdEntry?.[1] ?? body.token;
  const messageId = rawMessageId.replace(/^<|>$/g, '').trim();

  return {
    MessageID: messageId,
    From: extractEmail(body.from),
    Subject: body.subject ?? '',
    // Prefer stripped-text: Mailgun removes reply chains + signatures automatically,
    // reducing noise for the AI extraction agent and lowering token usage.
    // Falls back to body-plain when stripped-text is absent (e.g. new plain-text emails).
    TextBody: body['stripped-text'] || body['body-plain'],
    HtmlBody: body['body-html'],
    Date: new Date(parseInt(body.timestamp, 10) * 1000).toISOString(),
    // NOTE: Storing base64 Content here is required for backward compatibility with
    // the ingestion worker's AttachmentExtractorService, which reads att.Content
    // from the payload.json downloaded from R2. Refactoring the worker to read the
    // binary directly from cvFileKey would eliminate the redundant R2 storage
    // (base64 in payload.json + binary in cv.pdf), but is out of scope here.
    Attachments: files.map((file) => ({
      Name: file.originalname,
      Content: file.buffer.toString('base64'),
      ContentType: file.mimetype,
      ContentLength: file.size,
    })),
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest src/webhooks/dto/mailgun-payload.dto.spec.ts --no-coverage 2>&1 | tail -5
```

Expected: `Tests: 20 passed, 20 total`

- [ ] **Step 5: Commit**

```bash
git add src/webhooks/dto/mailgun-payload.dto.ts src/webhooks/dto/mailgun-payload.dto.spec.ts
git commit -m "feat(webhooks): add MailgunPayloadDto, EmailPayloadDto, parseMailgunPayload"
```

---

## Task 3: Wire Multer Middleware in WebhooksModule

**Files:**

- Modify: `src/webhooks/webhooks.module.ts`

- [ ] **Step 1: Replace the module file**

Replace the full content of `src/webhooks/webhooks.module.ts`:

```typescript
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import * as multer from 'multer';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { MailgunAuthGuard } from './guards/mailgun-auth.guard';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [BullModule.registerQueue({ name: 'ingest-email' }), StorageModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, MailgunAuthGuard],
})
export class WebhooksModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 5 } }).any())
      .forRoutes({ path: 'webhooks/email', method: RequestMethod.POST });
  }
}
```

- [ ] **Step 2: Run the full webhook test suite to ensure existing tests still pass**

```bash
npx jest src/webhooks/ --no-coverage 2>&1 | tail -15
```

Expected: all previously passing tests pass (new guard/DTO tests included).

- [ ] **Step 3: Commit**

```bash
git add src/webhooks/webhooks.module.ts
git commit -m "feat(webhooks): register multer middleware, swap PostmarkAuthGuard → MailgunAuthGuard"
```

---

## Task 4: Update WebhooksController + Controller Tests

**Files:**

- Modify: `src/webhooks/webhooks.controller.ts`
- Modify: `src/webhooks/webhooks.controller.spec.ts`

- [ ] **Step 1: Rewrite the controller spec first**

Replace the full content of `src/webhooks/webhooks.controller.spec.ts`:

```typescript
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

describe('WebhooksController', () => {
  let controller: WebhooksController;
  let mockWebhooksService: Partial<WebhooksService>;

  const VALID_HEADERS = JSON.stringify([['Message-Id', '<msg-xyz-456@example.com>']]);

  function buildMockReq(overrides: Record<string, unknown> = {}, files: unknown[] = []) {
    return {
      body: {
        timestamp: '1748000000',
        token: 'a'.repeat(50),
        signature: 'b'.repeat(64),
        from: 'applicant@example.com',
        subject: 'Applying for Engineer role',
        'message-headers': VALID_HEADERS,
        ...overrides,
      },
      files,
    };
  }

  beforeEach(async () => {
    mockWebhooksService = {
      enqueue: jest.fn().mockResolvedValue({ status: 'queued' }),
      checkHealth: jest.fn().mockResolvedValue({ status: 'ok', db: 'ok', redis: 'ok' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])],
      controllers: [WebhooksController],
      providers: [{ provide: WebhooksService, useValue: mockWebhooksService }],
    }).compile();

    controller = module.get<WebhooksController>(WebhooksController);
  });

  describe('POST /webhooks/email', () => {
    it('normalizes Mailgun payload and calls enqueue with EmailPayloadDto', async () => {
      const result = await controller.ingestEmail(buildMockReq() as any);
      expect(result).toEqual({ status: 'queued' });
      expect(mockWebhooksService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          MessageID: '<msg-xyz-456@example.com>',
          From: 'applicant@example.com',
          Subject: 'Applying for Engineer role',
        }),
      );
    });

    it('throws BadRequestException when timestamp is missing', async () => {
      const req = buildMockReq({ timestamp: undefined });
      await expect(controller.ingestEmail(req as any)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when from is missing', async () => {
      const req = buildMockReq({ from: undefined });
      await expect(controller.ingestEmail(req as any)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when message-headers is invalid JSON', async () => {
      const req = buildMockReq({ 'message-headers': 'not-json' });
      await expect(controller.ingestEmail(req as any)).rejects.toThrow(BadRequestException);
    });

    it('maps uploaded files to base64 attachments and passes them to enqueue', async () => {
      const fakeFile = {
        originalname: 'cv.pdf',
        mimetype: 'application/pdf',
        size: 2048,
        buffer: Buffer.from('pdf-content'),
      };
      await controller.ingestEmail(buildMockReq({}, [fakeFile]) as any);
      const called = (mockWebhooksService.enqueue as jest.Mock).mock.calls[0][0];
      expect(called.Attachments).toHaveLength(1);
      expect(called.Attachments[0].Name).toBe('cv.pdf');
      expect(called.Attachments[0].Content).toBe(Buffer.from('pdf-content').toString('base64'));
    });
  });

  describe('GET /health', () => {
    it('returns { status: "ok", db: "ok", redis: "ok" }', async () => {
      const result = await controller.health();
      expect(result).toEqual({ status: 'ok', db: 'ok', redis: 'ok' });
      expect(mockWebhooksService.checkHealth).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run the spec to see it fail**

```bash
npx jest src/webhooks/webhooks.controller.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: fails because the controller still uses the old Postmark approach.

- [ ] **Step 3: Rewrite the controller**

Replace the full content of `src/webhooks/webhooks.controller.ts`:

```typescript
import { BadRequestException, Controller, Post, Get, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';
import { WebhooksService } from './webhooks.service';
import { MailgunRawBodySchema, parseMailgunPayload } from './dto/mailgun-payload.dto';
import { MailgunAuthGuard } from './guards/mailgun-auth.guard';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @UseGuards(MailgunAuthGuard, ThrottlerGuard)
  @Post('email')
  @HttpCode(HttpStatus.OK)
  async ingestEmail(@Req() req: Request): Promise<{ status: string }> {
    const result = MailgunRawBodySchema.safeParse(req.body);
    if (!result.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid Mailgun payload',
          details: result.error.flatten().fieldErrors,
        },
      });
    }
    const normalized = parseMailgunPayload(result.data, (req.files ?? []) as Express.Multer.File[]);
    return this.webhooksService.enqueue(normalized);
  }

  @Get('health')
  async health(): Promise<{ status: string; db: string; redis: string }> {
    return this.webhooksService.checkHealth();
  }
}
```

- [ ] **Step 4: Run the controller tests**

```bash
npx jest src/webhooks/webhooks.controller.spec.ts --no-coverage 2>&1 | tail -5
```

Expected: `Tests: 5 passed, 5 total`

- [ ] **Step 5: Commit**

```bash
git add src/webhooks/webhooks.controller.ts src/webhooks/webhooks.controller.spec.ts
git commit -m "feat(webhooks): migrate controller to Mailgun multipart + EmailPayloadDto"
```

---

## Task 5: Update WebhooksService + Service Tests

**Files:**

- Modify: `src/webhooks/webhooks.service.ts`
- Modify: `src/webhooks/webhooks.service.spec.ts`

- [ ] **Step 1: Update the service**

In `src/webhooks/webhooks.service.ts`, make these three targeted changes:

**a) Replace import on line 6:**

```typescript
// old:
import { PostmarkPayloadDto } from './dto/postmark-payload.dto';
// new:
import { EmailPayloadDto } from './dto/mailgun-payload.dto';
```

**b) Remove Postmark ping check (lines 29–32) and update method signature:**

Replace:

```typescript
  async enqueue(payload: PostmarkPayloadDto): Promise<{ status: string }> {
    const tenantId = this.configService.get<string>('TENANT_ID')!;
    const messageId = payload.MessageID;

    if (messageId === '00000000-0000-0000-0000-000000000000') {
      this.logger.log('Skipping Postmark test payload (Ping)');
      return { status: 'queued' };
    }
```

With:

```typescript
  async enqueue(payload: EmailPayloadDto): Promise<{ status: string }> {
    const tenantId = this.configService.get<string>('TENANT_ID')!;
    const messageId = payload.MessageID;
```

**c) Update `stripAttachmentBlobs` type annotations (lines 132–138):**

Replace:

```typescript
  private stripAttachmentBlobs(payload: PostmarkPayloadDto): Omit<PostmarkPayloadDto, 'Attachments'> & {
    Attachments: Omit<NonNullable<PostmarkPayloadDto['Attachments']>[number], 'Content'>[];
  } {
```

With:

```typescript
  private stripAttachmentBlobs(payload: EmailPayloadDto): Omit<EmailPayloadDto, 'Attachments'> & {
    Attachments: Omit<NonNullable<EmailPayloadDto['Attachments']>[number], 'Content'>[];
  } {
```

- [ ] **Step 2: Update the service spec**

In `src/webhooks/webhooks.service.spec.ts`, make these changes:

**a) Replace import on line 3:**

```typescript
// old:
import { PostmarkPayloadDto } from './dto/postmark-payload.dto';
// new:
import { EmailPayloadDto } from './dto/mailgun-payload.dto';
```

**b) Update type annotation on line 14:**

```typescript
// old:
  const basePayload: PostmarkPayloadDto = {
// new:
  const basePayload: EmailPayloadDto = {
```

**c) Delete the entire `describe('skips Postmark test payloads (Ping)')` block (lines 51–62):**

Remove:

```typescript
describe('skips Postmark test payloads (Ping)', () => {
  it('returns { status: "queued" } without DB or queue activity for MessageID 0-0-0-0-0', async () => {
    const testPayload = { ...basePayload, MessageID: '00000000-0000-0000-0000-000000000000' };

    const result = await service.enqueue(testPayload);

    expect(result).toEqual({ status: 'queued' });
    expect(mockPrisma.emailIntakeLog.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.emailIntakeLog.create).not.toHaveBeenCalled();
    expect(mockQueue.add).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the service tests**

```bash
npx jest src/webhooks/webhooks.service.spec.ts --no-coverage 2>&1 | tail -5
```

Expected: all remaining service tests pass (one test deleted, rest unchanged).

- [ ] **Step 4: Commit**

```bash
git add src/webhooks/webhooks.service.ts src/webhooks/webhooks.service.spec.ts
git commit -m "feat(webhooks): use EmailPayloadDto in service, remove Postmark ping check"
```

---

## Task 6: Update Import Paths in Storage + Ingestion Services

These are mechanical import-path updates — no logic changes.

**Files:**

- Modify: `src/storage/storage.service.ts` (line 4)
- Modify: `src/ingestion/services/attachment-extractor.service.ts` (line 4)
- Modify: `src/ingestion/services/spam-filter.service.ts` (line 2)

- [ ] **Step 1: Update storage service import**

In `src/storage/storage.service.ts`, replace line 4:

```typescript
// old:
import { PostmarkAttachmentDto, PostmarkPayloadDto } from '../webhooks/dto/postmark-payload.dto';
// new:
import { PostmarkAttachmentDto, PostmarkPayloadDto } from '../webhooks/dto/mailgun-payload.dto';
```

- [ ] **Step 2: Update attachment-extractor service import**

In `src/ingestion/services/attachment-extractor.service.ts`, replace line 4:

```typescript
// old:
import { PostmarkAttachmentDto } from '../../webhooks/dto/postmark-payload.dto';
// new:
import { PostmarkAttachmentDto } from '../../webhooks/dto/mailgun-payload.dto';
```

- [ ] **Step 3: Update spam-filter service import**

In `src/ingestion/services/spam-filter.service.ts`, replace line 2:

```typescript
// old:
import { PostmarkPayloadDto } from '../../webhooks/dto/postmark-payload.dto';
// new:
import { PostmarkPayloadDto } from '../../webhooks/dto/mailgun-payload.dto';
```

- [ ] **Step 4: Run all tests to verify nothing broke**

```bash
npx jest --no-coverage 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/storage/storage.service.ts \
        src/ingestion/services/attachment-extractor.service.ts \
        src/ingestion/services/spam-filter.service.ts
git commit -m "chore(webhooks): update import paths postmark-payload.dto → mailgun-payload.dto"
```

---

## Task 7: Delete Old Postmark Files

**Files:**

- Delete: `src/webhooks/dto/postmark-payload.dto.ts`
- Delete: `src/webhooks/dto/postmark-payload.dto.spec.ts`
- Delete: `src/webhooks/guards/postmark-auth.guard.ts`
- Delete: `src/webhooks/guards/postmark-auth.guard.spec.ts`

- [ ] **Step 1: Delete the four files**

```bash
rm src/webhooks/dto/postmark-payload.dto.ts \
   src/webhooks/dto/postmark-payload.dto.spec.ts \
   src/webhooks/guards/postmark-auth.guard.ts \
   src/webhooks/guards/postmark-auth.guard.spec.ts
```

- [ ] **Step 2: Run the full test suite**

```bash
npx jest --no-coverage 2>&1 | tail -10
```

Expected: all tests pass (TypeScript compilation succeeds — no dangling imports).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(webhooks): delete Postmark DTO, guard, and their tests"
```

---

## Task 8: Remove 10 MB JSON Body Limit from main.ts

**Files:**

- Modify: `src/main.ts`

- [ ] **Step 1: Remove the body-parser override**

In `src/main.ts`, delete lines 27–29:

```typescript
// Postmark sends CV attachments as base64 inside JSON — a 2 MB PDF becomes ~2.7 MB.
// Default Express limit is 100 KB which rejects most real CVs.
app.useBodyParser('json', { limit: '10mb' });
```

- [ ] **Step 2: Run the full test suite**

```bash
npx jest --no-coverage 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "chore(main): remove 10 MB JSON limit now that attachments arrive as multipart"
```

---

## Task 9: Update .env.example

**Files:**

- Modify: `.env.example`

- [ ] **Step 1: Update env vars**

In `.env.example`:

Replace:

```
# Email intake — Postmark HMAC-SHA256 signature verification token
POSTMARK_WEBHOOK_TOKEN=...
```

With:

```
# Email intake — Mailgun webhook signing key (Mailgun dashboard → Webhooks → HTTP webhook signing key)
MAILGUN_WEBHOOK_SIGNING_KEY=
```

Replace the SMTP block:

```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM="Talent OS <noreply@talentos.triolla.io>"
```

With:

```
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=postmaster@mg.triolla.io
SMTP_PASS=
SMTP_FROM="Talent OS <noreply@mg.triolla.io>"
```

Also remove the Directus variables block (they were removed from the compose file):

```
# ─── Directus Admin UI ────────────────────────────────────────────────────────
# Generate SECRET with: openssl rand -base64 32
DIRECTUS_SECRET=your-directus-secret-min-32-chars-change-in-production
DIRECTUS_ADMIN_EMAIL=admin@triolla.io
DIRECTUS_ADMIN_PASSWORD=changeme
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore(env): swap Postmark → Mailgun env vars, update SMTP to Mailgun"
```

---

## Task 10: Update local-test/run.js for Mailgun Format

**Files:**

- Modify: `local-test/run.js`

- [ ] **Step 1: Replace local-test/run.js**

Replace the full content of `local-test/run.js`:

```javascript
#!/usr/bin/env node
/**
 * Local manual test runner for the Talent-OS email intake flow.
 *
 * Usage:
 *   node local-test/run.js                     # send all files in local-test/files/
 *   node local-test/run.js cv.pdf              # send a specific file from local-test/files/
 *   node local-test/run.js --health            # just check health endpoint
 *
 * Prerequisites:
 *   - docker compose up --build (API on port 3000)
 *   - docker compose exec api npx prisma db seed  (tenant + job must exist)
 *   - MAILGUN_WEBHOOK_SIGNING_KEY set in .env (or exported in your shell)
 *
 * After running, open Prisma Studio and check:
 *   1. email_intake_log  → processing_status should go pending → success
 *   2. candidates        → extracted fields from the CV
 *   3. applications      → linked to the job
 *   4. candidate_job_scores → AI score + reasoning
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const FormData = require('form-data');

// ─── Config ──────────────────────────────────────────────────────────────────
const API_BASE_URL = 'http://localhost:3000';
const SIGNING_KEY = process.env.MAILGUN_WEBHOOK_SIGNING_KEY ?? 'dev-signing-key-change-me';
const SENDER_EMAIL = 'agency@test-recruiter.com';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildMailgunSignature(signingKey, timestamp, token) {
  return crypto
    .createHmac('sha256', signingKey)
    .update(timestamp + token)
    .digest('hex');
}

function randomToken() {
  return crypto.randomBytes(25).toString('hex'); // 50 hex chars
}

function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return map[ext] ?? 'application/octet-stream';
}

function buildMessageHeaders(messageId) {
  return JSON.stringify([
    ['Message-Id', `<${messageId}>`],
    ['From', SENDER_EMAIL],
    ['Mime-Version', '1.0'],
  ]);
}

async function checkHealth() {
  console.log('\n🏥  Checking system health...');
  const res = await fetch(`${API_BASE_URL}/api/webhooks/health`);
  const body = await res.json();
  if (res.ok) {
    console.log(`✅  Health OK →`, body);
  } else {
    console.error(`❌  Health DEGRADED [${res.status}] →`, body);
  }
  return res.ok;
}

async function sendWebhook(filename, fileBuffer) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const token = randomToken();
  const signature = buildMailgunSignature(SIGNING_KEY, timestamp, token);
  const messageId = `test-${Date.now()}-${token.slice(0, 8)}@local.test`;
  const candidateName = path.basename(filename, path.extname(filename)).replace(/[-_]/g, ' ');
  const contentType = getContentType(filename);

  console.log(`\n📤  Sending: ${filename}`);
  console.log(`    MessageID : ${messageId}`);
  console.log(`    From      : ${SENDER_EMAIL}`);
  console.log(`    Size      : ${(fileBuffer.length / 1024).toFixed(1)} KB`);

  const form = new FormData();
  form.append('timestamp', timestamp);
  form.append('token', token);
  form.append('signature', signature);
  form.append('from', SENDER_EMAIL);
  form.append('recipient', 'fun@mg.triolla.io');
  form.append('subject', `CV - ${candidateName}`);
  form.append('body-plain', `Hi,\n\nPlease find my CV attached.\n\nBest regards,\n${candidateName}`);
  form.append('message-headers', buildMessageHeaders(messageId));
  form.append('attachment-1', fileBuffer, { filename, contentType });

  const res = await fetch(`${API_BASE_URL}/api/webhooks/email`, {
    method: 'POST',
    headers: form.getHeaders(),
    body: form,
  });

  const responseText = await res.text();

  if (res.ok) {
    console.log(`✅  Accepted [${res.status}] → ${responseText}`);
    console.log(`\n    👉 Now watch docker compose logs -f worker for processing.`);
    console.log(`    👉 Then refresh Prisma Studio → email_intake_log to see the result.`);
    console.log(`    👉 MessageID to search for: ${messageId}`);
  } else {
    console.error(`❌  Rejected [${res.status}] → ${responseText}`);
  }

  return { ok: res.ok, messageId };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const filesDir = path.join(__dirname, 'files');

  if (args.includes('--health')) {
    await checkHealth();
    return;
  }

  const healthy = await checkHealth();
  if (!healthy) {
    console.error('\n⛔  Service degraded — fix health issues before running tests.');
    process.exit(1);
  }

  let filesToSend = [];

  if (args.length > 0 && !args[0].startsWith('--')) {
    const targetFile = path.join(filesDir, args[0]);
    if (!fs.existsSync(targetFile)) {
      console.error(`❌  File not found: ${targetFile}`);
      process.exit(1);
    }
    filesToSend = [args[0]];
  } else {
    if (!fs.existsSync(filesDir)) {
      console.error(`❌  Directory not found: ${filesDir}`);
      console.error(`    Create it and place CV files inside (PDF, DOC, DOCX).`);
      process.exit(1);
    }
    const supported = ['.pdf', '.doc', '.docx'];
    filesToSend = fs.readdirSync(filesDir).filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return supported.includes(ext) && !f.startsWith('.');
    });

    if (filesToSend.length === 0) {
      console.error(`❌  No CV files found in ${filesDir}`);
      console.error(`    Drop some PDF / DOC / DOCX files there and try again.`);
      process.exit(1);
    }
  }

  console.log(`\n📂  Files to send: ${filesToSend.join(', ')}`);

  const results = [];
  for (const filename of filesToSend) {
    const filePath = path.join(filesDir, filename);
    const fileBuffer = fs.readFileSync(filePath);
    const result = await sendWebhook(filename, fileBuffer);
    results.push({ filename, ...result });
    if (filesToSend.indexOf(filename) < filesToSend.length - 1) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  console.log('\n─────────────────────────────────────────────');
  console.log('📊 Summary:');
  results.forEach(({ filename, ok, messageId }) => {
    const icon = ok ? '✅' : '❌';
    console.log(`  ${icon}  ${filename.padEnd(40)} MessageID: ${messageId}`);
  });
  console.log('─────────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error('💥 Unexpected error:', err.message);
  process.exit(1);
});
```

> **Note:** The local runner uses the `form-data` npm package for multipart construction. Check if it's available: `node -e "require('form-data')"`. If not, install it: `npm install --save-dev form-data`.

- [ ] **Step 2: Check form-data availability**

```bash
node -e "require('form-data')" 2>&1
```

If the module is missing, run:

```bash
npm install --save-dev form-data
```

- [ ] **Step 3: Commit**

```bash
git add local-test/run.js package.json package-lock.json 2>/dev/null; true
git commit -m "chore(local-test): migrate runner to multipart/form-data + Mailgun HMAC signature"
```

---

## Task 11: Final Verification

- [ ] **Step 1: Run the full test suite**

```bash
npx jest --no-coverage 2>&1 | tail -10
```

Expected: all tests pass, zero failures.

- [ ] **Step 2: TypeScript compilation check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no output (zero errors).

- [ ] **Step 3: Verify no remaining Postmark references in webhooks module**

```bash
grep -r "postmark\|Postmark" src/webhooks/ --include="*.ts" -l
```

Expected: no output (zero files).

- [ ] **Step 4: Confirm the four deleted files are gone**

```bash
ls src/webhooks/dto/ src/webhooks/guards/
```

Expected output:

```
src/webhooks/dto/:
mailgun-payload.dto.spec.ts  mailgun-payload.dto.ts

src/webhooks/guards/:
mailgun-auth.guard.spec.ts  mailgun-auth.guard.ts
```

- [ ] **Step 5: Final commit (if any staged changes remain)**

```bash
git status
```

If clean, you're done. If there are unstaged changes, investigate before committing.

---

## Out-of-Scope (Manual / Infra Steps)

The following require Mailgun dashboard access and DNS changes — not implemented here:

1. **Add `mg.triolla.io` domain in Mailgun** → verify DNS (SPF, DKIM, MX records)
2. **Create inbound route** → `match_recipient("fun@mg.triolla.io")` → forward to `POST /webhooks/email`
3. **Retrieve signing key** → `Mailgun → Webhooks → HTTP webhook signing key` → set `MAILGUN_WEBHOOK_SIGNING_KEY` in production secrets
4. **Update Google Workspace routing rule** → change forwarding target from Postmark address to `fun@mg.triolla.io` — this is the cutover point
5. **Update production secrets** → swap `POSTMARK_WEBHOOK_TOKEN` for `MAILGUN_WEBHOOK_SIGNING_KEY` and update SMTP vars
6. **Install Mailgun MCP server** (optional) → `claude mcp add mailgun -- npx -y @mailgun/mcp-server -e MAILGUN_API_KEY=...`
