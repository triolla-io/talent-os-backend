# PM Bridge Smart-Intake — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the one-shot PM-Bridge ticket flow into a multi-turn "clarify → confirm → silently build a right-sized, assigned-to-Daniel Jira hierarchy, or hold conflicts for Daniel" pipeline.

**Architecture:** Hybrid brain. Stage ① *clarify* is a stateless agentic loop (`POST /converse`, client holds the transcript). Stages ② *validate* → ③ *decompose* → ④ *file* run on `POST /commit` and are deterministic, schema-validated single LLM calls / pure Jira writes. Conflicts are persisted to `pm_held_requests` and emailed to Daniel with `@Public()` approve/reject links; nothing reaches Jira until he approves. All issues are assigned to Daniel.

**Tech Stack:** NestJS 11, Prisma 7 (`@prisma/adapter-pg`, PostgreSQL 16), Zod **v4**, Vercel **`ai` v6** `generateObject` + `@openrouter/ai-sdk-provider`, **`jose`** v6 (tokens), **`nodemailer`** (SMTP/Mailgun), Jest 30 + ts-jest.

**Source spec:** `docs/superpowers/specs/2026-06-23-pm-bridge-smart-intake-design.md`

## Global Constraints

- **Module:** all backend work is in `src/pm-bridge/` plus narrow edits to `src/config/env.ts`, `src/auth/email.service.ts`, `src/auth/auth.module.ts`, `prisma/schema.prisma`, and `PROTOCOL.md`.
- **Tenant identity:** `tenantId = req.session!.org`; PM email = `req.pmBridgeEmail` (set by `PmBridgeGuard`). Never invent an email claim.
- **Assignee:** every created Jira issue (Epic, Story, Task, Bug, Sub-task) is assigned to Daniel via `accountId`.
- **PM never sees Jira concepts:** no issue types, keys, "epic/story/subtask", acceptance criteria, or override controls in any PM-facing response.
- **PM-facing copy = easy, everyday English:** every word the LLM shows the PM — clarify question `prompt`s, `chips`, and the one-line `goal` — must be simple, short, and skimmable. Treat the reader as a busy, severely-ADHD non-technical person: one idea per sentence, common daily words, no jargon, no long/compound sentences, chips kept to 1–3 plain words. (Developer-facing text — the hidden `brief`, `devNotes`, the decompose output, and `reasonPlain` for Daniel — stays technical.)
- **Conflict posture:** the PM can never force a conflict through. Duplicates fold into the existing ticket (comment only, never overwrite); genuine conflicts are held for Daniel.
- **Jira hierarchy is native 3-level:** `Epic` ▸ `Story`/`Task`/`Bug` ▸ `Sub-task`. No 4-deep chains.
- **DB conventions:** UUID PK `@default(dbgenerated("gen_random_uuid()")) @db.Uuid`; `@db.Timestamptz`; `@db.Text`; camelCase→snake_case via `@map`/`@@map`; status is `text` + a CHECK constraint added by raw SQL in the migration (no Postgres enums); every tenant table has the `organization Organization @relation(...)` back-ref.
- **AI calls:** `const { object } = await generateObject({ model: this.openrouter.chat(this.model), schema, schemaName, system, prompt, temperature: 0 })`. `object` is already validated against the Zod schema.
- **Tokens:** hold approve/reject links are signed with their own secret `PM_HOLD_TOKEN_SECRET` (NOT `JWT_SECRET`, or the token would be a valid session cookie). Single-use is enforced by the hold row's `status`.
- **Migrations run in Docker:** `npm run db:migrate` → `docker compose -f docker-compose.dev.yml exec api npx prisma migrate dev`. Stack must be up (`npm run docker:up`). Prod auto-migrates on boot.
- **Run a single test:** `npm test -- src/pm-bridge/<file>.spec.ts`.
- **Deviation from spec:** spec's `PM_BRIDGE_TOKEN_SECRET` is implemented as `PM_HOLD_TOKEN_SECRET`; the held-item email reuses the existing `EmailService` (a new `sendText` method) instead of a standalone provider; the `approveToken` column is dropped (token is stateless `jose`, single-use enforced by `status`).

---

### Task 1: `pm_held_requests` table

**Files:**
- Modify: `prisma/schema.prisma` (add `PmHeldRequest` model; add back-relation to `Organization`)
- Create: `prisma/migrations/<timestamp>_add_pm_held_requests/migration.sql` (generated, then hand-edit CHECK)

**Interfaces:**
- Produces: Prisma model `PmHeldRequest` with fields `id, tenantId, rawText, goal, conversation(Json), brief(Json), verdict(Json), status, createdBy, jiraKeys(Json?), createdAt, resolvedAt?`. Accessed as `prisma.pmHeldRequest`.

- [ ] **Step 1: Add the model to `prisma/schema.prisma`**

Append after the `PmProductDecision` model (around line 344):

```prisma
// ─── pm_held_requests ─────────────────────────────────────────────────────────
// Conflicting PM requests parked for Daniel to approve/reject. Nothing reaches Jira
// until approved. status CHECK ('pending','approved','rejected') added via raw SQL.
model PmHeldRequest {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId     String    @map("tenant_id") @db.Uuid
  rawText      String    @map("raw_text") @db.Text
  goal         String    @db.Text
  conversation Json      @db.JsonB
  brief        Json      @db.JsonB
  verdict      Json      @db.JsonB
  status       String    @default("pending") @db.Text
  createdBy    String    @map("created_by") @db.Text
  jiraKeys     Json?     @map("jira_keys") @db.JsonB
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz
  resolvedAt   DateTime? @map("resolved_at") @db.Timestamptz

  organization Organization @relation(fields: [tenantId], references: [id], onDelete: Restrict)

  @@index([tenantId, status], name: "idx_pm_held_tenant_status")
  @@map("pm_held_requests")
}
```

- [ ] **Step 2: Add the back-relation on `Organization`**

In the `Organization` model, under the `// Relations — pm-bridge` comment (next to `pmProductDecisions PmProductDecision[]`), add:

```prisma
  pmHeldRequests PmHeldRequest[]
```

- [ ] **Step 3: Generate the migration (stack must be up)**

Run:
```bash
npm run docker:up        # if not already running, in another terminal
npm run db:migrate -- --name add_pm_held_requests
```
Expected: Prisma creates `prisma/migrations/<timestamp>_add_pm_held_requests/migration.sql`, applies it, and regenerates the client. `prisma.pmHeldRequest` becomes available.

- [ ] **Step 4: Hand-add the CHECK constraint**

Append to the generated `migration.sql`:

```sql
-- CHECK constraint: status must be one of the allowed values (project convention: text + CHECK)
ALTER TABLE "pm_held_requests" ADD CONSTRAINT "pm_held_requests_status_check" CHECK (status IN ('pending', 'approved', 'rejected'));
```

- [ ] **Step 5: Re-apply so the CHECK lands**

Run:
```bash
npm run db:migrate
```
Expected: "Already in sync" for the table plus the new constraint applied (or a no-op if Prisma already ran it). Verify in Studio: `npm run db:studio` → `pm_held_requests` table exists with the columns above.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(pm-bridge): add pm_held_requests table"
```

---

### Task 2: Environment variables

**Files:**
- Modify: `src/config/env.ts`

**Interfaces:**
- Produces config keys: `JIRA_DEFAULT_ASSIGNEE_ACCOUNT_ID` (required in API), `JIRA_DEFAULT_ASSIGNEE_EMAIL?`, `PM_HOLD_NOTIFY_EMAIL` (default `daniel.s@triolla.io`), `PM_HOLD_TOKEN_SECRET` (required in API, ≥32), `API_PUBLIC_URL?`.

- [ ] **Step 1: Write the failing test**

Create `src/config/env.spec.ts`:

```ts
import { envSchema, apiEnvSchema } from './env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  OPENROUTER_API_KEY: 'k',
  MAILGUN_WEBHOOK_SIGNING_KEY: 'k',
  R2_ACCOUNT_ID: 'a',
  R2_ACCESS_KEY_ID: 'a',
  R2_SECRET_ACCESS_KEY: 'a',
  R2_BUCKET_NAME: 'b',
  JWT_SECRET: 'x'.repeat(32),
  JIRA_BASE_URL: 'https://triolla.atlassian.net',
  JIRA_EMAIL: 'e@x.com',
  JIRA_API_TOKEN: 't',
};

