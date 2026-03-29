# PRD: Email-to-Candidate Extraction Pipeline — V2

> **Goal:** An inbound CV email (via Postmark webhook) produces a fully-populated `Candidate` record  
> that matches the Prisma data model exactly, using a cheap LLM (Gemini 2.0 Flash via OpenRouter).  
> Budget: **$5 loaded on OpenRouter** (`google/gemini-2.0-flash:free` primary, paid tier fallback).

---

## 1. Current State — What Works

The end-to-end pipeline already exists and runs:

```
Postmark webhook → idempotency guard (DB + P2002 race) → BullMQ queue
→ spam filter → text extraction (pdf-parse + mammoth) → R2 upload
→ AI extraction (OpenRouter) → dedup (exact email + pg_trgm fuzzy)
→ candidate INSERT/UPSERT → Phase 7 enrichment + scoring loop → status=completed
```

**Working components (do NOT rewrite):**
- `WebhooksService.enqueue()` — idempotent intake with Prisma unique guard
- `SpamFilterService.check()` — keyword + attachment heuristic
- `AttachmentExtractorService.extract()` — PDF/DOCX → plain text
- `StorageService.upload()` — R2 upload with correct MIME/extension
- `DedupService` — exact email match (confidence=1.0) + pg_trgm fuzzy name match
- `IngestionProcessor` — orchestration across all phases
- BullMQ retry config (3 attempts, exponential backoff 5s)

---

## 2. Bugs & Gaps — What Must Change

### BUG-1: Error Handling in ExtractionAgentService Swallows Failures (CRITICAL)

**File:** `src/ingestion/services/extraction-agent.service.ts`  
**Method:** `extract()`

**Problem:** The `extract()` method wraps `callAI()` in a try/catch that returns a `FALLBACK` object with `full_name: ''` on any error. This means the processor's own try/catch around `extractionAgent.extract()` **never fires** — errors are silently swallowed. The result:
- LLM call fails → FALLBACK returned with empty `full_name`
- Processor sees empty `full_name` → marks as `failed` permanently
- **BullMQ never retries** because no error was thrown

**Fix:** Remove the internal try/catch in `extract()`. Let errors propagate to the processor, which re-throws them for BullMQ retry. Only after all 3 attempts are exhausted should the job be marked as `failed`.

**Specific code to change:**
```typescript
// BEFORE (broken):
async extract(fullText: string, suspicious: boolean): Promise<CandidateExtract> {
  try {
    const extracted = await this.callAI(fullText);
    return { ...extracted, suspicious };
  } catch (err) {
    this.logger.error('OpenRouter extraction failed — returning safe fallback.', err);
    return { ...FALLBACK, suspicious };  // ← SWALLOWS THE ERROR
  }
}

// AFTER (correct):
async extract(fullText: string, suspicious: boolean): Promise<CandidateExtract> {
  const extracted = await this.callAI(fullText);  // errors propagate
  return { ...extracted, suspicious };
}
```

---

### BUG-2: Extraction Schema Missing Critical Candidate Fields

**File:** `src/ingestion/services/extraction-agent.service.ts`  
**Schema:** `CandidateExtractSchema`

**Problem:** Current schema extracts only 5 fields:
```
full_name, email, phone, skills, ai_summary
```

But the Prisma `Candidate` model has these additional fields that the LLM **can and should** extract:
```
currentRole, yearsExperience, location
```

In `ingestion.processor.ts` Phase 7, these are hardcoded as `null`:
```typescript
currentRole: null,        // ← LLM can extract this
yearsExperience: null,    // ← LLM can extract this
// location is never set  // ← LLM can extract this
```

**Fix:** Extend the Zod schema and LLM prompt to extract all fields.

---

### BUG-3: Prompt Lacks Structure and Context

**File:** `src/ingestion/services/extraction-agent.service.ts`  
**Const:** `INSTRUCTIONS`

**Problem:**
1. Prompt doesn't include email metadata (Subject, From) — misses source detection signals
2. No few-shot example → inconsistent output format
3. No constraints on field formats (e.g., `years_experience` as integer, not "5-7 years")
4. Skills extraction is unguided → returns verbose phrases instead of short tags

---

### GAP-4: Phase 7 Enrichment Ignores Extracted Data

