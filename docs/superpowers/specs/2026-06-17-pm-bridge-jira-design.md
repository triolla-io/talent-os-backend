# PM Bridge — Backend (Jira Filing + Validation Gate)

**Date:** 2026-06-17
**Status:** Design approved, ready for implementation plan
**Companion spec (frontend):** `talent-os-client/docs/superpowers/specs/2026-06-17-pm-bridge-jira-design.md`

## Problem

The project's non-technical PM needs to file well-formed Jira issues from inside the live app, with minimum effort, and must be protected from creating tickets that duplicate, conflict with, or override existing work — or that contradict product decisions he previously made. The frontend (companion spec) renders the launcher and the flow state machine; this spec defines the backend contract so backend work is mechanical.

The backend owns the things the client cannot be trusted with: the Jira token, the board read, the AI draft+validate call, the persisted product decisions, and the write gate.

## Goals

- Expose `/api/pm-bridge/*` endpoints that draft a structured Jira issue from loose natural language and return an AI **verdict** comparing it against existing tickets **and** recorded product decisions.
- Perform Jira writes (create/update) server-side only, after re-validating on commit ("don't believe the PM").
- Persist **product decisions** as a second source of truth, scoped per tenant.
- Re-check a server-side **email allowlist** on every call — frontend hiding is cosmetic.

## Non-Goals (YAGNI)

Screenshot/console capture, board-browsing UI, deleting tickets, voice input, multi-project support, and **a local audit-log table** (Jira itself is the record of created tickets). Only `pm_product_decisions` is persisted.

## Decisions (resolved during brainstorming)

- **AI provider:** Claude routed through **OpenRouter** (existing `@openrouter/ai-sdk-provider` + `generateObject` wiring), not the direct Anthropic SDK. Honors the codebase's OpenRouter-only constraint and reuses the existing `OPENROUTER_API_KEY`. `ANTHROPIC_API_KEY` stays commented out in `env.ts` (unused).
- **Model:** `anthropic/claude-sonnet-4.6`, configurable via `PM_BRIDGE_MODEL`. Stronger than the `gpt-4o-mini` used for scoring because the validation gate must catch subtle duplicates/conflicts.
- **Commit gate:** the backend **re-runs AI validation on commit** (re-fetch board + decisions, re-run Claude). Accepted tradeoff: ~2× model cost per write and the fresh verdict may differ from the previewed one. This defends against a stale board and against any client that bypasses the frontend hard-block.
- **Audit log:** none. Minimal persistence.

## Architecture

New NestJS module `src/pm-bridge/`, mounted in the **API** entry point (`src/app.module.ts`) — not the worker. Follows the existing controller + service + dto + `*.spec.ts` pattern (mirrors `jobs/`).

```
src/pm-bridge/
  pm-bridge.module.ts
  pm-bridge.controller.ts      # 5 endpoints, @UseGuards(SessionGuard, PmBridgeGuard)
  pm-bridge.service.ts         # orchestration: draft, commit-gate, decisions CRUD
  pm-bridge.guard.ts           # server-side email allowlist re-check
  jira-gateway.service.ts      # Jira Cloud REST v3 client (read/create/update)
  pm-ai.service.ts             # Claude draft+validate via OpenRouter generateObject
  adf.util.ts                  # plain text/markdown -> Atlassian Document Format
  dto/
    draft.dto.ts               # DraftRequestSchema
    commit.dto.ts              # CommitRequestSchema
    decision.dto.ts            # CreateDecisionSchema, UpdateDecisionSchema
    ai-output.dto.ts           # DraftVerdictSchema (zod mirror of the AI contract)
  pm-bridge.controller.spec.ts
  pm-bridge.service.spec.ts
  pm-bridge.guard.spec.ts
  jira-gateway.service.spec.ts
  pm-ai.service.spec.ts
  adf.util.spec.ts
```

### Boundaries (each unit, one purpose)

- **`PmBridgeGuard`** — answers "is the caller an allowlisted PM Bridge user?" Depends on `PrismaService` (to resolve email from `sub`) and `ConfigService` (allowlist). Attaches `req.pmBridgeEmail`.
- **`JiraGatewayService`** — the only place that knows about Jira. Reads condensed board state, creates/updates issues, converts descriptions to ADF. Depends on `ConfigService` + `fetch`. Knows nothing about the AI or the DB.
- **`PmAiService`** — turns `{ text, page, tickets, decisions }` into `{ draft, verdict }`. Depends on `ConfigService` (OpenRouter key + model). Knows nothing about Jira or HTTP.
- **`PmBridgeService`** — orchestrates: calls the gateway + AI, applies the commit gate, owns decisions CRUD via Prisma. The only unit that knows the gate rules.
- **`PmBridgeController`** — HTTP edge: zod `safeParse`, error shaping, delegates to the service.

