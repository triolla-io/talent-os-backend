# Email → Candidate: CV Classification Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an affirmative "is this email a job application / CV?" decision *before* a candidate is ever created, so non-CV emails (invoices, sales, newsletters, replies) stop becoming candidates.

**Architecture:** A new single-purpose `CvClassifierService` returns one of three verdicts (`cv` / `not_cv` / `uncertain`) using a deterministic short-circuit (known agency + attachment → `cv`, no AI) plus an AI judge (`generateObject` via OpenRouter, `temperature: 0`, R2-cached by `messageId`). The ingestion processor calls it after `fullText` is built and before AI extraction: `cv` continues the existing pipeline unchanged; `not_cv` stamps `email_intake_log.processing_status = 'not_cv'` and returns; `uncertain` stamps `needs_review` and returns. No candidate is created on the two terminal paths, and no email is deleted (everything stays in `email_intake_log` + R2).

**Tech Stack:** TypeScript, NestJS 11, BullMQ, Prisma 7 / PostgreSQL 16, Zod, `ai` (`generateObject`) + `@openrouter/ai-sdk-provider`, Cloudflare R2 (`@aws-sdk/client-s3`), Jest.

## Context (why this change)

Today **almost every inbound email becomes a candidate**. The pipeline never asks "is this a job application?" — it only runs a keyword spam blocklist (fails open) and treats any non-image attachment as a CV, then the extraction LLM is *told* the input is a CV and is asked for a `full_name`, which it almost always finds (sender, signature, "Dear David"). A non-empty `full_name` is the only gate to candidate creation (`ingestion.processor.ts:139`). Net effect: *not-obvious-spam + any-name-found → candidate*.

The fix is to add an explicit classification gate whose **only** job is the verdict (it does not extract fields — the extractor stays separate, because the extractor is told "this is a CV" and so cannot be trusted to judge whether it is one). Posture: **strict, but never lose a real candidate** — when genuinely unsure, route to a human (`needs_review`) rather than guess.

Source spec: `docs/superpowers/specs/2026-06-18-email-cv-classification-gate-design.md`.

### Design decisions resolved during planning (deviations from the spec's file list — all verified against the code)

1. **`hasMeaningfulAttachment` is exposed by making the existing `SpamFilterService` method `public` — NOT by extending `SpamFilterResult`.** `spam-filter.service.spec.ts` asserts the result with exact `expect(result).toEqual<SpamFilterResult>({ isSpam, suspicious })` in 12 tests; adding fields to `SpamFilterResult` would break all of them. Flipping `private hasMeaningfulAttachment` → `public hasMeaningfulAttachment` is a zero-behavior, zero-test-change edit and avoids duplicating the inline-image/calendar/.ics logic in the processor. `bodyLength` is computed inline in the processor as `(payload.TextBody ?? '').trim().length` (identical to what the spam filter computes — a faithful one-liner, no logic to duplicate).
2. **The processor computes `resolvedAgency` via `resolveAgencyFromEmail`, which is exported from `extraction-agent.service.ts`.** That function is currently module-private (`extraction-agent.service.ts:41`) and used only internally. Exporting it (add the `export` keyword) is non-breaking. The classifier therefore takes `resolvedAgency` as an input (per the spec interface) and stays decoupled from the agency map.
3. **The R2 verdict cache is definite, not "maybe."** Add `saveClassificationCache` / `loadClassificationCache` to `StorageService`, mirroring the existing `saveExtractionCache` / `loadExtractionCache` exactly (key `emails/{tenantId}/{messageId}/classification.json`).
4. **Removing the dead `suspicious` parameter from `ExtractionAgentService` is split into an independent, optional final task (Task 4).** It touches a test file (`extraction-agent.service.spec.ts`) and the test helper, and a reviewer could legitimately ship the gate (Tasks 1–3) without it. The `suspicious` signal itself stays alive — it is now *consumed by the classifier* (its real purpose) and still returned by `SpamFilterResult`.

**Verified facts:** `email_intake_log.processing_status` is `@db.Text` with **no CHECK constraint** (`schema.prisma:259`; init migration `prisma/migrations/20260405120723_init/migration.sql:119` = `"processing_status" TEXT NOT NULL DEFAULT 'pending'`) — so `not_cv` and `needs_review` need **no migration**. `suspicious` is read by **no** decision in `dedup/` or `scoring/` (grep-confirmed) — safe to remove in Task 4. The `@nestjs/config` `ConfigService` is injected without a module import (ConfigModule is global), so `CvClassifierService` needs no new module wiring beyond being listed as a provider.

## Global Constraints