**File:** `src/ingestion/ingestion.processor.ts`  
**Phase 7 candidate update block**

**Problem:** Even if the schema is extended, the processor currently hardcodes nulls. Must map extraction output to Prisma update.

---

### GAP-5: Scoring Service is a Hardcoded Mock

**File:** `src/scoring/scoring.service.ts`  
**Method:** `score()`

**Problem:** The scoring service always returns `{ score: 72, reasoning: 'Strong TypeScript background...', modelUsed: 'claude-sonnet-4-6' }` regardless of input. Every candidate gets the same score against every job. The commented-out code shows the intended implementation uses `@ai-sdk/anthropic` with Claude Sonnet — but:
1. Claude Sonnet is expensive ($3/M input, $15/M output) and doesn't match the $5 OpenRouter budget
2. The `@ai-sdk/anthropic` dependency may not even be installed
3. The `generateObject()` import is commented out

**Fix:** Wire scoring to OpenRouter using `google/gemini-2.0-flash:free` (same as extraction). Gemini Flash is capable enough for 0-100 scoring with reasoning. Use the existing `ScoringInput` type — it already has the right shape (`currentRole`, `yearsExperience`, `skills` are all nullable).

**Cost impact:** With free tier, scoring is $0. With paid Gemini Flash, scoring ~3K input tokens + ~300 output tokens per job ≈ $0.0004 per score. If a candidate is scored against 5 active jobs = $0.002 total. The $5 budget covers ~2,500 full candidate pipelines on paid tier.

---

### GAP-6: `extractDeterministically()` is Dead Code

**File:** `src/ingestion/services/extraction-agent.service.ts`

**Problem:** The deterministic fallback method exists but is never called. Decision needed: use it as last-resort fallback, or delete it.

**Recommendation:** Keep it as fallback on final BullMQ attempt. If AI fails 3 times, try deterministic on the last attempt before marking as `failed`.

---

### GAP-7: No Subject/From Passed to Extraction

**File:** `src/ingestion/ingestion.processor.ts`

**Problem:** `extractionAgent.extract()` receives only `fullText` (body + attachments). The email Subject and From address contain valuable signals:
- Subject: "CV - Senior React Developer" → currentRole hint
- Subject: "Presenting candidate for..." → source = agency
- From: "recruiter@agency.com" → source = agency
- From: same as candidate email → source = direct

---

## 3. Implementation Plan

### Task 1: Extend CandidateExtractSchema

**File:** `src/ingestion/services/extraction-agent.service.ts`

**New Zod schema:**
```typescript
export const CandidateExtractSchema = z.object({
  full_name:        z.string(),
  email:            z.string().email().nullable(),
  phone:            z.string().nullable(),
  current_role:     z.string().nullable(),
  years_experience: z.number().int().min(0).max(50).nullable(),
  location:         z.string().nullable(),
  skills:           z.array(z.string()),
  ai_summary:       z.string().nullable(),
  source_hint:      z.enum(['linkedin', 'agency', 'referral', 'direct']).nullable(),
});
```

**Updated CandidateExtract type:**
```typescript
export type CandidateExtract = z.infer<typeof CandidateExtractSchema> & {
  suspicious: boolean;
};
```

**Updated FALLBACK constant:**
```typescript
const FALLBACK: Omit<CandidateExtract, 'suspicious'> = {
  full_name: '',
  email: null,
  phone: null,
  current_role: null,
  years_experience: null,
  location: null,
  skills: [],
  ai_summary: null,
  source_hint: null,
};
```

**Acceptance:** Zod schema parses successfully with all new fields; FALLBACK matches schema.

---

### Task 2: Rewrite LLM Prompt

**File:** `src/ingestion/services/extraction-agent.service.ts`  
**Const:** `INSTRUCTIONS`

**New prompt (replace entire INSTRUCTIONS string):**

```typescript
const INSTRUCTIONS = `You are a CV/resume data extraction assistant for a recruiting platform.

INPUT: You will receive:
1. Email metadata (Subject line, sender address)
2. Full text extracted from the email body and any attached CV/resume files

OUTPUT: Return ONLY a raw JSON object — no markdown, no code fences, no explanation.

The JSON must contain exactly these keys:

- "full_name" (string): The candidate's full name. Never empty.
- "email" (string | null): The candidate's personal/professional email. This is NOT the sender's email — look inside the CV content for the candidate's own email.
- "phone" (string | null): Phone number in original format.
- "current_role" (string | null): Most recent job title only (e.g., "Senior Frontend Developer"). Do not include company name.
- "years_experience" (number | null): Total years of professional experience as a single integer. If the CV says "5-7 years", return 6. If unclear, return null.
- "location" (string | null): City and country (e.g., "Tel Aviv, Israel"). If only country is mentioned, return country.
- "skills" (string[]): Technical and professional skills as short tags, max 3 words each, lowercase (e.g., ["react", "node.js", "system design", "team leadership"]). Extract 5-15 skills.
- "ai_summary" (string | null): Exactly 2 sentences. Sentence 1: current role and years of experience. Sentence 2: top 2-3 skills or one notable achievement.
- "source_hint" (string | null): One of "linkedin", "agency", "referral", "direct", or null.
  - "agency" if the sender appears to be a recruitment agency (subject contains "presenting candidate", "on behalf of", or sender domain looks like an agency)
  - "linkedin" if the CV or email mentions LinkedIn application
  - "referral" if the email mentions a referral or recommendation from someone
  - "direct" if the candidate sent their own CV directly
  - null if unclear

RULES:
- If a field cannot be determined from the text, use null (for strings/numbers) or [] (for arrays).
- Do NOT invent information. Only extract what is explicitly stated.
- "email" should be the candidate's email found inside the CV, not the From header.
- If the text is not a CV/resume at all, return full_name as "" and all other fields as null/[].

EXAMPLE OUTPUT:
{
  "full_name": "Dana Cohen",
  "email": "dana.cohen@gmail.com",
  "phone": "+972-52-1234567",
  "current_role": "Senior Backend Developer",
  "years_experience": 6,
  "location": "Tel Aviv, Israel",
  "skills": ["node.js", "typescript", "postgresql", "docker", "aws", "system design"],
  "ai_summary": "Senior Backend Developer with 6 years of experience in server-side development. Specializes in Node.js and cloud infrastructure with a track record of leading microservices migrations.",
  "source_hint": "direct"
}`;
```

**Acceptance:** Prompt includes all schema fields, has constraints, includes example output.

---

### Task 3: Update `extract()` Method Signature + Error Handling

**File:** `src/ingestion/services/extraction-agent.service.ts`

**Changes:**

1. **New signature** — accept email metadata:
```typescript
async extract(
  fullText: string,
  suspicious: boolean,
  metadata: { subject: string; fromEmail: string },
): Promise<CandidateExtract>
```

2. **Remove try/catch** — let errors propagate:
```typescript
async extract(
  fullText: string,
  suspicious: boolean,
  metadata: { subject: string; fromEmail: string },
): Promise<CandidateExtract> {
  const extracted = await this.callAI(fullText, metadata);
  return { ...extracted, suspicious };
}
```

3. **Update `callAI()`** — include metadata in the user message:
```typescript
private async callAI(
  fullText: string,
  metadata: { subject: string; fromEmail: string },
): Promise<Omit<CandidateExtract, 'suspicious'>> {
  const apiKey = this.config.get<string>('OPENROUTER_API_KEY')!;
  const client = new OpenRouter({ apiKey });

  const userMessage = [
    `--- Email Metadata ---`,
    `Subject: ${metadata.subject}`,
    `From: ${metadata.fromEmail}`,
    ``,
    `--- CV / Email Content ---`,
    fullText,
  ].join('\n');

  const result = client.callModel({
    model: 'google/gemini-2.0-flash:free',
    instructions: INSTRUCTIONS,
    input: userMessage,
  });

  const raw = await result.getText();

  const json = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const parsed = CandidateExtractSchema.parse(JSON.parse(json));
  this.logger.log('OpenRouter extraction successful');
  return parsed;
}
```

4. **Add `safeParse` wrapper** for resilience against malformed LLM output:
```typescript
// Inside callAI, replace the last 2 lines with:
const parseResult = CandidateExtractSchema.safeParse(JSON.parse(json));
if (!parseResult.success) {
  this.logger.error('LLM returned invalid JSON structure', parseResult.error.errors);
  throw new Error(`LLM output validation failed: ${parseResult.error.message}`);
}
this.logger.log('OpenRouter extraction successful');
return parseResult.data;
```