## Auth & Allowlist

`SessionGuard` (existing) verifies the `talent_os_session` JWT cookie and attaches `req.session = { sub, org, role }`. **The JWT carries no email**, but the allowlist is by email — so a second guard runs after it.

`PmBridgeGuard` (`canActivate`):
1. Read `req.session.sub` (guaranteed present — `SessionGuard` runs first in the `@UseGuards(SessionGuard, PmBridgeGuard)` order).
2. Load the `User` by id via Prisma; if missing or `isActive === false` → `ForbiddenException`.
3. Lowercase `User.email`; parse `PM_BRIDGE_ALLOWLIST` (comma-separated, trimmed, lowercased) into a set; if not a member → `ForbiddenException` with `{ error: { code: 'FORBIDDEN', message: 'Not authorized for PM Bridge' } }`.
4. Attach `req.pmBridgeEmail = email` (augment the Express `Request` type, same pattern as `session`).

`created_by` on decisions comes from `req.pmBridgeEmail`.

## Endpoints

All under the global `api` prefix (set in `main.ts`), so paths are `/api/pm-bridge/*`. All guarded by `@UseGuards(SessionGuard, PmBridgeGuard)`. Validation via zod `safeParse` in the controller; on failure throw `BadRequestException({ error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details } })` using the same `formatZodErrors` helper shape as `JobsController`.

| Method | Path | Request | Response |
|---|---|---|---|
| `POST` | `/pm-bridge/draft` | `{ text, page: { name, route }, mode: 'ticket' }` | `{ draft, verdict }` — **no write** |
| `POST` | `/pm-bridge/commit` | `{ action: 'create'\|'update', issue, targetKey?, overrideReason?, supersedesDecisionId? }` | `{ key, url }` |
| `GET` | `/pm-bridge/decisions` | — | `ProductDecision[]` (tenant-scoped, active first) |
| `POST` | `/pm-bridge/decisions` | `{ statement, contextRoute? }` | `ProductDecision` |
| `PATCH` | `/pm-bridge/decisions/:id` | `{ status?: 'superseded', supersededBy?: string, statement? }` | `ProductDecision` |

### `POST /pm-bridge/draft`

1. `JiraGatewayService.readBoard()` → condensed `{ key, type, summary, status }[]`.
2. `PmBridgeService` loads active decisions for `req.session.org`.
3. `PmAiService.draftAndValidate({ text, page, tickets, decisions })` → `{ draft, verdict }`.
4. Return as-is. No Jira write, no DB write.

### `POST /pm-bridge/commit`

1. Re-run the same context fetch (`readBoard` + active decisions) and re-run `PmAiService.draftAndValidate` against the **submitted `issue`** to get a fresh `verdict`.
2. Apply the **commit gate** (below).
3. On pass:
   - `action: 'create'` → `JiraGatewayService.createIssue(issue)` → `{ key, url }`.
   - `action: 'update'` → `JiraGatewayService.updateIssue(targetKey, issue)` → `{ key: targetKey, url }`.
4. If `supersedesDecisionId` is present, after a successful write mark that decision `status: 'superseded'` (tenant-scoped update).

### Commit gate rules

Let `verdict` be the freshly re-computed verdict.

| `action` | condition | result |
|---|---|---|
| `create` | `verdict.status === 'clean'` | write |
| `create` | not clean **and** non-empty `overrideReason` | write (explicit PM override is the authority; `overrideReason` is logged) |
| `create` | not clean **and** no `overrideReason` | **409 Conflict**, body `{ error: { code: 'VALIDATION_CONFLICT', message, details: { verdict } } }` so the client re-prompts |
| `update` | `targetKey` present | write |
| `update` | `targetKey` missing | **400** `VALIDATION_ERROR` |

The ~2× model cost and possible verdict drift are accepted and documented in a code comment at the gate.

## AI Service (`pm-ai.service.ts`)

Mirrors `ScoringAgentService`: construct `createOpenRouter({ apiKey: OPENROUTER_API_KEY })` in the constructor; model = `PM_BRIDGE_MODEL` (default `anthropic/claude-sonnet-4.6`); call `generateObject({ model: openrouter.chat(model), schema: DraftVerdictSchema, schemaName: 'PmBridgeDraftVerdict', system, prompt, temperature: 0 })`. `generateObject` enforces the schema and retries on mismatch, so no manual JSON parsing.

