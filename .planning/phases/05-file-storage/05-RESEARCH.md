# Phase 5: File Storage - Research

**Researched:** 2026-03-22
**Domain:** Cloudflare R2 file storage integration, AWS S3 SDK client configuration, BullMQ error handling
**Confidence:** HIGH

## Summary

Phase 5 implements file persistence for original CV attachments (PDF/DOCX) to Cloudflare R2, the S3-compatible object storage service. The phase runs entirely within `IngestionProcessor.process()` and is positioned after AI extraction (Phase 4) but before duplicate detection (Phase 6) to ensure files are persisted before any processing decisions. The architecture follows the locked decisions from CONTEXT.md: largest-file-wins attachment selection, R2 object key storage (not URL), private bucket access, and transient failure retry via BullMQ.

This research covers: AWS SDK S3 client configuration with R2, ContentType handling, error propagation patterns, file selection logic, and test patterns compatible with NestJS + Jest.

**Primary recommendation:** Use `@aws-sdk/client-s3` v3.1014 with explicit `ContentType` on all PutObjectCommand operations, and let R2 upload errors propagate to BullMQ for automatic retry. StorageService should be injected with ConfigService for credential access.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Upload the **largest attachment** whose `ContentType` matches `application/pdf` or `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (DOCX). This filters out email signature images, logos, and other small embedded files.
- **D-02:** If no PDF/DOCX attachment is found after filtering, skip the upload — pass `null` as the file key through the processor context. No error is thrown; the job continues and Phase 7 will insert the candidate with `cv_file_url = null`.
- **D-03:** R2 bucket is **strictly private** — no public access.
- **D-04:** `candidates.cv_file_url` stores the **R2 object key** (e.g., `cvs/{tenantId}/{messageId}.pdf`), NOT a URL. Despite the column name, this is intentional.
- **D-05:** Pre-signed URLs are generated on-demand by the backend API when the recruiter UI needs to render/download a file. This endpoint is **Phase 2 / v2 scope** — not built here.
- **D-06:** The S3 client is configured with Cloudflare R2's S3-compatible endpoint: `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com`. Use `@aws-sdk/client-s3` with `PutObjectCommand`.
- **D-07:** Do **not** catch R2 upload errors in the processor. Let the error propagate so BullMQ retries the entire job automatically. The base64 attachment content is preserved in the job payload across retries.
- **D-08:** Do **not** update `email_intake_log.processing_status` to `'failed'` on upload errors. Only mark as `'failed'` when **all BullMQ retries are exhausted** (handled by BullMQ's `failed` event on the queue, not inline in the processor).
- **D-09:** This is different from Phase 3/4 error handling where failures are caught inline. Upload errors are transient (network/R2 outage) — retrying the full job is correct.
- **D-10:** Key format: `cvs/{tenantId}/{messageId}.pdf` or `cvs/{tenantId}/{messageId}.docx` — append the correct extension based on the attachment's `ContentType`.
- **D-11:** Explicitly set `ContentType` on the `PutObjectCommand` to match the file's MIME type so browsers can render/download the file properly.

### Claude's Discretion

- Whether `StorageService` uses constructor injection for `ConfigService` or reads env vars via a module-level config factory
- Whether to expose a single `upload(buffer, key, contentType)` method or a more domain-specific `uploadCv(...)` method
- Test strategy for `StorageService` (mock `@aws-sdk/client-s3` at the command level)

### Deferred Ideas (OUT OF SCOPE)

- Pre-signed URL generation endpoint for recruiter UI — Phase 2 (v2 API, RAPI scope)
- Multi-file upload (all CV attachments) — current decision is largest-wins; revisit if clients send portfolios
- R2 lifecycle rules (auto-delete after N days) — operational concern, post-Phase 7
- Activating the real Anthropic `generateObject` call in `ExtractionAgentService` — deferred from Phase 4, not Phase 5 scope

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| STOR-01 | Original CV file (PDF/DOCX) is uploaded to Cloudflare R2 at path `cvs/{tenantId}/{messageId}` before duplicate detection | StorageService selects largest PDF/DOCX via attachment filtering; PutObjectCommand sends buffer to R2 with correct extension appended to key |
| STOR-02 | R2 file URL is stored in `candidates.cv_file_url` — Postmark does not retain attachments after delivery | R2 object key (not URL) stored in `cv_file_url` column; pre-signed URL generation deferred to Phase 2 |
| STOR-03 | Full extracted CV text is stored in `candidates.cv_text` (PostgreSQL) | `cv_text` passed through ProcessingContext from Phase 3 output, written to database in Phase 7; research confirms no binary blobs stored in DB |

</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @aws-sdk/client-s3 | 3.1014.0 | S3-compatible object storage client; interfaces with Cloudflare R2 | AWS SDK v3 is the standard for S3/R2 integration in Node.js; modular, command-based API (PutObjectCommand) matches NestJS pattern |
| Cloudflare R2 | S3-compatible API | Object storage service for original CV files | 10GB free tier, S3-compatible endpoint, no egress charges within Cloudflare ecosystem, strict privacy (no public access) |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @nestjs/config | 4.0.3 | Environment variable access via ConfigService | Already injected in IngestionProcessor; StorageService receives ConfigService to read R2 credentials |
| zod | 4.3.6 | Schema validation for file operations | Already validated in env.ts (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME); no new schema needed for Phase 5 |

### Installation

R2 credentials are already in `env.ts` schema. Storage module adds zero new dependencies — @aws-sdk/client-s3 is already in package.json.

**Version verification:** `@aws-sdk/client-s3@3.1014.0` was verified against Cloudflare R2 compatibility as of 2026-03-22. As of February 3, 2025, AWS resolved CRC32 checksum compatibility issues with R2, making v3.1014 safe to use (released well after the fix).

## Architecture Patterns

### Recommended Project Structure

Phase 5 creates a new module `src/storage/` as specified in the architecture proposal:

```
src/storage/
├── storage.module.ts          # NestJS module registration
└── storage.service.ts         # R2 upload logic + file selection
```

Integration point:
- `src/ingestion/ingestion.processor.ts:117` — existing stub comment replaced with StorageService call

### Pattern 1: StorageService (NestJS @Injectable)

**What:** Single-method service following established NestJS pattern (spam-filter, attachment-extractor precedent).

**When to use:** Always wrap external API calls (R2) in a service layer for testability and reusability.

**Example:**

```typescript
// Source: Project convention (spam-filter.service.ts, attachment-extractor.service.ts)
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { PostmarkAttachmentDto } from '../../webhooks/dto/postmark-payload.dto';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private s3Client: S3Client;

  constructor(private readonly config: ConfigService) {
    this.s3Client = new S3Client({
      region: 'auto', // R2 uses 'auto' region
      credentials: {
        accessKeyId: this.config.get<string>('R2_ACCESS_KEY_ID')!,
        secretAccessKey: this.config.get<string>('R2_SECRET_ACCESS_KEY')!,
      },
      endpoint: `https://${this.config.get<string>('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    });
  }

  async upload(
    attachments: PostmarkAttachmentDto[],
    tenantId: string,
    messageId: string,
  ): Promise<string | null> {
    // D-01: Select largest PDF/DOCX attachment
    const selected = this.selectLargestCvAttachment(attachments);
    if (!selected) {
      // D-02: No qualifying file → return null, no error
      return null;
    }

    const extension = this.getExtension(selected.ContentType);
    const key = `cvs/${tenantId}/${messageId}${extension}`;
    const buffer = Buffer.from(selected.Content!, 'base64');

    // D-06, D-11: PutObjectCommand with explicit ContentType
    const command = new PutObjectCommand({
      Bucket: this.config.get<string>('R2_BUCKET_NAME')!,
      Key: key,
      Body: buffer,
      ContentType: selected.ContentType, // Explicit MIME type
    });

    // D-07: Let errors propagate — BullMQ retries entire job
    await this.s3Client.send(command);

    this.logger.log(`Uploaded ${key} to R2 (${buffer.length} bytes)`);
    return key; // Return object key, not URL (D-04)
  }

  private selectLargestCvAttachment(
    attachments: PostmarkAttachmentDto[],
  ): PostmarkAttachmentDto | null {
    // D-01: Filter for PDF/DOCX only, then select largest
    const cvFiles = attachments.filter((att) =>
      ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(att.ContentType),
    );

    if (cvFiles.length === 0) return null;

    return cvFiles.reduce((largest, current) =>
      (current.ContentLength ?? 0) > (largest.ContentLength ?? 0) ? current : largest,
    );
  }

  private getExtension(contentType: string): string {
    // D-10: Append correct extension based on ContentType
    const extensions: Record<string, string> = {
      'application/pdf': '.pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    };
    return extensions[contentType] || '.bin';
  }
}
```

### Pattern 2: Error Propagation in IngestionProcessor

**What:** Don't catch R2 errors inline. Let them bubble to BullMQ, which retries automatically.

**When to use:** For transient failures (network, rate limits, service outages) where retry is the correct response.

**Why different from Phase 3/4:** Phase 3/4 extraction errors are permanent failures (bad email data, unparseable PDF). Phase 5 upload failures are transient (network hiccup, R2 temporarily unavailable). BullMQ's exponential backoff is appropriate.

**Example:**

```typescript
// Source: .planning/phases/05-file-storage/05-CONTEXT.md (D-07, D-08, D-09)

// ✅ Phase 5 pattern (file storage):
const fileKey = await this.storageService.upload(payload.Attachments, tenantId, payload.MessageID);
// If upload fails, error propagates → BullMQ catches it → job moved to retry queue
// email_intake_log is NOT marked 'failed' until retries exhausted (handled by BullMQ failed event)

// ❌ Phase 3/4 pattern (extraction errors):
if (!extraction.fullName?.trim()) {
  // Mark as failed immediately — no retry
  await this.prisma.emailIntakeLog.update({ processingStatus: 'failed' });
  return;
}
```

### Pattern 3: ProcessingContext Extension

**What:** ProcessingContext carries file metadata forward to Phase 6/7.

**When to use:** Any data extracted in one phase needed by later phases.

**Current state (after Phase 4):**
```typescript
export interface ProcessingContext {
  fullText: string;
  suspicious: boolean;
}
```

**Phase 5 addition:**
```typescript
export interface ProcessingContext {
  fullText: string;
  suspicious: boolean;
  fileKey: string | null;  // R2 object key (D-04) or null if no file uploaded
  cvText: string;           // Extracted CV text from Phase 3 (passed to Phase 7)
}
```

### Anti-Patterns to Avoid

- **Storing the full file in ProcessingContext:** Base64 attachment already in job payload; storing again wastes memory.
- **Catching R2 errors and marking status 'failed':** Let BullMQ handle transient retries (D-07, D-08, D-09).
- **Storing presigned URL in cv_file_url:** Signed URLs expire; store object key instead and generate URL on-demand in Phase 2 (D-04, D-05).
- **Filtering for all attachment types:** Only PDF/DOCX; image attachments (signature.png, logo.jpg) are noise (D-01).
- **Not setting ContentType on PutObjectCommand:** Browsers won't know how to render/download the file (D-11).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| S3 authentication + credential management | Custom HTTP client with HMAC signing | @aws-sdk/client-s3 | AWS SDK handles credential chain, region resolution, endpoint routing, retryable transport errors |
| MIME type detection | String literals for each file type | ContentType from Postmark attachment + mapping table | Postmark payload includes ContentType; no external detection library needed |
| Retry logic on transient failures | Try-catch + manual exponential backoff | BullMQ's built-in retry mechanism | BullMQ already configured with 3 attempts + exponential backoff; re-throwing from processor is idiomatic |
| File size validation | Manual size checks in processor | ContentLength from PostmarkAttachmentDto | Postmark provides file size in payload; no additional validation needed for MVP |
| R2 region configuration | Hard-coded region codes | `region: 'auto'` in S3Client config | R2 distributes data globally; 'auto' region is the standard for R2 |

**Key insight:** Cloudflare R2 is fully S3-compatible, so standard AWS SDK patterns work unchanged. Don't write custom HTTP or authentication logic.

## Common Pitfalls

### Pitfall 1: Accidentally Storing Presigned URL Instead of Object Key

**What goes wrong:** Code stores `https://{account}.r2.cloudflarestorage.com/cvs/...` in `cv_file_url` instead of the object key. URL expires (or requires re-signing on retrieval), breaking recruiter UI links.

**Why it happens:** Field name `cv_file_url` suggests "full URL"; easy to assume that's what should be stored. But user decision D-04 specifies object key only.

**How to avoid:** Store only the `key` returned by `PutObjectCommand` (e.g., `cvs/{tenantId}/{messageId}.pdf`). URL generation happens in Phase 2 when the recruiter UI requests it. Add a comment in code: `// D-04: Store R2 object key, NOT presigned URL`

**Warning signs:** If code constructs a full URL before returning from StorageService, you're doing it wrong.

### Pitfall 2: Catching R2 Upload Errors and Marking Status 'Failed'

**What goes wrong:** Code tries to be "helpful" by catching S3Client exceptions and immediately marking `email_intake_log.processingStatus = 'failed'`. A transient network hiccup now permanently blocks this candidate from being processed.

**Why it happens:** Phase 3/4 patterns (extraction failures) catch errors inline. It's a familiar pattern. But R2 failures are transient; they should retry.

**How to avoid:** Never catch S3Client.send() errors in the processor. Let them propagate to BullMQ. Only BullMQ's `failed` event (after all retries exhausted) updates status to 'failed'. Add a comment: `// D-07: Transient R2 errors propagate to BullMQ for automatic retry`

**Warning signs:** Any try-catch around `await this.storageService.upload(...)` in IngestionProcessor.

### Pitfall 3: Not Setting ContentType on PutObjectCommand

**What goes wrong:** File uploads to R2 successfully, but when recruiter clicks "download", the browser treats it as binary (`application/octet-stream`) and prompts to save instead of opening in a reader.

**Why it happens:** ContentType is optional in S3Client API; easy to forget. AWS SDK won't auto-detect from filename.

**How to avoid:** Always include `ContentType: selectedAttachment.ContentType` in PutObjectCommand. Verify in unit tests that ContentType appears in the command. Add a comment: `// D-11: Explicit ContentType enables browser rendering`

**Warning signs:** PutObjectCommand without ContentType field; test mocks that don't verify ContentType was passed.

### Pitfall 4: Filtering for "All Attachments" or "First Attachment"

**What goes wrong:** Code uploads signature images, embedded logos, or other noise as the "CV". Recruiter has 200 emails with 1KB PNG signature files instead of actual PDFs.

**Why it happens:** Easier to just grab the first attachment than to filter. But Postmark emails often have embedded images in the message body PLUS the actual CV.

**How to avoid:** Implement `selectLargestCvAttachment()` filter: only accept `application/pdf` and `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, then pick the largest. Add a comment: `// D-01: Largest PDF/DOCX only; filters out signature images`

**Warning signs:** Code referencing `payload.Attachments[0]` or looping through all attachments without type checking.

### Pitfall 5: R2 Credentials Missing or Wrong Endpoint

**What goes wrong:** S3Client connects successfully but all PutObjectCommand calls fail with authentication errors or 404s. Job retries 3 times and goes to dead-letter queue.

**Why it happens:** R2 endpoint is not a standard AWS S3 region; it's `https://{ACCOUNT_ID}.r2.cloudflarestorage.com`. Easy to use `s3.amazonaws.com` by mistake. Or env vars are empty because `.env` wasn't sourced.

**How to avoid:** Verify env vars at application startup (already done via Zod in env.ts). In tests, mock S3Client.send() at the command level so endpoint mismatches are caught. Add integration test that verifies S3Client was instantiated with correct endpoint.

**Warning signs:** Tests pass but production job logs show "Cannot create S3 client" or "PutObjectCommand failed with 404"; env var validation error at startup.

## Code Examples

### Unit Test: StorageService (Mock S3Client)

```typescript
// Source: Project convention (spam-filter.service.spec.ts pattern)

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';
import { PostmarkAttachmentDto } from '../../webhooks/dto/postmark-payload.dto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

jest.mock('@aws-sdk/client-s3');

describe('StorageService', () => {
  let service: StorageService;
  let config: ConfigService;
  let s3Client: jest.Mocked<S3Client>;

  beforeEach(async () => {
    const mockConfig = {
      get: jest.fn((key: string) => {
        const vars: Record<string, string> = {
          R2_ACCOUNT_ID: 'test-account',
          R2_ACCESS_KEY_ID: 'test-key',
          R2_SECRET_ACCESS_KEY: 'test-secret',
          R2_BUCKET_NAME: 'test-bucket',
        };
        return vars[key];
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
    config = module.get<ConfigService>(ConfigService);
    s3Client = (S3Client as jest.MockedClass<typeof S3Client>).mock
      .instances[0] as jest.Mocked<S3Client>;
  });

  it('STOR-01: uploads largest PDF to R2 with correct key format', async () => {
    const attachments: PostmarkAttachmentDto[] = [
      {
        Name: 'signature.png',
        ContentType: 'image/png',
        ContentLength: 5000,
        Content: Buffer.from('PNG data').toString('base64'),
      },
      {
        Name: 'cv.pdf',
        ContentType: 'application/pdf',
        ContentLength: 150000,
        Content: Buffer.from('PDF data').toString('base64'),
      },
    ];

    s3Client.send = jest.fn().mockResolvedValue({});

    const key = await service.upload(attachments, 'tenant-123', 'msg-456');

    expect(key).toBe('cvs/tenant-123/msg-456.pdf');
    expect(s3Client.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Key: 'cvs/tenant-123/msg-456.pdf',
          Bucket: 'test-bucket',
          ContentType: 'application/pdf',
        }),
      }),
    );
  });

  it('STOR-01: returns null if no PDF/DOCX attachment found', async () => {
    const attachments: PostmarkAttachmentDto[] = [
      {
        Name: 'signature.png',
        ContentType: 'image/png',
        ContentLength: 5000,
        Content: Buffer.from('PNG data').toString('base64'),
      },
    ];

    const key = await service.upload(attachments, 'tenant-123', 'msg-456');

    expect(key).toBeNull();
    expect(s3Client.send).not.toHaveBeenCalled();
  });

  it('STOR-02: does NOT return presigned URL, only object key', async () => {
    const attachments: PostmarkAttachmentDto[] = [
      {
        Name: 'cv.pdf',
        ContentType: 'application/pdf',
        ContentLength: 150000,
        Content: Buffer.from('PDF data').toString('base64'),
      },
    ];

    s3Client.send = jest.fn().mockResolvedValue({});

    const key = await service.upload(attachments, 'tenant-123', 'msg-456');

    // Key should NOT contain URL components
    expect(key).not.toContain('https://');
    expect(key).not.toContain('r2.cloudflarestorage.com');
    // Key should be pure object path
    expect(key).toMatch(/^cvs\/[^/]+\/[^/]+\.(pdf|docx)$/);
  });

  it('D-11: sets explicit ContentType on PutObjectCommand', async () => {
    const attachments: PostmarkAttachmentDto[] = [
      {
        Name: 'cv.docx',
        ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ContentLength: 100000,
        Content: Buffer.from('DOCX data').toString('base64'),
      },
    ];

    s3Client.send = jest.fn().mockResolvedValue({});

    await service.upload(attachments, 'tenant-123', 'msg-456');

    expect(s3Client.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      }),
    );
  });

  it('D-07: propagates R2 errors to caller (no catch)', async () => {
    const attachments: PostmarkAttachmentDto[] = [
      {
        Name: 'cv.pdf',
        ContentType: 'application/pdf',
        ContentLength: 150000,
        Content: Buffer.from('PDF data').toString('base64'),
      },
    ];

    const uploadError = new Error('R2 temporarily unavailable');
    s3Client.send = jest.fn().mockRejectedValue(uploadError);

    await expect(
      service.upload(attachments, 'tenant-123', 'msg-456'),
    ).rejects.toThrow('R2 temporarily unavailable');
  });
});
```

### Integration Test: IngestionProcessor with Storage

```typescript
// Source: Project convention (ingestion.processor.spec.ts pattern)

describe('IngestionProcessor with StorageService', () => {
  let processor: IngestionProcessor;
  let storage: StorageService;

  beforeEach(async () => {
    // Mock StorageService
    const mockStorage = {
      upload: jest.fn(),
    };

    processor = new IngestionProcessor(
      spamFilter,
      attachmentExtractor,
      prisma,
      config,
      extractionAgent,
      mockStorage as unknown as StorageService,
    );
    storage = mockStorage as unknown as StorageService;
  });

  it('STOR-01: calls storageService.upload before dedup', async () => {
    const payload = mockPostmarkPayload({
      Attachments: [
        {
          Name: 'cv.pdf',
          ContentType: 'application/pdf',
          ContentLength: 150000,
          Content: Buffer.from('PDF data').toString('base64'),
        },
      ],
    });

    (storage.upload as jest.Mock).mockResolvedValue('cvs/tenant-1/msg-123.pdf');

    const job = { id: '1', data: payload };
    await processor.process(job as Job<PostmarkPayloadDto>);

    expect(storage.upload).toHaveBeenCalledWith(
      payload.Attachments,
      'tenant-id',
      payload.MessageID,
    );
  });

  it('D-07: does NOT catch upload errors; lets them propagate', async () => {
    const payload = mockPostmarkPayload({
      Attachments: [
        {
          Name: 'cv.pdf',
          ContentType: 'application/pdf',
          ContentLength: 150000,
          Content: Buffer.from('PDF data').toString('base64'),
        },
      ],
    });

    (storage.upload as jest.Mock).mockRejectedValue(
      new Error('R2 service unavailable'),
    );

    const job = { id: '1', data: payload };

    await expect(processor.process(job as Job<PostmarkPayloadDto>)).rejects.toThrow(
      'R2 service unavailable',
    );
  });

  it('D-02: passes null fileKey if no attachment found', async () => {
    const payload = mockPostmarkPayload({ Attachments: [] });

    (storage.upload as jest.Mock).mockResolvedValue(null);

    const job = { id: '1', data: payload };
    await processor.process(job as Job<PostmarkPayloadDto>);

    expect(storage.upload).toHaveBeenCalled();
    // Processor continues without error
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| AWS SDK v2 (aws-sdk) | AWS SDK v3 (@aws-sdk/client-s3) | 2022 | Modular, command-based API; better tree-shaking; improved TypeScript support |
| Storing presigned URLs in database | Storing object keys + generating signed URLs on-demand | 2024 | Signed URLs have TTL; regenerating on-demand is more flexible and secure |
| In-memory file handling | Stream-based uploads with Buffer.from() | 2023 | Buffers are fine for MVP scale (~17 emails/day, CVs typically <5MB); streaming unnecessary |
| Synchronous file operations | Async/await with Promise-based APIs | Always in this stack | Standard Node.js + NestJS pattern |

**Deprecated/outdated:**
- AWS SDK v2 (aws-sdk): Replaced by @aws-sdk/* modular packages; v2 is in maintenance-only mode.
- Multipart upload for small files: Unnecessary for CVs (<5MB); PutObjectCommand handles up to 5GB in single request.

## Open Questions

1. **ContentType mapping edge cases**
   - What we know: Postmark provides ContentType field; standard MIME types are well-defined
   - What's unclear: How to handle edge cases where attachment has wrong ContentType (e.g., `.pdf` file with `application/octet-stream` type)
   - Recommendation: For MVP, trust Postmark's ContentType field. If real-world issues arise (emails with mistyped attachments), add fallback based on file extension. Test to ensure we don't reject legitimate CVs.

2. **File size limits and validation**
   - What we know: R2 accepts up to 5GB per object; Postmark includes ContentLength in payload
   - What's unclear: Should we validate file size client-side before uploading? What's the max reasonable CV file size?
   - Recommendation: No validation needed for MVP. Postmark will reject emails with attachments >25MB at the email provider level. If needed later, add soft limit (e.g., warn if >10MB, reject if >50MB).

3. **R2 bucket lifecycle and retention**
   - What we know: Bucket is private; no lifecycle rules configured yet
   - What's unclear: How long should CVs be retained? Should old files auto-delete?
   - Recommendation: Deferred to Phase 7 / operations phase. For MVP, keep all files indefinitely. Document in comments that lifecycle rules may be added post-MVP.

4. **Concurrent upload errors and rate limiting**
   - What we know: BullMQ retry handles transient failures; 3 attempts with exponential backoff
   - What's unclear: Will R2 rate-limit concurrent uploads from the worker? What's the correct backoff strategy?
   - Recommendation: MVP doesn't handle rate-limiting. BullMQ's default exponential backoff (5s initial) should suffice at 17 emails/day scale. If rate-limiting becomes an issue, add custom backoff strategy or concurrency control in BullMQ worker config.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest (v30.0.0) + @nestjs/testing |
| Config file | None — Jest configured inline in package.json |
| Quick run command | `npm test -- storage.service.spec.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| STOR-01 | Largest PDF/DOCX selected from attachments; uploaded to R2 with key `cvs/{tenantId}/{messageId}.{ext}` | Unit | `npm test -- storage.service.spec.ts --testNamePattern="uploads largest"` | ✅ (Wave 1) |
| STOR-02 | Object key (not URL) returned and stored in `cv_file_url` column | Unit | `npm test -- storage.service.spec.ts --testNamePattern="does NOT return presigned"` | ✅ (Wave 1) |
| STOR-03 | `cv_text` from Phase 3 passed through ProcessingContext to Phase 7 | Integration | `npm test -- ingestion.processor.spec.ts --testNamePattern="ProcessingContext"` | ✅ Wave 0 (update in Phase 5) |
| D-01 | Only PDF/DOCX attachments considered; other types ignored | Unit | `npm test -- storage.service.spec.ts --testNamePattern="returns null if no PDF"` | ✅ (Wave 1) |
| D-07 | R2 upload errors propagate to BullMQ without inline catch | Unit | `npm test -- storage.service.spec.ts --testNamePattern="propagates R2 errors"` | ✅ (Wave 1) |
| D-11 | ContentType explicitly set on PutObjectCommand | Unit | `npm test -- storage.service.spec.ts --testNamePattern="sets explicit ContentType"` | ✅ (Wave 1) |

### Sampling Rate

- **Per task commit:** `npm test -- storage.service.spec.ts` (StorageService unit tests only, ~5s)
- **Per wave merge:** `npm test` (full suite including IngestionProcessor integration, ~30s)
- **Phase gate:** Full suite green + integration tests pass before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/storage/storage.service.ts` — Core service implementation
- [ ] `src/storage/storage.module.ts` — NestJS module registration
- [ ] `src/storage/storage.service.spec.ts` — Unit tests (5+ tests covering STOR-01, STOR-02, D-01, D-07, D-11)
- [ ] `src/ingestion/ingestion.processor.spec.ts` — Update integration tests to verify StorageService integration (mock or real)
- [ ] ProcessingContext interface update — Add `fileKey: string | null` and `cvText: string` fields

## Sources

### Primary (HIGH confidence)

- **Cloudflare R2 Documentation** (https://developers.cloudflare.com/r2/): S3 API compatibility, endpoint configuration, PutObjectCommand integration
- **AWS SDK for JavaScript v3 Docs** (https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/): S3Client, PutObjectCommand API, credential chain, error handling
- **Project architecture spec** (`spec/backend-architecture-proposal.md`): StorageService module layout, IngestionProcessor pseudocode, ProcessingContext flow, cv_file_url column definition
- **Project environment schema** (`src/config/env.ts`): R2 credentials validation (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME)
- **BullMQ Documentation** (https://docs.bullmq.io/): Job retry mechanism, error propagation, idempotent design patterns

### Secondary (MEDIUM confidence)

- **Cloudflare R2 Compatibility Issues** (https://community.cloudflare.com/t/aws-sdk-client-s3-v3-729-0-breaks-uploadpart-and-putobject-r2-s3-api-compatibility/758637): CRC32 checksum issue resolved as of Feb 2025; v3.1014 is post-fix and compatible
- **AWS SDK ContentType Best Practices** (https://github.com/aws/aws-sdk-js-v3/issues/5268): Explicit ContentType configuration, casing importance, browser rendering dependency
- **NestJS Testing Patterns** (Project services: spam-filter.service.spec.ts, attachment-extractor.service.spec.ts): Mock strategies, @Injectable pattern, ConfigService injection

### Tertiary (LOW confidence)

- None — all major findings verified via official docs or project code.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — @aws-sdk/client-s3 is AWS-maintained standard for S3/R2; R2 officially supports it
- Architecture: HIGH — Aligns with project spec; StorageService follows established NestJS pattern in codebase
- Error handling: HIGH — BullMQ retry mechanism is documented and used in project; error propagation is explicit in CONTEXT.md
- Pitfalls: MEDIUM-HIGH — Derived from AWS SDK docs + real-world R2 integration reports; some edge cases (ContentType mismatches) are LOW confidence

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (30 days — AWS SDK and R2 API stable; ContentType handling unlikely to change)

---

*Phase: 05-file-storage*
*Context gathered: 2026-03-22*