- **TypeScript only.** NestJS 11, BullMQ + Redis, Prisma 7, PostgreSQL 16 — locked.
- **No database migration** in this work. New `processing_status` values are plain strings.
- **No frontend.** Backend logic only. (The "Review inbox" UI for the `needs_review` pile is explicitly out of scope.)
- **AI** goes through `@openrouter/ai-sdk-provider` + `ai`'s `generateObject`, `temperature: 0`. Classifier model: env `CLASSIFIER_MODEL`, default `openai/gpt-4o-mini`.
- **Cache** (R2) is keyed by `messageId` so BullMQ retries never re-call the model. Cache *save* failures must soft-fail (log + continue); cache *infra* is the existing `StorageService` S3 client.
- **Error posture:** an AI/classifier failure **throws** so BullMQ retries (3 attempts, exponential backoff); the processor stamps `failed` (visible) before re-throwing, mirroring the extraction path (`ingestion.processor.ts:126-136`).
- **TDD, frequent commits, DRY, YAGNI.** Existing `spam-filter`, `extraction-agent`, `storage`, and `ingestion.processor` specs must stay green.
- **Run tests with:** `npm test` (Jest). Single file: `npm test -- <path-or-pattern>`. Type-check/build: `npm run build`. Lint: `npm run lint`.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/storage/storage.service.ts` | **Edit** — add `saveClassificationCache` / `loadClassificationCache` (R2 verdict cache) | 1 |
| `src/storage/storage.service.spec.ts` | **Edit** — tests for the two new cache helpers | 1 |
| `src/config/env.ts` | **Edit** — add `CLASSIFIER_MODEL` env (default `openai/gpt-4o-mini`) | 2 |
| `src/ingestion/services/cv-classifier.service.ts` | **New** — the verdict service (Layer 1 short-circuit + Layer 2 AI judge + cache) | 2 |
| `src/ingestion/services/cv-classifier.service.spec.ts` | **New** — unit spec (AI mocked) | 2 |
| `src/ingestion/services/spam-filter.service.ts` | **Edit** — make `hasMeaningfulAttachment` `public` (1 word) | 3 |
| `src/ingestion/services/extraction-agent.service.ts` | **Edit** — `export` `resolveAgencyFromEmail` (Task 3); drop `suspicious` param (Task 4) | 3, 4 |
| `src/ingestion/ingestion.module.ts` | **Edit** — register `CvClassifierService` as a provider | 3 |
| `src/ingestion/ingestion.processor.ts` | **Edit** — inject classifier; insert the gate; (Task 4) drop `suspicious` threading | 3, 4 |
| `src/ingestion/ingestion.processor.spec.ts` | **Edit** — add the classifier mock to all 7 provider arrays; add 4 gate integration tests | 3 |
| `src/ingestion/services/extraction-agent.service.spec.ts` | **Edit (Task 4)** — drop `suspicious` arg / assertions | 4 |
| `src/ingestion/services/extraction-agent.service.test-helpers.ts` | **Edit (Task 4)** — drop `suspicious` from `mockCandidateExtract` | 4 |

**Task order:** 1 → 2 → 3 are sequential (each consumes the prior). Task 4 is independent and optional; do it last or skip it without affecting the gate.

---

## Task 1: R2 verdict cache helpers in `StorageService`

**Files:**
- Modify: `src/storage/storage.service.ts` (add two methods after `loadExtractionCache`, i.e. after line 166)
- Test: `src/storage/storage.service.spec.ts` (add a `describe` block after the existing `saveExtractionCache / loadExtractionCache` block, ~line 205)

**Interfaces:**
- Consumes: existing private `this.s3Client`, `this.config`, `this.logger`; existing test scaffolding (`mockS3Send`, `mockConfigService`).
- Produces:
  - `saveClassificationCache(result: Record<string, unknown>, tenantId: string, messageId: string): Promise<void>`
  - `loadClassificationCache(tenantId: string, messageId: string): Promise<Record<string, unknown> | null>`
  - R2 key format: `emails/{tenantId}/{messageId}/classification.json`

- [ ] **Step 1: Write the failing tests**

Add to `src/storage/storage.service.spec.ts`, immediately after the closing `});` of the existing `describe('saveExtractionCache / loadExtractionCache', ...)` block (around line 205), still inside the top-level `describe('StorageService', ...)`:

```ts
  describe('saveClassificationCache / loadClassificationCache', () => {
    it('saveClassificationCache PUTs to key emails/t/m/classification.json as JSON', async () => {
      mockS3Send.mockResolvedValue({});
      const result = { verdict: 'not_cv', reason: 'invoice PDF' };

      await service.saveClassificationCache(result, 't', 'm');

      expect(mockS3Send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Key: 'emails/t/m/classification.json',
            Bucket: 'test-bucket',
            ContentType: 'application/json',
          }),
        }),
      );
    });

    it('loadClassificationCache returns parsed JSON on cache hit', async () => {
      const cached = { verdict: 'cv', reason: 'resume' };
      mockS3Send.mockResolvedValue({
        Body: { transformToString: jest.fn().mockResolvedValue(JSON.stringify(cached)) },
      });

      const result = await service.loadClassificationCache('tenant-1', 'msg-1');

      expect(result).toEqual(cached);
      expect(mockS3Send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ Key: 'emails/tenant-1/msg-1/classification.json' }),
        }),
      );
    });

    it('loadClassificationCache returns null on NoSuchKey error', async () => {
      const noSuchKeyError = new Error('NoSuchKey');
      noSuchKeyError.name = 'NoSuchKey';
      mockS3Send.mockRejectedValue(noSuchKeyError);

      const result = await service.loadClassificationCache('tenant-1', 'msg-1');

      expect(result).toBeNull();
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- storage.service`
Expected: FAIL — `service.saveClassificationCache is not a function` (and likewise `loadClassificationCache`).

- [ ] **Step 3: Implement the two methods**

In `src/storage/storage.service.ts`, insert directly after the `loadExtractionCache` method (after line 166, before `private selectLargestCvAttachment`):

```ts
  async saveClassificationCache(result: Record<string, unknown>, tenantId: string, messageId: string): Promise<void> {
    const key = `emails/${tenantId}/${messageId}/classification.json`;
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.config.get<string>('R2_BUCKET_NAME')!,
        Key: key,
        Body: JSON.stringify(result),
        ContentType: 'application/json',
      }),
    );
    this.logger.log(`Cached classification result at ${key}`);
  }

  async loadClassificationCache(tenantId: string, messageId: string): Promise<Record<string, unknown> | null> {
    const key = `emails/${tenantId}/${messageId}/classification.json`;
    try {
      const response = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: this.config.get<string>('R2_BUCKET_NAME')!,
          Key: key,
        }),
      );
      const body = await response.Body!.transformToString();
      return JSON.parse(body) as Record<string, unknown>;
    } catch (err: any) {
      if (err.name === 'NoSuchKey') return null;
      throw err;
    }
  }