describe('apiEnvSchema PM-Bridge vars', () => {
  it('requires JIRA_DEFAULT_ASSIGNEE_ACCOUNT_ID and a ≥32-char PM_HOLD_TOKEN_SECRET', () => {
    expect(() => apiEnvSchema.parse(base)).toThrow();
    const ok = apiEnvSchema.parse({
      ...base,
      JIRA_DEFAULT_ASSIGNEE_ACCOUNT_ID: 'acc-123',
      PM_HOLD_TOKEN_SECRET: 's'.repeat(32),
    });
    expect(ok.PM_HOLD_NOTIFY_EMAIL).toBe('daniel.s@triolla.io');
  });

  it('worker base schema does NOT require the API-only PM-Bridge vars', () => {
    expect(() => envSchema.parse(base)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm test -- src/config/env.spec.ts`
Expected: FAIL (`PM_HOLD_NOTIFY_EMAIL` undefined / no throw on missing secret).

- [ ] **Step 3: Add the vars to `envSchema`**

In `src/config/env.ts`, inside `envSchema`, after the `PM_BRIDGE_MODEL` line, add:

```ts
  // PM Bridge smart-intake. Optional in the base schema (worker never uses them);
  // the API re-requires the secret + assignee via apiEnvSchema.
  JIRA_DEFAULT_ASSIGNEE_ACCOUNT_ID: z.string().min(1).optional(),
  JIRA_DEFAULT_ASSIGNEE_EMAIL: z.string().min(1).optional(),
  PM_HOLD_NOTIFY_EMAIL: z.string().min(1).default('daniel.s@triolla.io'),
  PM_HOLD_TOKEN_SECRET: z.string().min(32, 'PM_HOLD_TOKEN_SECRET must be at least 32 characters').optional(),
  API_PUBLIC_URL: z.url().optional(),
```

- [ ] **Step 4: Require the API-only vars in `apiEnvSchema`**

Change `apiEnvSchema` to:

```ts
export const apiEnvSchema = envSchema.extend({
  JIRA_BASE_URL: z.url(),
  JIRA_EMAIL: z.string().min(1),
  JIRA_API_TOKEN: z.string().min(1),
  JIRA_DEFAULT_ASSIGNEE_ACCOUNT_ID: z.string().min(1),
  PM_HOLD_TOKEN_SECRET: z.string().min(32, 'PM_HOLD_TOKEN_SECRET must be at least 32 characters'),
});
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npm test -- src/config/env.spec.ts`
Expected: PASS.

- [ ] **Step 6: Document the vars in CLAUDE.md**

In `CLAUDE.md` under `# PM Bridge — Jira integration`, append:

```
JIRA_DEFAULT_ASSIGNEE_ACCOUNT_ID  # Jira accountId every issue is assigned to (Daniel)
JIRA_DEFAULT_ASSIGNEE_EMAIL       # optional — fallback to look up the accountId at runtime
PM_HOLD_NOTIFY_EMAIL              # who gets held-item emails (default daniel.s@triolla.io)
PM_HOLD_TOKEN_SECRET             # ≥32 chars — signs approve/reject email links (NOT JWT_SECRET)
API_PUBLIC_URL                   # optional — public base URL of the API for email links
```

- [ ] **Step 7: Commit**

```bash
git add src/config/env.ts src/config/env.spec.ts CLAUDE.md
git commit -m "feat(pm-bridge): add smart-intake env vars"
```

---

### Task 3: DTOs & Zod schemas

**Files:**
- Create: `src/pm-bridge/dto/brief.dto.ts`
- Create: `src/pm-bridge/dto/converse.dto.ts`
- Modify (rewrite): `src/pm-bridge/dto/ai-output.dto.ts`
- Modify (rewrite): `src/pm-bridge/dto/commit.dto.ts`
- Delete: `src/pm-bridge/dto/draft.dto.ts`
- Test: `src/pm-bridge/dto/schemas.spec.ts`

**Interfaces:**
- Produces: `Page`, `InternalBrief`, `Turn`, `ConverseRequest`, `ClarifyQuestion`, `ClarifyResult`, `ValidationResult`, `DecomposedSubtask`, `DecomposedChild`, `DecomposedRoot`, `DecomposeResult`, `CommitRequest`, and response types `ConverseResponse`, `CommitResponse`. These names are consumed verbatim by Tasks 4–11.

- [ ] **Step 1: Create `brief.dto.ts`**

```ts
import { z } from 'zod';

export const PageSchema = z.object({
  name: z.string(),
  route: z.string(),
});
export type Page = z.infer<typeof PageSchema>;

// Hidden structured intent. Emitted by stage ① clarify, consumed by ②③.
export const InternalBriefSchema = z.object({
  goal: z.string(),                 // the one line shown to the PM
  problem: z.string(),
  desiredOutcomes: z.array(z.string()),
  constraints: z.array(z.string()),
  affectedArea: PageSchema,
  sizeHint: z.enum(['tiny', 'medium', 'large']),
  devNotes: z.array(z.string()),    // technical seeds for enrichment
  rawText: z.string(),
  conversationDigest: z.string(),
});
export type InternalBrief = z.infer<typeof InternalBriefSchema>;
```

- [ ] **Step 2: Create `converse.dto.ts`**

```ts
import { z } from 'zod';
import { InternalBriefSchema, PageSchema } from './brief.dto';

export const TurnSchema = z.object({
  role: z.enum(['pm', 'assistant']),
  content: z.string(),
});
export type Turn = z.infer<typeof TurnSchema>;

export const ConverseRequestSchema = z.object({
  messages: z.array(TurnSchema).min(1),
  page: PageSchema,
});
export type ConverseRequest = z.infer<typeof ConverseRequestSchema>;

export const ClarifyQuestionSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  chips: z.array(z.string()),       // tappable answers; [] when free-text only
  allowFreeText: z.boolean(),
});
export type ClarifyQuestion = z.infer<typeof ClarifyQuestionSchema>;

// HTTP responses — PM-facing, no Jira concepts.
export type ConverseResponse =
  | { type: 'clarify'; questions: ClarifyQuestion[] }
  | { type: 'ready'; goal: string; brief: import('./brief.dto').InternalBrief }
  | { type: 'held' };
```

- [ ] **Step 3: Rewrite `ai-output.dto.ts`**

Replace the entire file with:

```ts
import { z } from 'zod';
import { InternalBriefSchema } from './brief.dto';
import { ClarifyQuestionSchema } from './converse.dto';

// ── Stage ① clarify ──────────────────────────────────────────────────────────
// The model returns EITHER clarify questions OR a ready brief + one-line goal.
export const ClarifyResultSchema = z.object({
  type: z.enum(['clarify', 'ready']),
  questions: z.array(ClarifyQuestionSchema),   // [] when ready
  goal: z.string(),                            // '' when clarifying
  brief: InternalBriefSchema.nullable(),       // null when clarifying
});
export type ClarifyResult = z.infer<typeof ClarifyResultSchema>;

// ── Stage ② validate ─────────────────────────────────────────────────────────
export const ValidationResultSchema = z.object({
  status: z.enum(['clean', 'duplicate', 'conflict']),
  duplicateOfKey: z.string().nullable(),       // set only when status='duplicate'
  reasonPlain: z.string(),                     // plain-English why (for Daniel / the hold)
  related: z.array(
    z.object({ key: z.string(), summary: z.string(), reasonPlain: z.string() }),
  ),
  conflictingDecisionIds: z.array(z.string()),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

// ── Stage ③ decompose ────────────────────────────────────────────────────────
// Native Jira 3-level hierarchy: Epic ▸ Story/Task/Bug ▸ Sub-task.
export const DecomposedSubtaskSchema = z.object({
  summary: z.string(),
  description: z.string(),
});
export type DecomposedSubtask = z.infer<typeof DecomposedSubtaskSchema>;

export const DecomposedChildSchema = z.object({
  issueType: z.enum(['Story', 'Task', 'Bug']),
  summary: z.string(),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
  subtasks: z.array(DecomposedSubtaskSchema),
});
export type DecomposedChild = z.infer<typeof DecomposedChildSchema>;

export const DecomposedRootSchema = z.object({
  issueType: z.enum(['Epic', 'Story', 'Task', 'Bug']),
  summary: z.string(),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
  children: z.array(DecomposedChildSchema),    // populated when root is an Epic
  subtasks: z.array(DecomposedSubtaskSchema),  // populated when root is a Story/Task
});
export type DecomposedRoot = z.infer<typeof DecomposedRootSchema>;

export const DecomposeResultSchema = z.object({
  size: z.enum(['tiny', 'medium', 'large']),
  root: DecomposedRootSchema,
});
export type DecomposeResult = z.infer<typeof DecomposeResultSchema>;
```

- [ ] **Step 4: Rewrite `commit.dto.ts`**

Replace the entire file with:

```ts
import { z } from 'zod';
import { InternalBriefSchema, PageSchema } from './brief.dto';

export const CommitRequestSchema = z.object({
  brief: InternalBriefSchema,
  page: PageSchema,
});
export type CommitRequest = z.infer<typeof CommitRequestSchema>;

export type CommitResponse = { type: 'filed' | 'merged' | 'held' };
```

- [ ] **Step 5: Delete `draft.dto.ts`**

```bash
git rm src/pm-bridge/dto/draft.dto.ts
```

- [ ] **Step 6: Write schema tests**

Create `src/pm-bridge/dto/schemas.spec.ts`:

```ts
import { ConverseRequestSchema } from './converse.dto';
import { CommitRequestSchema } from './commit.dto';
import { DecomposeResultSchema, ClarifyResultSchema } from './ai-output.dto';

const brief = {
  goal: 'Make search fast',
  problem: 'Search is slow',
  desiredOutcomes: ['fast'],
  constraints: [],
  affectedArea: { name: 'Talent Pool', route: '/talent-pool' },
  sizeHint: 'medium' as const,
  devNotes: [],
  rawText: 'search is slow',
  conversationDigest: 'pm wants faster search',
};

describe('PM Bridge schemas', () => {
  it('ConverseRequest requires at least one message', () => {
    expect(ConverseRequestSchema.safeParse({ messages: [], page: { name: 'X', route: '/' } }).success).toBe(false);
    expect(
      ConverseRequestSchema.safeParse({
        messages: [{ role: 'pm', content: 'search is slow' }],
        page: { name: 'Talent Pool', route: '/talent-pool' },
      }).success,
    ).toBe(true);
  });

  it('CommitRequest carries a full InternalBrief', () => {
    expect(CommitRequestSchema.safeParse({ brief, page: brief.affectedArea }).success).toBe(true);
  });

  it('DecomposeResult parses an Epic with a child + subtask', () => {
    const r = DecomposeResultSchema.safeParse({
      size: 'large',
      root: {
        issueType: 'Epic', summary: 'E', description: 'D', acceptanceCriteria: [], subtasks: [],
        children: [{ issueType: 'Story', summary: 'S', description: 'D', acceptanceCriteria: ['ac'], subtasks: [{ summary: 'st', description: 'd' }] }],
      },
    });
    expect(r.success).toBe(true);
  });

  it('ClarifyResult parses a clarify turn and a ready turn', () => {
    expect(ClarifyResultSchema.safeParse({ type: 'clarify', questions: [{ id: 'q1', prompt: 'slow or wrong?', chips: ['slow', 'wrong'], allowFreeText: true }], goal: '', brief: null }).success).toBe(true);
    expect(ClarifyResultSchema.safeParse({ type: 'ready', questions: [], goal: 'Make search fast', brief }).success).toBe(true);
  });
});
```

- [ ] **Step 7: Run tests, verify pass**

Run: `npm test -- src/pm-bridge/dto/schemas.spec.ts`
Expected: PASS. (`pm-ai.service.ts` / `pm-bridge.service.ts` will not compile yet — that is fixed in Tasks 4–9. Run only this file.)

- [ ] **Step 8: Commit**

```bash
git add src/pm-bridge/dto
git commit -m "feat(pm-bridge): new converse/brief/validate/decompose schemas"
```

---

### Task 4: `PmAiService.clarify()`

**Files:**
- Modify: `src/pm-bridge/pm-ai.service.ts` (start the rewrite — replace `draftAndValidate` with `clarify`)
- Modify: `src/pm-bridge/pm-ai.service.spec.ts`

**Interfaces:**
- Consumes: `Turn`, `Page` (Task 3), `CondensedTicket` (jira-gateway), `PmProductDecision` (Prisma), `ClarifyResult`/`ClarifyResultSchema` (Task 3).
- Produces: `clarify(input: ClarifyInput): Promise<ClarifyResult>` where `ClarifyInput = { messages: Turn[]; board: CondensedTicket[]; decisions: PmProductDecision[]; page: Page; roundsUsed: number }`.

- [ ] **Step 1: Write the failing test**

Replace `src/pm-bridge/pm-ai.service.spec.ts` with:

```ts
import { PmAiService } from './pm-ai.service';

jest.mock('ai', () => ({ generateObject: jest.fn() }));
jest.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: jest.fn(() => ({ chat: jest.fn(() => 'mock-model') })),
}));

import { generateObject } from 'ai';

beforeEach(() => jest.clearAllMocks());

function makeService() {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'OPENROUTER_API_KEY') return 'test-key';
      if (key === 'PM_BRIDGE_MODEL') return 'anthropic/claude-sonnet-4.6';
      return undefined;
    }),
  };
  return new PmAiService(config as any);
}

describe('PmAiService.clarify', () => {
  it('returns a clarify result with questions', async () => {
    (generateObject as jest.Mock).mockResolvedValue({
      object: { type: 'clarify', questions: [{ id: 'q1', prompt: 'Slow or wrong?', chips: ['Slow', 'Wrong'], allowFreeText: true }], goal: '', brief: null },
    });
    const svc = makeService();
    const result = await svc.clarify({
      messages: [{ role: 'pm', content: 'search is bad' }],
      board: [], decisions: [], page: { name: 'Talent Pool', route: '/talent-pool' }, roundsUsed: 0,
    });
    expect(result.type).toBe('clarify');
    expect(result.questions[0].chips).toContain('Slow');
  });

  it('feeds the board and decisions into the prompt so it can ask a plain dedup question', async () => {
    (generateObject as jest.Mock).mockResolvedValue({ object: { type: 'clarify', questions: [], goal: '', brief: null } });
    const svc = makeService();
    await svc.clarify({
      messages: [{ role: 'pm', content: 'speed up search' }],
      board: [{ key: 'TO-1', type: 'Story', summary: 'Improve search speed', status: 'In Progress' }],
      decisions: [{ id: 'd1', statement: 'No dark mode', status: 'active' } as any],
      page: { name: 'Talent Pool', route: '/talent-pool' },
      roundsUsed: 1,
    });
    const call = (generateObject as jest.Mock).mock.calls[0][0];
    expect(call.prompt).toContain('Improve search speed');
    expect(call.prompt).toContain('No dark mode');
    expect(call.prompt).toContain('search');           // the transcript
    expect(call.schemaName).toBe('PmBridgeClarify');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm test -- src/pm-bridge/pm-ai.service.spec.ts`
Expected: FAIL (`clarify` is not a function).

- [ ] **Step 3: Rewrite the top of `pm-ai.service.ts`**

Replace the imports + interface block (lines 1–13) and the `SYSTEM_PROMPT` with:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateObject } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import {
  ClarifyResultSchema, type ClarifyResult,
  ValidationResultSchema, type ValidationResult,
  DecomposeResultSchema, type DecomposeResult,
} from './dto/ai-output.dto';
import type { Turn, Page } from './dto/converse.dto';
import type { InternalBrief } from './dto/brief.dto';
import type { CondensedTicket } from './jira-gateway.service';
import type { PmProductDecision } from '@prisma/client';

export interface ClarifyInput {
  messages: Turn[];
  board: CondensedTicket[];
  decisions: PmProductDecision[];
  page: Page;
  roundsUsed: number;
}

const CLARIFY_SYSTEM = `You are a sharp, skeptical senior technical PM talking to a NON-technical, impulsive product manager. Your job is to understand what he actually wants — never to expose Jira, tickets, or any technical structure.

Decide between two outputs:
- type "clarify": ask 1–3 SHORT plain-English questions. Use questions to (a) resolve vagueness, (b) catch self-contradiction, and (c) when the request looks like work already in progress, ask a plain yes/no — e.g. "This sounds like the search-speed work already underway — same thing, or new?". NEVER mention ticket keys, issue types, or Jira. Provide tappable "chips" (likely answers) whenever the answers are predictable; set allowFreeText true.
- type "ready": only when you genuinely understand the goal. Emit "goal" (ONE plain sentence the PM will confirm — no jargon) and a complete hidden "brief".

Rules:
- Be conservative about "ready". If the ask is vague, contradictory, or could mean very different things, clarify instead.
- The "brief" is hidden from the PM; write it for a developer. sizeHint: "tiny" = a one-line tweak, "medium" = a single feature slice, "large" = a multi-part feature. devNotes = concrete technical seeds the developer will need.
- When type is "clarify": questions non-empty, goal "", brief null. When type is "ready": questions [], goal set, brief set.

WRITING STYLE — applies to EVERY word the PM will read (each question "prompt", every "chip", and the "goal"): write in easy, everyday English for a busy, severely-ADHD, non-technical reader. One idea per sentence. Short sentences. Common daily words — no jargon, no technical terms, no Jira words. Keep each question to a single line; keep chips to 1–3 plain words. Make it instantly skimmable. This does NOT apply to the hidden "brief", which you write for a developer.`;
```

- [ ] **Step 4: Replace the class body with `clarify()`**

Replace the `@Injectable() export class PmAiService { ... }` block (keep the constructor) so the class reads:

```ts
@Injectable()
export class PmAiService {
  private readonly logger = new Logger(PmAiService.name);
  private readonly openrouter: ReturnType<typeof createOpenRouter>;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.openrouter = createOpenRouter({ apiKey: config.get<string>('OPENROUTER_API_KEY')! });
    this.model = config.get<string>('PM_BRIDGE_MODEL') ?? 'anthropic/claude-sonnet-4.6';
  }

  async clarify(input: ClarifyInput): Promise<ClarifyResult> {
    const transcript = input.messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
    const board = input.board.length
      ? input.board.map((t) => `- [${t.key}] (${t.type}, ${t.status}) ${t.summary}`).join('\n')
      : '(no open tickets)';
    const decisions = input.decisions.filter((d) => d.status === 'active').length
      ? input.decisions.filter((d) => d.status === 'active').map((d) => `- [${d.id}] ${d.statement}`).join('\n')
      : '(no recorded product decisions)';

    const prompt = [
      `Where the PM is in the app: ${input.page.name} (${input.page.route})`,
      `Clarify rounds already used: ${input.roundsUsed}`,
      '',
      'Conversation so far:',
      transcript,
      '',
      'Work already in progress (for spotting overlap — NEVER reveal these to the PM):',
      board,
      '',
      'Recorded product decisions (rules the PM must not silently break):',
      decisions,
    ].join('\n');

    const { object } = await generateObject({
      model: this.openrouter.chat(this.model),
      schema: ClarifyResultSchema,
      schemaName: 'PmBridgeClarify',
      system: CLARIFY_SYSTEM,
      prompt,
      temperature: 0,
    });

    this.logger.log(`PM Bridge clarify: type=${object.type} questions=${object.questions.length}`);
    return object;
  }
}
```

- [ ] **Step 5: Run the clarify tests, verify pass**

Run: `npm test -- src/pm-bridge/pm-ai.service.spec.ts`
Expected: PASS. (Other pm-bridge files won't compile yet — Tasks 5–9 finish them.)

- [ ] **Step 6: Commit**

```bash
git add src/pm-bridge/pm-ai.service.ts src/pm-bridge/pm-ai.service.spec.ts
git commit -m "feat(pm-bridge): PmAiService.clarify agentic stage"
```

---

### Task 5: `PmAiService.validate()` + `decompose()`

**Files:**
- Modify: `src/pm-bridge/pm-ai.service.ts` (add two methods)
- Modify: `src/pm-bridge/pm-ai.service.spec.ts` (add tests)

**Interfaces:**
- Produces:
  - `validate(input: { brief: InternalBrief; board: CondensedTicket[]; decisions: PmProductDecision[] }): Promise<ValidationResult>`
  - `decompose(input: { brief: InternalBrief }): Promise<DecomposeResult>`

- [ ] **Step 1: Write the failing tests**

Append to `src/pm-bridge/pm-ai.service.spec.ts`:

```ts
const sampleBrief = {
  goal: 'Make candidate search fast',
  problem: 'Search takes several seconds on big lists',
  desiredOutcomes: ['results under 1s'],
  constraints: [],
  affectedArea: { name: 'Talent Pool', route: '/talent-pool' },
  sizeHint: 'medium' as const,
  devNotes: ['add index on search column'],
  rawText: 'search is too slow',
  conversationDigest: 'pm wants faster candidate search',
};

describe('PmAiService.validate', () => {
  it('returns a conflict verdict with a plain reason', async () => {
    (generateObject as jest.Mock).mockResolvedValue({
      object: { status: 'conflict', duplicateOfKey: null, reasonPlain: 'It undoes the read-only rule.', related: [], conflictingDecisionIds: ['d1'] },
    });
    const svc = makeService();
    const r = await svc.validate({ brief: sampleBrief, board: [], decisions: [] });
    expect(r.status).toBe('conflict');
    expect(r.reasonPlain).toContain('read-only');
  });
});

describe('PmAiService.decompose', () => {
  it('returns a sized issue tree', async () => {
    (generateObject as jest.Mock).mockResolvedValue({
      object: { size: 'medium', root: { issueType: 'Story', summary: 'Fast search', description: 'd', acceptanceCriteria: ['<1s'], children: [], subtasks: [{ summary: 'add index', description: 'd' }] } },
    });
    const svc = makeService();
    const r = await svc.decompose({ brief: sampleBrief });
    expect(r.size).toBe('medium');
    expect(r.root.subtasks).toHaveLength(1);
    const call = (generateObject as jest.Mock).mock.calls[0][0];
    expect(call.schemaName).toBe('PmBridgeDecompose');
    expect(call.prompt).toContain('Make candidate search fast');
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npm test -- src/pm-bridge/pm-ai.service.spec.ts`
Expected: FAIL (`validate`/`decompose` not functions).

- [ ] **Step 3: Add the system prompts**

In `pm-ai.service.ts`, after `CLARIFY_SYSTEM`, add:

```ts
const VALIDATE_SYSTEM = `You are a strict reviewer guarding a Jira board. You are given a developer brief and the list of open tickets + active product decisions. Decide:
- "clean": no meaningful overlap and it breaks no decision.
- "duplicate": the same work already exists. Set duplicateOfKey to that ticket's key.
- "conflict": it contradicts/overrides an open ticket OR violates a product decision. List conflictingDecisionIds and explain in reasonPlain.
Be conservative — only flag real overlap or real contradiction, not superficial similarity. reasonPlain must be plain English a non-technical person could read.`;

const DECOMPOSE_SYSTEM = `You are a senior engineer turning a product brief into a right-sized Jira plan. Jira hierarchy is exactly 3 levels: Epic ▸ Story/Task/Bug ▸ Sub-task. Do NOT exceed it.
Right-size by sizeHint and your own judgement:
- "tiny": root is a single Task (or Bug); no children, no subtasks.
- "medium": root is a single Story (or Task); no children; 1–6 Sub-tasks that are the developer checklist.
- "large": root is an Epic; children are Stories/Tasks; each child may have Sub-tasks.
Enrich every issue with the concrete technical detail the developer needs (the PM did not provide it): clear descriptions, testable acceptanceCriteria on Stories/Tasks, and actionable Sub-tasks. Sub-tasks need only summary + description. Write developer-facing English (this is never shown to the PM).`;
```

- [ ] **Step 4: Add `validate()` and `decompose()` to the class**

Inside the `PmAiService` class, after `clarify()`:

```ts
  async validate(input: {
    brief: InternalBrief;
    board: CondensedTicket[];
    decisions: PmProductDecision[];
  }): Promise<ValidationResult> {
    const board = input.board.length
      ? input.board.map((t) => `- [${t.key}] (${t.type}, ${t.status}) ${t.summary}`).join('\n')
      : '(no open tickets)';
    const decisions = input.decisions.filter((d) => d.status === 'active').length
      ? input.decisions.filter((d) => d.status === 'active').map((d) => `- [${d.id}] ${d.statement}`).join('\n')
      : '(no recorded product decisions)';

    const prompt = [
      'Developer brief:',
      JSON.stringify(input.brief, null, 2),
      '',
      'Open tickets:',
      board,
      '',
      'Active product decisions:',
      decisions,
    ].join('\n');

    const { object } = await generateObject({
      model: this.openrouter.chat(this.model),
      schema: ValidationResultSchema,
      schemaName: 'PmBridgeValidation',
      system: VALIDATE_SYSTEM,
      prompt,
      temperature: 0,
    });
    this.logger.log(`PM Bridge validate: ${object.status}`);
    return object;
  }

  async decompose(input: { brief: InternalBrief }): Promise<DecomposeResult> {
    const prompt = [
      'Turn this brief into a right-sized Jira plan:',
      JSON.stringify(input.brief, null, 2),
      '',
      `The PM-facing goal is: "${input.brief.goal}"`,
      `Suggested size: ${input.brief.sizeHint} (use your judgement).`,
    ].join('\n');

    const { object } = await generateObject({
      model: this.openrouter.chat(this.model),
      schema: DecomposeResultSchema,
      schemaName: 'PmBridgeDecompose',
      system: DECOMPOSE_SYSTEM,
      prompt,
      temperature: 0,
    });
    this.logger.log(`PM Bridge decompose: size=${object.size} root=${object.root.issueType}`);
    return object;
  }
```

- [ ] **Step 5: Run, verify pass**

Run: `npm test -- src/pm-bridge/pm-ai.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pm-bridge/pm-ai.service.ts src/pm-bridge/pm-ai.service.spec.ts
git commit -m "feat(pm-bridge): PmAiService.validate + decompose stages"
```

---

### Task 6: Jira gateway — assignee, issue tree, comment

**Files:**
- Modify: `src/pm-bridge/jira-gateway.service.ts`
- Modify: `src/pm-bridge/jira-gateway.service.spec.ts`

**Interfaces:**
- Consumes: `DecomposedRoot` (Task 3), `toAdf` (existing).
- Produces:
  - `resolveAssignee(): Promise<{ accountId: string } | null>`
  - `createIssueTree(root: DecomposedRoot): Promise<{ keys: string[] }>`
  - `addComment(key: string, text: string): Promise<void>`
  - (private `createOne(...)`). Removes `createIssue`/`updateIssue` (old commit path is gone). Keeps `readBoard`.

- [ ] **Step 1: Write the failing test**

Replace `src/pm-bridge/jira-gateway.service.spec.ts` with (mirrors the existing fetch-mock style):

```ts
import { JiraGatewayService } from './jira-gateway.service';

function makeGateway(accountId?: string, email?: string) {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'JIRA_BASE_URL') return 'https://jira.example.com';
      if (key === 'JIRA_PROJECT_KEY') return 'TO';
      if (key === 'JIRA_EMAIL') return 'svc@x.com';
      if (key === 'JIRA_API_TOKEN') return 'token';
      if (key === 'JIRA_DEFAULT_ASSIGNEE_ACCOUNT_ID') return accountId;
      if (key === 'JIRA_DEFAULT_ASSIGNEE_EMAIL') return email;
      return undefined;
    }),
  };
  return new JiraGatewayService(config as any);
}

function okJson(body: unknown) {
  return { ok: true, json: async () => body, text: async () => '' } as any;
}

afterEach(() => jest.restoreAllMocks());

describe('JiraGatewayService.createIssueTree', () => {
  it('creates Epic → child → subtask, assigns each, and links parents', async () => {
    const gw = makeGateway('acc-daniel');
    const keys = ['TO-10', 'TO-11', 'TO-12'];
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(okJson({ key: keys.shift() })));

    const result = await gw.createIssueTree({
      issueType: 'Epic', summary: 'Referral program', description: 'd', acceptanceCriteria: [], subtasks: [],
      children: [{ issueType: 'Story', summary: 'Invite flow', description: 'd', acceptanceCriteria: ['works'], subtasks: [{ summary: 'API', description: 'd' }] }],
    });

    expect(result.keys).toEqual(['TO-10', 'TO-11', 'TO-12']);
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as any).body));
    // every issue assigned to Daniel
    expect(bodies.every((b) => b.fields.assignee?.accountId === 'acc-daniel')).toBe(true);
    // child parented to epic, subtask parented to child
    expect(bodies[1].fields.parent).toEqual({ key: 'TO-10' });
    expect(bodies[2].fields.parent).toEqual({ key: 'TO-11' });
    expect(bodies[2].fields.issuetype).toEqual({ name: 'Sub-task' });
  });
});