**Acceptance:** Errors from OpenRouter propagate upward. Malformed JSON throws (triggers BullMQ retry). Method accepts metadata.

---

### Task 4: Update Processor to Pass Metadata + Use Extracted Fields

**File:** `src/ingestion/ingestion.processor.ts`

**Change 1 — Pass metadata to extract():**

Find the Phase 4 extraction call and update:
```typescript
// BEFORE:
extraction = await this.extractionAgent.extract(context.fullText, context.suspicious);

// AFTER:
extraction = await this.extractionAgent.extract(
  context.fullText,
  context.suspicious,
  { subject: payload.Subject ?? '', fromEmail: payload.From },
);
```

**Change 2 — Phase 7 enrichment uses extracted fields:**

Find the `prisma.candidate.update` in Phase 7 and update:
```typescript
// BEFORE:
await this.prisma.candidate.update({
  where: { id: context.candidateId },
  data: {
    currentRole: null,
    yearsExperience: null,
    skills: extraction.skills ?? [],
    cvText: context.cvText,
    cvFileUrl: context.fileKey,
    aiSummary: extraction.ai_summary ?? null,
    metadata: Prisma.JsonNull,
  },
});

// AFTER:
await this.prisma.candidate.update({
  where: { id: context.candidateId },
  data: {
    currentRole: extraction.current_role ?? null,
    yearsExperience: extraction.years_experience ?? null,
    location: extraction.location ?? null,
    skills: extraction.skills ?? [],
    cvText: context.cvText,
    cvFileUrl: context.fileKey,
    aiSummary: extraction.ai_summary ?? null,
    metadata: Prisma.JsonNull,
  },
});
```

**Change 3 — Use source_hint in dedup insertCandidate:**

In the Phase 6 transaction, when calling `insertCandidate`, the source should come from the extraction when available. This requires updating `DedupService.insertCandidate()` to accept an optional `source` parameter:

```typescript
// In dedup.service.ts — insertCandidate:
// Change source from hardcoded 'direct' to parameterized:
source: source ?? 'direct',

// In processor — pass extraction.source_hint:
candidateId = await this.dedupService.insertCandidate(
  extraction,
  tenantId,
  payload.From,
  tx,
  extraction.source_hint,  // new parameter
);
```

**Acceptance:** No more hardcoded nulls in Phase 7. source_hint flows through to candidate record.

---

### Task 5: Update DedupService.insertCandidate Signature

**File:** `src/dedup/dedup.service.ts`

**Change:** Add optional `source` parameter:

```typescript
async insertCandidate(
  candidate: CandidateExtract,
  tenantId: string,
  fromEmail: string,
  tx?: Prisma.TransactionClient,
  source?: string | null,  // NEW
): Promise<string> {
  const client = tx ?? this.prisma;
  const created = await client.candidate.create({
    data: {
      tenantId,
      fullName: candidate.full_name,
      email: candidate.email ?? null,
      phone: candidate.phone ?? null,
      source: source ?? 'direct',  // CHANGED from hardcoded 'direct'
      sourceEmail: fromEmail,
    },
    select: { id: true },
  });
  return created.id;
}
```

**Acceptance:** Source is set correctly based on LLM extraction.

---

### Task 6: Deterministic Fallback on Final Attempt (Optional but Recommended)

**File:** `src/ingestion/ingestion.processor.ts`

**Change:** In the Phase 4 catch block, check if this is the last BullMQ attempt. If so, try deterministic extraction before giving up:

```typescript
} catch (err) {
  // If this is the LAST attempt, try deterministic extraction as fallback
  if (job.attemptsMade >= (job.opts?.attempts ?? 3) - 1) {
    this.logger.warn(
      `AI extraction failed on final attempt for ${payload.MessageID} — trying deterministic fallback`,
    );
    try {
      const deterministicResult = this.extractionAgent.extractDeterministically(context.fullText);
      extraction = {
        ...deterministicResult,
        suspicious: context.suspicious,
        source_hint: null,
      };
      // Don't throw — continue with deterministic data
    } catch (fallbackErr) {
      // Even deterministic failed — mark as failed permanently
      await this.prisma.emailIntakeLog.update({ ... });
      this.logger.error(`Both AI and deterministic extraction failed for ${payload.MessageID}`);
      return; // Don't retry
    }
  } else {
    // Not final attempt — re-throw for BullMQ retry
    await this.prisma.emailIntakeLog.update({ ... });
    throw err;
  }
}
```