```

(`PutObjectCommand` and `GetObjectCommand` are already imported at the top of the file — line 3.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- storage.service`
Expected: PASS — all StorageService tests green (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/storage/storage.service.ts src/storage/storage.service.spec.ts
git commit -m "feat(storage): add R2 cache helpers for CV classification verdict"
```

---

## Task 2: `CvClassifierService` (the verdict)

**Files:**
- Modify: `src/config/env.ts` (add `CLASSIFIER_MODEL` after line 25)
- Create: `src/ingestion/services/cv-classifier.service.ts`
- Test: `src/ingestion/services/cv-classifier.service.spec.ts`

**Interfaces:**
- Consumes: `ConfigService` (`OPENROUTER_API_KEY`, `CLASSIFIER_MODEL`); `StorageService.loadClassificationCache` / `saveClassificationCache` (Task 1); `generateObject` from `ai`; `createOpenRouter` from `@openrouter/ai-sdk-provider`.
- Produces (exported from `cv-classifier.service.ts`):
  - `interface CvClassifierInput { fullText: string; subject: string; fromEmail: string; suspicious: boolean; hasMeaningfulAttachment: boolean; bodyLength: number; resolvedAgency: string | null; tenantId: string; messageId: string; }`
  - `type CvVerdict = 'cv' | 'not_cv' | 'uncertain'`
  - `const CvClassificationSchema` (Zod: `{ verdict: enum, reason: string }`)
  - `type CvClassification = z.infer<typeof CvClassificationSchema>` (i.e. `{ verdict: CvVerdict; reason: string }`)
  - `class CvClassifierService` with `classify(input: CvClassifierInput): Promise<CvClassification>`

- [ ] **Step 1: Add the `CLASSIFIER_MODEL` env**

In `src/config/env.ts`, after line 25 (`SCORING_MODEL: z.string().default('openai/gpt-4o-mini'),`) add:

```ts
  CLASSIFIER_MODEL: z.string().default('openai/gpt-4o-mini'),
```

- [ ] **Step 2: Write the failing unit spec**

Create `src/ingestion/services/cv-classifier.service.spec.ts`:

```ts
import { CvClassifierService, CvClassifierInput } from './cv-classifier.service';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../../storage/storage.service';
import { generateObject } from 'ai';

jest.mock('ai', () => ({
  generateObject: jest.fn(),
}));

jest.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: jest.fn().mockReturnValue({
    chat: jest.fn().mockReturnValue('mocked-model'),
  }),
}));

const mockGenerateObject = generateObject as jest.MockedFunction<typeof generateObject>;

function makeService(
  storage?: Partial<{ loadClassificationCache: jest.Mock; saveClassificationCache: jest.Mock }>,
): CvClassifierService {
  const configService = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'CLASSIFIER_MODEL') return 'openai/gpt-4o-mini';
      return 'fake-openrouter-key';
    }),
  } as unknown as ConfigService;
  const mockStorage = {
    loadClassificationCache: jest.fn().mockResolvedValue(null),
    saveClassificationCache: jest.fn().mockResolvedValue(undefined),
    ...(storage ?? {}),
  } as unknown as StorageService;
  return new CvClassifierService(configService, mockStorage);
}

const BASE_INPUT: CvClassifierInput = {
  fullText: 'some email text',
  subject: 'Test Subject',
  fromEmail: 'test@example.com',
  suspicious: false,
  hasMeaningfulAttachment: false,
  bodyLength: 200,
  resolvedAgency: null,
  tenantId: 'tenant-uuid',
  messageId: 'msg-uuid',
};

describe('CvClassifierService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('short-circuits to "cv" for a known agency sender with an attachment (no AI call)', async () => {
    const service = makeService();
    const result = await service.classify({
      ...BASE_INPUT,
      resolvedAgency: 'jobhunt',
      hasMeaningfulAttachment: true,
    });

    expect(result.verdict).toBe('cv');
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it('does NOT short-circuit when a known agency sender has no attachment (falls through to AI)', async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: { verdict: 'uncertain', reason: 'no document' } } as any);
    const service = makeService();

    await service.classify({ ...BASE_INPUT, resolvedAgency: 'jobhunt', hasMeaningfulAttachment: false });

    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
  });

  it.each(['cv', 'not_cv', 'uncertain'] as const)('returns the AI verdict "%s" verbatim', async (verdict) => {
    mockGenerateObject.mockResolvedValueOnce({ object: { verdict, reason: 'because' } } as any);
    const service = makeService();

    const result = await service.classify(BASE_INPUT);

    expect(result).toEqual({ verdict, reason: 'because' });
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
  });

  it('returns the cached verdict without calling AI on a cache hit', async () => {
    const service = makeService({
      loadClassificationCache: jest.fn().mockResolvedValue({ verdict: 'not_cv', reason: 'cached invoice' }),
    });

    const result = await service.classify(BASE_INPUT);

    expect(result).toEqual({ verdict: 'not_cv', reason: 'cached invoice' });
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it('propagates AI errors so BullMQ retries', async () => {
    mockGenerateObject.mockRejectedValueOnce(new Error('Network timeout'));
    const service = makeService();

    await expect(service.classify(BASE_INPUT)).rejects.toThrow('Network timeout');
  });

  it('caches the verdict after a successful AI call', async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: { verdict: 'cv', reason: 'looks like a resume' } } as any);
    const saveClassificationCache = jest.fn().mockResolvedValue(undefined);
    const service = makeService({ saveClassificationCache });

    await service.classify(BASE_INPUT);

    expect(saveClassificationCache).toHaveBeenCalledWith(
      { verdict: 'cv', reason: 'looks like a resume' },
      'tenant-uuid',
      'msg-uuid',
    );
  });

  it('still returns the verdict when caching fails (soft-fail)', async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: { verdict: 'cv', reason: 'resume' } } as any);
    const service = makeService({
      saveClassificationCache: jest.fn().mockRejectedValue(new Error('R2 down')),
    });

    const result = await service.classify(BASE_INPUT);

    expect(result.verdict).toBe('cv');
  });

  it('passes the clues (attachment, suspicious, agency) into the AI prompt', async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: { verdict: 'cv', reason: 'r' } } as any);
    const service = makeService();

    await service.classify({
      ...BASE_INPUT,
      subject: 'Presenting candidate',
      fromEmail: 'talent@jobhunt.co.il',
      suspicious: true,
      hasMeaningfulAttachment: true,
      resolvedAgency: 'jobhunt',
    });

    const callArg = mockGenerateObject.mock.calls[0][0] as any;
    expect(callArg.prompt).toContain('Subject: Presenting candidate');
    expect(callArg.prompt).toContain('From: talent@jobhunt.co.il');
    expect(callArg.prompt).toContain('Resolved recruiting agency: jobhunt');
    expect(callArg.temperature).toBe(0);
    expect(callArg.model).toBe('mocked-model');
  });
});
```

- [ ] **Step 3: Run the spec to verify it fails**

Run: `npm test -- cv-classifier.service`
Expected: FAIL — cannot find module `./cv-classifier.service` (file does not exist yet).

- [ ] **Step 4: Implement `CvClassifierService`**

Create `src/ingestion/services/cv-classifier.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateObject } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import { StorageService } from '../../storage/storage.service';