`draftAndValidate(input: { text, page: { name, route }, tickets: CondensedTicket[], decisions: ProductDecision[] }): Promise<DraftVerdict>`.

The **prompt** supplies: the PM's raw text, the current page name+route, the condensed ticket list, and the active decisions. The **system prompt** encodes both jobs:
- Draft a well-formed issue (`issueType`, `summary`, `description`, `acceptanceCriteria[]`, optional `suggestedEpicKey` chosen only from an Epic in the supplied tickets).
- Validate "don't believe the PM": compare against every supplied ticket and decision; set `status` to `clean` / `duplicate` / `conflict_ticket` / `conflict_decision`; populate `relatedTickets` and `conflictingDecisions` with **plain-language** explanations; set `recommendedAction` and `recommendedTargetKey`.

### `DraftVerdictSchema` (zod — mirrors the frontend contract exactly)

```ts
const DraftSchema = z.object({
  issueType: z.enum(['Epic', 'Story', 'Task', 'Bug']),
  summary: z.string(),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
  suggestedEpicKey: z.string().optional(),
});

const VerdictSchema = z.object({
  status: z.enum(['clean', 'duplicate', 'conflict_ticket', 'conflict_decision']),
  relatedTickets: z.array(z.object({
    key: z.string(),
    summary: z.string(),
    relation: z.enum(['duplicate', 'conflicts', 'related']),
    explanationPlain: z.string(),
  })),
  conflictingDecisions: z.array(z.object({
    id: z.string(),
    statement: z.string(),
    explanationPlain: z.string(),
  })),
  recommendedAction: z.enum(['create', 'update', 'review']),
  recommendedTargetKey: z.string().optional(),
});

export const DraftVerdictSchema = z.object({ draft: DraftSchema, verdict: VerdictSchema });
export type DraftVerdict = z.infer<typeof DraftVerdictSchema>;
```

## Jira Gateway (`jira-gateway.service.ts`)

- **Auth:** `Authorization: Basic base64(JIRA_EMAIL + ':' + JIRA_API_TOKEN)`. Base URL `JIRA_BASE_URL` (`https://triolla.atlassian.net`), project `JIRA_PROJECT_KEY` (default `TO`). Uses the global `fetch`.
- **Read (`readBoard`):** `POST /rest/api/3/search/jql` with JQL `project = <KEY> AND statusCategory != Done ORDER BY updated DESC`, requesting only needed fields. Map each issue to `{ key, type: fields.issuetype.name, summary: fields.summary, status: fields.status.name }`.
  - **Scale lever (commented, never silent):** MVP sends *all* non-Done issues to Claude because the TO board is small. If the board grows, pre-filter by keyword/JQL before the AI call. The bound is logged.
- **Create (`createIssue`):** `POST /rest/api/3/issue` with `fields: { project: { key }, issuetype: { name: issueType }, summary, description: toAdf(...) }`; if `suggestedEpicKey` is set, add `parent: { key: suggestedEpicKey }`. Returns `{ key, url: \`${JIRA_BASE_URL}/browse/${key}\` }`.
- **Update (`updateIssue`):** `PUT /rest/api/3/issue/{key}` with the same `fields` shape (no `project`). Returns `{ key, url }`.
- **Errors:** non-2xx Jira responses throw a mapped exception surfaced to the client as `{ error: { code: 'JIRA_ERROR', message } }` (no token leakage in logs — Jira auth header is never logged).

### ADF conversion (`adf.util.ts`)

`toAdf(description: string, acceptanceCriteria: string[]): AdfDoc`. Hand-rolled minimal converter (no heavy `@atlaskit` dependency) producing a valid ADF `doc`:
- The `description` becomes one or more `paragraph` nodes (split on blank lines).
- If `acceptanceCriteria.length > 0`, append a `heading` ("Acceptance Criteria") + a `bulletList` of `listItem` → `paragraph` nodes.

Output shape: `{ version: 1, type: 'doc', content: [...] }`. Pure function — fully unit-testable.

## Data Model — `pm_product_decisions`

New Prisma model. Adds `tenant_id` (day-1 multi-tenancy constraint — absent from the frontend draft table) and follows project conventions: `text` + CHECK over PostgreSQL ENUMs, `@updatedAt`, snake_case `@map`, UUID PK via `gen_random_uuid()`.