**Note:** This requires making `extractDeterministically()` public. Also update its return type to include the new fields (`current_role`, `years_experience`, `location`, `source_hint`).

**Acceptance:** Jobs don't permanently fail if AI is temporarily down — deterministic fallback provides partial data.

---

### Task 7: Scoring Input Uses Real Extracted Data

**File:** `src/ingestion/ingestion.processor.ts`

**Change:** In the scoring loop, pass real extracted data instead of nulls:

```typescript
// BEFORE:
scoreResult = await this.scoringService.score({
  cvText: context.cvText,
  candidateFields: {
    currentRole: null,
    yearsExperience: null,
    skills: extraction.skills ?? [],
  },
  // ...
});

// AFTER:
scoreResult = await this.scoringService.score({
  cvText: context.cvText,
  candidateFields: {
    currentRole: extraction.current_role ?? null,
    yearsExperience: extraction.years_experience ?? null,
    skills: extraction.skills ?? [],
  },
  // ...
});
```

**Acceptance:** Scoring service receives real candidate data for better match quality.

---

### Task 8: Wire Real Scoring via OpenRouter (Replace Mock)

**File:** `src/scoring/scoring.service.ts`

**Current state:** Returns hardcoded `{ score: 72, ... }` for every candidate/job pair.

**Change:** Replace mock with real OpenRouter call using same pattern as extraction:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenRouter } from '@openrouter/sdk';
import { z } from 'zod';

export const ScoreSchema = z.object({
  score: z.number().int().min(0).max(100),
  reasoning: z.string(),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
});
export type ScoreResult = z.infer<typeof ScoreSchema>;

export interface ScoringInput {
  cvText: string;
  candidateFields: {
    currentRole: string | null;
    yearsExperience: number | null;
    skills: string[];
  };
  job: {
    title: string;
    description: string | null;
    requirements: string[];
  };
}

const SCORING_INSTRUCTIONS = `You are a technical recruiter evaluating candidate fit for a job opening.
Score the candidate 0-100 against the job requirements.

Return ONLY a raw JSON object — no markdown, no code fences, no explanation.
The JSON must contain exactly these keys:
- "score" (integer 0-100): Overall fit score. 0-30 = poor fit, 31-50 = weak, 51-70 = moderate, 71-85 = strong, 86-100 = exceptional.
- "reasoning" (string): 1-2 sentences explaining the score.
- "strengths" (string[]): 2-5 specific strengths relevant to this job.
- "gaps" (string[]): 0-5 specific gaps or missing requirements.

RULES:
- Base score solely on the provided information — do not assume skills not mentioned.
- If the CV text is very short or uninformative, score conservatively (30-50 range).
- Be specific in strengths and gaps — reference actual skills/requirements, not generic statements.`;

@Injectable()
export class ScoringAgentService {
  private readonly logger = new Logger(ScoringAgentService.name);

  constructor(private readonly config: ConfigService) {}