export type CvVerdict = 'cv' | 'not_cv' | 'uncertain';

export const CvClassificationSchema = z.object({
  verdict: z.enum(['cv', 'not_cv', 'uncertain']),
  reason: z.string(),
});

export type CvClassification = z.infer<typeof CvClassificationSchema>;

export interface CvClassifierInput {
  fullText: string; // body + attachment text (already built in the processor)
  subject: string;
  fromEmail: string;
  suspicious: boolean; // revived spam-filter signal
  hasMeaningfulAttachment: boolean;
  bodyLength: number;
  resolvedAgency: string | null; // from resolveAgencyFromEmail()
  tenantId: string;
  messageId: string; // for retry-safe caching
}

const INSTRUCTIONS = `You are a strict gatekeeper for an Israeli recruiting platform's email intake.
Your ONLY job is to decide whether an inbound email is a job application.

It IS a job application ("cv") when it is any of:
- a candidate sending their CV / resume (as text or as an attachment),
- a cover letter or an email expressing interest in a specific job,
- a recruiting agency presenting or submitting a candidate.

It is NOT a job application ("not_cv") when it is any of:
- an invoice, receipt, quote, purchase order, or contract,
- sales / marketing / promotional outreach,
- a newsletter or mailing-list blast,
- vendor / supplier / partnership mail,
- an internal reply or an ongoing thread ("thanks", "talk tomorrow", "see notes attached"),
- a calendar invite or meeting item,
- a general question, or a support / helpdesk request.

If you genuinely cannot tell, answer "uncertain". DO NOT GUESS — losing a real
candidate is worse than asking a human to look. But do not label obvious
non-applications "uncertain" just to be safe.

Respond with the verdict and a single short sentence of reasoning.`;

@Injectable()
export class CvClassifierService {
  private readonly logger = new Logger(CvClassifierService.name);
  private readonly openrouter: ReturnType<typeof createOpenRouter>;
  private readonly classifierModel: string;

  constructor(
    private readonly config: ConfigService,
    private readonly storageService: StorageService,
  ) {
    this.openrouter = createOpenRouter({ apiKey: config.get<string>('OPENROUTER_API_KEY')! });
    this.classifierModel = config.get<string>('CLASSIFIER_MODEL') ?? 'openai/gpt-4o-mini';
  }

  async classify(input: CvClassifierInput): Promise<CvClassification> {
    // Layer 1 — deterministic short-circuit (no AI):
    // a known recruiting agency submitting a document is an unambiguous CV signal.
    if (input.resolvedAgency !== null && input.hasMeaningfulAttachment) {
      return { verdict: 'cv', reason: `Known agency sender (${input.resolvedAgency}) with a document attachment` };
    }

    // Retry-safe cache — a BullMQ retry must not re-call the model.
    const cached = await this.storageService.loadClassificationCache(input.tenantId, input.messageId);
    if (cached !== null) {
      this.logger.log(`Classification cache hit for ${input.messageId}`);
      return CvClassificationSchema.parse(cached);
    }

    // Layer 2 — AI judge.
    const classification = await this.callAI(input);

    try {
      await this.storageService.saveClassificationCache(classification, input.tenantId, input.messageId);
    } catch (cacheErr) {
      this.logger.warn(
        `Failed to cache classification for ${input.messageId} — retry will re-call AI: ${(cacheErr as Error).message}`,
      );
    }

    return classification;
  }