describe('JiraGatewayService.addComment', () => {
  it('POSTs an ADF comment body', async () => {
    const gw = makeGateway('acc');
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(okJson({}));
    await gw.addComment('TO-5', 'PM follow-up: make it faster');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/rest/api/3/issue/TO-5/comment');
    expect(JSON.parse((opts as any).body).body.type).toBe('doc');
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npm test -- src/pm-bridge/jira-gateway.service.spec.ts`
Expected: FAIL (`createIssueTree`/`addComment` not functions).

- [ ] **Step 3: Update imports + the file header**

In `jira-gateway.service.ts`, replace `import type { IssueDraft } from './dto/ai-output.dto';` with:

```ts
import type { DecomposedRoot } from './dto/ai-output.dto';
```

Add an assignee cache field to the class (after `private readonly sprintId`):

```ts
  // undefined = not yet resolved; null = no assignee configured/found
  private assigneeCache: { accountId: string } | null | undefined = undefined;
```

- [ ] **Step 4: Replace `createIssue` and `updateIssue` with the new methods**

Delete the `createIssue(...)` and `updateIssue(...)` methods and insert (keep `readBoard` and `jiraError`):

```ts
  async resolveAssignee(): Promise<{ accountId: string } | null> {
    if (this.assigneeCache !== undefined) return this.assigneeCache;

    const configured = this.config.get<string>('JIRA_DEFAULT_ASSIGNEE_ACCOUNT_ID');
    if (configured) {
      this.assigneeCache = { accountId: configured };
      return this.assigneeCache;
    }

    const email = this.config.get<string>('JIRA_DEFAULT_ASSIGNEE_EMAIL');
    if (!email) {
      this.logger.warn('No JIRA assignee configured — issues will be created unassigned');
      this.assigneeCache = null;
      return null;
    }

    const res = await fetch(`${this.baseUrl}/rest/api/3/user/search?query=${encodeURIComponent(email)}`, {
      method: 'GET',
      headers: { Authorization: this.authHeader, Accept: 'application/json' },
    });
    if (!res.ok) {
      this.logger.error(`Jira user search failed: ${res.status}`);
      this.assigneeCache = null;
      return null;
    }
    const users = (await res.json()) as Array<{ accountId: string }>;
    this.assigneeCache = users.length ? { accountId: users[0].accountId } : null;
    return this.assigneeCache;
  }

  private async createOne(input: {
    issueType: string;
    summary: string;
    description: string;
    acceptanceCriteria: string[];
    parentKey?: string;
  }): Promise<JiraIssueResult> {
    const assignee = await this.resolveAssignee();
    const fields: Record<string, unknown> = {
      project: { key: this.projectKey },
      issuetype: { name: input.issueType },
      summary: input.summary,
      description: toAdf(input.description, input.acceptanceCriteria),
    };
    if (input.parentKey) fields.parent = { key: input.parentKey };
    if (assignee) fields.assignee = assignee;
    // Sub-tasks inherit the parent's sprint; only set sprint on standalone/standard issues.
    if (this.sprintId && input.issueType !== 'Sub-task') fields.customfield_10020 = this.sprintId;

    const res = await fetch(`${this.baseUrl}/rest/api/3/issue`, {
      method: 'POST',
      headers: { Authorization: this.authHeader, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`Jira createIssue (${input.issueType}) failed: ${res.status} — ${text}`);
      throw this.jiraError(`Failed to create Jira issue: ${res.status}`, text);
    }
    const data = (await res.json()) as JiraCreateResponse;
    return { key: data.key, url: `${this.baseUrl}/browse/${data.key}` };
  }

  async createIssueTree(root: DecomposedRoot): Promise<{ keys: string[] }> {
    const keys: string[] = [];
    const rootRes = await this.createOne({
      issueType: root.issueType,
      summary: root.summary,
      description: root.description,
      acceptanceCriteria: root.acceptanceCriteria,
    });
    keys.push(rootRes.key);

    if (root.issueType === 'Epic') {
      for (const child of root.children) {
        const childRes = await this.createOne({
          issueType: child.issueType,
          summary: child.summary,
          description: child.description,
          acceptanceCriteria: child.acceptanceCriteria,
          parentKey: rootRes.key,
        });
        keys.push(childRes.key);
        for (const st of child.subtasks) {
          const stRes = await this.createOne({
            issueType: 'Sub-task',
            summary: st.summary,
            description: st.description,
            acceptanceCriteria: [],
            parentKey: childRes.key,
          });
          keys.push(stRes.key);
        }
      }
    } else {
      for (const st of root.subtasks) {
        const stRes = await this.createOne({
          issueType: 'Sub-task',
          summary: st.summary,
          description: st.description,
          acceptanceCriteria: [],
          parentKey: rootRes.key,
        });
        keys.push(stRes.key);
      }
    }

    this.logger.log(`Jira issue tree created: ${keys.join(', ')}`);
    return { keys };
  }

  async addComment(key: string, text: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/rest/api/3/issue/${key}/comment`, {
      method: 'POST',
      headers: { Authorization: this.authHeader, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ body: toAdf(text, []) }),
    });
    if (!res.ok) {
      const text2 = await res.text().catch(() => '');
      this.logger.error(`Jira addComment ${key} failed: ${res.status} — ${text2}`);
      throw this.jiraError(`Failed to comment on Jira issue ${key}: ${res.status}`, text2);
    }
  }
```

- [ ] **Step 5: Run, verify pass**

Run: `npm test -- src/pm-bridge/jira-gateway.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pm-bridge/jira-gateway.service.ts src/pm-bridge/jira-gateway.service.spec.ts
git commit -m "feat(pm-bridge): Jira issue-tree, assignee, and comment support"
```

---

### Task 7: Held-item email (`EmailService.sendText` + export) & `PmNotifyService`

**Files:**
- Modify: `src/auth/email.service.ts` (add `sendText`)
- Modify: `src/auth/auth.module.ts` (export `EmailService`)
- Create: `src/pm-bridge/pm-notify.service.ts`
- Create: `src/pm-bridge/pm-notify.service.spec.ts`

**Interfaces:**
- Consumes: `EmailService`, `ConfigService`, `PmHoldTokenService` (Task 8 — but its only used method `sign(itemId)` is stubbed in this task's test).
- Produces: `PmNotifyService.notifyHeld(input: { holdId: string; rawText: string; goal: string; reasonPlain: string }): Promise<void>`.

> Note: this task depends on `PmHoldTokenService` (Task 8) at wiring time, but the unit test mocks it. Implement Task 8 before running the app, either order is fine for unit tests.

- [ ] **Step 1: Add `sendText` to `EmailService`**

In `src/auth/email.service.ts`, add a public method (it reuses the existing private `sendOrLog`, inheriting the dev no-SMTP fallback):

```ts
  /** Generic plain-text send. URLs in the body are auto-linked by mail clients. */
  async sendText(to: string, subject: string, text: string): Promise<void> {
    await this.sendOrLog(to, subject, text);
  }
```

- [ ] **Step 2: Export `EmailService` from `AuthModule`**

In `src/auth/auth.module.ts`, change the `exports` array to include `EmailService`:

```ts
  exports: [SessionGuard, JwtService, EmailService],
```

- [ ] **Step 3: Write the failing test**

Create `src/pm-bridge/pm-notify.service.spec.ts`:

```ts
import { PmNotifyService } from './pm-notify.service';

function make() {
  const email = { sendText: jest.fn().mockResolvedValue(undefined) };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'PM_HOLD_NOTIFY_EMAIL') return 'daniel.s@triolla.io';
      if (key === 'API_PUBLIC_URL') return 'https://api.triolla.io';
      return undefined;
    }),
  };
  const tokens = { sign: jest.fn().mockResolvedValue('signed-token') };
  return { svc: new PmNotifyService(email as any, config as any, tokens as any), email, tokens };
}

describe('PmNotifyService.notifyHeld', () => {
  it('emails the notify address with approve + reject links carrying the token', async () => {
    const { svc, email } = make();
    await svc.notifyHeld({ holdId: 'h1', rawText: 'make it pop', goal: 'Make the page pop', reasonPlain: 'breaks the layout rule' });
    expect(email.sendText).toHaveBeenCalledTimes(1);
    const [to, subject, body] = email.sendText.mock.calls[0];
    expect(to).toBe('daniel.s@triolla.io');
    expect(subject).toContain('Make the page pop');
    expect(body).toContain('https://api.triolla.io/api/pm-bridge/holds/h1/approve?t=signed-token');
    expect(body).toContain('https://api.triolla.io/api/pm-bridge/holds/h1/reject?t=signed-token');
    expect(body).toContain('breaks the layout rule');
  });
});
```

- [ ] **Step 4: Run, verify failure**

Run: `npm test -- src/pm-bridge/pm-notify.service.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 5: Create `pm-notify.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../auth/email.service';
import { PmHoldTokenService } from './pm-hold-token.service';

@Injectable()
export class PmNotifyService {
  constructor(
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly tokens: PmHoldTokenService,
  ) {}

  async notifyHeld(input: { holdId: string; rawText: string; goal: string; reasonPlain: string }): Promise<void> {
    const to = this.config.get<string>('PM_HOLD_NOTIFY_EMAIL') ?? 'daniel.s@triolla.io';
    const base = (
      this.config.get<string>('API_PUBLIC_URL') ??
      this.config.get<string>('FRONTEND_URL') ??
      'http://localhost:3000'
    ).replace(/\/$/, '');

    const token = await this.tokens.sign(input.holdId);
    const approveUrl = `${base}/api/pm-bridge/holds/${input.holdId}/approve?t=${token}`;
    const rejectUrl = `${base}/api/pm-bridge/holds/${input.holdId}/reject?t=${token}`;

    const body = [
      'A PM tried to file work that clashes with existing tickets or product decisions.',
      '',
      'What the PM asked for:',
      input.rawText,
      '',
      `Goal: ${input.goal}`,
      '',
      `Why it was held: ${input.reasonPlain}`,
      '',
      `Approve (build it in Jira): ${approveUrl}`,
      '',
      `Reject (discard it): ${rejectUrl}`,
    ].join('\n');

    await this.email.sendText(to, `[PM Bridge] Review needed: ${input.goal}`, body);
  }
}
```

- [ ] **Step 6: Run, verify pass**

Run: `npm test -- src/pm-bridge/pm-notify.service.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/auth/email.service.ts src/auth/auth.module.ts src/pm-bridge/pm-notify.service.ts src/pm-bridge/pm-notify.service.spec.ts
git commit -m "feat(pm-bridge): held-item email notification"
```

---

### Task 8: `PmHoldTokenService` (signed approve/reject links)

**Files:**
- Create: `src/pm-bridge/pm-hold-token.service.ts`
- Create: `src/pm-bridge/pm-hold-token.service.spec.ts`

**Interfaces:**
- Produces: `sign(itemId: string, expiresIn?: string): Promise<string>` and `verify(token: string): Promise<{ itemId: string }>` (throws `UnauthorizedException` on bad/expired/wrong-type token). Uses `PM_HOLD_TOKEN_SECRET`.

- [ ] **Step 1: Write the failing test**

Create `src/pm-bridge/pm-hold-token.service.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { PmHoldTokenService } from './pm-hold-token.service';

function make() {
  const config = { getOrThrow: jest.fn((k: string) => (k === 'PM_HOLD_TOKEN_SECRET' ? 's'.repeat(32) : (() => { throw new Error(k); })())) };
  return new PmHoldTokenService(config as any);
}

describe('PmHoldTokenService', () => {
  it('round-trips a hold id', async () => {
    const svc = make();
    const token = await svc.sign('hold-123');
    expect(await svc.verify(token)).toEqual({ itemId: 'hold-123' });
  });

  it('rejects a tampered token', async () => {
    const svc = make();
    const token = await svc.sign('hold-123');
    await expect(svc.verify(token + 'x')).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an expired token', async () => {
    const svc = make();
    const token = await svc.sign('hold-123', '-1s');
    await expect(svc.verify(token)).rejects.toThrow(UnauthorizedException);
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npm test -- src/pm-bridge/pm-hold-token.service.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `pm-hold-token.service.ts`**

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT, jwtVerify } from 'jose';

@Injectable()
export class PmHoldTokenService {
  private readonly secret: Uint8Array;

  constructor(config: ConfigService) {
    // jose requires Uint8Array, not a string. Own secret — NOT JWT_SECRET, so this
    // token can never function as a session cookie.
    this.secret = new TextEncoder().encode(config.getOrThrow<string>('PM_HOLD_TOKEN_SECRET'));
  }

  sign(itemId: string, expiresIn = '14d'): Promise<string> {
    return new SignJWT({ itemId, typ: 'pm-hold' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(this.secret);
  }

  async verify(token: string): Promise<{ itemId: string }> {
    try {
      const { payload } = await jwtVerify(token, this.secret);
      if (payload.typ !== 'pm-hold' || typeof payload.itemId !== 'string') {
        throw new Error('wrong token type');
      }
      return { itemId: payload.itemId };
    } catch {
      throw new UnauthorizedException('Invalid or expired hold token');
    }
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- src/pm-bridge/pm-hold-token.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pm-bridge/pm-hold-token.service.ts src/pm-bridge/pm-hold-token.service.spec.ts
git commit -m "feat(pm-bridge): signed hold-link token service"
```

---

### Task 9: `PmBridgeService` orchestration

**Files:**
- Modify (rewrite): `src/pm-bridge/pm-bridge.service.ts`
- Modify (rewrite): `src/pm-bridge/pm-bridge.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `JiraGatewayService` (`readBoard`, `createIssueTree`, `addComment`), `PmAiService` (`clarify`, `validate`, `decompose`), `PmNotifyService` (`notifyHeld`). All DTO types from Task 3.
- Produces:
  - `converse(req: ConverseRequest, tenantId, createdBy): Promise<ConverseResponse>`
  - `commit(req: CommitRequest, tenantId, createdBy): Promise<CommitResponse>`
  - `approveHold(itemId: string): Promise<{ status: 'approved' | 'already_resolved'; keys?: string[] }>`
  - `rejectHold(itemId: string): Promise<{ status: 'rejected' | 'already_resolved' }>`
  - keeps `listDecisions`, `createDecision`, `updateDecision` unchanged.

- [ ] **Step 1: Write the failing tests**

Replace `src/pm-bridge/pm-bridge.service.spec.ts` with:

```ts
import { NotFoundException } from '@nestjs/common';
import { PmBridgeService } from './pm-bridge.service';

const brief = {
  goal: 'Make search fast', problem: 'slow', desiredOutcomes: [], constraints: [],
  affectedArea: { name: 'Talent Pool', route: '/talent-pool' }, sizeHint: 'medium' as const,
  devNotes: [], rawText: 'search slow', conversationDigest: 'faster search',
};
const page = brief.affectedArea;

function make(overrides: any = {}) {
  const prisma = {
    pmProductDecision: { findMany: jest.fn().mockResolvedValue([]) },
    pmHeldRequest: {
      create: jest.fn().mockResolvedValue({ id: 'hold-1' }),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const jira = {
    readBoard: jest.fn().mockResolvedValue([]),
    createIssueTree: jest.fn().mockResolvedValue({ keys: ['TO-1', 'TO-2'] }),
    addComment: jest.fn().mockResolvedValue(undefined),
  };
  const ai = {
    clarify: jest.fn(),
    validate: jest.fn(),
    decompose: jest.fn().mockResolvedValue({ size: 'medium', root: { issueType: 'Story', summary: 'S', description: 'd', acceptanceCriteria: [], children: [], subtasks: [] } }),
  };
  const notify = { notifyHeld: jest.fn().mockResolvedValue(undefined) };
  Object.assign(ai, overrides.ai);
  return { svc: new PmBridgeService(prisma as any, jira as any, ai as any, notify as any), prisma, jira, ai, notify };
}

describe('PmBridgeService.converse', () => {
  it('passes through a clarify result', async () => {
    const { svc, ai } = make();
    ai.clarify.mockResolvedValue({ type: 'clarify', questions: [{ id: 'q1', prompt: 'slow or wrong?', chips: [], allowFreeText: true }], goal: '', brief: null });
    const r = await svc.converse({ messages: [{ role: 'pm', content: 'bad search' }], page }, 'tenant-1', 'pm@x.com');
    expect(r).toEqual({ type: 'clarify', questions: [{ id: 'q1', prompt: 'slow or wrong?', chips: [], allowFreeText: true }] });
  });

  it('returns ready + brief when the AI is satisfied', async () => {
    const { svc, ai } = make();
    ai.clarify.mockResolvedValue({ type: 'ready', questions: [], goal: 'Make search fast', brief });
    const r = await svc.converse({ messages: [{ role: 'pm', content: 'x' }], page }, 'tenant-1', 'pm@x.com');
    expect(r).toEqual({ type: 'ready', goal: 'Make search fast', brief });
  });

  it('holds for Daniel when still unclear after the max rounds', async () => {
    const { svc, ai, prisma, notify } = make();
    ai.clarify.mockResolvedValue({ type: 'clarify', questions: [{ id: 'q', prompt: '?', chips: [], allowFreeText: true }], goal: '', brief: null });
    // 3 assistant turns already used → cap reached
    const messages = [
      { role: 'pm', content: 'a' }, { role: 'assistant', content: 'q1' },
      { role: 'pm', content: 'b' }, { role: 'assistant', content: 'q2' },
      { role: 'pm', content: 'c' }, { role: 'assistant', content: 'q3' },
      { role: 'pm', content: 'd' },
    ];
    const r = await svc.converse({ messages, page } as any, 'tenant-1', 'pm@x.com');
    expect(r).toEqual({ type: 'held' });
    expect(prisma.pmHeldRequest.create).toHaveBeenCalled();
    expect(notify.notifyHeld).toHaveBeenCalled();
  });
});

describe('PmBridgeService.commit', () => {
  it('clean → builds the tree and files', async () => {
    const { svc, ai, jira } = make();
    ai.validate.mockResolvedValue({ status: 'clean', duplicateOfKey: null, reasonPlain: '', related: [], conflictingDecisionIds: [] });
    const r = await svc.commit({ brief, page }, 'tenant-1', 'pm@x.com');
    expect(jira.createIssueTree).toHaveBeenCalled();
    expect(r).toEqual({ type: 'filed' });
  });

  it('duplicate → folds a comment, files nothing', async () => {
    const { svc, ai, jira } = make();
    ai.validate.mockResolvedValue({ status: 'duplicate', duplicateOfKey: 'TO-9', reasonPlain: 'same', related: [], conflictingDecisionIds: [] });
    const r = await svc.commit({ brief, page }, 'tenant-1', 'pm@x.com');
    expect(jira.addComment).toHaveBeenCalledWith('TO-9', expect.stringContaining('Make search fast'));
    expect(jira.createIssueTree).not.toHaveBeenCalled();
    expect(r).toEqual({ type: 'merged' });
  });

  it('conflict → holds + notifies, files nothing', async () => {
    const { svc, ai, jira, prisma, notify } = make();
    ai.validate.mockResolvedValue({ status: 'conflict', duplicateOfKey: null, reasonPlain: 'breaks rule', related: [], conflictingDecisionIds: ['d1'] });
    const r = await svc.commit({ brief, page }, 'tenant-1', 'pm@x.com');
    expect(prisma.pmHeldRequest.create).toHaveBeenCalled();
    expect(notify.notifyHeld).toHaveBeenCalledWith(expect.objectContaining({ holdId: 'hold-1', reasonPlain: 'breaks rule' }));
    expect(jira.createIssueTree).not.toHaveBeenCalled();
    expect(r).toEqual({ type: 'held' });
  });
});

describe('PmBridgeService.approveHold / rejectHold', () => {
  it('approve builds the stored brief and marks approved', async () => {
    const { svc, prisma, jira } = make();
    prisma.pmHeldRequest.findUnique.mockResolvedValue({ id: 'hold-1', status: 'pending', brief });
    const r = await svc.approveHold('hold-1');
    expect(jira.createIssueTree).toHaveBeenCalled();
    expect(prisma.pmHeldRequest.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'approved' }) }));
    expect(r.status).toBe('approved');
  });

  it('approve on an already-resolved hold is a no-op', async () => {
    const { svc, prisma, jira } = make();
    prisma.pmHeldRequest.findUnique.mockResolvedValue({ id: 'hold-1', status: 'approved', brief });
    const r = await svc.approveHold('hold-1');
    expect(r.status).toBe('already_resolved');
    expect(jira.createIssueTree).not.toHaveBeenCalled();
  });

  it('approve on a missing hold throws 404', async () => {
    const { svc, prisma } = make();
    prisma.pmHeldRequest.findUnique.mockResolvedValue(null);
    await expect(svc.approveHold('nope')).rejects.toThrow(NotFoundException);
  });

  it('reject marks rejected without touching Jira', async () => {
    const { svc, prisma, jira } = make();
    prisma.pmHeldRequest.findUnique.mockResolvedValue({ id: 'hold-1', status: 'pending', brief });
    const r = await svc.rejectHold('hold-1');
    expect(r.status).toBe('rejected');
    expect(jira.createIssueTree).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npm test -- src/pm-bridge/pm-bridge.service.spec.ts`
Expected: FAIL (signature/method mismatch).

- [ ] **Step 3: Rewrite `pm-bridge.service.ts`**

Replace the whole file with:

```ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JiraGatewayService } from './jira-gateway.service';
import { PmAiService } from './pm-ai.service';
import { PmNotifyService } from './pm-notify.service';
import type { ConverseRequest, ConverseResponse, Turn } from './dto/converse.dto';
import type { CommitRequest, CommitResponse } from './dto/commit.dto';
import type { CreateDecision, UpdateDecision } from './dto/decision.dto';
import type { InternalBrief } from './dto/brief.dto';

const MAX_CLARIFY_ROUNDS = 3;

@Injectable()
export class PmBridgeService {
  private readonly logger = new Logger(PmBridgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jiraGateway: JiraGatewayService,
    private readonly pmAi: PmAiService,
    private readonly pmNotify: PmNotifyService,
  ) {}

  async converse(req: ConverseRequest, tenantId: string, createdBy: string): Promise<ConverseResponse> {
    const [board, decisions] = await Promise.all([
      this.jiraGateway.readBoard(),
      this.prisma.pmProductDecision.findMany({
        where: { tenantId, status: 'active' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const roundsUsed = req.messages.filter((m) => m.role === 'assistant').length;
    const result = await this.pmAi.clarify({ messages: req.messages, board, decisions, page: req.page, roundsUsed });

    if (result.type === 'ready' && result.brief) {
      return { type: 'ready', goal: result.goal, brief: result.brief };
    }

    // Still not ready. Stop badgering after the cap and hand off to Daniel rather than
    // auto-filing something we could not pin down.
    if (roundsUsed >= MAX_CLARIFY_ROUNDS) {
      const rawText = this.firstPmText(req.messages);
      const brief: InternalBrief = {
        goal: result.goal || '(unclear request)',
        problem: rawText,
        desiredOutcomes: [],
        constraints: [],
        affectedArea: req.page,
        sizeHint: 'tiny',
        devNotes: [],
        rawText,
        conversationDigest: req.messages.map((m) => `${m.role}: ${m.content}`).join(' | '),
      };
      await this.createHold({
        tenantId, createdBy, rawText, goal: brief.goal, brief,
        conversation: req.messages,
        reasonPlain: 'The request stayed unclear after several questions, so it was sent to you instead of filed.',
      });
      return { type: 'held' };
    }

    return { type: 'clarify', questions: result.questions };
  }

  async commit(req: CommitRequest, tenantId: string, createdBy: string): Promise<CommitResponse> {
    const [board, decisions] = await Promise.all([
      this.jiraGateway.readBoard(),
      this.prisma.pmProductDecision.findMany({
        where: { tenantId, status: 'active' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const validation = await this.pmAi.validate({ brief: req.brief, board, decisions });

    if (validation.status === 'clean') {
      const { keys } = await this.buildAndFile(req.brief);
      this.logger.log(`PM Bridge filed ${keys.length} issue(s): ${keys.join(', ')}`);
      return { type: 'filed' };
    }

    if (validation.status === 'duplicate' && validation.duplicateOfKey) {
      await this.jiraGateway.addComment(
        validation.duplicateOfKey,
        `PM follow-up via PM Bridge — goal: ${req.brief.goal}\n\n${req.brief.rawText}`,
      );
      return { type: 'merged' };
    }

    // conflict (or duplicate with no key) → hold for Daniel
    await this.createHold({
      tenantId, createdBy,
      rawText: req.brief.rawText,
      goal: req.brief.goal,
      brief: req.brief,
      conversation: [],
      reasonPlain: validation.reasonPlain || 'It clashes with existing work.',
    });
    return { type: 'held' };
  }

  async approveHold(itemId: string): Promise<{ status: 'approved' | 'already_resolved'; keys?: string[] }> {
    const hold = await this.prisma.pmHeldRequest.findUnique({ where: { id: itemId } });
    if (!hold) throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Held request not found' } });
    if (hold.status !== 'pending') return { status: 'already_resolved' };

    const brief = hold.brief as unknown as InternalBrief;
    const { keys } = await this.buildAndFile(brief);
    await this.prisma.pmHeldRequest.update({
      where: { id: itemId },
      data: { status: 'approved', jiraKeys: keys as unknown as Prisma.InputJsonValue, resolvedAt: new Date() },
    });
    this.logger.log(`PM Bridge hold ${itemId} approved → ${keys.join(', ')}`);
    return { status: 'approved', keys };
  }

  async rejectHold(itemId: string): Promise<{ status: 'rejected' | 'already_resolved' }> {
    const hold = await this.prisma.pmHeldRequest.findUnique({ where: { id: itemId } });
    if (!hold) throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Held request not found' } });
    if (hold.status !== 'pending') return { status: 'already_resolved' };

    await this.prisma.pmHeldRequest.update({
      where: { id: itemId },
      data: { status: 'rejected', resolvedAt: new Date() },
    });
    this.logger.log(`PM Bridge hold ${itemId} rejected`);
    return { status: 'rejected' };
  }

  private async buildAndFile(brief: InternalBrief): Promise<{ keys: string[] }> {
    const plan = await this.pmAi.decompose({ brief });
    return this.jiraGateway.createIssueTree(plan.root);
  }

  private async createHold(input: {
    tenantId: string;
    createdBy: string;
    rawText: string;
    goal: string;
    brief: InternalBrief;
    conversation: Turn[];
    reasonPlain: string;
  }): Promise<void> {
    const hold = await this.prisma.pmHeldRequest.create({
      data: {
        tenantId: input.tenantId,
        rawText: input.rawText,
        goal: input.goal,
        conversation: input.conversation as unknown as Prisma.InputJsonValue,
        brief: input.brief as unknown as Prisma.InputJsonValue,
        verdict: { reasonPlain: input.reasonPlain } as unknown as Prisma.InputJsonValue,
        status: 'pending',
        createdBy: input.createdBy,
      },
    });
    await this.pmNotify.notifyHeld({
      holdId: hold.id,
      rawText: input.rawText,
      goal: input.goal,
      reasonPlain: input.reasonPlain,
    });
  }

  private firstPmText(messages: Turn[]): string {
    return messages.find((m) => m.role === 'pm')?.content ?? '';
  }

  // ── decisions (unchanged) ───────────────────────────────────────────────────
  listDecisions(tenantId: string) {
    return this.prisma.pmProductDecision.findMany({
      where: { tenantId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
  }

  createDecision(data: CreateDecision, tenantId: string, createdBy: string) {
    return this.prisma.pmProductDecision.create({
      data: { tenantId, statement: data.statement, contextRoute: data.contextRoute, createdBy, status: 'active' },
    });
  }

  async updateDecision(id: string, data: UpdateDecision, tenantId: string) {
    const { count } = await this.prisma.pmProductDecision.updateMany({
      where: { id, tenantId },
      data: {
        ...(data.status !== undefined && { status: data.status }),
        ...(data.supersededBy !== undefined && { supersededBy: data.supersededBy }),
        ...(data.statement !== undefined && { statement: data.statement }),
      },
    });
    if (count === 0) {
      throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Decision not found' } });
    }
    return this.prisma.pmProductDecision.findUniqueOrThrow({ where: { id } });
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- src/pm-bridge/pm-bridge.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pm-bridge/pm-bridge.service.ts src/pm-bridge/pm-bridge.service.spec.ts
git commit -m "feat(pm-bridge): converse/commit/hold orchestration"
```

---

### Task 10: Controllers — `/converse`, `/commit`, public `/holds/:id/{approve,reject}` + module wiring

**Files:**
- Modify (rewrite): `src/pm-bridge/pm-bridge.controller.ts`
- Create: `src/pm-bridge/pm-holds.controller.ts`
- Modify: `src/pm-bridge/pm-bridge.module.ts`
- Modify (rewrite): `src/pm-bridge/pm-bridge.controller.spec.ts`
- Create: `src/pm-bridge/pm-holds.controller.spec.ts`

**Interfaces:**
- Consumes: `PmBridgeService`, `PmHoldTokenService`, the request schemas.
- Produces: HTTP routes `POST /pm-bridge/converse`, `POST /pm-bridge/commit`, `GET|POST /pm-bridge/holds/:id/approve`, `GET|POST /pm-bridge/holds/:id/reject`, plus unchanged `/pm-bridge/decisions`.

- [ ] **Step 1: Rewrite `pm-bridge.controller.ts`**

Replace the `draft`/`commit` handlers (and imports) so the file reads:

```ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ZodError } from 'zod';
import { SessionGuard } from '../auth/session.guard';
import { PmBridgeGuard } from './pm-bridge.guard';
import { PmBridgeService } from './pm-bridge.service';
import { ConverseRequestSchema } from './dto/converse.dto';
import { CommitRequestSchema } from './dto/commit.dto';
import { CreateDecisionSchema, UpdateDecisionSchema } from './dto/decision.dto';

@UseGuards(SessionGuard, PmBridgeGuard)
@Controller('pm-bridge')
export class PmBridgeController {
  constructor(private readonly service: PmBridgeService) {}

  @Post('converse')
  async converse(@Body() body: unknown, @Req() req: Request) {
    const result = ConverseRequestSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException({
        error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: this.formatZodErrors(result.error) },
      });
    }
    return this.service.converse(result.data, req.session!.org, req.pmBridgeEmail!);
  }

  @Post('commit')
  async commit(@Body() body: unknown, @Req() req: Request) {
    const result = CommitRequestSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException({
        error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: this.formatZodErrors(result.error) },
      });
    }
    return this.service.commit(result.data, req.session!.org, req.pmBridgeEmail!);
  }

  @Get('decisions')
  async listDecisions(@Req() req: Request) {
    return this.service.listDecisions(req.session!.org);
  }

  @Post('decisions')
  async createDecision(@Body() body: unknown, @Req() req: Request) {
    const result = CreateDecisionSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException({
        error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: this.formatZodErrors(result.error) },
      });
    }
    return this.service.createDecision(result.data, req.session!.org, req.pmBridgeEmail!);
  }

  @Patch('decisions/:id')
  async updateDecision(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const result = UpdateDecisionSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException({
        error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: this.formatZodErrors(result.error) },
      });
    }
    return this.service.updateDecision(id, result.data, req.session!.org);
  }

  private formatZodErrors(error: ZodError): Record<string, string[]> {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      if (!fieldErrors[path]) fieldErrors[path] = [];
      fieldErrors[path].push(issue.message);
    }
    return fieldErrors;
  }
}
```

- [ ] **Step 2: Create `pm-holds.controller.ts` (public, token-gated, GET shows confirm page / POST acts)**

```ts
import { Controller, Get, Header, Param, Post, Query } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PmBridgeService } from './pm-bridge.service';
import { PmHoldTokenService } from './pm-hold-token.service';

// Hit from Daniel's email client — no session cookie. Guarded by the signed token only.
// GET renders a confirm page (so email link-prefetchers can't trigger the action);
// the actual mutation is the POST the page submits.
@Controller('pm-bridge/holds')
export class PmHoldsController {
  constructor(
    private readonly service: PmBridgeService,
    private readonly tokens: PmHoldTokenService,
  ) {}

  @Public()
  @Get(':id/approve')
  @Header('Content-Type', 'text/html; charset=utf-8')
  approvePage(@Param('id') id: string, @Query('t') t: string) {
    return this.confirmPage(id, t, 'approve', 'Approve and build this in Jira?');
  }

  @Public()
  @Get(':id/reject')
  @Header('Content-Type', 'text/html; charset=utf-8')
  rejectPage(@Param('id') id: string, @Query('t') t: string) {
    return this.confirmPage(id, t, 'reject', 'Reject and discard this request?');
  }

  @Public()
  @Post(':id/approve')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async approve(@Param('id') id: string, @Query('t') t: string) {
    const { itemId } = await this.tokens.verify(t);
    if (itemId !== id) return this.resultPage('This link is not valid.');
    const r = await this.service.approveHold(id);
    return this.resultPage(r.status === 'approved' ? 'Approved — building it in Jira now.' : 'This request was already handled.');
  }

  @Public()
  @Post(':id/reject')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async reject(@Param('id') id: string, @Query('t') t: string) {
    const { itemId } = await this.tokens.verify(t);
    if (itemId !== id) return this.resultPage('This link is not valid.');
    const r = await this.service.rejectHold(id);
    return this.resultPage(r.status === 'rejected' ? 'Rejected — nothing was created.' : 'This request was already handled.');
  }

  private confirmPage(id: string, t: string, action: 'approve' | 'reject', prompt: string): string {
    const safeT = encodeURIComponent(t ?? '');
    return `<!doctype html><html><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;text-align:center">
<h2>PM Bridge</h2><p>${prompt}</p>
<form method="post" action="/api/pm-bridge/holds/${id}/${action}?t=${safeT}">
<button type="submit" style="padding:.6rem 1.4rem;font-size:1rem">${action === 'approve' ? 'Approve' : 'Reject'}</button>
</form></body></html>`;
  }

  private resultPage(message: string): string {
    return `<!doctype html><html><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;text-align:center">
<h2>PM Bridge</h2><p>${message}</p></body></html>`;
  }
}
```

- [ ] **Step 3: Wire the module**

Replace `src/pm-bridge/pm-bridge.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { PmBridgeController } from './pm-bridge.controller';
import { PmHoldsController } from './pm-holds.controller';
import { PmBridgeService } from './pm-bridge.service';
import { PmBridgeGuard } from './pm-bridge.guard';
import { JiraGatewayService } from './jira-gateway.service';
import { PmAiService } from './pm-ai.service';
import { PmNotifyService } from './pm-notify.service';
import { PmHoldTokenService } from './pm-hold-token.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PmBridgeController, PmHoldsController],
  providers: [
    PmBridgeService,
    PmBridgeGuard,
    JiraGatewayService,
    PmAiService,
    PmNotifyService,
    PmHoldTokenService,
  ],
})
export class PmBridgeModule {}
```

- [ ] **Step 4: Rewrite `pm-bridge.controller.spec.ts`**

```ts
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PmBridgeController } from './pm-bridge.controller';
import { PmBridgeService } from './pm-bridge.service';
import { SessionGuard } from '../auth/session.guard';
import { PmBridgeGuard } from './pm-bridge.guard';

const mockReq: any = { session: { sub: 'user-1', org: 'tenant-1' }, pmBridgeEmail: 'pm@x.com' };
const page = { name: 'Talent Pool', route: '/talent-pool' };

const mockService = {
  converse: jest.fn().mockResolvedValue({ type: 'clarify', questions: [] }),
  commit: jest.fn().mockResolvedValue({ type: 'filed' }),
};

async function buildController() {
  const module = await Test.createTestingModule({
    controllers: [PmBridgeController],
    providers: [{ provide: PmBridgeService, useValue: mockService }],
  })
    .overrideGuard(SessionGuard).useValue({ canActivate: () => true })
    .overrideGuard(PmBridgeGuard).useValue({ canActivate: () => true })
    .compile();
  return module.get(PmBridgeController);
}

beforeEach(() => jest.clearAllMocks());

describe('PmBridgeController', () => {
  it('converse passes parsed body + tenant/email to the service', async () => {
    const c = await buildController();
    await c.converse({ messages: [{ role: 'pm', content: 'search slow' }], page }, mockReq);
    expect(mockService.converse).toHaveBeenCalledWith(
      { messages: [{ role: 'pm', content: 'search slow' }], page }, 'tenant-1', 'pm@x.com',
    );
  });

  it('converse rejects an invalid body with 400', async () => {
    const c = await buildController();
    await expect(c.converse({ messages: [] }, mockReq)).rejects.toThrow(BadRequestException);
  });

  it('commit forwards a valid brief', async () => {
    const c = await buildController();
    const brief = {
      goal: 'g', problem: 'p', desiredOutcomes: [], constraints: [], affectedArea: page,
      sizeHint: 'tiny', devNotes: [], rawText: 'r', conversationDigest: 'd',
    };
    await c.commit({ brief, page }, mockReq);
    expect(mockService.commit).toHaveBeenCalledWith({ brief, page }, 'tenant-1', 'pm@x.com');
  });
});
```

- [ ] **Step 5: Create `pm-holds.controller.spec.ts`**

```ts
import { Test } from '@nestjs/testing';
import { PmHoldsController } from './pm-holds.controller';
import { PmBridgeService } from './pm-bridge.service';
import { PmHoldTokenService } from './pm-hold-token.service';
import { Reflector } from '@nestjs/core';

const service = {
  approveHold: jest.fn().mockResolvedValue({ status: 'approved', keys: ['TO-1'] }),
  rejectHold: jest.fn().mockResolvedValue({ status: 'rejected' }),
};
const tokens = { verify: jest.fn() };

async function build() {
  const module = await Test.createTestingModule({
    controllers: [PmHoldsController],
    providers: [
      { provide: PmBridgeService, useValue: service },
      { provide: PmHoldTokenService, useValue: tokens },
      Reflector,
    ],
  }).compile();
  return module.get(PmHoldsController);
}

beforeEach(() => jest.clearAllMocks());

describe('PmHoldsController', () => {
  it('GET approve renders a confirm form (no mutation)', async () => {
    const c = await build();
    const html = c.approvePage('hold-1', 'tok');
    expect(html).toContain('<form method="post"');
    expect(html).toContain('/api/pm-bridge/holds/hold-1/approve?t=tok');
    expect(service.approveHold).not.toHaveBeenCalled();
  });

  it('POST approve verifies the token then approves', async () => {
    tokens.verify.mockResolvedValue({ itemId: 'hold-1' });
    const c = await build();
    const html = await c.approve('hold-1', 'tok');
    expect(tokens.verify).toHaveBeenCalledWith('tok');
    expect(service.approveHold).toHaveBeenCalledWith('hold-1');
    expect(html).toContain('Approved');
  });

  it('POST approve refuses when token itemId mismatches the path id', async () => {
    tokens.verify.mockResolvedValue({ itemId: 'other' });
    const c = await build();
    const html = await c.approve('hold-1', 'tok');
    expect(service.approveHold).not.toHaveBeenCalled();
    expect(html).toContain('not valid');
  });
});
```

- [ ] **Step 6: Run all pm-bridge tests, verify pass**

Run: `npm test -- src/pm-bridge`
Expected: PASS for every spec in the folder.

- [ ] **Step 7: Type-check the whole project**

Run: `npm run build`
Expected: `nest build` completes with no TypeScript errors (catches any stale `draft.dto`/`IssueDraft` references).

- [ ] **Step 8: Commit**

```bash
git add src/pm-bridge/pm-bridge.controller.ts src/pm-bridge/pm-holds.controller.ts src/pm-bridge/pm-bridge.module.ts src/pm-bridge/pm-bridge.controller.spec.ts src/pm-bridge/pm-holds.controller.spec.ts
git commit -m "feat(pm-bridge): converse/commit + public hold approve-reject endpoints"
```

---

### Task 11: Manual end-to-end smoke (no automated test)

**Files:** none (verification task).

- [ ] **Step 1: Set env + boot**

Add to `.env`: `JIRA_DEFAULT_ASSIGNEE_ACCOUNT_ID=<Daniel's accountId>`, `PM_HOLD_TOKEN_SECRET=<≥32 chars>`, `PM_HOLD_NOTIFY_EMAIL=daniel.s@triolla.io`. Then `npm run docker:up:build`.

- [ ] **Step 2: Converse (clarify round)**

```bash
curl -s -X POST localhost:3000/api/pm-bridge/converse \
  -H 'Content-Type: application/json' --cookie 'talent_os_session=<valid session>' \
  -d '{"messages":[{"role":"pm","content":"search is bad"}],"page":{"name":"Talent Pool","route":"/talent-pool"}}' | jq
```
Expected: `{ "type": "clarify", "questions": [...] }` with plain prompts, no Jira terms.

- [ ] **Step 3: Converse → ready, then commit clean**

Continue the transcript until `{ "type":"ready", "goal":"...", "brief":{...} }`, then POST that `brief` to `/commit`. Expected: `{ "type":"filed" }`, and a new Epic/Story/Task tree in Jira project `TO` **assigned to Daniel**.

- [ ] **Step 4: Force a conflict → hold + email**

Record a product decision, then commit a brief that violates it. Expected: `{ "type":"held" }`, a `pm_held_requests` row (`npm run db:studio`), and a held-item email (or the dev log line if SMTP is unset) with approve/reject links.

- [ ] **Step 5: Approve from the link**

Open the approve URL → confirm page → submit. Expected: the tree is built in Jira, the hold row flips to `approved` with `jira_keys` set. Re-submitting shows "already handled".

- [ ] **Step 6: Commit (notes only — no code)**

No code change; if `.env.example` exists, add the new keys and commit that.

---

### Task 12: `PROTOCOL.md` — PM Bridge section (BOTH repos, byte-identical)

**Files:**
- Modify: `PROTOCOL.md` (backend) and `../talent-os-client/PROTOCOL.md` — identical content.

- [ ] **Step 1: Add the section to the backend `PROTOCOL.md`**

Append a new section:

```markdown
## PM Bridge

All routes are under `/api/pm-bridge`. `/converse`, `/commit`, and `/decisions` require a
session cookie and PM-Bridge allowlist membership. `/holds/:id/{approve,reject}` are public,
gated by a signed token from the notification email. The PM-facing payloads never contain
Jira concepts (issue type, key, epic, acceptance criteria).

### POST /pm-bridge/converse
Request: `{ "messages": [{ "role": "pm"|"assistant", "content": string }], "page": { "name": string, "route": string } }`
Response (one of):
- `{ "type": "clarify", "questions": [{ "id": string, "prompt": string, "chips": string[], "allowFreeText": boolean }] }`
- `{ "type": "ready", "goal": string, "brief": InternalBrief }`  ← echo `brief` back to /commit unchanged
- `{ "type": "held" }`

### POST /pm-bridge/commit
Request: `{ "brief": InternalBrief, "page": { "name": string, "route": string } }`
Response: `{ "type": "filed" | "merged" | "held" }`

`InternalBrief = { goal, problem, desiredOutcomes: string[], constraints: string[],
affectedArea: { name, route }, sizeHint: "tiny"|"medium"|"large", devNotes: string[],
rawText, conversationDigest }` — opaque to the client; pass through verbatim.

### GET|POST /pm-bridge/holds/:id/approve  · GET|POST /pm-bridge/holds/:id/reject
Public. Query `?t=<signed token>`. GET returns an HTML confirm page; POST performs the action
and returns an HTML result page.

### GET/POST /pm-bridge/decisions · PATCH /pm-bridge/decisions/:id
Unchanged from the existing decisions contract.
```

- [ ] **Step 2: Copy the identical section into the client repo**

```bash
cp PROTOCOL.md ../talent-os-client/PROTOCOL.md
```
(Or paste the same section if the two files have diverged elsewhere — they must stay byte-identical.)

- [ ] **Step 3: Commit (backend)**

```bash
git add PROTOCOL.md
git commit -m "docs(pm-bridge): document smart-intake API in PROTOCOL.md"
```

- [ ] **Step 4: Commit (client)** — from the client repo

```bash
cd ../talent-os-client && git add PROTOCOL.md && git commit -m "docs(pm-bridge): sync PROTOCOL.md smart-intake contract"
```

---

## Self-Review — spec coverage

| Spec requirement | Task |
|---|---|
| Adaptive clarify loop, stateless transcript | 4, 9, 10 (`/converse`) |
| One-line goal confirm (PM sees only `goal`) | 3 (`ConverseResponse.ready`), 12 |
| PM-facing copy = easy/daily English (ADHD reader) | Global Constraints + 4 (`CLARIFY_SYSTEM` WRITING STYLE) |
| Silent right-size hierarchy build | 5 (`decompose`), 6 (`createIssueTree`) |
| Assign every issue to Daniel | 2 (env), 6 (`resolveAssignee` + `createOne`) |
| Duplicate → fold (comment, no overwrite) | 6 (`addComment`), 9 (`commit`) |
| Conflict → hold for Daniel, PM can't force | 1 (table), 9 (`createHold`), no override path |
| Plain dedup question, no keys | 4 (`CLARIFY_SYSTEM`) |
| Notify-only review (email + approve/reject links) | 7 (`PmNotifyService`), 8 (token), 10 (public controller) |
| Hold link security (own secret, single-use, no prefetch) | 8 (`PM_HOLD_TOKEN_SECRET`), 9 (`status`), 10 (GET-confirm/POST-act) |
| Native 3-level Jira mapping | 3 (schemas), 5 (`DECOMPOSE_SYSTEM`), 6 (tree walk) |
| "Unclear after 3 rounds" → hold | 9 (`MAX_CLARIFY_ROUNDS`) |
| Old override/409 path deleted | 9 (rewrite), 3 (`draft.dto` deleted) |
| PROTOCOL.md in both repos | 12 |
| Live-Jira items to verify (Story/Sub-task names, accountId) | 11 (manual smoke) |

**Type consistency check:** `InternalBrief`, `Turn`, `ConverseResponse`, `CommitResponse`, `ClarifyResult`, `ValidationResult`, `DecomposedRoot`/`DecomposedChild`/`DecomposedSubtask`, `DecomposeResult` are all defined once in Task 3 and consumed by the same names in Tasks 4–11. `createIssueTree(root: DecomposedRoot)` matches `decompose()`'s `DecomposeResult.root`. `PmHoldTokenService.sign/verify` signatures match their callers in Tasks 7 and 10.

**Out of scope (this plan):** all frontend work (separate plan), the in-app approval queue (notify-only chosen), Slack, Advanced-Roadmaps 4-level hierarchy.