```prisma
model PmProductDecision {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId      String   @map("tenant_id") @db.Uuid
  statement     String   @db.Text
  contextRoute  String?  @map("context_route") @db.Text
  createdBy     String   @map("created_by") @db.Text   // email
  status        String   @default("active") @db.Text   // CHECK in ('active','superseded')
  supersededBy  String?  @map("superseded_by") @db.Uuid
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz

  organization  Organization @relation(fields: [tenantId], references: [id])

  @@index([tenantId, status], name: "idx_pm_decisions_tenant_status")
  @@map("pm_product_decisions")
}
```

- The `status` CHECK constraint (`status IN ('active','superseded')`) is added via raw SQL in the migration, matching the project's "CHECK over ENUM" convention.
- `Organization` gets the inverse relation field `pmProductDecisions PmProductDecision[]`.
- All reads/writes are scoped by `tenantId = req.session.org`. The active set is passed wholesale into every validation (the table is small).
- `GET /decisions` returns active decisions first, then superseded.

## Environment Variables

Add to `src/config/env.ts` (zod):

```ts
JIRA_BASE_URL: z.url(),
JIRA_EMAIL: z.string().min(1),
JIRA_API_TOKEN: z.string().min(1),
JIRA_PROJECT_KEY: z.string().default('TO'),
PM_BRIDGE_ALLOWLIST: z.string().default(''),          // comma-separated emails
PM_BRIDGE_MODEL: z.string().default('anthropic/claude-sonnet-4.6'),
```

Reuses existing `OPENROUTER_API_KEY`. `ANTHROPIC_API_KEY` remains commented (unused). Document the new vars in `CLAUDE.md`'s env section.

## Error Handling

Reuse the established envelope `{ error: { code, message, details? } }`:
- `VALIDATION_ERROR` (400) — zod request failures.
- `VALIDATION_CONFLICT` (409) — commit gate blocks a non-clean create with no override; `details.verdict` carries the fresh verdict.
- `FORBIDDEN` (403) — `PmBridgeGuard` rejection.
- `JIRA_ERROR` (502/from gateway) — upstream Jira failure.
- `NOT_FOUND` (404) — decision `:id` not found for the tenant on `PATCH`.

## Testing (Jest)

- **`pm-bridge.guard.spec.ts`:** allowlisted email passes; non-allowlisted → 403; missing/inactive user → 403; allowlist parsing is case-insensitive and trims whitespace.
- **`adf.util.spec.ts`:** plain text → paragraphs; acceptance criteria → heading + bullet list; empty criteria omits the list; output is a valid ADF `doc`.
- **`jira-gateway.service.spec.ts`:** Basic auth header is correct; JQL string is built with the configured project key; create payload includes `parent` only when `suggestedEpicKey` is set; update payload omits `project`; non-2xx → `JIRA_ERROR`. `fetch` mocked; token never logged.
- **`pm-ai.service.spec.ts`:** well-formed model output parses; malformed output is rejected (mock `generateObject`); prompt includes tickets + decisions.
- **`pm-bridge.service.spec.ts`** (commit gate): clean-create writes; non-clean + `overrideReason` writes; non-clean + no reason → 409 with verdict; update requires `targetKey`; `supersedesDecisionId` marks the decision superseded after a successful write; decisions CRUD is tenant-scoped.
- **`pm-bridge.controller.spec.ts`:** zod validation rejects malformed bodies with `VALIDATION_ERROR`; guards applied.

## Flow Summary

1. PM types feedback → `POST /pm-bridge/draft` → backend fetches board + active decisions, calls Claude → `{ draft, verdict }`.
2. `verdict.status === 'clean'` → PM confirms → `POST /pm-bridge/commit { action: 'create' }` → backend re-validates, writes, returns `{ key, url }`.
3. Not clean → frontend hard-block → PM picks a branch → `commit` with `action`/`targetKey`/`overrideReason`/`supersedesDecisionId`; backend re-validates and applies the gate. A supersede marks the decision `superseded`.
4. Recording a decision → `POST /pm-bridge/decisions`; updating one → `PATCH /pm-bridge/decisions/:id`.

## Highest-care pieces

- The Claude system prompt: it must reliably produce schema-valid output **and** apply the "don't believe the PM" comparison against tickets + decisions.
- ADF conversion: descriptions must be valid ADF or Jira rejects the write.
- The commit gate: the security boundary that re-validates rather than trusting the client.