  private async callAI(input: CvClassifierInput): Promise<CvClassification> {
    const MAX_INPUT_LENGTH = 20_000;
    const safeFullText = input.fullText.substring(0, MAX_INPUT_LENGTH);

    const prompt = [
      `--- Signals ---`,
      `From: ${input.fromEmail}`,
      `Subject: ${input.subject}`,
      `Has document attachment: ${input.hasMeaningfulAttachment ? 'yes' : 'no'}`,
      `Flagged suspicious by pre-filter: ${input.suspicious ? 'yes' : 'no'}`,
      `Body length (chars): ${input.bodyLength}`,
      `Resolved recruiting agency: ${input.resolvedAgency ?? 'none'}`,
      ``,
      `--- Email content (body + attachment text, truncated) ---`,
      safeFullText,
    ].join('\n');

    const { object } = await generateObject({
      model: this.openrouter.chat(this.classifierModel),
      schema: CvClassificationSchema,
      schemaName: 'CvClassification',
      system: INSTRUCTIONS,
      prompt,
      temperature: 0,
    });

    this.logger.log(`CV classification for ${input.messageId}: ${object.verdict}`);
    return object;
  }
}
```

- [ ] **Step 5: Run the spec to verify it passes**

Run: `npm test -- cv-classifier.service`
Expected: PASS — all 11 cases green (3 from the parametrized `it.each`).

- [ ] **Step 6: Commit**

```bash
git add src/config/env.ts src/ingestion/services/cv-classifier.service.ts src/ingestion/services/cv-classifier.service.spec.ts
git commit -m "feat(ingestion): add CvClassifierService (agency short-circuit + AI judge + R2 cache)"
```

---

## Task 3: Wire the gate into the ingestion pipeline

**Files:**
- Modify: `src/ingestion/services/spam-filter.service.ts:168` (`private` → `public` on `hasMeaningfulAttachment`)
- Modify: `src/ingestion/services/extraction-agent.service.ts:41` (`function` → `export function` on `resolveAgencyFromEmail`)
- Modify: `src/ingestion/ingestion.module.ts` (add `CvClassifierService` provider + import)
- Modify: `src/ingestion/ingestion.processor.ts` (import + inject classifier; insert the gate)
- Test: `src/ingestion/ingestion.processor.spec.ts` (add classifier mock to all 7 provider arrays; add a new gate `describe` block)

**Interfaces:**
- Consumes: `CvClassifierService.classify` (Task 2); `SpamFilterService.hasMeaningfulAttachment(attachments)`; `resolveAgencyFromEmail(fromEmail)`.
- Produces: gate behavior — `not_cv` → `processing_status='not_cv'` + return; `uncertain` → `processing_status='needs_review'` + return; `cv` → continue (adds **zero** extra `emailIntakeLog.update` calls, preserving existing test call-counts). Classifier throw → stamp `failed` + re-throw (BullMQ retry).

- [ ] **Step 1: Expose the two deterministic inputs (production code)**

In `src/ingestion/services/spam-filter.service.ts`, change line 168 from:

```ts
  private hasMeaningfulAttachment(attachments: PostmarkPayloadDto['Attachments']): boolean {
```
to:
```ts
  public hasMeaningfulAttachment(attachments: PostmarkPayloadDto['Attachments']): boolean {
```

In `src/ingestion/services/extraction-agent.service.ts`, change line 41 from:

```ts
function resolveAgencyFromEmail(fromEmail: string): string | null {
```
to:
```ts
export function resolveAgencyFromEmail(fromEmail: string): string | null {
```

(No behavior change. The internal call at `extraction-agent.service.ts:204` still works.)

- [ ] **Step 2: Register the provider**

In `src/ingestion/ingestion.module.ts`, add the import (after line 6) and the provider (in the `providers` array):

```ts
import { CvClassifierService } from './services/cv-classifier.service';
```
```ts
  providers: [
    IngestionProcessor,
    SpamFilterService,
    AttachmentExtractorService,
    ExtractionAgentService,
    CvClassifierService,
  ],
```

- [ ] **Step 3: Inject + wire the gate in the processor**

In `src/ingestion/ingestion.processor.ts`:

(a) Replace the extraction-agent import (line 8) so it also pulls in `resolveAgencyFromEmail`, and add the classifier import:

```ts
import { ExtractionAgentService, CandidateExtract, resolveAgencyFromEmail } from './services/extraction-agent.service';
import { CvClassifierService, CvClassification } from './services/cv-classifier.service';
```

(b) Add the classifier to the constructor (after `private readonly spamFilter: SpamFilterService,` — keep alphabetical-ish grouping is not required; place it right after `spamFilter`):

```ts
  constructor(
    private readonly spamFilter: SpamFilterService,
    private readonly cvClassifier: CvClassifierService,
    private readonly attachmentExtractor: AttachmentExtractorService,
    private readonly prisma: PrismaService,
    private readonly extractionAgent: ExtractionAgentService,
    private readonly storageService: StorageService,
    private readonly dedupService: DedupService,
    private readonly scoringService: ScoringAgentService,
    private readonly pinoLogger: PinoLogger,
  ) {
    super();
  }
```

(c) Insert the gate **between** the `fullText` construction (current line 106) and the `// Phase 3 output` context block (current line 108). The new block goes right after this existing line:

```ts
    const fullText = [bodySection, attachmentText].filter(Boolean).join('\n\n');
```

Insert:

```ts
    // CV CLASSIFICATION GATE — decide whether this email is a job application
    // BEFORE any candidate is created. Runs after fullText is built (so attachment
    // text is available to judge) and before AI extraction. The extractor is told
    // "this is a CV", so it cannot be trusted to also judge whether it is one.
    let classification: CvClassification;
    try {
      classification = await this.cvClassifier.classify({
        fullText,
        subject: payload.Subject ?? '',
        fromEmail: payload.From,
        suspicious: filterResult.suspicious,
        hasMeaningfulAttachment: this.spamFilter.hasMeaningfulAttachment(payload.Attachments),
        bodyLength: (payload.TextBody ?? '').trim().length,
        resolvedAgency: resolveAgencyFromEmail(payload.From),
        tenantId,
        messageId: payload.MessageID,
      });
    } catch (err) {
      await this.prisma.emailIntakeLog.update({
        where: { idx_intake_message_id: { tenantId, messageId: payload.MessageID } },
        data: { processingStatus: 'failed', errorMessage: (err as Error).message },
      });
      this.pinoLogger.error(
        { messageId: payload.MessageID, attempt: job.attemptsMade + 1, error: (err as Error).message },
        'CV classification failed',
      );
      throw err;
    }

    if (classification.verdict === 'not_cv') {
      await this.prisma.emailIntakeLog.update({
        where: { idx_intake_message_id: { tenantId, messageId: payload.MessageID } },
        data: { processingStatus: 'not_cv' },
      });
      this.pinoLogger.log(
        { messageId: payload.MessageID, reason: classification.reason },
        'CV classifier: not a job application',
      );
      return;
    }

    if (classification.verdict === 'uncertain') {
      await this.prisma.emailIntakeLog.update({
        where: { idx_intake_message_id: { tenantId, messageId: payload.MessageID } },
        data: { processingStatus: 'needs_review' },
      });
      this.pinoLogger.log(
        { messageId: payload.MessageID, reason: classification.reason },
        'CV classifier: uncertain — needs human review',
      );
      return;
    }

    // verdict === 'cv' → continue the existing pipeline unchanged
    this.pinoLogger.log(
      { messageId: payload.MessageID, reason: classification.reason },
      'CV classifier: confirmed job application',
    );
```

Leave the rest of the method (the `context` object, extraction, dedup, scoring) exactly as-is.

- [ ] **Step 4: Add the classifier mock to every existing processor-spec provider array**

A new constructor dependency means Nest DI must resolve `CvClassifierService` in **every** `Test.createTestingModule({ providers: [...] })` in `src/ingestion/ingestion.processor.spec.ts`, or all existing tests fail with *"Nest can't resolve dependencies of IngestionProcessor"*.

First add the import at the top of the spec (after line 8, the `ExtractionAgentService` import):

```ts
import { CvClassifierService } from './services/cv-classifier.service';
```

Then, in **each** of the 7 `providers: [...]` arrays, add this line next to the other `useValue` mocks (defaulting to `cv` so the existing pipeline flows through unchanged):

```ts
        { provide: CvClassifierService, useValue: { classify: jest.fn().mockResolvedValue({ verdict: 'cv', reason: 'test cv' }) } },
```

The 7 provider arrays (by `describe` block, with the `beforeEach`/module line for orientation):
1. `describe('IngestionProcessor', ...)` — providers at ~line 74.
2. `describe('IngestionProcessor — Phase 5 StorageService', ...)` — providers at ~line 258.
3. `describe('IngestionProcessor — Phase 6 Duplicate Detection', ...)` — providers at ~line 415.
4. `describe('IngestionProcessor — Phase 7 Candidate Enrichment & Scoring', ...)` — providers at ~line 658.
5. `describe('IngestionProcessor — Phase 15 Numeric Job ID Extraction', ...)` (nested) — providers at ~line 874.
6. `describe('IngestionProcessor — extractCandidateShortIds()', ...)` — providers at ~line 1024.
7. `describe('IngestionProcessor — Phase 6 idempotency guard', ...)` — providers at ~line 1113.

> Why `cv` is the safe default: the `cv` branch adds **no** `emailIntakeLog.update` call, so existing assertions like *"processing + completed = 2 update calls"* (line 206) and *"processing + failed = 2"* (line 155) stay exactly true.

- [ ] **Step 5: Run the existing processor spec to verify it stays green**

Run: `npm test -- ingestion.processor`
Expected: PASS — all existing tests green (the classifier mock returns `cv`, so every existing flow is unchanged).

- [ ] **Step 6: Write the failing gate integration tests**

Append a new `describe` block at the end of `src/ingestion/ingestion.processor.spec.ts` (after the final closing `});` of the file):

```ts
describe('IngestionProcessor — CV Classification Gate', () => {
  let processor: IngestionProcessor;
  let prisma: any;
  let extractionAgent: { extract: jest.Mock };
  let dedupService: any;
  let cvClassifier: { classify: jest.Mock };
  let storageService: { upload: jest.Mock; downloadPayload: jest.Mock };

  const cvPayload = () =>
    mockPostmarkPayload({
      MessageID: 'msg-gate-test',
      From: 'candidate@example.com',
      Subject: 'Application for Backend Developer',
      TextBody:
        'Dear Hiring Manager, please find my CV attached. I have 5 years of experience in software engineering and would love to apply.',
      Attachments: [],
    });

  beforeEach(async () => {
    const txClient = {
      emailIntakeLog: { update: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(0),
    };
    prisma = {
      emailIntakeLog: {
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ candidateId: null, cvFileKey: null }),
      },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(txClient)),
      candidate: { update: jest.fn().mockResolvedValue({}) },
      job: { findMany: jest.fn().mockResolvedValue([]) },
      application: { upsert: jest.fn().mockResolvedValue({ id: 'app-id' }) },
      candidateJobScore: { create: jest.fn().mockResolvedValue({}), upsert: jest.fn().mockResolvedValue({}) },
    };
    extractionAgent = { extract: jest.fn().mockResolvedValue(mockCandidateExtract()) };
    dedupService = {
      check: jest.fn().mockResolvedValue(null),
      insertCandidate: jest.fn().mockResolvedValue('new-candidate-id'),
      upsertCandidate: jest.fn().mockResolvedValue(undefined),
      createFlag: jest.fn().mockResolvedValue(undefined),
    };
    cvClassifier = { classify: jest.fn().mockResolvedValue({ verdict: 'cv', reason: 'resume' }) };
    storageService = { upload: jest.fn(), downloadPayload: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IngestionProcessor,
        SpamFilterService,
        AttachmentExtractorService,
        { provide: PrismaService, useValue: prisma },
        { provide: ExtractionAgentService, useValue: extractionAgent },
        { provide: StorageService, useValue: storageService },
        { provide: DedupService, useValue: dedupService },
        {
          provide: ScoringAgentService,
          useValue: { score: jest.fn().mockResolvedValue({ score: 72, reasoning: '', strengths: [], gaps: [], modelUsed: 'test' }) },
        },
        { provide: CvClassifierService, useValue: cvClassifier },
        { provide: PinoLogger, useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() } },
      ],
    }).compile();
    processor = module.get<IngestionProcessor>(IngestionProcessor);
  });

  afterEach(() => jest.clearAllMocks());

  it('verdict "cv" → extraction + candidate creation run; status ends completed', async () => {
    cvClassifier.classify.mockResolvedValue({ verdict: 'cv', reason: 'resume' });
    const payload = cvPayload();
    storageService.downloadPayload.mockResolvedValue(payload);

    await processor.process(makeJob('gate-cv', payload));

    expect(cvClassifier.classify).toHaveBeenCalledTimes(1);
    expect(extractionAgent.extract).toHaveBeenCalledTimes(1);
    expect(dedupService.insertCandidate).toHaveBeenCalledTimes(1);
    expect(prisma.emailIntakeLog.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { processingStatus: 'completed' } }),
    );
  });

  it('verdict "not_cv" → no extraction, no candidate, status not_cv', async () => {
    cvClassifier.classify.mockResolvedValue({ verdict: 'not_cv', reason: 'invoice PDF' });
    const payload = cvPayload();
    storageService.downloadPayload.mockResolvedValue(payload);

    await processor.process(makeJob('gate-notcv', payload));

    expect(extractionAgent.extract).not.toHaveBeenCalled();
    expect(dedupService.insertCandidate).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.emailIntakeLog.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { processingStatus: 'not_cv' } }),
    );
  });

  it('verdict "uncertain" → no extraction, no candidate, status needs_review', async () => {
    cvClassifier.classify.mockResolvedValue({ verdict: 'uncertain', reason: 'no job context' });
    const payload = cvPayload();
    storageService.downloadPayload.mockResolvedValue(payload);

    await processor.process(makeJob('gate-uncertain', payload));

    expect(extractionAgent.extract).not.toHaveBeenCalled();
    expect(dedupService.insertCandidate).not.toHaveBeenCalled();
    expect(prisma.emailIntakeLog.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { processingStatus: 'needs_review' } }),
    );
  });

  it('spam short-circuits BEFORE the classifier runs', async () => {
    // No meaningful attachment + body < 100 chars → spam filter hard-rejects (unchanged behavior)
    const spamPayload = mockPostmarkPayload({ MessageID: 'msg-gate-spam', TextBody: 'hi', Attachments: [] });
    storageService.downloadPayload.mockResolvedValue(spamPayload);

    await processor.process(makeJob('gate-spam', spamPayload));

    expect(cvClassifier.classify).not.toHaveBeenCalled();
    expect(prisma.emailIntakeLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { processingStatus: 'spam' } }),
    );
  });
});
```

- [ ] **Step 7: Run the gate tests to verify they pass**

Run: `npm test -- ingestion.processor`
Expected: PASS — existing tests + 4 new gate tests all green.

- [ ] **Step 8: Type-check, lint, and run the full suite**

Run: `npm run build && npm run lint && npm test`
Expected: build succeeds (no TS errors), lint clean, **all** suites green (`spam-filter`, `extraction-agent`, `storage`, `cv-classifier`, `ingestion.processor`).

- [ ] **Step 9: Commit**

```bash
git add src/ingestion/services/spam-filter.service.ts src/ingestion/services/extraction-agent.service.ts \
        src/ingestion/ingestion.module.ts src/ingestion/ingestion.processor.ts \
        src/ingestion/ingestion.processor.spec.ts
git commit -m "feat(ingestion): gate candidate creation behind CV classification (not_cv/needs_review)"
```

---

## Task 4 (optional, independent): Remove the dead `suspicious` parameter from `ExtractionAgentService`

> Ship this only if you want the cleanup. Tasks 1–3 are complete and correct without it. The `suspicious` signal is now consumed by the classifier; it remains on `SpamFilterResult` and `filterResult.suspicious` — this task only removes it from the *extractor*, where it was threaded through and **never read** by dedup or scoring (grep-confirmed).

**Files:**
- Modify: `src/ingestion/services/extraction-agent.service.ts`
- Modify: `src/ingestion/services/extraction-agent.service.spec.ts`
- Modify: `src/ingestion/services/extraction-agent.service.test-helpers.ts`
- Modify: `src/ingestion/ingestion.processor.ts`

**Interfaces:**
- Changes: `ExtractionAgentService.extract(fullText, metadata)` (drops the 2nd positional `suspicious: boolean` arg). `CandidateExtract` becomes exactly `z.infer<typeof CandidateExtractSchema>` (drops `& { suspicious: boolean }`).
- Consumes: callers must drop the `suspicious` argument — only one production caller (`ingestion.processor.ts:120`).

- [ ] **Step 1: Update the extractor's type, signature, and merges**

In `src/ingestion/services/extraction-agent.service.ts`:

Change the type (lines 21-23) from:
```ts
export type CandidateExtract = z.infer<typeof CandidateExtractSchema> & {
  suspicious: boolean;
};
```
to:
```ts
export type CandidateExtract = z.infer<typeof CandidateExtractSchema>;
```

Change `extract` (lines 180-198) so it drops the `suspicious` param and the merges:
```ts
  async extract(fullText: string, metadata: ExtractionMetadata): Promise<CandidateExtract> {
    // Check R2 cache first — avoid re-calling AI on retry
    const cached = await this.storageService.loadExtractionCache(metadata.tenantId, metadata.messageId);
    if (cached !== null) {
      this.logger.log(`Extraction cache hit for ${metadata.messageId}`);
      return CandidateExtractSchema.parse(cached);
    }

    const extracted = await this.callAI(fullText, metadata);

    try {
      await this.storageService.saveExtractionCache(extracted, metadata.tenantId, metadata.messageId);
    } catch (cacheErr) {
      this.logger.warn(`Failed to cache extraction for ${metadata.messageId} — retry will re-call AI: ${(cacheErr as Error).message}`);
    }

    return extracted;
  }
```

Change `callAI`'s return type (line 200) from `Promise<Omit<CandidateExtract, 'suspicious'>>` to `Promise<CandidateExtract>`. Its body is unchanged (it already returns the schema object, with the agency override).

- [ ] **Step 2: Update the processor caller**

In `src/ingestion/ingestion.processor.ts`:

Remove `suspicious` from the `ProcessingContext` interface (line 15) and from the `context` object literal (line 111). Change the extract call (line 120) from:
```ts
      extraction = await this.extractionAgent.extract(context.fullText, context.suspicious, {
```
to:
```ts
      extraction = await this.extractionAgent.extract(context.fullText, {
```
(The gate already reads `filterResult.suspicious` directly, so the classifier is unaffected.)

- [ ] **Step 3: Update the test helper**

In `src/ingestion/services/extraction-agent.service.test-helpers.ts`, remove the `suspicious: false,` line (line 17) from the object returned by `mockCandidateExtract`.

- [ ] **Step 4: Update the extraction spec**

In `src/ingestion/services/extraction-agent.service.spec.ts`:
- Replace every `service.extract(<text>, false, <metadata>)` / `service.extract(<text>, true, <metadata>)` call with `service.extract(<text>, <metadata>)` (drop the boolean — affects the calls at lines ~171, 194, 203, 223, 260, 280, 301, 325, 378, 404, 418, 432, 445, 462, 486).
- In the test *"returns AI result merged with suspicious flag on success"* (line 154), drop the `expect(result.suspicious).toBe(false);` assertion (line 175) and rename it to *"returns AI result on success"*.
- Delete the test *"propagates suspicious=true from input on success"* (lines 179-196) — the behavior no longer exists.

- [ ] **Step 5: Run the affected specs to verify they pass**

Run: `npm test -- extraction-agent ingestion.processor`
Expected: PASS. (The processor spec's inline extract mocks may still carry a harmless `suspicious: false` property in untyped object literals — leave or remove; either way it compiles. `mockCandidateExtract` no longer includes it.)

- [ ] **Step 6: Full build + suite**

Run: `npm run build && npm test`
Expected: build clean (no references to the removed field), all suites green.

- [ ] **Step 7: Commit**

```bash
git add src/ingestion/services/extraction-agent.service.ts src/ingestion/services/extraction-agent.service.spec.ts \
        src/ingestion/services/extraction-agent.service.test-helpers.ts src/ingestion/ingestion.processor.ts
git commit -m "refactor(ingestion): drop dead 'suspicious' param from ExtractionAgentService"
```

---

## Verification (end-to-end)

**1. Automated (primary — this is "logic only"):**
```bash
npm run build            # TS compiles, no dangling references
npm run lint             # eslint clean
npm test                 # ALL suites green
```
Confirm specifically:
- `cv-classifier.service.spec.ts` — short-circuit, AI verdicts, cache hit/save, error propagation.
- `ingestion.processor.spec.ts` — the 4 gate tests (cv→completed, not_cv→not_cv, uncertain→needs_review, spam-before-classifier) **and** all pre-existing tests.
- `spam-filter.service.spec.ts`, `extraction-agent.service.spec.ts`, `storage.service.spec.ts` — still green.

**2. Manual (secondary — full pipeline against real R2 + a cheap model):**
```bash
cd talent-os-backend && npm run docker:up      # API + worker + Postgres + Redis
```
Drive a few inbound emails through the Postmark webhook (`/webhooks/postmark`; use `npm run ngrok` to expose it, or replay a captured payload). Use representative fixtures and watch `npm run docker:logs:worker` for the `CV classifier: ...` log line, then check the row in `npm run db:studio`:

| Fixture | Expected log | Expected `email_intake_log.processing_status` | Candidate created? |
|---|---|---|---|
| Real CV PDF, direct sender | `confirmed job application` | `completed` | yes |
| Invoice / quote PDF | `not a job application` | `not_cv` | **no** |
| Newsletter / marketing blast | `not a job application` | `not_cv` | **no** |
| "Thanks, talk tomorrow" reply | `not a job application` | `not_cv` | **no** |
| Known-agency email + attachment | `confirmed job application` (Layer-1 short-circuit, no AI call) | `completed` | yes |
| Vague doc, no job context | `uncertain — needs human review` | `needs_review` | **no** |

Inspect the `needs_review` pile in `db:studio` by filtering `processing_status = needs_review`; the full original email remains in `raw_payload` / R2 (nothing is lost). Confirm a BullMQ retry does **not** re-call the model (verdict served from `emails/{tenant}/{messageId}/classification.json` in R2).

---

## Self-Review (performed against the spec)

**Spec coverage:**
- §3.1 `CvClassifierService` (interface, Layer 1 short-circuit, Layer 2 AI judge, Zod schema, prompt, R2 cache) → **Task 2** (interface/types/schema/prompt/cache all implemented; cache helpers in **Task 1**).
- §3.2 pipeline wiring (gate after `fullText`, before extraction; three branches) → **Task 3**.
- §3.3 new statuses `not_cv` / `needs_review`, no migration → **Task 3** (verified: `processing_status` is `@db.Text`, no CHECK).
- §4 visibility (`db:studio` filter; `reason` to pino logs, not a column) → gate logs `reason`; **Verification** section covers the `db:studio` view. (No `reason` column — correctly out of scope.)
- §5 error handling (classifier throws → BullMQ retry → `failed`; Zod retry via `generateObject`; deterministic layer never throws) → **Task 3** try/catch mirrors extraction; deterministic Layer 1 is pure boolean logic.
- §6 testing (classifier unit cases + processor integration cases + fixtures; existing specs stay green) → **Tasks 2 & 3** cover every listed case; existing specs preserved (the `cv` default + `public`-not-result-change decisions keep them green).
- §7 out of scope (Review-inbox UI, re-processing, `reason` column, spam keyword rework) → none attempted.
- §8 files touched → implemented, with the four planning deviations documented above (public method instead of result change; exported helper; cache made definite; `suspicious` cleanup isolated to optional Task 4).

**Placeholder scan:** none — every code/test step contains complete code and exact commands with expected output.

**Type consistency:** `CvClassifierInput`, `CvVerdict`, `CvClassification`, `CvClassificationSchema`, `classify(...)`, `saveClassificationCache` / `loadClassificationCache`, `hasMeaningfulAttachment` (now public), `resolveAgencyFromEmail` (now exported) are named identically everywhere they appear across Tasks 1–4. `classify` is consumed in the processor exactly as produced in the classifier; the cache helpers are consumed in the classifier exactly as produced in storage.