  async score(input: ScoringInput): Promise<ScoreResult & { modelUsed: string }> {
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY')!;
    const client = new OpenRouter({ apiKey });

    const candidateSection = [
      `Candidate:`,
      `- Current Role: ${input.candidateFields.currentRole ?? 'Unknown'}`,
      `- Years of Experience: ${input.candidateFields.yearsExperience ?? 'Unknown'}`,
      `- Skills: ${input.candidateFields.skills.length > 0 ? input.candidateFields.skills.join(', ') : 'None listed'}`,
      ``,
      `CV Text:`,
      input.cvText,
    ].join('\n');

    const jobSection = [
      `Job:`,
      `- Title: ${input.job.title}`,
      `- Description: ${input.job.description ?? 'N/A'}`,
      `- Requirements: ${input.job.requirements.length > 0 ? input.job.requirements.join(', ') : 'None specified'}`,
    ].join('\n');

    const userMessage = `${candidateSection}\n\n${jobSection}`;

    const result = client.callModel({
      model: 'google/gemini-2.0-flash:free',
      instructions: SCORING_INSTRUCTIONS,
      input: userMessage,
    });

    const raw = await result.getText();
    const json = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    const parseResult = ScoreSchema.safeParse(JSON.parse(json));
    if (!parseResult.success) {
      this.logger.error('Scoring LLM returned invalid JSON', parseResult.error.errors);
      throw new Error(`Scoring output validation failed: ${parseResult.error.message}`);
    }

    this.logger.log(`Scored candidate — score: ${parseResult.data.score}`);
    return { ...parseResult.data, modelUsed: 'google/gemini-2.0-flash' };
  }
}
```

**Dependencies:** `ConfigService` must be injected — update `ScoringModule` if needed to import `ConfigModule`.

**Error handling in processor:** The processor already has a try/catch around `scoringService.score()` with `continue` on error (Issue Fix 2). This means scoring failures are isolated per-job — one bad score doesn't fail the whole pipeline. This is correct behavior; no change needed.

**Acceptance:** Each candidate gets a unique score per job based on actual CV content. `modelUsed` reflects real model name.

---

## 4. Files to Modify (Complete List)

| # | File | Changes |
|---|------|---------|
| 1 | `src/ingestion/services/extraction-agent.service.ts` | New schema, new prompt, new method signatures, remove try/catch, make `extractDeterministically` public + extend return type |
| 2 | `src/ingestion/ingestion.processor.ts` | Pass metadata to extract(), use extracted fields in Phase 7, pass source_hint, deterministic fallback on final attempt, fix scoring input |
| 3 | `src/dedup/dedup.service.ts` | Add `source` param to `insertCandidate()` |
| 4 | `src/scoring/scoring.service.ts` | Replace hardcoded mock with real OpenRouter LLM call, add ConfigService injection, new scoring prompt |

**Files NOT to touch:**
- `webhooks.service.ts` — works correctly
- `webhooks.controller.ts` — works correctly
- `spam-filter.service.ts` — works correctly
- `attachment-extractor.service.ts` — works correctly
- `storage.service.ts` — works correctly
- `candidates.service.ts` — works correctly (already maps all fields to API response)
- Prisma schema — no changes needed (all fields already exist)
- `ScoringInput` interface — already has nullable `currentRole` and `yearsExperience`

---

## 5. Testing Checklist

### Unit Tests

- [ ] `ExtractionAgentService.extract()` — throws on API error (not swallowed)
- [ ] `ExtractionAgentService.extract()` — returns all new fields when LLM returns valid JSON
- [ ] `ExtractionAgentService.extract()` — throws on malformed LLM JSON (triggers retry)
- [ ] `ExtractionAgentService.extractDeterministically()` — returns valid schema with new fields
- [ ] `CandidateExtractSchema` — validates all field types correctly
- [ ] `CandidateExtractSchema` — rejects invalid `years_experience` (negative, float, >50)
- [ ] `DedupService.insertCandidate()` — uses provided source param
- [ ] `DedupService.insertCandidate()` — defaults to 'direct' when source is null
- [ ] `ScoringAgentService.score()` — returns valid ScoreResult with real reasoning (not hardcoded)
- [ ] `ScoringAgentService.score()` — throws on malformed LLM JSON (processor catches and continues)

### Integration Tests (with real OpenRouter call)

- [ ] Send a real CV text to `extract()` → verify all fields populated
- [ ] Send garbage text → verify `full_name: ""` is returned (not a crash)
- [ ] Send Hebrew CV → verify extraction works (Gemini handles Hebrew)
- [ ] Verify rate limiting: send 10 requests rapidly → confirm no 429 errors on free tier (or graceful handling)

### E2E Tests (full pipeline)

- [ ] POST to `/api/webhooks/email` with a realistic Postmark payload containing a PDF CV attachment
- [ ] Verify `candidates` table row has: `full_name`, `email`, `phone`, `current_role`, `years_experience`, `location`, `skills[]`, `ai_summary`, `cv_file_url`, `source` — all populated
- [ ] Verify `email_intake_log` status = `completed`
- [ ] Verify `applications` table has rows for each active job
- [ ] Verify `candidate_job_scores` table has scores with real reasoning (not hardcoded "Strong TypeScript background")
- [ ] **Retry test:** Mock OpenRouter to fail twice, succeed on 3rd → verify candidate is created
- [ ] **Final failure test:** Mock OpenRouter to fail 3 times → verify deterministic fallback runs → candidate created with partial data

---

## 6. OpenRouter Budget Management

**Primary model:** `google/gemini-2.0-flash:free`
- Free tier with rate limits (exact limits vary, typically ~15 RPM)
- Sufficient for development and low-volume production

**Fallback model:** `google/gemini-2.0-flash` (paid)
- ~$0.10 per 1M input tokens, ~$0.40 per 1M output tokens
- A typical CV extraction: ~2K input tokens + ~500 output tokens ≈ $0.0004 per call
- $5 budget ≈ **~12,500 extractions** on paid tier

**Implementation:** No code change needed for budget management in Phase 1. The free tier is sufficient. If rate-limited, BullMQ retries naturally handle the backoff. If the free model is deprecated or becomes unreliable, change the model string in `callAI()` to `google/gemini-2.0-flash` (paid).

**Cost per candidate (full pipeline):**
- Extraction: 1 LLM call (free or ~$0.0004)
- Scoring: 1 call per active job × N jobs (free or ~$0.0004 each)
- Total per candidate with 5 active jobs: free, or ~$0.0024 on paid tier
- $5 budget covers: ~2,000 full candidate pipelines (5 jobs each) on paid tier

---

## 7. Execution Order

**Do these in order — each builds on the previous:**

| Step | Task | Est. Time | Dependencies |
|------|------|-----------|--------------|
| 1 | Task 1: Extend CandidateExtractSchema | 15 min | None |
| 2 | Task 2: Rewrite LLM Prompt | 20 min | Task 1 |
| 3 | Task 3: Update extract() + callAI() + error handling | 30 min | Tasks 1-2 |
| 4 | Task 5: Update DedupService.insertCandidate | 10 min | Task 1 (type) |
| 5 | Task 4: Update Processor | 30 min | Tasks 1-3, 5 |
| 6 | Task 7: Fix Scoring Input | 10 min | Task 4 |
| 7 | Task 8: Wire real scoring via OpenRouter | 30 min | None (independent) |
| 8 | Task 6: Deterministic fallback | 20 min | Tasks 3-4 |
| 9 | Testing | 30-60 min | All above |

**Total estimated time: ~4-5 hours**

---

## 8. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| OpenRouter free tier rate-limited | BullMQ exponential backoff handles this naturally; 3 retries with 5s/10s/20s delays |
| LLM returns wrong JSON structure | `safeParse` catches it → throws → BullMQ retries; on 3rd failure → deterministic fallback |
| LLM hallucinates skills/role | Prompt says "Do NOT invent information. Only extract what is explicitly stated." — best effort; downstream UI can allow manual correction |
| Hebrew CVs parsed incorrectly | Gemini 2.0 Flash handles Hebrew well; test with real Hebrew CVs |
| Extraction changes break existing tests | Only 3 files change; existing tests for webhooks, spam filter, attachments, storage, dedup core logic are unaffected |
| Budget exhausted | Free tier is primary; $5 paid fallback covers ~2,000 full pipelines; monitor via OpenRouter dashboard |
| Scoring rate limit with many active jobs | Processor already has try/catch per job with `continue` — one rate-limited score doesn't block others; BullMQ retry handles the full job |

---

## 9. What This Does NOT Cover (Phase 2+)

- **Job matching from email content** — currently scores against ALL active jobs; smart job matching is Phase 2
- **Auth / multi-user** — single tenant, no auth in Phase 1
- **Manual CV upload extraction** — `candidates.service.ts` `createCandidate()` accepts manual input; AI extraction of uploaded files is Phase 2
- **Screening questions** — schema exists, extraction not wired
- **Webhook for scoring completion** — no notification to UI when scoring finishes
- **Model upgrade** — current model (Gemini Flash free) is sufficient for both extraction and scoring; upgrade to paid tier or Claude Haiku is a config change only
- **ScoringModule DI** — if `ScoringModule` doesn't already import `ConfigModule`, the agent must add it for `ConfigService` injection in `ScoringAgentService`
